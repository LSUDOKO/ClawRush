use crate::constants::*;
use anchor_lang::prelude::*;

/// L1, never delegated. Cabinet parameters + mint registry + claimed totals.
#[account]
#[derive(InitSpace)]
pub struct CabinetConfig {
    pub authority: Pubkey,
    pub cabinet_id: u8,
    pub bump: u8,
    pub vault_bump: u8,
    /// ER validator the cabinet is delegated to (TEE validator for the private mystery vault).
    pub validator: Pubkey,
    /// Credit price in base units of mints[0] (demo USDC).
    pub play_price: u64,
    pub turn_secs: u16,
    pub grip_max_bps: u16,
    pub grip_min_bps: u16,
    pub max_payout_per_round: [u64; NUM_MINTS],
    pub restock_threshold: u8,
    /// mints[0] is the payment mint (demo USDC). All four are prize mints.
    pub mints: [Pubkey; NUM_MINTS],
    /// Monotonic total paid out on L1 by `claim_prize`, per mint. Used in the solvency rule.
    pub total_claimed: [u64; NUM_MINTS],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq, Eq)]
pub struct Capsule {
    pub id: u16,
    pub x: i32,
    pub z: i32,
    pub radius: u16,
    pub active: bool,
    pub kind: u8,
    /// Index into config.mints. For Mystery capsules this is 0 and `amount` is 0 until revealed.
    pub mint_idx: u8,
    pub amount: u64,
    pub slip_count: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug)]
pub struct LastResult {
    pub round: u64,
    pub player: Pubkey,
    pub capsule_id: u16,
    pub kind: u8,
    pub claw_x: i32,
    pub claw_z: i32,
    pub align_err_bps: u16,
    pub grip_bps: u16,
    pub roll_bps: u16,
    pub outcome: u8,
    pub mint_idx: u8,
    pub amount: u64,
    pub tier: u8,
    pub ts: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug)]
pub struct WinRecord {
    pub player: Pubkey,
    pub mint_idx: u8,
    pub amount: u64,
    pub kind: u8,
    pub ts: i64,
}

/// Delegated to the ER. Everything here is public: claw, capsules, turn, queue, last result.
#[account]
#[derive(InitSpace)]
pub struct CabinetState {
    pub cabinet_id: u8,
    pub bump: u8,
    pub claw_x: i32,
    pub claw_z: i32,
    /// Last client move sequence number (makes otherwise identical move txs unique).
    pub move_seq: u32,
    pub capsules: [Capsule; MAX_CAPSULES],
    pub next_capsule_id: u16,
    /// Pubkey::default() when no turn is active.
    pub turn_owner: Pubkey,
    pub turn_started_at: i64,
    pub turn_expires_at: i64,
    pub round: u64,
    pub pending_vrf: bool,
    /// Incremented on every drop; the callback must echo it back.
    pub vrf_nonce: u64,
    pub drop_at: i64,
    pub drop_capsule: u8,
    pub drop_align_bps: u16,
    pub queue: [Pubkey; QUEUE_LEN],
    pub q_head: u8,
    pub q_len: u8,
    /// Monotonic total won on the ER, per mint (claimed or not).
    pub total_won: [u64; NUM_MINTS],
    pub plays: u64,
    pub wins: u64,
    pub slips: u64,
    pub misses: u64,
    pub expired: u64,
    pub last: LastResult,
    pub recent_wins: [WinRecord; RECENT_WINS],
    pub recent_head: u8,
}

impl CabinetState {
    pub fn active_count(&self) -> usize {
        self.capsules.iter().filter(|c| c.active).count()
    }
    pub fn queue_push(&mut self, k: Pubkey) -> bool {
        if self.q_len as usize >= QUEUE_LEN {
            return false;
        }
        let idx = (self.q_head as usize + self.q_len as usize) % QUEUE_LEN;
        self.queue[idx] = k;
        self.q_len += 1;
        true
    }
    pub fn queue_pop(&mut self) -> Option<Pubkey> {
        if self.q_len == 0 {
            return None;
        }
        let k = self.queue[self.q_head as usize];
        self.queue[self.q_head as usize] = Pubkey::default();
        self.q_head = ((self.q_head as usize + 1) % QUEUE_LEN) as u8;
        self.q_len -= 1;
        Some(k)
    }
    pub fn has_turn(&self) -> bool {
        self.turn_owner != Pubkey::default()
    }
    /// End the current turn and start the next queued one (if any).
    pub fn advance(&mut self, now: i64, turn_secs: u16) {
        self.pending_vrf = false;
        self.claw_x = CLAW_HOME_X;
        self.claw_z = CLAW_HOME_Z;
        match self.queue_pop() {
            Some(next) => {
                self.turn_owner = next;
                self.turn_started_at = now;
                self.turn_expires_at = now + turn_secs as i64;
                self.round += 1;
            }
            None => {
                self.turn_owner = Pubkey::default();
                self.turn_started_at = 0;
                self.turn_expires_at = 0;
            }
        }
    }
    pub fn push_win(&mut self, w: WinRecord) {
        self.recent_wins[self.recent_head as usize] = w;
        self.recent_head = ((self.recent_head as usize + 1) % RECENT_WINS) as u8;
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug)]
pub struct MysteryEntry {
    pub set: bool,
    pub mint_idx: u8,
    pub amount: u64,
    pub tier: u8,
}

/// Delegated to the TEE ER with a private EphemeralPermission (no members):
/// nobody can read it through the RPC; only program instructions executing inside the TEE.
/// entries[i] belongs to cabinet.capsules[i] when that capsule is a Mystery capsule.
#[account]
#[derive(InitSpace)]
pub struct MysteryVault {
    pub cabinet_id: u8,
    pub bump: u8,
    pub sealed: bool,
    pub entries: [MysteryEntry; MAX_CAPSULES],
}

/// L1 home; delegated to the ER while the player is playing, undelegated to cash out.
#[account]
#[derive(InitSpace)]
pub struct PlayerProfile {
    pub authority: Pubkey,
    /// Profiles are per cabinet: credits and pending prizes belong to one cabinet's mints and vault.
    pub cabinet_id: u8,
    pub bump: u8,
    pub credits: u32,
    pub plays: u32,
    pub wins: u32,
    /// Scoped session key: may sign join_queue / move_claw / drop_claw only.
    pub session_key: Pubkey,
    pub session_expires_at: i64,
    pub in_queue: bool,
    /// Won but not yet claimed on L1, per mint index.
    pub pending: [u64; NUM_MINTS],
    pub faucet_last: i64,
    pub last_round: u64,
}

/// Low-privilege restock role, so a hosted keeper never holds the cabinet authority (also the upgrade key).
/// A keeper can only add capsules that pass the same bounds and solvency checks as an authority restock.
#[account]
#[derive(InitSpace)]
pub struct KeeperRole {
    pub cabinet_id: u8,
    pub bump: u8,
    pub keeper: Pubkey,
}
