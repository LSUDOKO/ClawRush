# ClawRush: guide for judges

**One claw, every player, real prizes.** A live multiplayer claw machine you play from your phone, on Solana devnet
and the MagicBlock TEE Ephemeral Rollup. Built for MagicBlock Solana Blitz v10 (Entertainment Finance).

| | |
|---|---|
| Live app | https://clawrush.pages.dev (phone, portrait; devnet) |
| Repo | https://github.com/LSUDOKO/ClawRush |
| Program | [`9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs`](https://explorer.solana.com/address/9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs?cluster=devnet) |
| Demo video | TODO (owner adds YouTube link) |
| Deeper docs | [ARCHITECTURE.md](ARCHITECTURE.md) · [TESTING.md](TESTING.md) · [SECURITY.md](SECURITY.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [BUSINESS.md](BUSINESS.md) · [docs/DECISIONS.md](docs/DECISIONS.md) |

Everything here is devnet. Prize tokens (dUSDC, dGEM, KOI, ROBO) are demo tokens with no value.

## 1. Executive summary

Many phones share one cabinet that lives on a MagicBlock Ephemeral Rollup. Each player gets a 15 s turn. Moves cost
no fee and need no wallet popup. Capsules stay where they land. **Your aim sets the grip chance** (85% dead centre,
25% at the edge), then **MagicBlock VRF** rolls it (the roll has a small modulo bias, so the real hold chance is 86.3% / 26.7%;
SECURITY.md F-09). Jackpots sit only in **mystery capsules**, and their contents
are sealed in a TEE-backed private account that no RPC caller can read, not even with the authority's token. (The
key that restocks knows what it stocked; see SECURITY.md F-08.) When you cash out, one ER
transaction commits your profile back to Solana, and a **Magic Action** pays every prize to your wallet. An
**ER crank** clears idle turns without a server.

## 2. Problem and solution

| Problem | ClawRush answer |
|---|---|
| On-chain claw games are a show: RNG decides, aim does nothing | Integer grip math: alignment at drop time sets the hold chance, VRF only rolls against it |
| One player per machine, nothing persists | One shared cabinet account on the ER, a queue and turns. Slipped capsules stay where they stopped |
| Readable on-chain prizes let bots snipe jackpots | Mystery contents live in a private-permission account inside the TEE. The public cabinet shows mint 0 / amount 0 |
| Prizes stuck in a rollup, or a second claim transaction | `cash_out_and_settle` does commit, undelegate and a post-undelegate Magic Action in one ER transaction |
| Wallet popup on every move | A scoped session key, accepted (through `authorize`) only by `join_queue`, `move_claw` and `drop_claw` / `drop_claw_public` |

## 3. Technical novelty

- **Skill × VRF**: grip comes from `align_err_bps` measured on chain when the claw drops (`drop_core` stores
  `drop_align_bps` before the randomness request). The VRF callback only rolls `roll_bps < grip_bps`.
- **Persistent shared physics**: SLIP moves the capsule toward the chute (`slip_toward_chute`), MISS nudges up to two
  neighbours (`nudge_targets`). Both write the shared `CabinetState` that the next player sees.
- **Public drop, private vault**: `drop_claw_public` derives the mystery vault address on chain and passes it only
  to the VRF callback's account metas. The drop transaction stays readable to everyone. Only the callback, which
  reads the vault, is redacted by the TEE.
- **Payout as a Magic Action**: `settle_prizes` can only run with the delegation program's escrow PDA as signer, so
  nobody can call it directly. It only loads once the profile is back under the program.
- **Solvency enforced on chain**: every restock recomputes per-mint liability over all live capsules, including
  sealed mystery entries. It is rejected with `VaultInsolvent` if the vault can't cover it.

## 4. Why it is hard to copy

- Four MagicBlock primitives depend on each other here: TEE ER, VRF, private permission and Magic Action, plus the
  crank. The private vault needs the TEE validator, so the whole cabinet runs on it (decision 1). The drop has to
  name the vault without listing it (decision 23). The payout must be post-*undelegate*, not post-commit
  (decision 22).
- A real SDK problem was worked around: the `#[vrf_callback]` macro's runtime identity hash used up the callback's
  compute budget. The program declares a compile-time `VRF_IDENTITY` instead (decision 3).
- The economics are tuned and simulated: visible prizes are capped near one play and jackpots live only in sealed
  capsules, so even a perfect aim-bot stays under 100% ([scripts/ev_results.md](scripts/ev_results.md)).

## 5. MagicBlock integration depth

| Primitive | Where in code | Proven by |
|---|---|---|
| Ephemeral Rollup (TEE validator `MTEWGuqx…`) | `delegate_cabinet`, `delegate_player` (`#[delegate]`, `del` accounts); all play instructions run on the ER | [delegate_cabinet tx](https://explorer.solana.com/tx/2FzY9oJrQXab58GSnLmjZ6ShPzQnAnvi4zkzxRKjLLSkd4LGGMqU4vX2WctvvKXxmZyXv5dgELXfNk1cHpWN2G7v?cluster=devnet) |
| VRF | `drop_core` → `create_request_randomness_ix_const`; `vrf_grip_callback` | 30 completed devnet rounds, median callback 205 ms ([docs/DEVNET_ROUNDS.md](docs/DEVNET_ROUNDS.md)) |
| Private ER (permission program) | `seal_mystery` → `CreateEphemeralPermissionCpi { is_private: true, members: [] }` | [docs/INVARIANTS.md](docs/INVARIANTS.md) invariant 7 |
| Commit + undelegate + Magic Action | `cash_out_and_settle` (`MagicIntentBundleBuilder`, `add_post_undelegate_actions`) → `settle_prizes` (`#[action]`) | [L1 ProcessUndelegation + SettlePrizes](https://explorer.solana.com/tx/31j7usJPvqmit6iJB7a43HMTnfVZvoC7YjKrdYcBE4QumEBR1KHNCFjDd3WtboAo8qqhKXCUPpxQQUixXQRyBxea?cluster=devnet) |
| Crank (ER scheduler) | `schedule_crank` (`ScheduleCrankCpi`) → `crank_tick` | [crank_tick tx](https://explorer.solana.com/tx/31BH7Arp96NU5xS8BDrEhzrxeYHA8Bza3bRhmjCq3Jj5cHqQHZEQ8eR87ML44WdRbuYnsJAjEYQn8Wk4Lks289FK?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) (cleared 15.5 s after the turn went idle, per README) |
| TEE auth token | `getAuthToken` in `app/src/lib/chain.ts` (`erFor`) and `scripts/lib/common.ts` | every ER transaction the app sends |

Not used: Magic Router (the app and scripts connect straight to `https://devnet-tee.magicblock.app` and devnet
L1), and MagicBlock Session Keys (ClawRush has its own scoped key, decision 5). SDK: `ephemeral-rollups-sdk 0.18.0`
(Rust + npm). Details in [ARCHITECTURE.md](ARCHITECTURE.md).

## 6. Claims and how to verify them

All paths are relative to the repo root. Program files are under `programs/clawrush/src/`. Function names were
checked with grep against the code on 2026-11-27. Every transaction linked in this file was re-fetched from devnet
or the TEE RPC on 2026-11-27 and returned success with the expected instruction in its logs.

| Claim | How it works | File path(s) + function names | How to verify | Evidence |
|---|---|---|---|---|
| **Live shared cabinet on the ER** | One `CabinetState` PDA `["cabinet", id]` holds claw, 12 capsules, a 16-slot queue and the turn. It is delegated to the TEE ER. `join_queue` starts a turn or enqueues. When a turn ends, `advance` pops the next player | `instructions/admin.rs`: `delegate_cabinet`; `instructions/play.rs`: `join_queue`, `move_claw`; `state.rs`: `queue_push`, `queue_pop`, `advance` | `npx tsx scripts/e2e_two_player.ts` (stop the keeper first); read the cabinet live: `getAccountInfo EUK77P9z…` on `https://devnet-tee.magicblock.app` (no token needed) | [docs/E2E_TWO_PLAYER.md](docs/E2E_TWO_PLAYER.md): 8/8, run 2026-11-26 on the earlier `drop_claw` / `cash_out` path; [join_queue](https://explorer.solana.com/tx/5YVKpXCc7WBBCbv5uZmTRqRBjrmahPtdxkY3aqK8nbKcrHe3Z7BHfvhvXR33MQ1pApQmwgASPZxhVinESN7PsreH?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) · [move_claw](https://explorer.solana.com/tx/5bjqZesyUdyan4CPhKdt9gRFCTb8DbpzTh6bKSNnTpqtREKbcghidCi3rbk3f6yRQdm7TrNBb3tQyze71peA9cQr?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app). Owner-reported 2026-11-27: a browser and a phone played the live cabinet at the same time (no tx list in the repo) |
| **Zero wallet popups while playing** | Session start is one L1 transaction (`init_player` if needed, `faucet` if needed, `buy_credits`, `register_session_key`, `delegate_player`). After that the in-browser session key signs every join, move and drop. Only cash-out needs the wallet again (one TEE login message + one transaction, plus a token-account transaction the first time) | `instructions/player.rs`: `register_session_key` (≤ `MAX_SESSION_SECS` = 24 h); `instructions/play.rs`: `authorize` (called by `join_queue`, `move_claw`, `drop_core`); `app/src/components/Game.tsx`: `startSession`, `join`, `drop`, `cashOut`; `app/src/lib/burner.ts`: `newSession` | Play at https://clawrush.pages.dev: one approval at "Start session", none until "Cash out" | ER [drop_claw_public tx](https://explorer.solana.com/tx/35o1tkTR8FCv84F1x9caoWZFupWewuZzEpyzcFKhYopAC3jinANt94GWm7iXoT332CFTZYDcejgtVa8uUtnWcgJB?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) from the phone run: re-fetched from the TEE RPC on 2026-11-27, `DropClawPublic`, fee 0 (that the signer was the session key is from the owner's report; not re-decoded). **Limit:** Solflare mobile refuses to sign the ER cash-out ("network mismatch"); play works, cash-out needs the burner or a desktop wallet |
| **Session key can't spend, pay out, cash out or administer** | Every instruction that spends, pays, cashes out or administers derives the profile PDA from the signing wallet (`["player", id, authority]`) or checks `has_one = authority`, so a session key never matches. (`expire_turn` and `crank_tick` are permissionless by design, and the app signs `expire_turn` with the session key) | `instructions/play.rs`: `authorize`; contexts `BuyCredits`, `ClaimPrize`, `CashOut`, `CashOutAndSettle` seed on `authority.key()` | `CABINET_ID=2 npx tsx tests/invariants.ts` | [docs/INVARIANTS.md](docs/INVARIANTS.md) invariant 2: `buy_credits`, `claim_prize`, `cash_out` → `ConstraintSeeds`; restock → `ConstraintHasOne`; > 24 h → `SessionTooLong` |
| **Skill affects grip** | At drop: nearest active capsule, `align_err_bps = min(10_000, d·10_000/radius)`, `grip = grip_max − (grip_max − grip_min)·align/10_000` (8_500 → 2_500 bps). Stored in `drop_align_bps` **before** randomness is requested | `math.rs`: `nearest`, `distance`, `align_err_bps`, `grip_bps`, `outcome`; `instructions/play.rs`: `drop_core`, `vrf_grip_callback` | `cargo test -p clawrush --lib` (e.g. `grip_curve_endpoints_and_monotonic`, `outcomes_held_slip_miss`); `npx tsx scripts/lib/math.test.ts`; Proof drawer re-check (✓) in the app | [docs/DEVNET_ROUNDS.md](docs/DEVNET_ROUNDS.md): align 0 → grip 8500, align 6000 → grip 4900, align 10000 → MISS; simulation: beginner 33.0% vs perfect bot 86.2% return ([scripts/ev_results.md](scripts/ev_results.md)) |
| **VRF can't be rigged by the player or operator** | Randomness comes from the MagicBlock VRF oracle. The callback must be signed by the program's scoped VRF identity. `pending_vrf` plus a per-drop `vrf_nonce` allow exactly one callback per drop. Alignment is fixed before the request. The player's `client_seed` is one byte mixed into the caller seed, and the oracle produces the randomness. Drops only accept the ER VRF queue (SECURITY.md F-01, fixed and redeployed today) | `instructions/play.rs`: `drop_core` (`create_request_randomness_ix_const`), `VrfGripCallback` (`vrf_program_identity` = `VRF_IDENTITY`), `vrf_grip_callback` (`NoVrfPending`, `StaleVrfCallback`), `expire_turn` (refund after `VRF_TIMEOUT_SECS` = 30 s) | `CABINET_ID=2 npx tsx tests/invariants.ts` | [docs/INVARIANTS.md](docs/INVARIANTS.md) invariant 3: forged callback → `Unauthorized`; drop 1 resolved by exactly one callback (latest run: HELD after 165 ms). Trust assumption: the MagicBlock VRF oracle itself |
| **Slips persist across players** | SLIP moves the capsule `slip_frac_bps` of the way to the chute (stopping outside `CHUTE_KEEP_OUT`) and increments `slip_count`, in the shared `CabinetState`. `advance` resets only the claw and the turn, never the capsules | `instructions/play.rs`: `vrf_grip_callback` (SLIP / MISS branches); `math.rs`: `slip_frac_bps`, `slip_toward_chute`, `nudge_targets`, `nudge_offset`; `state.rs`: `advance` | `cargo test -p clawrush --lib` (`slip_moves_toward_chute_and_persists_outside_keepout`, `nudge_targets_within_reach_max_two`); read `capsules[].x/z/slip_count` from the cabinet account before and after a SLIP | `CABINET_ID=2 npx tsx tests/e2e_slip_then_win.ts` (new today): A's drop SLIPs the capsule (`slip_count` 0→1, moved to (622,644)); B aims at the on-chain position and HOLDs it; balances change by exactly 0.5 dUSDC. 6/6 on run 2; run 1 was "not completed" (HELD before any slip, VRF luck) ([TESTING.md](TESTING.md)). Claim tx [4ZEEdimJ…](https://explorer.solana.com/tx/4ZEEdimJLvYFv6LqbpLyFMZWiZEpjHUoqZgUqNYsjMKoaBVivRqELu9DYF63qGyKdMBraYLcVRuCXbQjs7idJ4CV?cluster=devnet) re-fetched (`ClaimPrize`); its drop txs come back from the TEE without logs. Also 5 SLIP rounds in [docs/DEVNET_ROUNDS.md](docs/DEVNET_ROUNDS.md) (2026-11-26) |
| **Mystery contents unreadable before reveal** | `seal_mystery` puts a private, zero-member permission on the `MysteryVault`. `restock_core` writes the real prize only there; the public capsule gets mint 0 / amount 0. `drop_claw_public` never lists the vault. A HELD on a mystery capsule reads and clears the entry inside the TEE, then emits `MysteryRevealed` | `instructions/admin.rs`: `seal_mystery`, `restock_core`; `instructions/play.rs`: `drop_claw_public`, `vrf_grip_callback`; `scripts/lib/stock.ts`: `drawMystery` (crypto randomness at restock, never written to disk) | `CABINET_ID=2 npx tsx tests/invariants.ts`; `npx tsx scripts/check_privacy.ts`; `npx tsx scripts/check_tx_privacy.ts`; or `getAccountInfo EJ6x3enxHQ9MavJj1DVyejAaznepp889fzesYb4iCPa1` on the TEE RPC | [docs/INVARIANTS.md](docs/INVARIANTS.md) invariant 7: `null` with no token, a stranger's token and the authority's token; re-probed 2026-11-27 11:16 UTC: vault `null`, public cabinet 1301 bytes. Restock txs come back as empty stubs (decision 14). `scripts/e2e_public_drop.ts` won a mystery capsule (300 dGEM revealed and credited, decision 23) |
| **Prizes settle to the wallet** | A win credits `profile.pending` on the ER. `cash_out_and_settle` commits and undelegates the profile and attaches `settle_prizes` as a post-undelegate action. `settle_prizes` needs the escrow PDA as signer, binds `escrow_auth` to the profile owner, pays every non-zero `pending` and zeroes it. `claim_prize` is the fallback; it also zeroes `pending` | `instructions/auto.rs`: `cash_out_and_settle`, `settle_prizes`, `SettlePrizes` (escrow constraint); `instructions/player.rs`: `claim_prize`; `instructions/play.rs`: `cash_out` | `npx tsx scripts/e2e_magic_action.ts`; `CABINET_ID=2 npx tsx tests/invariants.ts` | L1 [ProcessUndelegation + SettlePrizes](https://explorer.solana.com/tx/31j7usJPvqmit6iJB7a43HMTnfVZvoC7YjKrdYcBE4QumEBR1KHNCFjDd3WtboAo8qqhKXCUPpxQQUixXQRyBxea?cluster=devnet) (1 dUSDC, browser e2e) and the [phone settlement](https://explorer.solana.com/tx/5uehoYGrCnNN6obWDi7jrcYunLKzaXwwUDp2KWLE8yxP27LemTe2kDECePG8vn2iVGNpkwnavbe47bhJQfvFM4Vg?cluster=devnet) (1.1 dUSDC + 75 dGEM, incl. a mystery capsule). Both re-fetched 2026-11-27: success, logs `ProcessUndelegation`, `SettlePrizes`. Invariant 6: second claim → `NothingToClaim`, cross-cabinet → `ConstraintSeeds` |
| **A perfect bot can't drain the vault** | On chain: `restock_core` rejects any prize above `max_payout_per_round` (`PayoutTooLarge`) and any restock where a mint's vault balance can't cover all live liability (`VaultInsolvent`, via `is_solvent`). Stocking policy (off chain): visible prizes ≤ ~1 play, jackpots only in mystery capsules (`scripts/lib/stock.ts`), grip capped at 85% | `instructions/admin.rs`: `restock_core`, `restock`, `restock_by_keeper`; `math.rs`: `is_solvent`; `scripts/lib/stock.ts`; `scripts/ev_simulation.ts` | `npx tsx scripts/ev_simulation.ts` (writes `scripts/ev_results.md`); `cargo test -p clawrush --lib` (`solvency_rule`); `CABINET_ID=2 npx tsx tests/invariants.ts` | [scripts/ev_results.md](scripts/ev_results.md): perfect bot 86.2% return, min(vault − live liability) 290.55 plays, never below 0. Invariant 5: a capsule worth more than the vault holds → `VaultInsolvent`. The < 100% return is a stocking policy plus simulation, not an on-chain RTP cap. Caveats for privileged keys: decoy vault token accounts (F-04) and loose keeper stock bounds (F-07) in [SECURITY.md](SECURITY.md); on devnet the faucet is Sybil-able (F-03) |
| **Idle players can't block the cabinet** | `crank_tick` runs every 3 s on the ER scheduler and ends overdue turns. It is permissionless and does nothing on time. `expire_turn` is also permissionless and the app sends it itself | `instructions/auto.rs`: `schedule_crank`, `crank_tick`; `instructions/play.rs`: `expire_turn` | `npx tsx scripts/e2e_crank.ts`; invariant 4 | [crank_tick tx](https://explorer.solana.com/tx/31BH7Arp96NU5xS8BDrEhzrxeYHA8Bza3bRhmjCq3Jj5cHqQHZEQ8eR87ML44WdRbuYnsJAjEYQn8Wk4Lks289FK?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) (15.5 s, README); app self-clear 16.1 s (decision 18) and 16.7 s (`app/e2e/shots/proof-links.txt`); invariant 4: early expiry → `TurnNotExpired` |

## 7. User workflow

1. Open https://clawrush.pages.dev on a phone. Connect a devnet wallet (Phantom, Solflare or MWA are wired in; on a
   real Android phone only the burner, end to end, and Solflare, without cash-out, were tested) or the labelled devnet burner.
2. **Start session**: one approval runs faucet (demo dUSDC), buy credits, register the session key and delegate the profile to the ER.
3. **Insert credit** → `join_queue`. On your 15 s turn, steer with the joystick, flip FRONT / SIDE to judge depth, watch
   the predicted grip meter (the program's own integer math, `app/src/lib/math.ts`), then DROP.
4. VRF result: HELD (prize to `pending`), SLIP (capsule moves and stays), or MISS (neighbours nudged). The Live Proof
   drawer shows `Alignment → Grip → VRF roll → outcome`, re-checks it in the browser, and links every transaction.
5. Waiting players watch in ORBIT view. **Cash out**: commit + undelegate + Magic Action payout to the wallet.

## 8. Testing evidence

Full matrix and commands: [TESTING.md](TESTING.md).

| Suite | Kind | Result | Report |
|---|---|---|---|
| `cargo test -p clawrush --lib` | Rust unit tests for `math.rs` | 21 passed (20 math tests + Anchor's `test_id`; 6 added today) | [TESTING.md](TESTING.md) |
| `CABINET_ID=2 npx tsx tests/extra_invariants.ts` | Extra devnet invariants (new) | 12/12 | [TESTING.md](TESTING.md) |
| `CABINET_ID=2 npx tsx tests/e2e_slip_then_win.ts` | Slip persists, next player wins it, exact balances (new) | 6/6 on run 2; run 1 not completed (VRF luck) | [TESTING.md](TESTING.md) |
| `npx tsx scripts/lib/math.test.ts` | TS port matches the Rust vectors | pass (MORNING_REPORT.md) | [MORNING_REPORT.md](MORNING_REPORT.md) |
| `CABINET_ID=2 npx tsx tests/invariants.ts` | 7 invariants as real devnet / TEE txs | 23/23 (latest run date in the report) | [docs/INVARIANTS.md](docs/INVARIANTS.md) |
| `npx tsx scripts/e2e_two_player.ts` | Shared queue, two players | 8/8, 2026-11-26 (earlier drop/cash-out path) | [docs/E2E_TWO_PLAYER.md](docs/E2E_TWO_PLAYER.md) |
| `scripts/devnet_rounds.ts` | Real rounds | 34 attempts: 30 completed (HELD 17 / SLIP 5 / MISS 8), 4 failures recorded | [docs/DEVNET_ROUNDS.md](docs/DEVNET_ROUNDS.md) |
| `scripts/e2e_magic_action.ts`, `e2e_crank.ts`, `e2e_public_drop.ts` | Payout, crank, public drop + keeper role | see the README table and decisions 22–23 | [README.md](README.md#security-model) |
| `app/e2e/round.mjs` | Playwright on the deployed URL (390×844) | round + timeout recovery + cash-out | `app/e2e/shots/proof-links.txt` |
| `scripts/ev_simulation.ts` | Monte Carlo, 100,000 turns per population | beginner 33.0% < skilled 78.0% < perfect 86.2% | [scripts/ev_results.md](scripts/ev_results.md) |

## 9. Security evidence

Threat model and review: [SECURITY.md](SECURITY.md). Short version:

- The session key is accepted only by `authorize` in `join_queue`, `move_claw`, `drop_core`, and lasts at most 24 h.
- Profiles are per cabinet (`["player", cabinet_id, wallet]`). A real bug that let a cabinet-1 prize be claimed
  from cabinet 2 was found and fixed, with a regression check (decision 10, invariant 6).
- The VRF callback is identity-gated, takes one callback per drop, and refunds the credit after 30 s if the VRF is stuck.
- `settle_prizes` needs the delegation program's escrow signature. `claim_prize` and `settle_prizes` both zero
  `pending` (exactly once).
- The keeper role (`set_keeper` / `restock_by_keeper`) can only restock, under the same bounds. It never holds the
  cabinet authority, which is also the upgrade key.
- Known risk: `admin_undelegate` is an emergency path that makes unrevealed mystery contents public (decision 13).
- Open findings from today's review: vault ATA pinning (F-04) and roll modulo bias
  (F-09) need a program upgrade; app security headers (F-10) are an app change. See [SECURITY.md](SECURITY.md#7-findings).

## 10. Deployment evidence

| Item | Value |
|---|---|
| App | Cloudflare Pages project `clawrush`, static Next.js export → https://clawrush.pages.dev |
| Program | `9UwwBZu5…` on devnet, [latest upgrade tx](https://explorer.solana.com/tx/54X1UbEgZ5N8PgFbvGtXULtA9URK4NhUk6kvyHn4JXATLTNvaCkGEFWu2kvYPSBmGWGDokW1fuURBi89u2eB9buw?cluster=devnet) |
| Cabinet | config [`CLaFhSGw…`](https://explorer.solana.com/address/CLaFhSGwWV96RqhR49LoWyxfrJo9e7jQGbeDWTdckWDv?cluster=devnet), state [`EUK77P9z…`](https://explorer.solana.com/address/EUK77P9zFtQDdivoMEcktcGfs9wHPdyydbtiG1P62w5S?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) on the TEE ER, vault [`7FYk2SBg…`](https://explorer.solana.com/address/7FYk2SBgXR3uM7YtdP5Kg9qMF1D1T5zKF8QFGvRMojf2?cluster=devnet) |
| Automation | ER crank (`scripts/crank.ts`); hosted keeper restock every 10 min (`.github/workflows/keeper.yml`, needs the `KEEPER_KEYPAIR` secret) |

Steps: [DEPLOYMENT.md](DEPLOYMENT.md). Full proof table: [README.md](README.md#on-chain-proof-devnet).

## 11. Business potential

House edge on every play (beginner 33% → perfect bot 86% return in simulation). Cabinets that operators or sponsors
stock are a future option. One page, with sourced competitors: [BUSINESS.md](BUSINESS.md).

## 12. What's next

[ROADMAP.md](ROADMAP.md): Solflare-mobile cash-out, restock from a program-held secret (so the crank can restock),
Metaplex Core 1-of-1 collectibles, more cabinets, and an audit before any mainnet use.
