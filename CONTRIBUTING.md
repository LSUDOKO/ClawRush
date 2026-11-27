# Contributing

Thanks for looking. ClawRush is a hackathon project (Apache-2.0, see [LICENSE](LICENSE)). Issues and small PRs are welcome.

## Setup

Toolchain and devnet setup: [DEPLOYMENT.md](DEPLOYMENT.md). The code layout is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Before you open a PR

```bash
cargo test -p clawrush --lib          # grip / slip / solvency math
npx tsx scripts/lib/math.test.ts      # TS port still matches math.rs
cd app && npm run lint && npm run build
```

CI runs the same three checks (`.github/workflows/ci.yml`). Devnet suites (`tests/invariants.ts`,
`scripts/e2e_*.ts`) send real transactions, so run them by hand against the test cabinet (`CABINET_ID=2`). See
[TESTING.md](TESTING.md).

## Rules

- **Integer math only on chain.** Basis points (0–10_000) and grid units (0–1000). Game math goes in `math.rs` as
  pure functions with unit tests. Keep `scripts/lib/math.ts` and `app/src/lib/math.ts` in sync.
- **Session keys stay scoped.** Only `join_queue`, `move_claw` and `drop_claw` / `drop_claw_public` may accept one
  (through `authorize`). Never add a session key to anything that pays, withdraws or administers.
- **Program upgrades are additive.** Don't change existing account layouts or instruction arguments. The live
  cabinet and profiles depend on them.
- **No mocks in the play path.** If something is simulated, label it in the UI and the docs.
- **Never commit secrets.** `keys/`, keypair JSON and `.env*` are git-ignored. Check `git status` before you commit.
- Emit an event for every state change worth tracing, and add a named error for every new rejection.
- Record notable trade-offs in [docs/DECISIONS.md](docs/DECISIONS.md).

## Reporting security issues

Please don't open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
