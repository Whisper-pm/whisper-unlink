const { createUnlink, unlinkAccount, unlinkEvm, createUnlinkClient } = require("@unlink-xyz/sdk");
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
  console.log(`[${((Date.now()-start)/1000).toFixed(1)}s] ${label}`);
  return result;
}

async function main() {
  console.log("=== BENCHMARK 2: execute() with outputs ===\n");

  const unlink = createUnlink({
    engineUrl: ENGINE, apiKey: API_KEY,
    account: unlinkAccount.fromSeed({ seed }),
    evm: unlinkEvm.fromViem({ walletClient, publicClient }),
  });
  const addr = await unlink.getAddress();
  const keys = await unlinkAccount.fromSeed({ seed }).getAccountKeys();
  const { balances } = await unlink.getBalances();
  const pool = BigInt(balances.find(b => b.token?.toLowerCase() === USDC.toLowerCase())?.amount ?? "0");
  console.log("Pool:", formatUnits(pool, 6), "USDC");

  const AMOUNT = 50000n; // 0.05 USDC
  const burnerPk = "0x" + crypto.randomBytes(32).toString("hex");
  const burnerAddr = privateKeyToAccount(burnerPk).address;
  console.log("Burner:", burnerAddr);

  const recipient = pad(burnerAddr, { size: 32 });
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const erc20Abi = [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }];
  const tmAbi = [{ name: "depositForBurn", type: "function", stateMutability: "payable", inputs: [{ name: "amount", type: "uint256" }, { name: "destinationDomain", type: "uint32" }, { name: "mintRecipient", type: "bytes32" }, { name: "burnToken", type: "address" }, { name: "destinationCaller", type: "bytes32" }, { name: "maxFee", type: "uint256" }, { name: "minFinalityThreshold", type: "uint32" }], outputs: [] }];

  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TOKEN_MINTER, AMOUNT] });
  const burnData = encodeFunctionData({
    abi: tmAbi, functionName: "depositForBurn",
    args: [AMOUNT, 7, recipient, USDC, zero, AMOUNT / 50n, 1000],
  });

  // Test execute() with a dummy output (reshield 0 USDC back)
  // The adapter needs outputs to be non-empty
  // Try with min_amount: "0"
  console.log("\n--- Test 1: outputs with min_amount=0 ---");
  const test1 = await time("execute() prepare (min_amount=0)", async () => {
    const npk = keys.masterPublicKey?.toString() || addr;
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
    return { status: res.status, body: (await res.text()).substring(0, 400) };
  });
  console.log("  Status:", test1.status);
  console.log("  Response:", test1.body);

  // Test 2: withdraw + 1 wei extra, output reshields 1 wei
  console.log("\n--- Test 2: withdraw AMOUNT+1, reshield 1 wei ---");
  const test2 = await time("execute() prepare (+1 wei trick)", async () => {
    const res = await fetch(`${ENGINE}/transactions/prepare/execute`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        unlink_address: addr,
        environment: "base-sepolia",
        withdrawals: [{ token: USDC, amount: String(AMOUNT + 1n) }],
        calls: [
          { to: USDC, data: approveData, value: "0" },
          { to: TOKEN_MESSENGER, data: burnData, value: "0" },
        ],
        outputs: [{ recipient_address: addr, token: USDC, min_amount: "1" }],
        deadline: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    return { status: res.status, body: (await res.text()).substring(0, 400) };
  });
  console.log("  Status:", test2.status);
  console.log("  Response:", test2.body);
}

main().catch(e => console.error("FATAL:", e.message));
