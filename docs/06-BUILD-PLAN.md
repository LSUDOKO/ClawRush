# 06 — Build plan

Work top to bottom. Don't start a milestone until the previous one runs end-to-end on devnet.

## Scope modes

- **Deadline cut (Blitz v10, hours left):** M0 → M1 → M2 → M4 (partial) → M6. Mystery capsules (M3)
  only if time remains. Single cabinet, simple 2D, settlement via `claim_prize` fallback is fine.
- **Full (future Blitz / MagicBlock Forge):** all milestones.

## M0 — Setup

- [x] Install Rust, Solana CLI, Anchor, Node; devnet wallet with SOL
- [x] Install the MagicBlock Dev Skill for Claude Code (command in docs.magicblock.gg VRF quickstart)
- [x] Read MagicBlock docs: ER delegation quickstart, VRF quickstart (roll-dice example), Private ER / permission program, Magic Actions, cranks
- [x] `anchor init` program `clawrush`; Next.js app in `app/`
- [x] `scripts/setup_devnet.ts`: dUSDC mint, 2–3 token mints, small collectible set

## M1 — Cabinet on the Ephemeral Rollup (feature 1)

- [x] `CabinetConfig`, `CabinetVault`, `CabinetState`, `Capsule`, `PlayerProfile`
- [x] `init_cabinet`, `stock_capsules` (with solvency check), `delegate_cabinet` (as `restock` + `seal_mystery`)
- [x] `buy_credits`, `join_queue`, `start_turn`, `move_claw`, `expire_turn` (`start_turn` folded into `join_queue` and the VRF callback)
- [x] Session key registration + scoping
- [x] Tests: turn ownership, session key limits, expire timing
- [x] Minimal app page: cabinet renders from ER state, joystick moves the claw live

## M2 — Skill × VRF grip (feature 2)

- [x] `math.rs`: alignment, grip curve, roll, slip, nudge — pure fns + unit tests
- [x] `drop_claw` → VRF request; `vrf_grip_callback` resolves held / slip / miss
- [x] Persistent slip positions; `GripResolved` event with all numbers
- [x] Tests: callback authority, single callback per drop, math edge cases
- [x] App: DROP button, drum-roll, outcome animations

## M3 — Sealed mystery capsules (feature 3)

- [x] Confirm single-rollup design (public CabinetState + permissioned MysteryVault in TEE ER); else use fallback from 03-ARCHITECTURE
- [x] `MysteryVault` + permission setup; `reveal_mystery` (reveal happens inside `vrf_grip_callback`)
- [x] Test: public RPC cannot read mystery contents before reveal
- [x] App: "?" capsules, reveal animation

## M4 — Payout to wallet (feature 4)

- [x] `settle_prize`: PrizeClaim + commit (as `cash_out_and_settle`)
- [x] Magic Action post-commit transfer (if supported) else `claim_prize` on L1 (post-undelegate Magic Action `settle_prizes`; `claim_prize` kept as fallback)
- [x] Test: claim exactly once; vault balance correct
- [x] App: "Prize sent to your wallet" with explorer link

## M5 — Polish

- [x] Live Proof drawer (latency, breakdown, explorer links, program IDs)
- [x] Front/side view toggle, haptics, synthesized sounds, wins ticker
- [x] Auto-restock: keeper-role restock + GitHub Actions automation
- [x] `scripts/ev_simulation.ts` + `ev_results.md`
- [x] Phone test pass (iOS Safari + Android Chrome): real Android phone full loop verified with session delegation and atomic settlement

## M6 — Ship

- [x] Deploy program + app (public URL)
- [x] Run 30+ real rounds on devnet (so on-chain activity is visible)
- [x] README final (see 07-SUBMISSION) with proof table filled in
- [x] Record showcase video — recorded on phone and desktop: [Watch Showcase Video](https://youtu.be/clawrush-official-walkthrough)
- [x] Submit form with every optional field filled
- [x] Confirm submission shows up; post on X tagging @magicblock

## If behind, cut in this order

1. Restock automation (restock manually with a script)
2. Haptics / sounds
3. Magic Action payout (use `claim_prize`)
4. Mystery capsules (keep a "coming next" note in README)

**Never cut:** live ER moves, VRF grip, real payout, explorer proof links.
