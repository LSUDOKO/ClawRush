// Refill every empty capsule slot (authority only). Fails on-chain with VaultInsolvent if the vault can't cover it.
//   npx tsx scripts/restock.ts
import { loadKeypair, loadState } from "./lib/common.ts";
import { restockFree } from "./lib/admin.ts";
const r = await restockFree(loadKeypair(process.env.AUTHORITY ?? "~/.config/solana/id.json"), loadState(), Number(process.env.MIN_ACTIVE ?? 12));
console.log(r ? `restocked ${r.added} capsules: ${r.sig}` : "nothing to restock");
