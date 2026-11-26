// Play N real rounds on the devnet TEE cabinet and record every outcome and signature.
//   ROUNDS=30 PLAYERS=playerA,playerB npx tsx scripts/devnet_rounds.ts
// Output: scripts/rounds.devnet.json (append) and docs/DEVNET_ROUNDS.md (regenerated).
import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";
import { loadKeypair, loadState, sleep, ROOT, explorer, idl } from "./lib/common.ts";
import { Player, OUTCOME, MINT_KEYS } from "./lib/client.ts";
import { restockFree } from "./lib/admin.ts";
const authority = loadKeypair(process.env.AUTHORITY ?? "~/.config/solana/id.json");

const ROUNDS = Number(process.env.ROUNDS ?? 2);
const NAMES = (process.env.PLAYERS ?? "playerA").split(",");
const OUT = path.join(ROOT, "scripts", "rounds.devnet.json");

async function prepare(p: Player, credits: number) {
  await p.ensureProfile();
  if (await p.isDelegated()) {
    let prof = await p.profileEr();
    if (prof.inQueue) {
      // Left in queue by an interrupted run: wait for its turn to expire, then clear it (permissionless).
      const c = await p.cabinet();
      if (c.turnOwner.equals(p.wallet.publicKey)) {
        await sleep(Math.max(0, (Math.max(Number(c.turnExpiresAt), c.pendingVrf ? Number(c.dropAt) + 31 : 0) - Date.now() / 1000 + 2) * 1000));
        await p.expireTurn(p.wallet.publicKey, p.wallet);
      }
      prof = await p.profileEr();
      if (prof.inQueue) throw new Error(`${p.wallet.publicKey.toBase58()} still in queue on ER`);
    }
    await p.cashOut();
  }
  const prof = await p.pg.account.playerProfile.fetch(p.profile);
  const need = Math.max(0, credits - prof.credits);
  if (need > 0) {
    if ((await p.usdcBalance()) < BigInt(need) * 1_000_000n) await p.faucet();
    await p.buyCredits(Math.min(need, 20));
  }
  await p.registerSession(3 * 3600);
  await p.delegate();
}

// Background RPC calls inside web3.js (confirmation polling) can reject after the awaited call already settled.
// Log them instead of crashing; failures of awaited round steps are still caught and recorded per round.
process.on("unhandledRejection", (e: any) => console.log("   (background rpc error ignored:", String(e?.message ?? e).slice(0, 120) + ")"));

async function retry<T>(f: () => Promise<T>, n = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await f(); } catch (e: any) { if (i >= n) throw e; console.log(`   setup retry ${i}: ${String(e.message ?? e).slice(0, 100)}`); await sleep(3000 * i); }
  }
}

async function main() {
  const st = loadState();
  const players = NAMES.map((n) => new Player(loadKeypair(`keys/${n}.json`), st));
  const per = Math.ceil(ROUNDS / players.length);
  for (const p of players) { await retry(() => p.connect()); await retry(() => prepare(p, per)); }
  const results: any[] = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
  let failures = 0;

  for (let r = 0; r < ROUNDS; r++) {
    const p = players[r % players.length];
    const row: any = { at: new Date().toISOString(), player: p.wallet.publicKey.toBase58() };
    const logStart = p.log.length;
    try {
      const rs = await restockFree(authority, st, 5);
      if (rs) { console.log(`   restock +${rs.added} ${rs.sig.slice(0, 16)}`); row.restockSig = rs.sig; }
      let c = await p.cabinet();
      // Clear a stale turn left by someone else (permissionless expire).
      if (c.turnOwner.toBase58() !== "11111111111111111111111111111111" && !c.turnOwner.equals(p.wallet.publicKey)) {
        const now = Date.now() / 1000;
        if (now > Number(c.turnExpiresAt) + 1 || (c.pendingVrf && now > Number(c.dropAt) + 31)) await p.expireTurn(c.turnOwner);
        else { await sleep(Math.max(0, (Number(c.turnExpiresAt) - now + 2) * 1000)); await p.expireTurn(c.turnOwner).catch(() => {}); }
      }
      await p.joinQueue();
      c = await p.cabinet();
      if (!c.turnOwner.equals(p.wallet.publicKey)) throw new Error("turn did not start for us");
      const round = Number(c.round);
      // Aim at a random active capsule with skill noise (0 = perfect .. 1.2 = sloppy, in radii).
      const act = c.capsules.filter((k: any) => k.active);
      const t = act[Math.floor(Math.random() * act.length)];
      const noise = [0, 0.3, 0.6, 1.2][r % 4] * t.radius;
      const ang = Math.random() * Math.PI * 2;
      const tx = Math.round(Math.max(0, Math.min(1000, t.x + Math.cos(ang) * noise)));
      const tz = Math.round(Math.max(0, Math.min(1000, t.z + Math.sin(ang) * noise)));
      const tMove = Date.now();
      row.moves = await p.moveTo(tx, tz, { x: c.clawX, z: c.clawZ });
      row.moveMs = Date.now() - tMove;
      const d = await p.drop();
      const res = await p.waitResult(round);
      const L = res.last;
      Object.assign(row, {
        round, target: { id: t.id, kind: t.kind }, aim: { x: tx, z: tz },
        capsuleId: L.capsuleId, kind: L.kind, alignErrBps: L.alignErrBps, gripBps: L.gripBps, rollBps: L.rollBps,
        outcome: OUTCOME[L.outcome], mint: L.amount.isZero() ? null : MINT_KEYS[L.mintIdx], amount: L.amount.toString(), tier: L.tier,
        vrfMs: res.ms, dropSig: d.sig, ok: true,
      });
      console.log(`#${r + 1} round ${round} ${OUTCOME[L.outcome]} align=${L.alignErrBps} grip=${L.gripBps} roll=${L.rollBps} vrf=${res.ms}ms moves=${row.moves}/${row.moveMs}ms ${row.mint ? row.amount + " " + row.mint : ""}`);
    } catch (e: any) {
      failures++;
      Object.assign(row, { ok: false, error: String(e.message ?? e).slice(0, 400) });
      console.log(`#${r + 1} FAILED: ${row.error}`);
      await sleep(3000);
    }
    row.txs = p.log.slice(logStart);
    results.push(row);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  }

  // Settle: cash out + claim for every player.
  for (const p of players) {
    try {
      const co = await p.cashOut();
      const claims = await p.claimAll();
      results.push({ at: new Date().toISOString(), player: p.wallet.publicKey.toBase58(), settlement: { cashOut: co, claims }, ok: true });
      console.log("settled", p.wallet.publicKey.toBase58().slice(0, 6), JSON.stringify(claims));
    } catch (e: any) {
      results.push({ at: new Date().toISOString(), player: p.wallet.publicKey.toBase58(), settlement: null, ok: false, error: String(e.message ?? e).slice(0, 400) });
      console.log("settle FAILED", e.message);
    }
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  }
  writeReport(results);
  console.log(`done: ${ROUNDS} rounds, ${failures} failures`);
}

