// AI Scoring — inline version for the frontend
// Same logic as @whisper/ai-engine but runs client-side

export interface MarketAnalysis {
  score: number;
  odds: string;
  ev: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  trend: string;
  volume: string;
  liquidity: string;
  timeLeft: string;
  recommendation: string;
  // AI-enriched fields (present when Claude analysis is available)
  thesis?: string;
  confidence?: number;
  aiRecommendation?: "STRONG_YES" | "LEAN_YES" | "NEUTRAL" | "LEAN_NO" | "STRONG_NO";
  catalysts?: string[];
  risk_factors?: string[];
  edge?: string;
  source?: "claude" | "heuristic";
}

export interface PolymarketData {
  id: string;
  question: string;
  conditionId: string;
  outcomePrices: string;
  volume24hr: number;
  volume: number;
  liquidityNum: number;
  spread: number;
  endDate: string;
  active: boolean;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
}

export interface MarketSentimentData {
  conditionId: string;
  yesCount: number;
  noCount: number;
  totalHumans: number;
  yesPercent: number;
}

export interface ScoredMarket {
  raw: PolymarketData;
  analysis: MarketAnalysis;
  sentiment?: MarketSentimentData | null;
}

function parsePrice(raw: any): number[] {
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return [0.5, 0.5]; }
  }
  if (Array.isArray(raw)) return raw.map(Number);
  return [0.5, 0.5];
}

function fmt(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function analyzeMarket(m: PolymarketData): MarketAnalysis {
  const prices = parsePrice(m.outcomePrices);
  const yesPrice = prices[0] ?? 0.5;
  const vol24 = Number(m.volume24hr ?? 0);
  const liq = Number(m.liquidityNum ?? 0);
  const spread = Number(m.spread ?? 0.1);

  const msLeft = new Date(m.endDate).getTime() - Date.now();
  const days = msLeft / 86_400_000;
  const timeLeft = days > 30 ? `${Math.floor(days / 30)}mo` : days > 1 ? `${Math.floor(days)}d` : days > 0 ? `${Math.floor(days * 24)}h` : "Closed";

  const evRaw = Math.abs(yesPrice - 0.5) * 2;
  const ev = yesPrice > 0.5 ? `+$${Math.floor(evRaw * 100)}` : `-$${Math.floor((1 - evRaw) * 50)}`;

  const risk: "LOW" | "MEDIUM" | "HIGH" = liq > 100_000 && spread < 0.05 ? "LOW" : liq > 10_000 ? "MEDIUM" : "HIGH";
  const trend = vol24 > 50_000 ? "🔥 Hot" : vol24 > 10_000 ? "↑ Active" : "Normal";

  let score = 0;
  score += Math.min(30, liq / 5_000);
  score += spread < 0.03 ? 25 : spread < 0.08 ? 20 : spread < 0.15 ? 10 : 0;
  score += Math.min(20, vol24 / 5_000);
  score += days > 1 && days < 14 ? 15 : days > 0.1 && days < 30 ? 10 : 0;
  score += yesPrice > 0.2 && yesPrice < 0.8 ? 10 : yesPrice > 0.1 && yesPrice < 0.9 ? 5 : 0;
  score = Math.round(Math.min(100, score));

  const recommendation = score > 70 ? "Strong opportunity" : score > 50 ? "Worth watching" : score > 30 ? "Low conviction" : "Avoid";

  return { score, odds: `${Math.round(yesPrice * 100)}%`, ev, risk, trend, volume: fmt(vol24), liquidity: fmt(liq), timeLeft, recommendation };
}

export async function fetchCuratedFeed(limit = 20): Promise<ScoredMarket[]> {
  // In browser: use our API route (avoids CORS). On server: call Polymarket directly.
  const isBrowser = typeof window !== "undefined";

  if (isBrowser) {
    const res = await fetch(`/api/markets?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch markets");
    const data = await res.json();
    return (data.markets ?? []).map((m: any) => ({
      raw: { ...m, volume24hr: 0, volume: 0, liquidityNum: 0, spread: 0, active: true } as PolymarketData,
      analysis: m.analysis as MarketAnalysis,
      sentiment: (m.sentiment ?? null) as MarketSentimentData | null,
    }));
  }

  const res = await fetch(`https://gamma-api.polymarket.com/markets?limit=200&active=true&closed=false`);
  if (!res.ok) throw new Error("Failed to fetch markets");
  const raw: PolymarketData[] = await res.json();

  return raw
    .filter((m) => m.question && m.conditionId && m.active)
    .map((m) => {
      // Ensure tokens array is populated from clobTokenIds if missing
      if ((!m.tokens || m.tokens.length === 0) && (m as any).clobTokenIds) {
        try {
          const ids = JSON.parse((m as any).clobTokenIds);
          m.tokens = ids.map((id: string, i: number) => ({ token_id: id, outcome: i === 0 ? "Yes" : "No", price: 0 }));
        } catch {}
      }
      return { raw: m, analysis: analyzeMarket(m) };
    })
    .sort((a, b) => b.analysis.score - a.analysis.score)
    .slice(0, limit);
}
