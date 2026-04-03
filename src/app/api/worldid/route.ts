import { NextRequest, NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit";
import { CONFIG } from "@/lib/config";

// Generate a signed rp_context for World ID 4.0 proof requests.
// The frontend calls this before opening the IDKit widget.
export async function GET(req: NextRequest) {
  const signingKey = CONFIG.worldId.signingKey;
  const rpId = CONFIG.worldId.rpId;

  if (!signingKey || !rpId) {
    return NextResponse.json({ error: "World ID not configured" }, { status: 500 });
  }

  try {
    const rpContext = signRequest(CONFIG.worldId.action, signingKey);
    return NextResponse.json({
      rp_context: {
        ...rpContext,
        rp_id: rpId,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
