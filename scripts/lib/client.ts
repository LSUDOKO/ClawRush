// Game client used by the round runner, the two-player e2e script and the negative tests.
// Every call here is a real devnet / MagicBlock ER transaction.
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  base, program, erConn, sendTx, sleep, configPda, cabinetPda, mysteryPda, vaultPda, playerPda, faucetPda,
  VRF_EPHEMERAL_QUEUE, MAGIC_PROGRAM, MAGIC_CONTEXT, PROGRAM_ID,
} from "./common.ts";

const BN = anchor.BN;
export const MINT_KEYS = ["dUSDC", "dGEM", "KOI", "ROBO"] as const;
export const OUTCOME = ["NONE", "HELD", "SLIP", "MISS"] as const;

export class Player {
  wallet: Keypair;
  session: Keypair;
  st: any;
  er!: Connection;
  erS!: Connection;
  profile: PublicKey;
  seq = 1;
  log: { step: string; sig: string; layer: "devnet" | "er"; ms: number }[] = [];
  constructor(wallet: Keypair, st: any, session = Keypair.generate()) {
    this.wallet = wallet;
    this.session = session;
    this.st = st;
    this.profile = playerPda(wallet.publicKey);
  }
  get pg() { return program(base, this.wallet); }
  get pe() { return program(this.er, this.wallet); }
  mint(i: number) { return new PublicKey(this.st.mints[MINT_KEYS[i]]); }
  vaultAta(i: number) { return new PublicKey(this.st.vaultAtas[MINT_KEYS[i]]); }
  async connect() {
    this.er = await erConn(this.wallet);
    this.erS = await erConn(this.session);
  }
  private rec(step: string, r: { sig: string; ms: number }, layer: "devnet" | "er") {
    this.log.push({ step, sig: r.sig, layer, ms: r.ms });
    return r;
  }

