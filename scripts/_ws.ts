import { Connection, PublicKey } from "@solana/web3.js";
const probe = PublicKey.findProgramAddressSync([Buffer.from("probe")], new PublicKey("9UwwBZu55wdbjQm3LdDKLHck79Sr95EPZsS5zRuvkKNs"))[0];
async function main() {
  const er = new Connection("https://devnet-tee.magicblock.app", { commitment: "confirmed", wsEndpoint: "wss://devnet-tee.magicblock.app" });
  try { const a = await er.getAccountInfo(probe); console.log("no-token getAccountInfo:", a ? a.owner.toBase58() + " len " + a.data.length : null); } catch (e: any) { console.log("no-token read err", e.message.slice(0, 150)); }
  try { const s = await er.getSignaturesForAddress(probe, { limit: 1 }); console.log("no-token getSignatures ok", s.length); } catch (e: any) { console.log("no-token sigs err", e.message.slice(0, 150)); }
  const id = er.onAccountChange(probe, (a) => console.log("ws update", a.data.length));
  setTimeout(() => { console.log("ws sub id", id); process.exit(0); }, 6000);
}
main();
