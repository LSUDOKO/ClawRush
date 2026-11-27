# Submission report: ClawRush (MagicBlock Solana Blitz v10)

Everything below ran on **Solana devnet** and the **MagicBlock devnet TEE validator** on 2026-11-27. No mainnet,
no money spent, nothing submitted for you. Every link and number comes from a real run; anything not done is
marked ❌ or ⚠️.

## Links

| | |
|---|---|
| Live app | https://clawrush.pages.dev (Cloudflare Pages, static Next.js export; sends anti-framing / nosniff headers) |
| Repo | https://github.com/LSUDOKO/ClawRush (`main`; CI: Rust math tests, TS math port, app lint + build) |
| Release | `v1.0.0` tag on `main` (see CHANGELOG.md) |
| Program | `9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs` ([explorer](https://explorer.solana.com/address/9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs?cluster=devnet)); latest upgrade [2vHp9HK6…](https://explorer.solana.com/tx/2vHp9HK6hrro5BADAoqqfBeKJdhg49sh2qPKMffqM2vuoNwBES11u9ybghdgsNk1FCgqDr6G9LtihPjnJ2RiMhTU?cluster=devnet) |
| Evidence for judges | [JUDGES.md](JUDGES.md) (claims → code → command → transaction) |

## Five best explorer links for the submission form

1. **One-transaction payout on L1** (commit + undelegate + `settle_prizes` Magic Action; prizes won on a real phone):
   https://explorer.solana.com/tx/5uehoYGrCnNN6obWDi7jrcYunLKzaXwwUDp2KWLE8yxP27LemTe2kDECePG8vn2iVGNpkwnavbe47bhJQfvFM4Vg?cluster=devnet
2. **Live cabinet delegated to the TEE Ephemeral Rollup**:
   https://explorer.solana.com/tx/2FzY9oJrQXab58GSnLmjZ6ShPzQnAnvi4zkzxRKjLLSkd4LGGMqU4vX2WctvvKXxmZyXv5dgELXfNk1cHpWN2G7v?cluster=devnet
3. **Drop → MagicBlock VRF request on the ER** (after today's upgrade; resolved HELD in 345 ms):
   https://explorer.solana.com/tx/2qo86FM1ZUbWrpEmMkYp7mUmLXnXmG5zrTDpdD9JTLoH2FQe9ChrFgu5pUwjabhkmqpx1jhqJXuorRK59W2demgM?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app
4. **On-chain crank clearing an idle turn on the ER**:
   https://explorer.solana.com/tx/31BH7Arp96NU5xS8BDrEhzrxeYHA8Bza3bRhmjCq3Jj5cHqQHZEQ8eR87ML44WdRbuYnsJAjEYQn8Wk4Lks289FK?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app
5. **Second player, same cabinet, same minute as the phone** (browser player's L1 settlement of a 0.5 dUSDC win):
   https://explorer.solana.com/tx/44cc3yGwbvqHNBzqQWyeg13qNDLywTse58aoB5uMcfDeYF8jPSAEcJxZaJNfpM119dz2Bt2dZPzmePTJq4Pitf8S?cluster=devnet

## What changed today

| Area | Change |
|---|---|
| Program | `drop_claw` / `drop_claw_public` only accept the ER VRF queue (SECURITY.md F-01, a refunded turn-stall path). Built, deployed, verified with a real round and a negative test for all three other queues. |
| App | Plush prizes stand on the cabinet floor, glossy arcade walls; Solflare "missing signature" fix (send the wallet's signed copy); security headers. Deployed to production. |
| Phone | Real gameplay on an Android phone: Solflare connect + session + play; burner wallet: mystery capsule won (0.35 dUSDC), 75 dGEM held, coin plush won, cash out paid by Magic Action. Two players (phone + browser) on the live cabinet at the same time. |
| Tests | +6 math unit tests (21 pass), new `tests/extra_invariants.ts` (21/21), new `tests/e2e_slip_then_win.ts` (6/6 on run 2; run 1 not completed), invariants 23/23 after the upgrade, Magic Action e2e pass. See TESTING.md. |
| Docs | README rewritten (banner, fresh screenshots + GIF, sourced problem, comparison, diagrams, verified proof table, honest status); new JUDGES, ARCHITECTURE, SECURITY, TESTING, DEPLOYMENT, BUSINESS, ROADMAP, CONTRIBUTING, CHANGELOG. |
| Repo | CI workflow (green on GitHub), issue / PR templates, description, homepage, topics, crate licence fixed to Apache-2.0, video sources kept out of git. |

## Test results (2026-11-27)

| Suite | Result |
|---|---|
| `cargo test -p clawrush --lib` | 21 passed, 0 failed |
| `npx tsx scripts/lib/math.test.ts` | pass |
| `cd app && npm run lint && npm run build` | pass (1 lint warning: `react-hooks/exhaustive-deps` in `Game.tsx`) |
| GitHub Actions CI | success (all 3 jobs) |
| `CABINET_ID=2 npx tsx tests/invariants.ts` | 23/23 (run 3, after the upgrade; run 2 had a test-design failure, fixed) |
| `CABINET_ID=2 npx tsx tests/extra_invariants.ts` | 21/21 |
| `CABINET_ID=2 npx tsx tests/e2e_slip_then_win.ts` | 6/6 on run 2; run 1 not completed (capsule held before it slipped) |
| `scripts/e2e_magic_action.ts` | pass on attempt 3 (attempts 1–2 were setup problems on cabinet 2, recorded) |
| `scripts/e2e_public_drop.ts` (cabinet 1, after upgrade) | all passed |
| `app/e2e/round.mjs` on the live URL | pass (aim, HELD 90 dGEM, idle turn cleared, Magic Action cash out) |

## Security (details: SECURITY.md — internal review and automated checks only, not an independent audit)

- No critical or high findings. F-01 (medium) fixed and deployed. F-02 queue griefing and F-03 unlimited devnet
  faucet are accepted risks on devnet and must change before real value. Lows: vault ATA pinning (F-04), keeper
  trust (F-07), restocker knows mystery contents (F-08), modulo bias in the roll (F-09: 86.3% / 26.7% actual
  vs 85% / 25% nominal), localStorage keys (F-10, headers part fixed).
- Secret scan (gitleaks + history grep): clean. `cargo audit`: 1 vulnerability + 3 warnings, all via
  `ephemeral-rollups-sdk` 0.18.0 dependencies (needs an upstream bump). `npm audit`: highs in transitive
  deps of anchor / spl-token / next build tooling; fixes are breaking upgrades.

## Known limitations

- Solflare mobile refuses to sign the ER cash-out transaction ("network mismatch": the ER blockhash). It can
  connect, start a session and play. Cash out works with the in-app burner and keys signed on desktop. One
  Solflare profile from that attempt stays delegated (demo tokens only).
- Phantom and Mobile Wallet Adapter are wired in but not tested on a device.
- The VRF callback transaction is hidden by the TEE (it lists the private vault): third parties see the stored
  roll and the drawer's re-check, not the VRF proof itself.
- The claw sway and plush animation are cosmetic; outcomes come only from the program.

## What you must still do

1. **Demo video:** upload the film (`demo/clawrush_film.mp4`, kept out of git) and/or the phone gameplay cut
   (`demo/clawrush_phone_gameplay.mp4`) to YouTube, then replace "Demo video: TODO" in README.md and use the
   link in the form.
2. **Submit** at https://build.magicblock.app/?stage=blitz#submit with your Telegram login (form answers in
   `docs/07-SUBMISSION.md`). Fill in your X account, Telegram handle and **payout wallet**.
3. `gh secret set KEEPER_KEYPAIR < keys/keeper.json` if you want the hosted keeper workflow (`docs/keeper.yml`).
4. **Rotate the AHOLO API key** used for the art generation.
5. Keep the cabinet stocked before judging: `KEEPER=keys/keeper.json ONCE=1 npx tsx scripts/keeper.ts`
   (with `NODE_OPTIONS=--dns-result-order=ipv4first` if Node times out).
6. The phone's screen-off timeout was raised during recording; set it back in Android settings.

Secrets: keypairs stay in `./keys` and `~/.config/solana` (git-ignored, never committed; staged diffs scanned
before every commit; gitleaks over the full history found nothing).
