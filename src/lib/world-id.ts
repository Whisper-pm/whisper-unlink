// World ID integration: verification, incognito actions, session management

import { CONFIG } from "./config";

export interface VerificationResult {
  success: boolean;
  nullifier: string;
  verificationLevel?: string;
}

/**
 * Verify a World ID proof via cloud API.
 * Returns the nullifier hash (anonymous unique identity).
 */
export async function verifyWorldId(proof: any): Promise<VerificationResult> {
  const res = await fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proof),
  });
  return res.json();
}

/**
 * Create an incognito action for repeated verifications.
 * Allows the same user to verify multiple times (one per bet).
 * Each verification produces a different nullifier (bets are unlinkable).
 */
export async function createIncognitoAction(actionId: string, maxVerifications = 100) {
  // In production: call World API to create incognito action
  // POST https://developer.worldcoin.org/api/v2/create-action/{appId}
  // { action: actionId, max_verifications: maxVerifications }
  return {
    actionId,
    maxVerifications,
    created: true,
  };
}

/**
 * Session proof management.
 * After initial World ID verification, maintain a session
 * so users don't need to re-verify for every bet.
 */
export class WorldIdSession {
  private nullifier: string | null = null;
  private sessionId: string | null = null;
  private expiresAt: number = 0;

  get isActive(): boolean {
    return this.nullifier !== null && Date.now() < this.expiresAt;
  }

  get currentNullifier(): string | null {
    return this.isActive ? this.nullifier : null;
  }

  /**
   * Start a session after successful World ID verification.
   * Session lasts 1 hour by default.
   */
  start(nullifier: string, durationMs = 3_600_000) {
    this.nullifier = nullifier;
    this.sessionId = "session-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    this.expiresAt = Date.now() + durationMs;
  }

  /**
   * End the current session.
   */
  end() {
    this.nullifier = null;
    this.sessionId = null;
    this.expiresAt = 0;
  }

  /**
   * Get session info for API calls.
   */
  getSessionHeaders(): Record<string, string> {
    if (!this.isActive) return {};
    return {
      "X-World-Nullifier": this.nullifier!,
      "X-World-Session": this.sessionId!,
    };
  }
}

// Global session instance
export const worldIdSession = new WorldIdSession();
