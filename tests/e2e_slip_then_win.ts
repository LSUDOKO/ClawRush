// Two players, one capsule, real devnet + MagicBlock TEE transactions on the test cabinet (cabinet 2):
// players take alternate turns on the shared cabinet. While the capsule has not slipped, the player aims just inside
// its edge (grip near grip_min, so a SLIP is likely); once it has slipped, the next player aims dead centre at the
// position read back from chain (grip_max). The test passes only if the same capsule SLIPs (moves toward the chute,
// stays active) and is then HELD, and the winner's wallet and the vault change by exactly the prize after claim.
// Outcomes depend on VRF: if the bounded attempts run out, the run is reported as not completed, never as a pass.
//   CABINET_ID=2 npx tsx tests/e2e_slip_then_win.ts
import anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { CABINET_ID, base, erConn, program, sendTx, sleep, loadKeypair, loadState, explorer, configPda, cabinetPda, mysteryPda, vaultPda } from "../scripts/lib/common.ts";
import { Player, OUTCOME } from "../scripts/lib/client.ts";
import * as m from "../scripts/lib/math.ts";

if (CABINET_ID !== 2) throw new Error("Run against the test cabinet: CABINET_ID=2");
const BN = anchor.BN;
const U = 1_000_000n;
const PRIZE = U / 2n; // 0.5 dUSDC
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 10);
const CHUTE = { x: 900, z: 900 };
const st = loadState();
const admin = loadKeypair("~/.config/solana/id.json");
const A = new Player(loadKeypair("keys/testA.json"), st);
const B = new Player(loadKeypair("keys/testB.json"), st);
const names = new Map([[A, "A"], [B, "B"]]);
const mint0 = new PublicKey(st.mints.dUSDC), vault0 = new PublicKey(st.vaultAtas.dUSDC);
const bal = async (owner: PublicKey) => { try { return (await getAccount(base, getAssociatedTokenAddressSync(mint0, owner))).amount; } catch { return 0n; } };
const vaultBal = async () => (await getAccount(base, vault0)).amount;

let pass = 0, fail = 0;
const check = (ok: boolean, what: string, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? " — " + detail : ""}`); };

async function cleanup(p: Player) {
  try { if (await p.isDelegated()) await p.cashOut(); return await p.claimAll(); } catch (e: any) { console.log(`  cleanup ${names.get(p)}: ${String(e.message).slice(0, 160)}`); return []; }
}

// ───── setup: both players funded, 5 credits, session key, delegated ─────
for (const p of [A, B]) {
  await p.connect();
  await cleanup(p);
  await p.ensureProfile();
  const prof: any = await p.pg.account.playerProfile.fetch(p.profile);
  const need = Math.max(0, Math.ceil(MAX_TURNS / 2) - prof.credits);
  if (need && (await p.usdcBalance()) < BigInt(need) * U) await p.faucet();
  if (need) await p.buyCredits(need);
  await p.registerSession(3600);
  await p.delegate();
  console.log(`${names.get(p)} ready ${p.wallet.publicKey.toBase58()}`);
}

// ───── stock one 0.5 dUSDC capsule away from the chute ─────
const erAdmin = await erConn(admin);
const pe = program(erAdmin, admin);
let cab: any = await pe.account.cabinetState.fetch(cabinetPda());
const geos = (c: any) => c.capsules.map((k: any) => ({ x: k.x, z: k.z, radius: k.radius, active: k.active }));
const spot = [[250, 300], [300, 180], [180, 450], [450, 200], [400, 400]].find(([x, z]) =>
  cab.capsules.every((k: any) => !k.active || m.distance(x, z, k.x, k.z) > 2 * (k.radius + 60)));
if (!spot) throw new Error("no free spot for the test capsule");
let id = 0;
async function stock() {
  cab = await pe.account.cabinetState.fetch(cabinetPda());
  id = cab.nextCapsuleId;
  const rs = await sendTx(erAdmin, [await pe.methods.restock([{ x: spot[0], z: spot[1], radius: 60, kind: 0, mintIdx: 0, amount: new BN(PRIZE.toString()), tier: 0 }])
  .accountsPartial({ authority: admin.publicKey, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), vault: vaultPda(),
    vault0, vault1: new PublicKey(st.vaultAtas.dGEM), vault2: new PublicKey(st.vaultAtas.KOI), vault3: new PublicKey(st.vaultAtas.ROBO) }).instruction()], [admin]);
  console.log(`stocked capsule #${id} (0.5 dUSDC) at (${spot![0]}, ${spot![1]}) ${explorer(rs.sig, "er")}`);
}
await stock();

const start = { A: await bal(A.wallet.publicKey), B: await bal(B.wallet.publicKey), vault: await vaultBal() };
const capsule = (c: any) => c.capsules.find((k: any) => k.id === id);

