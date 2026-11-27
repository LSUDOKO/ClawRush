# Security review — ClawRush

> **Internal review and automated checks only — not an independent third-party audit.**

Scope: the Anchor program `programs/clawrush/src` (all files, program id
`9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs`), the app's transaction code `app/src/lib/chain.ts` and
`app/src/lib/burner.ts`, and the script helpers in `scripts/lib/`. Reviewed on 2026-11-27 against
commit `612e1e4` on `main`. Network: Solana devnet + MagicBlock devnet TEE ER. All tokens are demo tokens.

No program code was changed by this review. Everything marked **open** needs a program upgrade, which
was out of scope for the submission freeze.

## Reporting a vulnerability

Open a private GitHub security advisory on this repository (Security → Report a vulnerability), or an
issue without exploit details asking for a contact. Devnet only; there is no bug bounty.

---

## 1. Architecture summary

| Layer | Accounts | Who writes them |
|---|---|---|
| Solana devnet (L1) | `CabinetConfig ["config", id]` (params, mint registry, `total_claimed`), vault authority PDA `["vault", id]` and its four prize ATAs, `KeeperRole ["keeper", id]`, faucet mint authority `["faucet"]` | `init_cabinet`, `set_keeper` (authority); `buy_credits`, `faucet`, `claim_prize` (player wallet); `settle_prizes` (Magic Action) |
| MagicBlock TEE ER (delegated) | `CabinetState ["cabinet", id]` (public: claw, capsules, turn, queue, last result), `MysteryVault ["mystery", id]` (private EphemeralPermission, no members), `PlayerProfile ["player", id, wallet]` while playing | gameplay instructions, VRF callback, crank, restock |

Flow: the wallet buys credits on L1 and delegates its profile to the cabinet's validator
(`delegate_player` pins `config.validator`). On the ER, a scoped session key signs `join_queue`,
`move_claw`, `drop_claw(_public)`. A drop sets `pending_vrf` and asks MagicBlock VRF for randomness; the
VRF program calls `vrf_grip_callback`, which resolves HELD / SLIP / MISS, reveals a mystery capsule from
the private vault on a win and credits `profile.pending`. The wallet then signs `cash_out_and_settle`:
commit + undelegate the profile and a post-undelegate Magic Action `settle_prizes` that pays `pending`
from the vault ATAs on L1. `claim_prize` is the manual fallback. A scheduled `crank_tick` ends idle turns.

## 2. Assets protected

1. Prize vault balances (four SPL mints held by the vault PDA).
2. Players' won-but-unpaid prizes (`PlayerProfile.pending`) and credits.
3. Secrecy of mystery capsule contents until they are won.
4. Fairness of the grip roll (no one can choose or predict the outcome).
5. Liveness of the shared cabinet (turns move, nobody can hold the claw).
6. Player keys: wallet, opt-in burner wallet, session keys.

## 3. Trust assumptions

| Party | Trusted for | If it misbehaves |
|---|---|---|
| **MagicBlock TEE validator** (`MTEWGuqx…`, pinned in `config.validator`) | Executing ER instructions faithfully, ordering transactions, the ER clock, honest commits back to L1, keeping the mystery vault and redacted transactions unreadable (TEE attestation) | It could commit arbitrary `pending` values; `claim_prize`/`settle_prizes` pay `pending` exactly as committed with no L1-side bound other than the vault balance. It could reorder/censor drops, or read mystery contents. This is the core trust assumption of any ER design. |
| **MagicBlock delegation program** | Ownership of delegated accounts, commit/undelegate, signing the action escrow PDA only for post-undelegate actions | `settle_prizes` relies on it (escrow signer + `source_program`). Impact is bounded: even a spoofed call only pays a profile's own `pending` to token accounts owned by that profile's wallet. |
| **MagicBlock VRF oracle + program** | Unbiased randomness; delivering the callback | A malicious oracle sees the randomness before submitting and could withhold an unwanted result; the drop then times out and `expire_turn` refunds the credit. It cannot forge a result for a different seed. |
| **Cabinet authority** (`config.authority`, also the program upgrade key) | Cabinet params, restock, keeper assignment, crank schedule, `admin_undelegate` | Full control: can upgrade the program, restock, and run `admin_undelegate` (which publishes unrevealed mystery contents, see F-11). Single key, no multisig/timelock (devnet). |
| **Keeper key** (`KeeperRole.keeper`) | Restock only, through the same bounds and solvency checks | Knows mystery contents at draw time (they are drawn client-side in `scripts/lib/stock.ts` with `crypto.randomInt` and sent in the restock instruction). Can stock any capsule up to `max_payout_per_round` anywhere on the grid, so a compromised keeper colluding with a player can pay out the vault's surplus (F-07, F-08). Cannot withdraw or touch `pending`. |
| **Solana devnet / RPCs** | L1 execution and data | Standard. |

