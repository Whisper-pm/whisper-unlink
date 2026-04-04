const { createUnlink, unlinkAccount, unlinkEvm, createUnlinkClient, eddsaSign } = require("@unlink-xyz/sdk");
const { createPublicClient, createWalletClient, http, formatUnits, pad, encodeFunctionData } = require("viem");
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
  console.log(`[${((Date.now()-start)/1000).toFixed(1)}s] ${label}`);
  return result;
}

async function main() {
  console.log("=== FULL execute() FLOW TEST ===\n");

  const unlinkAccountProvider = unlinkAccount.fromSeed({ seed });
  const keys = await unlinkAccountProvider.getAccountKeys();
  const unlink = createUnlink({
    engineUrl: ENGINE, apiKey: API_KEY,
    account: unlinkAccountProvider,
    evm: unlinkEvm.fromViem({ walletClient, publicClient }),
  });
  const addr = await unlink.getAddress();
  
  const { balances } = await unlink.getBalances();
  const pool = BigInt(balances.find(b => b.token?.toLowerCase() === USDC.toLowerCase())?.amount ?? "0");
  console.log("Pool:", formatUnits(pool, 6), "USDC\n");

  const AMOUNT = 50000n; // 0.05 USDC
  const burnerPk = "0x" + crypto.randomBytes(32).toString("hex");
  const burnerAddr = privateKeyToAccount(burnerPk).address;
  console.log("Target Polygon burner:", burnerAddr);

  const recipient = pad(burnerAddr, { size: 32 });
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const erc20Abi = [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }];
  const tmAbi = [{ name: "depositForBurn", type: "function", stateMutability: "payable", inputs: [{ name: "amount", type: "uint256" }, { name: "destinationDomain", type: "uint32" }, { name: "mintRecipient", type: "bytes32" }, { name: "burnToken", type: "address" }, { name: "destinationCaller", type: "bytes32" }, { name: "maxFee", type: "uint256" }, { name: "minFinalityThreshold", type: "uint32" }], outputs: [] }];

  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TOKEN_MINTER, AMOUNT] });
  const burnData = encodeFunctionData({
    abi: tmAbi, functionName: "depositForBurn",
    args: [AMOUNT, 7, recipient, USDC, zero, AMOUNT / 50n, 1000],
  });

  // Step 1: Prepare execute
  const prepareResult = await time("1. Prepare execute()", async () => {
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
        outputs: [{ recipient_address: addr, token: USDC, min_amount: "0" }],
        deadline: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    if (!res.ok) throw new Error(`Prepare failed: ${res.status} ${await res.text()}`);
    return await res.json();
  });
  
  const txId = prepareResult.data?.id;
  const messageHash = prepareResult.data?.signing_request?.message_hash;
  console.log("  txId:", txId);
  console.log("  messageHash:", messageHash?.toString().substring(0, 30) + "...");

  // Step 2: Sign with EdDSA
  const signature = await time("2. EdDSA sign", async () => {
    return eddsaSign(keys.spendingPrivateKey, BigInt(messageHash));
  });
  console.log("  signature:", JSON.stringify(signature).substring(0, 60) + "...");

  // Step 3: Submit
  const submitResult = await time("3. Submit signed tx", async () => {
    const sigStr = typeof signature === "object" 
      ? JSON.stringify({ R8: [signature.R8[0].toString(), signature.R8[1].toString()], S: signature.S.toString() })
      : signature.toString();
    
    const res = await fetch(`${ENGINE}/transactions/${txId}/submit`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ signature: sigStr }),
    });
    return { status: res.status, body: (await res.text()).substring(0, 300) };
  });
  console.log("  Status:", submitResult.status);
  console.log("  Response:", submitResult.body);

  // Step 4: Poll
  if (submitResult.status >= 200 && submitResult.status < 300) {
    const pollResult = await time("4. Poll until terminal", async () => {
      return await unlink.pollTransactionStatus(txId, { intervalMs: 2000, timeoutMs: 120000 });
    });
    console.log("  Final status:", pollResult.status);
  }

  // Check final pool balance
  await new Promise(r => setTimeout(r, 3000));
  const { balances: finalBal } = await unlink.getBalances();
  const finalPool = BigInt(finalBal.find(b => b.token?.toLowerCase() === USDC.toLowerCase())?.amount ?? "0");
  console.log("\nFinal pool:", formatUnits(finalPool, 6), "USDC");
  console.log("Change:", formatUnits(finalPool - pool, 6), "USDC");
}

main().catch(e => console.error("FATAL:", e.message, e.stack?.split("\n").slice(0,3).join("\n")));
