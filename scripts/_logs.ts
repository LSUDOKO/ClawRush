// debug helper: print ER logs for recent txs touching an account (TEE token auth)
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
const ER = process.env.ER_URL ?? "https://devnet-tee.magicblock.app";
async function main() {
  const k = Keypair.generate();
  const { token } = await getAuthToken(ER, k.publicKey, async (m) => nacl.sign.detached(m, k.secretKey));
  const er = new Connection(`${ER}?token=${token}`, "confirmed");
  const arg = process.argv[2];
  const sigs = arg.length > 60 ? [arg] : (await er.getSignaturesForAddress(new PublicKey(arg), { limit: Number(process.argv[3] ?? 4) })).map(s => s.signature);
  for (const sig of sigs) {
    const tx: any = await er.getTransaction(sig, { maxSupportedTransactionVersion: 1 } as any);
    console.log("==", sig, JSON.stringify(tx?.meta?.err));
    console.log((tx?.meta?.logMessages ?? []).join("\n"));
  }
}
main();
