// Metaplex Token Metadata for the prize mints, so wallets (Solflare, Phantom) show each prize's name and art.
// KOI and ROBO have 0 decimals, so Token Metadata marks them FungibleAsset (semi-fungible collectibles).
// dUSDC is skipped: its mint authority is the faucet PDA, which cannot sign here.
// Builds CreateMetadataAccountV3 by hand (no Umi), so it works with the project's pinned web3.js.
//   CABINET_ID=1 npx tsx scripts/metaplex_metadata.ts
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { loadKeypair, loadState, base, sendTx, explorer } from "./lib/common.ts";

const TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const RAW = "https://raw.githubusercontent.com/LSUDOKO/ClawRush/main/app/public/meta";
const authority = loadKeypair(process.env.AUTHORITY ?? "~/.config/solana/id.json");
const st = loadState() as any;
const PRIZES: [string, string, string, string][] = [
  ["dGEM", "ClawRush Gem", "dGEM", `${RAW}/gem.json`],
  ["KOI", "ClawRush Koi", "KOI", `${RAW}/koi.json`],
  ["ROBO", "ClawRush Robo", "ROBO", `${RAW}/robo.json`],
];
const str = (s: string) => { const b = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };

for (const [key, name, symbol, uri] of PRIZES) {
  const mint = new PublicKey(st.mints[key]);
  const [metadata] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), mint.toBuffer()], TOKEN_METADATA);
  if (await base.getAccountInfo(metadata)) { console.log(key, "already has metadata", metadata.toBase58()); continue; }
  const fee = Buffer.alloc(2); // seller_fee_basis_points = 0
  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3
    str(name), str(symbol), str(uri), fee,
    Buffer.from([0, 0, 0]), // creators, collection, uses: None
    Buffer.from([1]), // is_mutable
    Buffer.from([0]), // collection_details: None
  ]);
  const ix = new TransactionInstruction({
    programId: TOKEN_METADATA,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false }, // mint authority
      { pubkey: authority.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: authority.publicKey, isSigner: true, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
  const r = await sendTx(base, [ix], [authority]);
  console.log(key, name, "metadata", metadata.toBase58(), explorer(r.sig));
}
