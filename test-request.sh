#!/bin/bash
set -e

PORT=${PORT:-3000}
HOST="http://localhost:${PORT}"

echo "🧪 Testing Grantees x402 API (Avalanche Fuji)"
echo "HOST: ${HOST}"
echo ""

# Ensure jq exists (nice output). If not, we still run and print raw.
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
# 1) Health check
# -------------------------
echo "1️⃣  GET /health"
curl -s "${HOST}/health" | pretty || echo "❌ Health check failed"
echo ""
echo "---------------------------------------------"
echo ""

# -------------------------
# 2) Paid endpoint without payment (expect 402)
# -------------------------
echo "2️⃣  POST /v1/github/analyze-paid  (no payment) — EXPECT 402"
RESP_HEADERS="$(mktemp)"
RESP_BODY="$(mktemp)"

HTTP_CODE=$(curl -s -o "$RESP_BODY" -D "$RESP_HEADERS" -w "%{http_code}" \
  -X POST "${HOST}/v1/github/analyze-paid" \
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

# Quick sanity checks for x402 fields
if grep -q "\"accepts\"" "$RESP_BODY" && grep -q "\"x402Version\"" "$RESP_BODY"; then
  echo "✅ x402 fields present: x402Version + accepts[]"
else
  echo "⚠️ x402 fields missing (check your MerchantExecutor.createPaymentRequiredResponse())"
fi

rm -f "$RESP_HEADERS" "$RESP_BODY"

echo ""
echo "---------------------------------------------"
echo ""
echo "✅ Test complete!"
echo ""
echo "Next (when ready): use an x402-compatible client to:"
echo "  1) read accepts[] from the 402 response"
echo "  2) create a payment payload on Fuji USDC"
echo "  3) POST again with paymentPayload included"
