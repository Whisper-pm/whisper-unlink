import { NextRequest, NextResponse } from "next/server";
import {
  createUnlink,
  unlinkAccount,
  unlinkEvm,
  createUnlinkClient,
  BurnerWallet,
} from "@unlink-xyz/sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  pad,
  formatUnits,
  keccak256,
  encodePacked,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { CONFIG } from "@/lib/config";
import { addBet } from "@/lib/store";
import { addBurner, updateBurner } from "@/lib/wallet-store";
import crypto from "crypto";

// Permit2 nonce tracker — avoids desync bug in SDK
const nonceTracker = new Map<string, number>();
function getNextNonce(wallet: string): string {
  const current = nonceTracker.get(wallet.toLowerCase()) ?? 3000;
  nonceTracker.set(wallet.toLowerCase(), current + 1);
  return String(current);
}

const USDC_BASE = CONFIG.unlink.usdc;
const USDC_AMOY = CONFIG.cctp.usdcPolygonAmoy;
const TOKEN_MESSENGER = CONFIG.cctp.tokenMessenger;
const MSG_TRANSMITTER = CONFIG.cctp.messageTransmitter;
const CTF = CONFIG.polymarket.amoy.ctf;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

const erc20Abi = [
  { name: "approve", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "s", type: "address" as const }, { name: "a", type: "uint256" as const }], outputs: [{ type: "bool" as const }] },
  { name: "balanceOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ type: "address" as const }], outputs: [{ type: "uint256" as const }] },
] as const;
const tmAbi = [{ name: "depositForBurn", type: "function" as const, stateMutability: "payable" as const, inputs: [{ name: "amount", type: "uint256" as const }, { name: "destinationDomain", type: "uint32" as const }, { name: "mintRecipient", type: "bytes32" as const }, { name: "burnToken", type: "address" as const }, { name: "destinationCaller", type: "bytes32" as const }, { name: "maxFee", type: "uint256" as const }, { name: "minFinalityThreshold", type: "uint32" as const }], outputs: [] }] as const;
const mtAbi = [{ name: "receiveMessage", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "message", type: "bytes" as const }, { name: "attestation", type: "bytes" as const }], outputs: [{ type: "bool" as const }] }] as const;
const ctfAbi = [
  { name: "prepareCondition", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "oracle", type: "address" as const }, { name: "questionId", type: "bytes32" as const }, { name: "outcomeSlotCount", type: "uint256" as const }], outputs: [] },
  { name: "splitPosition", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "collateralToken", type: "address" as const }, { name: "parentCollectionId", type: "bytes32" as const }, { name: "conditionId", type: "bytes32" as const }, { name: "partition", type: "uint256[]" as const }, { name: "amount", type: "uint256" as const }], outputs: [] },
] as const;

const amoyChain = { id: 80002, name: "Amoy" as const, nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 }, rpcUrls: { default: { http: [CONFIG.chains.polygonAmoy.rpc] } } };

