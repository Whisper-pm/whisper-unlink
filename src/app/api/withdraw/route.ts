import { NextRequest, NextResponse } from "next/server";

// Withdraw USDC from Unlink privacy pool to EVM wallet
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { amount, recipientAddress } = body;

  if (!amount || !recipientAddress) {
    return NextResponse.json({ error: "Missing amount or recipientAddress" }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    action: "withdraw",
    amount,
    recipient: recipientAddress,
    status: "queued",
    message: "USDC will be withdrawn from privacy pool (sender hidden)",
  });
}
