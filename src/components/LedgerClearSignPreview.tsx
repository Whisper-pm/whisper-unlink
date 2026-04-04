"use client";

/**
 * LedgerClearSignPreview — shows what the Ledger device will display
 * during ERC-7730 Clear Signing. This gives users confidence they're
 * signing the right transaction before they look at their hardware wallet.
 *
 * The first prediction market app with this UX.
 */

interface ClearSignField {
  label: string;
  value: string;
}

interface Props {
  fields: ClearSignField[];
  /** Whether the Ledger is currently awaiting confirmation */
  signing?: boolean;
  /** Contract name shown in the header */
  protocol?: string;
}

export function LedgerClearSignPreview({
  fields,
  signing = false,
  protocol,
}: Props) {
  if (!fields.length) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-gray-700 bg-gray-950">
      {/* Ledger device frame */}
      <div className="bg-gray-900 px-4 py-2.5 flex items-center gap-2 border-b border-gray-800">
        <LedgerIcon />
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
          Ledger Clear Signing
        </span>
        {signing && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-yellow-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400" />
            </span>
            Confirm on device
          </span>
        )}
        {!signing && (
          <span className="ml-auto text-[10px] text-gray-600 font-mono">
            ERC-7730
          </span>
        )}
      </div>

      {/* Protocol header */}
      {protocol && (
        <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-800/50">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">
            Protocol
          </span>
          <p className="text-xs text-white font-medium">{protocol}</p>
        </div>
      )}

      {/* Clear Sign fields — mimics the Ledger Stax/Flex screen */}
      <div className="divide-y divide-gray-800/60">
        {fields.map((field, i) => (
          <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-4">
            <span className={`text-[11px] font-medium shrink-0 leading-relaxed ${
              field.label.includes("AI") ? "text-blue-400" : "text-gray-500"
            }`}>
              {field.label}
            </span>
            <span
              className={`text-[11px] font-mono text-right leading-relaxed break-all ${
                getFieldValueColor(field, i)
              }`}
            >
              {field.value}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-gray-900/30 border-t border-gray-800/50">
        <p className="text-[9px] text-gray-600 text-center">
          Verified by ERC-7730 Clear Signing metadata
        </p>
      </div>
    </div>
  );
}

/** Get the color class for a field value based on its label and content */
function getFieldValueColor(field: ClearSignField, index: number): string {
  // First field (Action) is always white bold
  if (index === 0) return "text-white font-semibold";

  // Position / Side fields
  if (field.label.includes("Position") || field.label.includes("Side")) {
    return field.value === "YES" || field.value === "BUY"
      ? "text-green-400 font-semibold"
      : "text-red-400 font-semibold";
  }

  // Amount fields
  if (field.label.includes("Amount") || field.label.includes("Pay")) {
    return "text-yellow-300";
  }

  // AI Score — color by value
  if (field.label.includes("AI Score")) {
    const score = parseInt(field.value) || 0;
    if (score >= 70) return "text-green-400 font-semibold";
    if (score >= 40) return "text-yellow-400 font-semibold";
    return "text-red-400 font-semibold";
  }

  // Risk level
  if (field.label === "Risk") {
    if (field.value.includes("LOW")) return "text-green-400";
    if (field.value.includes("MEDIUM")) return "text-yellow-400";
    if (field.value.includes("HIGH")) return "text-red-400";
  }

  // AI Thesis — subtle blue to highlight it's AI-generated
  if (field.label.includes("AI Thesis")) return "text-blue-300";

  // Liquidity
  if (field.label.includes("Liquidity")) return "text-gray-300";

  return "text-gray-300";
}

function LedgerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="text-gray-400"
    >
      {/* Simplified Ledger-like icon */}
      <rect
        x="2"
        y="4"
        width="20"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="6" y="8" width="12" height="8" rx="1" fill="currentColor" opacity="0.2" />
      <path d="M6 8h12v8H6z" stroke="currentColor" strokeWidth="1" rx="1" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
