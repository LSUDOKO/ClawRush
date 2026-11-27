# 05 — Frontend (mobile arcade)

## Principles

- **Phone first, portrait 9:16.** Test on a real phone early.
- **Looks fun in the first 5 seconds** of the demo video.
- **Zero wallet popups during play** (session key after one login signature).
- **Proof is always one tap away** (Live Proof drawer).

## Screen layout (portrait)

```
┌─────────────────────────────┐
│ ClawRush   👀 23 watching   │  header + recent-wins ticker
│ 🏆 7xQ… won 5 dUSDC · 2s ago │
├─────────────────────────────┤
│   ╔═══════════════════════╗ │
│   ║   ▼ claw              ║ │  cabinet (three.js 3D)
│   ║  ●  ◆  ?  ●  ◆        ║ │  ● token  ◆ collectible  ? mystery
│   ║ ●  ?  ●   ◆  ●   [⬇] ║ │  [⬇] chute
│   ╚═══════════════════════╝ │
│  [FRONT | SIDE]   ⏱ 0:11    │  view toggle + turn timer
├─────────────────────────────┤
│   (◯ joystick)     [ DROP ] │  controls
│  Queue: you're #2 · 3 creds │
│  ▸ Live Proof               │  slide-up drawer
└─────────────────────────────┘
```

## Cabinet rendering

- three.js WebGL cabinet (2D canvas fallback), ~60 fps render loop; game state from ER account subscription.
- **Front view** shows x (left/right) + height; **Side view** shows z (depth) + height. The toggle is the
  depth-aiming mechanic — keep it.
- Capsule sprites by kind; mystery capsules glow with a "?" and show no value.
- Slipped capsules show a small "slipped ×2" badge — feeds the near-miss rush.
- Claw sway: small cosmetic pendulum animation (client-side only; on-chain position is authoritative).

## Controls

- Hold-and-drag thumb joystick → throttled `move_claw(dx, dz)` (~10–20 tx/s).
- Client-side prediction: move the claw immediately, reconcile with confirmed ER state.
- DROP button: large, disabled when it's not your turn or a VRF roll is pending.
- `navigator.vibrate` on grab, clink, win (where supported).

## Live Proof drawer

Slide-up panel; this is a judging feature, make it clean:

- **ER latency:** rolling ms per confirmed move (compare label: "Solana L1 ≈ 400 ms").
- **Last drop:** `Alignment 91% → Grip 78% → VRF 0.41 → HELD` (from the `GripResolved` event).
- **Explorer links:** delegation tx, VRF request tx, VRF callback tx, commit tx, payout tx.
- **Program IDs** and the cabinet account address.
- **Mystery status:** "sealed in Private ER" → "revealed: 20 dUSDC (tier: jackpot)".

## Sound (Web Audio, synthesized — no copyrighted samples)

Joystick whirr, claw servo hum, capsule clink, drum roll during the VRF roll, win fanfare, slip "aww".
Mute toggle in header.

## State sync

- Subscribe to `CabinetState` and `Queue` accounts on the ER via the Magic Router connection.
- Listen to program events for the proof drawer and wins ticker.
- Viewers count: count of active websocket subscribers if available; otherwise label as
  "players in queue" (don't fake numbers).

## Wallet

- Solana wallet adapter + Mobile Wallet Adapter (Phantom / Solflare / Seeker).
- Login flow: connect → `register_session_key` (one signature) → `buy_credits` → play.
