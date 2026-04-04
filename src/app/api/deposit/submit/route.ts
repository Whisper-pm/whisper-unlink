import { NextRequest, NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";

// Step 3: Submit signed deposit to Unlink engine
export async function POST(req: NextRequest) {
  const { txId, signature, nonce, deadline } = await req.json();

  if (!txId || !signature) {
    return NextResponse.json({ error: "Missing txId or signature" }, { status: 400 });
  }

  try {
    const submitResp = await fetch(`${CONFIG.unlink.engineUrl}/transactions/deposit/${txId}/submit`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.unlink.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        permit2_signature: signature,
        permit2_nonce: nonce,
        permit2_deadline: deadline,
      }),
    });

    if (!submitResp.ok) {
      return NextResponse.json({ error: "Submit failed: " + (await submitResp.text()).substring(0, 200) }, { status: 500 });
    }

    const data = await submitResp.json() as any;
    return NextResponse.json({
      success: true,
      txId: data.data?.tx_id ?? txId,
      status: data.data?.status ?? "accepted",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
