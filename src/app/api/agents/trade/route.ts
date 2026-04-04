import { NextRequest, NextResponse } from "next/server";
import {
  getAgent,
  validateAgentTrade,
  updateAgentStats,
} from "@/lib/agent-store";
import { addBet, updateBetStatus } from "@/lib/store";

// Hackathon demo: shared private key for the Unlink pool (same as frontend)
const DEMO_PK = "0x47b0a088fc62101d8aefc501edec2266ff2fc4cf84c93a8e6c315dedb0d942be";

// POST /api/agents/trade — Agent places a trade through the real pipeline
// Body: { agentId, conditionId, side, amount, marketQuestion?, agentSignature? }
// Header: x-agent-wallet: 0x...
export async function POST(req: NextRequest) {
  try {
    const agentWallet = req.headers.get("x-agent-wallet");
    const body = await req.json();
    const { agentId, conditionId, side, amount, marketQuestion } = body;

    // Validate required fields
    if (!agentId || !conditionId || !side || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: agentId, conditionId, side, amount" },
        { status: 400 }
      );
    }

    if (side !== "YES" && side !== "NO") {
      return NextResponse.json(
        { error: "Side must be 'YES' or 'NO'" },
        { status: 400 }
      );
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number (USDC)" },
        { status: 400 }
      );
    }

    // Get agent and verify wallet matches
    const agent = getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agentWallet && agentWallet.toLowerCase() !== agent.agentWallet) {
      return NextResponse.json(
        { error: "x-agent-wallet header does not match registered agent wallet" },
        { status: 403 }
      );
    }

    // Validate trade against agent limits
    const validationError = validateAgentTrade(agentId, conditionId, numAmount);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 403 });
    }

    // Record a pending bet in the main store (attributed to the agent's human)
    const bet = addBet(agent.humanAddress, {
      market: `[Agent: ${agent.name}] ${marketQuestion || conditionId}`,
      conditionId,
      side: side as "YES" | "NO",
      amount: numAmount,
      odds: "50%",
      status: "pending",
    });

    // Update agent stats for volume tracking (bet placed, outcome TBD)
    updateAgentStats(agentId, { betAmount: numAmount });

    // Determine the base URL for the internal API call
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = `${proto}://${host}`;

    // Fire the real pipeline in the background — don't block the response
    // The pipeline (Unlink -> burner -> CCTP -> Polymarket) takes 3-5 min
    const pipelineBody = {
      conditionId,
      side,
      amount: String(Math.floor(numAmount * 1e6)), // convert USDC to micro-units
      evmPrivateKey: DEMO_PK,
      userAddress: agent.humanAddress,
      marketQuestion: marketQuestion || `[Agent: ${agent.name}] ${conditionId}`,
      odds: "50%",
    };

    // Start pipeline — runs in background, updates bet when done
    (async () => {
      try {
        const pipelineRes = await fetch(`${baseUrl}/api/bet/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pipelineBody),
        });
        const pipelineData = await pipelineRes.json();

        if (pipelineData.success) {
          // Pipeline succeeded — update the bet with real data
          updateBetStatus(agent.humanAddress, bet.id, "active");
          updateAgentStats(agentId, { betAmount: 0, won: true, pnl: 0 });
        } else {
          // Pipeline failed
          updateBetStatus(agent.humanAddress, bet.id, "lost");
          updateAgentStats(agentId, { betAmount: 0, won: false, pnl: -numAmount });
        }
      } catch (err) {
        // Pipeline error — mark bet as lost
        updateBetStatus(agent.humanAddress, bet.id, "lost");
        updateAgentStats(agentId, { betAmount: 0, won: false, pnl: -numAmount });
      }
    })();

    return NextResponse.json({
      success: true,
      trade: {
        betId: bet.id,
        agentId: agent.agentId,
        agentName: agent.name,
        conditionId,
        side,
        amount: numAmount,
        status: "pending",
      },
      agent: {
        wallet: agent.agentWallet,
        humanBacked: true,
        remainingDailyVolume: agent.limits.maxDailyVolume - agent.stats.todayVolume,
      },
      pipeline: "REAL: Unlink -> Burner -> CCTP (Base->Polygon) -> Polymarket CTF (async)",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Invalid request body", detail: error.message },
      { status: 400 }
    );
  }
}
