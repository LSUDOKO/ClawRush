# Testing

ClawRush has three kinds of tests:

- **Rust unit tests** for the game math in `programs/clawrush/src/math.rs`. They are pure functions, so these run offline.
- **A TypeScript port check** (`scripts/lib/math.test.ts`). It confirms the client's math port gives the same results as the Rust code.
- **Devnet tests.** These send real transactions to Solana devnet and to the MagicBlock TEE Ephemeral Rollup. Most of them are attacks: each must be rejected with a named program error.

Nothing is mocked. The devnet suites run against **test cabinet 2**, which has its own mints, vault and keys. The live demo cabinet 1 is not touched.

Devnet results are against the **deployed** program. The lead upgraded it at about 17:00 IST (deploy `2vHp9HK6hrro5BADAoqqfBeKJdhg49sh2qPKMffqM2vuoNwBES11u9ybghdgsNk1FCgqDr6G9LtihPjnJ2RiMhTU`), pinning the VRF oracle queue (SECURITY.md F-01). The oracle-queue rows and the second invariant run are post-upgrade; the other devnet rows ran before it. The unit tests compile against the working tree.

All results below come from runs on **2026-11-27, IST afternoon** (UTC times are in the logs and in `docs/INVARIANTS.md`), unless a row says otherwise.

## Results summary (2026-11-27)

| Suite | Command | Result |
|---|---|---|
| Rust math unit tests | `cargo test -p clawrush --lib` | **21 passed, 0 failed**: 20 math tests plus Anchor's generated `test_id`. 14 of the math tests existed before today (the earlier count of 15 included `test_id`), and 6 were added today. |
| TS port of the math | `npx tsx scripts/lib/math.test.ts` | **exit 0**. It prints "all vectors match math.rs" and reports no per-assert count. |
| Devnet security invariants | `CABINET_ID=2 npx tsx tests/invariants.ts` | Run 1 (11:13:41Z, before the upgrade): **23 passed, 0 failed**. Run 2 (11:32:35Z, after the upgrade): 22 passed, 1 failed (test-design problem, see *Flakiness*). Run 3 (~11:36:49Z, after the upgrade, test fixed): **23 passed, 0 failed**. Each run regenerates `docs/INVARIANTS.md`, which now holds run 3. |
| Devnet extra invariants (new) | `CABINET_ID=2 npx tsx tests/extra_invariants.ts` | **21 passed, 0 failed** (17:03 IST, after the program upgrade `2vHp9HK6…`; 20/20 at 17:00 before the batch-solvency check was added). Earlier runs: 10/10 under the old name `tests/payout_cap.ts`, then 12/12 after the L1 mystery reads were added, both before the upgrade. |
| Devnet two-player slip-then-win (new) | `CABINET_ID=2 npx tsx tests/e2e_slip_then_win.ts` | **6 passed, 0 failed** on run 2. Run 1 was **not completed**: the capsule was HELD on the first drop, before any slip. See *Flakiness*. |
| Devnet Magic Action payout | `PLAYER=testA CABINET_ID=2 npx tsx scripts/e2e_magic_action.ts` | **PASS** on attempt 3. Attempts 1 and 2 stopped on preconditions, not on a program failure. See *Flakiness*. |

Before running the devnet suites:

```bash
export NODE_OPTIONS=--dns-result-order=ipv4first   # Node fetch times out on this machine without it
```

They need devnet SOL in the admin key (`~/.config/solana/id.json`) and in `keys/testA.json` and `keys/testB.json`. They use the helpers in `scripts/lib/`. Test dUSDC comes from the program's faucet, which has a 1 h cooldown per wallet.

## Behaviour coverage

"Devnet" means a real transaction on Solana devnet (L1) or on the MagicBlock TEE ER (`https://devnet-tee.magicblock.app`).

