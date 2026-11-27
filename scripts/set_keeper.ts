// Register a low-privilege keeper key that may only restock (restock_by_keeper). Authority-signed, L1.
//   CABINET_ID=1 npx tsx scripts/set_keeper.ts <keeper pubkey>
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { loadKeypair, program, base, sendTx, configPda } from "./lib/common.ts";
import { keeperRolePda } from "./lib/admin.ts";

const authority = loadKeypair(process.env.AUTHORITY ?? "~/.config/solana/id.json");
const keeper = new PublicKey(process.argv[2]);
const pg = program(base, authority) as any;
const ix = await pg.methods.setKeeper(keeper).accountsPartial({ authority: authority.publicKey, config: configPda(), keeperRole: keeperRolePda(), systemProgram: SystemProgram.programId }).instruction();
const r = await sendTx(base, [ix], [authority]);
console.log("set_keeper", keeper.toBase58(), "role", keeperRolePda().toBase58(), r.sig);
