import { NextRequest, NextResponse } from "next/server";
import { getAgentsByHuman } from "@/lib/agent-store";

// GET /api/agents/my?address=... — Get agents authorized by this wallet
// This endpoint exposes full details including status for the owner
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 }
    );
  }

  const agents = getAgentsByHuman(address);

  return NextResponse.json({
    agents: agents.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      agentWallet: a.agentWallet,
      status: a.status,
      createdAt: a.createdAt,
      limits: a.limits,
      stats: a.stats,
    })),
    count: agents.length,
  });
}
