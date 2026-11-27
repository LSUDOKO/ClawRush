use anchor_lang::prelude::*;

#[event]
pub struct QueueJoined { pub player: Pubkey, pub position: u8, pub credits_left: u32 }
#[event]
pub struct TurnStarted { pub player: Pubkey, pub round: u64, pub expires_at: i64 }
#[event]
pub struct ClawMoved { pub player: Pubkey, pub x: i32, pub z: i32, pub seq: u32 }
#[event]
pub struct DropInitiated { pub player: Pubkey, pub round: u64, pub x: i32, pub z: i32, pub capsule_id: u16, pub align_err_bps: u16, pub vrf_nonce: u64 }
#[event]
pub struct GripResolved { pub player: Pubkey, pub round: u64, pub capsule_id: u16, pub align_err_bps: u16, pub grip_bps: u16, pub roll_bps: u16, pub outcome: u8 }
#[event]
pub struct CapsuleSlipped { pub capsule_id: u16, pub x: i32, pub z: i32, pub slip_count: u8 }
#[event]
pub struct CapsuleWon { pub player: Pubkey, pub capsule_id: u16, pub kind: u8, pub mint_idx: u8, pub amount: u64 }
#[event]
pub struct MysteryRevealed { pub capsule_id: u16, pub mint_idx: u8, pub amount: u64, pub tier: u8 }
#[event]
pub struct PrizeSettled { pub winner: Pubkey, pub mint: Pubkey, pub amount: u64 }
#[event]
pub struct TurnExpired { pub player: Pubkey, pub round: u64, pub vrf_cancelled: bool }
#[event]
pub struct CabinetRestocked { pub added: u8, pub active: u8 }

#[event]
pub struct KeeperSet {
    pub cabinet_id: u8,
    pub keeper: Pubkey,
}
