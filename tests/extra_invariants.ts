// Gaps not covered by tests/invariants.ts, tested with real devnet + MagicBlock TEE transactions on the
// test cabinet (cabinet 2). Every check sends a transaction that must be rejected; nothing changes state.
//   CABINET_ID=2 npx tsx tests/extra_invariants.ts
//  - restock rejects a capsule above max_payout_per_round (PayoutTooLarge), per mint
//  - solvency is checked over the whole restock batch: two capsules, each under the payout cap, that together exceed the vault
//  - a key that is not the cabinet authority cannot call set_keeper (L1) or admin_undelegate (ER)
//  - drop_claw / drop_claw_public reject any VRF oracle queue except DEFAULT_EPHEMERAL_QUEUE (InvalidParams, SECURITY.md F-01)
//  - read-only: the Solana L1 copy of each cabinet's mystery vault PDA holds no prize entry
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { CABINET_ID, idl, base, erConn, program, sendTx, loadKeypair, loadState, configPda, cabinetPda, mysteryPda, vaultPda } from "../scripts/lib/common.ts";
import { keeperRolePda } from "../scripts/lib/admin.ts";
import { Player } from "../scripts/lib/client.ts";

if (CABINET_ID !== 2) throw new Error("Run against the test cabinet: CABINET_ID=2");
const BN = anchor.BN;
const st = loadState();
const admin = loadKeypair("~/.config/solana/id.json");
const attacker = Keypair.generate(); // never registered anywhere, holds no SOL
const MINTS = ["dUSDC", "dGEM", "KOI", "ROBO"];
const vaultAta = (i: number) => new PublicKey(st.vaultAtas[MINTS[i]]);

let pass = 0, fail = 0;
const ANCHOR: Record<string, number> = { ConstraintHasOne: 2001, ConstraintSeeds: 2006 };
const codeOf = (n: string) => ANCHOR[n] ?? idl.errors.find((e: any) => e.name === n)?.code;
async function rejects(name: string, names: string[], f: () => Promise<unknown>) {
  try {
    const r: any = await f();
    fail++; console.log(`FAIL  ${name} — expected ${names.join("/")}, but tx ${r?.sig} succeeded`);
  } catch (e: any) {
    const m = String(e?.message ?? e) + JSON.stringify(e?.logs ?? e?.transactionLogs ?? "");
    const hit = names.find((n) => m.includes(n) || m.includes(`custom program error: 0x${codeOf(n)?.toString(16)}`));
    if (hit) pass++; else fail++;
    console.log(`${hit ? "PASS" : "FAIL"}  ${name} — ${hit ? `rejected: ${hit} (${codeOf(hit)})` : m.replace(/\s+/g, " ").slice(0, 220)}`);
  }
}

const cfg: any = await program(base, admin).account.cabinetConfig.fetch(configPda());
const erAdmin = await erConn(admin);
const pe = program(erAdmin, admin);
const restockIx = (signer: PublicKey, mintIdx: number, amount: bigint, kind = 0) => pe.methods
  .restock([{ x: 400, z: 400, radius: 60, kind, mintIdx, amount: new BN(amount.toString()), tier: 0 }])
  .accountsPartial({
    authority: signer, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), vault: vaultPda(),
    vault0: vaultAta(0), vault1: vaultAta(1), vault2: vaultAta(2), vault3: vaultAta(3),
  }).instruction();

// ───── payout cap: amount = max_payout_per_round + 1 is rejected for each mint, as a token and as a mystery prize ─────
// PayoutTooLarge is checked per spec before the solvency check, so it is the error even if the vault is also short.
for (let m = 0; m < 4; m++) {
  const cap = BigInt(cfg.maxPayoutPerRound[m].toString());
  for (const kind of [0, 2]) {
    await rejects(`restock ${kind === 2 ? "mystery" : "token"} capsule of ${MINTS[m]} at cap+1 (${cap + 1n} base units, cap ${cap}) is rejected`,
      ["PayoutTooLarge"], async () => sendTx(erAdmin, [await restockIx(admin.publicKey, m, cap + 1n, kind)], [admin]));
  }
}

