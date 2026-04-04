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
      module.initializeLedgerProvider({
        target: document.body,
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
    // Find the Ledger floating button anywhere in the DOM and click it
    const selectors = [
      "ledger-button-toplevel",
      "[data-testid='ledger-button']",
      ".ledger-button",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) {
        // Try shadow DOM first
        if (el.shadowRoot) {
          const btn = el.shadowRoot.querySelector("button") as HTMLElement;
          if (btn) { btn.click(); return; }
        }
        el.click();
        return;
      }
    }

    // Fallback: dispatch EIP-6963 request to trigger wallet announcement
    window.dispatchEvent(
      new CustomEvent("eip6963:requestProvider", { bubbles: true })
    );

    // Try again after a tick
    setTimeout(() => {
      const el = document.querySelector("ledger-button-toplevel") as HTMLElement;
      if (el) {
        if (el.shadowRoot) {
          const btn = el.shadowRoot.querySelector("button") as HTMLElement;
          if (btn) { btn.click(); return; }
        }
        el.click();
      }
    }, 500);
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
