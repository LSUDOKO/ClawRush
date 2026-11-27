//! ClawRush — one shared skill × VRF claw cabinet on a MagicBlock (Private) Ephemeral Rollup.
//!
//! Layers:
//! - L1 (Solana devnet): config, vault token accounts, player profiles at rest, prize claims.
//! - ER (MagicBlock TEE validator): cabinet state (public), mystery vault (private permission),
//!   player profiles while playing, VRF request + callback.
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs");

#[ephemeral]
#[program]
pub mod clawrush {
    use super::*;

    // ───────────── L1: setup / admin ─────────────
    pub fn init_cabinet(ctx: Context<InitCabinet>, cabinet_id: u8, params: CabinetParams) -> Result<()> {
        admin::init_cabinet(ctx, cabinet_id, params)
    }
    pub fn delegate_cabinet(ctx: Context<DelegateCabinet>) -> Result<()> {
        admin::delegate_cabinet(ctx)
    }

    // ───────────── ER: admin ─────────────
    pub fn seal_mystery(ctx: Context<SealMystery>) -> Result<()> {
        admin::seal_mystery(ctx)
    }
    pub fn restock(ctx: Context<Restock>, specs: Vec<CapsuleSpec>) -> Result<()> {
        admin::restock(ctx, specs)
    }
    pub fn set_keeper(ctx: Context<SetKeeper>, keeper: Pubkey) -> Result<()> {
        instructions::admin::set_keeper(ctx, keeper)
    }
    pub fn restock_by_keeper(ctx: Context<RestockByKeeper>, specs: Vec<CapsuleSpec>) -> Result<()> {
        instructions::admin::restock_by_keeper(ctx, specs)
    }
    pub fn admin_undelegate(ctx: Context<AdminUndelegate>) -> Result<()> {
        admin::admin_undelegate(ctx)
    }

    // ───────────── L1: player ─────────────
    pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
        player::init_player(ctx)
    }
    pub fn faucet(ctx: Context<Faucet>) -> Result<()> {
        player::faucet(ctx)
    }
    pub fn buy_credits(ctx: Context<BuyCredits>, n: u32) -> Result<()> {
        player::buy_credits(ctx, n)
    }
    pub fn register_session_key(ctx: Context<RegisterSessionKey>, key: Pubkey, expires_at: i64) -> Result<()> {
        player::register_session_key(ctx, key, expires_at)
    }
    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        player::delegate_player(ctx)
    }
    pub fn claim_prize(ctx: Context<ClaimPrize>, mint_idx: u8) -> Result<()> {
        player::claim_prize(ctx, mint_idx)
    }

    // ───────────── ER: gameplay ─────────────
    pub fn join_queue(ctx: Context<JoinQueue>) -> Result<()> {
        play::join_queue(ctx)
    }
    pub fn move_claw(ctx: Context<MoveClaw>, dx: i32, dz: i32, seq: u32) -> Result<()> {
        play::move_claw(ctx, dx, dz, seq)
    }
    pub fn drop_claw(ctx: Context<DropClaw>, client_seed: u8) -> Result<()> {
        play::drop_claw(ctx, client_seed)
    }
    pub fn vrf_grip_callback(ctx: Context<VrfGripCallback>, randomness: [u8; 32], nonce: u64) -> Result<()> {
        play::vrf_grip_callback(ctx, randomness, nonce)
    }
    pub fn expire_turn(ctx: Context<ExpireTurn>) -> Result<()> {
        play::expire_turn(ctx)
    }
    pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
        play::cash_out(ctx)
    }

    // ───────────── MagicBlock automation (crank + Magic Action) ─────────────
    pub fn crank_tick(ctx: Context<CrankTick>) -> Result<()> {
        auto::crank_tick(ctx)
    }
    pub fn schedule_crank<'info>(ctx: Context<'info, ScheduleCrank<'info>>, interval_ms: i64, iterations: i64) -> Result<()> {
        auto::schedule_crank(ctx, interval_ms, iterations)
    }
    pub fn cash_out_and_settle(ctx: Context<CashOutAndSettle>) -> Result<()> {
        auto::cash_out_and_settle(ctx)
    }
    pub fn settle_prizes(ctx: Context<SettlePrizes>) -> Result<()> {
        auto::settle_prizes(ctx)
    }
}
