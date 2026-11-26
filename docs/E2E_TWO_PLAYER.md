# Two-player queue test (devnet)

Run 2026-11-26T23:14:43.719Z with `npx tsx scripts/e2e_two_player.ts` against cabinet EUK77P9zFtQDdivoMEcktcGfs9wHPdyydbtiG1P62w5S.

## Checks

| Result | Check | Detail |
|---|---|---|
| ✅ | A's join on an idle cabinet starts A's turn | round 41 |
| ✅ | B's join during A's turn queues B | queue length 1 |
| ✅ | B cannot move during A's turn (session key) | rejected with NotYourTurn (0x1770) |
| ✅ | B cannot expire A's turn before it expires | rejected with TurnNotExpired (0x1772) |
| ✅ | B's turn starts automatically when A's VRF result lands | turn owner CChxUE…, round 42 |
| ✅ | expire_turn before B's turn expires is rejected | rejected with TurnNotExpired (0x1772) |
| ✅ | A clears B's expired turn (permissionless expire_turn) | turn owner now 111111… |
| ✅ | B's in_queue flag is cleared | credits left 2 |

## Transactions

| Player | Step | Layer | Signature |
|---|---|---|---|
| A | buy_credits | Solana devnet | [2MWZDtPEuU…](https://explorer.solana.com/tx/2MWZDtPEuU1xN4YQQSNn7rTVGFDFVxuQaaVfuKniQtC99K4i2Q9hBvrkp5mHtaQ51qWW2MYrirqJtYNaX1AcjxJJ?cluster=devnet) |
| A | register_session_key | Solana devnet | [2XfZwLabdT…](https://explorer.solana.com/tx/2XfZwLabdThUYDed5gu8oSkBLYBDsxhD52x7JTq2ze5c8sDwDKCK24rrWkxCd5tun5yFUtJQHCBJr3GvqpFTW9UX?cluster=devnet) |
| A | delegate_player | Solana devnet | [3WZTo93oLX…](https://explorer.solana.com/tx/3WZTo93oLX9EkRG9KZgAFrcsgmwbXuU96XVrbJAZ8JQVV198Anq6jEtaoEHH2T77EXQwUw2fvQQtkkn3NpkXMKVB?cluster=devnet) |
| A | join_queue | MagicBlock TEE ER | [5YVKpXCc7W…](https://explorer.solana.com/tx/5YVKpXCc7WBBCbv5uZmTRqRBjrmahPtdxkY3aqK8nbKcrHe3Z7BHfvhvXR33MQ1pApQmwgASPZxhVinESN7PsreH?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | move_claw | MagicBlock TEE ER | [5bjqZesyUd…](https://explorer.solana.com/tx/5bjqZesyUdyan4CPhKdt9gRFCTb8DbpzTh6bKSNnTpqtREKbcghidCi3rbk3f6yRQdm7TrNBb3tQyze71peA9cQr?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | move_claw | MagicBlock TEE ER | [3fvu8MfdAF…](https://explorer.solana.com/tx/3fvu8MfdAFwzY9DhVVDtSk9ygVLdmbqYYNGai4SuVuyYnphL9EVyiXCCuNbaonbGPirbt9F2F6MgPq3pEcSXUQg2?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | move_claw | MagicBlock TEE ER | [4b7Uxz6Ayf…](https://explorer.solana.com/tx/4b7Uxz6AyfRYf6mhFNPnXwbVWkeQBfvyVZJmA6ExCVQq2QhNny9WXYTwB3mtPCUfgnJkTvA22JviN6VYPz6RD4J6?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | move_claw | MagicBlock TEE ER | [2eVMrCSpwJ…](https://explorer.solana.com/tx/2eVMrCSpwJZnChyNHN8cNwFvy8aw6tqzg944A2rKZsRPwgXpTStxvmGRbGiNz7ZrixPzVcro58Xc4snQF1vSzDjx?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | drop_claw | MagicBlock TEE ER | [2StUx3hxkW…](https://explorer.solana.com/tx/2StUx3hxkW25qT8fPCcSZMQqebv43yCbN2kCFoJeFfthEKs76uG1gmeVhPjswsu4PyHp1ruSjzsR3zmP8SaJMA1p?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | expire_turn | MagicBlock TEE ER | [4rQf8824sY…](https://explorer.solana.com/tx/4rQf8824sYxLVToTDWvckw9YXY9ZbVxEsWXF8ULEeZ9hhzywtQ7mJSRQeuRSL6zsuofCqVasJSdsMDmH8GD6GKcc?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | cash_out | MagicBlock TEE ER | [4YqD5r8d2N…](https://explorer.solana.com/tx/4YqD5r8d2NEf4vbcjwec5HWrJMXrNqMkoVf9x337Ryd9aDXXeT96KcqZcjaUKh6Qai52syK6mA1mcSTRtiAx17s7?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| A | cash_out commit (L1) | Solana devnet | [4Uhei7iDrD…](https://explorer.solana.com/tx/4Uhei7iDrD45vqoh3L2JNuCQ2ChrnB137yoy8er1GBYACBNhHRTouFFUJ6Yfg2uchdfWWyx5E1bjBkuy4T3bBeys?cluster=devnet) |
| B | buy_credits | Solana devnet | [DuY71ojbRD…](https://explorer.solana.com/tx/DuY71ojbRDhgXt1AvgZPEBPfqWQboFxgEkEzSewYKRrYaK4Rg34Gnr74TYnDz6T3Lk131HmFntbVHGRuZvvCxr8?cluster=devnet) |
| B | register_session_key | Solana devnet | [4bjC9dUwhb…](https://explorer.solana.com/tx/4bjC9dUwhb3cREdpz6is8LWxJiGrZmCpU1YxraCLeguTCrMXFCRwBWjvUdYZS517qT4v53g7maEKvYtTH75LYQyK?cluster=devnet) |
| B | delegate_player | Solana devnet | [4eUgCRa5YJ…](https://explorer.solana.com/tx/4eUgCRa5YJAsam2yqX7gKGDcWHfu7YFC2s5uX8DcivrW38fixa4KEKTuu42vhgt6RPSwxH7bN6xeWQHtyCzv21UJ?cluster=devnet) |
| B | join_queue | MagicBlock TEE ER | [c5DzJgaSpt…](https://explorer.solana.com/tx/c5DzJgaSptcCb2GUbgXirUGBGK2dBcnua5gsye8uNFn9PzekUwWGCaVDfsXwp72fbQvz1qD2LU8yvozwPpJGazn?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| B | cash_out | MagicBlock TEE ER | [Koiq2aGn9V…](https://explorer.solana.com/tx/Koiq2aGn9V2WTVWsdTR91pcohadjpHs7dLAAioK15pUraNmBLkGUYqmFwYsxvgrHToedy58rGmLW5hHMHkPLDvR?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| B | cash_out commit (L1) | Solana devnet | [5TFCpJzfo3…](https://explorer.solana.com/tx/5TFCpJzfo3d7WEQb3wkQWnBrrbyGUAQYivMiVFxHGNXHaPwK6uGXxVWe3iFocpgBb1am4xnxPjVhZ2nP3FE2JSF1?cluster=devnet) |

## Log

```
A ready: 7TBv3DCsAXDB7qxJk1X7Z9uc9pfdrjQPzcrpMLfF5jLc (session HmkZvr…)
B ready: CChxUEUDTJi32TNsQHVN3YbEZxKXbkJR3x3CfUJRehGA (session GCquKw…)
PASS  A's join on an idle cabinet starts A's turn — round 41
PASS  B's join during A's turn queues B — queue length 1
PASS  B cannot move during A's turn (session key) — rejected with NotYourTurn (0x1770)
PASS  B cannot expire A's turn before it expires — rejected with TurnNotExpired (0x1772)
A round 41: MISS (grip 2500 bps, roll 7267), VRF callback seen after 104 ms
PASS  B's turn starts automatically when A's VRF result lands — turn owner CChxUE…, round 42
PASS  expire_turn before B's turn expires is rejected — rejected with TurnNotExpired (0x1772)
waiting 14.1 s for B's turn to expire…
PASS  A clears B's expired turn (permissionless expire_turn) — turn owner now 111111…
PASS  B's in_queue flag is cleared — credits left 2
A cashed out (ER 4YqD5r8d…, L1 commit 4Uhei7iD…), claims: none
B cashed out (ER Koiq2aGn…, L1 commit 5TFCpJzf…), claims: none
```
