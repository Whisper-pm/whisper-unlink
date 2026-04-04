"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Module-level state for the Ledger EIP1193 provider
let ledgerProvider: any = null;
let ledgerProviderListeners: Array<(p: any) => void> = [];

export function getLedgerProvider(): any {
  return ledgerProvider;
}

export function onLedgerProviderReady(cb: (p: any) => void) {
  if (ledgerProvider) {
    cb(ledgerProvider);
  } else {
    ledgerProviderListeners.push(cb);
  }
}

function setLedgerProvider(p: any) {
  ledgerProvider = p;
  for (const cb of ledgerProviderListeners) cb(p);
  ledgerProviderListeners = [];
}

/**
 * Initializes the Ledger wallet provider. Appends the <ledger-button-app> web component
 * to document.body (hidden, but hosts the modal in shadow DOM with position:fixed).
 * Captures the EIP1193 provider announced via eip6963:announceProvider.
 */
export function LedgerInit() {
  const initRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || initRef.current) return;
    initRef.current = true;

    // Listen for the Ledger provider announcement (EIP-6963)
    const handleAnnounce = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.info?.rdns === "com.ledger.wallet.provider") {
        setLedgerProvider(detail.provider);
      }
    };
    window.addEventListener("eip6963:announceProvider", handleAnnounce);

    import("@ledgerhq/ledger-wallet-provider").then((module) => {
      module.initializeLedgerProvider({
        target: document.body,
        dAppIdentifier: "ledger",
        apiKey:
          "1e55ba3959f4543af24809d9066a2120bd2ac9246e626e26a1ff77eb109ca0e5",
        loggerLevel: "info",
        environment: "production",
        walletTransactionFeatures: [
          "send",
          "receive",
          "swap",
          "buy",
          "earn",
          "sell",
        ],
      });

      // The <ledger-button-app> is now in document.body.
      // Make the host element take no layout space, but allow its shadow DOM
      // (which uses position:fixed for the modal) to render on top of everything.
      const el = document.body.querySelector("ledger-button-app");
      if (el instanceof HTMLElement) {
        el.style.position = "fixed";
        el.style.top = "50%";
        el.style.left = "50%";
        el.style.transform = "translate(-50%, -50%)";
        el.style.width = "0";
        el.style.height = "0";
        el.style.overflow = "visible";
        el.style.zIndex = "999999";
      }
    });

    return () => {
      window.removeEventListener("eip6963:announceProvider", handleAnnounce);
    };
  }, []);

  return null;
}

/**
 * Hook: returns a callback to trigger the Ledger connection modal.
 * Also returns the connected address (if any) and connection state.
 */
export function useLedgerConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReady, setIsReady] = useState(!!ledgerProvider);

  useEffect(() => {
    if (ledgerProvider) {
      setIsReady(true);
      return;
    }
    onLedgerProviderReady(() => setIsReady(true));
  }, []);

  const connect = useCallback(async () => {
    const provider = getLedgerProvider();
    if (!provider) {
      console.warn("[Ledger] Provider not ready yet");
      return;
    }
    setIsConnecting(true);
    try {
      const accounts: string[] = await provider.request({
        method: "eth_requestAccounts",
      });
      if (accounts && accounts.length > 0) {
        setAddress(accounts[0]);
      }
    } catch (err) {
      console.error("[Ledger] Connection error:", err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  return { connect, address, isConnecting, isReady };
}
