use crate::constants::*;
use crate::errors::ClawError;
use crate::events::*;
use crate::math;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::TokenAccount;
use ephemeral_rollups_sdk::access_control::instructions::{
    CloseEphemeralPermissionCpi, CreateEphemeralPermissionCpi,
};
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, EphemeralPermission, PERMISSION_SEED};
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CabinetParams {
    pub validator: Pubkey,
    pub play_price: u64,
    pub turn_secs: u16,
    pub grip_max_bps: u16,
    pub grip_min_bps: u16,
    pub max_payout_per_round: [u64; NUM_MINTS],
    pub restock_threshold: u8,
    pub mints: [Pubkey; NUM_MINTS],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct CapsuleSpec {
    pub x: i32,
    pub z: i32,
    pub radius: u16,
    pub kind: u8,
    pub mint_idx: u8,
    pub amount: u64,
    /// Mystery only: tier label 1 = dust, 2 = mid, 3 = jackpot.
    pub tier: u8,
}

// ───────────────────────── init_cabinet (L1) ─────────────────────────

pub fn init_cabinet(ctx: Context<InitCabinet>, cabinet_id: u8, p: CabinetParams) -> Result<()> {
    require!(p.turn_secs >= 5 && p.turn_secs <= 120, ClawError::InvalidParams);
    require!(p.grip_max_bps as u64 <= BPS && p.grip_min_bps <= p.grip_max_bps, ClawError::InvalidParams);
    require!(p.play_price > 0, ClawError::InvalidParams);
    let cfg = &mut ctx.accounts.config;
    cfg.authority = ctx.accounts.authority.key();
    cfg.cabinet_id = cabinet_id;
    cfg.bump = ctx.bumps.config;
    cfg.vault_bump = ctx.bumps.vault;
    cfg.validator = p.validator;
    cfg.play_price = p.play_price;
    cfg.turn_secs = p.turn_secs;
    cfg.grip_max_bps = p.grip_max_bps;
    cfg.grip_min_bps = p.grip_min_bps;
    cfg.max_payout_per_round = p.max_payout_per_round;
    cfg.restock_threshold = p.restock_threshold;
    cfg.mints = p.mints;
    cfg.total_claimed = [0; NUM_MINTS];

    let cab = &mut ctx.accounts.cabinet;
    cab.cabinet_id = cabinet_id;
    cab.bump = ctx.bumps.cabinet;
    cab.claw_x = CLAW_HOME_X;
    cab.claw_z = CLAW_HOME_Z;
    cab.drop_capsule = NO_CAPSULE;

    let m = &mut ctx.accounts.mystery;
    m.cabinet_id = cabinet_id;
    m.bump = ctx.bumps.mystery;

    // Pre-fund the mystery PDA so it can pay its own EphemeralPermission rent on the ER.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.mystery.to_account_info(),
            },
        ),
        ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32) * 2,
    )?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(cabinet_id: u8)]
pub struct InitCabinet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + CabinetConfig::INIT_SPACE, seeds = [SEED_CONFIG, &[cabinet_id]], bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(init, payer = authority, space = 8 + CabinetState::INIT_SPACE, seeds = [SEED_CABINET, &[cabinet_id]], bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    #[account(init, payer = authority, space = 8 + MysteryVault::INIT_SPACE, seeds = [SEED_MYSTERY, &[cabinet_id]], bump)]
    pub mystery: Box<Account<'info, MysteryVault>>,
    /// CHECK: vault authority PDA (owns the prize token accounts); holds no data.
    #[account(seeds = [SEED_VAULT, &[cabinet_id]], bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ───────────────────────── delegate_cabinet (L1) ─────────────────────────

pub fn delegate_cabinet(ctx: Context<DelegateCabinet>) -> Result<()> {
    let id = ctx.accounts.config.cabinet_id;
    let validator = Some(ctx.accounts.config.validator);
    ctx.accounts.delegate_cabinet(
        &ctx.accounts.authority,
        &[SEED_CABINET, &[id]],
        DelegateConfig { validator, ..Default::default() },
    )?;
    ctx.accounts.delegate_mystery(
        &ctx.accounts.authority,
        &[SEED_MYSTERY, &[id]],
        DelegateConfig { validator, ..Default::default() },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateCabinet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    /// CHECK: cabinet state PDA, delegated to the ER
    #[account(mut, del, seeds = [SEED_CABINET, &[config.cabinet_id]], bump)]
    pub cabinet: UncheckedAccount<'info>,
    /// CHECK: mystery vault PDA, delegated to the ER (made private there by seal_mystery)
    #[account(mut, del, seeds = [SEED_MYSTERY, &[config.cabinet_id]], bump)]
    pub mystery: UncheckedAccount<'info>,
}

// ───────────────────────── seal_mystery (ER) ─────────────────────────
/// Creates a private EphemeralPermission with no members on the mystery vault.
/// From here on the TEE RPC refuses to return its data to anyone.
pub fn seal_mystery(ctx: Context<SealMystery>) -> Result<()> {
    if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID && !ctx.accounts.permission.data_is_empty() {
        ctx.accounts.mystery.sealed = true;
        return Ok(());
    }
    let id = ctx.accounts.config.cabinet_id;
    let bump = ctx.accounts.mystery.bump;
    let seeds: &[&[u8]] = &[SEED_MYSTERY, &[id], &[bump]];
    CreateEphemeralPermissionCpi {
        payer: ctx.accounts.mystery.to_account_info(),
        permissioned_account: ctx.accounts.mystery.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        args: EphemeralMembersArgs { is_private: true, members: vec![] },
    }
    .invoke_signed(&[seeds])?;
    ctx.accounts.mystery.sealed = true;
    Ok(())
}

#[derive(Accounts)]
pub struct SealMystery<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_MYSTERY, &[config.cabinet_id]], bump = mystery.bump)]
    pub mystery: Box<Account<'info, MysteryVault>>,
    /// CHECK: derived under the Permission Program
    #[account(mut, seeds = [PERMISSION_SEED, mystery.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: address-checked
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: address-checked
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: address-checked
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

