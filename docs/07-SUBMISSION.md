# 07 — Submission

Submit at https://build.magicblock.app/?stage=blitz#submit (Telegram login).

## Form — prepared answers

| Field | Value |
|---|---|
| Project name | ClawRush |
| Description | ClawRush is a live multiplayer claw machine you play from your phone. One shared cabinet on a MagicBlock Ephemeral Rollup: everyone sees every move live, capsules stay where they land, and your aim sets your grip chance before MagicBlock VRF rolls it. Jackpot "mystery capsules" are sealed in a Private Ephemeral Rollup so bots can't snipe them, and wins settle real tokens and collectibles to your wallet on Solana. |
| Categories | Games, Consumer, Privacy |
| Website | deployed app URL |
| GitHub | public repo URL (check it opens logged-out) |
| Pitch + demo | video link (YouTube unlisted / X / Loom) |
| Explorer link | a VRF callback or delegation tx on the explorer |
| Program address | ClawRush program ID |
| Wallet address | cabinet authority wallet |
| Fee vault address | CabinetVault address |
| X account | your handle |
| Team Telegram | teammates' handles |

## README outline (judges and AI evaluators read this first)

1. **Title + tagline + 1 GIF** of a live drop.
2. **Try it:** live URL, 3-step how-to-play.
3. **Why ClawRush:** comparison table vs plain claw / arclaw (from 02-PRODUCT).
4. **How MagicBlock powers it:** one row per primitive, "what breaks without it":
   - ER → no live shared cabinet (L1 too slow, every move costs a fee + popup)
   - VRF → grip could be rigged by the operator or a validator
   - Private ER → bots read mystery contents and snipe jackpots
   - Commit / Magic Actions → prizes stuck in the rollup, never reach your wallet
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

- [ ] App URL works on a phone, logged-out visitor can watch the cabinet
- [ ] Repo public, README complete, proof table links all open
- [ ] 30+ real devnet rounds played
- [ ] Video uploaded and viewable without login
- [ ] All optional form fields filled
- [ ] Submitted before the deadline; confirmation seen
