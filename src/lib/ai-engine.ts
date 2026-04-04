// Whisper AI Engine — LLM-powered market analysis
// Uses Groq (free, fast) with Llama 3.3 70B, falls back to heuristics

import { analyzeMarket, type PolymarketData, type MarketAnalysis } from "./ai-scorer";

// ---------- Types ----------

export interface AIMarketInsight {
  thesis: string;
  confidence: number;
  recommendation: "STRONG_YES" | "LEAN_YES" | "NEUTRAL" | "LEAN_NO" | "STRONG_NO";
  catalysts: string[];
  risk_factors: string[];
  edge: string;
  score: number;
}

export interface EnrichedMarketAnalysis extends MarketAnalysis {
  thesis: string;
  confidence: number;
  aiRecommendation: "STRONG_YES" | "LEAN_YES" | "NEUTRAL" | "LEAN_NO" | "STRONG_NO";
  catalysts: string[];
  risk_factors: string[];
  edge: string;
  source: "claude" | "heuristic";
}

// ---------- Cache ----------

interface CacheEntry {
  results: Map<string, AIMarketInsight>;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

function getCachedInsights(marketIds: string[]): Map<string, AIMarketInsight> | null {
  if (!cache) return null;
  if (Date.now() - cache.timestamp > CACHE_TTL_MS) {
    cache = null;
    return null;
  }
  const allCached = marketIds.every((id) => cache!.results.has(id));
  if (!allCached) return null;

  const subset = new Map<string, AIMarketInsight>();
  for (const id of marketIds) {
    subset.set(id, cache!.results.get(id)!);
  }
  return subset;
}

function setCachedInsights(results: Map<string, AIMarketInsight>) {
  if (!cache) {
    cache = { results: new Map(), timestamp: Date.now() };
  }
  for (const [id, insight] of results) {
    cache.results.set(id, insight);
  }
  cache.timestamp = Date.now();
}

// ---------- LLM API (Groq / OpenAI-compatible) ----------

function getProvider(): { apiKey: string; baseUrl: string; model: string } | null {
  // Priority: Groq (free) > Anthropic > OpenAI
  if (process.env.GROQ_API_KEY) {
    return {
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
    };
  }
  if (process.env.MISTRAL_API_KEY) {
    return {
      apiKey: process.env.MISTRAL_API_KEY,
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-small-latest",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: "anthropic", // special case
      model: "claude-sonnet-4-20250514",
    };
  }
  return null;
}

function buildPrompt(markets: PolymarketData[]): string {
  const marketsJson = markets.map((m, i) => {
    let prices: number[] = [0.5, 0.5];
    try {
      prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices as any;
    } catch {}

    const msLeft = new Date(m.endDate).getTime() - Date.now();
    const daysLeft = Math.max(0, msLeft / 86_400_000);

    return {
      index: i,
      id: m.id || m.conditionId,
      question: m.question,
      yes_price: prices[0] ?? 0.5,
      no_price: prices[1] ?? 0.5,
      volume_24h: m.volume24hr ?? 0,
      total_volume: m.volume ?? 0,
      liquidity: m.liquidityNum ?? 0,
      spread: m.spread ?? 0,
      days_until_close: Math.round(daysLeft * 10) / 10,
    };
  });

  return `You are a quantitative prediction market analyst. Analyze these ${markets.length} Polymarket markets. For EACH market, provide sharp, specific analysis — not generic filler.

MARKETS:
${JSON.stringify(marketsJson, null, 2)}

For each market return a JSON object with:
- "id": market id (string)
- "thesis": 1-2 sentences, specific insight (reference real facts/events)
- "confidence": 0-100 your confidence in the analysis
- "recommendation": "STRONG_YES" | "LEAN_YES" | "NEUTRAL" | "LEAN_NO" | "STRONG_NO"
- "catalysts": array of 1-3 specific upcoming triggers
- "risk_factors": array of 1-3 risks
- "edge": 1 sentence on mispricing, or "No clear edge"
- "score": 0-100 trading attractiveness (liquidity, spread, time horizon, mispricing)

Respond with ONLY a JSON array. No markdown, no explanation. Exactly ${markets.length} objects.`;
}

async function callLLM(provider: { apiKey: string; baseUrl: string; model: string }, prompt: string): Promise<string> {
  if (provider.baseUrl === "anthropic") {
    // Use Anthropic API directly
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: provider.apiKey });
    const response = await client.messages.create({
      model: provider.model,
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  }

  // OpenAI-compatible API (Groq, Mistral, etc.)
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8192,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function parseResponse(text: string, marketIds: string[]): Map<string, AIMarketInsight> | null {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    // Fix common LLM JSON issues: trailing commas, unescaped newlines in strings
    cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
    cleaned = cleaned.replace(/\n/g, (match, offset) => {
      // Keep newlines between array/object elements, escape ones inside strings
      const before = cleaned.substring(Math.max(0, offset - 1), offset);
      if (before === '"') return "\\n";
      return match;
    });

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;

    const results = new Map<string, AIMarketInsight>();

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      const id = item.id || marketIds[i];
      if (!id) continue;

      results.set(id, {
        thesis: String(item.thesis ?? "No analysis available"),
        confidence: clamp(Number(item.confidence ?? 50), 0, 100),
        recommendation: validateRecommendation(item.recommendation),
        catalysts: Array.isArray(item.catalysts) ? item.catalysts.map(String).slice(0, 5) : [],
        risk_factors: Array.isArray(item.risk_factors) ? item.risk_factors.map(String).slice(0, 5) : [],
        edge: String(item.edge ?? "No clear edge"),
        score: clamp(Number(item.score ?? 50), 0, 100),
      });
    }

    return results.size > 0 ? results : null;
  } catch (e) {
    console.error("[AI Engine] Failed to parse LLM response:", e);
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function validateRecommendation(r: any): AIMarketInsight["recommendation"] {
  const valid = ["STRONG_YES", "LEAN_YES", "NEUTRAL", "LEAN_NO", "STRONG_NO"];
  if (typeof r === "string" && valid.includes(r)) return r as AIMarketInsight["recommendation"];
  return "NEUTRAL";
}

// ---------- Main API ----------

export async function analyzeMarketsWithAI(
  markets: PolymarketData[]
): Promise<Map<string, AIMarketInsight>> {
  if (markets.length === 0) return new Map();

  const marketIds = markets.map((m) => m.id || m.conditionId);

  const cached = getCachedInsights(marketIds);
  if (cached) {
    console.log(`[AI Engine] Cache hit for ${cached.size} markets`);
    return cached;
  }

  const provider = getProvider();
  if (!provider) {
    console.warn("[AI Engine] No API key set (GROQ_API_KEY, MISTRAL_API_KEY, or ANTHROPIC_API_KEY) — heuristic fallback");
    return buildHeuristicFallback(markets);
  }

  try {
    const prompt = buildPrompt(markets);
    console.log(`[AI Engine] Calling ${provider.model} to analyze ${markets.length} markets...`);
    const startTime = Date.now();

    const text = await callLLM(provider, prompt);

    const elapsed = Date.now() - startTime;
    console.log(`[AI Engine] ${provider.model} responded in ${elapsed}ms`);

    const results = parseResponse(text, marketIds);
    if (!results) {
      console.error("[AI Engine] Failed to parse response — falling back");
      return buildHeuristicFallback(markets);
    }

    // Fill missing markets with heuristic
    for (const m of markets) {
      const id = m.id || m.conditionId;
      if (!results.has(id)) {
        const h = analyzeMarket(m);
        results.set(id, {
          thesis: `Market at ${h.odds} with ${h.risk} risk. ${h.recommendation}.`,
          confidence: 30,
          recommendation: "NEUTRAL",
          catalysts: [],
          risk_factors: [],
          edge: "No AI analysis available",
          score: h.score,
        });
      }
    }

    setCachedInsights(results);
    console.log(`[AI Engine] Cached ${results.size} market analyses`);

    return results;
  } catch (error: any) {
    console.error("[AI Engine] LLM API error:", error.message ?? error);
    return buildHeuristicFallback(markets);
  }
}

function buildHeuristicFallback(markets: PolymarketData[]): Map<string, AIMarketInsight> {
  const results = new Map<string, AIMarketInsight>();

  for (const m of markets) {
    const id = m.id || m.conditionId;
    const h = analyzeMarket(m);

    let recommendation: AIMarketInsight["recommendation"] = "NEUTRAL";
    if (h.score >= 75) recommendation = "LEAN_YES";
    if (h.score >= 85) recommendation = "STRONG_YES";
    if (h.score <= 25) recommendation = "LEAN_NO";
    if (h.score <= 15) recommendation = "STRONG_NO";

    const yesOdds = parseInt(h.odds) / 100;
    const catalysts: string[] = [];
    if (h.timeLeft.includes("d") && parseInt(h.timeLeft) < 7) {
      catalysts.push(`Market closes in ${h.timeLeft} — imminent resolution`);
    }
    if (h.trend.includes("Hot")) {
      catalysts.push("High recent trading volume signals fresh information");
    }

    const riskFactors: string[] = [];
    if (h.risk === "HIGH") riskFactors.push("Low liquidity increases slippage risk");
    if (yesOdds > 0.9 || yesOdds < 0.1) riskFactors.push("Extreme odds — limited upside vs downside");

    results.set(id, {
      thesis: `Market at ${h.odds} with ${h.risk} risk. ${h.recommendation}. Volume: ${h.volume}, Liquidity: ${h.liquidity}.`,
      confidence: 25,
      recommendation,
      catalysts,
      risk_factors: riskFactors,
      edge: "Heuristic scoring only — no AI analysis available",
      score: h.score,
    });
  }

  return results;
}

export function mergeAnalysis(
  market: PolymarketData,
  insight: AIMarketInsight | undefined
): EnrichedMarketAnalysis {
  const heuristic = analyzeMarket(market);

  if (!insight) {
    return {
      ...heuristic,
      thesis: `${heuristic.recommendation}. Market at ${heuristic.odds}.`,
      confidence: 20,
      aiRecommendation: "NEUTRAL",
      catalysts: [],
      risk_factors: [],
      edge: "No analysis available",
      source: "heuristic",
    };
  }

  return {
    ...heuristic,
    score: Math.round(insight.score * 0.7 + heuristic.score * 0.3),
    recommendation: formatRecommendation(insight.recommendation, insight.confidence),
    thesis: insight.thesis,
    confidence: insight.confidence,
    aiRecommendation: insight.recommendation,
    catalysts: insight.catalysts,
    risk_factors: insight.risk_factors,
    edge: insight.edge,
    source: "claude",
  };
}

function formatRecommendation(rec: AIMarketInsight["recommendation"], confidence: number): string {
  const labels: Record<string, string> = {
    STRONG_YES: "Strong YES",
    LEAN_YES: "Lean YES",
    NEUTRAL: "Neutral",
    LEAN_NO: "Lean NO",
    STRONG_NO: "Strong NO",
  };
  return `${labels[rec] ?? "Neutral"} (${confidence}% conf)`;
}
