# Whisper — Private Prediction Markets

AI-curated prediction markets with privacy, identity, and hardware security.

## Architecture

```
User (Browser)
  |
  |-- Wallet -------- EVM wallet via Reown/wagmi (user identifier)
  |-- Ledger -------- ERC-7730 Clear Signing with AI analysis
  |
  v
  Unlink Privacy Pool (Base Sepolia)
        | withdraw to fresh burner (1 burner per bet)
        v
  Burner Wallet (Base Sepolia)
        | CCTP V2 bridge
        v
  Burner Wallet (Polygon Amoy)
        | prepareCondition + splitPosition
        v
  Polymarket CTF (Amoy testnet)
```

## Why Not Atomic? (execute() + CCTP)

We tested using Unlink's `execute()` to do the outbound flow atomically:

```
execute({
  withdrawals: [{ token: USDC, amount }],
  calls: [
    approve(USDC, TokenMinter, amount),
    depositForBurn(amount, polygonDomain, burnerPolygon, USDC, ...)
  ],
  outputs: [{ recipient_address: self, token: USDC, min_amount: "0" }]
})
```

**Result: fails.** The execute() transaction is `accepted` then `failed`.

**Root cause:** Unlink's execute adapter works as unshield -> calls -> reshield. The CCTP `depositForBurn` **burns** all the USDC (sends it cross-chain). After the calls, there are 0 USDC left for the adapter to reshield. The ZK circuit expects to produce output notes, but there's nothing to put in them. The proof generation fails.

**This is a fundamental limitation of execute() for cross-chain operations.** Execute works for same-chain DeFi (swaps, lending) where tokens come back to the adapter. It doesn't work when tokens leave the chain entirely (CCTP burn, bridge).

## Future: When Atomic Will Work

### Scenario 1: Unlink deploys on Polygon

If Unlink deploys its privacy pool on Polygon (same chain as Polymarket), the flow becomes:

```
execute({
  withdrawals: [{ token: USDC, amount }],
  calls: [
    approve(USDC, CTF, amount),
    splitPosition(USDC, conditionId, [1, 2], amount)
  ],
  outputs: [{ token: YES_TOKEN, min_amount: shares }]  // reshield outcome tokens
})
```

**1 atomic transaction. No burner. No bridge. No gas costs.** The outcome tokens (YES/NO) get reshielded back into the privacy pool. Privacy is perfect — nobody knows who holds what position.

### Scenario 2: Polymarket deploys on Base

Same idea — if Polymarket's CTF contracts deploy on Base (where Unlink already is), execute() works atomically. The adapter unshields USDC, splits into outcome tokens, and reshields them.

### Scenario 3: Cross-chain execute with intent protocols

Future intent protocols (ERC-7683, cross-chain intents) could enable atomic cross-chain operations where the solver handles the bridge. The user's execute() sends tokens to the solver, and the solver delivers on the destination chain. This is the long-term vision.

## Current Flow (Multi-TX)

```
OUTBOUND (4 steps, ~3-5 min):
  1. Withdraw USDC from pool -> fresh burner on Base (~13s)
  2. Burner approves + burns USDC via CCTP (~5s)
  3. Wait for Circle attestation (~2-5 min)
  4. Receive USDC on Polygon + bet on CTF (~10s)

RETURN (5 steps, ~3-5 min):
  1. Redeem winning outcome tokens -> USDC on Polygon
  2. Approve + burn USDC via CCTP -> Base
  3. Wait for Circle attestation (~2-5 min)
  4. Receive USDC on Base
  5. Deposit USDC back into Unlink pool (reshield)
```

**Privacy model:** Each bet uses a NEW burner wallet. No two bets share a burner. The link between the user and their bets is broken by the Unlink ZK pool.

## Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| AI | Mistral/Claude/Groq | Market analysis, thesis, catalysts, risk scoring |
| Privacy | Unlink | ZK privacy pool, burner wallets, shielded balances |
| Identity | Wallet (Reown/wagmi) | User identification via connected wallet address |
| Hardware | Ledger (ERC-7730) | Clear Signing with AI analysis on device screen |
| Markets | Polymarket (Gamma API) | Real market data, CTF testnet for bets |
| Bridge | Circle CCTP V2 | Base Sepolia <> Polygon Amoy cross-chain USDC |
| Agents | Whisper Agent Platform | AI agents authorized by wallet owners |

## Setup

```bash
cp .env.example .env.local
# Set: MISTRAL_API_KEY, UNLINK_*
npm install
npm run dev
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/markets` | GET | AI-curated market feed |
| `/api/balances` | POST | Pool + on-chain balances |
| `/api/deposit` | POST | Deposit USDC to Unlink pool |
| `/api/withdraw` | POST | Withdraw from pool |
| `/api/bet/execute` | POST | Full bet pipeline |
| `/api/portfolio` | GET | User bets by address |
| `/api/agents/register` | POST | Register AI agent |
| `/api/agents` | GET | Agent leaderboard |
| `/api/agents/trade` | POST | Agent trade endpoint |
| `/api/wallets` | GET | Burner wallet tracking |
