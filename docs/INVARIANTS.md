# Security invariant tests (devnet)

Run 2026-11-26T23:27:11.837Z with `CABINET_ID=2 npx tsx tests/invariants.ts` on the test cabinet `AnS2MJT3GreDHAMXBXDLLKcFEjJjzNERdsTf4FUv3wTk` (3 dUSDC vault, own mints).
Every negative check sends a real transaction and expects the program to reject it with the named error.

| # | Check | Result | Detail | Tx |
|---|---|---|---|---|
| 2 | session key cannot buy_credits for the wallet | ✅ | rejected: ConstraintSeeds (2006) |  |
| 2 | session key cannot claim_prize for the wallet | ✅ | rejected: ConstraintSeeds (2006) |  |
| 2 | register_session_key rejects a session longer than 24 h | ✅ | rejected: SessionTooLong (6008) |  |
| 2 | session key cannot cash_out (commit + undelegate) the wallet's profile | ✅ | rejected: ConstraintSeeds (2006) |  |
| 2 | session key cannot restock (admin) | ✅ | rejected: ConstraintHasOne (2001) |  |
| 5 | restock of a 13.5 dUSDC capsule into a 12.5 dUSDC vault is rejected | ✅ | rejected: VaultInsolvent (6013) |  |
| 5 | solvent restock (0.5 dUSDC capsule) is accepted | ✅ |  | [2MYdH9wA…](https://explorer.solana.com/tx/2MYdH9wAvAePPHBLFw7oF3VRBSnJNXwnCZiLaDbKw5h8i9xWnSpZ4WJgLL3WU245LJbaciGKQttPswEbBbXByBqU?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| 1 | another player's valid session key cannot move during A's turn | ✅ | rejected: NotYourTurn (6000) |  |
| 1 | an unregistered key cannot move_claw on A's profile | ✅ | rejected: SessionKeyNotAllowed (6006) |  |
| 1 | an unregistered key cannot drop_claw on A's profile | ✅ | rejected: SessionKeyNotAllowed (6006) |  |
| 3 | vrf_grip_callback signed by anyone but the VRF program identity is rejected | ✅ | rejected: Unauthorized (6021) |  |
| 4 | expire_turn before the turn expires is rejected | ✅ | rejected: TurnNotExpired (6002) |  |
| 3 | drop 1 resolved by exactly one VRF callback (pending_vrf cleared, round advanced) | ✅ | HELD after 104 ms | [57DYDvhm…](https://explorer.solana.com/tx/57DYDvhmt9ZZTjvZt6abEqjCW7YGLX8yUDE1D88hAYg9Q8ZCmxs5zT9tnVw3VVSyAqWqaGYUMb9ey2qFsbJv6C24?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| 1 | an expired session key is rejected | ✅ | rejected: SessionExpired (6007) |  |
| 4 | after expiry, an unrelated key can clear the turn | ✅ |  | [5262WUqg…](https://explorer.solana.com/tx/5262WUqgUVEoJtrdW3tQKaSGKLrHmzg3S677Y7VDcKAkF1pSkmSwBMerXf8wxzFfg4zjE6UuJbAtDdpuJ3zBfGHV?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| 6 | claim_prize while the profile is still delegated is rejected | ✅ | rejected: AccountOwnedByWrongProgram (3007) |  |
| 6 | first claim pays the pending 0.5 dUSDC to the wallet | ✅ | wallet +0.5 dUSDC | [4AuNtC1G…](https://explorer.solana.com/tx/4AuNtC1Gzd9B9LXstUqXX4m1PfHCMXSMXMiyo2PpHybnExEPYo3xdCYAkxjQ2B55F1VxurJKYbipyTtScEyvW7W7?cluster=devnet) |
| 6 | second claim of the same prize is rejected | ✅ | rejected: NothingToClaim (6015) |  |
| 6 | a profile from cabinet 1 cannot claim from cabinet 2's vault | ✅ | rejected: ConstraintSeeds (2006) |  |
| 7 | mystery vault unreadable via TEE RPC (no token) | ✅ | null |  |
| 7 | mystery vault unreadable via TEE RPC (stranger token) | ✅ | null |  |
| 7 | mystery vault unreadable via TEE RPC (authority token) | ✅ | null |  |
| 7 | control: the public cabinet account is readable | ✅ | 1301 bytes |  |

Invariant 3 note: only the VRF program can produce the `vrf_program_identity` signer, so a real duplicate callback can't be sent from a test. The program enforces one callback per drop with `pending_vrf` plus a per-drop `vrf_nonce` the callback must echo (`NoVrfPending` / `StaleVrfCallback`).
