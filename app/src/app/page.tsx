"use client";
import dynamic from "next/dynamic";

// Game is client-only (wallets, canvas, websockets).
const Game = dynamic(() => import("@/components/Game"), { ssr: false, loading: () => <p className="p-6 text-center text-white/70">Loading ClawRush…</p> });

export default function Page() {
  return <Game />;
}
