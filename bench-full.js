const { createUnlink, unlinkAccount, unlinkEvm, eddsaSign } = require("@unlink-xyz/sdk");
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
const USDC_AMOY = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582";

const account = privateKeyToAccount(PK);
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const seed = new Uint8Array(crypto.createHash("sha512").update("whisper-ethglobal-cannes").digest());

const amoyChain = { id: 80002, name: "Amoy", nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc-amoy.polygon.technology"] } } };
const amoyPub = createPublicClient({ chain: amoyChain, transport: http("https://rpc-amoy.polygon.technology") });

const erc20Abi = [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const tmAbi = [{ name: "depositForBurn", type: "function", stateMutability: "payable", inputs: [{ name: "amount", type: "uint256" }, { name: "destinationDomain", type: "uint32" }, { name: "mintRecipient", type: "bytes32" }, { name: "burnToken", type: "address" }, { name: "destinationCaller", type: "bytes32" }, { name: "maxFee", type: "uint256" }, { name: "minFinalityThreshold", type: "uint32" }], outputs: [] }];

const t0 = Date.now();
function elapsed() { return ((Date.now() - t0) / 1000).toFixed(1) + "s"; }

async function main() {
  console.log("=== FULL PIPELINE BENCHMARK ===\n");
  
  const unlinkAcc = unlinkAccount.fromSeed({ seed });
  const keys = await unlinkAcc.getAccountKeys();
  const unlink = createUnlink({
    engineUrl: ENGINE, apiKey: API_KEY,
    account: unlinkAcc,
    evm: unlinkEvm.fromViem({ walletClient, publicClient }),
  });
  const addr = await unlink.getAddress();

  // Deposit first
  console.log(`[${elapsed()}] Depositing 0.2 USDC...`);
  await unlink.ensureErc20Approval({ token: USDC, amount: "200000" });
  const dep = await unlink.deposit({ token: USDC, amount: "200000" });
  await unlink.pollTransactionStatus(dep.txId, { intervalMs: 2000, timeoutMs: 120000 });
  console.log(`[${elapsed()}] Deposit done`);
  await new Promise(r => setTimeout(r, 3000));

  const { balances } = await unlink.getBalances();
  console.log(`[${elapsed()}] Pool: ${formatUnits(BigInt(balances[0]?.amount ?? "0"), 6)} USDC\n`);

  const AMOUNT = 50000n; // 0.05 USDC
  const burnerPk = "0x" + crypto.randomBytes(32).toString("hex");
  const burnerAddr = privateKeyToAccount(burnerPk).address;
  console.log("Burner:", burnerAddr);

  // ====== ALLER ATOMIQUE: execute() ======
  console.log("\n====== ALLER ATOMIQUE (execute) ======");
  
  const recipient = pad(burnerAddr, { size: 32 });
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TOKEN_MINTER, AMOUNT] });
  const burnData = encodeFunctionData({ abi: tmAbi, functionName: "depositForBurn", args: [AMOUNT, 7, recipient, USDC, zero, AMOUNT / 50n, 1000] });

  // 1. Prepare
  console.log(`[${elapsed()}] Preparing execute()...`);
  const prepRes = await fetch(`${ENGINE}/transactions/prepare/execute`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      unlink_address: addr, environment: "base-sepolia",
      withdrawals: [{ token: USDC, amount: String(AMOUNT) }],
      calls: [{ to: USDC, data: approveData, value: "0" }, { to: TOKEN_MESSENGER, data: burnData, value: "0" }],
      outputs: [{ recipient_address: addr, token: USDC, min_amount: "0" }],
      deadline: Math.floor(Date.now() / 1000) + 3600,
    }),
  });
  
  if (!prepRes.ok) {
    console.log(`[${elapsed()}] execute() FAILED:`, (await prepRes.text()).substring(0, 200));
    console.log("Falling back to withdraw...");
    // Run fallback test instead
    return;
  }
  
  const prepData = await prepRes.json();
  const txId = prepData.data?.id;
  const msgHash = prepData.data?.signing_request?.message_hash;
  console.log(`[${elapsed()}] Prepared: txId=${txId}`);

  // 2. Sign
  const sig = eddsaSign(keys.spendingPrivateKey, BigInt(msgHash));
  const sigStr = JSON.stringify({ R8: [sig.R8[0].toString(), sig.R8[1].toString()], S: sig.S.toString() });
  console.log(`[${elapsed()}] Signed`);

  // 3. Submit
  const subRes = await fetch(`${ENGINE}/transactions/${txId}/submit`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ signature: sigStr }),
  });
  console.log(`[${elapsed()}] Submitted: ${subRes.status}`);
  if (!subRes.ok) { console.log(await subRes.text()); return; }

  // 4. Poll
  console.log(`[${elapsed()}] Polling...`);
  const confirmed = await unlink.pollTransactionStatus(txId, { intervalMs: 2000, timeoutMs: 180000 });
  console.log(`[${elapsed()}] Execute done: ${confirmed.status}`);

  // 5. Wait for CCTP on Amoy
  console.log(`\n[${elapsed()}] Waiting for CCTP on Amoy...`);
  let amoyBal = 0n;
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      amoyBal = await amoyPub.readContract({ address: USDC_AMOY, abi: erc20Abi, functionName: "balanceOf", args: [burnerAddr] });
      if (amoyBal > 0n) {
        console.log(`[${elapsed()}] CCTP RECEIVED! Burner has ${formatUnits(amoyBal, 6)} USDC on Amoy`);
        break;
      }
    } catch {}
    if (i % 6 === 0) console.log(`[${elapsed()}] Still waiting... (${i * 5}s)`);
  }

  if (amoyBal === 0n) {
    console.log(`[${elapsed()}] CCTP TIMEOUT - no funds on Amoy after 7.5 min`);
  }

  // Final
  const { balances: fb } = await unlink.getBalances();
  console.log(`\n[${elapsed()}] Final pool: ${formatUnits(BigInt(fb[0]?.amount ?? "0"), 6)} USDC`);
  console.log(`[${elapsed()}] TOTAL TIME`);
}

main().catch(e => console.error("FATAL:", e.message));
