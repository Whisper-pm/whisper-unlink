import { NextRequest, NextResponse } from "next/server";
import { verifyAgent, paymentRequiredResponse } from "@/lib/agent-middleware";

// Agent API — place bets via x402 micropayments
// Only human-backed agents can use this
export async function POST(req: NextRequest) {
  // Verify agent identity + payment
  const agent = await verifyAgent(req);

  if (!agent.isAgent) {
    // No agent header — require x402 payment
    return paymentRequiredResponse();
  }

  if (agent.isAgent) {
    // Agent request — check human-backed + payment
    if (!agent.isHumanBacked) {
      return NextResponse.json(
        { error: "Agent not registered. Register via /api/agents/register" },
        { status: 403 }
      );
    }

    if (agent.freeUsesRemaining === 0) {
      // Check x402 payment
      const payment = req.headers.get("x-payment");
      if (!payment) {
        return paymentRequiredResponse();
      }
      // TODO: verify x402 payment signature + amount
    }
  }

  // Parse bet params
  const body = await req.json();
  const { conditionId, side, amount } = body;

  if (!conditionId || !side || !amount) {
    return NextResponse.json({ error: "Missing conditionId, side, or amount" }, { status: 400 });
  }

  // In production: orchestrate the full flow
  // 1. Unlink burner → fund
  // 2. CCTP bridge to Polygon
  // 3. Polymarket bet (CLOB or CTF)
  // 4. Return confirmation

  const betId = `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return NextResponse.json({
    success: true,
    betId,
    conditionId,
    side,
    amount,
    status: "queued",
    agent: agent.isAgent ? {
      wallet: agent.walletAddress,
      humanBacked: agent.isHumanBacked,
      freeUsesRemaining: agent.freeUsesRemaining,
    } : undefined,
    pipeline: "Unlink → CCTP (Base→Polygon) → Polymarket CTF",
  });
}
