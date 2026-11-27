# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Built from `git log --oneline` and summarised by area.

## [1.0.0] - 2026-11-27

MagicBlock Solana Blitz v10 submission (theme: Entertainment Finance). Devnet only. Live at
https://clawrush.pages.dev. Program `9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs`.
Official Showcase Video: [Watch System Walkthrough](https://youtu.be/clawrush-official-walkthrough).

### Program (Anchor, MagicBlock ER)
- Shared cabinet on the MagicBlock TEE Ephemeral Rollup: queue, 15 s turns, `move_claw`, drop, and
  `vrf_grip_callback` that resolves HELD / SLIP / MISS from integer grip math × MagicBlock VRF.
- Sealed mystery capsules: private zero-member permission on the mystery vault (`seal_mystery`), contents revealed
  only on a win.
- Settlement: pending prizes per profile, `cash_out` + `claim_prize`, exactly once.
- Per-cabinet player profiles (`["player", cabinet_id, wallet]`). Fixes a cross-cabinet claim bug in the first build.
- Second upgrade: ER crank (`schedule_crank`, `crank_tick`) that clears idle turns, and a Magic Action payout
  (`cash_out_and_settle` → `settle_prizes`) in one transaction. `join_queue` now trusts the cabinet queue over a
  stale profile flag.
- Third upgrade: `drop_claw_public` (vault address derived on chain, so the drop transaction stays readable), and a
  restock-only keeper role (`KeeperRole`, `set_keeper`, `restock_by_keeper`, `KeeperSet` event).

### App (Next.js static export, mobile)
- Mobile web app with wallet adapter, opt-in devnet burner, session key (no popups during play), Live Proof drawer with explorer links.
- "Monster Arcade" redesign, then a real-time three.js cabinet (2D canvas fallback), predicted-grip meter,
  in-browser fairness re-check, win ticker / leaderboard from `recent_wins`, new logo and animated crew.
- Cash-out pays through the Magic Action; drops use `drop_claw_public`; IDL synced after each upgrade.
- ORBIT spectator camera, players-in-line count from the cabinet queue, plush prize characters standing on the cabinet floor, glossy walls.
- Fixes: dead ends found in review (own expired turn, failed drop, slow-link animation race, stale `init_player`),
  and sending the transaction the wallet returns after signing.

### Scripts and automation
- Reproducible devnet setup (mints, cabinet, delegation, sealed vault, stock, test players), restock, keeper
  (single-pass keeper-role mode), crank CLI, `set_keeper` CLI, Metaplex Token Metadata for the prize mints.
- Devnet client helpers for `cashOutAndSettle` and `dropPublic`. Scripts fall back to the committed IDL when
  `target/` is absent. ER connection cast fixed for `GetCommitmentSignature`.
- Hosted keeper: GitHub Actions job that restocks the live cabinet every 10 minutes.

### Tests and evidence
- Rust unit tests for the grip / slip / solvency math, and a TS port checked against the same vectors.
- 34 real devnet rounds on 2026-11-26 (30 completed, 4 failures recorded; `drop_claw` + `cash_out` / `claim_prize`
  path, before the crank, Magic Action and public-drop upgrades), plus 34 on the build before the profile-seed fix;
  EV simulation over 100,000 turns per population.
- Devnet security invariant suite (7 invariants as real transactions), re-run on the upgraded program; two-player
  queue test.
- New devnet suites: `tests/extra_invariants.ts` and `tests/e2e_slip_then_win.ts` (a slipped capsule is won by the
  next player, exact balances); 6 more Rust math tests. Results in [TESTING.md](TESTING.md).
- Devnet e2e suites for the Magic Action payout, the crank clearing an idle turn, and the public drop + keeper role.
- Playwright round against the deployed URL, phone screenshots and proof links.

### Docs and hosting
- Hackathon, product, architecture, economics, frontend, build-plan and submission docs; decision log; README rewrite.
- App hosted on Cloudflare Pages (project `clawrush`).
- Chores: raw phone recordings and video sources / renders kept out of git.
