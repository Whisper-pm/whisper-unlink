import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agent-store";

// GET /api/agents/[agentId] — Get agent details + stats
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const agent = getAgent(agentId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({
    agentId: agent.agentId,
    name: agent.name,
    agentWallet: agent.agentWallet,
    status: agent.status,
    createdAt: agent.createdAt,
    limits: agent.limits,
    stats: {
      totalBets: agent.stats.totalBets,
      totalVolume: agent.stats.totalVolume,
      winRate: agent.stats.winRate,
      pnl: agent.stats.pnl,
    },
    // humanAddress NOT exposed in public endpoint
  });
}
