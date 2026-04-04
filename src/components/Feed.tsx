"use client";

import { useEffect, useState, useMemo } from "react";
import { fetchCuratedFeed, type ScoredMarket } from "@/lib/ai-scorer";
import { MarketCard } from "./MarketCard";
import { BetModal } from "./BetModal";
import { SearchFilter } from "./SearchFilter";

interface FeedProps {
  userAddress?: string | null;
  onBetPlaced?: (market: string, side: "YES" | "NO", amount: number) => void;
}

export function Feed({ userAddress, onBetPlaced }: FeedProps = {}) {
  const [markets, setMarkets] = useState<ScoredMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [betTarget, setBetTarget] = useState<{ market: ScoredMarket; side: "YES" | "NO" } | null>(null);

  // Search & filter state
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [sortBy, setSortBy] = useState("score");

  useEffect(() => {
    fetchCuratedFeed(50)
      .then(setMarkets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // Refresh every 30s
    const interval = setInterval(() => {
      fetchCuratedFeed(50).then(setMarkets).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Filtered + sorted markets
  const filtered = useMemo(() => {
    let result = markets;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((m) => m.raw.question.toLowerCase().includes(q));
    }

    if (riskFilter !== "all") {
      result = result.filter((m) => m.analysis.risk === riskFilter);
    }

    if (sortBy === "volume") {
      result = [...result].sort((a, b) => (b.raw.volume24hr ?? 0) - (a.raw.volume24hr ?? 0));
    } else if (sortBy === "time") {
      result = [...result].sort((a, b) => new Date(a.raw.endDate).getTime() - new Date(b.raw.endDate).getTime());
    } else if (sortBy === "odds") {
      result = [...result].sort((a, b) => {
        const aOdds = Math.abs(0.5 - (parseFloat(a.analysis.odds) / 100));
        const bOdds = Math.abs(0.5 - (parseFloat(b.analysis.odds) / 100));
        return aOdds - bOdds; // Closest to 50/50 first
      });
    }
    // default: already sorted by score

    return result;
  }, [markets, search, riskFilter, sortBy]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full" />
        <p className="text-sm text-gray-500">Loading AI-curated markets...</p>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 text-center py-10">Error loading markets: {error}</div>;
  }

  return (
    <>
      <SearchFilter
        search={search}
        onSearchChange={setSearch}
        riskFilter={riskFilter}
        onRiskChange={setRiskFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />

      <div className="text-xs text-gray-600 mb-3">
        {filtered.length} markets | Auto-refreshes every 30s | Sorted by {sortBy}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => (
          <MarketCard key={item.raw.conditionId ?? item.raw.id} item={item} onBet={setBetTarget ? (m, s) => setBetTarget({ market: m, side: s }) : () => {}} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-gray-500 py-10">No markets match your filters.</p>
      )}

      {betTarget && (
        <BetModal
          market={betTarget.market}
          side={betTarget.side}
          userAddress={userAddress}
          onClose={() => setBetTarget(null)}
          onConfirm={(amount) => {
            onBetPlaced?.(betTarget.market.raw.question, betTarget.side, amount);
            setBetTarget(null);
          }}
        />
      )}
    </>
  );
}
