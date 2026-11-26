import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { program, erConn, sendTx, configPda, cabinetPda, mysteryPda, vaultPda } from "./common.ts";
import { specFor } from "./stock.ts";

/** Fill every free slot i with specFor(i). Returns the ER signature, or null if nothing to do. */
export async function restockFree(authority: Keypair, st: any, minActive = 12) {
  const er = await erConn(authority);
  const pe = program(er, authority) as any;
  const cab = await pe.account.cabinetState.fetch(cabinetPda());
  const free = cab.capsules.map((c: any, i: number) => (c.active ? -1 : i)).filter((i: number) => i >= 0);
  if (12 - free.length >= minActive || free.length === 0) return null;
  // Slots fill lowest-first on chain, so the i-th spec lands in the i-th free slot.
  const specs = free.map((i: number) => { const s = specFor(i); return { ...s, amount: new anchor.BN(s.amount.toString()) }; });
  const ix = await pe.methods.restock(specs).accountsPartial({
    authority: authority.publicKey, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), vault: vaultPda(),
    vault0: new PublicKey(st.vaultAtas.dUSDC), vault1: new PublicKey(st.vaultAtas.dGEM),
    vault2: new PublicKey(st.vaultAtas.KOI), vault3: new PublicKey(st.vaultAtas.ROBO),
  }).instruction();
  const r = await sendTx(er, [ix], [authority]);
  return { sig: r.sig, added: specs.length };
}
