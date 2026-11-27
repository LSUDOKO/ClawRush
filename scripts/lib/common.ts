// Shared helpers for scripts and tests: connections, PDAs, TEE auth, ER send.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import fs from "fs";
import os from "os";
import path from "path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const BASE_URL = process.env.BASE_URL ?? "https://api.devnet.solana.com";
export const ER_URL = process.env.ER_URL ?? "https://devnet-tee.magicblock.app";
export const ER_VALIDATOR = new PublicKey(process.env.ER_VALIDATOR ?? "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const CABINET_ID = Number(process.env.CABINET_ID ?? 1);
export const STATE_FILE = path.join(ROOT, "scripts", `state.devnet.${CABINET_ID}.json`);
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
export const EPHEMERAL_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
export const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// Fresh build output when present; otherwise the IDL copy committed for the app (CI has no target/).
const IDL_PATH = [path.join(ROOT, "target/idl/clawrush.json"), path.join(ROOT, "app/src/lib/idl.json")].find((p) => fs.existsSync(p))!;
export const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
export const PROGRAM_ID = new PublicKey(idl.address);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function loadKeypair(p: string): Keypair {
  const file = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : path.resolve(ROOT, p);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}
export function loadOrCreateKeypair(p: string): Keypair {
  const file = path.resolve(ROOT, p);
  if (fs.existsSync(file)) return loadKeypair(p);
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

export const seed = (s: string) => Buffer.from(s);
export const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configPda = (id = CABINET_ID) => pda([seed("config"), Buffer.from([id])]);
export const cabinetPda = (id = CABINET_ID) => pda([seed("cabinet"), Buffer.from([id])]);
export const mysteryPda = (id = CABINET_ID) => pda([seed("mystery"), Buffer.from([id])]);
export const vaultPda = (id = CABINET_ID) => pda([seed("vault"), Buffer.from([id])]);
export const playerPda = (w: PublicKey, id = CABINET_ID) => pda([seed("player"), Buffer.from([id]), w.toBuffer()]);
export const faucetPda = () => pda([seed("faucet")]);
export const permissionPda = (acc: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("permission:"), acc.toBuffer()], PERMISSION_PROGRAM)[0];

export const base = new Connection(BASE_URL, "confirmed");
export function program(conn: Connection, kp: Keypair) {
  return new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" })) as any;
}

/** TEE ER connection authenticated for `kp` (token signed locally). */
const tokenCache = new Map<string, Connection>();
export async function erConn(kp: Keypair): Promise<Connection> {
  const k = kp.publicKey.toBase58();
  if (tokenCache.has(k)) return tokenCache.get(k)!;
  let url = ER_URL;
  if (ER_URL.includes("tee")) {
    for (let i = 0; ; i++) {
      try {
        const { token } = await getAuthToken(ER_URL, kp.publicKey, async (m) => nacl.sign.detached(m, kp.secretKey));
        url = `${ER_URL}?token=${token}`;
        break;
      } catch (e) {
        if (i >= 4) throw e;
        await sleep(1500);
      }
    }
  }
  const c = new Connection(url, { commitment: "confirmed", wsEndpoint: url.replace("https", "wss") });
  tokenCache.set(k, c);
  return c;
}
/** Unauthenticated TEE connection (what a logged-out spectator / attacker sees). */
export const erPublic = new Connection(ER_URL, "confirmed");

export async function sendTx(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[], opts: { cu?: number } = {}) {
  const tx = new Transaction();
  if (opts.cu) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu }));
  tx.add(...ixs);
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const t0 = Date.now();
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
  return { sig, ms: Date.now() - t0 };
}

export function loadState(): any {
  return fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
}
export function saveState(s: any) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
}
export const explorer = (sig: string, cluster: "devnet" | "er" = "devnet") =>
  cluster === "er"
    ? `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(ER_URL)}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