// ───── solvency over the batch (each capsule under the cap, together more than the vault can cover) ─────
{
  const { getAccount } = await import("@solana/spl-token");
  const cab: any = await pe.account.cabinetState.fetch(cabinetPda());
  const live = cab.capsules.filter((c: any) => c.active && c.kind !== 2 && c.mintIdx === 0).reduce((a: bigint, c: any) => a + BigInt(c.amount.toString()), 0n);
  const vault = (await getAccount(base, vaultAta(0))).amount;
  const cap = BigInt(cfg.maxPayoutPerRound[0].toString());
  // Solvency also counts total_won - total_claimed and live mystery prizes, so `room` is an upper bound on what fits.
  const room = vault + BigInt(cfg.totalClaimed[0].toString()) - BigInt(cab.totalWon[0].toString()) - live;
  const each = room / 2n + 1n;
  if (each > cap) { fail++; console.log(`FAIL  batch solvency: vault room ${room} needs capsules above the cap ${cap}; cannot test`); }
  else await rejects(`restock of two ${Number(each) / 1e6} dUSDC capsules (each under the ${Number(cap) / 1e6} cap) into ${Number(room) / 1e6} dUSDC of free vault is rejected`,
    ["VaultInsolvent"], async () => sendTx(erAdmin, [await pe.methods.restock([0, 1].map((k) => ({ x: 300 + 200 * k, z: 700, radius: 60, kind: 0, mintIdx: 0, amount: new BN(each.toString()), tier: 0 })))
      .accountsPartial({ authority: admin.publicKey, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), vault: vaultPda(),
        vault0: vaultAta(0), vault1: vaultAta(1), vault2: vaultAta(2), vault3: vaultAta(3) }).instruction()], [admin]));
}

// ───── admin-only instructions reject any other key ─────
await rejects("a non-authority key cannot set_keeper (L1)", ["ConstraintHasOne"], async () =>
  sendTx(base, [await program(base, admin).methods.setKeeper(attacker.publicKey).accountsPartial({
    authority: attacker.publicKey, config: configPda(), keeperRole: keeperRolePda(), systemProgram: SystemProgram.programId,
  }).instruction()], [admin, attacker]));
const erAtk = await erConn(attacker);
await rejects("a non-authority key cannot admin_undelegate the cabinet (ER)", ["ConstraintHasOne"], async () =>
  sendTx(erAtk, [await program(erAtk, attacker).methods.adminUndelegate().accountsPartial({
    authority: attacker.publicKey, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(),
  }).instruction()], [attacker]));

// ───── VRF oracle queue is pinned to the ER queue (program upgrade 2vHp9HK6…, SECURITY.md F-01) ─────
// The queue constraint is an account constraint, so it fails before the handler runs. The control uses the right queue
// with the same stranger signer and must fail later, in the handler (SessionKeyNotAllowed), proving the queue check passed.
const QUEUES: Record<string, string> = {
  DEFAULT_QUEUE: "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
  DEFAULT_TEST_QUEUE: "GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb",
  DEFAULT_EPHEMERAL_TEST_QUEUE: "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT",
  DEFAULT_EPHEMERAL_QUEUE: "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
};
const victim = new Player(loadKeypair("keys/testA.json"), st);
await victim.connect();
await victim.ensureProfile();
if (!(await victim.isDelegated())) await victim.delegate(); // the profile must live on the ER for the drop to load it
const peAtk2 = program(erAtk, attacker);
for (const [qn, q] of Object.entries(QUEUES)) {
  const ctl = qn === "DEFAULT_EPHEMERAL_QUEUE";
  for (const pub of [true, false]) {
    const ixName = pub ? "drop_claw_public" : "drop_claw";
    await rejects(ctl ? `control: ${ixName} with ${qn} passes the queue check (fails later in the handler)` : `${ixName} with oracle queue ${qn} is rejected`,
      [ctl ? "SessionKeyNotAllowed" : "InvalidParams"], async () => {
        const accts: any = { signer: attacker.publicKey, profile: victim.profile, config: configPda(), cabinet: cabinetPda(), oracleQueue: new PublicKey(q) };
        if (!pub) accts.mystery = mysteryPda();
        const ix = await (pub ? peAtk2.methods.dropClawPublic(7) : peAtk2.methods.dropClaw(7)).accountsPartial(accts).instruction();
        return sendTx(erAtk, [ix], [attacker], { cu: 400_000 });
      });
  }
}
try { await victim.cashOut(); } catch (e: any) { console.log(`  cleanup testA cash_out: ${String(e.message).slice(0, 120)}`); }

// ───── L1 copy of the mystery vault (read-only): the plaintext lives only inside the TEE ER ─────
// The vault is delegated empty and then sealed on the ER (scripts/setup_devnet.ts), so the L1 snapshot reads sealed=false;
// restocks write entries on the ER, and the vault is only committed back to L1 on admin_undelegate.
for (const id of [1, 2]) {
  const a = await base.getAccountInfo(mysteryPda(id));
  if (!a) { fail++; console.log(`FAIL  cabinet ${id} mystery PDA not found on L1`); continue; }
  const v: any = program(base, admin).coder.accounts.decode("mysteryVault", a.data);
  const set = v.entries.filter((e: any) => e.set || e.amount.toString() !== "0").length;
  const ok = set === 0;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  public L1 RPC read of cabinet ${id} mystery vault shows no prize entry — owner ${a.owner.toBase58().slice(0, 8)}…, sealed=${v.sealed}, ${set}/${v.entries.length} entries set`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
