# 03 — Architecture

> **As built: see [ARCHITECTURE.md](../ARCHITECTURE.md).** This is the original design doc. Its layer diagram
> (Magic Router), the account list (`PrizeClaim`, `Queue`, 16 capsules, house-edge fields, global profile seed) and
> some field names predate the build. The instruction table, grip math and settlement sections below are current.

> Verify every MagicBlock call pattern (delegate, commit, undelegate, VRF request/callback, permission
> program, TEE validator) against https://docs.magicblock.gg and the MagicBlock Dev Skill before coding.
> Names below describe intent; exact macros/IDs come from the docs.

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│ MOBILE WEB APP (Next.js PWA, three.js 3D cabinet)              │
│ joystick · front/side view · proof drawer · session key        │
└───────────────────────────┬───────────────────────────────────┘
                            │ Magic Router (routes L1 vs ER automatically)
          ┌─────────────────┴──────────────────┐
          ▼                                    ▼
┌──────────────────────┐         ┌─────────────────────────────────┐
│ SOLANA L1 (devnet)   │         │ EPHEMERAL ROLLUP (TEE / Private)│
│ CabinetConfig        │ delegate│ CabinetState  (public-readable) │
│ CabinetVault (SPL)   │ ──────▶ │  claw, capsules[], turn          │
│ PlayerProfile/credits│         │ Queue                            │
│ PrizeClaim settle    │ ◀────── │ MysteryVault  (permissioned)     │
└──────────────────────┘ commit  │ VRF request + callback           │
                                 └─────────────────────────────────┘
```

**Design choice — one rollup:** run the cabinet on MagicBlock's private (TEE) ER so that `CabinetState`
can be readable by everyone while `MysteryVault` is permission-restricted. This avoids cross-rollup messaging.
**Verify** the permission program supports public-read on one account and restricted-read on another in
the same rollup. **Fallback:** cabinet on the public ER, mystery contents via commit-reveal
(`hash(contents, salt)` stored at restock, revealed by the operator key on win) — weaker, say so in README.

## Accounts

### L1 (not delegated)

**CabinetConfig** (PDA `["config", cabinet_id]`)
- `authority: Pubkey`
- `play_price: u64` (credit price in demo-USDC base units)
- `turn_secs: u16` (15)
- `grip_max_bps: u16` (8_500), `grip_min_bps: u16` (2_500)
- `house_edge_min_bps / max_bps: u16` (800 / 1_500)
- `max_payout_per_round: u64`
- `restock_threshold: u8` (6)

**CabinetVault** (PDA `["vault", cabinet_id]`) — token accounts holding prize inventory + play revenue.
Invariant: `vault_value >= max_liability(stocked capsules)`.

**PlayerProfile** (PDA `["player", wallet]`)
- `credits: u32`, `plays: u32`, `wins: u32`
- `session_key: Option<Pubkey>`, `session_expires_at: i64`

**PrizeClaim** (PDA `["claim", cabinet_id, round]`) — created on settlement: `winner, mint, amount, round, settled: bool`.

### Delegated to the ER

**CabinetState** (PDA `["cabinet", cabinet_id]`)
- `claw: { x: i32, z: i32, vx: i16, vz: i16 }` (integer grid units, e.g. 0..1000)
- `capsules: [Capsule; 16]`
- `turn_owner: Option<Pubkey>`, `turn_expires_at: i64`, `round: u64`
- `pending_vrf: bool`

**Capsule**
- `id: u8`, `x: i32`, `y: i32`, `z: i32`, `radius: u16`, `active: bool`
- `kind: enum { Token, Collectible, Mystery }`
- `mint: Pubkey`, `amount: u64` (zeroed / ignored for Mystery)
- `slip_count: u8`

**Queue** (PDA `["queue", cabinet_id]`) — ring buffer of up to N player pubkeys.

**MysteryVault** (PDA `["mystery", cabinet_id]`, permission-restricted)
- `entries: [MysteryEntry; 16]` keyed by capsule id → `{ mint, amount, tier }`

## Instructions

As built (`programs/clawrush/src/lib.rs`). "Session" means the scoped session key may sign it.

| Instruction | Layer | Signer | What it does |
|---|---|---|---|
| `init_cabinet` | L1 | authority | Create config, vault authority, cabinet state, mystery vault |
| `delegate_cabinet` | L1 | authority | Delegate CabinetState and MysteryVault to the TEE ER |
| `seal_mystery` | ER | authority | Zero-member private permission on the mystery vault |
| `restock` | ER | authority | Fill free slots, write sealed mystery entries; bounds, payout cap, per-mint solvency |
| `set_keeper` | L1 | authority | Store a low-privilege keeper key in `KeeperRole` |
| `restock_by_keeper` | ER | keeper | Same as `restock` (shared `restock_core`) |
| `admin_undelegate` | ER | authority | Recovery: close the permission, commit the vault (makes unrevealed contents public) |
| `init_player` | L1 | player | Create the per-cabinet profile |
| `faucet` | L1 | player | Demo dUSDC, rate-limited per profile |
| `buy_credits` | L1 | player | Pay play price × n into the vault, add credits |
| `register_session_key` | L1 | player | Scoped session key, ≤ 24 h |
| `delegate_player` | L1 | player | Delegate the profile to the ER |
| `join_queue` | ER | player / session | Spend 1 credit; start the turn if idle, else enqueue |
| `move_claw(dx, dz, seq)` | ER | turn owner / session | Clamp and move |
| `drop_claw_public(seed)` | ER | turn owner / session | Lock claw, request VRF; mystery vault address derived on chain (tx stays readable) |
| `drop_claw(seed)` | ER | turn owner / session | Older variant that lists the vault (tx redacted by the TEE) |
| `vrf_grip_callback` | ER | VRF identity only | Resolve HELD / SLIP / MISS, reveal mystery on win, credit `pending`, start next turn |
| `expire_turn` | ER | anyone | End an overdue turn; refund if the VRF is stuck > 30 s |
| `schedule_crank` / `crank_tick` | ER | authority / ER scheduler | Every 3 s, end overdue turns and hand over to the queue |
| `cash_out_and_settle` | ER | player | Commit + undelegate the profile with a post-undelegate Magic Action |
| `settle_prizes` | L1 | delegation program escrow | The Magic Action: pay all `pending` from the vault, zero it |
| `cash_out` / `claim_prize` | ER / L1 | player | Fallback path: commit + undelegate, then claim one mint at a time |

**Move rate:** one `move_claw` tx per joystick tick, throttled to ~10–20 tx/s per player.
The client interpolates between confirmed positions so motion stays smooth.

## Grip math (all integer / bps — lives in `math.rs`)

```
nearest = capsule minimising distance d between claw (x,z) and capsule (x,z)
align_err_bps = min(10_000, d * 10_000 / capsule.radius)
if align_err_bps >= 10_000            → MISS (claw outside capsule)
grip_bps = grip_max_bps - (grip_max_bps - grip_min_bps) * align_err_bps / 10_000
           // dead centre → 85%, edge → 25%
