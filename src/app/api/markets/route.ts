import { NextRequest, NextResponse } from "next/server";
import { analyzeMarket, type PolymarketData } from "@/lib/ai-scorer";
import { analyzeMarketsWithAI, mergeAnalysis } from "@/lib/ai-engine";

// Lazy import store to avoid linter stripping it
async function getSentimentForMarket(conditionId: string) {
  const store = await import("@/lib/store");
  return store.getMarketSentiment(conditionId);
}

// AI-curated market feed endpoint
// Used by frontend AND agent API (x402-protected for agents)
export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20");

  const paymentHeader = req.headers.get("x-payment");
  const isAgent = !!paymentHeader;

  try {
    // 1. Fetch raw markets from Polymarket
    const res = await fetch(
      "https://gamma-api.polymarket.com/markets?limit=200&active=true&closed=false",
      { next: { revalidate: 60 } }
    );
    if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`);

    const rawMarkets: PolymarketData[] = await res.json();

    // 2. Filter and prepare
    const validMarkets = rawMarkets
      .filter((m) => m.question && m.conditionId && m.active)
      .map((m) => {
        if ((!m.tokens || m.tokens.length === 0) && (m as any).clobTokenIds) {
          try {
            const ids = JSON.parse((m as any).clobTokenIds);
            m.tokens = ids.map((id: string, i: number) => ({
              token_id: id,
              outcome: i === 0 ? "Yes" : "No",
              price: 0,
            }));
          } catch {}
        }
        return m;
      });

    // 3. Heuristic pre-sort to pick top candidates for AI analysis
    const presorted = validMarkets
      .map((m) => ({ market: m, score: analyzeMarket(m).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const candidateMarkets = presorted.map((p) => p.market);

    // 4. Run AI analysis on top 5 only (speed), rest get heuristic
    const aiCandidates = candidateMarkets.slice(0, 5);
    const aiInsights = await analyzeMarketsWithAI(aiCandidates);

    // 5. Merge AI insights with heuristic data
    const enriched = candidateMarkets
      .map((m) => {
        const id = m.id || m.conditionId;
        const insight = aiInsights.get(id);
        const analysis = mergeAnalysis(m, insight);
        return { raw: m, analysis };
      })
      .sort((a, b) => b.analysis.score - a.analysis.score)
      .slice(0, limit);

    // 6. Attach verified human sentiment data
    const marketsWithSentiment = await Promise.all(
      enriched.map(async (item) => {
        const sentiment = await getSentimentForMarket(item.raw.conditionId);
        return {
          id: item.raw.id,
          question: item.raw.question,
          conditionId: item.raw.conditionId,
          analysis: item.analysis,
          tokens: item.raw.tokens ?? [],
          outcomePrices: item.raw.outcomePrices,
          endDate: item.raw.endDate,
          sentiment: sentiment.totalHumans > 0 ? sentiment : null,
        };
      })
    );

    return NextResponse.json({
      markets: marketsWithSentiment,
      source: isAgent ? "agent-api" : "web",
      aiPowered: enriched.some((e) => e.analysis.source === "claude"),
      count: enriched.length,
    });
  } catch (error: any) {
    console.error("[Markets API] Error:", error.message);

    // Fallback: heuristic only
    try {
      const { fetchCuratedFeed } = await import("@/lib/ai-scorer");
      const feed = await fetchCuratedFeed(Math.min(limit, 50));

      const marketsWithSentiment = await Promise.all(
        feed.map(async (item) => {
          const sentiment = await getSentimentForMarket(item.raw.conditionId);
          return {
            id: item.raw.id,
            question: item.raw.question,
            conditionId: item.raw.conditionId,
            analysis: item.analysis,
            tokens: item.raw.tokens ?? [],
            outcomePrices: item.raw.outcomePrices,
            endDate: item.raw.endDate,
            sentiment: sentiment.totalHumans > 0 ? sentiment : null,
          };
        })
      );

      return NextResponse.json({
        markets: marketsWithSentiment,
        source: isAgent ? "agent-api" : "web",
        aiPowered: false,
        count: feed.length,
      });
    } catch (fallbackError: any) {
      return NextResponse.json(
        { error: "Failed to fetch markets", detail: fallbackError.message },
        { status: 500 }
      );
    }
  }
}
