# Grantees | x402-Paid Grant Intelligence & Capital Access API (Avalanche Fuji)

Grantees is a **paid API** (x402 v2) that helps builders:
- **Analyze a GitHub repo** (activity, languages, quality signals)
- **Generate a quality score**
- **Match the project** to relevant grants/opportunities (starting with Avalanche-aligned programs)
- Pay per request using **USDC on Avalanche Fuji** via **x402 facilitator settlement**

This repo is based on the x402 Starter Kit and modified into a **REST API** with a **paid endpoint**.

---

## What’s included

### Core endpoints
- `GET /health` — API status + payment config
- `POST /v1/github/analyze-paid` — **Paid** GitHub repo analysis (x402 required)
- `POST /process` — Starter-kit A2A demo endpoint (optional)
- `POST /test` — Local smoke test for `/process` (optional)

### Payment model
- **x402 v2**
- Network: **`avalanche-fuji`** (or CAIP-2 `eip155:43113`)
- Asset: **USDC on Fuji**
- Settlement: **Facilitator mode** (recommended for testnet + Codespaces)

---

## Project structure

Typical relevant paths:

src/
contracts/
github.ts              # Request/response schemas for github analysis
grants.ts              # Grant matching schemas (if used)
services/
grantees/
index.ts             # Main API logic (analyzeGithubRepo etc.)
MerchantExecutor.ts      # x402 merchant logic: requirements, verify, settle
facilitator.ts           # Local facilitator server (verify + settle)
server.ts                # Express server + paid endpoint
routes.ts                # Optional (if you route via controller pattern)

---

## Requirements

- Node.js 18+ (Codespaces is fine)
- npm
- A funded Avalanche Fuji wallet for testing paid flow:
  - Fuji AVAX (for gas)
  - Fuji USDC (for payments)

---

## Quick start (Codespaces)

### 1) Install
```bash
npm install

2) Create .env

Create a .env at repo root:

PORT=3000
PUBLIC_BASE_URL=http://localhost:3000

# Merchant receives payments here
PAY_TO_ADDRESS=0xYourFujiWalletAddress

# Avalanche Fuji
NETWORK=avalanche-fuji
SETTLEMENT_MODE=facilitator

# Payments (optional toggles your service can use)
PAYMENTS_ENABLED=true
PRICE_REPO_ANALYSIS_USDC=0.10
PRICE_GRANT_MATCH_USDC=0.05

# Service config
REPO_ANALYSIS_CACHE_TTL_SECONDS=86400
RATE_LIMIT_PER_MINUTE=30

# GitHub token (recommended for higher rate limits)
GITHUB_TOKEN=github_pat_xxx

# OpenAI (only required if you keep /process or use LLM inside services)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-xxx

# Local facilitator URL (required for facilitator mode if not using default)
FACILITATOR_URL=http://localhost:4022

# Test client wallet (used by paid-flow runner)
CLIENT_PRIVATE_KEY=0xYourClientWalletPrivateKey

⚠️ Never commit your .env to GitHub.

⸻

Running locally (2 terminals)

Terminal A — Start facilitator

npm run dev:facilitator

Expected:
	•	Facilitator running on http://localhost:4022
	•	/health and /supported available

Terminal B — Start API server

npm run dev

Expected:
	•	Server running on http://localhost:3000
	•	Paid endpoint: POST /v1/github/analyze-paid

⸻

Test the API

1) Health check

curl http://localhost:3000/health

2) Expect 402 Payment Required (no payment)

curl -i -X POST http://localhost:3000/v1/github/analyze-paid \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/Talent-Index/team1-dashboard",
    "depth": "standard"
  }'

You should see:
	•	HTTP status 402
	•	a JSON body with x402Version and accepts[] payment requirements

3) Full paid flow (runner)

This repo includes a full paid-flow runner at:
	•	src/testPaidFlow.ts → built to dist/testPaidFlow.js

Run:

npm run build
node dist/testPaidFlow.js

If configured correctly, you should see:
	•	402 payment requirement
	•	payment payload created + submitted
	•	verification success
	•	settlement success with tx hash (if settlement is enabled)

⸻

Paid endpoint spec

POST /v1/github/analyze-paid

Body

{
  "repoUrl": "https://github.com/OWNER/REPO",
  "depth": "standard"
}

Payment submission
You can provide payment payload in either:
	•	paymentPayload field in request body (recommended for testing)
	•	x402-payment-payload header (stringified JSON)

Responses
	•	402 — payment required (returns x402 requirements)
	•	400 — invalid request body
	•	200 — success response:

{
  "success": true,
  "payer": "0x...",
  "settlement": {
    "success": true,
    "transaction": "0x...",
    "network": "eip155:43113",
    "payer": "0x..."
  },
  "result": {
    "repo": { "...": "..." },
    "score": 0.82,
    "signals": { "...": "..." },
    "recommendations": [ "..."],
    "grantMatches": [ "..."]
  }
}


⸻

Notes on Avalanche Fuji + USDC
	•	USDC contract on Avalanche Fuji is commonly configured as:
	•	0x5425890298aed601595a70AB815c96711a31Bc65

Your MerchantExecutor can use built-in network config to set the correct asset automatically.

⸻

Deployment

Codespaces / Dev
	•	Facilitator + server can run inside Codespaces
	•	Expose ports 3000 and 4022 publicly only if needed

Production guidance
	•	Use HTTPS
	•	Use your own facilitator OR direct settlement (EVM only)
	•	Add rate limiting + logging + monitoring
	•	Store repo analysis results in a DB cache if traffic grows

⸻

Troubleshooting

“Expected 402 but got 200”
	•	You are sending a payment payload unintentionally, OR
	•	Your service isn’t enforcing payment requirements

“Payment verification failed”

Most common causes:
	•	Wrong network (legacy vs CAIP-2 mismatch)
	•	Incorrect chainId/domain in EIP-712 (if using direct settlement)
	•	Insufficient USDC for payer
	•	Facilitator not running or unreachable (FACILITATOR_URL)

“Settlement failed”
	•	Facilitator wallet not funded / not configured
	•	RPC issues
	•	USDC contract mismatch

⸻

Scripts

From package.json:
	•	npm run build — compile to dist/
	•	npm run dev — build + run server
	•	npm run dev:facilitator — build + run facilitator
	•	npm run start — run compiled server
	•	npm run start:facilitator — run compiled facilitator

⸻

Roadmap (suggested)
	•	Add POST /v1/grants/match-paid (paid grant matching)
	•	Add caching layer (Supabase/Redis)
	•	Add user-level quota + API keys
	•	Add structured grant database + scoring model
	•	Add webhook/event stream for payment receipts

⸻

License

MIT

