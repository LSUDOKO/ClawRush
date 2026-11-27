import type { Metadata, Viewport } from "next";
import { Luckiest_Guy, Nunito } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const display = Luckiest_Guy({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = Nunito({ weight: ["600", "800", "900"], subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "ClawRush — one claw, every player, real prizes",
  description: "A live multiplayer skill × VRF claw machine on Solana devnet, powered by MagicBlock Ephemeral Rollups.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#12041f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
