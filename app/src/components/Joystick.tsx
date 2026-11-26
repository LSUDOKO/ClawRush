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
      className={`relative h-32 w-32 touch-none select-none rounded-full border-2 ${disabled ? "border-white/10 opacity-40" : "border-cyan-300/60 shadow-[0_0_24px_rgba(61,245,255,0.35)]"} bg-white/5`}
      onPointerDown={(e) => { if (disabled) return; active.current = e.pointerId; (e.target as HTMLElement).setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="pointer-events-none absolute inset-0 m-auto h-14 w-14 rounded-full bg-gradient-to-br from-pink-400 to-fuchsia-700 shadow-[0_0_18px_rgba(255,61,189,0.8)]"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
