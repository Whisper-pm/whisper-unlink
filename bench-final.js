const { createUnlink, unlinkAccount, unlinkEvm, eddsaSign } = require("@unlink-xyz/sdk");
const { createPublicClient, createWalletClient, http, formatUnits, pad, encodeFunctionData } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { baseSepolia } = require("viem/chains");
const crypto = require("crypto");

const PK = "0x47b0a088fc62101d8aefc501edec2266ff2fc4cf84c93a8e6c315dedb0d942be";
const ENGINE = "https://staging-api.unlink.xyz";
const API_KEY = "AkzGeutvPPQULpjAiyt3Wv";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TM = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const TMinter = "0xb43db544E2c27092c107639Ad201b3dEfAbcF192";
const USDC_AMOY = "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582";

const account = privateKeyToAccount(PK);
const wc = createWalletClient({ account, chain: baseSepolia, transport: http("https://sepolia.base.org") });
const pc = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const seed = new Uint8Array(crypto.createHash("sha512").update("whisper-ethglobal-cannes").digest());
const amoyChain = { id: 80002, name: "Amoy", nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc-amoy.polygon.technology"] } } };
const amoyPub = createPublicClient({ chain: amoyChain, transport: http("https://rpc-amoy.polygon.technology") });
const erc20Abi = [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{name:"s",type:"address"},{name:"a",type:"uint256"}], outputs: [{type:"bool"}] }, { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{type:"address"}], outputs: [{type:"uint256"}] }];
const tmAbi = [{ name: "depositForBurn", type: "function", stateMutability: "payable", inputs: [{name:"a",type:"uint256"},{name:"d",type:"uint32"},{name:"m",type:"bytes32"},{name:"b",type:"address"},{name:"c",type:"bytes32"},{name:"f",type:"uint256"},{name:"t",type:"uint32"}], outputs: [] }];

const t0 = Date.now();
const ts = () => ((Date.now()-t0)/1000).toFixed(1)+"s";

async function main() {
  const unlinkAcc = unlinkAccount.fromSeed({ seed });
  const keys = await unlinkAcc.getAccountKeys();
  const unlink = createUnlink({ engineUrl: ENGINE, apiKey: API_KEY, account: unlinkAcc, evm: unlinkEvm.fromViem({ walletClient: wc, publicClient: pc }) });
  const addr = await unlink.getAddress();
  console.log("EVM:", account.address, "| Unlink:", addr.substring(0,20)+"...");

  // Ensure pool has funds
  let { balances } = await unlink.getBalances();
  let pool = BigInt(balances.find(b=>b.token?.toLowerCase()===USDC.toLowerCase())?.amount ?? "0");
  console.log(`[${ts()}] Pool: ${formatUnits(pool,6)} USDC`);

  if (pool < 100000n) {
    console.log(`[${ts()}] Depositing 0.5 USDC...`);
    await unlink.ensureErc20Approval({ token: USDC, amount: "500000" });
    const dep = await unlink.deposit({ token: USDC, amount: "500000" });
    await unlink.pollTransactionStatus(dep.txId, { intervalMs: 2000, timeoutMs: 120000 });
    await new Promise(r=>setTimeout(r,3000));
    ({ balances } = await unlink.getBalances());
    pool = BigInt(balances.find(b=>b.token?.toLowerCase()===USDC.toLowerCase())?.amount ?? "0");
    console.log(`[${ts()}] Pool after deposit: ${formatUnits(pool,6)} USDC`);
  }

  const AMT = 50000n; // 0.05 USDC
  const burnerPk = "0x" + crypto.randomBytes(32).toString("hex");
  const burnerAddr = privateKeyToAccount(burnerPk).address;
  console.log(`\nBurner: ${burnerAddr}\n`);

  // ====== ALLER ATOMIQUE ======
  console.log("============ ALLER ATOMIQUE (execute) ============");
  const recip = pad(burnerAddr, { size: 32 });
  const z32 = "0x"+"0".repeat(64);
  const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TMinter, AMT] });
  const burnData = encodeFunctionData({ abi: tmAbi, functionName: "depositForBurn", args: [AMT, 7, recip, USDC, z32, AMT/50n, 1000] });

  console.log(`[${ts()}] prepare execute()...`);
  const prep = await fetch(`${ENGINE}/transactions/prepare/execute`, {
    method: "POST", headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ unlink_address: addr, environment: "base-sepolia", withdrawals: [{ token: USDC, amount: String(AMT) }], calls: [{ to: USDC, data: approveData, value: "0" }, { to: TM, data: burnData, value: "0" }], outputs: [{ recipient_address: addr, token: USDC, min_amount: "0" }], deadline: Math.floor(Date.now()/1000)+3600 }),
  });
  if (!prep.ok) { console.log(`[${ts()}] FAILED:`, await prep.text()); return; }
  const prepData = await prep.json();
  const txId = prepData.data.tx_id;
  const msgHash = prepData.data.signing_request.message_hash;
  console.log(`[${ts()}] prepared: txId=${txId}`);

  // Sign
  const sig = await eddsaSign(keys.spendingPrivateKey, BigInt(msgHash));
  const sigStr = JSON.stringify([sig.R8[0].toString(), sig.R8[1].toString(), sig.S.toString()]);
  console.log(`[${ts()}] signed`);

  // Submit
  const sub = await fetch(`${ENGINE}/transactions/${txId}/submit`, {
    method: "POST", headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ signature: sigStr }),
  });
  console.log(`[${ts()}] submitted: ${sub.status}`);
  if (!sub.ok) { console.log(await sub.text()); return; }

  // Poll
  console.log(`[${ts()}] polling...`);
  const conf = await unlink.pollTransactionStatus(txId, { intervalMs: 2000, timeoutMs: 180000 });
  console.log(`[${ts()}] execute done: ${conf.status}`);

  // Wait CCTP
  console.log(`[${ts()}] waiting CCTP on Amoy...`);
  let amoyBal = 0n;
  for (let i = 0; i < 90; i++) {
    await new Promise(r=>setTimeout(r,5000));
    try { amoyBal = await amoyPub.readContract({ address: USDC_AMOY, abi: erc20Abi, functionName: "balanceOf", args: [burnerAddr] }); } catch {}
    if (amoyBal > 0n) { console.log(`[${ts()}] CCTP DONE! ${formatUnits(amoyBal,6)} USDC on Amoy`); break; }
    if (i % 6 === 0) console.log(`[${ts()}] still waiting...`);
  }
  if (amoyBal === 0n) console.log(`[${ts()}] CCTP TIMEOUT`);

  // Final
  ({ balances } = await unlink.getBalances());
  console.log(`\n[${ts()}] Final pool: ${formatUnits(BigInt(balances[0]?.amount??"0"),6)} USDC`);
  console.log(`[${ts()}] TOTAL`);
}
main().catch(e=>console.error("FATAL:", e.message));
