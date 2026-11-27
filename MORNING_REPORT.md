# Morning report: ClawRush

Everything below was done on **Solana devnet** and the **MagicBlock devnet TEE validator**. No mainnet, no money
spent, nothing submitted. Every link and number comes from a real run; anything not done is marked ❌ or ⚠️.

## Links

| | |
|---|---|
| Live app | https://clawrush.pages.dev (Cloudflare Pages project `clawrush`; the same build is also on a Worker at the account's workers.dev subdomain) |
| Repo | https://github.com/LSUDOKO/ClawRush (branch `main`) |
| Program | `9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs` ([explorer](https://explorer.solana.com/address/9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs?cluster=devnet)) |
| Cabinet (live) | config `CLaFhSGw…`, state `EUK77P9z…` delegated to TEE validator `MTEWGuqx…` |
| Proof table | README → "On-chain proof (devnet)" |

## Status

| Area | Status | Evidence |
|---|---|---|
| Anchor program (queue, turns, moves, drop, VRF grip, slip/miss, mystery, cash out, claim) | ✅ deployed | `programs/clawrush`, latest deploy `MhDJFzv8…` |
| Integer grip math + unit tests | ✅ | 15 Rust tests; TS port matches the vectors |
| Ephemeral Rollup (shared live cabinet) | ✅ | every round runs on the TEE ER; browser move confirm ~380–780 ms |
| MagicBlock VRF | ✅ | median callback 205 ms over 30 rounds |
| Private ER (sealed mystery capsules) | ✅ | vault unreadable with no / stranger / authority token; restock + drop txs redacted, control tx readable; public cabinet shows mystery capsules as mint 0 / amount 0 (decoded live) |
| Commit + undelegate → L1 payout | ✅ | `cash_out` + `claim_prize` in every settlement; exactly-once tested |
| Security invariants (7) | ✅ 23/23 | `docs/INVARIANTS.md` (real devnet txs, test cabinet 2) |
| Shared queue, 2 players | ✅ 8/8 | `docs/E2E_TWO_PLAYER.md` |
| 30+ real rounds | ✅ | current build: 34 attempts, 30 completed, 4 failures recorded (`docs/DEVNET_ROUNDS.md`); earlier build 34/34 (`docs/DEVNET_ROUNDS.v1.md`) |
| EV / solvency simulation | ✅ | beginner 33% < skilled 78% < perfect bot 86%; vault never under liability (`scripts/ev_results.md`) |
| Mobile web app | ✅ | Next.js static export; lint + build pass; screenshots 390×844 and 375×812 in `app/e2e/shots/` |
| Real rounds on the deployed URL | ✅ | Playwright, 390×844, devnet burner, on both URLs: session → join → drop (MISS) → second join left to time out (app clears its own expired turn in 16.1 s, keeper stopped) → cash out; links in `app/e2e/shots/proof-links.txt` |
| Phantom / Solflare / Mobile Wallet Adapter path | ⚠️ built, not tested | only the burner path was driven in a browser; needs a real wallet on a phone |
| VRF callback as a public explorer link | ⚠️ | callbacks (and drops) touch the sealed vault, so the TEE redacts them; outcome is public in cabinet state + proof drawer |
| Hosting | ✅ | Pages project `clawrush` at https://clawrush.pages.dev (needed `--force`: wrangler now routes new Pages projects to Workers by default; decision 15) |
| Demo video | ❌ | needs you (script in `docs/07-SUBMISSION.md`) |
| Submission | ❌ by design | prepared in `docs/07-SUBMISSION.md`; needs your Telegram login |

## Tests run (latest)

Local (run by the test-runner subagent, no devnet txs):
- ✅ `cargo test -p clawrush --lib`: 15 passed, 0 failed
- ✅ `npx tsx scripts/lib/math.test.ts`: TS port matches every `math.rs` vector
- ✅ `cd app && npm run lint`: no errors
- ✅ `cd app && npm run build`: static export OK
- ⏭ root `tsc --noEmit`: skipped, no root tsconfig (scripts run with tsx)

Devnet (real transactions):
- ✅ `CABINET_ID=2 npx tsx tests/invariants.ts`: 23/23
- ✅ `npx tsx scripts/e2e_two_player.ts`: 8/8
- ✅ `scripts/devnet_rounds.ts`: 30 completed / 34 attempts, failures recorded
- ✅ `app/e2e/round.mjs` against https://clawrush.pages.dev and the Worker URL: round + deliberate timeout + cash out

## Key decisions (full log: `docs/DECISIONS.md`)

- TEE validator for everything, so the mystery vault can be private and play stays on one ER.
- Own scoped session key (join / move / drop only), not MagicBlock Session Keys.
- Prizes accumulate in the profile; `cash_out` commits it to L1, `claim_prize` pays exactly once.
- Visible prizes capped near one play; jackpots only in mystery capsules whose contents are drawn at restock and never written to disk.
- Found and fixed a real bug: profiles were global, so a cabinet-1 prize could be claimed from cabinet 2's vault. Profiles are now per cabinet (regression test included).
- Bypassed SDK `#[vrf_callback]` macro: its runtime identity hash burned the callback's compute budget.
- Final review found app dead ends (own expired turn waited for the keeper, failed drop froze controls, slow-link animation race, stale-state `init_player`). All fixed and re-tested on the live URL (decision 18).

## Blockers / caveats

- My network link to the TEE was slow at times (1.7–10 s per RPC). That caused the 3 `TurnExpired` round failures and needed `NODE_OPTIONS=--dns-result-order=ipv4first` for Node (wrangler too).
- The keeper (`scripts/keeper.ts`, restock + clear expired turns) was started as a background process of this agent session, so it stops when the session ends. Without it the cabinet stops restocking (12 capsule slots; currently 11 stocked). Turns still clear without it: the app sends `expire_turn` itself.
- `admin_undelegate` is an emergency path that would make unrevealed mystery contents public (decision 13).

## What you need to do

1. **Keep the cabinet stocked:** keep `npx tsx scripts/keeper.ts` running (or run `npx tsx scripts/restock.ts` before a demo). Use `NODE_OPTIONS=--dns-result-order=ipv4first` if Node times out.
2. **Test with a real wallet on a phone:** Phantom or Solflare set to devnet, open the live URL in the wallet's browser, play one round, cash out.
3. **Record the demo video** (script in `docs/07-SUBMISSION.md`), upload unlisted, paste the link into README ("Demo video") and the form.
4. **Fill X account + Telegram handles**, then **submit** at https://build.magicblock.app/?stage=blitz#submit with your Telegram login.
5. Optional: top up devnet SOL for the authority (`5XPdQGRr…`) if restocks fail for fees.
6. Visitors with a real wallet need a little devnet SOL for fees (https://faucet.solana.com). The public airdrop is often rate-limited; the in-app burner option avoids this for demos.
7. Optional: delete the duplicate Worker `clawrush` (same build, at your workers.dev subdomain) from the Cloudflare dashboard if you only want the Pages URL.

Secrets: all keypairs stay in `./keys` and `~/.config/solana` (git-ignored, never committed; staged files were scanned before every commit).
