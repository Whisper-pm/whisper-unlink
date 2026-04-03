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

// Get real balances: Unlink pool + on-chain wallet
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { evmPrivateKey } = body;

  if (!evmPrivateKey) {
    return NextResponse.json({ error: "Missing evmPrivateKey" }, { status: 400 });
  }

  try {
    const account = privateKeyToAccount(evmPrivateKey as `0x${string}`);
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });

    // On-chain USDC
    const onChainBal = await publicClient.readContract({
      address: CONFIG.unlink.usdc,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [account.address],
    });

    // Unlink pool balance
    const seed = crypto.createHash("sha512").update("whisper:" + account.address).digest();
    const unlink = createUnlink({
      engineUrl: CONFIG.unlink.engineUrl,
      apiKey: CONFIG.unlink.apiKey,
      account: unlinkAccount.fromSeed({ seed: new Uint8Array(seed) }),
      evm: unlinkEvm.fromViem({ walletClient: walletClient as any, publicClient: publicClient as any }),
    });

    await unlink.ensureRegistered();
    const balances = await unlink.getBalances();
    const usdcPool = ((balances as any).balances ?? []).find(
      (b: any) => b.token?.toLowerCase() === CONFIG.unlink.usdc.toLowerCase()
    );

    // ETH
    const ethBal = await publicClient.getBalance({ address: account.address });

    return NextResponse.json({
      wallet: account.address,
      usdc: formatUnits(onChainBal, 6),
      eth: formatUnits(ethBal, 18),
      pool: usdcPool ? formatUnits(BigInt(usdcPool.amount), 6) : "0",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
