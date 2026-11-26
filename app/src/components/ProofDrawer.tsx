"use client";
import { useEffect, useState } from "react";
import type { Cabinet } from "@/lib/chain";
import { DEV, PROGRAM_ID, cabinetPda, mysteryPda, erPublic, explorerTx, explorerAddr, short, fmtAmount, ER_URL } from "@/lib/chain";

export type ProofItem = { label: string; sig: string; er?: boolean };
const OUT = ["—", "HELD", "SLIP", "MISS"];

export default function ProofDrawer({ cab, proof, avgLat, lastLat, me, session }: {
  cab: Cabinet | null; proof: ProofItem[]; avgLat: number | null; lastLat: number | null; me: string | null; session: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [sealed, setSealed] = useState<"checking" | "sealed" | "readable">("checking");
  useEffect(() => {
    if (!open) return;
    // Live privacy check: ask the TEE RPC for the mystery vault with no credentials.
    erPublic.getAccountInfo(mysteryPda).then((a) => setSealed(a ? "readable" : "sealed")).catch(() => setSealed("sealed"));
  }, [open, cab?.round]);
  const L = cab?.last;
  return (
    <section className="rounded-2xl border border-cyan-300/30 bg-white/5">
      <button className="flex h-11 w-full items-center justify-between px-3 text-sm font-bold text-cyan-200" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>▸ Live Proof</span><span className="text-xs font-normal text-white/60">{avgLat ? `ER move confirm ${avgLat} ms avg` : "every action is a real tx"}</span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 text-xs">
          <div>
            <p className="text-white/60">ER latency (move_claw sent → confirmed)</p>
            <p className="text-base font-bold">{lastLat ?? "—"} ms <span className="text-xs font-normal text-white/60">last · {avgLat ?? "—"} ms avg (20) · Solana L1 slot ≈ 400 ms</span></p>
          </div>
          {L && L.round > 0 && (
            <div>
              <p className="text-white/60">Last drop · round {L.round} · {short(L.player)}{L.player === me ? " (you)" : ""}</p>
              <p className="font-mono text-sm">
                Alignment {((10000 - L.alignErrBps) / 100).toFixed(0)}% → Grip {(L.gripBps / 100).toFixed(0)}% → VRF roll {(L.rollBps / 100).toFixed(1)} → <b className={L.outcome === 1 ? "text-yellow-300" : "text-pink-300"}>{OUT[L.outcome]}</b>
              </p>
              <p className="text-white/60">HELD when roll &lt; grip. {L.outcome === 1 ? `Prize: ${fmtAmount(L.mintIdx, L.amount)}${L.kind === 2 ? ` (mystery, tier ${["", "dust", "mid", "jackpot"][L.tier]})` : ""}` : ""}</p>
            </div>
          )}
          <div>
            <p className="text-white/60">Mystery capsules</p>
            <p>{sealed === "sealed" ? "🔒 Sealed in Private ER: the TEE RPC refuses to return the mystery vault to anyone (checked live just now)." : sealed === "readable" ? "⚠ Mystery vault is readable!" : "checking…"}</p>
          </div>
          <div>
            <p className="text-white/60">Your transactions this session</p>
            {proof.length ? (
              <ul className="space-y-1">{proof.map((p) => (
                <li key={p.sig}><a className="underline decoration-cyan-400/50" href={explorerTx(p.sig, p.er)} target="_blank" rel="noreferrer">{p.label}</a> <span className="font-mono text-white/50">{short(p.sig)}</span></li>
              ))}</ul>
            ) : <p className="text-white/50">None yet.</p>}
            <p className="mt-1 text-white/40">ER links open Solana Explorer pointed at {ER_URL}. The TEE hides transaction details without an auth token.</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-white/60">On-chain addresses (devnet)</p>
            <p>Program <a className="underline" href={explorerAddr(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">{short(PROGRAM_ID.toBase58())}</a></p>
            <p>Cabinet (delegated to TEE ER) <a className="underline" href={explorerAddr(cabinetPda.toBase58())} target="_blank" rel="noreferrer">{short(cabinetPda.toBase58())}</a></p>
            <p>Cabinet delegation <a className="underline" href={explorerTx(DEV.delegateCabinetSig)} target="_blank" rel="noreferrer">{short(DEV.delegateCabinetSig)}</a></p>
            <p>Prize vault <a className="underline" href={explorerAddr(DEV.vault)} target="_blank" rel="noreferrer">{short(DEV.vault)}</a></p>
            {session && <p>Your session key {short(session)} (can only queue / move / drop)</p>}
            {cab && <p>Cabinet totals: {cab.plays} plays · {cab.wins} held · {cab.slips} slips · {cab.misses} misses</p>}
          </div>
        </div>
      )}
    </section>
  );
}
