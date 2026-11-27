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

15. **Hosting = Cloudflare Pages project `clawrush` (https://clawrush.pages.dev).** `wrangler pages project create` now delegates to Workers by default ("the latest version of Cloudflare Pages, now part of Cloudflare Workers"); the first deploy went to a Worker `clawrush` with static assets (`app/wrangler.jsonc`, still live at the account's workers.dev subdomain). The task asked for a Pages project, and a pages.dev URL keeps the account subdomain out of the README, so the project was then created with `--force` (classic Pages) and `app/out` deployed with `wrangler pages deploy`. Free plan, static only. Wrangler needs `NODE_OPTIONS=--dns-result-order=ipv4first` on this machine (Node fetch timed out over IPv6).

16. **Rounds re-run on the current build, failures kept.** The earlier 34 rounds (old profile seeds) are archived in `docs/DEVNET_ROUNDS.v1.md`. On the current build: 34 attempts, 30 completed, 4 failed and recorded as-is. 3 were `TurnExpired`: this machine's link to the TEE was slow that hour (1.7–10 s per RPC), so the moves plus the drop sometimes landed after the 15 s turn. 1 was a script crash: a move promise rejected (TEE connect timeout) before `Promise.all` attached, so the process died mid-round; fixed in `moveTo` and the round script now logs stray background RPC rejections instead of dying. The app is less exposed to this: moves are fire-and-forget with client prediction and the drop is one transaction.

17. **Public vs redacted ER transactions.** Explorer links with the TEE `customUrl` work (TEE sends `access-control-allow-origin: *`). `join_queue`, `move_claw`, `expire_turn`, `cash_out` are fully readable. `drop_claw` lists the sealed vault (for the callback account metas) and comes back redacted; callbacks write it and never appear readable. Kept as is to avoid a redeploy after the test runs; the fix (derive the vault address in `drop_claw` instead of passing the account) is listed under What's next.

18. **App recovers from its own dead ends (found in review, fixed, tested on the deployed URL).** (a) Any client with a session key now sends the permissionless `expire_turn` once a turn is past its 15 s (or a VRF is stuck past 30 s), including the player's own timed-out turn; before, an idle player's own expired turn waited for the keeper. (b) A failed drop resets the claw animation instead of leaving controls disabled. (c) If the VRF result lands before the drop confirmation (slow link), the result animation is no longer overwritten. (d) Session start reads profile + balance fresh, so a click before the first poll can't send `init_player` for an existing profile (that was a real failure seen in the e2e). The Playwright run now plays a round, then idles through a second turn with the keeper stopped and checks the app clears it (16.1 s) and offers INSERT CREDIT again.

19. **Public cabinet state does not leak mystery contents.** Decoded live: every `kind = 2` capsule in the public cabinet has `mint_idx = 0, amount = 0`; contents exist only in the sealed vault until revealed by a win.

20. **"Monster Arcade" visual redesign (presentation only).** New title screen, how-to-play, buy-credits, game HUD, gold cabinet frame, result splash and restyled proof drawer; fonts Luckiest Guy + Nunito. Art is AI-generated and original (no characters from the reference games): 18 images via the AHOLO multimodal image API and 2 via a free Hugging Face Space (Qwen-Image), backgrounds removed locally with rembg, shipped as WebP in `app/public/art/` (~0.5 MB). Program, `chain.ts` and game logic are unchanged. Capsule and claw sprites are drawn at the same projected point and on-chain radius as before, so the art does not change aim; amount/token labels stay, mystery capsules show only "?". Re-verified with the Playwright devnet round on a Pages preview before promoting to production.

21. **Real-time 3D cabinet, grip meter, fairness re-check (presentation only, no program change).** At the user's request the cabinet moved from the 2D canvas to three.js (lazy-loaded, ~150 KB gz, 2D canvas kept as the WebGL fallback). World coordinates are the on-chain grid divided by 100, capsule spheres use the on-chain radius, the chute ring uses `CHUTE_KEEP_OUT`, so the picture matches what `drop_claw` measures. Cameras are fixed (front and side, no orbit) so the two-view depth mechanic and onboarding text stay true. Added: a predicted-grip meter using the ported integer math and the grip curve read from the on-chain `CabinetConfig`; a ✓ re-check in the proof drawer that recomputes each drop's outcome from the on-chain record; a recent-winners board from `recent_wins`. MagicBlock cranks for turn expiry / restock were considered and left out: they need a program redeploy, which would invalidate the tested build (invariants, 30+ rounds) and risk the live delegated cabinet on deadline day. New AI art (AHOLO image API): logo, app icon, mascot blink and wave poses, alternate slime and bat frames. Re-verified with the Playwright devnet round (headless Chrome with SwiftShader WebGL).

22. **Second program upgrade: crank + Magic Action (additive only).** On the user's request for deeper MagicBlock use, the program was upgraded in place (same id, same account layouts, no existing instruction's accounts or arguments changed). New: `crank_tick` + `schedule_crank` (ER scheduler `ScheduleTask`, SDK 0.18 `crank` feature; task id derived from the cabinet address) and `cash_out_and_settle` + `settle_prizes` (`#[action]`). Findings from devnet: a post-*commit* action runs before undelegation, while the profile is still owned by the delegation program, so the payout must be a post-*undelegate* action (`add_post_undelegate_actions`); the delegation program passes `source_program` before `escrow_auth`/`escrow`. The handler requires the escrow PDA as signer (only the delegation program can sign it), binds `escrow_auth` to the profile owner, and zeroes `pending` as it pays, so `claim_prize` afterwards returns `NothingToClaim`. A cabinet-only crank tick cannot clear the profile's `in_queue` flag, so `join_queue` and `cash_out_and_settle` trust the cabinet (turn owner or queue membership) instead of the flag. The VRF-timeout refund stays in `expire_turn`, because it needs the profile. The old `cash_out` still checks the raw flag; the app no longer calls it.

