# Engineering decision log

Newest entries at the bottom. Each entry: what was decided, why, and what it costs.

## Toolchain (pinned)

| Tool | Version | Note |
|---|---|---|
| anchor-cli | 1.2.1 | |
| anchor-lang / anchor-spl | =1.0.2 | Every `anchor-*` sub-crate pinned to 1.0.2 in `Cargo.lock` (`cargo update -p <crate> --precise 1.0.2`). The macro crates otherwise resolve to 1.2.x and fail with `create_account_allow_prefund` not found. |
| ephemeral-rollups-sdk (Rust + npm) | 0.18.0 | Features `anchor, vrf, access-control`. 0.20's `#[vrf]` macro did not compile with anchor 1.0.2. |
| @coral-xyz/anchor (TS) | 0.32.1 | Reads the Anchor 1.x IDL fine. Explicit `accountsPartial` everywhere (the TS resolver can't derive the seeds that use instruction args). |
| solana-cli / cargo-build-sbf | 4.0.2 / 4.0.0 | |
| rustc / node | 1.93.0 / 22.22.2 | |
| Next.js | 15.5.29 | Static export (`output: "export"`) for Cloudflare Pages. |

## Decisions

1. **Validator = MagicBlock TEE devnet (`MTEWGuqx…`, `https://devnet-tee.magicblock.app`).** The private mystery vault needs the TEE validator, and running everything on one validator keeps one ER connection. Cost: every *sending* client needs a TEE auth token (`getAuthToken`, a signed challenge). Session keys sign it locally, so play still has no popups; the wallet signs one login message only when it cashes out. Validator + endpoint are a single config switch (`ER_URL` / `ER_VALIDATOR`, `config.validator` on chain).

2. **Spike first.** A throwaway program (`scripts/spike.ts`, now replaced) proved on devnet TEE: unfunded keypair as ER fee payer and VRF payer, ER clock ≈ wall clock, VRF callback ≈ 0.6 s, `commit_and_undelegate` + `GetCommitmentSignature`.

3. **SDK `#[vrf_callback]` workaround.** The macro's injected identity check evaluates `scoped_vrf_identity_const` (software SHA-256) at runtime inside the constraint and burned the callback's entire compute budget (`ProgramFailedToComplete`, 272k CU). The program declares `vrf_program_identity` itself with a compile-time `const VRF_IDENTITY`. Callbacks now land in ~100–300 ms.

4. **Settlement = pending balance in the player profile + L1 `claim_prize`**, instead of a per-round `PrizeClaim` PDA from the architecture doc. The profile is delegated while playing; `cash_out` (wallet-signed, ER) commits and undelegates it, then `claim_prize` (L1) pays from the vault ATA and zeroes `pending` (exactly-once). Why: `commit_and_undelegate` is exempt from the 10-commits-per-delegation cap, accounts created on the ER never commit, and one profile covers many rounds. Cost: prizes reach the wallet when the player cashes out, not after every round.

5. **Our own scoped session key, not MagicBlock Session Keys.** `register_session_key` (wallet-signed, L1, ≤ 24 h) stores one key in the profile. `authorize()` accepts it only in `join_queue`, `move_claw`, `drop_claw`. Every other instruction derives the profile from the signing wallet, so a session key can't satisfy those contexts. We don't call this "MagicBlock Session Keys".

6. **Mystery privacy = Private ER permission with zero members.** `seal_mystery` creates a private `EphemeralPermission` on the mystery vault. Checked on devnet (`scripts/check_privacy.ts`): `getAccountInfo` returns `null` with no token, a stranger's token and even the authority's token. The program reads it inside the TEE. Contents are drawn with crypto randomness at restock time and never written to disk or the repo.

7. **VRF nonce + timeout.** Each drop bumps `vrf_nonce`; the callback must echo it and `pending_vrf` must be set, so a late or duplicate callback is rejected. `expire_turn` after 30 s of pending VRF cancels the drop and refunds the credit.

8. **`move_claw(dx, dz, seq)`.** The `seq` arg makes repeated identical moves distinct transactions (otherwise same-blockhash duplicates are dropped).

9. **Economics: visible prizes ≤ ~1 play, jackpots only in mystery capsules.** A perfect bot always picks the best visible capsule, so visible values cap its return. Mystery EV ≈ 1.0 play. Result (100k turns): beginner 33% < skilled 78% < perfect bot 86% (house edge 14%), vault never under its live liability. See `scripts/ev_results.md`.

10. **Bug found and fixed: profiles were global.** The first deployed build seeded `PlayerProfile` with `["player", wallet]`. With two cabinets, a prize won on cabinet 1 could be claimed from cabinet 2's vault. Fixed by seeding `["player", cabinet_id, wallet]` and checking `profile.cabinet_id` against the cabinet everywhere. The first 34 devnet rounds ran on the pre-fix build (layout differs only in that field).

11. **Keeper process.** Restock writes the private vault, so only the authority can do it. `scripts/keeper.ts` restocks below 6 capsules and clears expired turns (`expire_turn` is permissionless, the app also calls it). It is a local process, not a hosted service.

12. **Burner wallet is opt-in and labelled.** It never replaces a connected wallet. The key lives in `localStorage` only and is never displayed. The Playwright test injects a pre-funded key from `./keys` (git-ignored) before page load.

13. **`admin_undelegate` is a recovery path.** It closes the mystery permission and commits the vault to L1, which makes unrevealed mystery contents public. Only for emergencies; restock new contents afterwards.

14. **Restock transaction contents are hidden too (checked with a control).** `scripts/check_tx_privacy.ts` calls `getTransaction` raw (base64, no web3.js parsing) with no token, a stranger's token and the authority's token. Control: a `join_queue` tx returns the full 277-byte transaction and 6 log lines to everyone. Restock tx `3712N5V4…`: the TEE returns a stub with 0 account keys, 0 instructions, 0 logs, empty balances and 0 CU for all three callers. `getBlock` on its slot returns `Access denied`. So the mystery prize specs in the restock args are not recoverable from the ER RPC. Public game txs stay inspectable for the proof drawer.

15. **Hosting = Cloudflare Workers static assets, not a Pages project.** `wrangler pages project create` now delegates to "the latest version of Cloudflare Pages, now part of Cloudflare Workers". The static export (`app/out`) is served by the Worker `clawrush` (`app/wrangler.jsonc`) at https://clawrush.adoranto737.workers.dev. Free plan, no server code. Wrangler needed `NODE_OPTIONS=--dns-result-order=ipv4first` on this machine (Node fetch timed out over IPv6).