| Behaviour | Test file and test name | Type | Result (date) |
|---|---|---|---|
| **Grip math** | | | |
| Alignment error: 0 at the centre, 10 000 bps at or beyond the edge, saturating, zero radius never grips | `math.rs` `align_err_bounds` | unit | pass (2026-11-27) |
| Grip curve endpoints, using the deployed config **8 500 bps at the centre and 2 500 bps at the edge** (`gripMaxBps: 8500`, `gripMinBps: 2500` in `scripts/setup_devnet.ts`, read by `vrf_grip_callback` from `CabinetConfig`). The curve is monotonic, and a bad min > max cannot underflow. | `math.rs` `grip_curve_endpoints_and_monotonic` | unit | pass (2026-11-27) |
| Grip stays in [2 500, 8 500] for any claw position on the grid (50-unit steps), with capsules at corners and centre and radius 30/60/120. Exactly 8 500 at the centre, 2 500 at or past the edge. | `math.rs` `grip_stays_between_deployed_endpoints_over_the_whole_grid` (new) | unit | pass (2026-11-27) |
| Miss threshold: for every radius from 30 to 120, distance = radius is always a MISS whatever the roll, and distance = radius − 1 is never a MISS | `math.rs` `miss_threshold_is_the_capsule_edge_for_every_radius` (new) | unit | pass (2026-11-27) |
| HELD / SLIP / MISS decision, including the boundary where roll = grip slips | `math.rs` `outcomes_held_slip_miss`, `deterministic_fixed_inputs` | unit | pass (2026-11-27) |
| VRF roll reduced into [0, 10 000) | `math.rs` `roll_range` | unit | pass (2026-11-27) |
| **Slip and moves** | | | |
| Slip pulls the capsule toward the chute by the rolled fraction, in [1 500, 6 500) bps | `math.rs` `slip_frac_range`, `slip_moves_by_the_rolled_fraction_of_the_path` (new), `slip_moves_toward_chute_and_persists_outside_keepout` | unit | pass (2026-11-27) |
| Starting from every grid edge (100-unit steps), from the chute centre, and from every interior point in [600, 1000]² in 20-unit steps (where the keep-out push-back fires), with **every** reachable slip fraction (all 5 000), the capsule stays on the grid, never ends inside the chute keep-out (1 unit of rounding allowed) and never moves away from the chute | `math.rs` `slip_from_every_grid_edge_stays_on_grid_and_out_of_the_chute` (new) | unit | pass (2026-11-27) |
| No overflow at the grid edges: distance and alignment at all four corners with the maximum radius 120, and extreme i32 inputs | `math.rs` `distance_and_alignment_at_grid_corners_with_max_radius` (new), `distance_basic_and_extremes`, `isqrt_exact_and_floor` | unit | pass (2026-11-27) |
| Claw moves and miss nudges never leave the grid from any corner, even with i32::MIN/MAX steps. Steps are capped at 80 per axis. | `math.rs` `move_and_nudge_never_leave_the_grid_from_any_corner` (new), `move_clamps_step_and_grid`, `nudge_offset_range` | unit | pass (2026-11-27) |
| Nearest-capsule pick and nudge targets | `math.rs` `nearest_skips_inactive_and_breaks_ties_low`, `nudge_targets_within_reach_max_two` | unit | pass (2026-11-27) |
| Solvency formula `vault + claimed >= won + liability`, with no u64 overflow | `math.rs` `solvency_rule` | unit | pass (2026-11-27) |
| The TS port matches the Rust math on the same vectors | `scripts/lib/math.test.ts` | unit | exit 0 (2026-11-27) |
| **Turns and session keys** | | | |
| Only the turn owner can move. Another player's valid session key is rejected (`NotYourTurn`). | `tests/invariants.ts` [1] | devnet ER | pass (2026-11-27) |
| An unregistered key cannot `move_claw` or `drop_claw` on a profile (`SessionKeyNotAllowed`) | `tests/invariants.ts` [1] ×2 | devnet ER | pass (2026-11-27) |
| An expired session key is rejected (`SessionExpired`). A session longer than 24 h cannot be registered (`SessionTooLong`). | `tests/invariants.ts` [1], [2] | devnet L1 + ER | pass (2026-11-27) |
| A session key cannot `buy_credits`, `claim_prize` or `cash_out` for the wallet (`ConstraintSeeds`), and cannot `restock` (`ConstraintHasOne`) | `tests/invariants.ts` [2] ×4 | devnet L1 + ER | pass (2026-11-27) |
| A non-authority key cannot `set_keeper` (L1) or `admin_undelegate` (ER) (`ConstraintHasOne`) | `tests/extra_invariants.ts` (new) | devnet L1 + ER | pass (2026-11-27) |
| "Withdraw": the program has **no** withdraw instruction. Vault tokens leave only through `claim_prize` and `settle_prizes`; both are covered in this table. | `programs/clawrush/src/lib.rs`, the full instruction list | code review | n/a |
| Queue → turn → expire: `expire_turn` before the deadline is rejected (`TurnNotExpired`); after it, any unrelated key can clear the turn | `tests/invariants.ts` [4] ×2 | devnet ER | pass (2026-11-27) |
| Two players share the queue: B queues during A's turn, B's turn starts automatically when A's VRF result lands, and A clears B's expired turn | `scripts/e2e_two_player.ts` (8 checks, `docs/E2E_TWO_PLAYER.md`) | devnet ER | 8/8 on **2026-11-26** (cabinet 1). **Not re-run today.** |
| The crank clears an idle turn | `scripts/e2e_crank.ts` | devnet ER | **Not re-run today.** No results doc is in the repo. Added in commit `54586d2` (2026-11-27 14:06 IST). |
| **VRF** | | | |
| `drop_claw` and `drop_claw_public` reject every VRF oracle queue except `DEFAULT_EPHEMERAL_QUEUE` (`5hBR571x…`): `DEFAULT_QUEUE` (`Cuj97ggr…`), `DEFAULT_TEST_QUEUE` and `DEFAULT_EPHEMERAL_TEST_QUEUE` fail with `InvalidParams`. The constants are from `ephemeral-vrf-sdk-0.18.0/src/consts.rs`. Control: the right queue passes the queue check and fails later in the handler (`SessionKeyNotAllowed`, stranger signer). | `tests/extra_invariants.ts` (new) ×8 | devnet ER | pass (2026-11-27 17:00 IST, upgraded program) |
| Only the VRF program identity can call `vrf_grip_callback`. A callback signed by any other key is rejected (`Unauthorized`). | `tests/invariants.ts` [3] | devnet ER | pass (2026-11-27) |
| A drop is resolved by a VRF callback: `pending_vrf` is cleared and the round advances | `tests/invariants.ts` [3] "drop N resolved by exactly one VRF callback" | devnet ER | pass (2026-11-27) |
| **One callback per drop**: a second or stale callback is rejected (`NoVrfPending` / `StaleVrfCallback`, `vrf_nonce` echo) | `play.rs` `vrf_grip_callback`, the first two `require!`s | **code-enforced, not exercised** | See *Known gaps* |
| **Solvency, payout cap, settlement** | | | |
| Restock is rejected if the vault cannot cover the liability (`VaultInsolvent`), while a solvent restock is accepted | `tests/invariants.ts` [5] ×2 | devnet ER | pass in runs 1 and 3. Run 2: the insolvent check failed by a test design flaw, fixed before run 3 (see *Flakiness*). |
| Solvency is checked over the whole batch: two capsules of 14.500001 dUSDC, each under the 25 dUSDC cap, into 29 dUSDC of free vault are rejected (`VaultInsolvent`) | `tests/extra_invariants.ts` (new) | devnet ER | pass (2026-11-27 17:03 IST) |
| **Payout cap**: a capsule of `max_payout_per_round + 1` is rejected for each of the 4 mints, as a token and as a mystery prize (`PayoutTooLarge`). The caps are read from the on-chain config: 25 dUSDC, 2 000 dGEM, 2 KOI, 2 ROBO in base units. | `tests/extra_invariants.ts` (new) ×8 | devnet ER | pass (2026-11-27) |
| A prize is claimed exactly once. The first claim pays the exact pending amount, a second claim is rejected (`NothingToClaim`), a claim while the profile is still delegated is rejected, and a cabinet-1 profile cannot claim from cabinet 2 | `tests/invariants.ts` [6] ×4 | devnet L1 | pass (2026-11-27) |
| One-signature payout (Magic Action `cash_out_and_settle`): the prize lands in the wallet with no `claim_prize`, L1 `pending` is zeroed, a later `claim_prize` is rejected (`NothingToClaim`), and a direct `settle_prizes` is rejected (`Unauthorized`) | `scripts/e2e_magic_action.ts` | devnet ER + L1 | PASS (2026-11-27, cabinet 2, testA). ER `GJMN9bjV…`, L1 commit `2YZ5PGDFMd7p5aefHwEwJXKMrTrT3AXcSZiJcRR8Jw9KWfnqas8nRTzH6YDXbNJuzMRhbFAzQ8GPfoDoysiPw81Z` |
| **Two players, slip then win, exact balances**: A's drop SLIPs the capsule (it stays active, `slip_count` goes 0→1, and it moves 57.4% closer to the chute, from (250,300) to (622,644)). B then aims at the new on-chain position and HOLDs it. After cash out and claim: B +0.5 dUSDC exactly, A +0, vault −0.5 dUSDC exactly. | `tests/e2e_slip_then_win.ts` (new) | devnet ER + L1 | 6/6 pass (2026-11-27, run 2). Slip drop `61sGSA4HJjiicGXeEdEUGMxsbjgcdAKm24KQMHPEMU6HW5j5uctig6o38hvJDNwaZ181mUjo66mfKn8uAo3uqiUb`, win drop `4Lr4SZYhxdFkiphuvfsA51WBrXRGDt7Q68Q2tTRnD9BuCLyJZ5Rxoo42jsVq96mNM4WAhU6zRBkh3tyPy9RMr5ek` (both TEE ER), claim `4ZEEdimJLvYFv6LqbpLyFMZWiZEpjHUoqZgUqNYsjMKoaBVivRqELu9DYF63qGyKdMBraYLcVRuCXbQjs7idJ4CV` (L1) |
| **Private mystery vault** | | | |
| A TEE RPC read of the mystery vault returns null with no token, a stranger's token, or even the authority's token. Control: the public cabinet account reads normally. | `tests/invariants.ts` [7] ×4 | devnet ER | pass (2026-11-27) |
| A public Solana L1 RPC read of the mystery vault PDA (cabinets 1 and 2) holds no prize entry: owner is the delegation program, 0/12 entries set | `tests/extra_invariants.ts` (new) ×2 | devnet L1, read-only | pass (2026-11-27) |
| `drop_claw_public` stays readable while the vault stays unreadable, and the keeper role cannot be used by strangers | `scripts/e2e_public_drop.ts` | devnet ER | **Not re-run today.** No results doc is in the repo. Added in commit `7a7b43c` (2026-11-27 14:13 IST). |
| Restock transaction contents are not recoverable from the TEE RPC | `scripts/check_privacy.ts`, `scripts/check_tx_privacy.ts` | devnet ER, read-only probes | **Not re-run today.** These print a table and assert nothing. |

