#!/bin/bash
# Complete test script for Grantees x402 API (Avalanche Fuji)
# Tests: health + 402 payment required + full paid flow via existing dist/testClient.js
# No new files, no new packages.

set -e

PORT=${PORT:-3000}
HOST=${PUBLIC_BASE_URL:-"http://localhost:${PORT}"}
ENDPOINT="/v1/github/analyze-paid"

echo "🧪 Grantees x402 API Test Suite (Avalanche Fuji)"
echo "================================================"
echo ""
echo "HOST: ${HOST}"
echo "ENDPOINT: ${ENDPOINT}"
echo ""

# -------------------------
# 0) Dependencies
# -------------------------
HAS_JQ=1
command -v jq >/dev/null 2>&1 || HAS_JQ=0

pretty() {
  if [ "$HAS_JQ" -eq 1 ]; then
    jq '.'
  else
    cat
  fi
}

# -------------------------
# 1) Check if API is running
# -------------------------
echo "1️⃣ Checking if API is running..."
if ! curl -s "${HOST}/health" > /dev/null 2>&1; then
  echo "❌ API is not running!"
  echo ""
  echo "Start the services:"
  echo "  npm run dev:facilitator"
  echo "  npm run dev:server"
  echo ""
  exit 1
fi
echo "✅ API is running"
echo ""

# -------------------------
# 2) Health check output
# -------------------------
echo "2️⃣ GET /health"
curl -s "${HOST}/health" | pretty || echo "❌ Health check failed"
echo ""
echo "---------------------------------------------"
echo ""

# -------------------------
# 3) 402 payment required flow (Grantees endpoint)
# -------------------------
echo "3️⃣ POST ${ENDPOINT} (no payment) — EXPECT 402"
RESP_HEADERS="$(mktemp)"
RESP_BODY="$(mktemp)"

HTTP_CODE=$(curl -s -o "$RESP_BODY" -D "$RESP_HEADERS" -w "%{http_code}" \
  -X POST "${HOST}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/Talent-Index/team1-dashboard",
    "depth": "standard"
  }')

echo "HTTP Status: ${HTTP_CODE}"
echo ""
echo "Response body:"
cat "$RESP_BODY" | pretty || true
echo ""

if [ "$HTTP_CODE" != "402" ]; then
  echo "❌ Expected HTTP 402 but got ${HTTP_CODE}"
  echo ""
  echo "Response headers:"
  cat "$RESP_HEADERS"
  rm -f "$RESP_HEADERS" "$RESP_BODY"
  exit 1
fi

echo "✅ Got 402 Payment Required (expected)."
echo ""

# Save payment requirements to file (helpful for debugging)
cp "$RESP_BODY" payment-required.json
echo "💾 Saved payment requirements to: payment-required.json"
echo ""

# Sanity check for x402 fields
if grep -q "\"accepts\"" "$RESP_BODY" && grep -q "\"x402Version\"" "$RESP_BODY"; then
  echo "✅ x402 fields present: x402Version + accepts[]"
else
  echo "⚠️ x402 fields missing — check MerchantExecutor.createPaymentRequiredResponse()"
fi

rm -f "$RESP_HEADERS" "$RESP_BODY"

echo ""
echo "---------------------------------------------"
echo ""

# -------------------------
# 4) Full paid flow runner (existing)
# -------------------------
# We reuse the repo’s existing test client instead of adding new files.
# NOTE: testClient.js must be updated to hit /v1/github/analyze-paid and handle x402 v2.
#
if [ ! -d "dist" ]; then
  echo "4️⃣ dist/ not found — building project..."
  npm run build
  echo ""
fi

if [ -f "dist/testClient.js" ]; then
  echo "4️⃣ Running full paid-flow runner: node dist/testClient.js"
  echo ""
  node dist/testClient.js
  echo ""
  echo "✅ Full paid-flow test runner completed!"
else
  echo "❌ dist/testClient.js not found."
  echo ""
  echo "Build + run:"
  echo "  npm run build"
  echo "  node dist/testClient.js"
  echo ""
  exit 1
fi

echo "✅ Test suite complete!"
