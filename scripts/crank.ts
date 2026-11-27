// MagicBlock crank: schedule `crank_tick` on the ER so idle turns clear with no keeper server.
//   CABINET_ID=2 npx tsx scripts/crank.ts tick            # one direct tick (proves the ER runs the new code)
//   CABINET_ID=1 npx tsx scripts/crank.ts schedule [ms] [n] # schedule the recurring task (admin)
//   CABINET_ID=1 npx tsx scripts/crank.ts watch            # print cabinet turn changes
import { loadKeypair, program, erConn, sendTx, sleep, configPda, cabinetPda, MAGIC_PROGRAM, PROGRAM_ID } from "./lib/common.ts";

const authority = loadKeypair(process.env.AUTHORITY ?? "~/.config/solana/id.json");
const er = await erConn(authority);
const pe = program(er, authority) as any;
const [cmd = "tick", a1, a2] = process.argv.slice(2);

if (cmd === "tick") {
  const ix = await pe.methods.crankTick().accountsPartial({ config: configPda(), cabinet: cabinetPda() }).instruction();
  const r = await sendTx(er, [ix], [authority]);
  console.log("crank_tick ok", r.sig);
} else if (cmd === "schedule") {
  const ms = Number(a1 ?? 2000), n = Number(a2 ?? 50000);
  const ix = await pe.methods.scheduleCrank(new (await import("@coral-xyz/anchor")).BN(ms), new (await import("@coral-xyz/anchor")).BN(n))
    .accountsPartial({ authority: authority.publicKey, config: configPda(), cabinet: cabinetPda(), magicProgram: MAGIC_PROGRAM, program: PROGRAM_ID })
    .instruction();
  const r = await sendTx(er, [ix], [authority]);
  console.log("schedule_crank accepted", r.sig, `every ${ms} ms x ${n}`);
} else if (cmd === "watch") {
  let last = "";
  for (;;) {
    const c = await pe.account.cabinetState.fetch(cabinetPda());
    const s = `round ${c.round} owner ${c.turnOwner.toBase58().slice(0, 6)} expires ${c.turnExpiresAt} expired ${c.expired}`;
    if (s !== last) console.log(new Date().toISOString().slice(11, 19), s, "now", Math.floor(Date.now() / 1000));
    last = s;
    await sleep(1500);
  }
}
