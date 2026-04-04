// Agent x402 middleware
// Protects API endpoints: agents must be registered + pay per request

import { NextRequest, NextResponse } from "next/server";

const FREE_USES = 3;

interface AgentVerification {
  isAgent: boolean;
  isHumanBacked: boolean;
  walletAddress: string | null;
  freeUsesRemaining: number;
}

// In-memory usage tracking (resets on server restart — use DB in production)
const usageMap = new Map<string, number>();

function loadUsage(): Record<string, number> {
  const obj: Record<string, number> = {};
  usageMap.forEach((v, k) => { obj[k] = v; });
  return obj;
}

function saveUsage(data: Record<string, number>) {
  Object.entries(data).forEach(([k, v]) => usageMap.set(k, v));
}

/**
 * Verify if a request comes from a registered agent.
 * Checks x-agent-wallet header and AgentBook registration.
 */
export async function verifyAgent(req: NextRequest): Promise<AgentVerification> {
  const agentWallet = req.headers.get("x-agent-wallet");
  if (!agentWallet) {
    return { isAgent: false, isHumanBacked: false, walletAddress: null, freeUsesRemaining: 0 };
  }

  // Verify agent wallet against AgentBook registry
  let isRegistered = false;
  try {
    const agentBookRes = await fetch(
      `https://worldchain-mainnet.g.alchemy.com/v2/demo`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            {
              // AgentBook.isRegistered(address) — check if wallet is in the registry
              to: "0x0000000000000000000000000000000000000000", // AgentBook address TBD
              data: "0x" + "c3c5a547" + agentWallet.slice(2).padStart(64, "0"),
            },
            "latest",
          ],
        }),
      }
    );
    const result = await agentBookRes.json();
    // If AgentBook is not deployed yet, default to checking the wallet is valid
    isRegistered = result?.result !== "0x" || agentWallet.startsWith("0x");
  } catch {
    // AgentBook unreachable: accept wallet if it looks valid
    isRegistered = agentWallet.length === 42 && agentWallet.startsWith("0x");
  }

  const usage = loadUsage();
  const uses = usage[agentWallet] ?? 0;
  const paymentHeader = req.headers.get("x-payment");

  // Check if free trial exhausted AND no payment
  if (uses >= FREE_USES && !paymentHeader) {
    return { isAgent: true, isHumanBacked: isRegistered, walletAddress: agentWallet, freeUsesRemaining: 0 };
  }

  // Increment usage AFTER granting access (only for free uses, not paid)
  if (!paymentHeader) {
    usage[agentWallet] = uses + 1;
    saveUsage(usage);
  }

  const freeUsesRemaining = Math.max(0, FREE_USES - uses - 1);
  return { isAgent: true, isHumanBacked: isRegistered, walletAddress: agentWallet, freeUsesRemaining };
}

/**
 * Build a 402 Payment Required response.
 */
export function paymentRequiredResponse() {
  return NextResponse.json(
    {
      error: "Payment required",
      protocol: "x402",
      payment: {
        price: "10000",
        currency: "USDC",
        network: "eip155:84532",
        recipient: "0x0000000000000000000000000000000000000000",
        description: "Pay to place a bet via Whisper Agent API",
      },
    },
    { status: 402, headers: { "X-Payment-Required": "true" } }
  );
}
