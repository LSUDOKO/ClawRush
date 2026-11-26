// Spike: verifies MagicBlock assumptions on devnet before building the real program.
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { GetCommitmentSignature, getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import fs from "fs";
import os from "os";

const ER = process.env.ER_URL ?? "https://devnet-tee.magicblock.app";
const VALIDATOR = new PublicKey(process.env.ER_VALIDATOR ?? "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const idl = JSON.parse(fs.readFileSync("target/idl/clawrush.json", "utf8"));
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json", "utf8"))));
const base = new Connection("https://api.devnet.solana.com", "confirmed");
let er = new Connection(ER, "confirmed");
const mk = (c: Connection, kp: Keypair) => new anchor.AnchorProvider(c, new anchor.Wallet(kp), { commitment: "confirmed" });
const progBase = new anchor.Program(idl, mk(base, wallet));
const [probe] = PublicKey.findProgramAddressSync([Buffer.from("probe")], progBase.programId);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function sendEr(tx: Transaction, signer: Keypair) {
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(signer);
  const t0 = Date.now();
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await er.confirmTransaction(sig, "confirmed");
  return { sig, ms: Date.now() - t0 };
}

async function main() {
  const step = process.argv[2] ?? "all";
  const info = await base.getAccountInfo(probe);
  if (!info) {
    const s = await progBase.methods.probeInit().accounts({ payer: wallet.publicKey }).rpc();
    console.log("init", s);
  }
  const cur = await base.getAccountInfo(probe);
  if (cur && cur.owner.equals(progBase.programId)) {
    const s = await progBase.methods.probeDelegate().accounts({ payer: wallet.publicKey })
      .remainingAccounts([{ pubkey: VALIDATOR, isSigner: false, isWritable: false }]).rpc();
    console.log("delegate", s);
    await sleep(4000);
  }
  // 2. unfunded fee payer (+ TEE auth token signed by that same key)
  const fresh = Keypair.generate();
  if (ER.includes("tee")) {
    const t0 = Date.now();
    const { token } = await getAuthToken(ER, fresh.publicKey, async (m) => nacl.sign.detached(m, fresh.secretKey));
    console.log("auth token in", Date.now() - t0, "ms");
    er = new Connection(`${ER}?token=${token}`, "confirmed");
  }
  const progEr = new anchor.Program(idl, mk(er, fresh));
  for (let i = 0; i < 3; i++) {
    try {
      const tx = await progEr.methods.probeBump().accounts({ payer: fresh.publicKey }).transaction();
      const r = await sendEr(tx, fresh);
      console.log("bump unfunded ok", r);
      break;
    } catch (e: any) { console.log("bump err", e.message?.slice(0, 300)); await sleep(3000); }
  }
  const acc: any = await progEr.account.probe.fetch(probe);
  console.log("ER clock vs wall:", Number(acc.ts), Math.floor(Date.now() / 1000));
  // 3. VRF
  if (step === "all" || step === "vrf") {
    const before = acc.rnd;
    const tx = await progEr.methods.probeRoll(7).accounts({ payer: fresh.publicKey }).transaction();
    const r = await sendEr(tx, fresh);
    console.log("vrf request", r);
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const a: any = await progEr.account.probe.fetch(probe);
      if (Number(a.ts) !== Number(acc.ts) && a.rnd !== undefined) { console.log("callback landed after", Date.now() - t0, "ms rnd", a.rnd, "before", before); break; }
    }
    const sigs = await er.getSignaturesForAddress(probe, { limit: 5 });
    console.log("recent ER sigs on probe:", sigs.map(s => s.signature.slice(0, 20) + " err=" + JSON.stringify(s.err)));
  }
  if (step === "all" || step === "undel") {
    const tx = await progEr.methods.probeUndelegate().accounts({ payer: fresh.publicKey }).transaction();
    const r = await sendEr(tx, fresh);
    console.log("undelegate ER", r);
    const c = await GetCommitmentSignature(r.sig, er);
    console.log("commit base sig", c);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
