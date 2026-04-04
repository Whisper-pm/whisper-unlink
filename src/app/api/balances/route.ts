import { NextRequest, NextResponse } from "next/server";
import {
  createUnlink,
  unlinkAccount,
  unlinkEvm,
} from "@unlink-xyz/sdk";
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { CONFIG } from "@/lib/config";
import crypto from "crypto";

// Get real balances: on-chain USDC + Unlink pool
// Accepts either evmAddress (from wallet connect) or evmPrivateKey (legacy)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { evmAddress, evmPrivateKey } = body;

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });

  // Resolve address
  let address: `0x${string}`;
  if (evmAddress) {
    address = evmAddress as `0x${string}`;
  } else if (evmPrivateKey) {
    address = privateKeyToAccount(evmPrivateKey as `0x${string}`).address;
  } else {
    return NextResponse.json({ error: "Missing evmAddress or evmPrivateKey" }, { status: 400 });
  }

  try {
    // On-chain USDC
    const onChainBal = await publicClient.readContract({
      address: CONFIG.unlink.usdc,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [address],
    });

    // Unlink pool balance (derive from address)
    const seed = crypto.createHash("sha512").update("whisper:" + address).digest();
    const walletClient = createWalletClient({
      account: privateKeyToAccount(evmPrivateKey ?? "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`),
      chain: baseSepolia,
      transport: http(CONFIG.chains.baseSepolia.rpc),
    });
    const unlink = createUnlink({
      engineUrl: CONFIG.unlink.engineUrl,
      apiKey: CONFIG.unlink.apiKey,
      account: unlinkAccount.fromSeed({ seed: new Uint8Array(seed) }),
      evm: unlinkEvm.fromViem({ walletClient: walletClient as any, publicClient: publicClient as any }),
    });

    let poolAmount = "0";
    try {
      await unlink.ensureRegistered();
      const balances = await unlink.getBalances();
      const usdcPool = ((balances as any).balances ?? []).find(
        (b: any) => b.token?.toLowerCase() === CONFIG.unlink.usdc.toLowerCase()
      );
      poolAmount = usdcPool ? formatUnits(BigInt(usdcPool.amount), 6) : "0";
    } catch {
      // Unlink not set up for this address yet
    }

    // ETH
    const ethBal = await publicClient.getBalance({ address });

    return NextResponse.json({
      wallet: address,
      usdc: formatUnits(onChainBal, 6),
      eth: formatUnits(ethBal, 18),
      pool: poolAmount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
