// Cabinet keeper (operator process): restocks when capsules run low and clears expired turns.
// expire_turn is permissionless on chain; restock is authority-only (it writes the private mystery vault).
//   npx tsx scripts/keeper.ts
import { PublicKey } from "@solana/web3.js";
import { loadKeypair, loadState, program, erConn, sendTx, sleep, configPda, cabinetPda, playerPda } from "./lib/common.ts";
import { restockFree } from "./lib/admin.ts";

const authority = loadKeypair(process.env.AUTHORITY ?? "~/.config/solana/id.json");
const st = loadState();
const MIN_ACTIVE = Number(process.env.MIN_ACTIVE ?? 6);
const NO_TURN = PublicKey.default.toBase58();
const er = await erConn(authority);
const pe = program(er, authority) as any;
console.log("keeper running for cabinet", st.cabinet);
process.on("unhandledRejection", (e: any) => console.log(new Date().toISOString(), "background rpc error ignored:", String(e?.message ?? e).slice(0, 120)));
for (;;) {
  try {
    const c = await pe.account.cabinetState.fetch(cabinetPda());
    const now = Date.now() / 1000;
    const owner = c.turnOwner.toBase58();
    const stuck = owner !== NO_TURN && (c.pendingVrf ? now > Number(c.dropAt) + 32 : now > Number(c.turnExpiresAt) + 3);
    if (stuck) {
      const ix = await pe.methods.expireTurn().accountsPartial({ signer: authority.publicKey, config: configPda(), cabinet: cabinetPda(), profile: playerPda(c.turnOwner) }).instruction();
      const r = await sendTx(er, [ix], [authority]);
      console.log(new Date().toISOString(), "expire_turn", owner.slice(0, 6), r.sig);
    } else if (!c.pendingVrf) {
      const rs = await restockFree(authority, st, MIN_ACTIVE);
      if (rs) console.log(new Date().toISOString(), "restock +" + rs.added, rs.sig);
    }
  } catch (e: any) {
    console.log(new Date().toISOString(), "keeper error", String(e.message ?? e).slice(0, 200));
  }
  await sleep(4000);
}
