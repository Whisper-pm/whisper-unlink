"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useEffect, useRef } from "react";

export function Header() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const ledgerButtonRef = useRef<HTMLDivElement>(null);

  // Mount Ledger Button next to Connect Wallet
  useEffect(() => {
    if (typeof window === "undefined" || !ledgerButtonRef.current) return;

    import("@ledgerhq/ledger-wallet-provider").then((module) => {
      const container = ledgerButtonRef.current;
      if (!container || container.childElementCount > 0) return;

      module.initializeLedgerProvider({
        target: container,
        floatingButtonPosition: undefined, // No floating — render inline in container
        dAppIdentifier: "whisper",
        apiKey: "1e55ba3959f4543af24809d9066a2120bd2ac9246e626e26a1ff77eb109ca0e5",
        loggerLevel: "info",
        environment: "production",
      });
    });
  }, []);

  return (
    <header className="border-b border-gray-800 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/Whisper.svg" alt="Whisper" className="h-6" />
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">Private Predictions</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span>Unlink</span>
            <span className="w-2 h-2 bg-blue-500 rounded-full ml-2" />
            <span>CCTP</span>
            <span className="w-2 h-2 bg-cyan-500 rounded-full ml-2" />
            <span>Polymarket</span>
          </div>

          {/* Ledger Button — inline, opens Bluetooth/USB modal */}
          <div ref={ledgerButtonRef} className="inline-flex" />

          {/* Reown Connect Wallet */}
          {isConnected ? (
            <button
              onClick={() => open()}
              className="bg-gray-800 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition"
            >
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </button>
          ) : (
            <button
              onClick={() => open()}
              className="bg-white text-black text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
