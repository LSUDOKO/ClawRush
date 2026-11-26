// Privacy check: can anyone read the sealed mystery vault, or recover its contents from the restock tx?
import { Keypair, PublicKey } from "@solana/web3.js";
import { erConn, erPublic, loadState, loadKeypair, mysteryPda, cabinetPda } from "./lib/common.ts";

async function main() {
  const st = loadState();
  const mystery = mysteryPda(), cabinet = cabinetPda();
  const stranger = Keypair.generate();
  const out: Record<string, string> = {};
  const probe = async (label: string, f: () => Promise<any>) => {
    try { const r = await f(); out[label] = r == null ? "null" : typeof r === "string" ? r : JSON.stringify(r).slice(0, 160); }
    catch (e: any) { out[label] = "ERROR " + String(e.message ?? e).slice(0, 160); }
  };
  await probe("cabinet (public, no token)", async () => { const a = await erPublic.getAccountInfo(cabinet); return a ? `ok ${a.data.length} bytes` : null; });
  await probe("mystery (no token)", async () => { const a = await erPublic.getAccountInfo(mystery); return a ? `DATA ${a.data.length} bytes nonzero=${a.data.some((b, i) => i > 11 && b)}` : null; });
  const sc = await erConn(stranger);
  await probe("mystery (stranger token)", async () => { const a = await sc.getAccountInfo(mystery); return a ? `DATA ${a.data.length} bytes nonzero=${a.data.some((b, i) => i > 11 && b)}` : null; });
  const auth = loadKeypair("~/.config/solana/id.json");
  const ac = await erConn(auth);
  await probe("mystery (authority token)", async () => { const a = await ac.getAccountInfo(mystery); return a ? `DATA ${a.data.length} bytes` : null; });
  await probe("restock tx (no token)", async () => { const t = await erPublic.getTransaction(st.firstRestockSig, { maxSupportedTransactionVersion: 0 }); return t ? `VISIBLE ixdata=${t.transaction.message.compiledInstructions?.[0]?.data?.length}` : null; });
  await probe("restock tx (stranger)", async () => { const t = await sc.getTransaction(st.firstRestockSig, { maxSupportedTransactionVersion: 0 }); return t ? `VISIBLE ixs=${t.transaction.message.compiledInstructions.length} logs=${t.meta?.logMessages?.length}` : null; });
  await probe("restock tx (authority)", async () => { const t = await ac.getTransaction(st.firstRestockSig, { maxSupportedTransactionVersion: 0 }); return t ? `VISIBLE ixs=${t.transaction.message.compiledInstructions.length}` : null; });
  await probe("mystery sigs (stranger)", async () => { const s = await sc.getSignaturesForAddress(mystery); return `${s.length} sigs`; });
  console.table(out);
}
main().catch((e) => { console.error(e); process.exit(1); });
