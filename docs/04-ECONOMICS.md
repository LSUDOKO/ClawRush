# 04 — Economics & solvency

Goal: prove in the repo that **even a perfect aim-bot cannot drain the vault**, while skilled humans
do noticeably better than beginners. Very few hackathon games prove their economics — this is a
cheap, high-signal differentiator.

## Levers

| Parameter | Default | Effect |
|---|---|---|
| `play_price` | 1 demo-USDC | Cost of one turn |
| `grip_max_bps` | 8_500 | Best possible hold chance (dead centre). Hard cap on skill. |
| `grip_min_bps` | 2_500 | Hold chance at the capsule edge |
| Prize values | per capsule | Set at stocking time |
| `max_payout_per_round` | e.g. 25 × play_price | Caps jackpot liability |
| House edge target | 8–15% | Return to a *perfect* player ≤ 85–92% |

## Solvency rules

1. **Stocking rule:** `vault_balance >= sum(value of all active capsules)` — every visible prize is fully
   backed before it can be won (`max_liability`).
2. **Perfect-player cap:** choose prize values so that a perfect player's expected value per play is at most
   `(1 - house_edge_min) × play_price`. Roughly:
   `EV_perfect ≈ P(reach a capsule) × grip_max × E[prize value] ≤ 0.92 × play_price`
   (slips increase future win odds for *someone*, so the simulation must model the shared cabinet, not
   single plays in isolation).
3. **Per-round cap:** no single win pays more than `max_payout_per_round`.

## `scripts/ev_simulation.ts` — spec

Monte Carlo over 100,000 turns using **the same constants and integer math as `math.rs`**
(port the functions 1:1, or call a shared WASM build if time allows).

Simulate three player types on a shared cabinet:

| Player | Aim model |
|---|---|
| Beginner | Alignment error uniform 30–100% of radius, 25% chance to miss entirely |
| Skilled | Alignment error ~ normal(15%, 10%) clamped |
| Perfect bot | Alignment error = 0 every time |

Output (print + write `scripts/ev_results.md`):

- EV per play (as % of play_price) for each player type
- Win rate, slip rate, miss rate
- Vault balance over time (must never go below the liability floor)
- Max drawdown

Target shape (tune parameters until true): beginner < skilled < perfect bot < 100%, and the
vault never goes insolvent. Put the final table in the README.

## Demo money

Use devnet test tokens created by `scripts/setup_devnet.ts` (demo-USDC + 2–3 demo tokens +
a small collectible collection). Label them clearly as devnet demo assets.
