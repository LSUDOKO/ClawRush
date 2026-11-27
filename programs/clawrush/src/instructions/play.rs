use crate::constants::*;
use crate::errors::ClawError;
use crate::events::*;
use crate::math::{self, Geo};
use crate::state::*;
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, vrf};
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::vrf::{
    self as mbvrf,
    consts::program_identity_pubkey,
    instructions::{create_request_randomness_ix_const, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

/// VRF requester identity, derived at compile time.
const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);
/// Scoped VRF callback identity, derived at compile time. (The SDK's default `#[vrf_callback]`
/// field evaluates this const fn at runtime inside the constraint and exhausts the callback's
/// compute budget, so we declare the field ourselves.)
pub const VRF_IDENTITY: Pubkey =
    Pubkey::new_from_array(mbvrf::consts::scoped_vrf_identity_const(&crate::ID).0);

/// Wallet, or its unexpired session key. Session keys are only accepted by the three
/// contexts in this file that call this (join_queue, move_claw, drop_claw).
pub fn authorize(profile: &PlayerProfile, signer: &Pubkey, now: i64) -> Result<()> {
    if *signer == profile.authority {
        return Ok(());
    }
    require!(
        profile.session_key != Pubkey::default() && *signer == profile.session_key,
        ClawError::SessionKeyNotAllowed
    );
    require!(now < profile.session_expires_at, ClawError::SessionExpired);
    Ok(())
}

fn geos(cab: &CabinetState) -> [Geo; MAX_CAPSULES] {
    let mut g = [Geo { x: 0, z: 0, radius: 0, active: false }; MAX_CAPSULES];
    for (i, c) in cab.capsules.iter().enumerate() {
        g[i] = Geo { x: c.x, z: c.z, radius: c.radius, active: c.active };
    }
    g
}

fn emit_turn_started(cab: &CabinetState) {
    if cab.has_turn() {
        emit!(TurnStarted { player: cab.turn_owner, round: cab.round, expires_at: cab.turn_expires_at });
    }
}

// ───────────────────────── join_queue (ER) ─────────────────────────

pub fn join_queue(ctx: Context<JoinQueue>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &mut ctx.accounts.profile;
    authorize(p, &ctx.accounts.signer.key(), now)?;
    require!(p.credits > 0, ClawError::NoCredits);
    let cab = &mut ctx.accounts.cabinet;
    // `in_queue` may be stale after the crank ended this player's turn; trust the cabinet.
    require!(!p.in_queue || !crate::instructions::auto::is_queued(cab, &p.authority), ClawError::AlreadyQueued);
    let turn_secs = ctx.accounts.config.turn_secs;
    let position;
    if !cab.has_turn() {
        cab.turn_owner = p.authority;
        cab.turn_started_at = now;
        cab.turn_expires_at = now + turn_secs as i64;
        cab.round += 1;
        cab.claw_x = CLAW_HOME_X;
        cab.claw_z = CLAW_HOME_Z;
        position = 0;
    } else {
        require!(cab.queue_push(p.authority), ClawError::QueueFull);
        position = cab.q_len;
    }
    p.credits -= 1;
    p.in_queue = true;
    emit!(QueueJoined { player: p.authority, position, credits_left: p.credits });
    if position == 0 {
        emit_turn_started(cab);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct JoinQueue<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [SEED_PLAYER, &[profile.cabinet_id], profile.authority.as_ref()], bump = profile.bump, constraint = profile.cabinet_id == config.cabinet_id @ ClawError::WrongCabinet)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
}

// ───────────────────────── move_claw (ER) ─────────────────────────

pub fn move_claw(ctx: Context<MoveClaw>, dx: i32, dz: i32, seq: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &ctx.accounts.profile;
    authorize(p, &ctx.accounts.signer.key(), now)?;
    let cab = &mut ctx.accounts.cabinet;
    require_keys_eq!(cab.turn_owner, p.authority, ClawError::NotYourTurn);
    require!(now <= cab.turn_expires_at, ClawError::TurnExpired);
    require!(!cab.pending_vrf, ClawError::VrfPending);
    let (x, z) = math::apply_move(cab.claw_x, cab.claw_z, dx, dz);
    cab.claw_x = x;
    cab.claw_z = z;
    cab.move_seq = seq;
    emit!(ClawMoved { player: p.authority, x, z, seq });
    Ok(())
}

#[derive(Accounts)]
pub struct MoveClaw<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [SEED_PLAYER, &[profile.cabinet_id], profile.authority.as_ref()], bump = profile.bump, constraint = profile.cabinet_id == cabinet.cabinet_id @ ClawError::WrongCabinet)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(mut, seeds = [SEED_CABINET, &[cabinet.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
}

// ───────────────────────── drop_claw (ER) ─────────────────────────

pub fn drop_claw(mut ctx: Context<DropClaw>, client_seed: u8) -> Result<()> {
    let a = &mut ctx.accounts;
    let ix = drop_core(&a.signer, &a.profile, &a.config, &mut a.cabinet, a.oracle_queue.key(), a.mystery.key(), client_seed)?;
    ctx.accounts.invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
    Ok(())
}

/// Same as drop_claw, but the mystery vault is not an account of this transaction: its address is derived
/// here and only handed to the VRF callback. The TEE redacts transactions that list the private vault, so
/// drops sent through this instruction stay publicly readable; only the callback that reads the vault is hidden.
pub fn drop_claw_public(mut ctx: Context<DropClawPublic>, client_seed: u8) -> Result<()> {
    let (mystery, _) = Pubkey::find_program_address(&[SEED_MYSTERY, &[ctx.accounts.config.cabinet_id]], &crate::ID);
    let a = &mut ctx.accounts;
    let ix = drop_core(&a.signer, &a.profile, &a.config, &mut a.cabinet, a.oracle_queue.key(), mystery, client_seed)?;
    ctx.accounts.invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
    Ok(())
}

fn drop_core(
    signer: &Signer,
    profile: &Account<PlayerProfile>,
    config: &Account<CabinetConfig>,
    cab: &mut Account<CabinetState>,
    oracle_queue: Pubkey,
    mystery: Pubkey,
    client_seed: u8,
) -> Result<anchor_lang::solana_program::instruction::Instruction> {
    let now = Clock::get()?.unix_timestamp;
    authorize(profile, &signer.key(), now)?;
    require_keys_eq!(cab.turn_owner, profile.authority, ClawError::NotYourTurn);
    require!(now <= cab.turn_expires_at, ClawError::TurnExpired);
    require!(!cab.pending_vrf, ClawError::VrfPending);

    let g = geos(cab);
    let (idx, align) = match math::nearest(&g, cab.claw_x, cab.claw_z) {
        Some((i, d)) => (i as u8, math::align_err_bps(d, g[i].radius)),
        None => (NO_CAPSULE, BPS as u16),
    };
    cab.pending_vrf = true;
    cab.vrf_nonce = cab.vrf_nonce.wrapping_add(1);
    cab.drop_at = now;
    cab.drop_capsule = idx;
    cab.drop_align_bps = align;
    let nonce = cab.vrf_nonce;
    let capsule_id = if idx == NO_CAPSULE { u16::MAX } else { cab.capsules[idx as usize].id };
    emit!(DropInitiated {
        player: profile.authority,
        round: cab.round,
        x: cab.claw_x,
        z: cab.claw_z,
        capsule_id,
        align_err_bps: align,
        vrf_nonce: nonce,
    });

    let mut seed = [client_seed; 32];
    seed[..8].copy_from_slice(&nonce.to_le_bytes());
    Ok(create_request_randomness_ix_const(
        RequestRandomnessParams {
            payer: signer.key(),
            oracle_queue,
            callback_program_id: crate::ID,
            callback_discriminator: crate::instruction::VrfGripCallback::DISCRIMINATOR.to_vec(),
            caller_seed: seed,
            accounts_metas: Some(vec![
                SerializableAccountMeta { pubkey: config.key(), is_signer: false, is_writable: false },
                SerializableAccountMeta { pubkey: cab.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: profile.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: mystery, is_signer: false, is_writable: true },
            ]),
            callback_args: Some(nonce.to_le_bytes().to_vec()),
            ..Default::default()
        },
        PROGRAM_IDENTITY,
    ))
}

#[vrf]
#[derive(Accounts)]
pub struct DropClaw<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [SEED_PLAYER, &[profile.cabinet_id], profile.authority.as_ref()], bump = profile.bump, constraint = profile.cabinet_id == config.cabinet_id @ ClawError::WrongCabinet)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    #[account(seeds = [SEED_MYSTERY, &[config.cabinet_id]], bump = mystery.bump)]
    pub mystery: Box<Account<'info, MysteryVault>>,
    /// CHECK: MagicBlock VRF oracle queue
    #[account(
        mut,
        // Pinned to the ER oracle queue: a queue that never answers would leave pending_vrf set
        // and let the player stall the cabinet until expire_turn refunds the credit (SECURITY.md F-01).
        constraint = oracle_queue.key() == mbvrf::consts::DEFAULT_EPHEMERAL_QUEUE @ ClawError::InvalidParams
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct DropClawPublic<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [SEED_PLAYER, &[profile.cabinet_id], profile.authority.as_ref()], bump = profile.bump, constraint = profile.cabinet_id == config.cabinet_id @ ClawError::WrongCabinet)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    /// CHECK: MagicBlock VRF oracle queue
    #[account(
        mut,
        // Pinned to the ER oracle queue: a queue that never answers would leave pending_vrf set
        // and let the player stall the cabinet until expire_turn refunds the credit (SECURITY.md F-01).
        constraint = oracle_queue.key() == mbvrf::consts::DEFAULT_EPHEMERAL_QUEUE @ ClawError::InvalidParams
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