// ───────────────────────── restock (ER) ─────────────────────────
/// Place capsules into free slots. Mystery contents go straight into the private vault.
/// Fails unless, for every mint: vault + claimed >= won + liability(all live prizes).
pub fn restock(mut ctx: Context<Restock>, specs: Vec<CapsuleSpec>) -> Result<()> {
    let a = &mut ctx.accounts;
    let vaults = [a.vault0.amount, a.vault1.amount, a.vault2.amount, a.vault3.amount];
    restock_core(&a.config, &mut a.cabinet, &mut a.mystery, vaults, specs)
}

pub fn restock_by_keeper(mut ctx: Context<RestockByKeeper>, specs: Vec<CapsuleSpec>) -> Result<()> {
    let a = &mut ctx.accounts;
    let vaults = [a.vault0.amount, a.vault1.amount, a.vault2.amount, a.vault3.amount];
    restock_core(&a.config, &mut a.cabinet, &mut a.mystery, vaults, specs)
}

pub fn set_keeper(ctx: Context<SetKeeper>, keeper: Pubkey) -> Result<()> {
    let r = &mut ctx.accounts.keeper_role;
    r.cabinet_id = ctx.accounts.config.cabinet_id;
    r.bump = ctx.bumps.keeper_role;
    r.keeper = keeper;
    emit!(KeeperSet { cabinet_id: r.cabinet_id, keeper });
    Ok(())
}

fn restock_core(
    cfg: &CabinetConfig,
    cab: &mut CabinetState,
    mys: &mut MysteryVault,
    vault_amounts: [u64; NUM_MINTS],
    specs: Vec<CapsuleSpec>,
) -> Result<()> {
    require!(mys.sealed, ClawError::NotSealed);
    require!(!specs.is_empty(), ClawError::InvalidCapsule);
    for s in specs.iter() {
        require!(s.x >= 0 && s.x <= GRID && s.z >= 0 && s.z <= GRID, ClawError::InvalidCapsule);
        require!(s.radius >= MIN_RADIUS && s.radius <= MAX_RADIUS, ClawError::InvalidCapsule);
        require!(s.kind <= KIND_MYSTERY, ClawError::InvalidCapsule);
        require!((s.mint_idx as usize) < NUM_MINTS && s.amount > 0, ClawError::InvalidCapsule);
        require!(s.amount <= cfg.max_payout_per_round[s.mint_idx as usize], ClawError::PayoutTooLarge);
        let slot = cab.capsules.iter().position(|c| !c.active).ok_or(ClawError::NoFreeSlot)?;
        let id = cab.next_capsule_id;
        cab.next_capsule_id = cab.next_capsule_id.wrapping_add(1);
        let mystery = s.kind == KIND_MYSTERY;
        cab.capsules[slot] = Capsule {
            id,
            x: s.x,
            z: s.z,
            radius: s.radius,
            active: true,
            kind: s.kind,
            mint_idx: if mystery { 0 } else { s.mint_idx },
            amount: if mystery { 0 } else { s.amount },
            slip_count: 0,
        };
        mys.entries[slot] = if mystery {
            MysteryEntry { set: true, mint_idx: s.mint_idx, amount: s.amount, tier: s.tier }
        } else {
            MysteryEntry::default()
        };
    }
    // Solvency over every live prize, per mint.
    for m in 0..NUM_MINTS {
        let mut liability: u64 = 0;
        for (i, c) in cab.capsules.iter().enumerate() {
            if !c.active {
                continue;
            }
            let (mi, amt) = if c.kind == KIND_MYSTERY {
                (mys.entries[i].mint_idx, mys.entries[i].amount)
            } else {
                (c.mint_idx, c.amount)
            };
            if mi as usize == m {
                liability = liability.checked_add(amt).ok_or(ClawError::Overflow)?;
            }
        }
        require!(
            math::is_solvent(vault_amounts[m], cfg.total_claimed[m], cab.total_won[m], liability),
            ClawError::VaultInsolvent
        );
    }
    emit!(CabinetRestocked { added: specs.len() as u8, active: cab.active_count() as u8 });
    Ok(())
}

