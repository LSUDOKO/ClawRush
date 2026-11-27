# ClawRush: business one-pager

**One claw, every player, real prizes.** A shared, skill-based claw cabinet on Solana + MagicBlock that pays tokens
and collectibles to the winner's wallet. Today it is a devnet MVP with demo tokens. There are no users, revenue or
partners yet.

## Who plays

- Mobile crypto users who like short "one more try" games and owning what they win.
- Spectators: everyone watches the same live cabinet, so slips and near-misses are social moments (ORBIT view while waiting).
- Players who want skill to count. Aim moves the hold chance from 25% to 85%, and the simulation shows skilled play
  earning more than twice the beginner return (78.0% vs 33.0%, [scripts/ev_results.md](scripts/ev_results.md)).

## Built today vs future opportunity

| | Built today (devnet, verifiable) | Future opportunity (not built) |
|---|---|---|
| Revenue | The mechanism only: credits are paid into the cabinet vault (`buy_credits`), and the house edge comes from return to player below 100% (33% beginner to 86.2% perfect bot, simulated). On devnet credits are bought with free faucet dUSDC, so there is no real revenue | Real-value prize pools on mainnet, after legal review |
| Solvency | On-chain checks: per-prize payout cap and per-mint vault solvency on every restock (`VaultInsolvent`) | Published per-cabinet odds and live RTP dashboards from `GripResolved` events |
| Operators | One cabinet authority plus a restock-only keeper role (`set_keeper`, `restock_by_keeper`) | Many cabinets with their own operators and prize pools; a fee split between operator and platform (no fee split exists today) |
| Sponsors | Prize mints with Metaplex Token Metadata (dGEM, KOI, ROBO) | Sponsored cabinets stocked by projects or brands with their own tokens / collectibles as a distribution channel |
| Anti-bot | Sealed mystery capsules in a private TEE account, so bots can't target jackpots | Sealed drops as a product for launches (prize contents revealed only on win) |
| Payout | One-transaction cash-out via Magic Action | Collectible NFTs (Metaplex Core) minted on win, set completion |

## Go-to-market

1. **MagicBlock / Solana gaming community first.** MagicBlock listed "an arcade claw you play from your phone" as
   one of its suggested Blitz v10 ideas ([docs/01-HACKATHON.md](docs/01-HACKATHON.md)).
2. **Spectator loop.** A live shared cabinet can be streamed and clipped (a slip, then the next player wins). The
   win ticker and leaderboard come from the cabinet's on-chain `recent_wins`.
3. **Sponsored cabinets.** Offer projects a cabinet stocked with their token or collectible: players earn it by
   playing, not by airdrop farming.
4. **Mobile first.** The game is a mobile web app at https://clawrush.pages.dev with Mobile Wallet Adapter
   wired in (not yet tested on a device). No app-store dependency.

## Competitors (sourced 2026-11-27)

| Product | What it is (from its own page or a cited report) | How ClawRush differs |
|---|---|---|
| **arclaw** ([arclaw.app](https://arclaw.app)) | Solana claw machine on MagicBlock ER + VRF that pays tokenized stocks. Its site says "The claw is the show. A verifiable draw has already decided what is inside" and "Every play wins a box, there is no miss". Machines at 1 / 5 / 10 USDC with stated expected return 75% / 80% / 85% | Aim changes the odds; one shared cabinet; capsules persist; sealed mystery capsules |
| **Collector Crypt Gacha** ([collectorcrypt.com/gacha](https://collectorcrypt.com/gacha/), [gacha.collectorcrypt.com](https://gacha.collectorcrypt.com/)) | Solana gacha for graded trading cards. Its gacha page lists packs from $25 with a published EV per pack (e.g. "Starter Pokémon Gacha Pack $25 EV 111%"). CardWire reported 123,425 packs ripped on 20 Oct ([cardwire.com](https://cardwire.com/article/collector-crypt-review)) | Shows demand for on-chain prize pulls; ClawRush is a skill game with a live shared machine, not a pack opener |
| **Toreba** ([toreba.net](https://www.toreba.net/en/service)) | Remote-play real claw machines in Japan; "Prizes won will be shipped to your doorstep" | No camera rigs or shipping; outcomes and odds are verifiable on chain |
| **Clawee** ([clawee.com](https://clawee.com/), [Google Play](https://play.google.com/store/apps/details?hl=en&id=com.gigantic.clawee)) | Live-streamed real claw machines with home delivery; the Play Store listing shows 10M+ downloads | Same "one more try" loop, but transparent grip math and on-chain payouts instead of a black-box machine |

Sources were read through Exa search on 2026-11-27. Figures are the sources' own and were not checked
independently.

## Risks

- **Regulation.** Paid plays for prizes of value can fall under gambling or prize-promotion rules, depending on the
  jurisdiction. Mainnet with real-value prizes needs legal review first. Today: devnet demo tokens only.
- **Trust.** The operator chooses the stock (within on-chain caps), and the VRF oracle is a trust assumption. Both
  are documented in [SECURITY.md](SECURITY.md).
- **Wallet UX.** Solflare mobile can't sign the ER cash-out yet (see [ROADMAP.md](ROADMAP.md)).