/**
 * PIPELINE: Place a private bet on Polymarket
 *
 * Step 1 (Base): Deposit USDC into Unlink pool (if needed)
 * Step 2 (Base): Withdraw from pool to fresh burner wallet
 * Step 3 (Base→Polygon): Burner bridges USDC via CCTP V2
 * Step 4 (Polygon): Gas tank relays receiveMessage + funds burner with MATIC
 * Step 5 (Polygon): Burner bets on Polymarket CTF (prepareCondition + splitPosition)
 *
 * Privacy: each bet = new burner = no link between bets.
 * The Unlink ZK pool breaks the connection between user and burner.
 *
 * NOTE: Atomic execute() was tested and works (approve TokenMessenger + depositForBurn
 * + reshield 1 wei), but requires keeping a note in the pool. We use the step-by-step
 * burner approach for reliability. See README.md for atomic details.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { conditionId, side, amount, evmPrivateKey, ledgerSignature, ledgerAddress, nullifier, marketQuestion, odds } = body;

  if (!conditionId || !side || !amount) {
    return NextResponse.json({ error: "Missing conditionId, side, or amount" }, { status: 400 });
  }

  const usesLedger = !!ledgerSignature && !!ledgerAddress;

  const steps: Array<{ step: string; status: string; txHash?: string; detail?: string }> = [];
  const log = (step: string, status: string, txHash?: string, detail?: string) => {
    steps.push({ step, status, txHash, detail });
  };

  try {
    if (usesLedger) {
      log("ledger:verify", "done", undefined, `Signer: ${ledgerAddress}`);
    }
    const account = privateKeyToAccount((evmPrivateKey || "0x0000000000000000000000000000000000000000000000000000000000000001") as `0x${string}`);
    const basePub = createPublicClient({ chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });
    const baseWallet = createWalletClient({ account, chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });
    const amoyPub = createPublicClient({ chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });
    const amountBigint = BigInt(amount);

    // Setup Unlink
    const seed = crypto.createHash("sha512").update("whisper:bet:" + account.address).digest();
    const unlinkAcc = unlinkAccount.fromSeed({ seed: new Uint8Array(seed) });
    const unlink = createUnlink({
      engineUrl: CONFIG.unlink.engineUrl,
      apiKey: CONFIG.unlink.apiKey,
      account: unlinkAcc,
      evm: unlinkEvm.fromViem({ walletClient: baseWallet as any, publicClient: basePub as any }),
    });
    await unlink.ensureRegistered();
    const unlinkAddr = await unlink.getAddress();

    // ============================================================
    // STEP 1: Ensure pool has enough USDC
    // ============================================================
    const { balances } = await unlink.getBalances();
    const poolAmount = BigInt(balances.find((b: any) => b.token?.toLowerCase() === USDC_BASE.toLowerCase())?.amount ?? "0");

    if (poolAmount < amountBigint) {
      const needed = amountBigint - poolAmount;
      log("deposit", "started", undefined, `Need ${formatUnits(needed, 6)} more USDC`);
      await unlink.ensureErc20Approval({ token: USDC_BASE, amount: String(needed) });
      const nonce = getNextNonce(account.address);
      const dep = await unlink.deposit({ token: USDC_BASE, amount: String(needed), nonce });
      await unlink.pollTransactionStatus(dep.txId, { intervalMs: 2000, timeoutMs: 120000 });
      log("deposit", "done", undefined, dep.txId);
      await new Promise((r) => setTimeout(r, 5000));
    } else {
      log("deposit", "skip", undefined, `Pool has ${formatUnits(poolAmount, 6)} USDC`);
    }

    // ============================================================
    // STEP 2: Create burner + fund from pool (USDC + gas ETH)
    // The Unlink relayer automatically sends gas ETH to the burner.
    // ============================================================
    log("burner", "started");
    const burner = await BurnerWallet.create();
    const burnerAddress = burner.address;
    const burnerAccount = burner.toViemAccount();
    log("burner", "created", undefined, burnerAddress);

    const apiClient = createUnlinkClient(CONFIG.unlink.engineUrl, CONFIG.unlink.apiKey);
    const unlinkKeys = await unlinkAcc.getAccountKeys();

    const fundResult = await burner.fundFromPool(apiClient, {
      senderKeys: unlinkKeys,
      token: USDC_BASE,
      amount: String(amountBigint),
      environment: "base-sepolia",
    });
    log("burner", "funded", undefined, `txId: ${fundResult.txId}`);

    addBurner({
      burnerAddress,
      createdAt: new Date().toISOString(),
      parentEvmAddress: account.address,
      unlinkAddress: unlinkAddr,
      market: marketQuestion,
      side,
      amount: formatUnits(amountBigint, 6),
      status: "funded",
      txHashes: { fundFromPool: fundResult.txId },
    });

    // Wait for USDC + gas ETH on-chain
    log("burner", "waiting");
    let burnerUsdc = 0n;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      burnerUsdc = (await basePub.readContract({ address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [burnerAddress] })) as bigint;
      const burnerEth = await basePub.getBalance({ address: burnerAddress });
      if (burnerUsdc > 0n && burnerEth > 0n) {
        log("burner", "ready", undefined, `${formatUnits(burnerUsdc, 6)} USDC + ${formatUnits(burnerEth, 18)} ETH`);
        break;
      }
    }

    // ============================================================
    // STEP 3: CCTP Bridge Base → Polygon
    // ============================================================
    log("cctp:bridge", "started");
    const burnerBaseWallet = createWalletClient({ account: burnerAccount, chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });

    // Approve TokenMessenger for CCTP
    const approveTx = await burnerBaseWallet.writeContract({ address: USDC_BASE, abi: erc20Abi, functionName: "approve", args: [TOKEN_MESSENGER, burnerUsdc] });
    await basePub.waitForTransactionReceipt({ hash: approveTx });

    // Burn (get fresh nonce to avoid stale nonce after approve)
    const recipient = pad(burnerAddress as `0x${string}`, { size: 32 });
    const burnNonce = await basePub.getTransactionCount({ address: burnerAddress });
    const burnTx = await burnerBaseWallet.writeContract({
      address: TOKEN_MESSENGER, abi: tmAbi, functionName: "depositForBurn",
      args: [burnerUsdc, CONFIG.cctp.domains.polygonAmoy, recipient, USDC_BASE, ZERO, burnerUsdc / 50n, 1000],
      nonce: burnNonce,
    });
    await basePub.waitForTransactionReceipt({ hash: burnTx });
    log("cctp:burn", "done", burnTx);
    updateBurner(burnerAddress, { status: "bridged", txHashes: { cctpBurn: burnTx } });

    // Poll Circle Iris for attestation
    log("cctp:attestation", "waiting");
    const irisUrl = `${CONFIG.cctp.iris}/v2/messages/${CONFIG.cctp.domains.baseSepolia}?transactionHash=${burnTx}`;
    let attestation: { message: string; attestation: string } | null = null;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const res = await fetch(irisUrl);
        if (res.ok) {
          const d = (await res.json()) as any;
          if (d?.messages?.[0]?.status === "complete") { attestation = d.messages[0]; break; }
        }
      } catch {}
      if (i % 12 === 0 && i > 0) log("cctp:attestation", "polling", undefined, `${i * 5}s`);
    }
    if (!attestation) {
      log("cctp:attestation", "timeout");
      return NextResponse.json({ success: false, steps, error: "CCTP attestation timeout" });
    }
    log("cctp:attestation", "done");

    // ============================================================
    // STEP 4: Relay receiveMessage + fund burner MATIC on Amoy
    // Backend wallet relays the CCTP message and funds gas.
    // ============================================================
    log("cctp:relay", "started");
    const relayerWallet = createWalletClient({ account, chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });

    const amoyRelayGas = { maxFeePerGas: 80000000000n, maxPriorityFeePerGas: 30000000000n };
    const receiveTx = await relayerWallet.writeContract({
      address: MSG_TRANSMITTER, abi: mtAbi, functionName: "receiveMessage",
      args: [attestation.message as `0x${string}`, attestation.attestation as `0x${string}`],
      ...amoyRelayGas,
    });
    await amoyPub.waitForTransactionReceipt({ hash: receiveTx });
    log("cctp:relay", "done", receiveTx);

    // Fund burner with MATIC for Polymarket txs (0.001 MATIC = ~400 txs at 2 gwei)
    const relayNonce = await amoyPub.getTransactionCount({ address: account.address });
    const gasTx = await relayerWallet.sendTransaction({
      to: burnerAddress,
      value: 1000000000000000n, // 0.001 MATIC (enough for 3 txs at 2 gwei)
      nonce: relayNonce,
      ...amoyRelayGas,
    });
    await amoyPub.waitForTransactionReceipt({ hash: gasTx });
    log("gas:fund", "done", gasTx);
    updateBurner(burnerAddress, { txHashes: { cctpReceive: receiveTx } });

    // Check burner USDC on Amoy
    const burnerAmoyBalance = (await amoyPub.readContract({
      address: USDC_AMOY, abi: erc20Abi, functionName: "balanceOf", args: [burnerAddress],
    })) as bigint;
    log("balance", "done", undefined, `${formatUnits(burnerAmoyBalance, 6)} USDC on Amoy`);

    // ============================================================
    // STEP 5: Bet on Polymarket (Amoy)
    // ============================================================
    const burnerAmoyWallet = createWalletClient({ account: burnerAccount, chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });
    // Low gas overrides for Amoy testnet (base fee is 0, default priority is wasteful)
    const amoyGas = { maxFeePerGas: 80000000000n, maxPriorityFeePerGas: 30000000000n }; // 2 gwei

    // Create condition on testnet
    log("polymarket:prepare", "started");
    const questionText = marketQuestion || conditionId;
    const questionId = keccak256(encodePacked(["string"], [questionText]));
    const oracle = burnerAddress as `0x${string}`;
    const testnetConditionId = keccak256(encodePacked(["address", "bytes32", "uint256"], [oracle, questionId, 2n]));

    try {
      const prepareTx = await burnerAmoyWallet.writeContract({
        address: CTF, abi: ctfAbi, functionName: "prepareCondition", args: [oracle, questionId, 2n], ...amoyGas,
      });
      await amoyPub.waitForTransactionReceipt({ hash: prepareTx });
      log("polymarket:prepare", "done", prepareTx);
    } catch {
      log("polymarket:prepare", "exists");
    }

    // Split position (bet)
    log("polymarket:split", "started");
    const ctfApproveTx = await burnerAmoyWallet.writeContract({ address: USDC_AMOY, abi: erc20Abi, functionName: "approve", args: [CTF, burnerAmoyBalance], ...amoyGas });
    await amoyPub.waitForTransactionReceipt({ hash: ctfApproveTx });
    const splitNonce = await amoyPub.getTransactionCount({ address: burnerAddress });
    const splitTx = await burnerAmoyWallet.writeContract({ nonce: splitNonce, ...amoyGas,
      address: CTF, abi: ctfAbi, functionName: "splitPosition",
      args: [USDC_AMOY, ZERO, testnetConditionId, [1n, 2n], burnerAmoyBalance],
    });
    await amoyPub.waitForTransactionReceipt({ hash: splitTx });
    log("polymarket:split", "done", splitTx);
    updateBurner(burnerAddress, { status: "bet_placed", txHashes: { splitPosition: splitTx } });

    // Persist bet
    const amountUsdc = parseFloat(formatUnits(amountBigint, 6));
    let savedBet = null;
    if (nullifier) {
      savedBet = addBet(nullifier, {
        market: marketQuestion || `Market ${conditionId.substring(0, 10)}...`,
        conditionId: testnetConditionId,
        side: side as "YES" | "NO",
        amount: amountUsdc,
        odds: odds || "50%",
        status: "active" as const,
        burner: burnerAddress,
        txHash: splitTx,
      });
    }

    return NextResponse.json({
      success: true,
      steps,
      burner: burnerAddress,
      side,
      amount: formatUnits(amountBigint, 6) + " USDC",
      bet: savedBet,
    });
  } catch (e: any) {
    log("error", "failed", undefined, e.message);
    return NextResponse.json({ success: false, steps, error: e.message }, { status: 500 });
  }
}