#[derive(Accounts)]
pub struct Restock<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    #[account(mut, seeds = [SEED_MYSTERY, &[config.cabinet_id]], bump = mystery.bump)]
    pub mystery: Box<Account<'info, MysteryVault>>,
    /// CHECK: vault authority PDA
    #[account(seeds = [SEED_VAULT, &[config.cabinet_id]], bump = config.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(token::mint = config.mints[0], token::authority = vault)]
    pub vault0: Box<Account<'info, TokenAccount>>,
    #[account(token::mint = config.mints[1], token::authority = vault)]
    pub vault1: Box<Account<'info, TokenAccount>>,
    #[account(token::mint = config.mints[2], token::authority = vault)]
    pub vault2: Box<Account<'info, TokenAccount>>,
    #[account(token::mint = config.mints[3], token::authority = vault)]
    pub vault3: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct RestockByKeeper<'info> {
    pub keeper: Signer<'info>,
    #[account(seeds = [SEED_KEEPER, &[config.cabinet_id]], bump = keeper_role.bump, constraint = keeper_role.keeper == keeper.key() @ ClawError::Unauthorized)]
    pub keeper_role: Box<Account<'info, KeeperRole>>,
    #[account(seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    #[account(mut, seeds = [SEED_MYSTERY, &[config.cabinet_id]], bump = mystery.bump)]
    pub mystery: Box<Account<'info, MysteryVault>>,
    /// CHECK: vault authority PDA
    #[account(seeds = [SEED_VAULT, &[config.cabinet_id]], bump = config.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(token::mint = config.mints[0], token::authority = vault)]
    pub vault0: Box<Account<'info, TokenAccount>>,
    #[account(token::mint = config.mints[1], token::authority = vault)]
    pub vault1: Box<Account<'info, TokenAccount>>,
    #[account(token::mint = config.mints[2], token::authority = vault)]
    pub vault2: Box<Account<'info, TokenAccount>>,
    #[account(token::mint = config.mints[3], token::authority = vault)]
    pub vault3: Box<Account<'info, TokenAccount>>,
}

#[derive(Accounts)]
pub struct SetKeeper<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(init_if_needed, payer = authority, space = 8 + KeeperRole::INIT_SPACE, seeds = [SEED_KEEPER, &[config.cabinet_id]], bump)]
    pub keeper_role: Box<Account<'info, KeeperRole>>,
    pub system_program: Program<'info, System>,
}

// ───────────────────────── admin_undelegate (ER) ─────────────────────────
/// Recovery path: close the mystery permission and return cabinet + mystery to L1.
pub fn admin_undelegate(ctx: Context<AdminUndelegate>) -> Result<()> {
    let id = ctx.accounts.config.cabinet_id;
    if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID && !ctx.accounts.permission.data_is_empty() {
        let bump = ctx.accounts.mystery.bump;
        let seeds: &[&[u8]] = &[SEED_MYSTERY, &[id], &[bump]];
        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.mystery.to_account_info(),
            permissioned_account: ctx.accounts.mystery.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.mystery.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[seeds])?;
    }
    ctx.accounts.mystery.sealed = false;
    ctx.accounts.mystery.exit(&crate::ID)?;
    ctx.accounts.cabinet.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.cabinet.to_account_info(), ctx.accounts.mystery.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

#[commit]
#[derive(Accounts)]
pub struct AdminUndelegate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority, seeds = [SEED_CONFIG, &[config.cabinet_id]], bump = config.bump)]
    pub config: Box<Account<'info, CabinetConfig>>,
    #[account(mut, seeds = [SEED_CABINET, &[config.cabinet_id]], bump = cabinet.bump)]
    pub cabinet: Box<Account<'info, CabinetState>>,
    #[account(mut, seeds = [SEED_MYSTERY, &[config.cabinet_id]], bump = mystery.bump)]
    pub mystery: Box<Account<'info, MysteryVault>>,
    /// CHECK: derived under the Permission Program
    #[account(mut, seeds = [PERMISSION_SEED, mystery.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: address-checked
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: address-checked
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
}