  // ───── L1 ─────
  async ensureProfile() {
    if (await base.getAccountInfo(this.profile)) return;
    const ix = await this.pg.methods.initPlayer().accountsPartial({ authority: this.wallet.publicKey, config: configPda(), profile: this.profile, systemProgram: SystemProgram.programId }).instruction();
    this.rec("init_player", await sendTx(base, [ix], [this.wallet]), "devnet");
  }
  async usdcBalance() {
    try { return (await getAccount(base, getAssociatedTokenAddressSync(this.mint(0), this.wallet.publicKey))).amount; } catch { return 0n; }
  }
  async faucet() {
    const ix = await this.pg.methods.faucet().accountsPartial({
      authority: this.wallet.publicKey, profile: this.profile, config: configPda(), mint: this.mint(0), faucetAuthority: faucetPda(),
      playerAta: getAssociatedTokenAddressSync(this.mint(0), this.wallet.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction();
    return this.rec("faucet", await sendTx(base, [ix], [this.wallet]), "devnet");
  }
  async buyCredits(n: number) {
    const ix = await this.pg.methods.buyCredits(n).accountsPartial({
      authority: this.wallet.publicKey, profile: this.profile, config: configPda(), mint: this.mint(0),
      playerAta: getAssociatedTokenAddressSync(this.mint(0), this.wallet.publicKey), vault: vaultPda(), vaultAta: this.vaultAta(0),
      tokenProgram: TOKEN_PROGRAM_ID,
    }).instruction();
    return this.rec("buy_credits", await sendTx(base, [ix], [this.wallet]), "devnet");
  }
  async registerSession(secs = 3600) {
    const expires = Math.floor(Date.now() / 1000) + secs;
    const ix = await this.pg.methods.registerSessionKey(this.session.publicKey, new BN(expires))
      .accountsPartial({ authority: this.wallet.publicKey, profile: this.profile }).instruction();
    return this.rec("register_session_key", await sendTx(base, [ix], [this.wallet]), "devnet");
  }
  async isDelegated() {
    const a = await base.getAccountInfo(this.profile);
    return !!a && !a.owner.equals(PROGRAM_ID);
  }
  async delegate() {
    const ix = await this.pg.methods.delegatePlayer().accountsPartial({ authority: this.wallet.publicKey, config: configPda(), profile: this.profile }).instruction();
    const r = this.rec("delegate_player", await sendTx(base, [ix], [this.wallet]), "devnet");
    for (let i = 0; i < 30; i++) { if (await this.er.getAccountInfo(this.profile)) break; await sleep(1000); }
    return r;
  }
  async claimAll() {
    const p = await this.pg.account.playerProfile.fetch(this.profile);
    const out: any[] = [];
    for (let i = 0; i < 4; i++) {
      if (p.pending[i].isZero()) continue;
      const ix = await this.pg.methods.claimPrize(i).accountsPartial({
        authority: this.wallet.publicKey, profile: this.profile, config: configPda(), mint: this.mint(i), vault: vaultPda(),
        vaultAta: this.vaultAta(i), playerAta: getAssociatedTokenAddressSync(this.mint(i), this.wallet.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).instruction();
      const r = this.rec(`claim_prize ${MINT_KEYS[i]}`, await sendTx(base, [ix], [this.wallet]), "devnet");
      out.push({ mint: MINT_KEYS[i], amount: p.pending[i].toString(), sig: r.sig });
    }
    return out;
  }

  // ───── ER ─────
  async profileEr() { return this.pe.account.playerProfile.fetch(this.profile); }
  async cabinet() { return this.pe.account.cabinetState.fetch(cabinetPda()); }
  async joinQueue(signer: Keypair = this.session) {
    const ix = await this.pe.methods.joinQueue().accountsPartial({ signer: signer.publicKey, profile: this.profile, config: configPda(), cabinet: cabinetPda() }).instruction();
    return this.rec("join_queue", await sendTx(signer === this.session ? this.erS : this.er, [ix], [signer]), "er");
  }
  async move(dx: number, dz: number, signer: Keypair = this.session) {
    const ix = await this.pe.methods.moveClaw(dx, dz, this.seq++).accountsPartial({ signer: signer.publicKey, profile: this.profile, cabinet: cabinetPda() }).instruction();
    return this.rec("move_claw", await sendTx(signer === this.session ? this.erS : this.er, [ix], [signer]), "er");
  }
  /** Move the claw to (tx, tz) in MAX_STEP chunks. Moves are sent back to back. */
  async moveTo(tx: number, tz: number, from: { x: number; z: number }) {
    let { x, z } = from;
    const sends: Promise<any>[] = [];
    while (x !== tx || z !== tz) {
      const dx = Math.max(-80, Math.min(80, tx - x));
      const dz = Math.max(-80, Math.min(80, tz - z));
      x += dx; z += dz;
      const m = this.move(dx, dz);
      m.catch(() => {}); // handled by Promise.all below; avoids an unhandled rejection while later moves are still being sent
      sends.push(m);
      await sleep(60);
    }
    await Promise.all(sends);
    return sends.length;
  }
  async drop(seed = Math.floor(Math.random() * 256), signer: Keypair = this.session) {
    const ix = await this.pe.methods.dropClaw(seed).accountsPartial({
      signer: signer.publicKey, profile: this.profile, config: configPda(), cabinet: cabinetPda(), mystery: mysteryPda(), oracleQueue: VRF_EPHEMERAL_QUEUE,
    }).instruction();
    return this.rec("drop_claw", await sendTx(signer === this.session ? this.erS : this.er, [ix], [signer], { cu: 400_000 }), "er");
  }
  /** drop_claw_public: the private mystery vault is derived on chain, not listed, so this transaction stays readable. */
  async dropPublic(seed = Math.floor(Math.random() * 256), signer: Keypair = this.session) {
    const ix = await this.pe.methods.dropClawPublic(seed).accountsPartial({
      signer: signer.publicKey, profile: this.profile, config: configPda(), cabinet: cabinetPda(), oracleQueue: VRF_EPHEMERAL_QUEUE,
    }).instruction();
    return this.rec("drop_claw_public", await sendTx(signer === this.session ? this.erS : this.er, [ix], [signer], { cu: 400_000 }), "er");
  }
  /** Wait for the VRF callback to resolve this player's round. Returns cabinet.last and the callback latency. */
  async waitResult(round: number, timeoutMs = 40_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const c = await this.cabinet();
      if (Number(c.last.round) === round && c.last.player.equals(this.wallet.publicKey) && (!c.pendingVrf || !c.turnOwner.equals(this.wallet.publicKey))) {
        return { last: c.last, ms: Date.now() - t0, cabinet: c };
      }
      await sleep(300);
    }
    throw new Error(`VRF callback not seen for round ${round} within ${timeoutMs}ms`);
  }
  async expireTurn(owner: PublicKey, signer: Keypair = this.session) {
    const ix = await this.pe.methods.expireTurn().accountsPartial({ signer: signer.publicKey, config: configPda(), cabinet: cabinetPda(), profile: playerPda(owner) }).instruction();
    return this.rec("expire_turn", await sendTx(signer === this.session ? this.erS : this.er, [ix], [signer]), "er");
  }
  // One ER transaction: commit + undelegate, plus a Magic Action that pays pending prizes on L1.
  // Trusts the cabinet's queue instead of the profile flag, so it works after the crank cleared a turn.
  async cashOutAndSettle() {
    const ix = await this.pe.methods.cashOutAndSettle().accountsPartial({
      authority: this.wallet.publicKey, profile: this.profile, config: configPda(), cabinet: cabinetPda(), vault: vaultPda(),
      program: PROGRAM_ID, magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT,
    }).instruction();
    const r = this.rec("cash_out_and_settle", await sendTx(this.er, [ix], [this.wallet]), "er");
    for (let i = 0; i < 60; i++) {
      const a = await base.getAccountInfo(this.profile);
      if (a && a.owner.equals(PROGRAM_ID)) break;
      await sleep(1000);
    }
    return { erSig: r.sig };
  }
  async cashOut() {
    const ix = await this.pe.methods.cashOut().accountsPartial({ authority: this.wallet.publicKey, profile: this.profile, magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT }).instruction();
    const r = this.rec("cash_out", await sendTx(this.er, [ix], [this.wallet]), "er");
    let baseSig = "";
    try { baseSig = await GetCommitmentSignature(r.sig, this.er as any); this.log.push({ step: "cash_out commit (L1)", sig: baseSig, layer: "devnet", ms: 0 }); } catch (e) { /* recorded below by owner poll */ }
    for (let i = 0; i < 60; i++) {
      const a = await base.getAccountInfo(this.profile);
      if (a && a.owner.equals(PROGRAM_ID)) break;
      await sleep(1000);
    }
    return { erSig: r.sig, baseSig };
  }
}

export async function fund(from: Keypair, to: PublicKey, sol: number) {
  return sendTx(base, [SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) })], [from]);
}
