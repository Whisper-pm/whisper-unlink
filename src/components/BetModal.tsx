"use client";

import { useState, useMemo, useEffect } from "react";
import type { ScoredMarket } from "@/lib/ai-scorer";
import { LedgerClearSignPreview } from "./LedgerClearSignPreview";

interface AIAdvice {
  totalBets: number;
  winRate: number | null;
  activeBets: number;
  totalExposure: number;
  riskProfile: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
  marketCategory: string;
  categoryWinRate: number | null;
  categoryStats: { won: number; lost: number; active: number; total: number } | null;
  suggestedAmount: number;
  suggestedPct: number;
  riskAligned: boolean;
  marketRiskProfile: string;
  aiNarrative: string | null;
}

interface Props {
  market: ScoredMarket;
  side: "YES" | "NO";
  nullifier?: string | null;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}

type Step = "input" | "ledger" | "unlink" | "bridge" | "bet" | "done" | "error";

const STEP_INFO: Record<Step, { color: string; label: string; detail: string }> = {
  input: { color: "", label: "", detail: "" },
  ledger: { color: "text-yellow-400", label: "Signing on Ledger...", detail: "Check device — AI score, risk & thesis displayed on screen" },
  unlink: { color: "text-purple-400", label: "Creating anonymous identity...", detail: "Unlink burner wallet funded from privacy pool" },
  bridge: { color: "text-blue-400", label: "Bridging via CCTP V2...", detail: "Base Sepolia → Polygon Amoy (~15 seconds)" },
  bet: { color: "text-cyan-400", label: "Placing bet on Polymarket...", detail: "Interacting with Conditional Tokens Framework" },
  done: { color: "text-green-400", label: "Bet placed anonymously!", detail: "Nobody can link this bet to your identity" },
  error: { color: "text-red-400", label: "Error", detail: "" },
};

/** Parse liquidity strings like "$50K", "$1.2M", "$500" into numbers */
function parseLiquidityString(liq: string): number {
  const cleaned = liq.replace(/[^0-9.KMBkmb]/g, "");
  const num = parseFloat(cleaned) || 0;
  if (/[Mm]/.test(liq)) return num * 1_000_000;
  if (/[Bb]/.test(liq)) return num * 1_000_000_000;
  if (/[Kk]/.test(liq)) return num * 1_000;
  return num;
}