roll_bps = u16_from(randomness[0..2]) % 10_000
if roll_bps < grip_bps                → HELD → capsule to chute → WIN
else                                  → SLIP
   slip_frac_bps = 1_500 + u16_from(randomness[2..4]) % 5_000   // 15–65% of the way (as built)
   capsule.(x,z) moves toward chute by slip_frac × path_length
   capsule.slip_count += 1            // persists for the next player
MISS: nudge up to 2 capsules within 1.5×radius by small offsets from randomness[4..8]
```

Show every intermediate number in the `GripResolved` event so the proof drawer can render it.

## Mystery capsule flow

1. At restock the authority writes `MysteryEntry` into the permissioned `MysteryVault` (inside the TEE).
   Public `CabinetState` only shows `kind = Mystery`.
2. On `HELD` for a Mystery capsule, the callback (inside the same ER) reads the entry, sets the prize,
   emits `MysteryRevealed { capsule_id, mint, amount, tier }`.
3. Before the win, a public RPC read of `MysteryVault` must fail / return no plaintext — **write a test for this**.

## Settlement

- A win only credits `profile.pending` on the ER. Nothing leaves the vault until the player cashes out.
- `cash_out_and_settle` (one wallet signature on the ER) schedules commit + undelegate of the profile and a
  post-undelegate Magic Action, `settle_prizes`, on L1. It must be post-undelegate: a post-commit action runs while
  the profile is still owned by the delegation program.
- `settle_prizes` requires the delegation program's escrow PDA as signer, binds `escrow_auth` to the profile owner,
  pays every non-zero `pending` mint from the vault and zeroes it.
- Fallback: `cash_out` then `claim_prize` per mint. Both paths zero `pending`, so nothing is paid twice
  (`NothingToClaim`).

## Security invariants (each needs a test)

1. Only `turn_owner` (or their valid session key) can `move_claw` / `drop_claw`.
2. Session key cannot call `buy_credits`, `claim_prize`, `restock`, admin ops, or touch the vault.
3. Only the VRF oracle/program identity can call `vrf_grip_callback`; one callback per drop (`pending_vrf`).
4. `expire_turn` works for anyone after expiry, never before.
5. Restock and stock fail if they would break `vault_value >= max_liability`.
6. A PrizeClaim can be settled exactly once.
7. MysteryVault is unreadable by the public before reveal.

## Events

`QueueJoined, TurnStarted, ClawMoved, DropInitiated, GripResolved{align_err_bps, grip_bps, roll_bps, outcome},
CapsuleSlipped, CapsuleWon, MysteryRevealed, PrizeSettled, TurnExpired, CabinetRestocked`
