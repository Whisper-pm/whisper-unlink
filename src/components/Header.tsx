"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { LedgerConnect } from "./LedgerConnect";

export function Header() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();

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

          {/* Ledger direct connect — bypasses Reown, opens Bluetooth/USB */}
          <LedgerConnect />

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
