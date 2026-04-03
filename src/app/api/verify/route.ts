import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";

// World ID 4.0 verification endpoint
// Receives proof from IDKit widget → verifies via World cloud API → returns nullifier
export async function POST(req: NextRequest) {
  const body = await req.json();

  const rpId = CONFIG.worldId.rpId;
  if (!rpId) {
    return NextResponse.json({ success: false, error: "WORLD_RP_ID not configured" }, { status: 500 });
  }

  // Forward proof to World API for real verification
  const verifyRes = await fetch(`${CONFIG.worldId.verifyUrl}/${rpId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (verifyRes.ok) {
    const data = await verifyRes.json();
    return NextResponse.json({
      success: true,
      nullifier: data.nullifier ?? data.nullifier_hash,
      verified: true,
      protocol: "world-id-4.0",
    });
  }

  // Verification failed
  const error = await verifyRes.text();
  console.error("World ID verify:", verifyRes.status, error);
  return NextResponse.json({ success: false, error, status: verifyRes.status }, { status: 400 });
}
