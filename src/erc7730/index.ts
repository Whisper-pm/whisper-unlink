// ERC-7730 Clear Signing Descriptors for Whisper
// First prediction market app with ERC-7730 metadata
//
// These descriptors tell the Ledger device how to display EIP-712 typed data
// in human-readable format during Clear Signing.

import whisperBet from "./whisper-bet.json";
import ctfExchange from "./polymarket-ctf-exchange.json";
import negRiskExchange from "./polymarket-neg-risk-exchange.json";
import permit2Usdc from "./permit2-usdc.json";

export type ERC7730Descriptor = {
  context: {
    eip712: {
      schemas: Array<{
        primaryType: string;
        types: Record<string, Array<{ name: string; type: string }>>;
      }>;
      domain: Record<string, unknown>;
    };
  };
  metadata: {
    owner: string;
    info: { url: string; legalName: string; lastUpdate?: string };
    enums?: Record<string, Record<string, string>>;
    constants?: Record<string, string>;
  };
  display: {
    formats: Record<
      string,
      {
        intent: string;
        fields: Array<{
          path: string;
          label: string;
          format: string;
          params?: Record<string, unknown>;
        }>;
        excluded?: string[];
      }
    >;
  };
};

export const descriptors = {
  whisperBet: whisperBet as ERC7730Descriptor,
  ctfExchange: ctfExchange as ERC7730Descriptor,
  negRiskExchange: negRiskExchange as ERC7730Descriptor,
  permit2Usdc: permit2Usdc as unknown as ERC7730Descriptor,
} as const;

/**
 * Find the matching ERC-7730 descriptor for a given EIP-712 typed data.
 * Matches on domain name + primaryType.
 */
export function findDescriptor(typedData: {
  domain?: { name?: string; verifyingContract?: string };
  primaryType?: string;
}): ERC7730Descriptor | null {
  const domainName = typedData.domain?.name;
  const verifyingContract = typedData.domain?.verifyingContract?.toLowerCase();
  const primaryType = typedData.primaryType;

  for (const descriptor of Object.values(descriptors)) {
    const descDomain = descriptor.context.eip712.domain;
    const descDomainName = descDomain.name as string | undefined;
    const descContract = (
      descDomain.verifyingContract as string | undefined
    )?.toLowerCase();

    for (const schema of descriptor.context.eip712.schemas) {
      if (schema.primaryType !== primaryType) continue;

      // Match by domain name
      if (descDomainName && domainName && descDomainName === domainName) {
        return descriptor;
      }

      // Match by verifying contract
      if (descContract && verifyingContract && descContract === verifyingContract) {
        return descriptor;
      }
    }
  }

  return null;
}

/**
 * Resolve the human-readable display fields for a given typed data message.
 * This is what gets shown on the Ledger device screen.
 */
export function resolveDisplayFields(
  descriptor: ERC7730Descriptor,
  primaryType: string,
  message: Record<string, unknown>
): Array<{ label: string; value: string }> {
  const format = descriptor.display.formats[primaryType];
  if (!format) return [];

  const fields: Array<{ label: string; value: string }> = [];

  // Add intent as first line
  fields.push({ label: "Action", value: format.intent });

  for (const field of format.fields) {
    const rawValue = resolveFieldPath(message, field.path);
    if (rawValue === undefined) continue;

    let displayValue: string;

    switch (field.format) {
      case "enum": {
        // Resolve $ref to enums
        const refPath = (field.params as Record<string, string>)?.$ref;
        const enumMap = refPath
          ? resolveJsonRef(descriptor, refPath)
          : undefined;
        displayValue =
          (enumMap as Record<string, string>)?.[String(rawValue)] ??
          String(rawValue);
        break;
      }
      case "tokenAmount": {
        // Format as USDC (6 decimals)
        const num = Number(rawValue);
        if (num > 0) {
          displayValue = `${(num / 1e6).toFixed(2)} USDC`;
        } else {
          displayValue = String(rawValue);
        }
        break;
      }
      case "percentage": {
        const suffix =
          (field.params as Record<string, string>)?.suffix ?? "%";
        displayValue = `${rawValue}${suffix}`;
        break;
      }
      case "date": {
        const ts = Number(rawValue);
        if (ts > 0 && ts < 2e10) {
          // Unix seconds
          displayValue = new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
        } else {
          displayValue = String(rawValue);
        }
        break;
      }
      case "addressOrName": {
        const addr = String(rawValue);
        if (addr.length === 42) {
          displayValue = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        } else {
          displayValue = addr;
        }
        break;
      }
      case "raw":
      default: {
        const str = String(rawValue);
        // Truncate long values (like bytes32) for display
        if (str.startsWith("0x") && str.length > 18) {
          displayValue = `${str.slice(0, 10)}...${str.slice(-8)}`;
        } else if (str.length > 60) {
          displayValue = str.slice(0, 57) + "...";
        } else {
          displayValue = str;
        }
        break;
      }
    }

    fields.push({ label: field.label, value: displayValue });
  }

  return fields;
}

/**
 * Resolve a dotted path in a message object.
 * e.g. "details.token" resolves message.details.token
 */
function resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Resolve a JSON $ref like "$.metadata.enums.side"
 */
function resolveJsonRef(descriptor: ERC7730Descriptor, ref: string): unknown {
  if (!ref.startsWith("$.")) return undefined;
  const path = ref.slice(2); // Remove "$."
  return resolveFieldPath(descriptor as unknown as Record<string, unknown>, path);
}
