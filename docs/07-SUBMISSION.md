# 07 — Submission

Submit at https://build.magicblock.app/?stage=blitz#submit (Telegram login). **Prepared, not submitted**: submission needs the user's Telegram login.

## Form — prepared answers

| Field | Value |
|---|---|
| Project name | ClawRush |
| Description | ClawRush is a live multiplayer claw machine you play from your phone. One shared cabinet on a MagicBlock Ephemeral Rollup: everyone sees every move live, capsules stay where they land, and your aim sets your grip chance before MagicBlock VRF rolls it. Jackpot "mystery capsules" are sealed in a Private Ephemeral Rollup so bots can't snipe them, an on-chain crank clears idle turns, and one signature commits your session back to Solana while a Magic Action pays every prize (tokens and plush collectibles with Metaplex metadata) to your wallet. |
| Categories | Games, Consumer, Privacy |
| Website | https://clawrush.pages.dev |
| GitHub | https://github.com/LSUDOKO/ClawRush |
| Pitch + demo | Demo video: TODO (owner adds YouTube link). The 4:34 phone gameplay recording is kept out of git (`demo/` is git-ignored) |
| Explorer link | https://explorer.solana.com/tx/31j7usJPvqmit6iJB7a43HMTnfVZvoC7YjKrdYcBE4QumEBR1KHNCFjDd3WtboAo8qqhKXCUPpxQQUixXQRyBxea?cluster=devnet (L1 commit + undelegate + Magic Action payout of a 1 dUSDC win; cabinet delegation: https://explorer.solana.com/tx/2FzY9oJrQXab58GSnLmjZ6ShPzQnAnvi4zkzxRKjLLSkd4LGGMqU4vX2WctvvKXxmZyXv5dgELXfNk1cHpWN2G7v?cluster=devnet) |
| Program address | 9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs |
| Wallet address | 5XPdQGRroRqUycg4rCsLV5ir7owe87jLn7vDGXjkpFqH (cabinet + program upgrade authority) |
| Fee vault address | 7FYk2SBgXR3uM7YtdP5Kg9qMF1D1T5zKF8QFGvRMojf2 (vault authority PDA; dUSDC ATA 8KARifuHeMqHxX3arzsAVbMsbyDfcXNxfhJwg3LdTob6) |
| X account | **user to fill** |
| Team Telegram | **user to fill** |

## README outline (judges and AI evaluators read this first)

1. **Title + tagline + 1 GIF** of a live drop.
2. **Try it:** live URL, 3-step how-to-play.
3. **Why ClawRush:** comparison table vs plain claw / arclaw (from 02-PRODUCT).
4. **How MagicBlock powers it:** one row per primitive, "what breaks without it":
   - ER → no live shared cabinet (L1 too slow, every move costs a fee + popup)
   - VRF → grip could be rigged by the operator or a validator
   - Private ER → bots read mystery contents and snipe jackpots
   - Commit / Magic Actions → prizes stuck in the rollup, never reach your wallet
   - Crank → one idle player blocks the shared cabinet
5. **Architecture:** Mermaid diagrams — turn lifecycle, drop → VRF → outcome, mystery reveal.
6. **Grip math:** the formula block from 03-ARCHITECTURE.
7. **Economics & solvency:** ev_simulation results table.
8. **Security model:** session key scope + the 7 invariants + test list.
9. **On-chain proof table:** program ID, cabinet, vault, and explorer links for delegation, VRF request,
   VRF callback, mystery reveal, commit, payout.
10. **Run locally** + **What's next**.
11. Honest "what's on-chain vs client-side" note (e.g. sway animation is cosmetic).

## Demo video script (~90–120 s, record vertically on the phone)

| Time | Shot |
|---|---|
| 0–8 s | Hook: "Claw machines are rigged. This one can't be, and everyone plays the same machine live." Cabinet on screen. |
| 8–25 s | One login signature → credits → join queue. Then thumb-steer with **zero popups**, switch front/side view. |
| 25–45 s | Drop → drum roll → **slip**: capsule lands near the chute. Second phone shows it live and grabs it on the next turn. |
| 45–65 s | Mystery capsule win → reveal animation → prize lands in the wallet (show wallet balance). |
| 65–85 s | Open Live Proof drawer: latency, `Alignment → Grip → VRF → HELD`, tap through to Solana Explorer. |
| 85–110 s | 10-s architecture slide (ER, VRF, Private ER, settlement) + ev_simulation table. Close: "ClawRush — one claw, every player, real prizes. Built on MagicBlock." |

## Final checklist

- [x] App URL serves; real rounds played on a physical Android phone (burner end to end; Solflare connect + session + play; Solflare mobile cannot sign the ER cash-out, documented in README)
- [x] Repo public, README complete (proof links checked: L1 links open; ER links for public txs open via the TEE custom RPC)
- [x] 30+ real devnet rounds played (30 completed + 4 recorded failures on the current build; 34 on the earlier build)
- [ ] Demo video: recorded on the phone, not in git; TODO (owner adds YouTube link) to README and the form
- [ ] X account + Telegram handles filled (user)
- [ ] Submitted before the deadline via Telegram login; confirmation seen (user; not submitted by the agent)
