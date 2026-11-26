// Reproducible devnet setup: demo mints, cabinet, vault funding, delegation to the TEE ER,
// sealing the mystery vault, first restock, and two funded test players.
// Idempotent: re-running skips finished steps (state in scripts/state.devnet.<id>.json).
//
//   npx tsx scripts/setup_devnet.ts
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType, getMint,
} from "@solana/spl-token";
import {
  base, program, erConn, sendTx, loadKeypair, loadOrCreateKeypair, loadState, saveState, sleep,
  configPda, cabinetPda, mysteryPda, vaultPda, faucetPda, permissionPda, CABINET_ID, ER_VALIDATOR,
  PERMISSION_PROGRAM, EPHEMERAL_VAULT, MAGIC_PROGRAM, DELEGATION_PROGRAM, explorer,
} from "./lib/common.ts";
import { restockFree } from "./lib/admin.ts";

const authority = loadKeypair(process.env.AUTHORITY ?? "~/.config/solana/id.json");
const BN = anchor.BN;

async function main() {
  const st = loadState();
  st.cabinetId = CABINET_ID;
  st.programId = (program(base, authority).programId as PublicKey).toBase58();
  st.validator = ER_VALIDATOR.toBase58();
  const pg = program(base, authority);
  const log = (k: string, v: string) => { console.log(k.padEnd(18), v); };

  // 1. Demo mints (devnet only, clearly labelled demo assets).
  // SMALL_VAULT=1 (used by the invariant tests on cabinet 2): 3 dUSDC of inventory, nothing else, no auto-restock.
  const small = process.env.SMALL_VAULT === "1";
  const MINTS = [
    { key: "dUSDC", decimals: 6, vault: small ? 3_000_000n : 300_000_000n },
    { key: "dGEM", decimals: 6, vault: small ? 0n : 50_000_000_000n },
    { key: "KOI", decimals: 0, vault: small ? 0n : 25n },
    { key: "ROBO", decimals: 0, vault: small ? 0n : 25n },
  ];
  st.mints ??= {};
  for (const m of MINTS) {
    if (!st.mints[m.key]) {
      const kp = Keypair.generate();
      await createMint(base, authority, authority.publicKey, null, m.decimals, kp, { commitment: "confirmed" });
      st.mints[m.key] = kp.publicKey.toBase58();
      saveState(st);
    }
    log(`mint ${m.key}`, st.mints[m.key]);
  }
  const mintKeys = MINTS.map((m) => new PublicKey(st.mints[m.key]));

  // 2. Cabinet.
  const config = configPda(), cabinet = cabinetPda(), mystery = mysteryPda(), vault = vaultPda();
  if (!(await base.getAccountInfo(config))) {
    const sig = await pg.methods
      .initCabinet(CABINET_ID, {
        validator: ER_VALIDATOR,
        playPrice: new BN(1_000_000),
        turnSecs: 15,
        gripMaxBps: 8500,
        gripMinBps: 2500,
        maxPayoutPerRound: [new BN(25_000_000), new BN(2_000_000_000), new BN(2), new BN(2)],
        restockThreshold: 6,
        mints: mintKeys,
      })
      .accountsPartial({ authority: authority.publicKey, config, cabinet, mystery, vault, systemProgram: SystemProgram.programId })
      .rpc();
    st.initCabinetSig = sig;
    saveState(st);
  }
  Object.assign(st, { config: config.toBase58(), cabinet: cabinet.toBase58(), mystery: mystery.toBase58(), vault: vault.toBase58() });
  log("config", st.config); log("cabinet", st.cabinet); log("mystery", st.mystery); log("vault", st.vault);

  // 3. Vault token accounts + prize inventory.
  st.vaultAtas ??= {};
  for (let i = 0; i < MINTS.length; i++) {
    const ata = await getOrCreateAssociatedTokenAccount(base, authority, mintKeys[i], vault, true, "confirmed");
    st.vaultAtas[MINTS[i].key] = ata.address.toBase58();
    if (ata.amount < MINTS[i].vault && MINTS[i].vault > 0n) {
      const mintInfo = await getMint(base, mintKeys[i]);
      if (mintInfo.mintAuthority?.equals(authority.publicKey)) {
        await mintTo(base, authority, mintKeys[i], ata.address, authority, MINTS[i].vault - ata.amount, [], { commitment: "confirmed" });
      }
    }
    saveState(st);
  }
  log("vault ATAs", JSON.stringify(st.vaultAtas));

  // 4. Hand demo-USDC mint authority to the program faucet PDA (so anyone can get play money).
  const faucet = faucetPda();
  const usdc = await getMint(base, mintKeys[0]);
  if (usdc.mintAuthority?.equals(authority.publicKey)) {
    await setAuthority(base, authority, mintKeys[0], authority, AuthorityType.MintTokens, faucet, [], { commitment: "confirmed" });
  }
  st.faucet = faucet.toBase58();

  // 5. Delegate cabinet + mystery vault to the TEE ER.
  const cabInfo = await base.getAccountInfo(cabinet);
  if (cabInfo && cabInfo.owner.equals(pg.programId)) {
    const sig = await pg.methods.delegateCabinet().accountsPartial({ authority: authority.publicKey, config, cabinet, mystery }).rpc();
    st.delegateCabinetSig = sig;
    saveState(st);
    log("delegate tx", explorer(sig));
    await sleep(5000);
  } else log("delegate", "already delegated (owner " + cabInfo?.owner.toBase58() + ")");

  // 6. Seal the mystery vault (private EphemeralPermission, no members) on the ER.
  const er = await erConn(authority);
  const pe = program(er, authority);
  const perm = permissionPda(mystery);
  st.mysteryPermission = perm.toBase58();
  for (let i = 0; i < 10; i++) {
    const m = await er.getAccountInfo(mystery);
    if (m) break;
    await sleep(2000);
  }
  if (!st.sealSig) {
    const ix = await pe.methods.sealMystery().accountsPartial({
      authority: authority.publicKey, config, mystery, permission: perm,
      permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT, magicProgram: MAGIC_PROGRAM,
    }).instruction();
    const r = await sendTx(er, [ix], [authority]);
    st.sealSig = r.sig;
    saveState(st);
    log("seal mystery", r.sig);
  }

  // 7. First restock (mystery contents drawn at random, never written to disk).
  const rs = small ? null : await restockFree(authority, st, 6);
  if (rs) { st.firstRestockSig ??= rs.sig; saveState(st); log("restock", `${rs.added} capsules ${rs.sig}`); }
  else log("restock", "skipped, cabinet stocked");

  // 8. Test players (keys stay in ./keys, never committed). Funded from the authority.
  st.players ??= {};
  for (const name of (process.env.PLAYER_NAMES ?? "playerA,playerB").split(",")) {
    const kp = loadOrCreateKeypair(`keys/${name}.json`);
    st.players[name] = kp.publicKey.toBase58();
    const bal = await base.getBalance(kp.publicKey);
    if (bal < 0.3 * LAMPORTS_PER_SOL) {
      await sendTx(base, [SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: kp.publicKey, lamports: 0.5 * LAMPORTS_PER_SOL })], [authority]);
    }
    log(name, `${kp.publicKey.toBase58()} ${(await base.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL} SOL`);
  }
  saveState(st);
  console.log("\nstate written:", JSON.stringify({ cabinet: st.cabinet, mints: st.mints }, null, 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
