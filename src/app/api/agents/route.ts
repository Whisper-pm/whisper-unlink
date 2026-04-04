import { NextResponse } from "next/server";
import { getAllAgents } from "@/lib/agent-store";

// GET /api/agents — Public agent leaderboard
// Returns all active agents ranked by P&L
// Does NOT expose which human is behind each agent (privacy)
export async function GET() {
  const agents = getAllAgents();

  return NextResponse.json({
    agents: agents.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      agentWallet: a.agentWallet,
      status: a.status,
      createdAt: a.createdAt,
      stats: {
        totalBets: a.stats.totalBets,
        totalVolume: a.stats.totalVolume,
        winRate: a.stats.winRate,
        pnl: a.stats.pnl,
      },
      limits: {
        maxBetSize: a.limits.maxBetSize,
        maxDailyVolume: a.limits.maxDailyVolume,
      },
      // humanAddress is intentionally NOT exposed
    })),
    count: agents.length,
  });
}
