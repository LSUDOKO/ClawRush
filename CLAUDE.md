# CLAUDE.md — ClawRush

> Read this file first. Then read the files in `docs/` in number order before writing code.

## What we are building

**ClawRush** — *One claw, every player, real prizes.*

A **live, multiplayer, skill-based claw machine you play from your phone**, built on Solana with
MagicBlock. One shared cabinet, many players watching at once, capsules that stay where they land,
grip strength decided by **your aim × MagicBlock VRF**, sealed **mystery capsules** nobody can
read until they fall, and prizes (tokens / collectibles) paid straight to the winner's wallet.

Built for **MagicBlock Solana Blitz v10 — theme: "Entertainment Finance"**.
MagicBlock's own prompt for this idea: *"An arcade claw you play from your phone, stocked with
collectibles and tokens instead of plush toys."*

## Docs map

| File | What's in it |
|---|---|
| `docs/01-HACKATHON.md` | Hackathon facts: theme, prizes, rules, judging, deadline, submission form |
| `docs/02-PRODUCT.md` | Concept, game loop, features (core vs cut), competitor analysis (arclaw) |
| `docs/03-ARCHITECTURE.md` | On-chain design: accounts, instructions, grip math, privacy, settlement, security |
| `docs/04-ECONOMICS.md` | Payout math, solvency rules, EV simulation script spec |
| `docs/05-FRONTEND.md` | Mobile arcade UI, controls, proof drawer, sound, state sync |
| `docs/06-BUILD-PLAN.md` | Milestones with checkboxes, "deadline cut" vs "full" scope |
| `docs/07-SUBMISSION.md` | Form fields, README outline, demo video script, final checklist |
| `README.md` | Public README draft for the GitHub repo (judges read this) |

## Non-negotiable rules

1. **Every MagicBlock primitive must be essential.** If removing it doesn't break the game, don't add it.
   Core: Ephemeral Rollups (live shared cabinet), VRF (grip roll), Private ER (sealed mystery capsules),
   commit/undelegate back to Solana (prize payout).
2. **No mocks in the demo path.** Every move, drop, grip roll and payout must be a real devnet transaction
   with an explorer link. If something is simulated, label it clearly in the UI and README.
3. **Devnet is fine.** The submission page checks recent devnet *or* mainnet activity.
4. **Scope discipline.** Ship the core loop end-to-end before any polish or stretch feature.
   Cut list lives in `docs/02-PRODUCT.md` — do not build cut features unless the user asks.
5. **Fixed-point math only on-chain.** No floats in Rust programs. Use basis points (bps, 0–10_000) and
   integer grid units.
6. **Session keys are scoped.** A session key may only sign `move_claw`, `drop_claw`, `join_queue`.
   Never withdraw, claim or admin.
7. **Verify MagicBlock APIs before using them.** SDK names/versions in these docs are a starting point.
   Check current patterns in https://docs.magicblock.gg and install the MagicBlock Dev Skill
   (the docs' VRF quickstart has the Claude Code install command) before writing delegation / VRF / PER code.

## Stack

- **Programs:** Rust + Anchor, `ephemeral-rollups-sdk` (delegation, commit, undelegate),
  `ephemeral_vrf_sdk` (VRF request + callback). Private ER via MagicBlock's TEE validator + permission program.
- **Frontend:** Next.js + TypeScript + Tailwind, mobile-first PWA, three.js 3D cabinet (2D canvas fallback)
  (front/side view toggle). Solana wallet adapter + Mobile Wallet Adapter.
- **Client SDK:** `@magicblock-labs/ephemeral-rollups-sdk` (Magic Router connection).
- **Network:** Solana devnet + MagicBlock devnet ER.
  - ER endpoint: `https://devnet.magicblock.app`
  - Magic Router: `https://devnet-router.magicblock.app`
  - (verify current endpoints + TEE validator endpoint in docs)

## Repo layout (target)

```
clawrush/
├── CLAUDE.md
├── README.md
├── docs/
├── programs/clawrush/        # Anchor program
│   └── src/
│       ├── lib.rs
│       ├── state/            # CabinetConfig, CabinetVault, CabinetState, Capsule, PlayerProfile, Queue, MysteryVault
│       ├── instructions/     # one file per instruction
│       ├── math.rs           # grip + slip math (pure fns, unit-tested)
│       ├── events.rs
│       └── errors.rs
├── tests/                    # devnet invariant suite (tsx)
├── scripts/
│   ├── ev_simulation.ts      # Monte Carlo payout proof
│   ├── setup_devnet.ts       # create mints, cabinet, stock capsules
│   └── restock.ts
└── app/                      # Next.js mobile web app
```

## Commands (fill in as the project grows)

```bash
anchor build
cargo test -p clawrush --lib                       # math unit tests
npx tsx scripts/lib/math.test.ts                   # TS port matches math.rs
solana program deploy target/deploy/clawrush.so --program-id <program keypair> --url devnet
npx tsx scripts/setup_devnet.ts                    # mints, cabinet, delegation, sealed vault, stock
npx tsx scripts/ev_simulation.ts
npx tsx scripts/devnet_rounds.ts                   # real devnet rounds (ROUNDS, PLAYERS env)
npx tsx scripts/e2e_two_player.ts                  # stop keeper first
CABINET_ID=2 npx tsx tests/invariants.ts           # devnet invariant suite (tsx, not anchor test)
npx tsx scripts/keeper.ts                          # restock when low (KEEPER=keys/keeper.json ONCE=1 for one keeper-role pass)
npx tsx scripts/crank.ts                           # schedule the ER crank that clears overdue turns
CABINET_ID=1 npx tsx scripts/set_keeper.ts <pubkey> # register the low-privilege restock key
npx tsx scripts/metaplex_metadata.ts               # Token Metadata on the prize mints
npx tsx scripts/e2e_magic_action.ts                # one-signature payout e2e
CABINET_ID=1 npx tsx scripts/e2e_public_drop.ts    # public drop + keeper role e2e (MYSTERY=1 ROUNDS=4 to aim at mystery)
cd app && AIM=1 URL=<deploy url> KEY=../keys/webtest.json OUT=<scratch dir> node e2e/round.mjs   # browser round (OUT defaults to committed shots)
cd app && npm run dev | npm run lint | npm run build
cd app && npx wrangler pages deploy out --project-name clawrush --branch main
# Node fetch timing out on this machine: export NODE_OPTIONS=--dns-result-order=ipv4first
```

## Coding conventions

- Small instruction handlers; all game math in `math.rs` as pure functions with unit tests.
- Emit an Anchor event for every state change judges should be able to trace:
  `QueueJoined, TurnStarted, ClawMoved, DropInitiated, GripResolved, CapsuleSlipped, CapsuleWon,
  MysteryRevealed, PrizeSettled, TurnExpired, CabinetRestocked`.
- Custom errors with clear names (`NotYourTurn`, `TurnExpired`, `VaultInsolvent`, `SessionKeyNotAllowed`...).
- Keep client and program constants (grid size, radii, bps curves) in one shared file per side and in sync.
