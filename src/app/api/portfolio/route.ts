import { NextRequest, NextResponse } from "next/server";
import { getUserPortfolio } from "@/lib/store";

// Get user's portfolio (bets, P&L)
// Keyed by wallet address
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Missing address parameter" }, { status: 400 });
  }

  const portfolio = getUserPortfolio(address);

  return NextResponse.json({
    address: portfolio.address,
    bets: portfolio.bets,
    totalPnl: portfolio.totalPnl,
  });
}
