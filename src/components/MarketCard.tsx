"use client";

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

export function MarketCard({ item, onBet }: Props) {
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

      <div className="p-5">
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
        <div className="flex h-2 rounded-full overflow-hidden mb-4 bg-gray-800">
          <div className="bg-green-500/60 transition-all" style={{ width: `${yesOdds}%` }} />
          <div className="bg-red-500/60 transition-all" style={{ width: `${noOdds}%` }} />
        </div>

        {/* AI Analysis grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4 text-xs">
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
        </div>

        {/* Meta tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${riskBg(analysis.risk)} ${riskColor(analysis.risk)}`}>
            {analysis.risk} risk
          </span>
          {analysis.trend.includes("Hot") && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400">
              {analysis.trend}
            </span>
          )}
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
            Vol {analysis.volume}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
            Liq {analysis.liquidity}
          </span>
        </div>

        {/* Bet buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onBet(item, "YES")}
            className="flex-1 bg-green-600/15 text-green-400 border border-green-600/20 rounded-lg py-2.5 text-sm font-semibold hover:bg-green-600/25 hover:border-green-500/40 transition active:scale-[0.98]"
          >
            YES {yesOdds}%
          </button>
          <button
            onClick={() => onBet(item, "NO")}
            className="flex-1 bg-red-600/15 text-red-400 border border-red-600/20 rounded-lg py-2.5 text-sm font-semibold hover:bg-red-600/25 hover:border-red-500/40 transition active:scale-[0.98]"
          >
            NO {noOdds}%
          </button>
        </div>
      </div>
    </div>
  );
}
