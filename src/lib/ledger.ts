// Ledger DMK integration — real hardware signing with ERC-7730 Clear Signing
// Connects to Ledger via WebHID, signs typed data with prediction market
// metadata displayed on the device screen.
//
// This is the first prediction market app with ERC-7730 Clear Signing metadata.

import {
  DeviceManagementKitBuilder,
  type DeviceManagementKit,
  type DeviceSessionId,
} from "@ledgerhq/device-management-kit";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import {
  SignerEthBuilder,
  type SignerEth,
} from "@ledgerhq/device-signer-kit-ethereum";

import { ContextModuleBuilder } from "@ledgerhq/context-module";
import { findDescriptor, resolveDisplayFields } from "@/erc7730";

// Set NEXT_PUBLIC_LEDGER_SPECULOS=true to use Speculos emulator instead of real device
const USE_SPECULOS = typeof window !== "undefined" && (
  process.env.NEXT_PUBLIC_LEDGER_SPECULOS === "true" ||
  new URLSearchParams(window.location.search).has("speculos")
);

/** AI analysis fields embedded into EIP-712 typed data for Ledger Clear Signing */
export interface LedgerAIAnalysis {
  /** AI confidence score 0-100 */
  aiScore: number;
  /** Risk assessment */
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  /** Short thesis line (truncated to fit Ledger screen) */
  aiThesis: string;
  /** Market liquidity in USD (raw number, not formatted) */
  liquidityUsd: number;
}

/**
 * Truncate and clean a thesis string for Ledger display.
 * Ledger screens have limited width (~40 chars per line).
 */
export function formatThesisForLedger(thesis: string): string {
  if (!thesis) return "No analysis";
  // Strip emojis, trim, and cap at 60 chars
  const clean = thesis.replace(/[\u{1F000}-\u{1FFFF}]/gu, "").trim();
  if (clean.length <= 60) return clean;
  return clean.slice(0, 57) + "...";
}

/**
 * Convert a raw liquidity number to USDC micro-units (6 decimals).
 * e.g. $50,000 -> "50000000000"
 */
export function liquidityToMicroUsdc(liquidityUsd: number): string {
  return String(Math.floor(liquidityUsd * 1e6));
}

let dmk: DeviceManagementKit | null = null;
let sessionId: DeviceSessionId | null = null;
let signer: SignerEth | null = null;

/**
 * Initialize the Ledger DMK (call once on app load).
 */
export async function initLedgerDMK(): Promise<DeviceManagementKit> {
  if (dmk) return dmk;
  const builder = new DeviceManagementKitBuilder();

  if (USE_SPECULOS) {
    // Connect to Speculos emulator via TCP (docker on localhost:40000)
    const { speculosTransportFactory } = await import("@ledgerhq/device-transport-kit-speculos");
    builder.addTransport(speculosTransportFactory("http://localhost:40000"));
    console.log("[Ledger] Using Speculos transport (localhost:40000)");
  } else {
    builder.addTransport(webHidTransportFactory);
    console.log("[Ledger] Using WebHID transport");
  }

  dmk = builder.build();
  return dmk;
}

/**
 * Connect to a Ledger device.
 * Injects the Whisper ERC-7730 context module so the device displays
 * human-readable prediction market details during Clear Signing.
 */
export async function connectLedger(): Promise<DeviceSessionId> {
  const kit = await initLedgerDMK();

  return new Promise((resolve, reject) => {
    const transport = USE_SPECULOS ? "SPECULOS" : "WEB_HID";
    const observable = kit.startDiscovering({ transport } as any);
    const sub = observable.subscribe({
      next: async (device) => {
        try {
          const session = await kit.connect({ device });
          sessionId = session;

          // Build signer with our custom ERC-7730 context module
          // This makes the Ledger display prediction market data
          // instead of raw hex during signing
          const ORIGIN_TOKEN = "1e55ba3959f4543af24809d9066a2120bd2ac9246e626e26a1ff77eb109ca0e5";

          // Build context module with originToken + test mode
          // Test mode accepts descriptors signed with test PKI keys (from our CAL backend)
          // Production mode would require descriptors signed by Ledger's root key
          const contextModule = new ContextModuleBuilder({ originToken: ORIGIN_TOKEN })
            .setCalConfig({
              url: "https://crypto-assets-service.api.ledger.com/v1",
              mode: USE_SPECULOS ? "test" : "prod",
              branch: "main",
            })
            .build();

          signer = new SignerEthBuilder({ dmk: kit, sessionId: session, originToken: ORIGIN_TOKEN })
            .withContextModule(contextModule)
            .build();

          sub.unsubscribe();
          resolve(session);
        } catch (e) {
          reject(e);
        }
      },
      error: reject,
    });
  });
}

