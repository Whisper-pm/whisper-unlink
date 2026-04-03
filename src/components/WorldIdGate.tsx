"use client";

import { useIDKitRequest, orbLegacy } from "@worldcoin/idkit";
import { CONFIG } from "@/lib/config";
import { useState, useEffect, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onVerified?: (nullifierHash: string) => void;
}

function RealWorldIdButton({ onSuccess, loading: parentLoading }: { onSuccess: (proof: any) => void; loading: boolean }) {
  const [rpContext, setRpContext] = useState<any>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch signed rp_context from backend on mount
  useEffect(() => {
    fetch("/api/worldid")
      .then((r) => r.json())
      .then((d) => {
        if (d.rp_context) setRpContext(d.rp_context);
        else setFetchError(d.error ?? "Failed to get rp_context");
      })
      .catch((e) => setFetchError(e.message));
  }, []);

  const hookConfig = rpContext
    ? {
        app_id: CONFIG.worldId.appId as `app_${string}`,
        action: CONFIG.worldId.action,
        preset: orbLegacy(),
        rp_context: rpContext,
        allow_legacy_proofs: true,
      }
    : null;

  const { open, result, errorCode } = useIDKitRequest(
    hookConfig ?? {
      app_id: CONFIG.worldId.appId as `app_${string}`,
      action: CONFIG.worldId.action,
      preset: orbLegacy(),
      rp_context: { rp_id: "", nonce: "", created_at: 0, expires_at: 0, signature: "" },
      allow_legacy_proofs: true,
    }
  );

  // When we get a result, forward it
  useEffect(() => {
    if (result && !parentLoading) {
      onSuccess(result);
    }
  }, [result, parentLoading, onSuccess]);

  if (fetchError) {
    return <p className="text-xs text-red-400">World ID setup error: {fetchError}</p>;
  }

  return (
    <button
      onClick={() => rpContext && open()}
      disabled={parentLoading || !rpContext}
      className="bg-white text-black font-semibold px-10 py-3.5 rounded-full hover:bg-gray-100 transition disabled:opacity-50 shadow-lg"
    >
      {parentLoading ? "Verifying..." : !rpContext ? "Loading World ID..." : "Verify with World ID"}
    </button>
  );
}

export function WorldIdGate({ children, onVerified }: Props) {
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRealAppId = CONFIG.worldId.appId.startsWith("app_") && !CONFIG.worldId.appId.includes("staging");

  async function handleSuccess(proof: any) {
    if (loading || verified) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proof),
      });
      const data = await res.json();
      if (data.success) {
        setVerified(true);
        onVerified?.(data.nullifier);
      } else {
        setError(data.error ?? "Verification failed");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (verified) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-purple-500/20">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
          </svg>
        </div>
        <h2 className="text-3xl font-bold mb-3">Prove you are human</h2>
        <p className="text-gray-400 max-w-md mx-auto leading-relaxed">
          Whisper uses World ID to ensure <strong className="text-white">one person = one anonymous account</strong>.
          Zero-knowledge proofs protect your identity.
        </p>
      </div>

      <div className="flex flex-col gap-3 items-center">
        {isRealAppId ? (
          <RealWorldIdButton onSuccess={handleSuccess} loading={loading} />
        ) : (
          <button
            onClick={() => handleSuccess({ nullifier_hash: "demo:" + Date.now() })}
            disabled={loading}
            className="bg-white text-black font-semibold px-10 py-3.5 rounded-full hover:bg-gray-100 transition disabled:opacity-50 shadow-lg"
          >
            {loading ? "Verifying..." : "Verify with World ID (Demo)"}
          </button>
        )}

        {isRealAppId && (
          <p className="text-xs text-green-600">World ID 4.0 active</p>
        )}
      </div>

      {error && <p className="text-xs text-red-400 max-w-sm text-center">{error}</p>}

      <div className="flex gap-6 mt-4 text-xs text-gray-600">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          Zero-Knowledge
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
          Sybil-Resistant
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
          Privacy-Preserving
        </div>
      </div>
    </div>
  );
}