// ───────────────────────── vrf_grip_callback (ER, VRF oracle only) ─────────────────────────

pub fn vrf_grip_callback(ctx: Context<VrfGripCallback>, randomness: [u8; 32], nonce: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cfg = &ctx.accounts.config;
    let cab = &mut ctx.accounts.cabinet;
    let p = &mut ctx.accounts.profile;
    let mys = &mut ctx.accounts.mystery;
    // One callback per drop: must be pending, and must answer the *current* drop.
    require!(cab.pending_vrf, ClawError::NoVrfPending);
    require!(nonce == cab.vrf_nonce, ClawError::StaleVrfCallback);
    require_keys_eq!(cab.turn_owner, p.authority, ClawError::NotYourTurn);

    let idx = cab.drop_capsule;
    let valid = idx != NO_CAPSULE && cab.capsules[idx as usize].active;
    let align = if valid { cab.drop_align_bps } else { BPS as u16 };
    let grip = if valid { math::grip_bps(align, cfg.grip_max_bps, cfg.grip_min_bps) } else { 0 };
    let roll = math::roll_bps(&randomness, 0);
    let out = math::outcome(align, grip, roll);
    let mut res = LastResult {
        round: cab.round,
        player: p.authority,
        capsule_id: if valid { cab.capsules[idx as usize].id } else { u16::MAX },
        kind: if valid { cab.capsules[idx as usize].kind } else { 0 },
        claw_x: cab.claw_x,
        claw_z: cab.claw_z,
        align_err_bps: align,
        grip_bps: grip,
        roll_bps: roll,
        outcome: out,
        mint_idx: 0,
        amount: 0,
        tier: 0,
        ts: now,
    };
    match out {
        OUTCOME_HELD => {
            let i = idx as usize;
            let c = cab.capsules[i];
            let (mint_idx, amount, tier) = if c.kind == KIND_MYSTERY {
                let e = mys.entries[i];
                require!(e.set, ClawError::InvalidCapsule);
                mys.entries[i] = MysteryEntry::default();
                emit!(MysteryRevealed { capsule_id: c.id, mint_idx: e.mint_idx, amount: e.amount, tier: e.tier });
                (e.mint_idx, e.amount, e.tier)
            } else {
                (c.mint_idx, c.amount, 0)
            };
            cab.capsules[i].active = false;
            let m = mint_idx as usize;
            p.pending[m] = p.pending[m].checked_add(amount).ok_or(ClawError::Overflow)?;
            p.wins += 1;
            cab.total_won[m] = cab.total_won[m].checked_add(amount).ok_or(ClawError::Overflow)?;
            cab.wins += 1;
            cab.push_win(WinRecord { player: p.authority, mint_idx, amount, kind: c.kind, ts: now });
            res.mint_idx = mint_idx;
            res.amount = amount;
            res.tier = tier;
            emit!(CapsuleWon { player: p.authority, capsule_id: c.id, kind: c.kind, mint_idx, amount });
        }
        OUTCOME_SLIP => {
            let i = idx as usize;
            let frac = math::slip_frac_bps(&randomness);
            let (nx, nz) = math::slip_toward_chute(cab.capsules[i].x, cab.capsules[i].z, frac);
            let c = &mut cab.capsules[i];
            c.x = nx;
            c.z = nz;
            c.slip_count = c.slip_count.saturating_add(1);
            let (cid, sc) = (c.id, c.slip_count);
            cab.slips += 1;
            emit!(CapsuleSlipped { capsule_id: cid, x: nx, z: nz, slip_count: sc });
        }
        _ => {
            let targets = math::nudge_targets(&geos(cab), cab.claw_x, cab.claw_z);
            for (k, t) in targets.iter().enumerate() {
                if let Some(i) = *t {
                    let c = &mut cab.capsules[i];
                    c.x = math::clamp_grid(c.x + math::nudge_offset(randomness[4 + 2 * k]));
                    c.z = math::clamp_grid(c.z + math::nudge_offset(randomness[5 + 2 * k]));
                }
            }
            cab.misses += 1;
        }
    }
    emit!(GripResolved {
        player: p.authority,
        round: cab.round,
        capsule_id: res.capsule_id,
        align_err_bps: align,
        grip_bps: grip,
        roll_bps: roll,
        outcome: out,
    });
    cab.last = res;
    cab.plays += 1;
    p.plays += 1;
    p.in_queue = false;
    p.last_round = cab.round;
    cab.advance(now, cfg.turn_secs);
    emit_turn_started(cab);
    Ok(())
}

