"use client";

import { useState, useEffect, useCallback } from "react";

interface AgentStats {
  totalBets: number;
  totalVolume: number;
  winRate: number;
  pnl: number;
  todayVolume?: number;
}

interface AgentLimits {
  maxBetSize: number;
  maxDailyVolume: number;
  allowedMarkets?: string[] | "all";
}

interface AgentInfo {
  agentId: string;
  name: string;
  agentWallet: string;
  status: "active" | "paused" | "revoked";
  createdAt: number;
  stats: AgentStats;
  limits: AgentLimits;
}

interface Props {
  userAddress: string;
}

export function AgentDashboard({ userAddress }: Props) {
  const [myAgents, setMyAgents] = useState<AgentInfo[]>([]);
  const [leaderboard, setLeaderboard] = useState<AgentInfo[]>([]);
  const [view, setView] = useState<"my" | "leaderboard">("leaderboard");
  const [showRegister, setShowRegister] = useState(false);
  const [loading, setLoading] = useState(true);

  // Registration form state
  const [regName, setRegName] = useState("");
  const [regWallet, setRegWallet] = useState("");
  const [regMaxBet, setRegMaxBet] = useState("500");
  const [regMaxDaily, setRegMaxDaily] = useState("5000");
  const [regStatus, setRegStatus] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [myRes, allRes] = await Promise.all([
        fetch(`/api/agents/my?address=${encodeURIComponent(userAddress)}`),
        fetch("/api/agents"),
      ]);
      if (myRes.ok) {
        const data = await myRes.json();
        setMyAgents(data.agents ?? []);
      }
      if (allRes.ok) {
        const data = await allRes.json();
        setLeaderboard(data.agents ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handleRegister() {
    if (!regName.trim() || !regWallet.trim()) {
      setRegStatus("Name and wallet address are required");
      return;
    }
    setRegLoading(true);
    setRegStatus(null);
    try {
      const res = await fetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: userAddress,
          agentWallet: regWallet.trim(),
          name: regName.trim(),
          limits: {
            maxBetSize: Number(regMaxBet) || 500,
            maxDailyVolume: Number(regMaxDaily) || 5000,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRegStatus(null);
        setShowRegister(false);
        setRegName("");
        setRegWallet("");
        setRegMaxBet("500");
        setRegMaxDaily("5000");
        fetchData();
      } else {
        setRegStatus(data.error ?? "Registration failed");
      }
    } catch (e: any) {
      setRegStatus(e.message);
    } finally {
      setRegLoading(false);
    }
  }

  async function handleRevoke(agentId: string) {
    try {
      const res = await fetch(`/api/agents/${agentId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userAddress }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch {
      // silent
    }
  }

  function formatPnl(pnl: number): string {
    return (pnl >= 0 ? "+" : "") + pnl.toFixed(2);
  }

  function truncateAddr(addr: string): string {
    if (addr.length <= 13) return addr;
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "< 1h ago";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full" />
        <p className="text-sm text-gray-500">Loading agent data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setView("leaderboard")}
            className={`text-xs px-4 py-1.5 rounded-lg transition ${
              view === "leaderboard"
                ? "bg-white text-black font-semibold"
                : "bg-gray-900 text-gray-400 hover:text-white border border-gray-800"
            }`}
          >
            Leaderboard ({leaderboard.length})
          </button>
          <button
            onClick={() => setView("my")}
            className={`text-xs px-4 py-1.5 rounded-lg transition ${
              view === "my"
                ? "bg-white text-black font-semibold"
                : "bg-gray-900 text-gray-400 hover:text-white border border-gray-800"
            }`}
          >
            My Agents ({myAgents.filter((a) => a.status !== "revoked").length})
          </button>
        </div>
        <button
          onClick={() => { setShowRegister(!showRegister); setView("my"); }}
          className="text-xs px-4 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 transition font-semibold"
        >
          + Register Agent
        </button>
      </div>

      {/* Registration form */}
      {showRegister && (
        <div className="bg-gray-900 border border-blue-500/20 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Register New AI Agent</h3>
            <button onClick={() => setShowRegister(false)} className="text-gray-500 hover:text-white text-lg">&times;</button>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Authorize an AI agent to trade on your behalf. Your wallet address ensures accountability.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Agent Name</label>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="e.g. MyAlphaBot"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-gray-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Agent Wallet (EVM)</label>
              <input
                type="text"
                value={regWallet}
                onChange={(e) => setRegWallet(e.target.value)}
                placeholder="0x..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-gray-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Max Bet Size (USDC)</label>
              <input
                type="number"
                value={regMaxBet}
                onChange={(e) => setRegMaxBet(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-gray-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Max Daily Volume (USDC)</label>
              <input
                type="number"
                value={regMaxDaily}
                onChange={(e) => setRegMaxDaily(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-gray-500 outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRegister}
              disabled={regLoading}
              className="bg-blue-600/30 text-blue-400 border border-blue-500/30 px-6 py-2 rounded-lg text-sm font-semibold hover:bg-blue-600/40 transition disabled:opacity-40"
            >
              {regLoading ? "Registering..." : "Register Agent"}
            </button>
            {regStatus && <p className="text-xs text-red-400">{regStatus}</p>}
          </div>
          <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-600">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Agent is traceable to your wallet address. Max 5 agents per wallet.
          </div>
        </div>
      )}

      {/* Leaderboard view */}
      {view === "leaderboard" && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Agent Leaderboard</h3>
              <span className="text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/20 px-2 py-0.5 rounded-full font-semibold">
                Wallet-Backed
              </span>
            </div>
            <span className="text-xs text-gray-500">{leaderboard.length} active agents</span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-800/50">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Agent</div>
            <div className="col-span-2 text-right">Bets</div>
            <div className="col-span-2 text-right">Volume</div>
            <div className="col-span-2 text-right">Win Rate</div>
            <div className="col-span-2 text-right">P&L</div>
          </div>

          {leaderboard.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No active agents yet. Be the first to register one!
            </div>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {leaderboard.map((agent, i) => (
                <div
                  key={agent.agentId}
                  className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-gray-800/30 transition"
                >
                  {/* Rank */}
                  <div className="col-span-1">
                    <span className={`text-xs font-bold ${
                      i === 0 ? "text-yellow-400" : i === 1 ? "text-gray-300" : i === 2 ? "text-amber-600" : "text-gray-600"
                    }`}>
                      {i + 1}
                    </span>
                  </div>

                  {/* Agent name + wallet */}
                  <div className="col-span-3 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${
                        agent.stats.pnl > 0 ? "bg-green-500" : agent.stats.pnl < 0 ? "bg-red-500" : "bg-gray-500"
                      }`} />
                      <span className="text-sm text-white font-medium truncate">{agent.name}</span>
                    </div>
                    <div className="text-[10px] text-gray-600 font-mono mt-0.5">{truncateAddr(agent.agentWallet)}</div>
                  </div>

                  {/* Total bets */}
                  <div className="col-span-2 text-right">
                    <span className="text-xs text-white font-mono">{agent.stats.totalBets}</span>
                  </div>

                  {/* Volume */}
                  <div className="col-span-2 text-right">
                    <span className="text-xs text-gray-400 font-mono">
                      ${agent.stats.totalVolume >= 1000 ? (agent.stats.totalVolume / 1000).toFixed(1) + "K" : agent.stats.totalVolume}
                    </span>
                  </div>

                  {/* Win rate */}
                  <div className="col-span-2 text-right">
                    <span className={`text-xs font-mono font-semibold ${
                      agent.stats.winRate >= 60 ? "text-green-400" :
                      agent.stats.winRate >= 50 ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {agent.stats.winRate}%
                    </span>
                  </div>

                  {/* P&L */}
                  <div className="col-span-2 text-right">
                    <span className={`text-xs font-mono font-bold ${
                      agent.stats.pnl >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      {formatPnl(agent.stats.pnl)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-2.5 border-t border-gray-800 flex items-center gap-2 text-[10px] text-gray-600">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            Every agent is backed by a connected wallet — accountability without identity exposure
          </div>
        </div>
      )}

      {/* My Agents view */}
      {view === "my" && (
        <div className="space-y-4">
          {myAgents.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-800 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" />
                  <path d="M16 3l2 2-2 2" />
                </svg>
              </div>
              <p className="text-sm text-gray-400 mb-1">No agents registered yet</p>
              <p className="text-xs text-gray-600">
                Register an AI agent to trade on your behalf. Your identity stays private.
              </p>
            </div>
          ) : (
            myAgents.map((agent) => (
              <div
                key={agent.agentId}
                className={`bg-gray-900 border rounded-xl overflow-hidden ${
                  agent.status === "revoked" ? "border-gray-800/50 opacity-60" : "border-gray-800"
                }`}
              >
                {/* Agent header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${
                      agent.status === "active" ? "bg-green-500" :
                      agent.status === "paused" ? "bg-yellow-500" : "bg-gray-600"
                    }`} />
                    <span className="text-sm font-semibold text-white">{agent.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      agent.status === "active" ? "bg-green-500/10 text-green-400" :
                      agent.status === "paused" ? "bg-yellow-500/10 text-yellow-400" :
                      "bg-gray-800 text-gray-500"
                    }`}>
                      {agent.status}
                    </span>
                  </div>
                  {agent.status !== "revoked" && (
                    <button
                      onClick={() => handleRevoke(agent.agentId)}
                      className="text-[10px] px-3 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition font-medium"
                    >
                      Revoke
                    </button>
                  )}
                </div>

                {/* Agent details */}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] text-gray-500">Wallet</span>
                    <span className="text-xs font-mono text-gray-400">{truncateAddr(agent.agentWallet)}</span>
                    <span className="text-[10px] text-gray-600">|</span>
                    <span className="text-[10px] text-gray-500">Registered {timeAgo(agent.createdAt)}</span>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-gray-800/50 rounded-lg p-2.5">
                      <div className="text-[10px] text-gray-500 mb-1">Total Bets</div>
                      <div className="text-sm font-mono font-bold text-white">{agent.stats.totalBets}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-2.5">
                      <div className="text-[10px] text-gray-500 mb-1">Volume</div>
                      <div className="text-sm font-mono font-bold text-white">
                        ${agent.stats.totalVolume >= 1000 ? (agent.stats.totalVolume / 1000).toFixed(1) + "K" : agent.stats.totalVolume}
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-2.5">
                      <div className="text-[10px] text-gray-500 mb-1">Win Rate</div>
                      <div className={`text-sm font-mono font-bold ${
                        agent.stats.winRate >= 60 ? "text-green-400" :
                        agent.stats.winRate >= 50 ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {agent.stats.winRate}%
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-2.5">
                      <div className="text-[10px] text-gray-500 mb-1">P&L</div>
                      <div className={`text-sm font-mono font-bold ${
                        agent.stats.pnl >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {formatPnl(agent.stats.pnl)}
                      </div>
                    </div>
                  </div>

                  {/* Limits bar */}
                  <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500">
                    <span>Limits: {agent.limits.maxBetSize} USDC/bet</span>
                    <span className="text-gray-700">|</span>
                    <span>{agent.limits.maxDailyVolume} USDC/day</span>
                    {agent.stats.todayVolume !== undefined && (
                      <>
                        <span className="text-gray-700">|</span>
                        <span>Today: ${agent.stats.todayVolume} / ${agent.limits.maxDailyVolume}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