## 4. Attack surfaces

- 24 program instructions (L1 setup/admin, L1 player, ER gameplay, VRF callback, crank, Magic Action).
- Session keys held in browser `localStorage`.
- The opt-in burner wallet (full secret key in `localStorage`).
- The TEE RPC (auth token per signer) and its transaction redaction.
- The static Next.js export on Cloudflare Pages (client code, no server).
- Admin/keeper scripts and their key files (`keys/`, `~/.config/solana/id.json`, never committed).

## 5. Method

1. Manual line-by-line read of every program file: signer and owner checks, PDA seeds, account
   substitution, delegated-account handling, VRF callback, settlement, arithmetic, queue/turn logic,
   mystery data flow, solvency.
2. Read of the client transaction builders (`chain.ts`, `burner.ts`) and `scripts/lib/*` (PDA
   derivation, restock path, logging of mystery contents).
3. Cross-check against the existing devnet evidence: `docs/INVARIANTS.md` (23/23 checks),
   `docs/E2E_TWO_PLAYER.md`, `docs/DECISIONS.md`.
4. Automated tools (section 6). No exploit transactions were sent to the live cabinets during this review.

## 6. Tools and results

| Tool | Command | Result |
|---|---|---|
| Clippy (rustc 1.93) | `cargo clippy -p clawrush` | Builds. 30 warnings (17 duplicates), all style: `needless_range_loop`, `needless_update` (play.rs:196), `unnecessary_map_or` (math.rs:124), `diverging_sub_expression` from the `#[program]` macro. No correctness or security lints. |
| cargo-audit (1571 advisories) | `cargo audit` | **1 vulnerability, 3 warnings**, all transitive through `ephemeral-rollups-sdk 0.18.0` / `solana-program 2.3.0`, none in ClawRush code. `rkyv 0.7.46` RUSTSEC-2026-0235 (archive validation OOB read; via `magicblock-delegation-program-api`, used for host-side archive parsing, not reachable from untrusted input in this program). Warnings: `bincode 1.3.3` unmaintained, `libsecp256k1 0.6.0` unmaintained, `rand 0.7.3` unsound with a custom logger. Fix requires an upstream SDK bump. |
| npm audit (root) | `npm audit --omit=dev` | 15 (2 low, 8 moderate, 5 high). Highs: `toml` (via `@coral-xyz/anchor`, no fix), `bigint-buffer` (via `@solana/spl-token`). Scripts only; they parse local trusted files. |
| npm audit (app) | `cd app && npm audit --omit=dev` | 14 (2 low, 6 moderate, 6 high). Highs: `@coral-xyz/anchor`→`toml`, `@solana/spl-token`→`bigint-buffer`, `postcss` (build-time, via `next`). Moderate: `next`, `@solana/web3.js`→`jayson`/`stream-json`/`uuid`, `@magicblock-labs/ephemeral-rollups-sdk`; low: `elliptic` via `@phala/dcap-qvl`. Fixes are breaking upgrades (web3.js 3.x, next 16.4). The shipped site is a static export: `toml`/`postcss`/`jayson` code paths are not fed attacker input in the browser. |
| gitleaks 8.21.2 | `gitleaks git . --redact` | 53 commits scanned (`git rev-list --all` = 55), **1 hit, false positive**: `generic-api-key` at `app/src/lib/burner.ts:4` (commit `a2d92b15`), which is the localStorage key *name* `"clawrush.burner.v1"`, not a secret. |
| Custom history grep | `git log -p --all` for 64-number JSON arrays, 86–88 char base58 strings, `sk-`/`AKIA`/`ghp_`/`AIza`/PEM headers, `key=`/`secret=`/`token=` literals | No keypair arrays, no API keys, no PEM. About 1,200 base58 64-byte strings, every one a transaction signature (`"sig"`, `"dropSig"`, `explorer.solana.com/tx/…` contexts). No file under `keys/` or any `*.json` keypair has ever been committed; `.gitignore` covers `keys/`, `*keypair*.json`, `id.json`, `.env*`, `*.pem`, `*.key`. |
| Rust unit tests | (tests agent) | 15 math tests incl. `solvency_rule` overflow cases; see TESTING.md. |
| Devnet invariant suite | `tests/invariants.ts` | 23/23 pass (`docs/INVARIANTS.md`), used below as evidence. |

