// All on-chain plumbing for the app: connections, PDAs, instruction builders, TEE auth, sending.
// Every action here is a real devnet / MagicBlock TEE ER transaction.
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import idlJson from "./idl.json";
import dev from "./devnet.json";

export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://api.devnet.solana.com";
export const ER_URL = process.env.NEXT_PUBLIC_ER_URL ?? "https://devnet-tee.magicblock.app";
export const DEV = dev;
export const PROGRAM_ID = new PublicKey(dev.programId);
export const CABINET_ID = dev.cabinetId as number;
export const MINT_KEYS = ["dUSDC", "dGEM", "KOI", "ROBO"] as const;
export const MINT_DECIMALS = [6, 6, 0, 0];
export const MINTS = MINT_KEYS.map((k) => new PublicKey((dev.mints as Record<string, string>)[k]));
export const VAULT_ATAS = MINT_KEYS.map((k) => new PublicKey((dev.vaultAtas as Record<string, string>)[k]));
export const PLAY_PRICE = 1_000_000n;
const VRF_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");

export const base = new Connection(BASE_URL, "confirmed");
/** Unauthenticated TEE connection: public cabinet reads + websocket. */
export const erPublic = new Connection(ER_URL, { commitment: "confirmed", wsEndpoint: ER_URL.replace("https", "wss") });

const s = (x: string) => Buffer.from(x);
const pda = (seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configPda = pda([s("config"), Buffer.from([CABINET_ID])]);
export const cabinetPda = pda([s("cabinet"), Buffer.from([CABINET_ID])]);
export const mysteryPda = pda([s("mystery"), Buffer.from([CABINET_ID])]);
export const vaultPda = pda([s("vault"), Buffer.from([CABINET_ID])]);
export const faucetPda = pda([s("faucet")]);
export const playerPda = (w: PublicKey) => pda([s("player"), Buffer.from([CABINET_ID]), w.toBuffer()]);

// Read-only program handle for building instructions and decoding accounts (never signs).
const dummy = { publicKey: PublicKey.default, signTransaction: async <T,>(t: T) => t, signAllTransactions: async <T,>(t: T[]) => t };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const program = new Program(idlJson as any, new AnchorProvider(base, dummy, { commitment: "confirmed" }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M = program.methods as any;

/** Anything that can sign: a browser wallet (adapter) or a local keypair (burner / session key). */
export interface AppSigner {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>;
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
}
export function keypairSigner(kp: Keypair): AppSigner {
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx) => { tx.partialSign(kp); return tx; },
    signAllTransactions: async (txs) => { txs.forEach((t) => t.partialSign(kp)); return txs; },
    signMessage: async (m) => nacl.sign.detached(m, kp.secretKey),
  };
}

// ───── TEE auth: one token per signer, cached for the tab ─────
const erConns = new Map<string, Connection>();
export async function erFor(signer: AppSigner): Promise<Connection> {
  const k = signer.publicKey.toBase58();
  const hit = erConns.get(k);
  if (hit) return hit;
  const { token } = await getAuthToken(ER_URL, signer.publicKey, (m: Uint8Array) => signer.signMessage(m));
  const url = `${ER_URL}?token=${token}`;
  const c = new Connection(url, { commitment: "confirmed", wsEndpoint: url.replace("https", "wss") });
  erConns.set(k, c);
  return c;
}

export type Sent = { sig: string; ms: number };
async function build(conn: Connection, ixs: TransactionInstruction[], payer: PublicKey, cu?: number) {
  const tx = new Transaction();
  if (cu) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }));
  tx.add(...ixs);
  tx.feePayer = payer;
  const bh = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = bh.blockhash;
  return { tx, bh };
}
async function sendAndConfirm(conn: Connection, tx: Transaction, bh: { blockhash: string; lastValidBlockHeight: number }, t0: number): Promise<Sent> {
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  const r = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (r.value.err) throw new Error(`Transaction failed: ${JSON.stringify(r.value.err)}`);
  return { sig, ms: Date.now() - t0 };
}
export async function send(conn: Connection, ixs: TransactionInstruction[], signer: AppSigner, cu?: number): Promise<Sent> {
  const { tx, bh } = await build(conn, ixs, signer.publicKey, cu);
  const t0 = Date.now();
  // Use the returned transaction: wallets like Solflare return a signed copy instead of signing in place.
  const signed = await signer.signTransaction(tx);
  return sendAndConfirm(conn, signed, bh, t0);
}
/** Several L1 transactions, one wallet approval, sent in order. */
export async function sendBatch(conn: Connection, groups: TransactionInstruction[][], signer: AppSigner): Promise<Sent[]> {
  const built = await Promise.all(groups.map((g) => build(conn, g, signer.publicKey)));
  const signed = await signer.signAllTransactions(built.map((b) => b.tx));
  const out: Sent[] = [];
  for (let i = 0; i < built.length; i++) out.push(await sendAndConfirm(conn, signed[i], built[i].bh, Date.now()));
  return out;
}

