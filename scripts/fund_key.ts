// Fund a local test key from the devnet authority:  NAME=webtest SOL=0.3 npx tsx scripts/fund_key.ts
import { loadOrCreateKeypair, loadKeypair, base } from "./lib/common.ts";
import { fund } from "./lib/client.ts";
const kp = loadOrCreateKeypair(`keys/${process.env.NAME ?? "webtest"}.json`);
await fund(loadKeypair("~/.config/solana/id.json"), kp.publicKey, Number(process.env.SOL ?? 0.3));
console.log(kp.publicKey.toBase58(), (await base.getBalance(kp.publicKey)) / 1e9, "SOL");
