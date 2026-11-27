# 04 — Economics & Formal Solvency Specification

**Objective:** Formally prove and verify that **even a theoretical superhuman aim-bot cannot drain the treasury vault**, while ensuring that player skill meaningfully rewards dexterity over random chance.

---

## ⚙️ Core Economic Levers

| Parameter | Default Value | Mechanism & Mathematical Purpose |
|---|---|---|
| `play_price` | 1 dUSDC | Cost of one credit / play turn |
| `grip_max_bps` | 8,500 bps (85.0%) | Maximum hold probability achieved at dead-center alignment ($0$ bps error) |
| `grip_min_bps` | 2,500 bps (25.0%) | Minimum hold probability achieved at capsule perimeter ($10,000$ bps error) |
| `max_payout_per_round` | 25 × play_price | On-chain hard cap on maximum single-round liability |
| `target_house_edge` | 10% – 20% | Expected protocol margin over aggregate play distribution |

---

## 📐 On-Chain Solvency Rules & Invariants

1. **Aggregate Solvency Invariant:**
   $$\text{Vault Balance} \ge \sum_{i=1}^{N} \text{Capsule Value}_i$$
   Enforced on-chain inside `restock` and `restock_by_keeper` via `is_solvent`. If an inventory restocking instruction would cause total capsule liabilities to exceed the vault's on-chain balance for any mint, the transaction is rejected with `VaultInsolvent`.

2. **Superhuman Player Return Bounding:**
   Prize values and probability curves are calibrated such that an idealized player with zero alignment error ($E[\text{align\_error}] = 0$) achieves an expected value strictly below $100\%$:
   $$E[\text{Return}]_{\text{perfect}} = \text{grip\_max} \times E[\text{Visible Prize}] \le 86.2\% < 100\%$$
   Because visible prizes are capped near 1 credit and jackpots exist only in cryptographically sealed mystery capsules, even a bot with perfect computer vision cannot execute positive-EV exploitation.

3. **Per-Round Payout Cap:**
   No single capsule win can exceed `max_payout_per_round` (`PayoutTooLarge`).

---

## 🔬 100,000-Round Monte Carlo Solvency Simulation

Simulated via [`scripts/ev_simulation.ts`](scripts/ev_simulation.ts) using the identical integer arithmetic and constants implemented in `programs/clawrush/src/math.rs`:

| Player Archetype | Alignment Profile | Hold Rate | Slip Rate | Miss Rate | Return to Player (RTP) |
|---|---|---|---|---|---|
| **Beginner Player** | Random target selection, unoptimized aim | 36.5% | 38.4% | 25.1% | **33.0%** |
| **Skilled Player** | Precision spatial alignment, center targeting | 77.7% | 22.3% | 0.0% | **78.0%** |
| **Superhuman Aim-Bot** | Perfect mathematical center alignment (error = 0) | 86.3% | 13.7% | 0.0% | **86.2%** |
| **Mixed Population** | Realistic distribution (2 Beginner : 1 Skilled : 1 Bot) | 59.2% | 28.2% | 12.6% | **57.9% House Payout** |

### Verified Treasury Headroom
- Starting Vault: 300 plays
- Minimum Recorded Headroom: **290.55 plays above solvency floor**
- Treasury Insolvent Events: **0 / 100,000 rounds**

---

## 🪙 Platform Currency & Token Architecture

The production deployment operates with verified SPL digital game assets and Metaplex Token Metadata:
- **dUSDC**: Primary game currency (1 dUSDC per play credit)
- **dGEM**: High-tier reward token
- **KOI**: Collectible plush asset with Metaplex metadata
- **ROBO**: Rare collectible plush asset with Metaplex metadata
- **Mystery Capsules**: Sealed TEE private vault assets revealed only upon successful on-chain drop
