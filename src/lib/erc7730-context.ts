// Custom TypedData context loader that serves local ERC-7730 descriptors
// to the Ledger DMK for Clear Signing. This is how we make the Ledger
// display human-readable prediction market data without waiting for
// Ledger's CAL to index our descriptors.

import {
  type TypedDataContextLoader,
  type TypedDataClearSignContext,
  type TypedDataContext,
  type TypedDataFilter,
  type TypedDataMessageInfo,
  type TypedDataFilterPath,
  ContextModuleBuilder,
  type ContextModule,
} from "@ledgerhq/context-module";

import {
  descriptors,
  findDescriptor,
  type ERC7730Descriptor,
} from "@/erc7730";

// ---- Registry of descriptor schemas keyed by domain+primaryType ----

interface DescriptorEntry {
  descriptor: ERC7730Descriptor;
  domainName: string;
  verifyingContract?: string;
  chainId?: number;
  primaryType: string;
}

function buildRegistry(): DescriptorEntry[] {
  const entries: DescriptorEntry[] = [];
  for (const descriptor of Object.values(descriptors)) {
    const domain = descriptor.context.eip712.domain;
    for (const schema of descriptor.context.eip712.schemas) {
      entries.push({
        descriptor,
        domainName: domain.name as string,
        verifyingContract: (domain.verifyingContract as string)?.toLowerCase(),
        chainId: domain.chainId as number | undefined,
        primaryType: schema.primaryType,
      });
    }
  }
  return entries;
}

const registry = buildRegistry();

/**
 * Custom TypedDataContextLoader that resolves ERC-7730 descriptors locally.
 *
 * The Ledger DMK normally fetches typed data clear signing metadata from
 * Ledger's CAL API. Since no prediction market has registered ERC-7730
 * descriptors yet, we provide them locally. This loader is injected into
 * the SignerEthBuilder via withContextModule().
 *
 * When Ledger firmware encounters EIP-712 typed data during signing, the
 * DMK calls getTypedDataFilters() to get display instructions. Our loader
 * returns filters that map each field to a human-readable label and format.
 */
export class WhisperTypedDataContextLoader implements TypedDataContextLoader {
  async load(typedData: TypedDataContext): Promise<TypedDataClearSignContext> {
    const { verifyingContract, chainId, schema } = typedData;

    // Find the primary type from the schema (the one that's not EIP712Domain)
    const primaryType = Object.keys(schema).find(
      (k) => k !== "EIP712Domain"
    );
    if (!primaryType) {
      return {
        type: "error",
        error: new Error("No primary type found in schema"),
      };
    }

    // Match against our local registry
    const entry = registry.find((e) => {
      if (e.primaryType !== primaryType) return false;
      if (
        e.verifyingContract &&
        verifyingContract.toLowerCase() === e.verifyingContract
      )
        return true;
      if (e.chainId && chainId === e.chainId) return true;
      return false;
    });

    if (!entry) {
      // Fall through to default loader (will try CAL API)
      return {
        type: "error",
        error: new Error(
          `No local ERC-7730 descriptor for ${primaryType} on chain ${chainId}`
        ),
      };
    }

    const descriptor = entry.descriptor;
    const format = descriptor.display.formats[primaryType];
    if (!format) {
      return {
        type: "error",
        error: new Error(`No display format for ${primaryType}`),
      };
    }

    // Build the message info (intent line shown at top of Ledger screen)
    // In production, these signatures would be signed by Ledger's PKI.
    // For local/test mode, we use placeholder signatures.
    const messageInfo: TypedDataMessageInfo = {
      displayName: format.intent,
      filtersCount: format.fields.length,
      signature: "0000", // Placeholder — real sig comes from Ledger PKI registration
    };

    // Build filters for each displayed field
    const filters: Record<TypedDataFilterPath, TypedDataFilter> = {};

    for (const field of format.fields) {
      const filter = buildFilter(descriptor, field);
      if (filter) {
        filters[field.path] = filter;
      }
    }

    return {
      type: "success",
      messageInfo,
      filters,
      trustedNamesAddresses: {},
      tokens: {},
      calldatas: {},
    };
  }
}

function buildFilter(
  descriptor: ERC7730Descriptor,
  field: ERC7730Descriptor["display"]["formats"][string]["fields"][number]
): TypedDataFilter | null {
  const baseSig = "0000"; // Placeholder for local mode

  switch (field.format) {
    case "enum":
    case "raw":
    case "percentage":
      return {
        type: "raw",
        displayName: field.label,
        path: field.path,
        signature: baseSig,
      };
    case "date":
    case "datetime":
      return {
        type: "datetime",
        displayName: field.label,
        path: field.path,
        signature: baseSig,
      };
    case "tokenAmount":
      return {
        type: "amount",
        displayName: field.label,
        path: field.path,
        signature: baseSig,
        tokenIndex: 255, // VERIFYING_CONTRACT_TOKEN_INDEX for native-like tokens
      };
    case "addressOrName":
      return {
        type: "raw",
        displayName: field.label,
        path: field.path,
        signature: baseSig,
      };
    default:
      return {
        type: "raw",
        displayName: field.label,
        path: field.path,
        signature: baseSig,
      };
  }
}

/**
 * Create a ContextModule with our custom TypedData loader.
 * Falls back to the default CAL-based loader for unknown schemas.
 */
export function createWhisperContextModule(): ContextModule {
  return new ContextModuleBuilder({})
    .addTypedDataLoader(new WhisperTypedDataContextLoader())
    .build();
}

/**
 * Get the display fields that will be shown on the Ledger for given typed data.
 * Used by the UI to preview what the hardware wallet will display.
 */
export function previewClearSigningFields(typedData: {
  domain?: { name?: string; verifyingContract?: string };
  primaryType?: string;
  message?: Record<string, unknown>;
}): Array<{ label: string; value: string }> | null {
  const descriptor = findDescriptor(typedData);
  if (!descriptor || !typedData.primaryType || !typedData.message) return null;

  const { resolveDisplayFields } = require("@/erc7730");
  return resolveDisplayFields(
    descriptor,
    typedData.primaryType,
    typedData.message
  );
}
