"use client";
import { useEffect, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { registerMwa, createDefaultAuthorizationCache, createDefaultChainSelector, createDefaultWalletNotFoundHandler } from "@solana-mobile/wallet-standard-mobile";
import { BASE_URL } from "@/lib/chain";

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Mobile Wallet Adapter (Android: Phantom / Solflare / Seeker) as a wallet-standard wallet.
    try {
      registerMwa({
        appIdentity: { name: "ClawRush", uri: window.location.origin, icon: "/icon.png" },
        authorizationCache: createDefaultAuthorizationCache(),
        chains: ["solana:devnet"],
        chainSelector: createDefaultChainSelector(),
        onWalletNotFound: createDefaultWalletNotFoundHandler(),
      });
    } catch { /* not a mobile browser */ }
  }, []);
  // Standard wallets (Phantom, Solflare, Backpack…) are auto-detected; no adapters needed.
  return (
    <ConnectionProvider endpoint={BASE_URL}>
      <WalletProvider wallets={[]} autoConnect>{children}</WalletProvider>
    </ConnectionProvider>
  );
}
