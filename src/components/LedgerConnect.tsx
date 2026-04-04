"use client";

import { useEffect, useRef } from "react";

export function LedgerInit() {
  const initRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || initRef.current) return;
    initRef.current = true;

    // Create a fixed container for the Ledger Button
    const container = document.createElement("div");
    container.id = "ledger-host";
    container.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:999999;width:auto;height:auto;";
    document.body.appendChild(container);

    import("@ledgerhq/ledger-wallet-provider").then((module) => {
      module.initializeLedgerProvider({
        target: container,
        dAppIdentifier: "ledger",
        apiKey: "1e55ba3959f4543af24809d9066a2120bd2ac9246e626e26a1ff77eb109ca0e5",
        loggerLevel: "info",
        environment: "production",
        walletTransactionFeatures: ["send", "receive", "swap", "buy", "earn", "sell"],
      });
    });
  }, []);

  return null;
}