Earlier evidence for whole rounds, not re-run today: `docs/DEVNET_ROUNDS.md` records 34 attempts, 30 completed (HELD 17, SLIP 5, MISS 8) and 4 failures, with the errors recorded.

## Known gaps

- **One callback per drop is not exercised on devnet.** Only the VRF program can sign as `vrf_program_identity`, so a test cannot send a real second callback. A forged one stops earlier, at the identity check (`Unauthorized`, which is tested). The `pending_vrf` and `vrf_nonce` guards (`NoVrfPending`, `StaleVrfCallback`) are enforced in code but no test reaches them. A local program test (LiteSVM / `solana-program-test`) that fakes the identity signer would cover them; none exists yet.
- **No local program-level tests.** Instruction handlers are only exercised on devnet. Only `math.rs` runs offline. `anchor test` is not used.
- **`drop_claw` by another player's *valid* session key during someone's turn** is untested. `NotYourTurn` is only shown for `move_claw`; `drop_claw` is only tried with an unregistered key.
- **The payout cap is enforced only at restock.** `PayoutTooLarge` appears at one site (`restock_core`). Nothing re-checks it at payout time; capsule amounts cannot change after restock.
- **Payout cap has no positive control.** The tests show cap + 1 is rejected, but not that exactly the cap is accepted. That needs a vault holding at least 25 dUSDC beyond its current liability.
- **Not re-run by the tests agent today:** `scripts/e2e_two_player.ts`, `scripts/e2e_crank.ts`, `scripts/e2e_public_drop.ts` and `app/e2e/round.mjs` (browser). The first three target the live cabinet 1 by default, and `e2e_two_player.ts` needs the keeper stopped. Only `e2e_two_player.ts` has a committed results doc, dated 2026-11-26.
- **Slip keep-out rounding.** The keep-out push-back divides by a floored distance. A 100% pull, which the program can never roll (the maximum is 6 499 bps), lands 2 units inside the 90-unit keep-out. For every reachable fraction and every tested start (grid edges, and the 20-unit lattice within 300 units of the chute), the capsule lands at most 1 unit inside.
- **L1 mystery copy shows `sealed=false`.** The L1 snapshot of the mystery PDA predates sealing on the ER. It carries no prize data, but it is not a "sealed" flag readers can rely on.

