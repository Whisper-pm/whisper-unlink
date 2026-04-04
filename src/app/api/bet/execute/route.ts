import { NextRequest, NextResponse } from "next/server";
import {
  createUnlink,
  unlinkAccount,
  unlinkEvm,
  createUnlinkClient,
} from "@unlink-xyz/sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  pad,
  formatUnits,
  encodeFunctionData,
  keccak256,
  encodePacked,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { CONFIG } from "@/lib/config";
import { addBet } from "@/lib/store";
import { addBurner, updateBurner } from "@/lib/wallet-store";
import crypto from "crypto";

const USDC_BASE = CONFIG.unlink.usdc;
const USDC_AMOY = CONFIG.cctp.usdcPolygonAmoy;
const TOKEN_MESSENGER = CONFIG.cctp.tokenMessenger;
const TOKEN_MINTER = CONFIG.cctp.tokenMinter;
const MSG_TRANSMITTER = CONFIG.cctp.messageTransmitter;
const CTF = CONFIG.polymarket.amoy.ctf;

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
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

// Execute the REAL bet pipeline:
// ALLER: Unlink execute() atomique → CCTP bridge → Polymarket bet
// 1 atomic tx on Base (no burner on Base), then multi-tx on Polygon
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { conditionId, side, amount, evmPrivateKey, nullifier, marketQuestion, odds } = body;

  if (!conditionId || !side || !amount || !evmPrivateKey) {
    return NextResponse.json({ error: "Missing conditionId, side, amount, or evmPrivateKey" }, { status: 400 });
  }

  const steps: Array<{ step: string; status: string; txHash?: string; detail?: string }> = [];
  const log = (step: string, status: string, txHash?: string, detail?: string) => {
    steps.push({ step, status, txHash, detail });
  };

  try {
    const account = privateKeyToAccount(evmPrivateKey as `0x${string}`);
    const basePub = createPublicClient({ chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });
    const baseWallet = createWalletClient({ account, chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });
    const amoyPub = createPublicClient({ chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });
    const amountBigint = BigInt(amount);

    // Generate a fresh Polygon-only burner (just a keypair, no Base funding needed)
    const burnerPk = generatePrivateKey();
    const burnerAccount = privateKeyToAccount(burnerPk);
    const burnerAddress = burnerAccount.address;
    log("burner:generate", "done", undefined, `Polygon burner: ${burnerAddress}`);

    // ============================================================
    // STEP 1: ATOMIC ALLER via Unlink execute()
    // unshield USDC → approve CCTP → depositForBurn
    // 1 transaction, no burner on Base, no gas on Base
    // ============================================================
    log("unlink:execute", "started");

    const seed = crypto.createHash("sha512").update("whisper:bet:" + account.address).digest();
    const unlinkSeed = new Uint8Array(seed);
    const unlinkAccountProvider = unlinkAccount.fromSeed({ seed: unlinkSeed });
    const unlinkKeys = await unlinkAccountProvider.getAccountKeys();
    const unlinkClient = createUnlinkClient(CONFIG.unlink.engineUrl, CONFIG.unlink.apiKey);

    const unlink = createUnlink({
      engineUrl: CONFIG.unlink.engineUrl,
      apiKey: CONFIG.unlink.apiKey,
      account: unlinkAccountProvider,
      evm: unlinkEvm.fromViem({ walletClient: baseWallet as any, publicClient: basePub as any }),
    });
    await unlink.ensureRegistered();
    const unlinkAddr = await unlink.getAddress();

    // First ensure there's balance in the pool (deposit if needed)
    const { balances } = await unlink.getBalances();
    const poolUsdc = balances.find((b: any) => b.token?.toLowerCase() === USDC_BASE.toLowerCase());
    const poolAmount = BigInt(poolUsdc?.amount ?? "0");

    if (poolAmount < amountBigint) {
      // Need to deposit more
      const depositNeeded = amountBigint - poolAmount;
      log("unlink:deposit", "started", undefined, `Need ${formatUnits(depositNeeded, 6)} more USDC`);
      await unlink.ensureErc20Approval({ token: USDC_BASE, amount: String(depositNeeded) });
      const dep = await unlink.deposit({ token: USDC_BASE, amount: String(depositNeeded) });
      await unlink.pollTransactionStatus(dep.txId, { intervalMs: 3000, timeoutMs: 120000 });
      log("unlink:deposit", "done", undefined, "txId: " + dep.txId);
      // Wait for balance to update
      await new Promise((r) => setTimeout(r, 5000));
    }

    // Build the atomic execute() calls:
    // 1. approve USDC for TokenMinter (CCTP)
    // 2. depositForBurn (CCTP → Polygon)
    const recipient = pad(burnerAddress as `0x${string}`, { size: 32 });
    const maxFee = amountBigint / 50n; // 2% max fee

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [TOKEN_MINTER, amountBigint],
    });

    const burnData = encodeFunctionData({
      abi: tmAbi,
      functionName: "depositForBurn",
      args: [amountBigint, CONFIG.cctp.domains.polygonAmoy, recipient, USDC_BASE, ZERO_BYTES32, maxFee, 1000],
    });

    // Call execute via low-level API (not in SDK high-level yet)
    const prepareRes = await fetch(`${CONFIG.unlink.engineUrl}/transactions/prepare/execute`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.unlink.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        unlink_address: unlinkAddr,
        environment: "base-sepolia",
        withdrawals: [{ token: USDC_BASE, amount: String(amountBigint) }],
        calls: [
          { to: USDC_BASE, data: approveData, value: "0" },
          { to: TOKEN_MESSENGER, data: burnData, value: "0" },
        ],
        outputs: [], // all USDC goes to CCTP, nothing to reshield
        deadline: Math.floor(Date.now() / 1000) + 3600,
      }),
    });

    if (!prepareRes.ok) {
      const errText = await prepareRes.text();
      // Fallback: if execute() fails, use the burner wallet approach
      log("unlink:execute", "fallback", undefined, `execute() not available: ${errText.substring(0, 100)}`);
      return await fallbackBurnerFlow(
        account, unlink, unlinkClient, unlinkKeys, unlinkAddr,
        burnerPk, burnerAddress, amountBigint,
        basePub, amoyPub, steps, log,
        conditionId, side, amount, nullifier, marketQuestion, odds
      );
    }

    const prepareData = await prepareRes.json() as any;
    const txId = prepareData.data?.id ?? prepareData.id;
    const messageHash = prepareData.data?.message_hash ?? prepareData.message_hash;

    // Sign with EdDSA
    const { eddsaSign } = await import("@unlink-xyz/sdk");
    const signature = await eddsaSign(unlinkKeys.spendingPrivateKey, messageHash);

    // Submit
    const submitRes = await fetch(`${CONFIG.unlink.engineUrl}/transactions/${txId}/submit`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.unlink.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ signature: signature.toString() }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      log("unlink:execute", "fallback", undefined, `submit failed: ${errText.substring(0, 100)}`);
      return await fallbackBurnerFlow(
        account, unlink, unlinkClient, unlinkKeys, unlinkAddr,
        burnerPk, burnerAddress, amountBigint,
        basePub, amoyPub, steps, log,
        conditionId, side, amount, nullifier, marketQuestion, odds
      );
    }

    // Poll for tx completion
    const confirmed = await unlink.pollTransactionStatus(txId, { intervalMs: 3000, timeoutMs: 180000 });
    log("unlink:execute", "done", undefined, `Atomic: unshield → approve → CCTP burn (txId: ${txId})`);

    // Track burner
    addBurner({
      burnerAddress,
      createdAt: new Date().toISOString(),
      parentEvmAddress: account.address,
      unlinkAddress: unlinkAddr,
      market: marketQuestion,
      side,
      amount: formatUnits(amountBigint, 6),
      status: "bridged",
      txHashes: { fundFromPool: txId },
    });

    // ============================================================
    // STEP 2: CCTP ATTESTATION (wait for Circle)
    // ============================================================
    log("cctp:attestation", "waiting");

    // We need the burn tx hash from the execute. Since execute() is atomic,
    // the burn happened on-chain. We poll the Iris API with a broader search.
    // For now, wait and check burner balance on Amoy
    let burnerAmoyBalance = 0n;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        burnerAmoyBalance = await amoyPub.readContract({
          address: USDC_AMOY,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [burnerAddress],
        }) as bigint;
        if (burnerAmoyBalance > 0n) {
          log("cctp:attestation", "done", undefined, `Burner received ${formatUnits(burnerAmoyBalance, 6)} USDC on Amoy`);
          break;
        }
      } catch {}
    }

    if (burnerAmoyBalance === 0n) {
      log("cctp:attestation", "timeout");
      return NextResponse.json({ success: false, steps, error: "CCTP attestation timeout — USDC not received on Amoy" });
    }

    // ============================================================
    // STEP 3: BET ON POLYMARKET (Polygon Amoy) — multiple tx
    // ============================================================
    const burnerAmoyWallet = createWalletClient({ account: burnerAccount, chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });

    // Prepare condition on Amoy
    log("polymarket:prepare", "started");
    const questionText = marketQuestion || conditionId;
    const questionId = keccak256(encodePacked(["string"], [questionText]));
    const oracle = burnerAddress;
    const testnetConditionId = keccak256(encodePacked(["address", "bytes32", "uint256"], [oracle, questionId, 2n]));

    try {
      const prepareTx = await burnerAmoyWallet.writeContract({
        address: CTF, abi: ctfAbi, functionName: "prepareCondition",
        args: [oracle, questionId, 2n],
      });
      await amoyPub.waitForTransactionReceipt({ hash: prepareTx });
      log("polymarket:prepare", "done", prepareTx);
    } catch {
      log("polymarket:prepare", "exists", undefined, testnetConditionId);
    }

    // Approve + split
    log("polymarket:split", "started");
    const approveTx = await burnerAmoyWallet.writeContract({ address: USDC_AMOY, abi: erc20Abi, functionName: "approve", args: [CTF, burnerAmoyBalance] });
    await amoyPub.waitForTransactionReceipt({ hash: approveTx });

    const splitTx = await burnerAmoyWallet.writeContract({
      address: CTF, abi: ctfAbi, functionName: "splitPosition",
      args: [USDC_AMOY, ZERO_BYTES32, testnetConditionId, [1n, 2n], burnerAmoyBalance],
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
        side,
        amount: amountUsdc,
        odds: odds || "50%",
        status: "active",
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
      method: "atomic-execute",
    });
  } catch (e: any) {
    log("error", "failed", undefined, e.message);
    return NextResponse.json({ success: false, steps, error: e.message }, { status: 500 });
  }
}