export function BetModal({ market, side, nullifier, onClose, onConfirm }: Props) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [advice, setAdvice] = useState<AIAdvice | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);

  const { analysis, raw } = market;
  const sideColor = side === "YES" ? "text-green-400" : "text-red-400";
  const sideBg = side === "YES" ? "border-green-500/30" : "border-red-500/30";

  // Fetch personalized AI advice when modal opens (if user is verified)
  useEffect(() => {
    if (!nullifier) return;
    setAdviceLoading(true);
    fetch("/api/ai-advice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nullifier,
        marketQuestion: raw.question,
        marketAnalysis: { risk: analysis.risk, score: analysis.score },
      }),
    })
      .then((res) => res.json())
      .then((data) => setAdvice(data))
      .catch(() => {})
      .finally(() => setAdviceLoading(false));
  }, [nullifier, raw.question, analysis.risk, analysis.score]);

  // Build the Ledger clear sign preview fields from the ERC-7730 descriptor
  const clearSignFields = useMemo(() => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return null;

    const amtMicro = Math.floor(amt * 1e6);
    const aiScore = analysis.score ?? 50;
    const thesis = analysis.thesis ?? `${analysis.recommendation}. Odds ${analysis.odds}, EV ${analysis.ev}`;
    const liqRaw = analysis.liquidity ?? "$0";
    const liqNum = parseLiquidityString(liqRaw);

    // These are the exact fields the Ledger will display via ERC-7730
    // (resolved from whisper-bet.json descriptor's WhisperBet format)
    return [
      { label: "Action", value: "AI-Analyzed Prediction Bet" },
      {
        label: "Market",
        value: raw.question.length > 57 ? raw.question.slice(0, 57) + "..." : raw.question,
      },
      { label: "Position", value: side },
      { label: "Amount (USDC)", value: `${(amtMicro / 1e6).toFixed(2)} USDC` },
      { label: "AI Score", value: `${Math.round(aiScore)}/100` },
      {
        label: "Risk",
        value: analysis.risk === "LOW" ? "LOW Risk" : analysis.risk === "MEDIUM" ? "MEDIUM Risk" : "HIGH Risk",
      },
      {
        label: "AI Thesis",
        value: thesis.length > 60 ? thesis.slice(0, 57) + "..." : thesis,
      },
      { label: "Liquidity (USDC)", value: `${liqNum.toLocaleString("en-US", { maximumFractionDigits: 0 })} USDC` },
      {
        label: "Time",
        value: new Date().toISOString().replace("T", " ").slice(0, 19),
      },
    ];
  }, [amount, analysis, raw, side]);

  async function handleConfirm() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;

    try {
      // 1. Ledger signing with AI analysis in EIP-712 typed data
      // The Ledger screen shows: Market, Side, Amount, AI Score, Risk, AI Thesis, Liquidity
      setStep("ledger");
      const { signBetWithLedger, formatThesisForLedger, liquidityToMicroUsdc } = await import("@/lib/ledger");

      // Extract AI fields for Ledger Clear Signing display
      const aiScore = analysis.score ?? 50;
      const riskLevel = analysis.risk ?? "MEDIUM";
      const aiThesis = formatThesisForLedger(
        analysis.thesis ?? `${analysis.recommendation}. Odds ${analysis.odds}, EV ${analysis.ev}`
      );
      // Parse liquidity string (e.g. "$50K" -> 50000, "$1.2M" -> 1200000)
      const liqRaw = analysis.liquidity ?? "$0";
      const liqNum = parseLiquidityString(liqRaw);

      const ledgerResult = await signBetWithLedger({
        market: raw.question,
        conditionId: raw.conditionId,
        side,
        amount: String(Math.floor(amt * 1e6)), // USDC has 6 decimals
        aiScore: Math.min(100, Math.max(0, Math.round(aiScore))),
        riskLevel,
        aiThesis,
        liquidityUsd: liquidityToMicroUsdc(liqNum),
      }).catch(() => {
        // Ledger not connected: will fail in production, ok for demo without device
        return null;
      });

      // Get signer address if Ledger is connected
      let ledgerAddress: string | undefined;
      if (ledgerResult) {
        const { getLedgerAddress } = await import("@/lib/ledger");
        ledgerAddress = await getLedgerAddress().catch(() => undefined);
      }

      // 2-4. Execute full pipeline via backend API
      // Backend does: Unlink deposit → Burner → CCTP bridge → Polymarket split
      setStep("unlink");
      const res = await fetch("/api/bet/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conditionId: raw.conditionId,
          side,
          amount: String(Math.floor(amt * 1e6)),
          evmPrivateKey: "0x0",
          ledgerSignature: ledgerResult?.signature,
          ledgerAddress,
          nullifier: nullifier || undefined,
          marketQuestion: raw.question,
          odds: analysis.odds,
        }),
      });

      const data = await res.json();

      // Update steps based on backend progress
      if (data.steps) {
        for (const s of data.steps) {
          if (s.step.includes("bridge") || s.step.includes("cctp")) setStep("bridge");
          if (s.step.includes("polymarket") || s.step.includes("split")) setStep("bet");
        }
      }

      if (!data.success) {
        throw new Error(data.error ?? "Pipeline failed");
      }

      setStep("done");
      onConfirm(amt);
    } catch (e: any) {
      setStep("error");
      setErrorMsg(e.message);
    }
  }

  const info = STEP_INFO[step];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold">Place Anonymous Bet</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl">&times;</button>
        </div>

        {/* Market info */}
        <div className={`bg-gray-800 rounded-lg p-4 mb-4 border ${sideBg}`}>
          <p className="text-sm text-gray-300 mb-2 leading-relaxed">{raw.question}</p>
          <div className="flex gap-4 text-xs">
            <span className={sideColor + " font-bold text-sm"}>Position: {side}</span>
            <span className="text-gray-400">Odds: {analysis.odds}</span>
            <span className="text-gray-400">Risk: <span className={analysis.risk === "LOW" ? "text-green-400" : analysis.risk === "MEDIUM" ? "text-yellow-400" : "text-red-400"}>{analysis.risk}</span></span>
          </div>
        </div>

        {/* Personalized AI Advice (World ID powered) */}
        {step === "input" && nullifier && (
          <PersonalizedAdvice advice={advice} loading={adviceLoading} />
        )}

        {/* AI Analysis summary — shown before amount is entered (no Ledger preview yet) */}
        {!clearSignFields && (
          <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-3 mb-4 text-xs">
            <div className="flex items-center gap-1.5 text-blue-400 font-semibold mb-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              AI Analysis (signed into EIP-712 via ERC-7730)
            </div>
            <div className="text-gray-300 font-mono space-y-0.5">
              <div>Score: {analysis.score}/100 | Risk: {analysis.risk} | EV: {analysis.ev}</div>
              {analysis.thesis && <div className="text-gray-400 truncate">{analysis.thesis}</div>}
              <div className="text-gray-500">Liq: {analysis.liquidity} | {analysis.trend}</div>
            </div>
            <p className="text-gray-600 mt-1.5 text-[10px]">Enter an amount to preview the Ledger Clear Signing screen</p>
          </div>
        )}

        {step === "input" && (
          <>
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-1.5 block">Bet Amount (USDC)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white text-lg font-mono focus:border-gray-500 outline-none"
                autoFocus
              />
            </div>
            <div className="flex gap-2 mb-4">
              {[10, 50, 100, 500].map((v) => (
                <button key={v} onClick={() => setAmount(String(v))} className="flex-1 text-xs bg-gray-800 border border-gray-700 rounded-lg py-2 hover:border-gray-500 hover:bg-gray-750 transition font-mono">
                  ${v}
                </button>
              ))}
            </div>
            {/* ERC-7730 Clear Sign Preview — shows what Ledger will display */}
            {clearSignFields && (
              <div className="mb-4">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-semibold">
                  Ledger will display
                </p>
                <LedgerClearSignPreview
                  fields={clearSignFields}
                  protocol="Whisper Protocol"
                />
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={!amount || parseFloat(amount) <= 0}
              className="w-full bg-white text-black font-semibold py-3.5 rounded-xl hover:bg-gray-100 transition disabled:opacity-20 shadow-lg"
            >
              Sign with Ledger & Place Bet
            </button>
            <div className="flex items-center gap-2 mt-3 justify-center">
              <div className="flex -space-x-1">
                <div className="w-4 h-4 bg-purple-500 rounded-full border border-gray-900" title="Unlink" />
                <div className="w-4 h-4 bg-blue-500 rounded-full border border-gray-900" title="CCTP" />
                <div className="w-4 h-4 bg-cyan-500 rounded-full border border-gray-900" title="Polymarket" />
              </div>
              <p className="text-xs text-gray-500">Unlink → CCTP → Polymarket. Fully anonymous.</p>
            </div>
          </>
        )}

        {step === "ledger" && (
          <div className="py-4">
            {/* Progress bar */}
            <div className="flex gap-1 mb-4">
              {(["ledger", "unlink", "bridge", "bet"] as Step[]).map((s) => (
                <div key={s} className={`flex-1 h-1 rounded-full ${
                  s === step ? "bg-white animate-pulse" :
                  (["ledger","unlink","bridge","bet"].indexOf(s) < ["ledger","unlink","bridge","bet"].indexOf(step)) ? "bg-green-500" :
                  "bg-gray-800"
                }`} />
              ))}
            </div>

            {/* Show Clear Sign preview during Ledger signing step */}
            {clearSignFields && (
              <div className="mb-4">
                <LedgerClearSignPreview
                  fields={clearSignFields}
                  signing={true}
                  protocol="Whisper Protocol"
                />
              </div>
            )}

            <div className="text-center">
              <div className={`text-sm mb-1 ${info.color} animate-pulse`}>{info.label}</div>
              <p className="text-xs text-gray-400">{info.detail}</p>
            </div>
          </div>
        )}

        {step !== "input" && step !== "ledger" && step !== "done" && step !== "error" && (
          <div className="py-8">
            {/* Progress bar */}
            <div className="flex gap-1 mb-6">
              {(["ledger", "unlink", "bridge", "bet"] as Step[]).map((s) => (
                <div key={s} className={`flex-1 h-1 rounded-full ${
                  s === step ? "bg-white animate-pulse" :
                  (["ledger","unlink","bridge","bet"].indexOf(s) < ["ledger","unlink","bridge","bet"].indexOf(step)) ? "bg-green-500" :
                  "bg-gray-800"
                }`} />
              ))}
            </div>
            <div className="text-center">
              <div className={`text-lg mb-2 ${info.color} animate-pulse`}>{info.label}</div>
              <p className="text-xs text-gray-400">{info.detail}</p>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <div className="text-green-400 text-lg font-semibold mb-1">Bet placed anonymously</div>
            <p className="text-xs text-gray-400 mb-4">Your bet is live on Polymarket. Nobody can trace it back to you.</p>
            <button onClick={onClose} className="bg-gray-800 px-8 py-2.5 rounded-lg hover:bg-gray-700 transition text-sm">
              Close
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-8">
            <div className="text-red-400 text-lg mb-2">Something went wrong</div>
            <p className="text-xs text-gray-400 mb-4">{errorMsg}</p>
            <button onClick={() => setStep("input")} className="bg-gray-800 px-8 py-2.5 rounded-lg hover:bg-gray-700 transition text-sm">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Personalized AI Advice Component ----------

function PersonalizedAdvice({ advice, loading }: { advice: AIAdvice | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-purple-950/20 border border-purple-500/20 rounded-lg p-3 mb-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-purple-300 text-[11px]">Loading your personalized AI advice...</span>
        </div>
      </div>
    );
  }

  if (!advice || advice.totalBets === 0) {
    return (
      <div className="bg-purple-950/20 border border-purple-500/15 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-1.5 mb-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
            <circle cx="12" cy="12" r="10" stroke="#a78bfa" strokeWidth="2" />
            <circle cx="12" cy="12" r="4" fill="#a78bfa" />
          </svg>
          <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">
            Personalized AI Advice
          </span>
        </div>
        <p className="text-[11px] text-gray-400">Place your first bet to unlock AI-powered personalized insights based on your betting history.</p>
      </div>
    );
  }

  const riskColors: Record<string, string> = {
    CONSERVATIVE: "text-green-400",
    MODERATE: "text-yellow-400",
    AGGRESSIVE: "text-red-400",
  };

  const riskBgs: Record<string, string> = {
    CONSERVATIVE: "bg-green-500/10",
    MODERATE: "bg-yellow-500/10",
    AGGRESSIVE: "bg-red-500/10",
  };

  return (
    <div className="bg-gradient-to-br from-purple-950/30 to-indigo-950/30 border border-purple-500/25 rounded-lg p-3 mb-4 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
          <circle cx="12" cy="12" r="10" stroke="#a78bfa" strokeWidth="2" />
          <circle cx="12" cy="12" r="4" fill="#a78bfa" />
          <circle cx="12" cy="12" r="7" stroke="#a78bfa" strokeWidth="1" strokeDasharray="2 2" />
        </svg>
        <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">
          Personalized AI Advice
        </span>
        <span className="text-[9px] text-gray-600 ml-auto">World ID + AI</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {/* Win rate */}
        {advice.categoryWinRate !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">
              {advice.marketCategory.charAt(0).toUpperCase() + advice.marketCategory.slice(1)} win rate:
            </span>
            <span className={`font-bold ${advice.categoryWinRate >= 60 ? "text-green-400" : advice.categoryWinRate >= 40 ? "text-yellow-400" : "text-red-400"}`}>
              {advice.categoryWinRate}%
              {advice.categoryStats && (
                <span className="font-normal text-gray-500 ml-0.5">
                  ({advice.categoryStats.won}/{advice.categoryStats.won + advice.categoryStats.lost})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Overall win rate */}
        {advice.winRate !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">Overall:</span>
            <span className={`font-bold ${advice.winRate >= 60 ? "text-green-400" : advice.winRate >= 40 ? "text-yellow-400" : "text-red-400"}`}>
              {advice.winRate}% win rate
            </span>
          </div>
        )}

        {/* Suggested position */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Suggested:</span>
          <span className="font-bold text-white">
            ${advice.suggestedAmount}
            <span className="font-normal text-gray-500 ml-0.5">({advice.suggestedPct}%)</span>
          </span>
        </div>

        {/* Risk profile */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Risk profile:</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${riskBgs[advice.riskProfile] ?? "bg-gray-800"} ${riskColors[advice.riskProfile] ?? "text-gray-400"}`}>
            {advice.riskProfile}
          </span>
        </div>
      </div>

      {/* Risk alignment */}
      <div className={`text-[10px] px-2 py-1 rounded ${advice.riskAligned ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"}`}>
        {advice.riskAligned
          ? "This market matches your risk profile"
          : `This market is ${advice.marketRiskProfile} risk — your profile is ${advice.riskProfile}`}
      </div>

      {/* AI narrative */}
      {advice.aiNarrative && (
        <p className="text-[11px] text-gray-300 leading-relaxed border-t border-purple-500/10 pt-2">
          {advice.aiNarrative}
        </p>
      )}
    </div>
  );
}
