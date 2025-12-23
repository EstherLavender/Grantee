// server.ts
import express from "express";
import dotenv from "dotenv";
import cors, { type CorsOptions } from "cors";

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { MerchantExecutor, type MerchantExecutorOptions } from "./MerchantExecutor.js";
import { ethers } from "ethers";
import type { PaymentPayload } from "@x402/core/types";

import { AnalyzeRepoRequest } from "./contracts/github.js";
import { analyzeGithubRepo } from "./services/grantees/index.js";

dotenv.config();

const app = express();

// =============================================================================
// Env + config
// =============================================================================
const PORT = process.env.PORT || 3000;

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN; // e.g. https://repo-scout-pay.lovable.app

const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
const NETWORK = (process.env.NETWORK || "avalanche-fuji").toLowerCase();

const SETTLEMENT_MODE_ENV = process.env.SETTLEMENT_MODE?.toLowerCase();
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const FACILITATOR_URL = process.env.FACILITATOR_URL;
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;

const ASSET_ADDRESS = process.env.ASSET_ADDRESS;
const ASSET_NAME = process.env.ASSET_NAME;
const EXPLORER_URL = process.env.EXPLORER_URL;
const CHAIN_ID = process.env.CHAIN_ID ? Number.parseInt(process.env.CHAIN_ID, 10) : undefined;

const PRICE_REPO_ANALYSIS_USDC = process.env.PRICE_REPO_ANALYSIS_USDC
  ? Number.parseFloat(process.env.PRICE_REPO_ANALYSIS_USDC)
  : 0.1;

// =============================================================================
// Helpers (x402 header handshake + payload parsing)
// =============================================================================
function setPaymentRequiredHeaders(res: express.Response, payload: any) {
  const raw = JSON.stringify(payload);

  // Make it readable for browser clients (and multiple client variants)
  res.setHeader("payment-required", raw);
  res.setHeader("payment-response", raw);

  res.setHeader("x402-payment-required", raw);
  res.setHeader("x402-payment-response", raw);

  res.setHeader("x-402-payment-required", raw);
  res.setHeader("x-402-payment-response", raw);

  // Helpful for some clients that check www-authenticate patterns
  res.setHeader("www-authenticate", "x402");
}

function getPaymentPayloadFromRequest(req: express.Request): PaymentPayload | undefined {
  const headerPayloadRaw = (
    req.headers["x-402-payment"] ||
    req.headers["x402-payment"] ||
    req.headers["x402-payment-payload"] ||
    req.headers["x-402-payment-payload"] ||
    req.headers["payment-signature"] ||
    req.headers["x-payment"] ||
    req.headers["x-payment-request"]
  ) as string | undefined;

  const bodyPayload = req.body?.paymentPayload as PaymentPayload | undefined;

  if (typeof headerPayloadRaw === "string" && headerPayloadRaw.trim().length > 0) {
    try {
      return JSON.parse(headerPayloadRaw) as PaymentPayload;
    } catch {
      // If header is not JSON, ignore and fall back to body
      return bodyPayload;
    }
  }

  return bodyPayload;
}

// =============================================================================
// CORS (✅ FIXED FOR LOVABLE + x402)
// =============================================================================
const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  ...(FRONTEND_ORIGIN ? [FRONTEND_ORIGIN] : []),
]);

const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    // Allow non-browser clients (curl, server-to-server) that send no Origin.
    if (!origin) return cb(null, true);

    if (allowedOrigins.has(origin)) return cb(null, true);

    // Allow Lovable subdomains (both .lovable.app and .lovableproject.com)
    if (origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com")) return cb(null, true);

    return cb(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  // ✅ MUST explicitly include the header Lovable/x402 sends and variants
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",

    // x402 / Lovable headers (both hyphenated and non-hyphenated variants)
    "x-402-payment",
    "x-402-payment-authorization",
    "x-402-signature",
    "x-402-payment-payload",
    "x-402-payment-required",
    "x402-payment",
    "x402-payment-payload",
    "x402-payment-status",
    "x402-payment-required",
    "x402-client",

    // Additional x402-like headers requested
    "payment-signature",
    "payment-required",
    "payment-response",
    "x-payment",
    "x-payment-response",
    "x-payment-request",
  ],

  // ✅ Expose so browser can read required payment-required headers
  exposedHeaders: [
    "x-402-payment-required",
    "x402-payment-required",
    "payment-required",

    "x-402-payment-response",
    "x402-payment-response",
    "payment-response",
    "x-payment-response",

    "www-authenticate",
  ],

  credentials: false,
  optionsSuccessStatus: 204,
};

