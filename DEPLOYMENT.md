# Deployment

ClawRush has three parts: an Anchor program on Solana devnet, a cabinet delegated to the MagicBlock TEE Ephemeral
Rollup, and a static Next.js app on Cloudflare Pages. All of it is devnet. Never point any of it at mainnet.

Live: https://clawrush.pages.dev · program `9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs` · cabinet 1
(config `CLaFhSGw…`, state `EUK77P9z…`).

## Secrets

Keypairs live in `keys/` and `~/.config/solana/id.json`. Both are git-ignored (`.gitignore`: `keys/`,
`*keypair*.json`, `id.json`, `.env*`). Never commit, print or paste them. The cabinet authority key is also the
program upgrade key. Give hosted jobs the low-privilege keeper key only.

## Toolchain

Rust 1.93, Solana CLI 4.0.2, anchor-cli 1.2.1 (`anchor-lang` =1.0.2), Node 22. Pins and the reasons for them are in
[docs/DECISIONS.md](docs/DECISIONS.md#toolchain-pinned). If Node fetch or wrangler times out on IPv6:

```bash
export NODE_OPTIONS=--dns-result-order=ipv4first
```

## 1. Program

```bash
anchor build
cargo test -p clawrush --lib
solana program deploy target/deploy/clawrush.so --program-id <program keypair> --url devnet
```

Upgrades keep the same program ID and are additive: the second and third upgrades added instructions without
changing any existing account layout (decisions 22, 23). If the new `.so` is larger than the program data account,
extend it first (`solana program extend <program id> <bytes> --url devnet`). This was needed once: 677,792 >
620,000 bytes, extended by 100,000.

## 2. Cabinet on devnet + ER

```bash
npm install
npx tsx scripts/setup_devnet.ts          # mints, cabinet, vault funding, delegate to TEE ER, seal vault, first restock, test players
npx tsx scripts/crank.ts schedule        # schedule crank_tick on the ER (admin); `tick` and `watch` also exist
npx tsx scripts/set_keeper.ts <pubkey>   # register the low-privilege restock key
npx tsx scripts/metaplex_metadata.ts     # Token Metadata for dGEM, KOI, ROBO
npx tsx scripts/export_app_config.ts     # writes app/src/lib/devnet.json + idl.json (public addresses only)
```

`setup_devnet.ts` is idempotent: progress is stored in `scripts/state.devnet.<cabinet_id>.json` (public addresses
and signatures only), and new player keys go to `keys/<name>.json`. A test cabinet with a small vault, as used by the
invariant suite: `CABINET_ID=2 SMALL_VAULT=1 npx tsx scripts/setup_devnet.ts`.

### Keeping the cabinet stocked

The crank clears idle turns. Restock writes the private vault, so it needs the authority or the keeper key:

```bash
npx tsx scripts/keeper.ts                                # local loop, authority key
KEEPER=keys/keeper.json ONCE=1 npx tsx scripts/keeper.ts # one pass as the keeper role
npx tsx scripts/restock.ts                               # one-off top-up before a demo
```

Hosted: [`.github/workflows/keeper.yml`](.github/workflows/keeper.yml) runs one keeper pass every 10 minutes
(`CABINET_ID=1`, `MIN_ACTIVE=8`). It needs the repo secret `KEEPER_KEYPAIR` (`gh secret set KEEPER_KEYPAIR <
keys/keeper.json`, done by the owner). If the secret is missing, the job fails on purpose.

### Script environment variables

| Variable | Default | Used by |
|---|---|---|
| `BASE_URL` | `https://api.devnet.solana.com` | `scripts/lib/common.ts` |
| `ER_URL` | `https://devnet-tee.magicblock.app` | `scripts/lib/common.ts` |
| `ER_VALIDATOR` | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` | `scripts/lib/common.ts` |
| `CABINET_ID` | `1` | all scripts via `scripts/lib/common.ts` |
| `AUTHORITY` | `~/.config/solana/id.json` | setup, restock, keeper, crank, set_keeper, metaplex, rounds |
| `KEEPER`, `ONCE`, `MIN_ACTIVE` | unset, unset, 6 | `keeper.ts` (`MIN_ACTIVE` also `restock.ts`) |
| `SMALL_VAULT`, `PLAYER_NAMES` | unset | `setup_devnet.ts` |
| `ROUNDS`, `PLAYERS`, `REPORT_ONLY` | | `devnet_rounds.ts` (`ROUNDS`, `MYSTERY` also `e2e_public_drop.ts`) |
| `PLAYER` | | `e2e_magic_action.ts`, `e2e_crank.ts`, `e2e_public_drop.ts` |
| `TURNS` | | `ev_simulation.ts` |

Key paths are file paths, never key material.

## 3. App (Cloudflare Pages, static export)

`app/next.config.ts` sets `output: "export"`, so `next build` writes a static site to `app/out`. Nothing runs on a
server.

```bash
cd app
npm install
npm run lint
npm run build
npx wrangler pages deploy out --project-name clawrush --branch main
```

Environment variables read by the app (both optional, both baked in at build time):

| Variable | Default | Read in |
|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | `https://api.devnet.solana.com` | `app/src/lib/chain.ts` |
| `NEXT_PUBLIC_ER_URL` | `https://devnet-tee.magicblock.app` | `app/src/lib/chain.ts` |

The cabinet, mints and program ID come from `app/src/lib/devnet.json`, which `scripts/export_app_config.ts`
generates. The app needs no secrets. The opt-in burner wallet and the session key are created in the visitor's
browser and stay in `localStorage`.

Hosting note (decision 15): `wrangler pages project create` now defaults to Workers, so the Pages project was
created with `--force`. `app/wrangler.jsonc` belongs to an earlier Worker deploy of the same build.

## 4. Check a deploy

```bash
cd app && AIM=1 URL=https://clawrush.pages.dev KEY=../keys/webtest.json OUT=<scratch dir> node e2e/round.mjs
```

This plays a real round in headless Chrome at 390×844, idles through a turn to check that the app clears it, then
cashes out. It prints explorer links. `KEY` is a funded devnet test key from `keys/` (git-ignored).

Offline CI (`.github/workflows/ci.yml`): Rust math tests, the TS math port, and app lint + build. No devnet, no secrets.
