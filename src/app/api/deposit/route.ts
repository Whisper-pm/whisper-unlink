import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";

// Deposit USDC into Unlink privacy pool
// In production: this triggers the real SDK flow server-side
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { amount, walletAddress } = body;

  if (!amount || !walletAddress) {
    return NextResponse.json({ error: "Missing amount or walletAddress" }, { status: 400 });
  }

  // In production: use Unlink SDK server-side
  // const client = await createServerClient({ evmPrivateKey, seed, apiKey });
  // await ensureApproval(client);
  // const result = await deposit(client, amount);

  return NextResponse.json({
    success: true,
    action: "deposit",
    amount,
    pool: CONFIG.unlink.pool,
    status: "queued",
    message: "USDC will be deposited into Unlink privacy pool on Base Sepolia",
  });
}
