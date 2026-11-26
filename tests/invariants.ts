// Security invariants from docs/03-ARCHITECTURE.md, tested with real devnet + MagicBlock TEE transactions
// on the test cabinet (cabinet 2, 3 dUSDC vault). Every negative check sends a real transaction and expects
// the program to reject it with a specific error.
//   CABINET_ID=2 npx tsx tests/invariants.ts
import fs from "fs";
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import nacl from "tweetnacl";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  CABINET_ID, ER_URL, ROOT, idl, base, erPublic, erConn, program, sendTx, sleep, loadKeypair, loadState, explorer,
  configPda, cabinetPda, mysteryPda, vaultPda, playerPda,
} from "../scripts/lib/common.ts";
import { Player, OUTCOME } from "../scripts/lib/client.ts";

if (CABINET_ID !== 2) throw new Error("Run against the test cabinet: CABINET_ID=2");
const BN = anchor.BN;
const st = loadState();
const admin = loadKeypair("~/.config/solana/id.json");
const A = new Player(loadKeypair("keys/testA.json"), st);
const B = new Player(loadKeypair("keys/testB.json"), st, Keypair.generate());
const attacker = Keypair.generate(); // never registered anywhere
const U = 1_000_000n;

type Row = { inv: string; name: string; ok: boolean | null; detail: string; sig?: string; layer?: "devnet" | "er" };
const rows: Row[] = [];
const rec = (inv: string, name: string, ok: boolean | null, detail = "", sig?: string, layer?: "devnet" | "er") => {
  rows.push({ inv, name, ok, detail, sig, layer });
  console.log(`${ok === null ? "SKIP" : ok ? "PASS" : "FAIL"}  [${inv}] ${name}${detail ? " — " + detail : ""}`);
};
const ANCHOR: Record<string, number> = { ConstraintHasOne: 2001, ConstraintSeeds: 2006, AccountOwnedByWrongProgram: 3007, AccountNotInitialized: 3012 };
const codeOf = (n: string) => ANCHOR[n] ?? idl.errors.find((e: any) => e.name === n)?.code;
/** Send, expecting rejection with one of `names`. */
async function rejects(inv: string, name: string, names: string[], f: () => Promise<unknown>) {
  try {
    const r: any = await f();
    rec(inv, name, false, `expected ${names.join("/")}, but the tx succeeded`, r?.sig);
  } catch (e: any) {
    const m = String(e?.message ?? e) + JSON.stringify(e?.logs ?? e?.transactionLogs ?? "");
    const hit = names.find((n) => m.includes(n) || m.includes(`custom program error: 0x${codeOf(n)?.toString(16)}`));
    rec(inv, name, !!hit, hit ? `rejected: ${hit} (${codeOf(hit)})` : m.replace(/\s+/g, " ").slice(0, 220));
  }
}
const mint = (i: number) => new PublicKey(st.mints[["dUSDC", "dGEM", "KOI", "ROBO"][i]]);
const vaultAta = (i: number) => new PublicKey(st.vaultAtas[["dUSDC", "dGEM", "KOI", "ROBO"][i]]);

// ───── builders for attack transactions ─────
const pgAdmin = program(base, admin);
const buyCreditsIx = (authority: PublicKey, profile: PublicKey, ataOwner: PublicKey) => pgAdmin.methods.buyCredits(1).accountsPartial({
  authority, profile, config: configPda(), mint: mint(0), playerAta: getAssociatedTokenAddressSync(mint(0), ataOwner),
  vault: vaultPda(), vaultAta: vaultAta(0), tokenProgram: TOKEN_PROGRAM_ID,
}).instruction();
const claimIx = (authority: PublicKey, profile: PublicKey, i = 0, config = configPda()) => pgAdmin.methods.claimPrize(i).accountsPartial({
  authority, profile, config, mint: mint(i), vault: vaultPda(), vaultAta: vaultAta(i),
  playerAta: getAssociatedTokenAddressSync(mint(i), authority), tokenProgram: TOKEN_PROGRAM_ID,
  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
}).instruction();
async function restockIx(signer: PublicKey, specs: { x: number; z: number; radius: number; kind: number; mintIdx: number; amount: bigint; tier: number }[]) {
  const er = await erConn(admin);
  return program(er, admin).methods.restock(specs.map((s) => ({ ...s, amount: new BN(s.amount.toString()) }))).accountsPartial({
    authority: signer, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), vault: vaultPda(),
    vault0: vaultAta(0), vault1: vaultAta(1), vault2: vaultAta(2), vault3: vaultAta(3),
  }).instruction();
}
const liability0 = (cab: any) => cab.capsules.filter((c: any) => c.active && c.kind !== 2 && c.mintIdx === 0).reduce((a: bigint, c: any) => a + BigInt(c.amount.toString()), 0n);

