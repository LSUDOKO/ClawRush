// drop_claw_public on devnet: the drop resolves through VRF exactly like drop_claw, the drop transaction is
// readable from the TEE RPC with no token (drop_claw's is redacted because it lists the private vault),
// and the mystery vault itself stays unreadable. Also checks the keeper role cannot be used by strangers.
//   CABINET_ID=1 PLAYER=playerA npx tsx scripts/e2e_public_drop.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import { loadKeypair, loadState, sleep, ER_URL, configPda, cabinetPda, mysteryPda, vaultPda, base, program, sendTx, explorer } from "./lib/common.ts";
import { keeperRolePda } from "./lib/admin.ts";
import { Player, OUTCOME } from "./lib/client.ts";

const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
let fails = 0;
const check = (ok: boolean, what: string, detail = "") => { if (!ok) fails++; log(ok ? "PASS" : "FAIL", what, detail); };
const rpc = async (method: string, params: any[]) =>
  (await (await fetch(ER_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

const st = loadState() as any;
const p = new Player(loadKeypair(`keys/${process.env.PLAYER ?? "playerA"}.json`), st);
await p.connect();
await p.ensureProfile();
if (await p.isDelegated()) { await p.cashOutAndSettle(); await sleep(3000); await p.claimAll(); }
const prof = await p.pg.account.playerProfile.fetch(p.profile);
if (prof.credits < 1) { if ((await p.usdcBalance()) < 1_000_000n) await p.faucet(); await p.buyCredits(1); }
await p.registerSession(3600);
await p.delegate();

// Aim at a mystery capsule (MYSTERY=1) so a win also proves the callback still reads the derived vault.
const MYSTERY = !!process.env.MYSTERY, ROUNDS = Number(process.env.ROUNDS ?? 1);
let c: any, d: any, res: any;
for (let r = 0; r < ROUNDS; r++) {
  c = await p.cabinet();
  for (let i = 0; i < 40 && !c.turnOwner.equals(PublicKey.default); i++) { await sleep(1000); c = await p.cabinet(); }
  await p.joinQueue();
  c = await p.cabinet();
  const caps = c.capsules.filter((k: any) => k.active && (MYSTERY ? k.kind === 2 : true));
  const t = caps.sort((a: any, b: any) => Math.hypot(a.x - c.clawX, a.z - c.clawZ) - Math.hypot(b.x - c.clawX, b.z - c.clawZ))[0];
  if (t) await p.moveTo(t.x, t.z, { x: c.clawX, z: c.clawZ });
  const round = Number((await p.cabinet()).round);
  d = await p.dropPublic();
  res = await p.waitResult(round);
  check(true, "drop_claw_public resolved by the VRF callback", `${OUTCOME[res.last.outcome]} after ${res.ms} ms, revealed=${JSON.stringify(res.last.revealed ?? res.last.mysteryRevealed ?? null)}`);
  if (res.last.outcome === 1) break;
}
if (MYSTERY && res.last.outcome === 1) {
  const pend = (await p.profileEr()).pending.map(String);
  check(pend.some((x: string) => x !== "0"), "mystery win revealed and credited from the derived vault", `pending ${pend.join(",")}`);
}

const tx = await rpc("getTransaction", [d.sig, { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
check(!!tx?.transaction, "drop transaction readable from the TEE RPC with no token", explorer(d.sig, "er"));
check(!(await rpc("getAccountInfo", [mysteryPda().toBase58(), { encoding: "base64" }]))?.value, "mystery vault still unreadable with no token");

// Keeper role: a random key cannot restock, and only the authority can set the keeper.
const stranger = Keypair.generate();
const pe = program(p.er, stranger) as any;
try {
  const ix = await pe.methods.restockByKeeper([{ x: 500, z: 500, radius: 60, kind: 0, mintIdx: 0, amount: new anchor.BN(1), tier: 0 }]).accountsPartial({
    keeper: stranger.publicKey, keeperRole: keeperRolePda(), config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), vault: vaultPda(),
    vault0: new PublicKey(st.vaultAtas.dUSDC), vault1: new PublicKey(st.vaultAtas.dGEM), vault2: new PublicKey(st.vaultAtas.KOI), vault3: new PublicKey(st.vaultAtas.ROBO),
  }).instruction();
  await sendTx(p.er, [ix], [stranger]);
  check(false, "stranger restock_by_keeper rejected");
} catch (e: any) { check(/Unauthorized|0x1785|6021/.test(String(e.message ?? e)), "stranger restock_by_keeper rejected", String(e.message ?? e).match(/0x[0-9a-f]+/)?.[0] ?? ""); }
try {
  const pg = program(base, p.wallet) as any;
  const ix = await pg.methods.setKeeper(p.wallet.publicKey).accountsPartial({ authority: p.wallet.publicKey, config: configPda(), keeperRole: keeperRolePda() }).instruction();
  await sendTx(base, [ix], [p.wallet]);
  check(false, "player set_keeper rejected");
} catch (e: any) { check(/has_one|2001|0x7d1|ConstraintHasOne/.test(String(e.message ?? e) + JSON.stringify(e.logs ?? "")), "player set_keeper rejected", String(e.message ?? e).match(/0x[0-9a-f]+/)?.[0] ?? ""); }

await p.cashOutAndSettle(); await sleep(3000); await p.claimAll();
log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