/**
 * Get the Ethereum address from the connected Ledger.
 */
export async function getLedgerAddress(
  derivationPath = "44'/60'/0'/0/0"
): Promise<string> {
  if (!signer) throw new Error("Ledger not connected");

  return new Promise((resolve, reject) => {
    const { observable } = signer!.getAddress(derivationPath, {
      checkOnDevice: false,
    });
    observable.subscribe({
      next: (result: any) => {
        if (result.status === "success") {
          resolve(result.output.address);
        }
      },
      error: reject,
    });
  });
}

/**
 * Sign EIP-712 typed data on the Ledger.
 * The ERC-7730 context module automatically resolves Clear Signing metadata
 * from our local descriptors, displaying human-readable fields on the device.
 */
export async function signTypedDataOnLedger(
  derivationPath: string,
  typedData: any
): Promise<string> {
  if (!signer) throw new Error("Ledger not connected");

  return new Promise((resolve, reject) => {
    const { observable } = signer!.signTypedData(derivationPath, typedData);
    observable.subscribe({
      next: (result: any) => {
        if (result.status === "success") {
          const { r, s, v } = result.output;
          const sig = `0x${r}${s}${v.toString(16).padStart(2, "0")}`;
          resolve(sig);
        }
      },
      error: reject,
    });
  });
}

/**
 * Build EIP-712 typed data for a Whisper private bet.
 * Matches the WhisperBet schema in whisper-bet.json ERC-7730 descriptor.
 *
 * The Ledger will display:
 *   Action: AI-Analyzed Prediction Bet
 *   Market: [question text]
 *   Position: YES/NO
 *   Amount: X.XX USDC
 *   AI Score: XX/100
 *   Risk: LOW/MEDIUM/HIGH Risk
 *   AI Thesis: [analysis]
 *   Liquidity: X.XX USDC
 *   Time: [human-readable date]
 */
export function buildBetTypedData(params: {
  conditionId: string;
  side: "YES" | "NO";
  amount: string;
  market: string;
  aiScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  aiThesis: string;
  liquidityUsd: string;
}) {
  return {
    domain: {
      name: "Whisper Private Bet",
      version: "1",
      chainId: 84532, // Base Sepolia
    },
    types: {
      WhisperBet: [
        { name: "marketQuestion", type: "string" },
        { name: "conditionId", type: "bytes32" },
        { name: "side", type: "string" },
        { name: "amount", type: "uint256" },
        { name: "aiScore", type: "uint8" },
        { name: "riskLevel", type: "string" },
        { name: "aiThesis", type: "string" },
        { name: "liquidityUsd", type: "uint256" },
        { name: "timestamp", type: "uint256" },
      ],
    },
    primaryType: "WhisperBet" as const,
    message: {
      marketQuestion: params.market,
      conditionId: params.conditionId,
      side: params.side,
      amount: params.amount,
      aiScore: params.aiScore,
      riskLevel: params.riskLevel,
      aiThesis: params.aiThesis,
      liquidityUsd: params.liquidityUsd,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };
}

/**
 * Build EIP-712 typed data for a Polymarket CTF Exchange order.
 * Matches the Order schema in polymarket-ctf-exchange.json descriptor.
 *
 * The Ledger will display:
 *   Action: Place Prediction Market Trade
 *   Trade Side: BUY/SELL
 *   Outcome Token ID: [tokenId]
 *   You Pay: X.XX USDC
 *   You Receive: [shares]
 *   From Address: 0xAB...CD
 *   Expires At: [date]
 *   Fee Rate: [bps]
 */
export function buildCTFOrderTypedData(params: {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: 0 | 1; // 0=BUY, 1=SELL
  signatureType: 0 | 1 | 2;
}) {
  return {
    domain: {
      name: "Polymarket CTF Exchange",
      version: "1",
      chainId: 137,
      verifyingContract: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
    },
    types: {
      Order: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "expiration", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "feeRateBps", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "signatureType", type: "uint8" },
      ],
    },
    primaryType: "Order" as const,
    message: params,
  };
}

