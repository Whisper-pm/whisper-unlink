# Ledger Integration — Whisper

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    WHISPER APP                        │
│                                                       │
│  Ledger Button (floating, bottom-right)               │
│  ├── EIP-6963 provider (detected by Reown)           │
│  ├── originToken: 1e55ba...0e5                       │
│  └── dAppIdentifier: "whisper"                       │
│                                                       │
│  When signing a bet, the Ledger screen shows:        │
│  ┌─────────────────────────────┐                     │
│  │ AI-Analyzed Prediction Bet   │                     │
│  │ Market: Will ETH > $10K?    │                     │
│  │ Position: YES                │                     │
│  │ Amount: 5.00 USDC           │                     │
│  │ AI Score: 85/100            │                     │
│  │ Risk: MEDIUM Risk           │                     │
│  │ AI Thesis: Strong momentum  │                     │
│  │ Liquidity: 500,000 USDC     │                     │
│  │                              │                     │
│  │ ✓ Hold to sign              │                     │
│  └─────────────────────────────┘                     │
└─────────────────────────────────────────────────────┘
```

## Setup pour la demo

### Étape 1 : Premier connect avec le vrai Ledger Stax

Le vrai device doit se connecter EN PREMIER pour établir la "trust chain"
via Ledger Sync. Cela enregistre le device auprès du backend Ledger.

1. Allume le Ledger Stax
2. Déverrouille (PIN: 2206)
3. Ouvre l'app Ethereum
4. Va sur http://localhost:3456
5. Clique le bouton Ledger flottant (bas-droite)
6. Le Stax se connecte via **Bluetooth** (pas besoin d'USB !)
   - Le Ledger Button supporte WebBLE (Bluetooth Low Energy)
   - Chrome/Edge supportent WebBLE nativement
   - Safari ne supporte PAS WebBLE — utiliser Chrome
7. La trust chain est établie — le backend Ledger sauvegarde l'index
8. Tu peux déconnecter le Stax

### Étape 2 : Switch sur Speculos

Une fois la trust chain établie avec le vrai device :

1. Speculos tourne déjà avec la même seed :
   ```
   docker run -d --name speculos-flex \
     -p 40000:40000 -p 41000:41000 -p 5001:5000 \
     -v .../flex/bin/app.elf:/app.elf \
     ghcr.io/ledgerhq/speculos \
     --model flex --display headless \
     --seed "walk crystal guard cute key betray narrow oak humble embark account road month model fringe duty drive taste immense warfare garden print feature luggage" \
     /app.elf
   ```

2. L'app détecte `NEXT_PUBLIC_LEDGER_SPECULOS=true` dans .env.local
3. Le Ledger Button se connecte à Speculos via TCP (port 40000)
4. Speculos hérite de la trust chain (même seed = mêmes clés)
5. Les métadatas ERC-7730 sont acceptées par Speculos (test PKI keys)
6. Le Clear Signing affiche les vrais labels sur l'écran émulé

### Pourquoi le vrai device d'abord ?

- Le vrai Ledger crée une **trust chain** via Ledger Sync
- Cette trust chain est stockée côté backend Ledger
- Sans ça, Speculos ne peut pas s'authentifier auprès du backend
- Le vrai device **rejette** les métadatas ERC-7730 custom (pas signées par Ledger PKI)
- Speculos **accepte** les métadatas signées avec les test keys
- Donc : vrai device pour la confiance, Speculos pour le Clear Signing

## Connexion Bluetooth (Stax)

Le Ledger Stax supporte le Bluetooth Low Energy (BLE). Le Ledger Button
utilise WebBLE pour se connecter sans câble :

- **Chrome/Edge** : WebBLE supporté nativement
- **Safari** : WebBLE **NON supporté** — utiliser Chrome
- **Firefox** : WebBLE **NON supporté** — utiliser Chrome
- **Brave** : WebBLE supporté

Pas besoin d'USB. Le Stax se connecte via Bluetooth directement depuis
le navigateur.

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `src/lib/useLedgerButton.ts` | Hook React qui initialise le Ledger Button |
| `src/lib/ledger.ts` | DMK integration, signing, Clear Signing |
| `src/lib/erc7730-context.ts` | Context module custom pour les descripteurs |
| `src/erc7730/*.json` | Descripteurs ERC-7730 (4 fichiers) |
| `src/components/LedgerClearSignPreview.tsx` | Preview UI de ce que le Ledger affiche |
| `src/components/BetModal.tsx` | Intègre le signing Ledger dans le flow de bet |
| `api/index.py` | Backend Python qui signe les descripteurs avec test PKI |

## ERC-7730 Descripteurs

4 descripteurs créés (premier prediction market avec ERC-7730) :

| Descripteur | Contrat | Chain |
|------------|---------|-------|
| `whisper-bet.json` | WhisperBet (AI + bet) | Base Sepolia |
| `polymarket-ctf-exchange.json` | Polymarket CTF | Polygon |
| `polymarket-neg-risk-exchange.json` | Polymarket Neg Risk | Polygon |
| `permit2-usdc.json` | Permit2 token approval | Base Sepolia |

### Sans Clear Signing (blind signing)
```
⚠️ Blind signing ahead
Review struct: WhisperBet
amount: 500000000          ← c'est combien ?
aiScore: 78                ← c'est quoi ?
timestamp: 1743782400      ← ???
```

### Avec Clear Signing (nos descripteurs)
```
✅ AI-Analyzed Prediction Bet
Market: Will ETH hit $5,000 by July 2026?
Position: YES
Amount (USDC): 500.00
AI Score: 78/100
Risk: MEDIUM Risk
AI Thesis: Strong momentum with institutional inflows
```

## Credentials

- **originToken / API Key** : `1e55ba3959f4543af24809d9066a2120bd2ac9246e626e26a1ff77eb109ca0e5`
- **dAppIdentifier** : `whisper`
- **Seed (24 mots)** : stockée localement, même seed sur vrai device et Speculos
- **PIN** : 2206
- **Adresse dérivée** : `0x7Dfa52e3D1a529aCd40D141414d465F2ED38090D` (chemin 44'/60'/0'/0/0)

## PR LedgerHQ Registry

Fork préparé : `Whisper-pm/clear-signing-erc7730-registry`
Branche : `feat/whisper-polymarket-clear-signing`
3 descripteurs prêts (passent erc7730 lint 0 erreurs) :
- whisper/eip712-WhisperBet.json
- polymarket/eip712-CTFExchange.json
- polymarket/eip712-NegRiskExchange.json

PR non ouverte — en attente de validation complète.

## CAL Backend (local)

Le backend Python (`api/index.py`) convertit nos ERC-7730 JSON en format
binaire CAL et les signe avec les test PKI keys. Speculos accepte ces
signatures.

```bash
# Setup
python3.12 -m venv .venv
source .venv/bin/activate
pip install Flask requests ecdsa erc7730 eip712-clearsign

# Run (port 5050)
python api/index.py
```

## Bounties Ledger visés

- **🤖 AI Agents x Ledger ($6K)** : AI analysis affiché en Clear Signing sur le device. Premier prediction market avec ERC-7730. Human-in-the-loop : le Ledger approuve les bets avec l'analyse AI visible.

- **🔒 Clear Signing, Integrations & Apps ($4K)** : 4 descripteurs ERC-7730 créés. Repo dédié avec validation + tests Speculos. PR prête pour le registre LedgerHQ.