Not run: Soteria / sec3 X-ray / Trident fuzzing (no time in the freeze), mainnet anything.

## 7. Findings

Severity: **High** = loss of funds or secrets by an unprivileged party; **Medium** = unprivileged
griefing/economic abuse or privileged loss; **Low** = needs a privileged key, small impact, or UX
liveness; **Info** = hardening.

| ID | Severity | Location | Description | Status |
|---|---|---|---|---|
| F-01 | Medium | `play.rs` `DropClaw`, `DropClawPublic`; `auto.rs:38` | **Player-selected VRF queue + refunded timeout = free turn stall.** `drop_claw(_public)` accepts four oracle queues (ephemeral, L1 `DEFAULT_QUEUE`, and two *test* queues); the app always uses the ephemeral queue `5hBR571x…`. If a request to a queue that does not serve this ER is accepted, `pending_vrf` stays set; `crank_tick` skips pending drops, and after 30 s `expire_turn` ends the turn **and refunds the credit**. A player could repeat this indefinitely at zero cost, holding the cabinet ~15 s turn + 30 s each cycle. Test queues also widen the oracle trust set. Whether the non-ephemeral queues accept a request on the TEE ER was **not verified** on devnet (not tested against the live cabinet). | **Fixed** (D1 deployed) |
| F-02 | Medium | `constants.rs:17` (`QUEUE_LEN`), `play.rs:54-83` | **Queue / turn griefing with Sybil wallets.** 16 wallets can fill the queue; each may hold its 15 s turn without dropping, so an honest player waits up to 16 × 15 s = 4 min per cycle (≈12 min with F-01). Joining costs one credit, but on devnet the faucet makes credits free (F-03). Mitigated in part: one queue slot per profile (`is_queued` check), turns expire on chain, the crank and every client clear stale turns. | Accepted risk (devnet); add per-wallet cooldown / paid credits on mainnet |
| F-03 | Medium | `player.rs:34-73` | **Faucet is Sybil-able.** 20 dUSDC per profile per hour, and wallets and profiles are free, so credits are unlimited. Since visible + mystery EV ≈ 1 play, free plays drain the prize vault (dGEM/KOI/ROBO and dUSDC prizes). The faucet PDA `["faucet"]` is global, and `init_cabinet` is permissionless, so any cabinet whose `mints[0]` is demo USDC also reaches it. | Accepted risk: devnet demo faucet, demo tokens only. Must be removed before any real-value deployment. |
| F-04 | Low | `admin.rs:282-289`, `306-313`; `auto.rs:215-222` | **Vault token accounts are not pinned to the ATAs.** Restock solvency reads `vault0..3` constrained only by mint + `token::authority = vault`, while `claim_prize` pays from the ATA (`player.rs:203`) and the Magic Action passes ATAs. A restocker can pass a decoy, non-ATA token account owned by the vault PDA (for dUSDC, funded from the free faucet) so the check passes while the ATA cannot cover the prizes. Tokens put in a decoy are themselves stranded. Needs the authority or keeper key. | Open (diff D2) |
| F-05 | Low | `admin.rs:190`, `196`; ER clones of `config`, `KeeperRole` | **Solvency and keeper checks use L1 snapshots on the ER.** `config.total_claimed`, the vault balances and `KeeperRole` are undelegated L1 accounts read on the ER as clones. If the clones are from different moments, `vault + claimed` can be overstated by an in-flight claim; a revoked keeper may still restock until the clone refreshes. Privileged callers only. | Accepted risk; re-check after a fresh clone, or move solvency to L1 |
| F-06 | Low | `play.rs:408`; `auto.rs:107` | **Plain `cash_out` blocks on a stale `in_queue`.** After the crank ends a turn the profile keeps `in_queue = true`; `cash_out` checks the raw flag and fails `StillQueued`. `cash_out_and_settle` (what the app calls) trusts the cabinet instead. No funds are lost: re-joining or `cash_out_and_settle` recovers. | Mitigated by existing code path (`auto.rs:107`, DECISIONS #22) |
| F-07 | Low | `admin.rs:218-223` | **Keeper restock bounds are loose.** Only grid, radius and per-capsule `max_payout_per_round` (25 dUSDC, 2000 dGEM, 2 KOI, 2 ROBO) are enforced. A compromised keeper can stock large, easy capsules where it likes and win them with its own wallet, paying out the vault surplus above liabilities. It cannot touch `pending` or withdraw. | Accepted risk (keeper is a trusted low-privilege role); document, bound total stock value per window |
| F-08 | Low | `scripts/lib/stock.ts:40-54`, `scripts/lib/admin.ts:178` | **Mystery contents are known to the restocking key.** They are drawn client-side and carried in the restock instruction data (the TEE redacts that transaction: `scripts/check_tx_privacy.ts`). Whoever runs the keeper/authority knows every live mystery capsule. No script logs them. Tier does not leak through position or radius (slots are fixed, `stock.ts:16-30`). | Accepted risk; draw contents on chain from VRF in a future version |
| F-09 | Low | `math.rs:45-47`; `scripts/lib/math.ts:26` | **Modulo bias in `roll_bps`.** `u16 % 10000`: values 0–5535 appear 7× and 5536–9999 6×, so P(HELD) at grip 8500 bps is 86.27 % (not 85 %) and at 2500 bps 26.70 % (not 25 %). The TS port and EV simulation use the same reduction, so the published EV is consistent; only the "85 % max grip" wording is slightly off. Players gain a little; the vault loses a little. | Open (use 4 bytes, or rejection sampling, on next upgrade) |
| F-10 | Low | `app/src/lib/burner.ts:12`, `27`; no `app/public/_headers` | **Keys in `localStorage`, no security headers.** The opt-in burner wallet stores its full secret key in plaintext localStorage; session keys likewise (session keys can only move/drop/join, `play.rs:26-36`). Any XSS or malicious extension on the origin can take them. The static site sets no CSP / `X-Frame-Options`, so the signing UI can be framed (clickjacking). | Open, devnet-labelled (proposed `_headers`, D5) |
| F-11 | Info | `admin.rs:329-357` | **`admin_undelegate` publishes unrevealed mystery contents.** It commits the vault to L1 without clearing `entries`. Documented as an emergency-only path (DECISIONS #13). Authority only. | Accepted risk (documented); diff D3 clears entries first |
| F-12 | Info | `chain.ts:70`; `scripts/lib/common.ts:123` | TEE auth token travels in the RPC URL query string (`?token=`), so it can land in proxy/RPC logs. Token is per-signer and short-lived; explorer links are built without it. | Accepted risk (MagicBlock SDK pattern) |
| F-13 | Info | `admin.rs:141-145` | `seal_mystery` accepts an already-existing permission account without checking it is private with no members. Authority only. | Accepted risk |
| F-14 | Info | `lib.rs:27`, `admin.rs:44` | `init_cabinet` is permissionless over a `u8` id, so ids can be squatted; a squatter only controls its own cabinet (all PDAs are seeded by id). | Accepted risk |
| F-15 | Info | `admin.rs:226`, `266` | `next_capsule_id` wraps at 65 536; `CabinetRestocked.added` is `len() as u8` (bounded by 12 slots). Cosmetic. | Accepted risk |
| F-16 | Info | `auto.rs:69-71` | Crank task id is derived from the cabinet address and task ids are global on the validator; another party could pre-register that id and block `schedule_crank`. Turns still clear through `expire_turn` from any client. | Accepted risk |

### Checked and mitigated by existing code

| Area | Evidence |
|---|---|
| Missing signer checks | Every mutating instruction has a `Signer`; player L1 ixs derive the profile from `authority.key()` (`player.rs` seeds), so a session key fails `ConstraintSeeds` (INVARIANTS #2). Admin ixs use `has_one = authority` (INVARIANTS: restock by session key → `ConstraintHasOne`). |
| Owner checks / delegated-account misuse | Typed `Account<…>` everywhere data is read. A delegated profile is owned by the delegation program, so `claim_prize`/`settle_prizes`/`buy_credits` on L1 fail while it is delegated (INVARIANTS #6: `AccountOwnedByWrongProgram`). `config` and `KeeperRole` are never delegated, so the ER never writes them. Commits are `commit_and_undelegate` only, after `exit()` serialises state (`play.rs:409`, `auto.rs:109`, `admin.rs:347-348`). |
| PDA seed collisions | Distinct literal prefixes (`config`, `cabinet`, `mystery`, `vault`, `player`, `faucet`, `keeper`, `permission:` under another program) + fixed-length `u8` id + 32-byte key. Profiles are seeded by cabinet id and checked against the config/cabinet (`WrongCabinet`); INVARIANTS #6: a cabinet-1 profile cannot claim from cabinet 2. |
| Account substitution (payout) | `claim_prize`: mint must equal `config.mints[m]` (`player.rs:164`), vault and player accounts are ATAs. `settle_prizes`: `token::mint = config.mints[i]`, player accounts owned by `profile.authority`. |
| VRF callback spoofing / replay | Signer must be the program-scoped VRF identity (`play.rs:356`, INVARIANTS #3 `Unauthorized`); `pending_vrf` must be set and `nonce == vrf_nonce` (`play.rs:259-260`); `advance()` clears `pending_vrf`, so a second or late callback fails `NoVrfPending`/`StaleVrfCallback`; profile must be the turn owner (`play.rs:261`). |
| Double settlement | `claim_prize` and `settle_prizes` both zero `pending[m]` before transferring and add to `total_claimed` (`player.rs:167`, `auto.rs:184`). INVARIANTS #6: second claim → `NothingToClaim`; e2e Magic Action then `claim_prize` → `NothingToClaim`. |
| Session-key scope | `authorize()` is called only by `join_queue`, `move_claw`, `drop_core` (`play.rs:26-36`); max 24 h, cannot equal the wallet or default (`player.rs:117-126`); cash-out contexts derive the profile from the signer. INVARIANTS #1, #2. |
| Integer overflow | `overflow-checks = true` in the release profile (`Cargo.toml:6`); money paths use `checked_add`/`checked_mul`; solvency in `u128` (`math.rs:153-155`, unit-tested at `u64::MAX`); geometry in `i64` and clamped to the grid. |
| Turn rules | Only `turn_owner` (or its session key) can move/drop; `expire_turn` only after expiry or a 30 s VRF timeout (INVARIANTS #1, #4). |
| Vault solvency | Every restock enforces, per mint, `vault + claimed ≥ won + liability(all live capsules incl. sealed mystery)` (`admin.rs:245-265`); there is no withdraw instruction. INVARIANTS #5. Caveats F-04, F-05. |
| Mystery leakage via RPC/events | Vault is unreadable through the TEE RPC with no token, a stranger's token and the authority's token (INVARIANTS #7). Public capsules show `mint_idx 0, amount 0` for mystery slots; `MysteryRevealed` is only emitted on a win; restock / `drop_claw` / callback transactions that list the vault are redacted (`check_tx_privacy.ts`, DECISIONS #23). |
| Front-running / sniping | Turn-based: no other key can act during a turn; the outcome is fixed by VRF after the drop is committed; the client byte `client_seed` cannot steer an unpredictable VRF output. Residual: the validator orders transactions (trust assumption). |

## 8. Recommended fixes (all need a program upgrade)

**D1 — pin the VRF queue (F-01).** **Fixed 2026-11-27 16:58 IST:** both drop contexts now accept only `DEFAULT_EPHEMERAL_QUEUE` (diff D1); upgrade [2vHp9HK6…](https://explorer.solana.com/tx/2vHp9HK6hrro5BADAoqqfBeKJdhg49sh2qPKMffqM2vuoNwBES11u9ybghdgsNk1FCgqDr6G9LtihPjnJ2RiMhTU?cluster=devnet); real round after the upgrade resolved HELD in 345 ms ([drop](https://explorer.solana.com/tx/2qo86FM1ZUbWrpEmMkYp7mUmLXnXmG5zrTDpdD9JTLoH2FQe9ChrFgu5pUwjabhkmqpx1jhqJXuorRK59W2demgM?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app)). In both `DropClaw` and `DropClawPublic` (`play.rs`):

```diff
     /// CHECK: MagicBlock VRF oracle queue
-    #[account(
-        mut,
-        constraint = oracle_queue.key() == mbvrf::consts::DEFAULT_EPHEMERAL_QUEUE
-            || oracle_queue.key() == mbvrf::consts::DEFAULT_QUEUE
-            || oracle_queue.key() == mbvrf::consts::DEFAULT_TEST_QUEUE
-            || oracle_queue.key() == mbvrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
-            @ ClawError::InvalidParams
-    )]
+    #[account(mut, address = mbvrf::consts::DEFAULT_EPHEMERAL_QUEUE @ ClawError::InvalidParams)]
     pub oracle_queue: UncheckedAccount<'info>,
```

The app already sends this queue (`chain.ts:23`), so no client change is needed. Optionally, also stop
refunding the credit in `expire_turn` after the first timeout per profile.

**D2 — pin vault accounts to the ATAs (F-04).** In `Restock`, `RestockByKeeper` (`admin.rs`) and `SettlePrizes` (`auto.rs`), for each `i`:

```diff
-    #[account(token::mint = config.mints[0], token::authority = vault)]
+    #[account(token::mint = config.mints[0], token::authority = vault,
+        address = anchor_spl::associated_token::get_associated_token_address(&vault.key(), &config.mints[0]) @ ClawError::WrongMint)]
     pub vault0: Box<Account<'info, TokenAccount>>,
```

**D3 — clear mystery contents before `admin_undelegate` commits (F-11).** In `admin.rs`, before `ctx.accounts.mystery.exit(...)`:

```diff
     ctx.accounts.mystery.sealed = false;
+    ctx.accounts.mystery.entries = [MysteryEntry::default(); MAX_CAPSULES];
+    for c in ctx.accounts.cabinet.capsules.iter_mut() {
+        if c.kind == KIND_MYSTERY { c.active = false; } // contents gone: retire the capsule
+    }
     ctx.accounts.mystery.exit(&crate::ID)?;
```

**D4 — unbiased roll (F-09).** Replace `roll_bps` with a 32-bit reduction, e.g.
`(u32::from_le_bytes(r[0..4]) as u64 * BPS >> 32) as u16` (bias < 10⁻⁵), and update `scripts/lib/math.ts`
and the unit tests together.

**D5 — static security headers (F-10, no program change).** Add `app/public/_headers` for Cloudflare Pages:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

A full CSP needs testing against the wallet adapters and the TEE websocket first.

**Before any real-value deployment:** remove the faucet (F-03), add a per-wallet join cooldown or real
credit price (F-02), move the upgrade key and cabinet authority to a multisig with a timelock, draw
mystery contents on chain from VRF (F-08), and bump `ephemeral-rollups-sdk` for the advisories.

## 9. Known issues

- **Solflare mobile cannot sign the ER cash-out transaction.** Solflare mobile refuses the
  `cash_out_and_settle` transaction with "network mismatch" because it carries an ER blockhash. Solflare
  can connect, start a session and play; cash-out works with the burner wallet and desktop-signed keys.
  The profile from that attempt stays delegated (demo tokens only). There is no program-side recovery
  path for a profile whose wallet can never sign an ER transaction: `cash_out` / `cash_out_and_settle`
  must be signed by the wallet on the ER. Phantom and Mobile Wallet Adapter on phones still need testing.
- `cash_out` (legacy) can fail `StillQueued` after a crank-expired turn (F-06); the app uses
  `cash_out_and_settle`.

## 10. Remaining risks

- **Payouts trust the ER validator.** L1 pays whatever `pending` the TEE validator commits, capped only
  by the vault balance. A compromised validator or TEE could mint prizes for itself. This is inherent to
  delegating game state to an ER; TEE attestation is the mitigation, and this review did not verify it.
- **Grip rolls are not publicly verifiable end to end.** The VRF callback lists the private mystery vault,
  so the TEE redacts it. The public cabinet stores `roll_bps`, `grip_bps` and the outcome, and the Live
  Proof drawer re-derives the outcome from those numbers, but a third party cannot see the VRF proof
  itself. "Fairness re-check" means "the program applied its rules to the recorded roll", not "the roll
  is proven to come from VRF".
- Oracle withholding (refund instead of an unwanted result), validator reordering/censorship, and the
  single-key cabinet authority (also the upgrade key) remain trust assumptions.
- Transitive dependency advisories (section 6) are unpatched pending upstream SDK releases.
- No fuzzing or formal verification was done; instruction-level tests cover the invariants listed in
  `docs/INVARIANTS.md` only.

> **Internal review and automated checks only — not an independent third-party audit.**