/**
 * Build EIP-712 typed data for a Polymarket Neg Risk Exchange order.
 * Same Order structure but different verifying contract.
 */
export function buildNegRiskOrderTypedData(params: {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: 0 | 1;
  signatureType: 0 | 1 | 2;
}) {
  return {
    domain: {
      name: "Polymarket Neg Risk CTF Exchange",
      version: "1",
      chainId: 137,
      verifyingContract: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
    },
    types: {
      Order: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "expiration", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "feeRateBps", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "signatureType", type: "uint8" },
      ],
    },
    primaryType: "Order" as const,
    message: params,
  };
}

/**
 * Build EIP-712 typed data for Permit2 (Unlink deposit approval).
 * Matches the PermitSingle schema in permit2-usdc.json descriptor.
 *
 * The Ledger will display:
 *   Action: Approve Token for Unlink Deposit
 *   Token: 0x03...7e
 *   Approved Amount: X.XX USDC
 *   Spender: 0x64...82 (Unlink Pool)
 *   Approval Expires: [date]
 *   Signature Deadline: [date]
 */
export function buildPermit2TypedData(params: {
  token: string;
  amount: string;
  expiration: number;
  nonce: number;
  spender: string;
  sigDeadline: number;
}) {
  return {
    domain: {
      name: "Permit2",
      chainId: 84532,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    },
    types: {
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    primaryType: "PermitSingle" as const,
    message: {
      details: {
        token: params.token,
        amount: params.amount,
        expiration: params.expiration,
        nonce: params.nonce,
      },
      spender: params.spender,
      sigDeadline: params.sigDeadline,
    },
  };
}

/**
 * Sign a bet with full ERC-7730 Clear Signing on the Ledger.
 * The device screen shows human-readable prediction market details
 * including AI analysis data.
 */
export async function signBetWithLedger(params: {
  market: string;
  conditionId: string;
  side: "YES" | "NO";
  amount: string;
  aiScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  aiThesis: string;
  liquidityUsd: string;
  derivationPath?: string;
}) {
  const path = params.derivationPath ?? "44'/60'/0'/0/0";

  const typedData = buildBetTypedData({
    conditionId: params.conditionId,
    side: params.side,
    amount: params.amount,
    market: params.market,
    aiScore: params.aiScore,
    riskLevel: params.riskLevel,
    aiThesis: params.aiThesis,
    liquidityUsd: params.liquidityUsd,
  });

  const signature = await signTypedDataOnLedger(path, typedData);

  return {
    signature,
    typedData,
  };
}

/**
 * Preview what the Ledger will display for given typed data.
 * Returns the resolved Clear Signing fields without needing a device.
 */
export function previewLedgerDisplay(typedData: {
  domain?: { name?: string; verifyingContract?: string };
  primaryType?: string;
  message?: Record<string, unknown>;
}): Array<{ label: string; value: string }> | null {
  const descriptor = findDescriptor(typedData);
  if (!descriptor || !typedData.primaryType || !typedData.message) return null;
  return resolveDisplayFields(
    descriptor,
    typedData.primaryType,
    typedData.message
  );
}

/**
 * Check if Ledger is connected.
 */
export function isLedgerConnected(): boolean {
  return !!signer;
}

/**
 * Disconnect Ledger.
 */
export async function disconnectLedger() {
  if (dmk && sessionId) {
    await dmk.disconnect({ sessionId });
    sessionId = null;
    signer = null;
  }
}
