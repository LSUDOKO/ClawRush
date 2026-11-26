"use client";
// Canvas 2D cabinet. FRONT view: left/right = x, depth (z) only by perspective size.
// SIDE view: left/right = z, depth (x) by perspective. Players toggle views to aim in depth.
import { useEffect, useRef } from "react";
import type { Cabinet } from "@/lib/chain";
import { MINT_KEYS, MINT_DECIMALS } from "@/lib/chain";
import { CHUTE_X, CHUTE_Z, GRID } from "@/lib/math";

export type View = "front" | "side";
export type Anim = { phase: "idle" | "drop" | "hold" | "lift"; t0: number; outcome?: number; capsuleIdx?: number };

const COLORS = ["#ffd23f", "#3df5ff", "#ff3dbd"];

export default function CabinetCanvas({ cabinet, claw, view, anim, reduced }: {
  cabinet: Cabinet | null; claw: { x: number; z: number }; view: View; anim: Anim; reduced: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ cabinet, claw, view, anim, reduced });
  st.current = { cabinet, claw, view, anim, reduced };

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d")!;
    let raf = 0;
    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { cabinet, claw, view, anim, reduced } = st.current;
      const farY = H * 0.3, nearY = H * 0.94, topY = H * 0.06;
      // Project a grid point: h = horizontal coordinate, d = depth (0 near .. GRID far).
      const proj = (x: number, z: number) => {
        const h = view === "front" ? x : z;
        const d = view === "front" ? z : GRID - x;
        const k = d / GRID, s = 1 - 0.32 * k;
        return { sx: W / 2 + ((h - GRID / 2) / GRID) * W * 0.92 * s, sy: nearY - (nearY - farY) * k, s };
      };

      // Background + floor grid
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#120726"); bg.addColorStop(1, "#05020d");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.strokeStyle = "rgba(61,245,255,0.18)"; g.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const a = proj(view === "front" ? i * 100 : 0, view === "front" ? 0 : i * 100), b = proj(view === "front" ? i * 100 : GRID, view === "front" ? GRID : i * 100);
        g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke();
        const c = proj(view === "front" ? 0 : GRID - i * 100, view === "front" ? i * 100 : 0), e = proj(view === "front" ? GRID : GRID - i * 100, view === "front" ? i * 100 : GRID);
        g.beginPath(); g.moveTo(c.sx, c.sy); g.lineTo(e.sx, e.sy); g.stroke();
      }
      // Chute
      const ch = proj(CHUTE_X, CHUTE_Z);
      g.save(); g.shadowColor = "#39ff88"; g.shadowBlur = 18; g.strokeStyle = "#39ff88"; g.lineWidth = 2;
      const cw = 70 * ch.s * (W / 400);
      g.strokeRect(ch.sx - cw / 2, ch.sy - cw * 0.35, cw, cw * 0.7);
      g.fillStyle = "#39ff88"; g.font = `bold ${Math.round(10 * ch.s + 2)}px ui-monospace, monospace`; g.textAlign = "center";
      g.fillText("PRIZE", ch.sx, ch.sy + 4); g.restore();

      // Capsules, far to near
      const caps = (cabinet?.capsules ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.active);
      const held = anim.phase !== "idle" && anim.outcome === 1 ? anim.capsuleIdx : undefined;
      caps.sort((a, b) => proj(b.c.x, b.c.z).sy - proj(a.c.x, a.c.z).sy).reverse();
      for (const { c, i } of caps) {
        if (i === held && anim.phase === "lift") continue;
        const p = proj(c.x, c.z);
        const r = (c.radius / GRID) * W * 0.92 * p.s;
        g.save();
        const col = COLORS[c.kind] ?? "#fff";
        g.shadowColor = col; g.shadowBlur = c.kind === 2 ? 22 + (reduced ? 0 : 8 * Math.sin(now / 300)) : 12;
        const grad = g.createRadialGradient(p.sx - r * 0.3, p.sy - r * 0.6, r * 0.1, p.sx, p.sy - r * 0.4, r);
        grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.35, col); grad.addColorStop(1, "rgba(20,0,40,0.9)");
        g.fillStyle = grad;
        g.beginPath(); g.ellipse(p.sx, p.sy - r * 0.45, r, r * 0.9, 0, 0, Math.PI * 2); g.fill();
        g.restore();
        g.textAlign = "center";
        g.fillStyle = "#0b0216";
        g.font = `bold ${Math.max(10, Math.round(r * 0.7))}px ui-monospace, monospace`;
        const big = c.kind === 2 ? "?" : c.kind === 1 ? "★" : String(Number(c.amount) / 10 ** MINT_DECIMALS[c.mintIdx]);
        g.fillText(big, p.sx, p.sy - r * 0.25);
        if (c.kind !== 2) {
          g.fillStyle = "rgba(255,255,255,0.85)"; g.font = `${Math.max(8, Math.round(r * 0.42))}px ui-monospace, monospace`;
          g.fillText(MINT_KEYS[c.mintIdx], p.sx, p.sy + r * 0.75);
        }
        if (c.slipCount > 0) {
          g.fillStyle = "#ff3dbd"; g.font = `bold ${Math.max(9, Math.round(r * 0.35))}px ui-monospace, monospace`;
          g.fillText(`slipped ×${c.slipCount}`, p.sx, p.sy - r * 1.55);
        }
      }

      // Claw
      const cp = proj(claw.x, claw.z);
      const t = (now - anim.t0) / 1000;
      let drop = 0; // 0 = top, 1 = floor
      if (anim.phase === "drop") drop = Math.min(1, t / 0.9);
      if (anim.phase === "hold") drop = 1;
      if (anim.phase === "lift") drop = Math.max(0, 1 - t / 0.9);
      const sway = reduced || anim.phase !== "idle" ? 0 : Math.sin(now / 420) * 3;
      const hx = cp.sx + sway;
      const restY = topY + H * 0.1;
      const hy = restY + (cp.sy - 26 * cp.s - restY) * drop;
      g.strokeStyle = "#c9c3ff"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cp.sx, topY); g.lineTo(hx, hy); g.stroke();
      g.save(); g.shadowColor = "#3df5ff"; g.shadowBlur = 14;
      g.fillStyle = "#e8e6ff"; const cs = 16 * cp.s * (W / 380);
      g.fillRect(hx - cs, hy - cs * 0.5, cs * 2, cs * 0.6);
      const open = anim.phase === "drop" || anim.phase === "idle" ? 1 : 0.35;
      g.strokeStyle = "#e8e6ff"; g.lineWidth = 3;
      for (const sgn of [-1, 1]) {
        g.beginPath(); g.moveTo(hx + sgn * cs * 0.8, hy + cs * 0.1);
        g.quadraticCurveTo(hx + sgn * cs * (0.8 + open), hy + cs * 0.9, hx + sgn * cs * 0.35 * (1 + open * 0.3), hy + cs * 1.4); g.stroke();
      }
      g.restore();
      if (held !== undefined && anim.phase === "lift" && cabinet) {
        const c = cabinet.capsules[held];
        g.save(); g.shadowColor = COLORS[c.kind]; g.shadowBlur = 20; g.fillStyle = COLORS[c.kind];
        g.beginPath(); g.arc(hx, hy + cs * 1.4, cs * 0.9, 0, Math.PI * 2); g.fill(); g.restore();
      }
      // Ceiling rail + marquee
      g.fillStyle = "rgba(255,61,189,0.9)"; g.fillRect(0, topY - 3, W, 3);
      g.fillStyle = "rgba(255,255,255,0.45)"; g.font = "10px ui-monospace, monospace"; g.textAlign = "left";
      g.fillText(view === "front" ? "FRONT VIEW · x ↔  (depth hidden)" : "SIDE VIEW · z ↔  (width hidden)", 10, H - 8);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="h-full w-full" role="img" aria-label={`Claw cabinet, ${view} view, ${cabinet?.capsules.filter((c) => c.active).length ?? 0} capsules`} />;
}
