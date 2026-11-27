//! MagicBlock automation, added in the second program upgrade (all new instructions; no existing
//! account layout or instruction signature changed):
//! - Crank: the ER's built-in scheduler calls `crank_tick` every few seconds to clear idle turns,
//!   so the cabinet keeps moving with no keeper server.
//! - Magic Action: `cash_out_and_settle` commits + undelegates the profile and schedules
//!   `settle_prizes` on L1 in the same settlement, so one wallet signature pays the prizes out.
use crate::constants::*;
use crate::errors::ClawError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::{action, commit};
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
#[allow(unused_imports)]
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableCauIntentBuilder, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

/// `ActionArgs::new` default escrow index.
pub const ACTION_ESCROW_INDEX: u8 = 255;

/// True while `k` holds the turn or waits in the queue. A profile's `in_queue` flag can be stale
/// after the crank ends a turn (the scheduled tick cannot take the varying profile account).
pub fn is_queued(cab: &CabinetState, k: &Pubkey) -> bool {
    if cab.turn_owner == *k {
        return true;
    }
    (0..cab.q_len as usize).any(|i| cab.queue[(cab.q_head as usize + i) % QUEUE_LEN] == *k)
}

// ───────────────────────── crank_tick (ER, scheduled; permissionless and idempotent) ─────────────────────────
/// Ends the current turn once it is past its deadline. No-op otherwise, so extra or late ticks are
/// harmless. An overdue VRF drop is left to `expire_turn`, which refunds the credit on the profile.
pub fn crank_tick(ctx: Context<CrankTick>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cab = &mut ctx.accounts.cabinet;
    if !cab.has_turn() || cab.pending_vrf || now <= cab.turn_expires_at {
        return Ok(());
    }
    emit!(TurnExpired { player: cab.turn_owner, round: cab.round, vrf_cancelled: false });
    cab.expired += 1;
    cab.advance(now, ctx.accounts.config.turn_secs);
    if cab.has_turn() {
        emit!(TurnStarted { player: cab.turn_owner, round: cab.round, expires_at: cab.turn_expires_at });
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CrankTick<'info> {
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
}

// ───────────────────────── schedule_crank (ER, admin) ─────────────────────────
pub fn schedule_crank<'info>(ctx: Context<'info, ScheduleCrank<'info>>, interval_ms: i64, iterations: i64) -> Result<()> {
    require!(interval_ms >= 500 && iterations > 0, ClawError::InvalidParams);
    let tick = Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.config.key(), false),
            AccountMeta::new(ctx.accounts.cabinet.key(), false),
        ],
        data: anchor_lang::InstructionData::data(&crate::instruction::CrankTick {}),
    };
    // Task ids are global on the validator: derive one from the cabinet address.
    let k = ctx.accounts.cabinet.key().to_bytes();
    let task_id = i64::from_le_bytes(k[..8].try_into().unwrap()) & i64::MAX;
    let accts = [ctx.accounts.authority.to_account_info(), ctx.accounts.config.to_account_info(), ctx.accounts.cabinet.to_account_info()];
    ScheduleCrankCpi {
        payer: &ctx.accounts.authority,
        magic_program: &ctx.accounts.magic_program,
        instruction_accounts: &accts,
        args: ScheduleTaskArgs { task_id, execution_interval_millis: interval_ms, iterations, instructions: vec![tick] },
    }
    .invoke()?;
    msg!("crank task {} every {} ms x {}", task_id, interval_ms, iterations);
    Ok(())
}

#[derive(Accounts)]
pub struct ScheduleCrank<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    /// CHECK: MagicBlock magic program
    #[account(address = ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: this program, the scheduled instruction's target
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

