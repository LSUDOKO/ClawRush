// Two-player shared-queue test on devnet (real transactions, no mocks).
//   A takes the turn, B queues during A's turn, B's turn starts automatically when A's VRF result lands,
//   B times out, A clears B's turn with the permissionless expire_turn. Both cash out + claim on L1.
// Stop scripts/keeper.ts first, or it may clear B's expired turn before A does.
//   npx tsx scripts/e2e_two_player.ts
import fs from "fs";
import { loadKeypair, loadState, sleep, explorer, ROOT, idl } from "./lib/common.ts";
import { Player, OUTCOME } from "./lib/client.ts";

const st = loadState();
const A = new Player(loadKeypair("keys/playerA.json"), st);
const B = new Player(loadKeypair("keys/playerB.json"), st);
const rows: string[] = [];
const checks: { name: string; ok: boolean; detail: string }[] = [];
const log = (s: string) => { console.log(s); rows.push(s); };
const check = (name: string, ok: boolean, detail = "") => { checks.push({ name, ok, detail }); log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
async function expectErr(name: string, code: string, f: () => Promise<unknown>) {
  try { await f(); check(name, false, `expected ${code}, tx succeeded`); }
  catch (e: any) {
    // Program errors surface as "custom program error: 0x<code>"; match by name or by the IDL code.
    const hex = "0x" + (idl.errors.find((x: any) => x.name === code)?.code ?? -1).toString(16);
    const m = String(e?.message ?? e) + JSON.stringify(e?.logs ?? e?.transactionLogs ?? "");
    const ok = m.includes(code) || m.includes(`custom program error: ${hex}`);
    check(name, ok, ok ? `rejected with ${code} (${hex})` : m.slice(0, 200));
  }
}

async function setup(p: Player, name: string) {
  await p.connect();
  if (await p.isDelegated()) { log(`${name}: profile still delegated from an earlier run, cashing out first`); await p.cashOut(); await p.claimAll(); }
  await p.ensureProfile();
  if ((await p.usdcBalance()) < 2_000_000n) await p.faucet();
  await p.buyCredits(2);
  await p.registerSession(3600);
  await p.delegate();
  log(`${name} ready: ${p.wallet.publicKey.toBase58()} (session ${p.session.publicKey.toBase58().slice(0, 6)}…)`);
}

await Promise.all([setup(A, "A"), setup(B, "B")]);

// Wait for an idle cabinet (clear a stale turn if one is left over).
for (let i = 0; i < 40; i++) {
  const c = await A.cabinet();
  if (c.turnOwner.toBase58() === "11111111111111111111111111111111" && Number(c.qLen) === 0) break;
  const now = Date.now() / 1000;
  if (!c.pendingVrf && now > Number(c.turnExpiresAt) + 1) { try { await A.expireTurn(c.turnOwner); log("cleared a stale turn"); } catch { /* raced */ } }
  await sleep(1500);
}

await A.joinQueue();
let c = await A.cabinet();
check("A's join on an idle cabinet starts A's turn", c.turnOwner.equals(A.wallet.publicKey), `round ${c.round}`);
const roundA = Number(c.round);

await B.joinQueue();
c = await A.cabinet();
check("B's join during A's turn queues B", Number(c.qLen) === 1 && c.queue[Number(c.qHead)].equals(B.wallet.publicKey), `queue length ${c.qLen}`);
await expectErr("B cannot move during A's turn (session key)", "NotYourTurn", () => B.move(40, 0));
await expectErr("B cannot expire A's turn before it expires", "TurnNotExpired", () => B.expireTurn(A.wallet.publicKey));

await A.moveTo(400, 400, { x: c.clawX, z: c.clawZ });
await A.drop();
const r = await A.waitResult(roundA);
log(`A round ${roundA}: ${OUTCOME[r.last.outcome]} (grip ${r.last.gripBps} bps, roll ${r.last.rollBps}), VRF callback seen after ${r.ms} ms`);
c = await A.cabinet();
check("B's turn starts automatically when A's VRF result lands", c.turnOwner.equals(B.wallet.publicKey) && Number(c.round) === roundA + 1, `turn owner ${c.turnOwner.toBase58().slice(0, 6)}…, round ${c.round}`);

// B idles. Before expiry: rejected. After expiry: anyone (A) may clear it.
await expectErr("expire_turn before B's turn expires is rejected", "TurnNotExpired", () => A.expireTurn(B.wallet.publicKey));
const waitS = Number(c.turnExpiresAt) - Date.now() / 1000 + 2;
log(`waiting ${waitS.toFixed(1)} s for B's turn to expire…`);
await sleep(Math.max(0, waitS) * 1000);
let expired = false;
for (let i = 0; i < 5 && !expired; i++) {
  try { await A.expireTurn(B.wallet.publicKey); expired = true; } catch (e: any) { if (!String(e).includes("TurnNotExpired")) throw e; await sleep(1500); }
}
c = await A.cabinet();
check("A clears B's expired turn (permissionless expire_turn)", expired && !c.turnOwner.equals(B.wallet.publicKey), `turn owner now ${c.turnOwner.toBase58().slice(0, 6)}…`);
const bp = await B.profileEr();
check("B's in_queue flag is cleared", !bp.inQueue, `credits left ${bp.credits}`);

for (const [p, n] of [[A, "A"], [B, "B"]] as const) {
  const co = await p.cashOut();
  const claims = await p.claimAll();
  log(`${n} cashed out (ER ${co.erSig.slice(0, 8)}…, L1 commit ${co.baseSig ? co.baseSig.slice(0, 8) + "…" : "n/a"}), claims: ${claims.map((x) => `${x.amount} ${x.mint}`).join(", ") || "none"}`);
}

const txs = [...A.log.map((x) => ({ who: "A", ...x })), ...B.log.map((x) => ({ who: "B", ...x }))];
const md = [
  "# Two-player queue test (devnet)", "",
  `Run ${new Date().toISOString()} with \`npx tsx scripts/e2e_two_player.ts\` against cabinet ${st.cabinet}.`, "",
  "## Checks", "", "| Result | Check | Detail |", "|---|---|---|",
  ...checks.map((x) => `| ${x.ok ? "✅" : "❌"} | ${x.name} | ${x.detail.replace(/\|/g, "/")} |`), "",
  "## Transactions", "", "| Player | Step | Layer | Signature |", "|---|---|---|---|",
  ...txs.map((x) => `| ${x.who} | ${x.step} | ${x.layer === "er" ? "MagicBlock TEE ER" : "Solana devnet"} | [${x.sig.slice(0, 10)}…](${explorer(x.sig, x.layer)}) |`), "",
  "## Log", "", "```", ...rows, "```", "",
];
fs.writeFileSync(`${ROOT}/docs/E2E_TWO_PLAYER.md`, md.join("\n"));
console.log(`\n${checks.filter((x) => x.ok).length}/${checks.length} checks passed. Wrote docs/E2E_TWO_PLAYER.md`);
process.exit(checks.every((x) => x.ok) ? 0 : 1);
