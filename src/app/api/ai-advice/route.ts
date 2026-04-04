import { NextRequest, NextResponse } from "next/server";
import { getBets } from "@/lib/store";

// POST /api/ai-advice — Personalized AI advice based on user's betting history
// Uses wallet address as the user identifier
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { address, marketQuestion, marketAnalysis } = body;

  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  if (!marketQuestion) {
    return NextResponse.json({ error: "Missing marketQuestion" }, { status: 400 });
  }

  // Look up user's betting history
  const bets = getBets(address);

  // Compute stats from history
  const totalBets = bets.length;
  const wonBets = bets.filter((b) => b.status === "won").length;
  const lostBets = bets.filter((b) => b.status === "lost").length;
  const activeBets = bets.filter((b) => b.status === "active").length;
  const resolvedBets = wonBets + lostBets;
  const winRate = resolvedBets > 0 ? Math.round((wonBets / resolvedBets) * 100) : null;

  // Categorize bets by topic keywords
  const categories: Record<string, { won: number; lost: number; active: number; total: number }> = {};
  const topicKeywords: Record<string, string[]> = {
    crypto: ["bitcoin", "btc", "ethereum", "eth", "crypto", "defi", "token", "coin", "blockchain"],
    politics: ["president", "election", "congress", "senate", "vote", "trump", "biden", "political", "regulation"],
    sports: ["nba", "nfl", "mlb", "world cup", "champions", "super bowl", "game", "match", "team"],
    tech: ["ai", "apple", "google", "openai", "spacex", "tesla", "microsoft", "regulation"],
    finance: ["fed", "rate", "inflation", "gdp", "market cap", "stock", "interest", "recession"],
  };

  for (const bet of bets) {
    const q = bet.market.toLowerCase();
    let matched = false;
    for (const [category, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((kw) => q.includes(kw))) {
        if (!categories[category]) categories[category] = { won: 0, lost: 0, active: 0, total: 0 };
        categories[category].total++;
        if (bet.status === "won") categories[category].won++;
        if (bet.status === "lost") categories[category].lost++;
        if (bet.status === "active") categories[category].active++;
        matched = true;
      }
    }
    if (!matched) {
      if (!categories["other"]) categories["other"] = { won: 0, lost: 0, active: 0, total: 0 };
      categories["other"].total++;
      if (bet.status === "won") categories["other"].won++;
      if (bet.status === "lost") categories["other"].lost++;
      if (bet.status === "active") categories["other"].active++;
    }
  }

  // Determine risk profile from betting history
  const avgBetSize = totalBets > 0 ? bets.reduce((sum, b) => sum + b.amount, 0) / totalBets : 0;
  const maxBet = totalBets > 0 ? Math.max(...bets.map((b) => b.amount)) : 0;
  const totalExposure = bets.filter((b) => b.status === "active").reduce((sum, b) => sum + b.amount, 0);

  let riskProfile: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE" = "MODERATE";
  if (avgBetSize > 200 || maxBet > 500) riskProfile = "AGGRESSIVE";
  else if (avgBetSize < 50 && maxBet < 100) riskProfile = "CONSERVATIVE";

  // Determine which category this market falls into
  const marketQ = marketQuestion.toLowerCase();
  let marketCategory = "other";
  for (const [category, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => marketQ.includes(kw))) {
      marketCategory = category;
      break;
    }
  }

  const categoryStats = categories[marketCategory];
  const categoryWinRate = categoryStats && (categoryStats.won + categoryStats.lost) > 0
    ? Math.round((categoryStats.won / (categoryStats.won + categoryStats.lost)) * 100)
    : null;

  // Position sizing recommendation
  // Conservative: 1-2%, Moderate: 2-5%, Aggressive: 5-10%
  const portfolioValue = totalExposure + bets.filter((b) => b.status === "won").reduce((sum, b) => sum + (b.pnl ?? 0), 0) + 500; // assume $500 base for demo
  let suggestedPct = riskProfile === "CONSERVATIVE" ? 1.5 : riskProfile === "MODERATE" ? 3 : 7;

  // Adjust based on market risk from analysis
  const marketRisk = marketAnalysis?.risk;
  if (marketRisk === "HIGH") suggestedPct *= 0.6;
  if (marketRisk === "LOW") suggestedPct *= 1.2;

  const suggestedAmount = Math.round(portfolioValue * (suggestedPct / 100));

  // Risk alignment check
  const riskLabels: Record<string, string> = { LOW: "CONSERVATIVE", MEDIUM: "MODERATE", HIGH: "AGGRESSIVE" };
  const marketRiskProfile = riskLabels[marketRisk ?? "MEDIUM"] ?? "MODERATE";
  const riskAligned = marketRiskProfile === riskProfile;

  // Build the personalized AI advice using Claude if available
  let aiNarrative: string | null = null;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey && totalBets > 0) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `You are a personalized trading advisor for a prediction market app. Based on this anonymous user's betting history, give them ONE brief paragraph (2-3 sentences) of personalized advice about this specific market.

User stats (privacy-preserving, only pseudonymous data):
- Total bets: ${totalBets} (${wonBets} won, ${lostBets} lost, ${activeBets} active)
- Win rate: ${winRate !== null ? winRate + "%" : "no resolved bets yet"}
- Risk profile: ${riskProfile} (avg bet $${Math.round(avgBetSize)}, max bet $${maxBet})
- Category breakdown: ${JSON.stringify(categories)}
- Current exposure: $${totalExposure}

Market being considered: "${marketQuestion}"
Market category: ${marketCategory}
Category-specific win rate: ${categoryWinRate !== null ? categoryWinRate + "%" : "no history in this category"}
Market risk level: ${marketRisk ?? "MEDIUM"}
AI score: ${marketAnalysis?.score ?? "N/A"}

Be direct, reference their specific history. If they're good at this category, say so. If not, warn them. Keep it under 50 words. No platitudes.`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        aiNarrative = textBlock.text;
      }
    } catch (e: any) {
      console.error("[AI Advice] Claude API error:", e.message);
    }
  }

  return NextResponse.json({
    // Core stats
    totalBets,
    winRate,
    activeBets,
    totalExposure,
    riskProfile,

    // Category-specific
    marketCategory,
    categoryWinRate,
    categoryStats: categoryStats ?? null,

    // Position sizing
    suggestedAmount: Math.max(5, suggestedAmount),
    suggestedPct: Math.round(suggestedPct * 10) / 10,

    // Risk alignment
    riskAligned,
    marketRiskProfile,

    // AI narrative (if available)
    aiNarrative,
  });
}