// ───────────────────────── cash_out_and_settle (ER, wallet only) ─────────────────────────
/// Like `cash_out`, plus a post-commit Magic Action that pays every pending prize on L1 in the same
/// settlement. If the action fails the committor drops it and the commit still lands; the profile
/// then keeps its `pending` amounts and `claim_prize` remains the fallback (never double-paid:
/// `settle_prizes` and `claim_prize` both zero `pending` as they pay).
pub fn cash_out_and_settle(ctx: Context<CashOutAndSettle>) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.profile.in_queue || !is_queued(&a.cabinet, &a.profile.authority), ClawError::StillQueued);
    let has_prizes = a.profile.pending.iter().any(|&x| x > 0);
    a.profile.exit(&crate::ID)?;
    let builder = MagicIntentBundleBuilder::new(
        a.authority.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[a.profile.to_account_info()]);
    if !has_prizes {
        builder.build_and_invoke()?;
        return Ok(());
    }
    let w = |k: Pubkey| ShortAccountMeta { pubkey: k.to_bytes().into(), is_writable: true };
    let r = |k: Pubkey| ShortAccountMeta { pubkey: k.to_bytes().into(), is_writable: false };
    let mut accounts = vec![w(a.config.key()), w(a.profile.key()), r(a.vault.key()), r(token::ID)];
    for i in 0..NUM_MINTS {
        accounts.push(w(ata(&a.vault.key(), &a.config.mints[i])));
    }
    for i in 0..NUM_MINTS {
        accounts.push(w(ata(&a.authority.key(), &a.config.mints[i])));
    }
    let action = CallHandler {
        destination_program: crate::ID,
        accounts,
        args: ActionArgs::new(anchor_lang::InstructionData::data(&crate::instruction::SettlePrizes {})),
        escrow_authority: a.authority.to_account_info(),
        compute_units: 120_000,
    };
    builder.add_post_undelegate_actions([action]).build_and_invoke()?;
    Ok(())
}

fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token::ID.as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    )
    .0
}

#[commit]
#[derive(Accounts)]
pub struct CashOutAndSettle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_PLAYER, &[config.cabinet_id], authority.key().as_ref()], bump = profile.bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    /// CHECK: vault authority PDA (address only)
    #[account(seeds = [SEED_VAULT, &[config.cabinet_id]], bump = config.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: destination program of the scheduled action
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

// ───────────────────────── settle_prizes (L1, Magic Action only) ─────────────────────────
/// Runs on L1 after the profile is committed and undelegated. Only the delegation program can make
/// `escrow` a signer, and `escrow_auth` must be the profile owner, so this cannot be called directly.
/// `Account<PlayerProfile>` only loads once the profile is back under this program, so a payout
/// can never run against a still-delegated profile.
pub fn settle_prizes(ctx: Context<SettlePrizes>) -> Result<()> {
    let a = ctx.accounts;
    let id = a.config.cabinet_id;
    let vb = a.config.vault_bump;
    let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[id], &[vb]]];
    let vaults = [&a.vault_ata0, &a.vault_ata1, &a.vault_ata2, &a.vault_ata3];
    let players = [&a.player_ata0, &a.player_ata1, &a.player_ata2, &a.player_ata3];
    for m in 0..NUM_MINTS {
        let amount = a.profile.pending[m];
        if amount == 0 {
            continue;
        }
        a.profile.pending[m] = 0;
        a.config.total_claimed[m] = a.config.total_claimed[m].checked_add(amount).ok_or(ClawError::Overflow)?;
        #[allow(deprecated)]
        token::transfer(
            CpiContext::new_with_signer(
                a.token_program.key(),
                Transfer {
                    from: vaults[m].to_account_info(),
                    to: players[m].to_account_info(),
                    authority: a.vault.to_account_info(),
                },
                seeds,
            ),
            amount,
        )?;
        emit!(PrizeSettled { winner: a.profile.authority, mint: a.config.mints[m], amount });
    }
    Ok(())
}

#[action]
#[derive(Accounts)]
pub struct SettlePrizes<'info> {
    #[account(mut, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_PLAYER, &[config.cabinet_id], profile.authority.as_ref()], bump = profile.bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    /// CHECK: vault authority PDA
    #[account(seeds = [SEED_VAULT, &[config.cabinet_id]], bump = config.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    #[account(mut, token::mint = config.mints[0], token::authority = vault)]
    pub vault_ata0: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.mints[1], token::authority = vault)]
    pub vault_ata1: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.mints[2], token::authority = vault)]
    pub vault_ata2: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.mints[3], token::authority = vault)]
    pub vault_ata3: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.mints[0], token::authority = profile.authority)]
    pub player_ata0: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.mints[1], token::authority = profile.authority)]
    pub player_ata1: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.mints[2], token::authority = profile.authority)]
    pub player_ata2: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.mints[3], token::authority = profile.authority)]
    pub player_ata3: Box<Account<'info, TokenAccount>>,
    /// CHECK: program that scheduled the action (supplied by the delegation program).
    #[account(address = crate::ID @ ClawError::Unauthorized)]
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: payer identity the action was scheduled with; must be the prize owner.
    #[account(address = profile.authority @ ClawError::Unauthorized)]
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: only the delegation program can sign for this PDA, proving the post-commit path.
    #[account(
        signer @ ClawError::Unauthorized,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&escrow_auth.key(), ACTION_ESCROW_INDEX) @ ClawError::Unauthorized,
    )]
    pub escrow: UncheckedAccount<'info>,
}
