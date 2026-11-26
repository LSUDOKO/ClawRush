// Is a restock transaction's instruction data (the mystery contents) recoverable from the TEE RPC?
// Control: a join_queue tx (public account only). Raw JSON-RPC, base64 encoding, no parsing by web3.js.
import { Keypair } from "@solana/web3.js";
import { ER_URL, loadState, loadKeypair, sleep } from "./lib/common.ts";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";

const st = loadState();
const RESTOCK = process.env.RESTOCK ?? st.firstRestockSig;
const CONTROL = process.env.CONTROL!;
const tok = async (kp: Keypair) => (await getAuthToken(ER_URL, kp.publicKey, async (m) => nacl.sign.detached(m, kp.secretKey))).token;
async function rpc(url: string, method: string, params: any[]) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return r.json();
}
const describe = (j: any) => {
  if (j.error) return `error ${JSON.stringify(j.error).slice(0, 100)}`;
  const t = j.result;
  if (!t) return "null";
  if (!t.transaction || typeof t.transaction[0] !== "string") return `REDACTED shape: ${JSON.stringify(t).slice(0, 400)}`;
  const raw = Buffer.from(t.transaction[0], "base64");
  return `found: ${raw.length} bytes raw tx, slot ${t.slot}, logs ${t.meta?.logMessages?.length ?? "n/a"}, rawhex[-48:] ${raw.subarray(-48).toString("hex")}`;
};
const stranger = Keypair.generate();
const auth = loadKeypair("~/.config/solana/id.json");
const urls: [string, string][] = [["no token", ER_URL], ["stranger token", `${ER_URL}?token=${await tok(stranger)}`], ["authority token", `${ER_URL}?token=${await tok(auth)}`]];
for (const [name, sig] of [["CONTROL join_queue", CONTROL], ["RESTOCK", RESTOCK]]) {
  for (const [who, url] of urls) {
    const j = await rpc(url, "getTransaction", [sig, { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    console.log(`${name.padEnd(20)} ${who.padEnd(16)} ${describe(j)}`);
    await sleep(200);
  }
}
