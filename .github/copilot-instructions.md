# Copilot / AI Agent Instructions — Grantees API

Short context
- This repository implements a paid REST API that analyzes GitHub repos and matches them to grants. Payments use the x402 v2 model (preferred: Avalanche Fuji, USDC). See `README.md` for a high-level overview.

Big picture (what to know first)
- Entrypoint: `src/server.ts` — wiring, environment flags, and the paid endpoint `POST /v1/github/analyze-paid`.
- Payment orchestration: `src/MerchantExecutor.ts` — builds x402 payment requirements, verifies payloads, and either calls a facilitator or performs direct on-chain settlement.
- Local facilitator: `src/facilitator.ts` — optional local server used in `facilitator` settlement mode (runs on port 4022 by default).
- Business logic: `src/services/grantees/githubAnalyzeService.ts` (exported via `src/services/grantees/index.ts`) — orchestrates GitHub fetch, scoring, and grant matching.
- GitHub integration: `src/services/github/*` — `githubClient.ts` (simple fetch wrapper) and `fetchRepoSignals.ts` (data collected and shape).

Key workflows & commands (use these exactly)
- Install: `npm install`
- Dev facilitator (Terminal A): `npm run dev:facilitator` (starts `src/facilitator.ts`)
- Dev API server (Terminal B): `npm run dev` (starts `src/server.ts`)
- Build: `npm run build` → outputs `dist/` (used by `node dist/testPaidFlow.js` if you want to run the full paid-flow runner)
- Test paid flow runner: `node dist/testPaidFlow.js` after `npm run build` (see README for environment requirements)

Important environment variables (used across files)
- `PAY_TO_ADDRESS` — required (server exits if missing). See `src/server.ts`.
- `NETWORK`, `ASSET_ADDRESS`, `ASSET_NAME`, `CHAIN_ID` — used by `MerchantExecutor` and have built-in defaults for common testnets.
- Settlement mode selection: set `SETTLEMENT_MODE=direct|facilitator|local` or provide `FACILITATOR_URL` / `PRIVATE_KEY`. The logic lives in `src/server.ts` and affects `MerchantExecutor` behavior.
- Facilitator keys: `EVM_PRIVATE_KEY`, `FACILITATOR_EVM_NETWORK`, `FACILITATOR_EVM_RPC_URL` for `src/facilitator.ts`.
- GitHub token: `GITHUB_TOKEN` (optional but recommended for rate limits).

Project-specific patterns & conventions
- Payment payloads can be provided either as a header `x402-payment-payload` (stringified JSON) or in the request body `paymentPayload` (see `src/server.ts`).
- Error handling: endpoints return 402 with a x402-style `accepts[]` payment requirement when no payment is provided (see `MerchantExecutor.createPaymentRequiredResponse`).
- Network names: code accepts both legacy names (e.g., `avalanche-fuji`) and CAIP-2 (e.g., `eip155:43113`). `MerchantExecutor` maps legacy → CAIP-2.
- USDC atomic units: price is expressed in USDC decimals (6) and converted in `MerchantExecutor.getAtomicAmount`.
- GitHub fetch wrapper `src/services/github/githubClient.ts` throws on non-OK responses — callers assume valid JSON or exception.

Files to inspect for common tasks
- Read request/response schemas: `src/contracts/github.ts` and `src/contracts/grants.ts`.
- Payment flow and error parsing: `src/MerchantExecutor.ts` and `src/facilitator.ts` (both include helpful error-to-suggestion mapping).
- Core service: `src/services/grantees/githubAnalyzeService.ts` (quality score + grant matching). Examples: `fetchRepoSignals.ts`, `qualityScore.ts`, `grantsRepo.ts`, `matcher.ts`.

Examples to show patterns
- Paid request without payment (expect 402): see `src/server.ts` logic around `createPaymentRequiredResponse()`.
- Verification path (facilitator vs direct): `MerchantExecutor.verifyPayment()` calls `verifyPaymentLocally` when `direct` or `callFacilitator` when `facilitator`.

What NOT to change without follow-up
- Do not alter x402 requirement generation or verification logic without validating both `facilitator` and `direct` modes (tests or manual run needed).
- Avoid changing built-in network constants in `MerchantExecutor` unless you confirm downstream consumer expectations.

If unclear or incomplete
- Tell me which section you want expanded (examples, environment matrix, or sample curl requests) and I will iterate.

— end