// Must come BEFORE routes (✅ already correct)
app.use(cors(corsOptions));
app.use((req, res, next) => {
  res.setHeader("Vary", "Origin");
  next();
});
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "1mb" }));

// =============================================================================
// Validation
// =============================================================================
const SUPPORTED_NETWORKS: string[] = [
  "base",
  "base-sepolia",
  "polygon",
  "polygon-amoy",
  "avalanche",
  "avalanche-fuji",
  "iotex",
  "sei",
  "sei-testnet",
  "peaq",
  "eip155:8453",
  "eip155:84532",
  "eip155:137",
  "eip155:80002",
  "eip155:43114",
  "eip155:43113",
  "eip155:4689",
  "eip155:1329",
  "eip155:1328",
  "eip155:3338",
];

if (!PAY_TO_ADDRESS) {
  console.error("❌ PAY_TO_ADDRESS is required");
  process.exit(1);
}

const isValidNetwork = SUPPORTED_NETWORKS.includes(NETWORK) || NETWORK.includes(":");
if (!isValidNetwork) {
  console.error(
    `❌ NETWORK "${NETWORK}" is not supported. Use legacy names (avalanche-fuji) or CAIP-2 (eip155:43113).`,
  );
  process.exit(1);
}

// Settlement mode selection (you want direct on Render)
let settlementMode: "facilitator" | "direct";
if (SETTLEMENT_MODE_ENV === "local" || SETTLEMENT_MODE_ENV === "direct") {
  settlementMode = "direct";
} else if (SETTLEMENT_MODE_ENV === "facilitator") {
  settlementMode = "facilitator";
} else if (FACILITATOR_URL) {
  settlementMode = "facilitator";
} else if (PRIVATE_KEY) {
  settlementMode = "direct";
} else {
  settlementMode = "facilitator";
}

if (settlementMode === "direct") {
  if (!PRIVATE_KEY) {
    console.error("❌ SETTLEMENT_MODE=direct requires PRIVATE_KEY");
    process.exit(1);
  }
  if (!RPC_URL) {
    console.error("❌ SETTLEMENT_MODE=direct requires RPC_URL");
    process.exit(1);
  }
}

// =============================================================================
// Merchant Executor (x402)
// =============================================================================
const merchantOptions: MerchantExecutorOptions = {
  payToAddress: PAY_TO_ADDRESS,
  network: NETWORK,
  price: PRICE_REPO_ANALYSIS_USDC,

  route: "/v1/github/analyze-paid",
  resourceName: "Grantees GitHub Repo Analysis",
  resourceDescription: "Analyzes a GitHub repo, scores quality, and matches grants.",
  mimeType: "application/json",

  // Direct settlement (Render)
  settlementMode,
  rpcUrl: RPC_URL,
  privateKey: PRIVATE_KEY,

  // Facilitator mode (optional)
  facilitatorUrl: FACILITATOR_URL,
  facilitatorApiKey: FACILITATOR_API_KEY,

  // Asset + chain metadata
  assetAddress: ASSET_ADDRESS,
  assetName: ASSET_NAME,
  explorerUrl: EXPLORER_URL,
  chainId: CHAIN_ID,

  // Prefer PUBLIC_BASE_URL for metadata/resource URLs (not localhost)
  resourceUrl: `${PUBLIC_BASE_URL}/v1/github/analyze-paid`,
};

const merchantExecutor = new MerchantExecutor(merchantOptions);

async function initializeMerchant() {
  await merchantExecutor.initialize();
}

// =============================================================================
// Routes
// =============================================================================
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "grantees-api",
    version: "0.1.0",
    x402Version: 2,
    runtime: {
      port: PORT,
      publicBaseUrl: PUBLIC_BASE_URL,
    },
    cors: {
      frontendOriginEnv: FRONTEND_ORIGIN || null,
      notes: "Allows localhost + *.lovable.app + FRONTEND_ORIGIN (if set).",
    },
    payment: {
      address: PAY_TO_ADDRESS,
      network: NETWORK,
      price: `$${PRICE_REPO_ANALYSIS_USDC.toFixed(2)} USDC`,
      settlementMode,
    },
    endpoints: {
      githubAnalyzePaid: "POST /v1/github/analyze-paid",
    },
  });
});

