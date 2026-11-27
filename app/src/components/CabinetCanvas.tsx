"use client";
// Canvas 2D cabinet. FRONT view: left/right = x, depth (z) only by perspective size.
// SIDE view: left/right = z, depth (x) by perspective. Players toggle views to aim in depth.
import { useEffect, useRef } from "react";
import type { Cabinet } from "@/lib/chain";
import { MINT_KEYS, MINT_DECIMALS } from "@/lib/chain";
import { CHUTE_X, CHUTE_Z, GRID } from "@/lib/math";

// "orbit" is a spectator-only 3D camera; the 2D fallback draws it as the front view.
export type View = "front" | "side" | "orbit";
export type Anim = { phase: "idle" | "drop" | "hold" | "lift"; t0: number; outcome?: number; capsuleIdx?: number };

const COLORS = ["#ffd23f", "#3df5ff", "#ff3dbd"];

// Pre-rendered 3D sprites. Drawn centred on the same projected point and at the on-chain radius
// as the fallback gradient ball, so the picture never misleads aim.
const SPRITES = { gold: "/art/cap_gold.webp", gem: "/art/cap_gem.webp", koi: "/art/cap_koi.webp", robo: "/art/cap_robo.webp", mystery: "/art/cap_mystery.webp", claw: "/art/claw_open.webp", wall: "/art/wall.webp" } as const;
type SpriteKey = keyof typeof SPRITES;
const img: Partial<Record<SpriteKey, HTMLImageElement>> = {};
function sprite(k: SpriteKey) {
  if (typeof window === "undefined") return null;
  let i = img[k];
  if (!i) { i = new Image(); i.src = SPRITES[k]; img[k] = i; }
  return i.complete && i.naturalWidth > 0 ? i : null;
}
let FONT = "sans-serif"; // resolved to the next/font family at mount
const MINT_SPRITE: SpriteKey[] = ["gold", "gem", "koi", "robo"];
const capSprite = (kind: number, mintIdx: number) => sprite(kind === 2 ? "mystery" : MINT_SPRITE[mintIdx] ?? "gold");

