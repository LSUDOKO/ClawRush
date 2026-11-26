# 02 — Product: ClawRush

**Tagline:** One claw, every player, real prizes.

**One-liner:** A live multiplayer claw machine on your phone where your aim actually matters,
prizes are real tokens and collectibles, and the jackpot capsules are sealed so bots can't snipe them.

## Why this, and why not a plain claw game

A claw game already runs on MagicBlock: **arclaw** (arclaw.app). Its own FAQ says the claw is
*not* skill-based — "You steer the claw live, but it is the show" — and the box contents come from a
MagicBlock VRF draw. Plays cost 1 / 5 / 10 USDC and open into tokenized stock cards. It is
single-player, pure RNG.

A "steer claw + VRF decides prize" build would look like a clone. ClawRush wins on four gaps:

| | arclaw | ClawRush |
|---|---|---|
| Skill matters | No (claw is "the show") | **Yes** — aim × VRF grip |
| Players per cabinet | One at a time, isolated | **Shared live cabinet**, everyone watches |
| Persistent state | Fresh box each play | **Capsules stay where they land** (near-miss tension) |
| Hidden prizes | Box contents | **Sealed mystery capsules in a Private ER** — anti-bot, anti-snipe |
| Fairness proof | VRF | VRF + on-screen proof drawer + payout simulation in repo |

## Core game loop (~30 seconds per turn)

1. **Open the app** on your phone → see the live cabinet: glass box, 12–16 capsules, claw, viewers count,
   recent-wins ticker.
2. **Buy credits** (one wallet signature) → **join the queue**. One session-key signature at login means
   zero wallet popups during play.
3. **Your turn (15 s):** steer the claw with a thumb joystick. Toggle **Front ↔ Side view** to judge depth.
4. **DROP.** The program measures your alignment to the nearest capsule.
5. **Grip roll:** alignment sets your grip chance; MagicBlock VRF rolls it. The proof drawer shows:
   `Alignment 91% → Grip 78% → VRF 0.41 → HELD!`
6. Outcomes:
   - **Held → chute → WIN.** Prize settles to your wallet on Solana.
   - **Slip:** capsule drops part-way toward the chute and **stays there** for the next player.
     Everyone sees it — next turn is a rush.
   - **Miss:** claw comes up empty, may nudge nearby capsules.
7. Next player in queue. Abandoned turns auto-expire after 15 s.

## Prizes (Entertainment Finance)

- **Token capsules** — devnet SPL tokens (e.g. demo USDC, SOL-like, meme tokens), visible amount on the capsule.
- **Collectible capsules** — NFT collectibles (sets of 4 variants; set completion is a stretch goal).
- **Mystery capsules** — sealed. Could be dust, a mid prize, or a jackpot. Contents live in a
  Private Ephemeral Rollup and are revealed only after the capsule crosses the chute.

## Features

### Core (must ship — this is the product)

| # | Feature | MagicBlock primitive | Why it's essential |
|---|---|---|---|
| 1 | **Shared live cabinet with persistent capsule positions** | Ephemeral Rollup | Many players, live moves, zero fees — impossible at L1 speed/cost |
| 2 | **Skill × VRF grip** | VRF | Fair, unriggable grip roll; skill raises odds but can't guarantee a win |
| 3 | **Sealed mystery capsules** | Private ER (TEE) | Public account data would let bots read & snipe the jackpot |
| 4 | **Instant payout to wallet** | Commit / undelegate (+ Magic Actions if it fits) | Closes the asset loop on Solana L1 |

### Polish (ship once the core works — big judging impact, low risk)

- **Live Proof drawer**: ER latency per move, alignment → grip → VRF breakdown, clickable explorer links
  (delegation tx, VRF request + callback, commit, payout).
- Turn queue + auto-expire (crank or permissionless `expire_turn`).
- Auto-restock when capsule count < 6.
- Haptics, arcade sounds, win animation, recent-wins ticker, viewers count.
- `scripts/ev_simulation.ts` payout proof + tests.

### Cut list (do NOT build unless asked)

- No-loss yield mode — separate product, money-safety questions.
- Spectator betting ("hold or slip") — separate product, gambling/regulatory questions.
- Live price-feed prize values — nice, not core.
- Set-burn treasury jackpot, stealth payouts, gift links — scope creep.
- Full 3D (Three.js) — use 2D canvas with front/side toggle instead.

## Target user & vibe

Mobile crypto users who like quick, social, "one more try" games. Retro Japanese arcade look: neon,
glass reflections, chunky buttons, coin and clink sounds, a big celebration on win.
