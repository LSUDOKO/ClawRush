use crate::constants::*;
use crate::errors::ClawError;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

// All instructions in this file run on L1 and require the wallet itself to sign: the profile PDA
// is derived from `authority`, so a session key can never satisfy these contexts.

pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
    let p = &mut ctx.accounts.profile;
    p.authority = ctx.accounts.authority.key();
    p.cabinet_id = ctx.accounts.config.cabinet_id;
    p.bump = ctx.bumps.profile;
    Ok(())
}

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(init, payer = authority, space = 8 + PlayerProfile::INIT_SPACE, seeds = [SEED_PLAYER, &[config.cabinet_id], authority.key().as_ref()], bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    pub system_program: Program<'info, System>,
}

/// Devnet demo faucet for the payment mint (demo USDC). Rate-limited per player.
pub fn faucet(ctx: Context<Faucet>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &mut ctx.accounts.profile;
    require!(p.faucet_last == 0 || now - p.faucet_last >= FAUCET_COOLDOWN_SECS, ClawError::FaucetCooldown);
    p.faucet_last = now;
    let bump = ctx.bumps.faucet_authority;
    let seeds: &[&[&[u8]]] = &[&[SEED_FAUCET, &[bump]]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.player_ata.to_account_info(),
                authority: ctx.accounts.faucet_authority.to_account_info(),
            },
            seeds,
        ),
        FAUCET_AMOUNT,
    )
}

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_PLAYER, &[config.cabinet_id], authority.key().as_ref()], bump = profile.bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(mut, address = config.mints[0] @ ClawError::WrongMint)]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: PDA mint authority of the demo-USDC mint
    #[account(seeds = [SEED_FAUCET], bump)]
    pub faucet_authority: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = authority, associated_token::mint = mint, associated_token::authority = authority)]
    pub player_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Pay n × play_price demo-USDC into the vault; add n credits.
pub fn buy_credits(ctx: Context<BuyCredits>, n: u32) -> Result<()> {
    require!(n > 0 && n <= MAX_CREDITS_PER_BUY, ClawError::InvalidParams);
    let cost = ctx.accounts.config.play_price.checked_mul(n as u64).ok_or(ClawError::Overflow)?;
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.player_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        cost,
        ctx.accounts.mint.decimals,
    )?;
    let p = &mut ctx.accounts.profile;
    p.credits = p.credits.checked_add(n).ok_or(ClawError::Overflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct BuyCredits<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_PLAYER, &[config.cabinet_id], authority.key().as_ref()], bump = profile.bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(address = config.mints[0] @ ClawError::WrongMint)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = authority)]
    pub player_ata: Box<Account<'info, TokenAccount>>,
    /// CHECK: vault authority PDA
    #[account(seeds = [SEED_VAULT, &[config.cabinet_id]], bump = config.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Register a scoped session key. It may only sign join_queue / move_claw / drop_claw.
pub fn register_session_key(ctx: Context<RegisterSessionKey>, key: Pubkey, expires_at: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(expires_at > now, ClawError::InvalidParams);
    require!(expires_at - now <= MAX_SESSION_SECS, ClawError::SessionTooLong);
    require!(key != ctx.accounts.authority.key() && key != Pubkey::default(), ClawError::InvalidParams);
    let p = &mut ctx.accounts.profile;
    p.session_key = key;
    p.session_expires_at = expires_at;
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterSessionKey<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_PLAYER, &[profile.cabinet_id], authority.key().as_ref()], bump = profile.bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
}

/// Delegate the player's profile to the cabinet's ER validator so it can play there.
pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
    let auth = ctx.accounts.authority.key();
    ctx.accounts.delegate_profile(
        &ctx.accounts.authority,
        &[SEED_PLAYER, &[ctx.accounts.config.cabinet_id], auth.as_ref()],
        DelegateConfig { validator: Some(ctx.accounts.config.validator), ..Default::default() },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    /// CHECK: the player's profile PDA, delegated to the ER
    #[account(mut, del, seeds = [SEED_PLAYER, &[config.cabinet_id], authority.key().as_ref()], bump)]
    pub profile: UncheckedAccount<'info>,
}

/// Settle a won prize on L1. The profile must be back on L1 (cash_out undelegated it), which
/// Anchor enforces: a delegated profile is owned by the delegation program and fails to load.
/// Zeroing `pending` makes the claim exactly-once.
pub fn claim_prize(ctx: Context<ClaimPrize>, mint_idx: u8) -> Result<()> {
    let m = mint_idx as usize;
    require!(m < NUM_MINTS, ClawError::InvalidParams);
    require_keys_eq!(ctx.accounts.mint.key(), ctx.accounts.config.mints[m], ClawError::WrongMint);
    let amount = ctx.accounts.profile.pending[m];
    require!(amount > 0, ClawError::NothingToClaim);
    ctx.accounts.profile.pending[m] = 0;
    let cfg = &mut ctx.accounts.config;
    cfg.total_claimed[m] = cfg.total_claimed[m].checked_add(amount).ok_or(ClawError::Overflow)?;
    let id = cfg.cabinet_id;
    let vb = cfg.vault_bump;
    let seeds: &[&[&[u8]]] = &[&[SEED_VAULT, &[id], &[vb]]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.player_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            seeds,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    emit!(PrizeSettled { winner: ctx.accounts.authority.key(), mint: ctx.accounts.mint.key(), amount });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_PLAYER, &[config.cabinet_id], authority.key().as_ref()], bump = profile.bump)]
    pub profile: Box<Account<'info, PlayerProfile>>,
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: vault authority PDA
    #[account(seeds = [SEED_VAULT, &[config.cabinet_id]], bump = config.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_ata: Box<Account<'info, TokenAccount>>,
    #[account(init_if_needed, payer = authority, associated_token::mint = mint, associated_token::authority = authority)]
    pub player_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