export default function CabinetCanvas({ cabinet, claw, view, anim, reduced }: {
  cabinet: Cabinet | null; claw: { x: number; z: number }; view: View; anim: Anim; reduced: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ cabinet, claw, view, anim, reduced });
  st.current = { cabinet, claw, view, anim, reduced };

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext("2d")!;
    FONT = `${getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim() || "sans-serif"}, sans-serif`;
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

      // Back wall (velvet + neon), glossy floor, faint aim grid
      const wall = sprite("wall");
      if (wall) { g.drawImage(wall, 0, 0, W, farY + 6); } else { g.fillStyle = "#2a0b48"; g.fillRect(0, 0, W, farY + 6); }
      const fl = g.createLinearGradient(0, farY, 0, H);
      fl.addColorStop(0, "#2b0d4a"); fl.addColorStop(0.5, "#1c0633"); fl.addColorStop(1, "#0d0219");
      g.fillStyle = fl;
      g.beginPath(); g.moveTo(0, farY); g.lineTo(W, farY); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
      const sheen = g.createRadialGradient(W / 2, farY + (H - farY) * 0.2, 4, W / 2, farY + (H - farY) * 0.2, W * 0.7);
      sheen.addColorStop(0, "rgba(255,47,178,0.18)"); sheen.addColorStop(1, "rgba(255,47,178,0)");
      g.fillStyle = sheen; g.fillRect(0, farY, W, H - farY);
      g.strokeStyle = "rgba(166,255,46,0.13)"; g.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const a = proj(view === "front" ? i * 100 : 0, view === "front" ? 0 : i * 100), b = proj(view === "front" ? i * 100 : GRID, view === "front" ? GRID : i * 100);
        g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke();
        const c = proj(view === "front" ? 0 : GRID - i * 100, view === "front" ? i * 100 : 0), e = proj(view === "front" ? GRID : GRID - i * 100, view === "front" ? i * 100 : GRID);
        g.beginPath(); g.moveTo(c.sx, c.sy); g.lineTo(e.sx, e.sy); g.stroke();
      }
      // Prize chute: a glowing slime pit
      const ch = proj(CHUTE_X, CHUTE_Z);
      const cw = 70 * ch.s * (W / 400);
      g.save();
      g.shadowColor = "#a6ff2e"; g.shadowBlur = reduced ? 14 : 14 + 6 * Math.sin(now / 350);
      g.fillStyle = "#0a0214"; g.strokeStyle = "#a6ff2e"; g.lineWidth = 4;
      g.beginPath(); g.ellipse(ch.sx, ch.sy, cw / 2, cw * 0.22, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.shadowBlur = 0; g.fillStyle = "#a6ff2e"; g.textAlign = "center";
      g.font = `${Math.round(11 * ch.s + 4)}px ${FONT}`;
      g.strokeStyle = "#1a0630"; g.lineWidth = 3; g.strokeText("PRIZE", ch.sx, ch.sy + cw * 0.22 + 14 * ch.s);
      g.fillText("PRIZE", ch.sx, ch.sy + cw * 0.22 + 14 * ch.s);
      g.restore();

      // Capsules, far to near
      const caps = (cabinet?.capsules ?? []).map((c, i) => ({ c, i })).filter(({ c }) => c.active);
      const held = anim.phase !== "idle" && anim.outcome === 1 ? anim.capsuleIdx : undefined;
      caps.sort((a, b) => proj(b.c.x, b.c.z).sy - proj(a.c.x, a.c.z).sy).reverse();
      const labels: { x: number; y: number; text: string; fs: number; mystery: boolean; slip: number; top: number }[] = [];
      for (const { c, i } of caps) {
        if (i === held && anim.phase === "lift") continue;
        const p = proj(c.x, c.z);
        const r = (c.radius / GRID) * W * 0.92 * p.s;
        const cy = p.sy - r * 0.45; // same centre as the fallback ball
        // contact shadow
        g.fillStyle = "rgba(0,0,0,0.45)";
        g.beginPath(); g.ellipse(p.sx, p.sy + r * 0.38, r * 0.85, r * 0.22, 0, 0, Math.PI * 2); g.fill();
        const spr = capSprite(c.kind, c.mintIdx);
        g.save();
        const col = COLORS[c.kind] ?? "#fff";
        if (c.kind === 2) { g.shadowColor = "#a6ff2e"; g.shadowBlur = 16 + (reduced ? 0 : 8 * Math.sin(now / 300)); }
        if (spr) {
          const sw = r * 2.15, sh = sw * (spr.naturalHeight / spr.naturalWidth);
          g.drawImage(spr, p.sx - sw / 2, cy - sh / 2, sw, sh);
        } else {
          g.shadowColor = col; g.shadowBlur = 12;
          const grad = g.createRadialGradient(p.sx - r * 0.3, p.sy - r * 0.6, r * 0.1, p.sx, cy, r);
          grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.35, col); grad.addColorStop(1, "rgba(20,0,40,0.9)");
          g.fillStyle = grad;
          g.beginPath(); g.ellipse(p.sx, cy, r, r * 0.9, 0, 0, Math.PI * 2); g.fill();
        }
        g.restore();
        // Prize label: amount + token (mystery shows only "?"); drawn after all capsules
        labels.push({ x: p.sx, y: p.sy + r * 0.62, text: c.kind === 2 ? "?" : `${c.kind === 1 ? "★ " : ""}${Number(c.amount) / 10 ** MINT_DECIMALS[c.mintIdx]} ${MINT_KEYS[c.mintIdx]}`,
          fs: Math.max(9, Math.round(r * 0.36)), mystery: c.kind === 2, slip: c.slipCount, top: cy - r * 1.05 });
      }
      const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
      for (const L of labels) {
        g.font = `${L.fs}px ${FONT}`; g.textAlign = "center";
        const tw = g.measureText(L.text).width + L.fs * 0.9, th = L.fs * 1.25;
        let y = L.y;
        for (let k = 0; k < 4; k++) {
          const hit = placed.some((q) => L.x - tw / 2 < q.x1 && L.x + tw / 2 > q.x0 && y - th * 0.7 < q.y1 && y + th * 0.4 > q.y0);
          if (!hit) break; y += th * 0.95;
        }
        placed.push({ x0: L.x - tw / 2, x1: L.x + tw / 2, y0: y - th * 0.7, y1: y + th * 0.4 });
        g.fillStyle = L.mystery ? "rgba(166,255,46,0.95)" : "rgba(255,207,58,0.95)";
        g.strokeStyle = "#1a0630"; g.lineWidth = 2;
        g.beginPath(); g.roundRect(L.x - tw / 2, y - L.fs * 0.85, tw, th, L.fs * 0.6); g.fill(); g.stroke();
        g.fillStyle = "#1a0630"; g.fillText(L.text, L.x, y + L.fs * 0.12);
        if (L.slip > 0) { // small magenta badge on the capsule instead of a long text line
          const b = Math.max(7, L.fs * 0.8);
          g.fillStyle = "#ff2fb2"; g.beginPath(); g.arc(L.x + b * 1.3, L.top + b * 0.6, b * 0.75, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = "#fff"; g.font = `${Math.round(b)}px ${FONT}`; g.fillText(`${L.slip}`, L.x + b * 1.3, L.top + b * 0.95);
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
      const cs = 16 * cp.s * (W / 380);
      // aim marker on the floor under the claw
      g.save(); g.strokeStyle = "rgba(61,245,255,0.75)"; g.lineWidth = 2; g.setLineDash([4, 4]);
      g.beginPath(); g.ellipse(cp.sx, cp.sy, cs * 1.3, cs * 0.38, 0, 0, Math.PI * 2); g.stroke(); g.restore();
      // cable
      g.strokeStyle = "#d9d4ff"; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(cp.sx, topY); g.lineTo(hx, hy - cs * 1.6); g.stroke();
      const open = anim.phase === "drop" || anim.phase === "idle" ? 1 : 0.55;
      const cl = sprite("claw");
      if (cl) {
        const ch2 = cs * 3.4, cw2 = ch2 * (cl.naturalWidth / cl.naturalHeight);
        g.save(); g.shadowColor = "rgba(255,207,58,0.8)"; g.shadowBlur = 14;
        g.translate(hx, hy - cs * 1.7); g.scale(open, 1);
        g.drawImage(cl, -cw2 / 2, 0, cw2, ch2); g.restore();
      } else {
        g.save(); g.shadowColor = "#3df5ff"; g.shadowBlur = 14;
        g.fillStyle = "#e8e6ff"; g.fillRect(hx - cs, hy - cs * 0.5, cs * 2, cs * 0.6);
        g.strokeStyle = "#e8e6ff"; g.lineWidth = 3;
        for (const sgn of [-1, 1]) {
          g.beginPath(); g.moveTo(hx + sgn * cs * 0.8, hy + cs * 0.1);
          g.quadraticCurveTo(hx + sgn * cs * (0.8 + open), hy + cs * 0.9, hx + sgn * cs * 0.35 * (1 + open * 0.3), hy + cs * 1.4); g.stroke();
        }
        g.restore();
      }
      if (held !== undefined && anim.phase === "lift" && cabinet) {
        const c = cabinet.capsules[held];
        const spr = capSprite(c.kind, c.mintIdx);
        if (spr) { const w = cs * 2; g.drawImage(spr, hx - w / 2, hy + cs * 0.6, w, w * (spr.naturalHeight / spr.naturalWidth)); }
        else { g.save(); g.shadowColor = COLORS[c.kind]; g.shadowBlur = 20; g.fillStyle = COLORS[c.kind];
          g.beginPath(); g.arc(hx, hy + cs * 1.4, cs * 0.9, 0, Math.PI * 2); g.fill(); g.restore(); }
      }
      // Gantry rail
      const rail = g.createLinearGradient(0, topY - 6, 0, topY + 4);
      rail.addColorStop(0, "#fff3a0"); rail.addColorStop(1, "#b9770e");
      g.fillStyle = rail; g.fillRect(0, topY - 6, W, 9);
      g.fillStyle = "#1a0630"; g.fillRect(0, topY + 3, W, 2);
      g.fillStyle = "rgba(255,255,255,0.75)"; g.font = `11px ${FONT}`; g.textAlign = "left";
      g.strokeStyle = "rgba(26,6,48,0.9)"; g.lineWidth = 3;
      const vt = view === "front" ? "FRONT VIEW · LEFT ↔ RIGHT" : "SIDE VIEW · NEAR ↔ FAR";
      g.strokeText(vt, 10, H - 9); g.fillText(vt, 10, H - 9);
      g.textAlign = "right"; g.fillStyle = "#ff2fb2"; g.beginPath(); g.arc(W - 62, H - 13, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(255,255,255,0.75)"; g.strokeText("= SLIPS", W - 10, H - 9); g.fillText("= SLIPS", W - 10, H - 9);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="h-full w-full" role="img" aria-label={`Claw cabinet, ${view} view, ${cabinet?.capsules.filter((c) => c.active).length ?? 0} capsules`} />;
}