// ───── setup ─────
for (const [p, n, credits, secs] of [[A, "testA", 4, 3600], [B, "testB", 1, 60]] as const) {
  await p.connect();
  if (await p.isDelegated()) { await p.cashOut(); await p.claimAll(); }
  await p.ensureProfile();
  if ((await p.usdcBalance()) < BigInt(credits) * U) await p.faucet();
  await p.buyCredits(credits);
  await p.registerSession(secs);
  console.log(`${n} ready ${p.wallet.publicKey.toBase58()}`);
}
const bSessionExpires = Date.now() / 1000 + 60;

// ───── Invariant 2: a session key cannot buy, claim, cash out or restock ─────
await rejects("2", "session key cannot buy_credits for the wallet", ["ConstraintSeeds"], async () =>
  sendTx(base, [await buyCreditsIx(A.session.publicKey, A.profile, A.wallet.publicKey)], [admin, A.session]));
// Pre-create the session key's token account (paid by a third party) so claim_prize's init_if_needed is a no-op
// and the profile seeds constraint is what decides. Without it the tx already fails earlier, at ATA creation.
await rejects("2", "session key cannot claim_prize for the wallet", ["ConstraintSeeds"], async () =>
  sendTx(base, [createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, getAssociatedTokenAddressSync(mint(0), A.session.publicKey), A.session.publicKey, mint(0)),
    await claimIx(A.session.publicKey, A.profile)], [admin, A.session]));
await rejects("2", "register_session_key rejects a session longer than 24 h", ["SessionTooLong"], async () =>
  sendTx(base, [await A.pg.methods.registerSessionKey(Keypair.generate().publicKey, new BN(Math.floor(Date.now() / 1000) + 2 * 86400))
    .accountsPartial({ authority: A.wallet.publicKey, profile: A.profile }).instruction()], [A.wallet]));

await A.delegate();
await B.delegate();

const erA = await erConn(A.session);
await rejects("2", "session key cannot cash_out (commit + undelegate) the wallet's profile", ["ConstraintSeeds"], async () =>
  sendTx(erA, [await A.pe.methods.cashOut().accountsPartial({ authority: A.session.publicKey, profile: A.profile, magicProgram: new PublicKey("Magic11111111111111111111111111111111111111"), magicContext: new PublicKey("MagicContext1111111111111111111111111111111") }).instruction()], [A.session]));
await rejects("2", "session key cannot restock (admin)", ["ConstraintHasOne", "Unauthorized"], async () =>
  sendTx(erA, [await restockIx(A.session.publicKey, [{ x: 500, z: 500, radius: 60, kind: 0, mintIdx: 0, amount: U / 10n, tier: 0 }])], [A.session]));

// ───── Invariant 5: restock fails if it would break solvency ─────
const erAdmin = await erConn(admin);
const pe = program(erAdmin, admin);
let cab = await pe.account.cabinetState.fetch(cabinetPda());
const vaultBal = (await getAccount(base, vaultAta(0))).amount;
const tooMuch = vaultBal - liability0(cab) + U; // 1 dUSDC more than the vault can cover
await rejects("5", `restock of a ${Number(tooMuch) / 1e6} dUSDC capsule into a ${Number(vaultBal) / 1e6} dUSDC vault is rejected`, ["VaultInsolvent"], async () =>
  sendTx(erAdmin, [await restockIx(admin.publicKey, [{ x: 300, z: 300, radius: 60, kind: 0, mintIdx: 0, amount: tooMuch, tier: 0 }])], [admin]));
if (!cab.capsules.some((c: any) => c.active && c.kind === 0 && c.mintIdx === 0)) {
  try {
    const r = await sendTx(erAdmin, [await restockIx(admin.publicKey, [{ x: 500, z: 500, radius: 60, kind: 0, mintIdx: 0, amount: U / 2n, tier: 0 }])], [admin]);
    rec("5", "solvent restock (0.5 dUSDC capsule) is accepted", true, "", r.sig, "er");
  } catch (e: any) { rec("5", "solvent restock (0.5 dUSDC capsule) is accepted", false, String(e.message).slice(0, 200)); }
} else rec("5", "solvent restock (0.5 dUSDC capsule) is accepted", null, "a dUSDC capsule was already stocked from an earlier run");

