// Whisper — Agent Registration Store with JSON file persistence
// Persists to data/agents.json for durability across restarts
// Each agent is traceable back to a wallet address

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const STORE_PATH = join(process.cwd(), "data", "agents.json");

export interface AgentLimits {
  maxBetSize: number;       // max USDC per bet
  maxDailyVolume: number;   // max daily volume in USDC
  allowedMarkets: string[] | "all"; // which conditionIds can trade
}

export interface AgentStats {
  totalBets: number;
  totalVolume: number;
  winRate: number;          // 0-100
  pnl: number;             // USDC P&L
  todayVolume: number;
  lastResetDay: string;     // YYYY-MM-DD for daily volume reset
}

export interface AgentRegistration {
  agentId: string;
  agentWallet: string;      // agent's EVM address
  humanAddress: string;     // wallet address of the authorizing human
  name: string;
  createdAt: number;        // unix ms
  status: "active" | "paused" | "revoked";
  limits: AgentLimits;
  stats: AgentStats;
}

// ---------- Constants ----------

const MAX_AGENTS_PER_HUMAN = 5;

// ---------- JSON Persistence ----------

interface PersistedData {
  agents: Record<string, AgentRegistration>;
  addressIndex: Record<string, string[]>;
}

function loadFromDisk(): { agentStore: Map<string, AgentRegistration>; addressIndex: Map<string, Set<string>> } {
  if (!existsSync(STORE_PATH)) {
    return { agentStore: new Map(), addressIndex: new Map() };
  }
  try {
    const raw: PersistedData = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    const agents = new Map<string, AgentRegistration>();
    for (const [key, value] of Object.entries(raw.agents || {})) {
      // Migration: rename humanNullifier -> humanAddress if present
      const agent = value as any;
      if (agent.humanNullifier && !agent.humanAddress) {
        agent.humanAddress = agent.humanNullifier;
        delete agent.humanNullifier;
      }
      agents.set(key, agent);
    }
    const index = new Map<string, Set<string>>();
    // Support both old nullifierIndex and new addressIndex keys
    const indexData = raw.addressIndex || (raw as any).nullifierIndex || {};
    for (const [key, value] of Object.entries(indexData)) {
      index.set(key, new Set(value as string[]));
    }
    return { agentStore: agents, addressIndex: index };
  } catch {
    return { agentStore: new Map(), addressIndex: new Map() };
  }
}

