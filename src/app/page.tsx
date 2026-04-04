"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppKitAccount } from "@reown/appkit/react";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { Feed } from "@/components/Feed";
import { DepositPanel } from "@/components/DepositPanel";
import { Portfolio } from "@/components/Portfolio";
import { AgentDashboard } from "@/components/AgentDashboard";

function AppContent() {
  const { address, isConnected } = useAppKitAccount();
  const [tab, setTab] = useState<"feed" | "portfolio" | "agents">("feed");
  const [agentCount, setAgentCount] = useState(0);
  const [poolBalance, setPoolBalance] = useState("—");
  const [onChainBalance, setOnChainBalance] = useState("—");
  const [bets, setBets] = useState<Array<{ id: string; market: string; side: "YES" | "NO"; amount: number; odds: string; status: "active" | "won" | "lost" | "pending"; pnl?: number }>>([]);
  const [totalPnl, setTotalPnl] = useState(0);

  // Fetch portfolio
  const fetchPortfolio = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/portfolio?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.bets && data.bets.length > 0) {
          setBets(data.bets);
          setTotalPnl(data.totalPnl ?? 0);
        }
      }
    } catch {}
  }, [address]);

  // Fetch balances — only if wallet is connected
  const fetchBalances = useCallback(async () => {
    if (!isConnected || !address) return;
    try {
      const res = await fetch("/api/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evmAddress: address }),
      });
      if (res.ok) {
        const data = await res.json();
        setPoolBalance(data.pool);
        setOnChainBalance(data.usdc);
      }
    } catch {}
  }, [isConnected, address]);

  // Fetch agent count
  const fetchAgentCount = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/agents/my?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        const data = await res.json();
        setAgentCount(data.agents?.filter((a: { status: string }) => a.status !== "revoked").length ?? 0);
      }
    } catch {}
  }, [address]);

  // Load data when connected
  useEffect(() => {
    if (isConnected && address) {
      fetchPortfolio();
      fetchAgentCount();
      fetchBalances();
      const portfolioInterval = setInterval(fetchPortfolio, 10000);
      const agentInterval = setInterval(fetchAgentCount, 15000);
      const balanceInterval = setInterval(fetchBalances, 15000);
      return () => { clearInterval(portfolioInterval); clearInterval(agentInterval); clearInterval(balanceInterval); };
    }
  }, [isConnected, address, fetchPortfolio, fetchAgentCount, fetchBalances]);

  return (
    <>
      <Header />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {!isConnected || !address ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                  <rect x="2" y="6" width="20" height="12" rx="3" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M6 6V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold mb-3">Connect your wallet</h2>
              <p className="text-gray-400 max-w-md mx-auto leading-relaxed">
                Whisper uses your wallet address as your <strong className="text-white">anonymous account</strong>.
                Connect to start betting on AI-curated prediction markets.
              </p>
            </div>
            <div className="flex gap-6 mt-4 text-xs text-gray-600">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                Privacy by Unlink
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                CCTP Bridge
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full" />
                Polymarket
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <div className="lg:col-span-2">
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold">Whisper</h1>
                  <span className="text-xs bg-green-900/50 text-green-400 border border-green-500/30 px-2 py-0.5 rounded">
                    Connected
                  </span>
                  <span className="text-xs text-gray-600 font-mono">{address?.substring(0, 10)}...{address?.slice(-4)}</span>
                </div>
                <p className="text-sm text-gray-500">
                  AI-curated predictions. Private bets. Hardware-signed.
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setTab("feed")}
                    className={`text-sm px-4 py-1.5 rounded-lg ${tab === "feed" ? "bg-white text-black font-semibold" : "bg-gray-900 text-gray-400 hover:text-white"}`}
                  >
                    AI Feed
                  </button>
                  <button
                    onClick={() => setTab("portfolio")}
                    className={`text-sm px-4 py-1.5 rounded-lg ${tab === "portfolio" ? "bg-white text-black font-semibold" : "bg-gray-900 text-gray-400 hover:text-white"}`}
                  >
                    Portfolio ({bets.length})
                  </button>
                  <button
                    onClick={() => setTab("agents")}
                    className={`text-sm px-4 py-1.5 rounded-lg ${tab === "agents" ? "bg-white text-black font-semibold" : "bg-gray-900 text-gray-400 hover:text-white"}`}
                  >
                    Agents ({agentCount})
                  </button>
                </div>
              </div>
              <DepositPanel
                poolBalance={isConnected ? poolBalance : "Connect wallet"}
                onChainBalance={isConnected ? onChainBalance : "Connect wallet"}
                onDeposit={async (amt) => {
                  if (!isConnected) throw new Error("Connect wallet first");
                  const res = await fetch("/api/deposit", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amount: String(Math.floor(amt * 1e6)), evmAddress: address }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    setPoolBalance(data.poolBalance);
                    setOnChainBalance(data.walletBalance);
                  } else {
                    throw new Error(data.error);
                  }
                }}
                onWithdraw={async (amt) => {
                  if (!isConnected) throw new Error("Connect wallet first");
                  const res = await fetch("/api/withdraw", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amount: String(Math.floor(amt * 1e6)), evmAddress: address }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    setPoolBalance(data.poolBalance);
                    setOnChainBalance(data.walletBalance);
                  } else {
                    throw new Error(data.error);
                  }
                }}
              />
            </div>

            {tab === "feed" ? (
              <Feed userAddress={address} onBetPlaced={(market, side, amount) => {
                setBets((prev) => [
                  ...prev,
                  { id: "bet-" + Date.now(), market: market.substring(0, 60), side, amount, odds: "50%", status: "active" as const },
                ]);
                fetchPortfolio();
                fetchBalances();
              }} />
            ) : tab === "portfolio" ? (
              <Portfolio bets={bets} totalPnl={totalPnl} />
            ) : (
              <AgentDashboard userAddress={address} />
            )}
          </>
        )}
      </main>
      <footer className="border-t border-gray-800 px-6 py-4 text-center text-xs text-gray-600">
        Whisper &mdash; Privacy by Unlink | Signed by Ledger | AI-Curated Feed
      </footer>
    </>
  );
}

export default function Home() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
}
