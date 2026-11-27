# Roadmap

Status as of v1.0.0 (2026-11-27, MagicBlock Solana Blitz v10 submission). Everything shipped runs on devnet. The
items below are not built yet. They are ordered by what blocks real use first.

## Next (weeks)

- **Solflare mobile cash-out.** Solflare refuses to sign the ER cash-out transaction because it carries an ER
  blockhash ("network mismatch"). Plan: the wallet signs a message instead, the program verifies it, and the session
  key or a relayer sends the ER transaction. Then test Phantom and MWA on real phones (only the burner and Solflare
  play were tested on Android, and iOS Safari not at all).
- **Restock from the crank.** Restock writes the private vault, so today it needs the authority or the keeper key.
  Plan: seal mystery contents with a program-held secret so a scheduled task can restock.
- **Hosted keeper on by default.** The workflow exists (`.github/workflows/keeper.yml`). It needs the
  `KEEPER_KEYPAIR` secret and a monitored SOL balance for fees.
- **Close the old paths.** `drop_claw` (redacted tx) and plain `cash_out` are kept for old clients; the app uses
  `drop_claw_public` and `cash_out_and_settle`. Remove them after a migration window, and keep `claim_prize` as the
  fallback if a Magic Action fails.
- **Fix the open review findings** ([SECURITY.md](SECURITY.md#7-findings)): pin the VRF queue (F-01), pin vault
  token accounts to the ATAs (F-04), remove the roll modulo bias (F-09), and add security headers to the static
  site (F-10).

## Later (months)

- **Collectibles as real 1-of-1 NFTs** (Metaplex Core) minted on win, next to the fungible prize tokens. Today
  KOI / ROBO are 0-decimal `FungibleAsset` tokens.
- **More cabinets** with different prize pools and stakes, and a lobby to pick one.
- **Operator model.** Per-cabinet operators and a fee split, with on-chain payout caps and solvency still enforced
  (see [BUSINESS.md](BUSINESS.md)).
- **Public odds page** built from `GripResolved` / `CapsuleWon` events.

## Before any mainnet use

- External audit of the program, especially the Magic Action escrow checks, the session-key scope and `restock_core`.
- Split the cabinet authority from the program upgrade key (today they are one key); multisig for upgrades.
- Retire or gate `admin_undelegate`, which makes unrevealed mystery contents public (decision 13).
- Legal review of paid plays for prizes in each target market.

Known limitations of the current build: [README.md](README.md#play), [SECURITY.md](SECURITY.md),
[docs/DECISIONS.md](docs/DECISIONS.md).
