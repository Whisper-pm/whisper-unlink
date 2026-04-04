#!/bin/bash
# Initialize the local CAL backend with our ERC-7730 descriptors
# Run this before starting the app in Speculos mode

CAL_URL="${CAL_BACKEND_URL:-http://localhost:5050}"
REGISTRY_DIR="${1:-$(dirname $0)/../src/erc7730}"

echo "=== Initializing CAL backend at $CAL_URL ==="

# Use the corrected descriptors from the registry fork if available
REGISTRY_FORK="$(dirname $0)/../../clear-signing-erc7730-registry/registry"
if [ -d "$REGISTRY_FORK" ]; then
  echo "Using descriptors from registry fork"
  DESCRIPTORS=(
    "$REGISTRY_FORK/whisper/eip712-WhisperBet.json"
    "$REGISTRY_FORK/polymarket/eip712-CTFExchange.json"
    "$REGISTRY_FORK/polymarket/eip712-NegRiskExchange.json"
  )
else
  echo "Using local descriptors"
  DESCRIPTORS=(
    "$REGISTRY_DIR/whisper-bet.json"
    "$REGISTRY_DIR/polymarket-ctf-exchange.json"
    "$REGISTRY_DIR/polymarket-neg-risk-exchange.json"
  )
fi

for desc in "${DESCRIPTORS[@]}"; do
  if [ -f "$desc" ]; then
    name=$(basename "$desc")
    echo -n "  Processing $name... "
    result=$(curl -s -X POST "$CAL_URL/api/process-erc7730-descriptor" \
      -H "Content-Type: application/json" \
      -d @"$desc" 2>&1)
    if echo "$result" | grep -q "descriptors"; then
      echo "OK ✓"
    else
      echo "FAIL: $(echo $result | head -c 100)"
    fi
  fi
done

# Fetch and store certificates
echo -n "  Fetching certificates... "
certs=$(curl -s "$CAL_URL/api/certificates" 2>&1)
if echo "$certs" | grep -q "certificates"; then
  echo "OK ✓"
else
  echo "FAIL: $(echo $certs | head -c 100)"
fi

echo "=== Done ==="