## Flakiness and incidents (2026-11-27)

- `tests/e2e_slip_then_win.ts` **run 1: not completed.** A's first drop, aimed just inside the edge (grip 3 100), rolled 1 987 and HELD the capsule before it ever slipped. With this aim a slip is about 69% likely per drop, so this happens by chance. The script now restocks and keeps going when that happens, and counts every prize in the balance checks. Run 2 slipped on its first turn, so **that branch and its balance accounting have not executed yet**. Run 2 passed 6/6.
- `scripts/e2e_magic_action.ts` on cabinet 2:
  - **Attempt 1 crashed.** Cabinet 2 had no token capsule, because the invariant suite had just won it. The script also assumes one exists.
  - **Attempt 2 was rejected with `StillQueued` (0x177c).** testA's turn from attempt 1 had expired but nothing had cleared it, and cabinet 2 has no crank.
  - I cleared the expired turn with a permissionless `expire_turn`, restocked one 0.5 dUSDC capsule as admin, and **attempt 3 passed**. These were test-setup issues, not program failures.
- `tests/invariants.ts` **run 2 (post-upgrade) failed 1 check, test design.** The "insolvent restock" check builds one capsule of `vault − liability + 1 dUSDC`. Credit purchases had grown the vault to 29.5 dUSDC, so that capsule (30.5 dUSDC) is above the 25 dUSDC payout cap, and the program correctly rejects it first with `PayoutTooLarge` (0x177e) instead of `VaultInsolvent`. Solvency is still proven by the batch check in `tests/extra_invariants.ts`. Fixed: the check now splits the amount across capsules of at most 20 dUSDC each; run 3 passed 23/23.
- `tests/invariants.ts` run 1 passed 23/23 on its first try today. It takes about 3 minutes, partly a deliberate wait for a 60 s session to expire.
- Network: devnet and TEE calls time out on this machine without `NODE_OPTIONS=--dns-result-order=ipv4first`.

## How to run

```bash
# offline
cargo test -p clawrush --lib
npx tsx scripts/lib/math.test.ts

# devnet, test cabinet 2 (uses keys/testA.json, keys/testB.json and the admin key; costs devnet SOL only)
export NODE_OPTIONS=--dns-result-order=ipv4first
CABINET_ID=2 npx tsx tests/invariants.ts         # rewrites docs/INVARIANTS.md
CABINET_ID=2 npx tsx tests/extra_invariants.ts
CABINET_ID=2 npx tsx tests/e2e_slip_then_win.ts  # exit 0 pass, 1 fail, 2 not completed (VRF luck); MAX_TURNS=10 by default
PLAYER=testA CABINET_ID=2 npx tsx scripts/e2e_magic_action.ts   # needs an active token capsule on cabinet 2

# devnet, live cabinet 1 (stop scripts/keeper.ts first)
npx tsx scripts/e2e_two_player.ts
```
