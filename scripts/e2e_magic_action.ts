// Magic Action payout, end to end on devnet: win a capsule, then one ER transaction
// (cash_out_and_settle) commits + undelegates the profile and pays the prize on L1.
//   PLAYER=playerA npx tsx scripts/e2e_magic_action.ts
// Checks: the prize lands in the wallet with no claim_prize transaction, pending is zeroed on L1,
// and a direct claim_prize afterwards fails with NothingToClaim (no double pay).
import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { SystemProgram } from "@solana/web3.js";
import { loadKeypair, loadState, base, sendTx, sleep, configPda, cabinetPda, vaultPda, PROGRAM_ID, MAGIC_PROGRAM, explorer } from "./lib/common.ts";
import { Player, OUTCOME, MINT_KEYS } from "./lib/client.ts";

const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
const st = loadState();
const p = new Player(loadKeypair(`keys/${process.env.PLAYER ?? "playerA"}.json`), st);
const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
await p.connect();
const w = p.wallet.publicKey;

// Fresh session with 3 credits.
await p.ensureProfile();
if (await p.isDelegated()) { log("profile delegated: plain cash_out first"); await p.cashOut(); await p.claimAll(); }
const prof0 = await p.pg.account.playerProfile.fetch(p.profile);
if (prof0.credits < 3) {
  if ((await p.usdcBalance()) < 3_000_000n) await p.faucet();
  await p.buyCredits(3 - prof0.credits);
}
await p.registerSession(3600);
await p.delegate();
log("delegated, session ready");

// Play aimed rounds until a capsule is held.
let won = false;
for (let r = 0; r < 3 && !won; r++) {
  let c = await p.cabinet();
  for (let i = 0; i < 40 && c.turnOwner.toBase58() !== PublicKey.default.toBase58(); i++) { await sleep(1000); c = await p.cabinet(); }
  await p.joinQueue();
  c = await p.cabinet();
  const caps = c.capsules.filter((k: any) => k.active && k.kind !== 2);
  const t = caps.sort((a: any, b: any) => Math.hypot(a.x - c.clawX, a.z - c.clawZ) - Math.hypot(b.x - c.clawX, b.z - c.clawZ))[0];
  await p.moveTo(t.x, t.z, { x: c.clawX, z: c.clawZ });
  const round = Number((await p.cabinet()).round);
  await p.drop();
  const res = await p.waitResult(round);
  log(`round ${round}: ${OUTCOME[res.last.outcome]} grip ${res.last.gripBps} roll ${res.last.rollBps}`);
  won = res.last.outcome === 1;
}
const pend = (await p.profileEr()).pending.map((x: any) => BigInt(x.toString()));
log("pending on ER:", pend.map(String).join(","));
if (!pend.some((x: bigint) => x > 0n)) { log("no win in 3 rounds; rerun"); process.exit(2); }

// The action pays into all four player token accounts: create missing ones on L1.
const st2 = st as any;
const mints = MINT_KEYS.map((k) => new PublicKey(st2.mints[k]));
const atas = mints.map((m) => getAssociatedTokenAddressSync(m, w));
const missing = (await base.getMultipleAccountsInfo(atas)).flatMap((a, i) => (a ? [] : [createAssociatedTokenAccountIdempotentInstruction(w, atas[i], w, mints[i])]));
if (missing.length) log("create ATAs", (await sendTx(base, missing, [p.wallet])).sig);
const before = await Promise.all(atas.map(async (a) => BigInt((await base.getTokenAccountBalance(a)).value.amount)));

// One ER transaction: commit + undelegate + Magic Action.
const ix = await p.pe.methods.cashOutAndSettle().accountsPartial({
  authority: w, profile: p.profile, config: configPda(), cabinet: cabinetPda(), vault: vaultPda(), program: PROGRAM_ID, magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT,
}).instruction();
const r = await sendTx(p.er, [ix], [p.wallet]);
log("cash_out_and_settle (ER)", explorer(r.sig, "er"));
try { log("commit (L1)", explorer(await GetCommitmentSignature(r.sig, p.er as any))); } catch (e: any) { log("commitment sig lookup:", String(e.message ?? e).slice(0, 100)); }

let back = false;
for (let i = 0; i < 60 && !back; i++) { const a = await base.getAccountInfo(p.profile); back = !!a && a.owner.equals(PROGRAM_ID); if (!back) await sleep(1000); }
log("profile back on L1:", back);
let paid = false;
for (let i = 0; i < 20 && !paid; i++) {
  const prof = await p.pg.account.playerProfile.fetch(p.profile);
  paid = prof.pending.every((x: any) => x.isZero());
  if (!paid) await sleep(1000);
}
const after = await Promise.all(atas.map(async (a) => BigInt((await base.getTokenAccountBalance(a)).value.amount)));
const delta = after.map((v, i) => v - before[i]);
log("L1 pending zeroed:", paid, "wallet delta:", delta.map(String).join(","), "expected:", pend.map(String).join(","));
const [last] = await base.getSignaturesForAddress(p.profile, { limit: 1 });
log("last L1 tx on profile", explorer(last.signature));

// Double-pay check: claim_prize must fail.
const m = pend.findIndex((x: bigint) => x > 0n);
const cix = await p.pg.methods.claimPrize(m).accountsPartial({
  authority: w, profile: p.profile, config: configPda(), mint: mints[m], vault: vaultPda(), vaultAta: new PublicKey(st2.vaultAtas[MINT_KEYS[m]]), playerAta: atas[m],
  tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
}).instruction();
try { await sendTx(base, [cix], [p.wallet]); log(paid ? "FAIL: claim_prize paid again" : "fallback claim_prize paid the prize"); process.exit(1); }
catch (e: any) { log("claim_prize after payout rejected:", /NothingToClaim|0x17|Nothing/.test(String(e.message ?? e) + JSON.stringify(e.logs ?? "")) ? "NothingToClaim" : String(e.message ?? e).slice(0, 120)); }
// Direct call to the action handler (no delegation-program escrow signature) must be rejected.
{
  // Correct escrow address ([b"balance", payer, 255] under the delegation program), but unsigned: only the signer check can stop this.
  const escrow = PublicKey.findProgramAddressSync([Buffer.from("balance"), w.toBuffer(), Buffer.from([255])], new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"))[0];
  const ixd = await p.pg.methods.settlePrizes().accountsPartial({
    config: configPda(), profile: p.profile, vault: vaultPda(), tokenProgram: TOKEN_PROGRAM_ID,
    vaultAta0: new PublicKey(st2.vaultAtas.dUSDC), vaultAta1: new PublicKey(st2.vaultAtas.dGEM), vaultAta2: new PublicKey(st2.vaultAtas.KOI), vaultAta3: new PublicKey(st2.vaultAtas.ROBO),
    playerAta0: atas[0], playerAta1: atas[1], playerAta2: atas[2], playerAta3: atas[3], sourceProgram: PROGRAM_ID, escrowAuth: w, escrow,
  }).instruction();
  try { await sendTx(base, [ixd], [p.wallet]); log("FAIL: direct settle_prizes accepted"); process.exit(1); }
  catch (e: any) { log("direct settle_prizes rejected:", /Unauthorized|signature|Signature|6021|0x1785/.test(String(e.message ?? e) + JSON.stringify(e.logs ?? "")) ? "Unauthorized (escrow not signed by delegation program)" : String(e.message ?? e).slice(0, 140)); }
}
const ok = paid && delta.every((d, i) => d === pend[i]);
log(ok ? "PASS: Magic Action paid the prize" : "Magic Action did not pay (fallback claim_prize still available)");
process.exit(ok ? 0 : 1);
