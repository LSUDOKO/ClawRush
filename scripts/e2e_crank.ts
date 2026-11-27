// Proves the MagicBlock crank, not a keeper or the app, clears an idle turn.
// Stop scripts/keeper.ts first. Joins the queue, never drops, then finds the ER transaction that ended the turn.
//   CABINET_ID=1 PLAYER=playerB npx tsx scripts/e2e_crank.ts
import { PublicKey } from "@solana/web3.js";
import { loadKeypair, loadState, sleep, cabinetPda, explorer } from "./lib/common.ts";
import { Player } from "./lib/client.ts";

const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const p = new Player(loadKeypair(`keys/${process.env.PLAYER ?? "playerB"}.json`), loadState());
await p.connect();
await p.ensureProfile();
if (await p.isDelegated()) { await p.cashOutAndSettle(); await sleep(3000); await p.claimAll(); }
const prof = await p.pg.account.playerProfile.fetch(p.profile);
if (prof.credits < 1) { if ((await p.usdcBalance()) < 1_000_000n) await p.faucet(); await p.buyCredits(1); }
await p.registerSession(3600);
await p.delegate();

let c = await p.cabinet();
for (let i = 0; i < 40 && !c.turnOwner.equals(PublicKey.default); i++) { await sleep(1000); c = await p.cabinet(); }
const expiredBefore = Number(c.expired);
await p.joinQueue();
c = await p.cabinet();
const round = Number(c.round);
log(`joined: round ${round}, turn ends at ${c.turnExpiresAt}; idling (no drop, no expire_turn)`);
const t0 = Date.now();
while (Number(c.expired) === expiredBefore && Date.now() - t0 < 60_000) { await sleep(1000); c = await p.cabinet(); }
log(`turn cleared after ${((Date.now() - t0) / 1000).toFixed(1)} s, expired ${expiredBefore} -> ${c.expired}`);

// The tick that did work emits events ("Program data:"); idle ticks emit none.
const sigs = await p.er.getSignaturesForAddress(cabinetPda(), { limit: 30 });
let found = "";
for (const s of sigs) {
  const t = await p.er.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  const l = t?.meta?.logMessages ?? [];
  if (l.some((x) => x.includes("Instruction: CrankTick")) && l.some((x) => x.startsWith("Program data:"))) { found = s.signature; break; }
  if (l.some((x) => x.includes("Instruction: ExpireTurn"))) { log("WARNING: an ExpireTurn tx ran:", s.signature); }
}
log(found ? `cleared by CrankTick ${explorer(found, "er")}` : "no CrankTick with events found in the last 30 cabinet txs");
await p.cashOutAndSettle(); await sleep(3000); await p.claimAll();
process.exit(found ? 0 : 1);
