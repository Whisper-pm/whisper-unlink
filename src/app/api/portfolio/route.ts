import { NextRequest, NextResponse } from "next/server";

// Get user's portfolio (bets, P&L, balances)
// Keyed by World ID nullifier (anonymous identity)
export async function GET(req: NextRequest) {
  const nullifier = req.nextUrl.searchParams.get("nullifier");

  if (!nullifier) {
    return NextResponse.json({ error: "Missing nullifier parameter" }, { status: 400 });
  }

  // In production: query database by nullifier
  // For demo: return empty portfolio
  return NextResponse.json({
    nullifier,
    bets: [],
    totalPnl: 0,
    poolBalance: "0",
    onChainBalance: "0",
  });
}
