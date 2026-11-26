# 🕹️ ClawRush

**One claw, every player, real prizes.**

ClawRush is a live multiplayer claw machine you play from your phone, built on Solana with
[MagicBlock](https://docs.magicblock.gg). Everyone plays the **same cabinet** in real time, capsules
**stay where they land**, your **aim sets your grip chance** before MagicBlock VRF rolls it, and jackpot
**mystery capsules are sealed** in a Private Ephemeral Rollup so bots can't snipe them. Wins settle
real tokens and collectibles to your wallet.

Built for **MagicBlock Solana Blitz v10 — Entertainment Finance**.

> 🚧 Work in progress — sections marked TODO get filled as the build lands.

## ▶️ Try it

- Live app: TODO
- Demo video: TODO

1. Connect a wallet and sign once (creates a scoped session key: no more popups).
2. Buy credits and join the queue.
3. Steer, switch front/side view to judge depth, and **DROP**.

## Why ClawRush

| | Typical on-chain claw | ClawRush |
|---|---|---|
| Skill matters | No, RNG only | **Aim × VRF grip** |
| Players | One at a time, isolated | **Shared live cabinet** |
| Persistent state | Fresh box every play | **Capsules stay where they slip** |
| Hidden jackpots | Public or none | **Sealed in a Private ER** |
| Fairness proof | VRF | VRF + live proof drawer + payout simulation |

## How MagicBlock powers it

| Primitive | Used for | What breaks without it |
|---|---|---|
| Ephemeral Rollup | Live shared cabinet, every claw move | L1 is too slow, and every move would cost a fee and a wallet popup |
| VRF | Grip roll on every drop | The operator or a validator could rig the grip |
| Private Ephemeral Rollup | Sealed mystery capsule contents | Bots read the jackpot location from public account data |
| Commit / Magic Actions | Prize settlement to Solana | Prizes never leave the rollup |

## Grip math

```
alignment error = distance(claw, capsule) / capsule radius
grip chance     = 85% at dead centre → 25% at the edge
VRF roll < grip → HELD → WIN
else            → SLIP: capsule drops part-way toward the chute and stays there
```

## Economics

TODO: `scripts/ev_simulation.ts` results (beginner / skilled / perfect bot EV, vault never insolvent).

## On-chain proof (devnet)

| Item | Link |
|---|---|
| Program ID | TODO |
| Cabinet account | TODO |
| Vault | TODO |
| Delegation tx | TODO |
| VRF request / callback | TODO |
| Mystery reveal | TODO |
| Commit + payout | TODO |

## Run locally

```bash
anchor build && anchor test
anchor deploy --provider.cluster devnet
npx ts-node scripts/setup_devnet.ts
cd app && npm install && npm run dev
```

## License

MIT