// ───── alternate turns until the capsule slipped and was then held ─────
let slip: { by: string; from: [number, number]; to: [number, number]; frac: number } | null = null;
let win: { by: Player; amount: bigint; sig: string } | null = null;
const won = { A: 0n, B: 0n }; // every dUSDC prize this run, to check balances exactly
let heldFirst = 0;
try {
  for (let t = 0; t < MAX_TURNS && !win; t++) {
    const p = t % 2 === 0 ? A : B;
    // Wait for an idle cabinet (clear a stale expired turn if needed), then take the turn.
    for (let i = 0; i < 30; i++) {
      cab = await p.cabinet();
      if (cab.turnOwner.equals(PublicKey.default)) break;
      if (!cab.pendingVrf && Date.now() / 1000 > Number(cab.turnExpiresAt) + 1) { try { await p.expireTurn(cab.turnOwner); } catch { /* raced */ } }
      await sleep(1000);
    }
    await p.joinQueue();
    cab = await p.cabinet();
    const c = capsule(cab);
    if (!c?.active) throw new Error(`capsule #${id} is gone before it was won by this test`);
    // Aim: just inside the edge (90% of the radius) before the slip, dead centre after it.
    const off = slip ? 0 : Math.floor(c.radius * 0.9);
    const dirs: [number, number][] = [[-1, 0], [0, -1], [1, 0], [0, 1]];
    const aim = dirs.map(([dx, dz]) => [c.x + dx * off, c.z + dz * off] as [number, number])
      .find(([x, z]) => x >= 0 && x <= 1000 && z >= 0 && z <= 1000 && cab.capsules[m.nearest(geos(cab), x, z)![0]].id === id);
    if (!aim) throw new Error("no aim point selects the test capsule");
    await p.moveTo(aim[0], aim[1], { x: cab.clawX, z: cab.clawZ });
    const d = await p.drop();
    const r = await p.waitResult(Number(cab.round));
    const L = r.last;
    console.log(`  turn ${t + 1} ${names.get(p)}: ${OUTCOME[L.outcome]} on #${L.capsuleId} (align ${L.alignErrBps}, grip ${L.gripBps}, roll ${L.rollBps}) ${explorer(d.sig, "er")}`);
    const after = capsule(r.cabinet);
    if (L.outcome === 1 && L.mintIdx === 0) won[names.get(p) as "A" | "B"] += BigInt(L.amount.toString());
    if (L.capsuleId !== id) continue;
    if (L.outcome === 2 && !slip) {
      const from: [number, number] = [c.x, c.z], to: [number, number] = [after.x, after.z];
      slip = { by: names.get(p)!, from, to, frac: 0 };
      const d0 = m.distance(from[0], from[1], CHUTE.x, CHUTE.z), d1 = m.distance(to[0], to[1], CHUTE.x, CHUTE.z);
      slip.frac = (d0 - d1) / d0;
      check(after.active && after.slipCount === c.slipCount + 1, `capsule #${id} SLIPPED and stayed on the floor (active, slip_count ${c.slipCount}→${after.slipCount})`, `by ${slip.by}`);
      check(d1 < d0 && slip.frac >= 0.14 && slip.frac <= 0.66, `the slip moved it toward the chute by 15–65% of the way`, `(${from}) → (${to}), ${(slip.frac * 100).toFixed(1)}% closer`);
    } else if (L.outcome === 1) {
      if (!slip) { heldFirst++; console.log(`  capsule #${id} was HELD before any slip; restocking a fresh one`); await stock(); continue; }
      win = { by: p, amount: BigInt(L.amount.toString()), sig: d.sig };
      check(!after?.active && win.amount === PRIZE, `capsule #${id} HELD by ${names.get(p)} after the slip, prize ${Number(win.amount) / 1e6} dUSDC`, `at (${slip.to})`);
    }
  }
} catch (e: any) {
  console.log(`  stopped: ${String(e.message).slice(0, 200)}`);
} finally {
  // ───── settle: both cash out and claim; balances must move by exactly the prize ─────
  const claims = { A: await cleanup(A), B: await cleanup(B) };
  const end = { A: await bal(A.wallet.publicKey), B: await bal(B.wallet.publicKey), vault: await vaultBal() };
  console.log(`  claims: ${JSON.stringify(claims)}`);
  if (win) {
    const extra = heldFirst ? ` (incl. ${heldFirst} capsule(s) held before slipping)` : "";
    for (const k of ["A", "B"] as const) check(end[k] - start[k] === won[k], `${k}'s wallet received exactly its prizes${extra}`, `+${Number(end[k] - start[k]) / 1e6} dUSDC, won ${Number(won[k]) / 1e6}`);
    check(start.vault - end.vault === won.A + won.B, `the vault paid out exactly the prizes`, `-${Number(start.vault - end.vault) / 1e6} dUSDC`);
  }
  const done = !!(slip && win);
  console.log(`\n${pass} passed, ${fail} failed${done ? "" : ", NOT COMPLETED (no slip followed by a win within " + MAX_TURNS + " turns)"}`);
  process.exit(fail ? 1 : done ? 0 : 2);
}