function saveToDisk() {
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data: PersistedData = {
    agents: {},
    addressIndex: {},
  };
  for (const [key, value] of agentStore.entries()) {
    data.agents[key] = value;
  }
  for (const [key, value] of addressIndex.entries()) {
    data.addressIndex[key] = Array.from(value);
  }
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

// ---------- Store (loaded from disk) ----------

const loaded = loadFromDisk();
const agentStore = loaded.agentStore;
const addressIndex = loaded.addressIndex;

// ---------- Helpers ----------

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyVolumeIfNeeded(agent: AgentRegistration): void {
  const today = todayKey();
  if (agent.stats.lastResetDay !== today) {
    agent.stats.todayVolume = 0;
    agent.stats.lastResetDay = today;
  }
}

function generateAgentId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- Public API ----------

export function registerAgent(params: {
  humanAddress: string;
  agentWallet: string;
  name: string;
  limits?: Partial<AgentLimits>;
}): { success: true; agent: AgentRegistration } | { success: false; error: string } {
  const { humanAddress, agentWallet, name, limits } = params;

  // Validate inputs
  if (!humanAddress || !agentWallet || !name) {
    return { success: false, error: "Missing required fields: humanAddress, agentWallet, name" };
  }

  if (!agentWallet.startsWith("0x") || agentWallet.length !== 42) {
    return { success: false, error: "Invalid agent wallet address" };
  }

  // Rate limit: max agents per human
  const existingAgents = addressIndex.get(humanAddress);
  const activeCount = existingAgents
    ? Array.from(existingAgents).filter((id) => {
        const a = agentStore.get(id);
        return a && a.status !== "revoked";
      }).length
    : 0;

  if (activeCount >= MAX_AGENTS_PER_HUMAN) {
    return {
      success: false,
      error: `Maximum ${MAX_AGENTS_PER_HUMAN} active agents per wallet. Revoke an existing agent first.`,
    };
  }

  // Check for duplicate wallet
  for (const [, existing] of agentStore) {
    if (existing.agentWallet.toLowerCase() === agentWallet.toLowerCase() && existing.status !== "revoked") {
      return { success: false, error: "This wallet is already registered as an agent" };
    }
  }

  const agent: AgentRegistration = {
    agentId: generateAgentId(),
    agentWallet: agentWallet.toLowerCase(),
    humanAddress,
    name: name.trim(),
    createdAt: Date.now(),
    status: "active",
    limits: {
      maxBetSize: limits?.maxBetSize ?? 500,
      maxDailyVolume: limits?.maxDailyVolume ?? 5000,
      allowedMarkets: limits?.allowedMarkets ?? "all",
    },
    stats: {
      totalBets: 0,
      totalVolume: 0,
      winRate: 0,
      pnl: 0,
      todayVolume: 0,
      lastResetDay: todayKey(),
    },
  };

  agentStore.set(agent.agentId, agent);

  // Update index
  if (!addressIndex.has(humanAddress)) {
    addressIndex.set(humanAddress, new Set());
  }
  addressIndex.get(humanAddress)!.add(agent.agentId);

  saveToDisk();
  return { success: true, agent };
}

export function getAgent(agentId: string): AgentRegistration | null {
  return agentStore.get(agentId) ?? null;
}

export function getAgentsByHuman(address: string): AgentRegistration[] {
  const ids = addressIndex.get(address);
  if (!ids) return [];
  return Array.from(ids)
    .map((id) => agentStore.get(id)!)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getAllAgents(): AgentRegistration[] {
  return Array.from(agentStore.values())
    .filter((a) => a.status === "active")
    .sort((a, b) => b.stats.pnl - a.stats.pnl);
}

export function revokeAgent(
  agentId: string,
  address: string
): { success: true } | { success: false; error: string } {
  const agent = agentStore.get(agentId);
  if (!agent) {
    return { success: false, error: "Agent not found" };
  }
  if (agent.humanAddress !== address) {
    return { success: false, error: "Only the authorizing human can revoke this agent" };
  }
  if (agent.status === "revoked") {
    return { success: false, error: "Agent is already revoked" };
  }

  agent.status = "revoked";
  saveToDisk();
  return { success: true };
}

export function updateAgentStats(
  agentId: string,
  update: { betAmount: number; won?: boolean; pnl?: number }
): void {
  const agent = agentStore.get(agentId);
  if (!agent) return;

  resetDailyVolumeIfNeeded(agent);

  agent.stats.totalBets += 1;
  agent.stats.totalVolume += update.betAmount;
  agent.stats.todayVolume += update.betAmount;

  if (update.pnl !== undefined) {
    agent.stats.pnl += update.pnl;
  }

  // Recalculate win rate
  if (update.won !== undefined) {
    const totalDecided = agent.stats.totalBets; // simplified for demo
    const previousWins = Math.round((agent.stats.winRate / 100) * (totalDecided - 1));
    const newWins = previousWins + (update.won ? 1 : 0);
    agent.stats.winRate = totalDecided > 0 ? Math.round((newWins / totalDecided) * 100) : 0;
  }

  saveToDisk();
}

/**
 * Validate whether an agent can place a specific trade.
 * Returns null if valid, or an error string if invalid.
 */
export function validateAgentTrade(
  agentId: string,
  conditionId: string,
  amount: number
): string | null {
  const agent = agentStore.get(agentId);
  if (!agent) return "Agent not found";
  if (agent.status !== "active") return `Agent is ${agent.status}`;

  // Reset daily volume if needed
  resetDailyVolumeIfNeeded(agent);

  // Check bet size limit
  if (amount > agent.limits.maxBetSize) {
    return `Bet amount ${amount} USDC exceeds agent limit of ${agent.limits.maxBetSize} USDC`;
  }

  // Check daily volume limit
  if (agent.stats.todayVolume + amount > agent.limits.maxDailyVolume) {
    return `Daily volume limit would be exceeded (${agent.stats.todayVolume + amount} / ${agent.limits.maxDailyVolume} USDC)`;
  }

  // Check market restrictions
  if (agent.limits.allowedMarkets !== "all") {
    if (!agent.limits.allowedMarkets.includes(conditionId)) {
      return "Agent is not authorized to trade this market";
    }
  }

  return null; // valid
}
