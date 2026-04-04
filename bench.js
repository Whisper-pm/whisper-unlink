const { createUnlink, unlinkAccount, unlinkEvm, createUnlinkClient, eddsaSign } = require("@unlink-xyz/sdk");
const { createPublicClient, createWalletClient, http, formatUnits, pad, encodeFunctionData, keccak256, encodePacked } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");
const crypto = require("crypto");

const PK = "0x47b0a088fc62101d8aefc501edec2266ff2fc4cf84c93a8e6c315dedb0d942be";
const API_KEY = "AkzGeutvPPQULpjAiyt3Wv";
const ENGINE = "https://staging-api.unlink.xyz";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const TOKEN_MINTER = "0xb43db544E2c27092c107639Ad201b3dEfAbcF192";

const account = privateKeyToAccount(PK);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const seed = new Uint8Array(crypto.createHash("sha512").update("whisper-ethglobal-cannes").digest());

async function time(label, fn) {
  const start = Date.now();
  const result = await fn();
  const elapsed = Date.now() - start;
  console.log(`[${elapsed}ms] ${label}`);
  return result;
}

async function main() {
  console.log("=== BENCHMARK: Unlink + CCTP flow ===\n");
  console.log("EVM:", account.address);

  const unlink = createUnlink({
    engineUrl: ENGINE, apiKey: API_KEY,
    account: unlinkAccount.fromSeed({ seed }),
    evm: unlinkEvm.fromViem({ walletClient, publicClient }),
  });

  // 1. Check current state
  const addr = await unlink.getAddress();
  console.log("Unlink:", addr);
  const { balances } = await unlink.getBalances();
  const poolUsdc = balances.find(b => b.token?.toLowerCase() === USDC.toLowerCase());
  console.log("Pool USDC:", poolUsdc ? formatUnits(BigInt(poolUsdc.amount), 6) : "0");

  const onChain = await publicClient.readContract({
    address: USDC,
    abi: [{ name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "balanceOf", args: [account.address],
  });
  console.log("On-chain USDC:", formatUnits(onChain, 6));
  console.log("");

  const AMOUNT = 100000n; // 0.1 USDC

  // 2. Deposit (if needed)
  if (BigInt(poolUsdc?.amount ?? "0") < AMOUNT) {
    await time("Deposit 0.1 USDC to pool", async () => {
      await unlink.ensureErc20Approval({ token: USDC, amount: String(AMOUNT) });
      const dep = await unlink.deposit({ token: USDC, amount: String(AMOUNT) });
      return await unlink.pollTransactionStatus(dep.txId, { intervalMs: 2000, timeoutMs: 120000 });
    });
    // Wait for balance
    await new Promise(r => setTimeout(r, 3000));
  }

  // 3. Test execute() API
  console.log("\n--- TEST: execute() API availability ---");
  const burnerPk = "0x" + crypto.randomBytes(32).toString("hex");
  const burnerAddr = privateKeyToAccount(burnerPk).address;
  console.log("Burner (Polygon only):", burnerAddr);

  const recipient = pad(burnerAddr, { size: 32 });
  const maxFee = AMOUNT / 50n;

  const erc20Abi = [
    { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  ];
  const tmAbi = [{ name: "depositForBurn", type: "function", stateMutability: "payable", inputs: [{ name: "amount", type: "uint256" }, { name: "destinationDomain", type: "uint32" }, { name: "mintRecipient", type: "bytes32" }, { name: "burnToken", type: "address" }, { name: "destinationCaller", type: "bytes32" }, { name: "maxFee", type: "uint256" }, { name: "minFinalityThreshold", type: "uint32" }], outputs: [] }];

  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TOKEN_MINTER, AMOUNT] });
  const zeroCaller = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const burnData = encodeFunctionData({
    abi: tmAbi, functionName: "depositForBurn",
    args: [AMOUNT, 7, recipient, USDC, zeroCaller, maxFee, 1000],
  });

  const executeResult = await time("execute() prepare API call", async () => {
    const res = await fetch(`${ENGINE}/transactions/prepare/execute`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        unlink_address: addr,
        environment: "base-sepolia",
        withdrawals: [{ token: USDC, amount: String(AMOUNT) }],
        calls: [
          { to: USDC, data: approveData, value: "0" },
          { to: TOKEN_MESSENGER, data: burnData, value: "0" },
        ],
        outputs: [],
        deadline: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    const status = res.status;
    const body = await res.text();
    return { status, body: body.substring(0, 300) };
  });
  console.log("  Status:", executeResult.status);
  console.log("  Response:", executeResult.body);

  // 4. Test fallback: withdraw to burner
  console.log("\n--- TEST: Fallback withdraw to burner ---");
  const withdrawResult = await time("Withdraw 0.05 USDC to burner", async () => {
    const w = await unlink.withdraw({ recipientEvmAddress: burnerAddr, token: USDC, amount: "50000" });
    return await unlink.pollTransactionStatus(w.txId, { intervalMs: 2000, timeoutMs: 120000 });
  });
  console.log("  Status:", withdrawResult.status);

  // Check burner balance on Base
  await new Promise(r => setTimeout(r, 5000));
  const burnerBal = await publicClient.readContract({
    address: USDC,
    abi: [{ name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "balanceOf", args: [burnerAddr],
  });
  console.log("  Burner Base USDC:", formatUnits(burnerBal, 6));

  // Final state
  console.log("\n--- FINAL STATE ---");
  const { balances: finalBal } = await unlink.getBalances();
  const finalPool = finalBal.find(b => b.token?.toLowerCase() === USDC.toLowerCase());
  console.log("Pool USDC:", finalPool ? formatUnits(BigInt(finalPool.amount), 6) : "0");
}

main().catch(e => console.error("FATAL:", e.message));
