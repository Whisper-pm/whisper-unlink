"use client";

import { useState } from "react";
import type { ScoredMarket } from "@/lib/ai-scorer";

interface Props {
  item: ScoredMarket;
  onBet: (market: ScoredMarket, side: "YES" | "NO") => void;
}

function riskColor(risk: string) {
  if (risk === "LOW") return "text-green-400";
  if (risk === "MEDIUM") return "text-yellow-400";
  return "text-red-400";
}

function riskBg(risk: string) {
  if (risk === "LOW") return "bg-green-500/10";
  if (risk === "MEDIUM") return "bg-yellow-500/10";
  return "bg-red-500/10";
}

function scoreGradient(score: number) {
  if (score >= 80) return "from-green-500 to-emerald-500";
  if (score >= 60) return "from-yellow-500 to-orange-500";
  return "from-gray-500 to-gray-600";
}

function recColor(rec: string | undefined) {
  if (!rec) return "text-gray-400";
  if (rec === "STRONG_YES") return "text-green-400";
  if (rec === "LEAN_YES") return "text-green-300";
  if (rec === "LEAN_NO") return "text-red-300";
  if (rec === "STRONG_NO") return "text-red-400";
  return "text-gray-400";
}

function recBg(rec: string | undefined) {
  if (!rec) return "bg-gray-800";
  if (rec?.includes("YES")) return "bg-green-500/10";
  if (rec?.includes("NO")) return "bg-red-500/10";
  return "bg-gray-800";
}

export function MarketCard({ item, onBet }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { raw, analysis } = item;
  const yesOdds = parseInt(analysis.odds) || 50;
  const noOdds = 100 - yesOdds;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition group">
      {/* Score bar at top */}
      <div className="h-1 w-full bg-gray-800">
        <div
          className={`h-full bg-gradient-to-r ${scoreGradient(analysis.score)} transition-all`}
          style={{ width: `${analysis.score}%` }}
        />
      </div>

      {/* Clickable area */}
      <div className="p-5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-medium text-white leading-snug flex-1 mr-3 group-hover:text-gray-100">
            {raw.question}
          </h3>
          <div className="flex flex-col items-end gap-1">
            <span className="text-lg font-bold font-mono text-white">{analysis.score}</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">score</span>
          </div>
        </div>

        {/* Odds bar */}
        <div className="flex h-2 rounded-full overflow-hidden mb-3 bg-gray-800">
          <div className="bg-green-500/60 transition-all" style={{ width: `${yesOdds}%` }} />
          <div className="bg-red-500/60 transition-all" style={{ width: `${noOdds}%` }} />
        </div>

        {/* Compact stats row */}
        <div className="flex items-center gap-3 text-[11px] text-gray-400 mb-3">
          <span className="font-mono">{analysis.odds}</span>
          <span className={riskColor(analysis.risk)}>{analysis.risk}</span>
          <span>{analysis.timeLeft}</span>
          <span>Vol {analysis.volume}</span>
          {analysis.aiRecommendation && (
            <span className={`ml-auto font-semibold ${recColor(analysis.aiRecommendation)}`}>
              {analysis.aiRecommendation.replace("_", " ")}
            </span>
          )}
        </div>

        {/* AI thesis preview (always show if available) */}
        {analysis.thesis && !analysis.thesis.startsWith("Market at") && (
          <div className="bg-blue-950/30 border border-blue-500/15 rounded-lg p-2.5 mb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">AI</span>
              {analysis.confidence != null && (
                <span className="text-[10px] text-gray-500 ml-auto">{analysis.confidence}% conf</span>
              )}
            </div>
            <p className="text-xs text-gray-300 leading-relaxed line-clamp-2">{analysis.thesis}</p>
          </div>
        )}

        {!expanded && (
          <p className="text-[10px] text-gray-600 text-center">Click to expand analysis</p>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-800 pt-4 space-y-3 animate-in fade-in duration-200">
          {/* Full stats grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Odds</span>
              <span className="text-white font-semibold font-mono">{analysis.odds}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">EV</span>
              <span className="text-white font-semibold font-mono">{analysis.ev}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Risk</span>
              <span className={`font-semibold ${riskColor(analysis.risk)}`}>{analysis.risk}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Closes</span>
              <span className="text-white font-semibold">{analysis.timeLeft}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Volume</span>
              <span className="text-white font-semibold">{analysis.volume}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Liquidity</span>
              <span className="text-white font-semibold">{analysis.liquidity}</span>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${riskBg(analysis.risk)} ${riskColor(analysis.risk)}`}>
              {analysis.risk} risk
            </span>
            {analysis.trend?.includes("Hot") && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400">
                {analysis.trend}
              </span>
            )}
            {analysis.source === "claude" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                AI Analyzed
              </span>
            )}
          </div>

          {/* AI recommendation */}
          {analysis.aiRecommendation && (
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-3 py-1 rounded-full font-semibold ${recBg(analysis.aiRecommendation)} ${recColor(analysis.aiRecommendation)}`}>
                {analysis.aiRecommendation.replace("_", " ")}
              </span>
            </div>
          )}

          {/* Edge */}
          {analysis.edge && !analysis.edge.includes("Heuristic") && analysis.edge !== "No clear edge" && (
            <div className="bg-yellow-950/20 border border-yellow-500/15 rounded-lg p-2.5">
              <span className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wider">Edge</span>
              <p className="text-xs text-yellow-200/80 mt-1">{analysis.edge}</p>
            </div>
          )}

          {/* Catalysts */}
          {analysis.catalysts && analysis.catalysts.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Catalysts</span>
              <ul className="mt-1 space-y-1">
                {analysis.catalysts.map((c, i) => (
                  <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                    <span className="text-blue-400 mt-0.5">-</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risk factors */}
          {analysis.risk_factors && analysis.risk_factors.length > 0 && (
            <div>
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Risk Factors</span>
              <ul className="mt-1 space-y-1">
                {analysis.risk_factors.map((r, i) => (
                  <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                    <span className="text-red-400 mt-0.5">-</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Bet buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={(e) => { e.stopPropagation(); onBet(item, "YES"); }}
              className="flex-1 bg-green-600/15 text-green-400 border border-green-600/20 rounded-lg py-2.5 text-sm font-semibold hover:bg-green-600/25 hover:border-green-500/40 transition active:scale-[0.98]"
            >
              YES {yesOdds}%
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onBet(item, "NO"); }}
              className="flex-1 bg-red-600/15 text-red-400 border border-red-600/20 rounded-lg py-2.5 text-sm font-semibold hover:bg-red-600/25 hover:border-red-500/40 transition active:scale-[0.98]"
            >
              NO {noOdds}%
            </button>
          </div>
        </div>
      )}

      {/* Collapsed bet buttons */}
      {!expanded && (
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={(e) => { e.stopPropagation(); onBet(item, "YES"); }}
            className="flex-1 bg-green-600/15 text-green-400 border border-green-600/20 rounded-lg py-2 text-sm font-semibold hover:bg-green-600/25 hover:border-green-500/40 transition active:scale-[0.98]"
          >
            YES {yesOdds}%
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onBet(item, "NO"); }}
            className="flex-1 bg-red-600/15 text-red-400 border border-red-600/20 rounded-lg py-2 text-sm font-semibold hover:bg-red-600/25 hover:border-red-500/40 transition active:scale-[0.98]"
          >
            NO {noOdds}%
          </button>
        </div>
      )}
    </div>
  );
}