// ───── Decoding ─────
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Capsule = { id: number; x: number; z: number; radius: number; active: boolean; kind: number; mintIdx: number; amount: bigint; slipCount: number };
export type Cabinet = {
  clawX: number; clawZ: number; capsules: Capsule[]; turnOwner: string; turnStartedAt: number; turnExpiresAt: number; round: number;
  pendingVrf: boolean; dropAt: number; queue: string[]; plays: number; wins: number; slips: number; misses: number;
  last: { round: number; player: string; capsuleId: number; kind: number; alignErrBps: number; gripBps: number; rollBps: number; outcome: number; mintIdx: number; amount: bigint; tier: number; ts: number; clawX: number; clawZ: number };
  recentWins: { player: string; mintIdx: number; amount: bigint; kind: number; ts: number }[];
};
const big = (b: any) => BigInt(b.toString());
export function decodeCabinet(data: Buffer): Cabinet {
  const c: any = program.coder.accounts.decode("cabinetState", data);
  const q: string[] = [];
  for (let i = 0; i < c.qLen; i++) q.push(c.queue[(c.qHead + i) % c.queue.length].toBase58());
  return {
    clawX: c.clawX, clawZ: c.clawZ, round: Number(c.round), pendingVrf: c.pendingVrf, dropAt: Number(c.dropAt),
    capsules: c.capsules.map((k: any) => ({ ...k, amount: big(k.amount) })),
    turnOwner: c.turnOwner.toBase58(), turnStartedAt: Number(c.turnStartedAt), turnExpiresAt: Number(c.turnExpiresAt), queue: q,
    plays: Number(c.plays), wins: Number(c.wins), slips: Number(c.slips), misses: Number(c.misses),
    last: { ...c.last, round: Number(c.last.round), player: c.last.player.toBase58(), amount: big(c.last.amount), ts: Number(c.last.ts) },
    recentWins: c.recentWins.filter((w: any) => Number(w.ts) > 0).map((w: any) => ({ ...w, player: w.player.toBase58(), amount: big(w.amount), ts: Number(w.ts) })).sort((a: any, b: any) => b.ts - a.ts),
  };
}
export type Profile = { credits: number; plays: number; wins: number; sessionKey: string; sessionExpiresAt: number; inQueue: boolean; pending: bigint[] };
export function decodeProfile(data: Buffer): Profile {
  const p: any = program.coder.accounts.decode("playerProfile", data);
  return { credits: p.credits, plays: p.plays, wins: p.wins, sessionKey: p.sessionKey.toBase58(), sessionExpiresAt: Number(p.sessionExpiresAt), inQueue: p.inQueue, pending: p.pending.map(big) };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const NO_TURN = PublicKey.default.toBase58();
export const fmtAmount = (mintIdx: number, amount: bigint) => {
  const d = MINT_DECIMALS[mintIdx];
  const v = d ? Number(amount) / 10 ** d : Number(amount);
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${MINT_KEYS[mintIdx]}`;
};

// ───── Instructions ─────
const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);
export const ix = {
  initPlayer: (w: PublicKey) => M.initPlayer().accountsPartial({ authority: w, config: configPda, profile: playerPda(w), systemProgram: SystemProgram.programId }).instruction(),
  faucet: (w: PublicKey) => M.faucet().accountsPartial({
    authority: w, config: configPda, profile: playerPda(w), mint: MINTS[0], faucetAuthority: faucetPda, playerAta: ata(MINTS[0], w),
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).instruction(),
  buyCredits: (w: PublicKey, n: number) => M.buyCredits(n).accountsPartial({
    authority: w, profile: playerPda(w), config: configPda, mint: MINTS[0], playerAta: ata(MINTS[0], w), vault: vaultPda, vaultAta: VAULT_ATAS[0], tokenProgram: TOKEN_PROGRAM_ID,
  }).instruction(),
  registerSession: (w: PublicKey, key: PublicKey, expires: number) => M.registerSessionKey(key, new BN(expires)).accountsPartial({ authority: w, profile: playerPda(w) }).instruction(),
  delegatePlayer: (w: PublicKey) => M.delegatePlayer().accountsPartial({ authority: w, config: configPda, profile: playerPda(w) }).instruction(),
  claimPrize: (w: PublicKey, i: number) => M.claimPrize(i).accountsPartial({
    authority: w, profile: playerPda(w), config: configPda, mint: MINTS[i], vault: vaultPda, vaultAta: VAULT_ATAS[i], playerAta: ata(MINTS[i], w),
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).instruction(),
  joinQueue: (signer: PublicKey, w: PublicKey) => M.joinQueue().accountsPartial({ signer, profile: playerPda(w), config: configPda, cabinet: cabinetPda }).instruction(),
  moveClaw: (signer: PublicKey, w: PublicKey, dx: number, dz: number, seq: number) => M.moveClaw(dx, dz, seq).accountsPartial({ signer, profile: playerPda(w), cabinet: cabinetPda }).instruction(),
  // drop_claw_public: the private mystery vault is derived on chain instead of listed, so the TEE does not
  // redact this transaction and the drop shows up in the Live Proof drawer like every other move.
  dropClaw: (signer: PublicKey, w: PublicKey, seed: number) => M.dropClawPublic(seed).accountsPartial({ signer, profile: playerPda(w), config: configPda, cabinet: cabinetPda, oracleQueue: VRF_QUEUE }).instruction(),
  expireTurn: (signer: PublicKey, owner: PublicKey) => M.expireTurn().accountsPartial({ signer, config: configPda, cabinet: cabinetPda, profile: playerPda(owner) }).instruction(),
  cashOut: (w: PublicKey) => M.cashOut().accountsPartial({ authority: w, profile: playerPda(w), magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT }).instruction(),
  // Commit + undelegate the profile and schedule the `settle_prizes` Magic Action on L1 (pays prizes in the same settlement).
  cashOutAndSettle: (w: PublicKey) => M.cashOutAndSettle().accountsPartial({
    authority: w, profile: playerPda(w), config: configPda, cabinet: cabinetPda, vault: vaultPda, program: PROGRAM_ID, magicProgram: MAGIC_PROGRAM, magicContext: MAGIC_CONTEXT,
  }).instruction(),
};

/** The payout action needs the player's token account for every prize mint; create the missing ones (L1, idempotent). */
export async function missingAtaIxs(w: PublicKey): Promise<TransactionInstruction[]> {
  const atas = MINTS.map((m) => ata(m, w));
  const infos = await base.getMultipleAccountsInfo(atas);
  return infos.flatMap((a, i) => (a ? [] : [createAssociatedTokenAccountIdempotentInstruction(w, atas[i], w, MINTS[i])]));
}

export async function tokenBalance(mintIdx: number, owner: PublicKey): Promise<bigint> {
  try { const b = await base.getTokenAccountBalance(ata(MINTS[mintIdx], owner)); return BigInt(b.value.amount); } catch { return 0n; }
}
export const solBalance = async (k: PublicKey) => (await base.getBalance(k)) / LAMPORTS_PER_SOL;

export const explorerTx = (sig: string, er = false) =>
  er ? `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(ER_URL)}` : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
