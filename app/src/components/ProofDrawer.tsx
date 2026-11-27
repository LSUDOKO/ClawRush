"use client";
import { useEffect, useState } from "react";
import type { Cabinet } from "@/lib/chain";
import { outcome, gripBps } from "@/lib/math";
import { DEV, PROGRAM_ID, cabinetPda, mysteryPda, erPublic, explorerTx, explorerAddr, short, fmtAmount, ER_URL } from "@/lib/chain";

export type ProofItem = { label: string; sig: string; er?: boolean };
const OUT = ["—", "HELD", "SLIP", "MISS"];

export default function ProofDrawer({ cab, proof, avgLat, lastLat, me, session, grip }: {
  grip?: { max: number; min: number } | null;
  cab: Cabinet | null; proof: ProofItem[]; avgLat: number | null; lastLat: number | null; me: string | null; session: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [sealed, setSealed] = useState<"checking" | "sealed" | "readable" | "unknown">("checking");
  useEffect(() => {
    if (!open) return;
    // Live privacy check: ask the TEE RPC for the mystery vault with no credentials.
    erPublic.getAccountInfo(mysteryPda).then((a) => setSealed(a ? "readable" : "sealed")).catch(() => setSealed("unknown"));
  }, [open, cab?.round]);
  const L = cab?.last;
  return (
    <section className="panel overflow-hidden">
      <button className="flex h-14 w-full items-center justify-between gap-2 px-3" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/cap_mystery.webp" alt="" className="h-9 w-9" />
          <span className="title-stroke font-display whitespace-nowrap text-xl">{open ? "▾" : "▸"} Live Proof</span>
        </span>
        <span className="text-right text-[10px] font-bold leading-tight text-white/70">{avgLat ? `ER move confirm ${avgLat} ms avg` : "every action is a real tx"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t-2 border-[var(--gold)]/40 bg-black/20 px-3 py-3 text-xs">
          <div>
            <p className="text-[var(--lime)]/80">ER latency (move_claw sent → confirmed)</p>
            <p className="font-display text-xl text-[var(--gold)]">{lastLat ?? "—"} ms <span className="font-body text-xs font-normal text-[var(--lime)]/80">last · {avgLat ?? "—"} ms avg (20) · Solana L1 slot ≈ 400 ms</span></p>
          </div>
          {L && L.round > 0 && (
            <div>
              <p className="text-[var(--lime)]/80">Last drop · round {L.round} · {short(L.player)}{L.player === me ? " (you)" : ""}</p>
              <p className="font-mono text-sm">
                Alignment {((10000 - L.alignErrBps) / 100).toFixed(0)}% → Grip {(L.gripBps / 100).toFixed(0)}% → VRF roll {(L.rollBps / 100).toFixed(1)} → <b className={L.outcome === 1 ? "text-[var(--gold)]" : "text-[var(--magenta)]"}>{OUT[L.outcome]}</b>
              </p>
              {(() => {
                // Re-derive the result from the on-chain numbers with the same integer math as the program.
                const ok = outcome(L.alignErrBps, L.gripBps, L.rollBps) === L.outcome && (!grip || L.alignErrBps >= 10000 || gripBps(L.alignErrBps, grip.max, grip.min) === L.gripBps);
                return <p className={`font-bold ${ok ? "text-[var(--lime)]" : "text-[var(--magenta)]"}`}>{ok ? "✓ Re-checked in your browser: grip curve and roll < grip match the program's math" : "✗ Recomputed result does not match the on-chain record"}</p>;
              })()}
              <p className="text-[var(--lime)]/80">HELD when roll &lt; grip. {L.outcome === 1 ? `Prize: ${fmtAmount(L.mintIdx, L.amount)}${L.kind === 2 ? ` (mystery, tier ${["", "dust", "mid", "jackpot"][L.tier]})` : ""}` : ""}</p>
            </div>
          )}
          <div>
            <p className="text-[var(--lime)]/80">Mystery capsules</p>
            <p>{sealed === "sealed" ? "🔒 Sealed in Private ER: the TEE RPC refuses to return the mystery vault to anyone (checked live just now)." : sealed === "readable" ? "⚠ Mystery vault is readable!" : sealed === "unknown" ? "Couldn't reach the TEE RPC to check right now." : "checking…"}</p>
          </div>
          <div>
            <p className="text-[var(--lime)]/80">Your transactions this session</p>
            {proof.length ? (
              <ul className="space-y-1">{proof.map((p) => (
                <li key={p.sig}><a className="underline decoration-[var(--gold)]/60" href={explorerTx(p.sig, p.er)} target="_blank" rel="noreferrer">{p.label}</a> <span className="font-mono text-white/50">{short(p.sig)}</span></li>
              ))}</ul>
            ) : <p className="text-white/50">None yet.</p>}
            <p className="mt-1 text-white/40">ER links open Solana Explorer pointed at {ER_URL}. Public moves (join, move, expire, cash out) are readable by anyone; transactions that touch the sealed mystery vault (drop, VRF result, restock) are redacted for everyone.</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[var(--lime)]/80">On-chain addresses (devnet)</p>
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