// Fallback: original burner wallet approach if execute() is not available
async function fallbackBurnerFlow(
  account: any, unlink: any, unlinkClient: any, unlinkKeys: any, unlinkAddr: string,
  burnerPk: `0x${string}`, burnerAddress: string, amountBigint: bigint,
  basePub: any, amoyPub: any,
  steps: any[], log: any,
  conditionId: string, side: string, amount: string,
  nullifier: string | undefined, marketQuestion: string | undefined, odds: string | undefined,
) {
  const { BurnerWallet } = await import("@unlink-xyz/sdk");

  // Withdraw to burner on Base
  log("fallback:withdraw", "started");
  const withdrawResult = await unlink.withdraw({
    recipientEvmAddress: burnerAddress,
    token: USDC_BASE,
    amount: String(amountBigint),
  });
  await unlink.pollTransactionStatus(withdrawResult.txId, { intervalMs: 3000, timeoutMs: 120000 });
  log("fallback:withdraw", "done", undefined, "txId: " + withdrawResult.txId);

  addBurner({
    burnerAddress,
    createdAt: new Date().toISOString(),
    parentEvmAddress: account.address,
    unlinkAddress: unlinkAddr,
    market: marketQuestion,
    side,
    amount: formatUnits(amountBigint, 6),
    status: "funded",
    txHashes: {},
  });

  // Wait for balance
  await new Promise((r) => setTimeout(r, 8000));

  // Bridge via CCTP
  log("cctp:bridge", "started");
  const burnerAccount = privateKeyToAccount(burnerPk);
  const burnerBaseWallet = createWalletClient({ account: burnerAccount, chain: baseSepolia, transport: http(CONFIG.chains.baseSepolia.rpc) });

  const approveTx = await burnerBaseWallet.writeContract({ address: USDC_BASE, abi: erc20Abi, functionName: "approve", args: [TOKEN_MINTER, amountBigint] });
  await basePub.waitForTransactionReceipt({ hash: approveTx });

  const recipient = pad(burnerAddress as `0x${string}`, { size: 32 });
  const burnTx = await burnerBaseWallet.writeContract({
    address: TOKEN_MESSENGER, abi: tmAbi, functionName: "depositForBurn",
    args: [amountBigint, CONFIG.cctp.domains.polygonAmoy, recipient, USDC_BASE, ZERO_BYTES32, amountBigint / 50n, 1000],
  });
  await basePub.waitForTransactionReceipt({ hash: burnTx });
  log("cctp:burn", "done", burnTx);
  updateBurner(burnerAddress, { status: "bridged", txHashes: { cctpBurn: burnTx } });

  // Attestation
  const irisUrl = `${CONFIG.cctp.iris}/v2/messages/${CONFIG.cctp.domains.baseSepolia}?transactionHash=${burnTx}`;
  let attestation: any = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(irisUrl);
    if (res.ok) {
      const d = await res.json() as any;
      if (d?.messages?.[0]?.status === "complete") { attestation = d.messages[0]; break; }
    }
  }
  if (!attestation) {
    log("cctp:attestation", "timeout");
    return NextResponse.json({ success: false, steps, error: "Attestation timeout" });
  }
  log("cctp:attestation", "done");

  // Receive on Polygon
  const burnerAmoyWallet = createWalletClient({ account: burnerAccount, chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });
  const receiveTx = await burnerAmoyWallet.writeContract({
    address: MSG_TRANSMITTER, abi: mtAbi, functionName: "receiveMessage",
    args: [attestation.message as `0x${string}`, attestation.attestation as `0x${string}`],
  });
  await amoyPub.waitForTransactionReceipt({ hash: receiveTx });
  log("cctp:receive", "done", receiveTx);

  // Polymarket split
  const questionText = marketQuestion || conditionId;
  const questionId = keccak256(encodePacked(["string"], [questionText]));
  const oracle = burnerAddress as `0x${string}`;
  const testnetConditionId = keccak256(encodePacked(["address", "bytes32", "uint256"], [oracle, questionId, 2n]));

  try {
    const prepareTx = await burnerAmoyWallet.writeContract({ address: CTF, abi: ctfAbi, functionName: "prepareCondition", args: [oracle, questionId, 2n] });
    await amoyPub.waitForTransactionReceipt({ hash: prepareTx });
  } catch {}

  await burnerAmoyWallet.writeContract({ address: USDC_AMOY, abi: erc20Abi, functionName: "approve", args: [CTF, amountBigint] });
  const splitTx = await burnerAmoyWallet.writeContract({
    address: CTF, abi: ctfAbi, functionName: "splitPosition",
    args: [USDC_AMOY, ZERO_BYTES32, testnetConditionId, [1n, 2n], amountBigint],
  });
  await amoyPub.waitForTransactionReceipt({ hash: splitTx });
  log("polymarket:split", "done", splitTx);
  updateBurner(burnerAddress, { status: "bet_placed", txHashes: { splitPosition: splitTx } });

  const amountUsdc = parseFloat(formatUnits(amountBigint, 6));
  let savedBet = null;
  if (nullifier) {
    savedBet = addBet(nullifier, {
      market: marketQuestion || `Market ${conditionId.substring(0, 10)}...`,
      conditionId: testnetConditionId, side: side as "YES" | "NO", amount: amountUsdc,
      odds: odds || "50%", status: "active" as const, burner: burnerAddress, txHash: splitTx,
    });
  }

  return NextResponse.json({
    success: true, steps, burner: burnerAddress, side,
    amount: formatUnits(amountBigint, 6) + " USDC", bet: savedBet,
    method: "fallback-burner",
  });
}
