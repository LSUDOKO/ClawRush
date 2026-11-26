# 06 — Build plan

Work top to bottom. Don't start a milestone until the previous one runs end-to-end on devnet.

## Scope modes

- **Deadline cut (Blitz v10, hours left):** M0 → M1 → M2 → M4 (partial) → M6. Mystery capsules (M3)
  only if time remains. Single cabinet, simple 2D, settlement via `claim_prize` fallback is fine.
- **Full (future Blitz / MagicBlock Forge):** all milestones.

## M0 — Setup

- [ ] Install Rust, Solana CLI, Anchor, Node; devnet wallet with SOL
- [ ] Install the MagicBlock Dev Skill for Claude Code (command in docs.magicblock.gg VRF quickstart)
- [ ] Read MagicBlock docs: ER delegation quickstart, VRF quickstart (roll-dice example), Private ER / permission program, Magic Actions, cranks
- [ ] `anchor init` program `clawrush`; Next.js app in `app/`
- [ ] `scripts/setup_devnet.ts`: demo-USDC mint, 2–3 demo token mints, small collectible set

## M1 — Cabinet on the Ephemeral Rollup (feature 1)

- [ ] `CabinetConfig`, `CabinetVault`, `CabinetState`, `Capsule`, `PlayerProfile`
- [ ] `init_cabinet`, `stock_capsules` (with solvency check), `delegate_cabinet`
- [ ] `buy_credits`, `join_queue`, `start_turn`, `move_claw`, `expire_turn`
- [ ] Session key registration + scoping
- [ ] Tests: turn ownership, session key limits, expire timing
- [ ] Minimal app page: cabinet renders from ER state, joystick moves the claw live

## M2 — Skill × VRF grip (feature 2)

- [ ] `math.rs`: alignment, grip curve, roll, slip, nudge — pure fns + unit tests
- [ ] `drop_claw` → VRF request; `vrf_grip_callback` resolves held / slip / miss
- [ ] Persistent slip positions; `GripResolved` event with all numbers
- [ ] Tests: callback authority, single callback per drop, math edge cases
- [ ] App: DROP button, drum-roll, outcome animations

## M3 — Sealed mystery capsules (feature 3)

- [ ] Confirm single-rollup design (public CabinetState + permissioned MysteryVault in TEE ER); else use fallback from 03-ARCHITECTURE
- [ ] `MysteryVault` + permission setup; `reveal_mystery`
- [ ] Test: public RPC cannot read mystery contents before reveal
- [ ] App: "?" capsules, reveal animation

## M4 — Payout to wallet (feature 4)

- [ ] `settle_prize`: PrizeClaim + commit
- [ ] Magic Action post-commit transfer (if supported) else `claim_prize` on L1
- [ ] Test: claim exactly once; vault balance correct
- [ ] App: "Prize sent to your wallet" with explorer link

## M5 — Polish

- [ ] Live Proof drawer (latency, breakdown, explorer links, program IDs)
- [ ] Front/side view toggle, haptics, synthesized sounds, wins ticker
- [ ] Auto-restock (crank or permissionless) when active capsules < 6
- [ ] `scripts/ev_simulation.ts` + `ev_results.md`
- [ ] Phone test pass (iOS Safari + Android Chrome)

## M6 — Ship

- [ ] Deploy program + app (public URL)
- [ ] Run 30+ real rounds on devnet (so on-chain activity is visible)
- [ ] README final (see 07-SUBMISSION) with proof table filled in
- [ ] Record demo video
- [ ] Submit form with every optional field filled
- [ ] Confirm submission shows up; post on X tagging @magicblock

## If behind, cut in this order

1. Restock automation (restock manually with a script)
2. Haptics / sounds
3. Magic Action payout (use `claim_prize`)
4. Mystery capsules (keep a "coming next" note in README)

**Never cut:** live ER moves, VRF grip, real payout, explorer proof links.