#[derive(Accounts)]
pub struct VrfGripCallback<'info> {
    /// Signer only the VRF program can produce (scoped to this program).
    #[account(address = VRF_IDENTITY @ ClawError::Unauthorized)]
    pub vrf_program_identity: Signer<'info>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    #[account(mut, seeds = [SEED_PLAYER, &[profile.cabinet_id], profile.authority.as_ref()], bump = profile.bump, constraint = profile.cabinet_id == config.cabinet_id @ ClawError::WrongCabinet)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(mut, seeds = [SEED_MYSTERY, &[config.cabinet_id]], bump = mystery.bump)]
    pub mystery: Box<Account<'info, MysteryVault>>,
}

// ───────────────────────── expire_turn (ER, permissionless) ─────────────────────────
/// Anyone may end a turn after it expires, or cancel a drop whose VRF callback is overdue
/// (the credit is refunded and the late callback is rejected by the nonce/pending check).
pub fn expire_turn(ctx: Context<ExpireTurn>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cab = &mut ctx.accounts.cabinet;
    let p = &mut ctx.accounts.profile;
    require!(cab.has_turn(), ClawError::TurnNotExpired);
    require_keys_eq!(cab.turn_owner, p.authority, ClawError::NotYourTurn);
    let vrf_cancelled = if cab.pending_vrf {
        require!(now > cab.drop_at + VRF_TIMEOUT_SECS, ClawError::VrfPending);
        p.credits = p.credits.saturating_add(1);
        true
    } else {
        require!(now > cab.turn_expires_at, ClawError::TurnNotExpired);
        false
    };
    emit!(TurnExpired { player: p.authority, round: cab.round, vrf_cancelled });
    p.in_queue = false;
    cab.expired += 1;
    cab.advance(now, ctx.accounts.config.turn_secs);
    emit_turn_started(cab);
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireTurn<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    #[account(mut, seeds = [SEED_PLAYER, &[profile.cabinet_id], profile.authority.as_ref()], bump = profile.bump, constraint = profile.cabinet_id == config.cabinet_id @ ClawError::WrongCabinet)]
    pub profile: Box<Account<'info, PlayerProfile>>,
}

// ───────────────────────── cash_out (ER) ─────────────────────────
/// Commit the profile (with its pending prizes) and undelegate it back to L1, where
/// `claim_prize` pays out. Wallet signature required; session keys cannot cash out.
pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
    require!(!ctx.accounts.profile.in_queue, ClawError::StillQueued);
    ctx.accounts.profile.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.profile.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct CashOut<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_PLAYER, &[profile.cabinet_id], authority.key().as_ref()], bump = profile.bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
}
