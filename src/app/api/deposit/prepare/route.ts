import { NextRequest, NextResponse } from "next/server";
import { createUnlinkClient, getPermit2Nonce } from "@unlink-xyz/sdk";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { CONFIG } from "@/lib/config";
import crypto from "crypto";

// Step 1: Prepare deposit — returns typed data for the browser to sign
export async function POST(req: NextRequest) {
  const { amount, evmAddress } = await req.json();

  if (!amount || !evmAddress) {
    return NextResponse.json({ error: "Missing amount or evmAddress" }, { status: 400 });
  }

  try {
    const client = createUnlinkClient(CONFIG.unlink.engineUrl, CONFIG.unlink.apiKey);
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });

    // Derive Unlink address from wallet
    const seed = crypto.createHash("sha512").update("whisper:" + evmAddress).digest();
    const { unlinkAccount } = await import("@unlink-xyz/sdk");
    const account = unlinkAccount.fromSeed({ seed: new Uint8Array(seed) });
    const keys = await account.getAccountKeys();
    const unlinkAddress = keys.address;

    // Register user if needed
    try {
      const { createUser } = await import("@unlink-xyz/sdk");
      await createUser(client, keys as any);
    } catch {}

    // Get Permit2 nonce
    let nonce = "0";
    try {
      const n = await getPermit2Nonce(publicClient as any, evmAddress as `0x${string}`);
      nonce = n?.toString() ?? "0";
    } catch {}

    // Prepare deposit on engine
    const prepareResp = await fetch(`${CONFIG.unlink.engineUrl}/transactions/deposit/prepare`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.unlink.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        unlink_address: unlinkAddress,
        evm_address: evmAddress,
        token: CONFIG.unlink.usdc,
        amount,
        environment: "base-sepolia",
      }),
    });

    if (!prepareResp.ok) {
      return NextResponse.json({ error: "Prepare failed: " + (await prepareResp.text()).substring(0, 200) }, { status: 500 });
    }

    const prepData = await prepareResp.json() as any;
    const txId = prepData.data.tx_id;
    const notesHash = prepData.data.notes_hash;
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Build the typed data for the browser to sign
    const typedData = {
      domain: {
        name: "Permit2",
        chainId: 84532,
        verifyingContract: CONFIG.unlink.permit2,
      },
      types: {
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "witness", type: "DepositWitness" },
        ],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        DepositWitness: [{ name: "notesHash", type: "bytes32" }],
      },
      primaryType: "PermitWitnessTransferFrom" as const,
      message: {
        permitted: { token: CONFIG.unlink.usdc, amount },
        spender: CONFIG.unlink.pool,
        nonce,
        deadline: String(deadline),
        witness: { notesHash },
      },
    };

    return NextResponse.json({
      txId,
      typedData,
      nonce,
      deadline,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
