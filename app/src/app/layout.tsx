import type { Metadata, Viewport } from "next";
import { Press_Start_2P } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const display = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "ClawRush — one claw, every player, real prizes",
  description: "A live multiplayer skill × VRF claw machine on Solana devnet, powered by MagicBlock Ephemeral Rollups.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0216" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