/** "custom program error: 0x1771" → "TurnExpired (0x1771)" using the IDL. */
function explain(err: string) {
  const m = /custom program error: (0x[0-9a-f]+)/.exec(err);
  const e = m && idl.errors.find((x: any) => x.code === parseInt(m[1], 16));
  return e ? `${e.name} (${m![1]}): ${e.msg ?? ""}` : err;
}

function writeReport(all: any[]) {
  const rounds = all.filter((r) => r.round !== undefined || (r.ok === false && !("settlement" in r)));
  const ok = rounds.filter((r) => r.ok);
  const by = (o: string) => ok.filter((r) => r.outcome === o).length;
  const vrf = ok.map((r) => r.vrfMs).sort((a, b) => a - b);
  const med = vrf.length ? vrf[Math.floor(vrf.length / 2)] : 0;
  const lines = [
    "# Devnet rounds (real transactions)",
    "",
    "Generated by `scripts/devnet_rounds.ts` from `scripts/rounds.devnet.json`. Every row is a real MagicBlock TEE ER round on devnet.",
    "Drop transactions list the sealed mystery vault, so the TEE RPC returns them redacted to everyone (see decision 14 in docs/DECISIONS.md);",
    "the outcome of each round is public in the cabinet account (`last`), and the settlement rows below are public L1 transactions.",
    "Failed rows are real failures: the error is decoded from the program's custom error code.",
    "",
    `Attempts: ${rounds.length} · succeeded: ${ok.length} · failed: ${rounds.length - ok.length}`,
    `Outcomes: HELD ${by("HELD")} · SLIP ${by("SLIP")} · MISS ${by("MISS")} · median VRF callback seen after ${med} ms`,
    "",
    "| # | time (UTC) | player | round | align bps | grip bps | roll bps | outcome | prize | VRF ms | drop tx |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rounds.map((r, i) => r.ok
      ? `| ${i + 1} | ${r.at.slice(0, 19)} | ${r.player.slice(0, 6)} | ${r.round} | ${r.alignErrBps} | ${r.gripBps} | ${r.rollBps} | ${r.outcome} | ${r.mint ? `${r.amount} ${r.mint}` : "-"} | ${r.vrfMs} | \`${r.dropSig.slice(0, 12)}…\` |`
      : `| ${i + 1} | ${r.at.slice(0, 19)} | ${r.player.slice(0, 6)} | - | - | - | - | **FAILED** | ${explain(String(r.error)).replace(/\|/g, "/").slice(0, 160)} | - | - |`),
    "",
    "## Settlements (L1)",
    "",
    ...all.filter((r) => "settlement" in r).map((r) => r.ok
      ? `- ${r.player.slice(0, 6)}: cash_out commit ${r.settlement.cashOut.baseSig ? `[L1 tx](${explorer(r.settlement.cashOut.baseSig)})` : "(commit sig not returned)"}; claims: ${r.settlement.claims.map((c: any) => `${c.amount} ${c.mint} [tx](${explorer(c.sig)})`).join(", ") || "none"}`
      : `- ${r.player.slice(0, 6)}: **FAILED** ${r.error}`),
    "",
  ];
  fs.writeFileSync(path.join(ROOT, "docs", "DEVNET_ROUNDS.md"), lines.join("\n"));
}

if (process.env.REPORT_ONLY) writeReport(JSON.parse(fs.readFileSync(OUT, "utf8")));
else main().catch((e) => { console.error(e); process.exit(1); });