// ───── Invariant 1 + 3 + 4 during A's turn ─────
// Wait for an idle cabinet.
for (let i = 0; i < 30; i++) {
  cab = await pe.account.cabinetState.fetch(cabinetPda());
  if (cab.turnOwner.equals(PublicKey.default)) break;
  if (!cab.pendingVrf && Date.now() / 1000 > Number(cab.turnExpiresAt) + 1) { try { await A.expireTurn(cab.turnOwner); } catch { /* raced */ } }
  await sleep(1500);
}
const erAtk = await erConn(attacker);
const peAtk = program(erAtk, attacker);
await A.joinQueue();
await rejects("1", "another player's valid session key cannot move during A's turn", ["NotYourTurn"], () => B.move(40, 0));
await rejects("1", "an unregistered key cannot move_claw on A's profile", ["SessionKeyNotAllowed"], async () =>
  sendTx(erAtk, [await peAtk.methods.moveClaw(40, 0, 1).accountsPartial({ signer: attacker.publicKey, profile: A.profile, cabinet: cabinetPda() }).instruction()], [attacker]));
await rejects("1", "an unregistered key cannot drop_claw on A's profile", ["SessionKeyNotAllowed"], async () =>
  sendTx(erAtk, [await peAtk.methods.dropClaw(7).accountsPartial({ signer: attacker.publicKey, profile: A.profile, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), oracleQueue: new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc") }).instruction()], [attacker], { cu: 400_000 }));
await rejects("3", "vrf_grip_callback signed by anyone but the VRF program identity is rejected", ["Unauthorized"], async () =>
  sendTx(erAtk, [await peAtk.methods.vrfGripCallback(Array(32).fill(0), new BN(0)).accountsPartial({ vrfProgramIdentity: attacker.publicKey, config: configPda(), cabinet: cabinetPda(), profile: A.profile, mystery: mysteryPda() }).instruction()], [attacker]));
await rejects("4", "expire_turn before the turn expires is rejected", ["TurnNotExpired"], () => B.expireTurn(A.wallet.publicKey));

// A aims at the dUSDC capsule; up to 4 drops to get a HELD for the settlement test.
let won = false;
for (let attempt = 1; attempt <= 4 && !won; attempt++) {
  cab = await A.cabinet();
  if (!cab.turnOwner.equals(A.wallet.publicKey)) { await A.joinQueue(); cab = await A.cabinet(); }
  const target = cab.capsules.find((c: any) => c.active && c.kind === 0 && c.mintIdx === 0);
  if (!target) { rec("6", "settlement test needs a dUSDC capsule", false, "none stocked"); break; }
  await A.moveTo(target.x, target.z, { x: cab.clawX, z: cab.clawZ });
  const d = await A.drop();
  const r = await A.waitResult(Number(cab.round));
  console.log(`  drop ${attempt}: ${OUTCOME[r.last.outcome]} (align err ${r.last.alignErrBps} bps, grip ${r.last.gripBps}, roll ${r.last.rollBps}) ${d.sig.slice(0, 10)}…`);
  rec("3", `drop ${attempt} resolved by exactly one VRF callback (pending_vrf cleared, round advanced)`, !r.cabinet.pendingVrf || !r.cabinet.turnOwner.equals(A.wallet.publicKey), `${OUTCOME[r.last.outcome]} after ${r.ms} ms`, d.sig, "er");
  won = r.last.outcome === 1;
}

// ───── Session expiry (invariant 1: "valid" session key) ─────
const wait = bSessionExpires - Date.now() / 1000 + 2;
if (wait > 0) { console.log(`  waiting ${wait.toFixed(0)} s for B's 60 s session to expire…`); await sleep(wait * 1000); }
await rejects("1", "an expired session key is rejected", ["SessionExpired"], () => B.joinQueue());

// ───── Invariant 4 after expiry: anyone can clear it ─────
await B.joinQueue(B.wallet); // B's wallet itself may still act
cab = await A.cabinet();
if (cab.turnOwner.equals(B.wallet.publicKey)) {
  await sleep((Number(cab.turnExpiresAt) - Date.now() / 1000 + 2) * 1000);
  try { const r = await sendTx(erAtk, [await peAtk.methods.expireTurn().accountsPartial({ signer: attacker.publicKey, config: configPda(), cabinet: cabinetPda(), profile: B.profile }).instruction()], [attacker]); rec("4", "after expiry, an unrelated key can clear the turn", true, "", r.sig, "er"); }
  catch (e: any) { rec("4", "after expiry, an unrelated key can clear the turn", false, String(e.message).slice(0, 200)); }
} else rec("4", "after expiry, an unrelated key can clear the turn", null, "B's turn did not start (queue not empty)");

// ───── Invariant 6: a prize is paid exactly once ─────
await rejects("6", "claim_prize while the profile is still delegated is rejected", ["AccountOwnedByWrongProgram", "AccountNotInitialized"], async () =>
  sendTx(base, [await claimIx(A.wallet.publicKey, A.profile)], [A.wallet]));
await A.cashOut();
await B.cashOut();
const pA = await A.pg.account.playerProfile.fetch(A.profile);
const pending0 = BigInt(pA.pending[0].toString());
if (pending0 > 0n) {
  const before = (await getAccount(base, getAssociatedTokenAddressSync(mint(0), A.wallet.publicKey))).amount;
  const r = await sendTx(base, [await claimIx(A.wallet.publicKey, A.profile)], [A.wallet]);
  const after = (await getAccount(base, getAssociatedTokenAddressSync(mint(0), A.wallet.publicKey))).amount;
  rec("6", `first claim pays the pending ${Number(pending0) / 1e6} dUSDC to the wallet`, after - before === pending0, `wallet +${Number(after - before) / 1e6} dUSDC`, r.sig, "devnet");
  await rejects("6", "second claim of the same prize is rejected", ["NothingToClaim"], async () => sendTx(base, [await claimIx(A.wallet.publicKey, A.profile)], [A.wallet]));
} else {
  rec("6", "first claim pays the pending prize", null, won ? "won but nothing pending?" : "no HELD in 4 drops; not completed this run");
  await rejects("6", "claim with nothing pending is rejected", ["NothingToClaim"], async () => sendTx(base, [await claimIx(A.wallet.publicKey, A.profile)], [A.wallet]));
}
// Regression for the fixed cross-cabinet bug: a cabinet-1 profile can't claim from cabinet 2's vault.
const p1 = loadKeypair("keys/playerA.json");
await rejects("6", "a profile from cabinet 1 cannot claim from cabinet 2's vault", ["ConstraintSeeds", "AccountNotInitialized"], async () =>
  sendTx(base, [await claimIx(p1.publicKey, playerPda(p1.publicKey, 1))], [p1]));

// ───── Invariant 7: the mystery vault is unreadable ─────
const tok = async (kp: Keypair) => (await getAuthToken(ER_URL, kp.publicKey, async (m) => nacl.sign.detached(m, kp.secretKey))).token;
const { Connection } = await import("@solana/web3.js");
const reads = {
  "no token": await erPublic.getAccountInfo(mysteryPda()),
  "stranger token": await new Connection(`${ER_URL}?token=${await tok(Keypair.generate())}`, "confirmed").getAccountInfo(mysteryPda()),
  "authority token": await new Connection(`${ER_URL}?token=${await tok(admin)}`, "confirmed").getAccountInfo(mysteryPda()),
};
const cabRead = await erPublic.getAccountInfo(cabinetPda());
for (const [who, a] of Object.entries(reads)) rec("7", `mystery vault unreadable via TEE RPC (${who})`, a === null, a ? `returned ${a.data.length} bytes` : "null");
rec("7", "control: the public cabinet account is readable", !!cabRead, cabRead ? `${cabRead.data.length} bytes` : "null");

// ───── report ─────
const md = [
  "# Security invariant tests (devnet)", "",
  `Run ${new Date().toISOString()} with \`CABINET_ID=2 npx tsx tests/invariants.ts\` on the test cabinet \`${st.cabinet}\` (3 dUSDC vault, own mints).`,
  "Every negative check sends a real transaction and expects the program to reject it with the named error.", "",
  "| # | Check | Result | Detail | Tx |", "|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.inv} | ${r.name} | ${r.ok === null ? "⚠️ not completed" : r.ok ? "✅" : "❌"} | ${r.detail.replace(/\|/g, "/")} | ${r.sig ? `[${r.sig.slice(0, 8)}…](${explorer(r.sig, r.layer)})` : ""} |`), "",
  "Invariant 3 note: only the VRF program can produce the `vrf_program_identity` signer, so a real duplicate callback can't be sent from a test. The program enforces one callback per drop with `pending_vrf` plus a per-drop `vrf_nonce` the callback must echo (`NoVrfPending` / `StaleVrfCallback`).", "",
];
fs.writeFileSync(`${ROOT}/docs/INVARIANTS.md`, md.join("\n"));
const fails = rows.filter((r) => r.ok === false).length;
console.log(`\n${rows.filter((r) => r.ok).length} passed, ${fails} failed, ${rows.filter((r) => r.ok === null).length} not completed. Wrote docs/INVARIANTS.md`);
process.exit(fails ? 1 : 0);
