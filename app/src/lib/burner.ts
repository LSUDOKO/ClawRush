// Opt-in devnet burner wallet. Clearly labelled in the UI, never replaces a connected wallet,
// the secret key never leaves localStorage and is never shown.
import { Keypair } from "@solana/web3.js";
const KEY = "clawrush.burner.v1";
export function loadBurner(): Keypair | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); } catch { return null; }
}
export function createBurner(): Keypair {
  const kp = Keypair.generate();
  localStorage.setItem(KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}
export const forgetBurner = () => localStorage.removeItem(KEY);

/** Scoped session key for one wallet: may only sign join_queue / move_claw / drop_claw on chain. */
const skey = (w: string) => `clawrush.session.${w}`;
export function loadSession(wallet: string): { kp: Keypair; expires: number } | null {
  const raw = localStorage.getItem(skey(wallet));
  if (!raw) return null;
  try { const j = JSON.parse(raw); return { kp: Keypair.fromSecretKey(Uint8Array.from(j.sk)), expires: j.expires }; } catch { return null; }
}
export function newSession(wallet: string, secs: number) {
  const kp = Keypair.generate();
  const expires = Math.floor(Date.now() / 1000) + secs;
  localStorage.setItem(skey(wallet), JSON.stringify({ sk: Array.from(kp.secretKey), expires }));
  return { kp, expires };
}
