"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { useLedgerConnect } from "@/components/LedgerConnect";

export function Header() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { connect, address: ledgerAddress, isConnecting, isReady } = useLedgerConnect();

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

          {/* Ledger button */}
          <button
            onClick={connect}
            disabled={!isReady || isConnecting}
            className="flex items-center gap-2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed border border-gray-700"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 11.4V16H6.05V14.93H1.07V11.4H0ZM14.93 11.4V14.93H9.95V16H16V11.4H14.93ZM6.05 6.05H9.95V9.95H6.05V6.05ZM0 0V4.6H1.07V1.07H6.05V0H0ZM14.93 1.07V4.6H16V0H9.95V1.07H14.93Z" fill="currentColor"/>
            </svg>
            {isConnecting
              ? "Connecting..."
              : ledgerAddress
                ? `${ledgerAddress.slice(0, 6)}...${ledgerAddress.slice(-4)}`
                : "Ledger"}
          </button>

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
