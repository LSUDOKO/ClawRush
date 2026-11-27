"use client";
// Thumb joystick. Writes a [-1, 1] vector into `vec` (x = right, z = up/away). Arrow keys / WASD work too.
import { useEffect, useRef, useState } from "react";

export default function Joystick({ vec, disabled }: { vec: React.MutableRefObject<{ x: number; z: number }>; disabled: boolean }) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

  useEffect(() => {
    if (disabled) { vec.current = { x: 0, z: 0 }; setKnob({ x: 0, y: 0 }); }
  }, [disabled, vec]);

  useEffect(() => {
    const keys = new Set<string>();
    const upd = () => {
      if (disabled) return;
      const x = (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0);
      const z = (keys.has("ArrowUp") || keys.has("w") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("s") ? 1 : 0);
      if (active.current === null) { vec.current = { x, z }; setKnob({ x: x * 34, y: -z * 34 }); }
    };
    const down = (e: KeyboardEvent) => { if (/^Arrow|^[wasd]$/.test(e.key)) { keys.add(e.key); upd(); } };
    const up = (e: KeyboardEvent) => { keys.delete(e.key); upd(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [disabled, vec]);

  const move = (e: React.PointerEvent) => {
    if (active.current !== e.pointerId || !pad.current) return;
    const r = pad.current.getBoundingClientRect();
    const R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const m = Math.hypot(dx, dy);
    if (m > R * 0.8) { dx *= (R * 0.8) / m; dy *= (R * 0.8) / m; }
    setKnob({ x: dx, y: dy });
    vec.current = { x: dx / (R * 0.8), z: -dy / (R * 0.8) };
  };
  const end = () => { active.current = null; setKnob({ x: 0, y: 0 }); vec.current = { x: 0, z: 0 }; };

  return (
    <div
      ref={pad}
      role="application"
      aria-label="Claw joystick. Drag, or use arrow keys."
      aria-disabled={disabled}
      className={`relative h-32 w-32 shrink-0 touch-none select-none rounded-full ${disabled ? "opacity-45 grayscale" : ""}`}
      style={{
        background: "radial-gradient(circle at 50% 45%, #2a0b48 0%, #14041f 62%, #0a0213 100%)",
        boxShadow: "0 0 0 6px #ffcf3a, 0 0 0 9px #1a0630, inset 0 6px 16px rgba(0,0,0,0.7), 0 10px 20px rgba(0,0,0,0.5)" + (disabled ? "" : ", 0 0 30px rgba(255,207,58,0.45)"),
      }}
      onPointerDown={(e) => { if (disabled) return; active.current = e.pointerId; (e.target as HTMLElement).setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {["▲", "▶", "▼", "◀"].map((a, i) => (
        <span key={a} aria-hidden className="pointer-events-none absolute text-[11px] text-[#ffcf3a]/70"
          style={{ left: "50%", top: "50%", transform: `rotate(${i * 90}deg) translateY(-52px) rotate(${-i * 90}deg) translate(-50%, -50%)` }}>{a}</span>
      ))}
      <div className="pointer-events-none absolute inset-0 m-auto h-16 w-16 rounded-full"
        style={{
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          background: "radial-gradient(circle at 35% 30%, #ffc2ec 0%, #ff2fb2 40%, #8a0a5f 100%)",
          boxShadow: "0 0 0 3px #1a0630, 0 6px 0 #4d0535, 0 10px 18px rgba(0,0,0,0.55), 0 0 22px rgba(255,47,178,0.7)",
        }} />
    </div>
  );
}
