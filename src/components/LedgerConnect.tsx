"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Standalone Ledger connect button.
 * Bypasses Reown — opens the Ledger Button modal directly
 * with Bluetooth/USB connection options.
 */
export function LedgerConnect() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || initialized) return;

    import("@ledgerhq/ledger-wallet-provider").then((module) => {
      // Create a hidden container for the Ledger Button
      const target = document.createElement("div");
      target.id = "ledger-button-host";
      target.style.position = "fixed";
      target.style.bottom = "-9999px"; // hide the floating button
      target.style.left = "-9999px";
      document.body.appendChild(target);

      module.initializeLedgerProvider({
        target,
        floatingButtonPosition: "bottom-right",
        dAppIdentifier: "whisper",
        apiKey: "1e55ba3959f4543af24809d9066a2120bd2ac9246e626e26a1ff77eb109ca0e5",
        loggerLevel: "info",
        environment: "production",
      });

      setInitialized(true);
    });
  }, [initialized]);

  function handleClick() {
    // Find and click the Ledger floating button to open its native modal
    const ledgerBtn = document.querySelector(
      "#ledger-button-host ledger-button-toplevel"
    ) as HTMLElement | null;

    if (ledgerBtn?.shadowRoot) {
      const inner = ledgerBtn.shadowRoot.querySelector("button, [role='button'], .button") as HTMLElement;
      if (inner) { inner.click(); return; }
    }

    // Fallback: click the top-level element
    if (ledgerBtn) { ledgerBtn.click(); return; }

    // Last resort: find any ledger button in the DOM
    const anyLedger = document.querySelector("ledger-button-toplevel") as HTMLElement;
    if (anyLedger) { anyLedger.click(); return; }

    alert("Ledger Button not ready. Please wait a moment and try again.");
  }

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 bg-gray-800 border border-gray-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 hover:border-gray-600 transition cursor-pointer"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="4" y="1" width="8" height="3" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <circle cx="8" cy="8.5" r="1.5" fill="currentColor"/>
      </svg>
      Ledger
    </button>
  );
}
