"use client";

import { useEffect, useRef } from "react";

/**
 * Initializes the Ledger Button floating widget.
 * The floating button appears in bottom-right and handles its own modal.
 * No custom button needed — the native Ledger widget works correctly.
 */
export function LedgerInit() {
  const initRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || initRef.current) return;
    initRef.current = true;

    import("@ledgerhq/ledger-wallet-provider").then((module) => {
      module.initializeLedgerProvider({
        target: document.body,
        floatingButtonPosition: "bottom-right",
        dAppIdentifier: "ledger",
        apiKey: "1e55ba3959f4543af24809d9066a2120bd2ac9246e626e26a1ff77eb109ca0e5",
        loggerLevel: "info",
        environment: "production",
        walletTransactionFeatures: ["send", "receive", "swap", "buy", "earn", "sell"],
      });
    });
  }, []);

  return null; // No UI — the floating button is managed by the Ledger widget
}