// Wallet info endpoint — returns native + optional ERC-20 balance
app.get("/v1/wallet/:address", async (req, res) => {
  try {
    const address = String(req.params.address || "").trim();
    if (!address) return res.status(400).json({ error: "Missing address param" });

    const networkQuery = (req.query.network as string | undefined) ?? NETWORK;
    const network = networkQuery.toLowerCase();
    const tokenParam = (req.query.token as string | undefined) || undefined;

    const DEFAULT_RPCS: Record<string, string> = {
      base: "https://mainnet.base.org",
      "base-sepolia": "https://sepolia.base.org",
      polygon: "https://polygon-rpc.com",
      "polygon-amoy": "https://rpc-amoy.polygon.technology",
      avalanche: "https://api.avax.network/ext/bc/C/rpc",
      "avalanche-fuji": "https://api.avax-test.network/ext/bc/C/rpc",
      iotex: "https://rpc.ankr.com/iotex",
      sei: "https://sei-rpc.publicnode.com",
      "sei-testnet": "https://sei-testnet-rpc.publicnode.com",
      peaq: "https://erpc.peaq.network",
    };

    const rpcUrl = RPC_URL || DEFAULT_RPCS[network] || DEFAULT_RPCS[networkQuery] || "https://rpc.ankr.com/eth";
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const nativeRaw = await provider.getBalance(address);
    const nativeFormatted = ethers.formatEther(nativeRaw);

    const response: any = {
      address,
      network,
      rpcUrl,
      native: {
        raw: nativeRaw.toString(),
        formatted: nativeFormatted,
      },
    };

    let tokenAddress = tokenParam;
    if (!tokenAddress) {
      // Fuji USDC (commonly used on Fuji testnet)
      if (network === "avalanche-fuji" || network === "eip155:43113") {
        tokenAddress = "0x5425890298aed601595a70AB815c96711a31Bc65";
      }
      // Avalanche mainnet USDC.e (common)
      if (network === "avalanche" || network === "eip155:43114") {
        tokenAddress = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
      }
    }

    if (tokenAddress) {
      try {
        const ERC20_ABI = [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)",
          "function symbol() view returns (string)",
        ];
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const [rawBal, decimals, symbol] = await Promise.all([
          tokenContract.balanceOf(address),
          tokenContract.decimals().catch(() => 18),
          tokenContract.symbol().catch(() => "TOKEN"),
        ]);

        response.token = {
          address: tokenAddress,
          symbol,
          raw: rawBal.toString(),
          decimals: Number(decimals),
          formatted: ethers.formatUnits(rawBal, Number(decimals)), // ✅ FIX: keep decimals
        };
      } catch (err) {
        response.tokenError = (err as Error).message;
      }
    }

    return res.json(response);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to get wallet info" });
  }
});

// ✅ Paid REST endpoint
app.post("/v1/github/analyze-paid", async (req, res) => {
  try {
    const paymentPayload = getPaymentPayloadFromRequest(req);

    // 1) If no payment => 402 requirements
    if (!paymentPayload) {
      const paymentRequired = merchantExecutor.createPaymentRequiredResponse();

      // ✅ CRITICAL: put payment requirements in headers so browser clients can read it
      setPaymentRequiredHeaders(res, paymentRequired);

      return res.status(402).json(paymentRequired);
    }

    // 2) Verify payment
    const verifyResult = await merchantExecutor.verifyPayment(paymentPayload);
    if (!verifyResult.isValid) {
      const paymentRequired = merchantExecutor.createPaymentRequiredResponse();
      setPaymentRequiredHeaders(res, paymentRequired);

      return res.status(402).json({
        error: "Payment verification failed",
        reason: verifyResult.invalidReason || "Invalid payment",
        paymentRequired,
      });
    }

    // 3) Validate request body
    const parsed = AnalyzeRepoRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    // 4) Run service logic
    const result = await analyzeGithubRepo(parsed.data, {
      chainDefault: "avalanche-fuji",
      githubToken: process.env.GITHUB_TOKEN,
    });

    // 5) Settle payment (direct settlement will broadcast tx)
    const settlement = await merchantExecutor.settlePayment(paymentPayload);

    // Helpful response headers
    res.setHeader("payment-response", JSON.stringify({ settled: settlement.success }));
    res.setHeader("x-payment-response", JSON.stringify({ settled: settlement.success }));

    return res.json({
      success: settlement.success,
      payer: verifyResult.payer,
      settlement,
      result,
    });
  } catch (error: any) {
    console.error("❌ /v1/github/analyze-paid error:", error);
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
});

// =============================================================================
// Start
// =============================================================================
async function startServer() {
  await initializeMerchant();

  app.listen(PORT, () => {
    console.log(`\n✅ Server running on ${PUBLIC_BASE_URL}`);
    console.log(`📖 Health check: ${PUBLIC_BASE_URL}/health`);
    console.log(`🚀 Paid endpoint: POST ${PUBLIC_BASE_URL}/v1/github/analyze-paid`);
    console.log(`💳 Settlement mode: ${settlementMode}`);
  });
}

startServer().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
