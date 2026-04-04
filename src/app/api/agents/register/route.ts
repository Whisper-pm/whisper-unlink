import { NextRequest, NextResponse } from "next/server";
import { registerAgent } from "@/lib/agent-store";
import { getBets } from "@/lib/store";

// POST /api/agents/register — Register a new AI agent
// Body: { address, agentWallet, name, limits? }
// The address must belong to a connected wallet with activity or a valid EVM address
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, agentWallet, name, limits } = body;

    if (!address) {
      return NextResponse.json(
        { error: "Missing address — wallet must be connected" },
        { status: 400 }
      );
    }

    if (!agentWallet || !name) {
      return NextResponse.json(
        { error: "Missing required fields: agentWallet, name" },
        { status: 400 }
      );
    }

    // Verify address is known (has activity or looks valid)
    const hasActivity = getBets(address).length > 0;
    const looksValid = address.startsWith("0x") && address.length === 42;

    if (!hasActivity && !looksValid) {
      return NextResponse.json(
        { error: "Address not recognized — connect your wallet first" },
        { status: 403 }
      );
    }

    const result = registerAgent({
      humanAddress: address,
      agentWallet,
      name,
      limits,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      agent: {
        agentId: result.agent.agentId,
        name: result.agent.name,
        agentWallet: result.agent.agentWallet,
        status: result.agent.status,
        limits: result.agent.limits,
        createdAt: result.agent.createdAt,
      },
      apiDocs: {
        trade: {
          method: "POST",
          url: "/api/agents/trade",
          headers: { "x-agent-wallet": agentWallet },
          body: {
            agentId: result.agent.agentId,
            conditionId: "string",
            side: "YES | NO",
            amount: "number (USDC)",
          },
        },
        markets: {
          method: "GET",
          url: "/api/markets",
          description: "Fetch AI-curated markets to trade",
        },
        leaderboard: {
          method: "GET",
          url: "/api/agents",
          description: "View agent leaderboard",
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Invalid request body", detail: error.message },
      { status: 400 }
    );
  }
}
