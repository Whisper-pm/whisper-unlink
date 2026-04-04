import { NextRequest, NextResponse } from "next/server";
import {
  createUnlink,
  unlinkAccount,
  unlinkEvm,
  eddsaSign,
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
 * ALLER (1 atomic tx on Base via execute()):
 *   Unlink pool → unshield USDC → approve TokenMessenger → CCTP depositForBurn
 *   → reshield 1 wei back to pool (adapter requires non-empty output)
 *
 * BRIDGE (off-chain, ~30s mainnet / ~5min testnet):
 *   Circle attests the CCTP message → anyone calls receiveMessage on Polygon
 *
 * BET (multi-tx on Polygon Amoy):
 *   prepareCondition → approve CTF → splitPosition (USDC → YES/NO tokens)
 */
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

    // Fresh Polygon-only burner (just a keypair — no funding on Base needed)
    const burnerPk = ("0x" + crypto.randomBytes(32).toString("hex")) as `0x${string}`;
    const burnerAccount = privateKeyToAccount(burnerPk);
    const burnerAddress = burnerAccount.address;
    log("burner:generate", "done", undefined, burnerAddress);

    // Setup Unlink client
    const seed = crypto.createHash("sha512").update("whisper:bet:" + account.address).digest();
    const unlinkAcc = unlinkAccount.fromSeed({ seed: new Uint8Array(seed) });
    const unlinkKeys = await unlinkAcc.getAccountKeys();
    const unlink = createUnlink({
      engineUrl: CONFIG.unlink.engineUrl,
      apiKey: CONFIG.unlink.apiKey,
      account: unlinkAcc,
      evm: unlinkEvm.fromViem({ walletClient: baseWallet as any, publicClient: basePub as any }),
    });
    await unlink.ensureRegistered();
    const unlinkAddr = await unlink.getAddress();

    // Ensure pool has enough balance
    const { balances } = await unlink.getBalances();
    const poolAmount = BigInt(balances.find((b: any) => b.token?.toLowerCase() === USDC_BASE.toLowerCase())?.amount ?? "0");

    if (poolAmount < amountBigint + 1n) {
      const needed = amountBigint + 1n - poolAmount;
      log("unlink:deposit", "started", undefined, `Need ${formatUnits(needed, 6)} more USDC`);
      await unlink.ensureErc20Approval({ token: USDC_BASE, amount: String(needed) });
      const nonce = getNextNonce(account.address);
      const dep = await unlink.deposit({ token: USDC_BASE, amount: String(needed), nonce });
      await unlink.pollTransactionStatus(dep.txId, { intervalMs: 2000, timeoutMs: 120000 });
      log("unlink:deposit", "done", undefined, dep.txId);
      await new Promise((r) => setTimeout(r, 5000));
    }

    // ============================================================
    // STEP 1: ATOMIC execute()
    //
    // How it works:
    // - Unlink adapter unshields (amount + 1) USDC from the ZK pool
    // - Call 1: USDC.approve(TokenMessenger, amount)
    //   The adapter approves TokenMessenger to spend its USDC
    // - Call 2: TokenMessenger.depositForBurn(amount, ...)
    //   Burns the USDC and initiates CCTP transfer to Polygon
    //   Recipient = fresh burner address on Polygon
    // - Output: reshield 1 wei USDC back to pool
    //   The adapter MUST have non-zero output for the ZK proof
    //   We withdraw 1 extra wei and reshield it back
    //
    // Key insights:
    // - approve TokenMessenger (NOT TokenMinter)
    // - withdraw amount+1, burn amount, reshield 1
    // - outputs min_amount: "1" (not "0")
    // ============================================================
    log("unlink:execute", "started");

    const recipient = pad(burnerAddress as `0x${string}`, { size: 32 });
    const maxFee = amountBigint / 50n;

    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [TOKEN_MESSENGER, amountBigint], // approve TokenMessenger, NOT TokenMinter
    });
    const burnData = encodeFunctionData({
      abi: tmAbi,
      functionName: "depositForBurn",
      args: [amountBigint, CONFIG.cctp.domains.polygonAmoy, recipient, USDC_BASE, ZERO, maxFee, 1000],
    });

    const prepareRes = await fetch(`${CONFIG.unlink.engineUrl}/transactions/prepare/execute`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.unlink.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        unlink_address: unlinkAddr,
        environment: "base-sepolia",
        withdrawals: [{ token: USDC_BASE, amount: String(amountBigint + 1n) }], // +1 wei
        calls: [
          { to: USDC_BASE, data: approveData, value: "0" },
          { to: TOKEN_MESSENGER, data: burnData, value: "0" },
        ],
        outputs: [{ recipient_address: unlinkAddr, token: USDC_BASE, min_amount: "1" }], // reshield 1 wei
        deadline: Math.floor(Date.now() / 1000) + 3600,
      }),
    });

    if (!prepareRes.ok) {
      const err = await prepareRes.text();
      log("unlink:execute", "error", undefined, err.substring(0, 100));
      return NextResponse.json({ success: false, steps, error: "execute() prepare failed: " + err.substring(0, 200) }, { status: 500 });
    }

    const prepData = (await prepareRes.json()) as any;
    const txId = prepData.data.tx_id;
    const msgHash = prepData.data.signing_request.message_hash;

    // Sign with EdDSA
    const sig = await eddsaSign(unlinkKeys.spendingPrivateKey, BigInt(msgHash));
    const sigArr = [sig.R8[0].toString(), sig.R8[1].toString(), sig.S.toString()];

    // Submit
    const submitRes = await fetch(`${CONFIG.unlink.engineUrl}/transactions/${txId}/submit`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${CONFIG.unlink.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ signature: sigArr }),
    });
    if (!submitRes.ok) {
      const err = await submitRes.text();
      log("unlink:execute", "error", undefined, err.substring(0, 100));
      return NextResponse.json({ success: false, steps, error: "execute() submit failed" }, { status: 500 });
    }

    // Poll until relayed
    const execResult = await unlink.pollTransactionStatus(txId, { intervalMs: 2000, timeoutMs: 300000 });
    if (execResult.status === "failed") {
      log("unlink:execute", "failed");
      return NextResponse.json({ success: false, steps, error: "execute() failed on-chain" }, { status: 500 });
    }
    log("unlink:execute", "done", undefined, `Atomic tx relayed (${txId})`);

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
    // STEP 2: CCTP ATTESTATION + RELAY
    //
    // Circle attests the burn message (~30s mainnet, ~5min testnet).
    // Then anyone can call receiveMessage on Polygon.
    // We use the user's old wallet as relayer (has MATIC on Amoy).
    // ============================================================
    log("cctp:attestation", "waiting");

    // Get the on-chain tx hash from the execute
    const txInfo = await fetch(`${CONFIG.unlink.engineUrl}/transactions/${txId}`, {
      headers: { "Authorization": `Bearer ${CONFIG.unlink.apiKey}` },
    });
    const txData = (await txInfo.json()) as any;
    const onChainHash = txData.data?.tx_hash;

    let attestation: { message: string; attestation: string } | null = null;
    if (onChainHash) {
      // Poll Circle Iris API for attestation
      const irisUrl = `${CONFIG.cctp.iris}/v2/messages/${CONFIG.cctp.domains.baseSepolia}?transactionHash=${onChainHash}`;
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const res = await fetch(irisUrl);
          if (res.ok) {
            const d = (await res.json()) as any;
            if (d?.messages?.[0]?.status === "complete") {
              attestation = d.messages[0];
              break;
            }
          }
        } catch {}
        if (i % 12 === 0) log("cctp:attestation", "polling", undefined, `${i * 5}s elapsed`);
      }
    }

    if (!attestation) {
      log("cctp:attestation", "timeout");
      return NextResponse.json({ success: false, steps, error: "CCTP attestation timeout" });
    }
    log("cctp:attestation", "done");

    // Relay receiveMessage + fund gas via dedicated gas tank wallet
    log("cctp:relay", "started");
    const gasTankAccount = privateKeyToAccount(CONFIG.gasTank.privateKey);
    const gasTankWallet = createWalletClient({ account: gasTankAccount, chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });

    const receiveTx = await gasTankWallet.writeContract({
      address: MSG_TRANSMITTER,
      abi: mtAbi,
      functionName: "receiveMessage",
      args: [attestation.message as `0x${string}`, attestation.attestation as `0x${string}`],
    });
    await amoyPub.waitForTransactionReceipt({ hash: receiveTx });
    log("cctp:relay", "done", receiveTx);
    updateBurner(burnerAddress, { status: "bridged", txHashes: { cctpReceive: receiveTx } });

    // Check burner balance
    const burnerAmoyBalance = (await amoyPub.readContract({
      address: USDC_AMOY, abi: erc20Abi, functionName: "balanceOf", args: [burnerAddress],
    })) as bigint;
    log("cctp:balance", "done", undefined, `${formatUnits(burnerAmoyBalance, 6)} USDC on Amoy`);

    // ============================================================
    // STEP 3: BET ON POLYMARKET (Polygon Amoy)
    // Gas tank funds the burner with MATIC, then burner bets.
    // ============================================================

    // Fund burner with gas
    log("gas:fund", "started");
    const gasTx = await gasTankWallet.sendTransaction({
      to: burnerAddress,
      value: BigInt(CONFIG.gasTank.maticPerBurner),
    });
    await amoyPub.waitForTransactionReceipt({ hash: gasTx });
    log("gas:fund", "done", gasTx);

    const burnerAmoyWallet = createWalletClient({ account: burnerAccount, chain: amoyChain, transport: http(CONFIG.chains.polygonAmoy.rpc) });

    // Prepare condition
    log("polymarket:prepare", "started");
    const questionText = marketQuestion || conditionId;
    const questionId = keccak256(encodePacked(["string"], [questionText]));
    const oracle = burnerAddress;
    const testnetConditionId = keccak256(encodePacked(["address", "bytes32", "uint256"], [oracle as `0x${string}`, questionId, 2n]));

    try {
      const prepareTx = await burnerAmoyWallet.writeContract({
        address: CTF, abi: ctfAbi, functionName: "prepareCondition", args: [oracle, questionId, 2n],
      });
      await amoyPub.waitForTransactionReceipt({ hash: prepareTx });
      log("polymarket:prepare", "done", prepareTx);
    } catch {
      log("polymarket:prepare", "exists");
    }

    // Split position
    log("polymarket:split", "started");
    await burnerAmoyWallet.writeContract({ address: USDC_AMOY, abi: erc20Abi, functionName: "approve", args: [CTF, burnerAmoyBalance] });
    const splitTx = await burnerAmoyWallet.writeContract({
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
      method: "atomic-execute",
    });
  } catch (e: any) {
    log("error", "failed", undefined, e.message);
    return NextResponse.json({ success: false, steps, error: e.message }, { status: 500 });
  }
}
