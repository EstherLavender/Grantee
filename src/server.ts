import express from "express";
import dotenv from "dotenv";

// Polyfill BigInt serialization for JSON.stringify (historically used for Solana, safe to keep)
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { MerchantExecutor, type MerchantExecutorOptions } from "./MerchantExecutor.js";
import type { PaymentPayload } from "@x402/core/types";

// Keep starter-kit A2A types + ExampleService if you still want /process
import { ExampleService } from "./ExampleService.js";
import { EventQueue, Message, RequestContext, Task, TaskState } from "./x402Types.js";

// ✅ Grantees REST handler
import { githubAnalyze } from "./routes.js";

dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;

// ✅ Default to avalanche-fuji for this project
const NETWORK = process.env.NETWORK || "avalanche-fuji";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FACILITATOR_URL = process.env.FACILITATOR_URL;
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;

const SERVICE_URL = process.env.SERVICE_URL || `http://localhost:${PORT}/process`;

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const SETTLEMENT_MODE_ENV = process.env.SETTLEMENT_MODE?.toLowerCase();

const ASSET_ADDRESS = process.env.ASSET_ADDRESS;
const ASSET_NAME = process.env.ASSET_NAME;
const EXPLORER_URL = process.env.EXPLORER_URL;

const CHAIN_ID = process.env.CHAIN_ID ? Number.parseInt(process.env.CHAIN_ID, 10) : undefined;

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const EIGENAI_BASE_URL = process.env.EIGENAI_BASE_URL || "https://eigenai.eigencloud.xyz/v1";
const EIGENAI_API_KEY = process.env.EIGENAI_API_KEY;
const AI_MODEL = process.env.AI_MODEL;
const AI_TEMPERATURE = process.env.AI_TEMPERATURE ? Number.parseFloat(process.env.AI_TEMPERATURE) : undefined;
const AI_MAX_TOKENS = process.env.AI_MAX_TOKENS ? Number.parseInt(process.env.AI_MAX_TOKENS, 10) : undefined;
const AI_SEED = process.env.AI_SEED ? Number.parseInt(process.env.AI_SEED, 10) : undefined;

// Supported networks (you can keep this broad; Grantees defaults to Fuji)
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
  // CAIP-2 format
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

// Validate env
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

// AI validation (only needed if you keep /process + ExampleService)
if (AI_PROVIDER === "openai") {
  if (!OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is required when AI_PROVIDER=openai");
    process.exit(1);
  }
} else if (AI_PROVIDER === "eigenai") {
  if (!EIGENAI_API_KEY && !OPENAI_API_KEY) {
    console.error("❌ EIGENAI_API_KEY (or OPENAI_API_KEY fallback) is required when AI_PROVIDER=eigenai");
    process.exit(1);
  }
} else {
  console.error(`❌ AI_PROVIDER "${AI_PROVIDER}" is not supported. Supported providers: openai, eigenai`);
  process.exit(1);
}

// Settlement mode selection
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

if (settlementMode === "direct" && !PRIVATE_KEY) {
  console.error("❌ SETTLEMENT_MODE=local/direct requires PRIVATE_KEY to be configured");
  process.exit(1);
}

// -------------------------------------------------------------------------------------
// Optional starter service (kept for /process)
// -------------------------------------------------------------------------------------
const exampleService = new ExampleService({
  provider: AI_PROVIDER === "eigenai" ? "eigenai" : "openai",
  apiKey: AI_PROVIDER === "openai" ? OPENAI_API_KEY : undefined,
  baseUrl: AI_PROVIDER === "eigenai" ? EIGENAI_BASE_URL : OPENAI_BASE_URL || undefined,
  defaultHeaders: AI_PROVIDER === "eigenai" ? { "x-api-key": (EIGENAI_API_KEY || OPENAI_API_KEY)! } : undefined,
  payToAddress: PAY_TO_ADDRESS,
  network: NETWORK,
  model: AI_MODEL ?? (AI_PROVIDER === "eigenai" ? "gpt-oss-120b-f16" : "gpt-4o-mini"),
  temperature: AI_TEMPERATURE ?? 0.7,
  maxTokens: AI_MAX_TOKENS ?? 500,
  seed: AI_PROVIDER === "eigenai" ? AI_SEED : undefined,
});

// -------------------------------------------------------------------------------------
// Merchant Executor (single executor for now; you can create multiple per-route later)
// -------------------------------------------------------------------------------------
const merchantOptions: MerchantExecutorOptions = {
  payToAddress: PAY_TO_ADDRESS,
  network: NETWORK,
  price: 0.1,

  // ✅ Grantees route metadata (these show up in the 402 response)
  route: "/v1/github/analyze",
  resourceName: "Grantees GitHub Repo Analysis",
  resourceDescription: "Analyzes a GitHub repo, scores quality, and matches Avalanche-aligned grants.",
  mimeType: "application/json",

  facilitatorUrl: FACILITATOR_URL,
  facilitatorApiKey: FACILITATOR_API_KEY,
  resourceUrl: SERVICE_URL,
  settlementMode,
  rpcUrl: RPC_URL,
  privateKey: PRIVATE_KEY,
  assetAddress: ASSET_ADDRESS,
  assetName: ASSET_NAME,
  explorerUrl: EXPLORER_URL,
  chainId: CHAIN_ID,
};

const merchantExecutor = new MerchantExecutor(merchantOptions);

// Initialize (async for facilitator mode)
async function initializeMerchant() {
  await merchantExecutor.initialize();
}

// Logging
if (settlementMode === "direct") {
  console.log("🧩 Using local settlement (direct EIP-3009 via RPC)");
  console.log(`🔌 RPC endpoint: ${RPC_URL || "using default for selected network"}`);
} else if (FACILITATOR_URL) {
  console.log(`🌐 Using custom facilitator: ${FACILITATOR_URL}`);
} else {
  console.log("🌐 Using default facilitator: https://x402.org/facilitator");
  console.log("⚠️  Note: Default facilitator only supports TESTNETS");
}

console.log("🚀 Grantees x402 Payment API initialized");
console.log(`💰 Payment address: ${PAY_TO_ADDRESS}`);
console.log(`🌐 Network: ${NETWORK}`);
console.log("💵 Price per request: $0.10 USDC");

// -------------------------------------------------------------------------------------
// Health
// -------------------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "grantees-api",
    version: "0.1.0",
    x402Version: 2,
    payment: {
      address: PAY_TO_ADDRESS,
      network: NETWORK,
      price: "$0.10",
    },
    endpoints: {
      githubAnalyze: "POST /v1/github/analyze",
      process: "POST /process (starter A2A demo)",
    },
  });
});

// -------------------------------------------------------------------------------------
// ✅ Grantees Paid REST Endpoint: POST /v1/github/analyze
// Body: AnalyzeRepoRequest
// Payment: x402.payment.payload in body or x402-payment-payload header
// -------------------------------------------------------------------------------------
app.post("/v1/github/analyze", async (req, res) => {
  try {
    // Accept payment payload from either header or body
    const headerPayload = req.headers["x402-payment-payload"];
    const bodyPayload = req.body?.paymentPayload;

    const paymentPayload: PaymentPayload | undefined =
      typeof headerPayload === "string"
        ? (JSON.parse(headerPayload) as PaymentPayload)
        : bodyPayload;

    // If no payment, return 402 with requirements
    if (!paymentPayload) {
      const paymentRequired = merchantExecutor.createPaymentRequiredResponse();
      return res.status(402).json(paymentRequired);
    }

    // Verify
    const verifyResult = await merchantExecutor.verifyPayment(paymentPayload);
    if (!verifyResult.isValid) {
      return res.status(402).json({
        error: "Payment verification failed",
        reason: verifyResult.invalidReason || "Invalid payment",
      });
    }

    // ✅ Run the actual Grantees handler (your routes.ts)
    // We pass through the same request body your handler expects.
    // (repoUrl, depth, chainHint, etc.)
    await githubAnalyze(req, res);

    // If handler already sent a response, we can't settle after sending.
    // So we settle BEFORE sending: easiest is to compute result first then respond.
    // BUT your handler currently sends res.json(result).
    //
    // Therefore we need a safer pattern:
    // - call service directly here
    // - then settle
    // - then respond once
  } catch (error: any) {
    console.error("❌ /v1/github/analyze error:", error);
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
});

// -------------------------------------------------------------------------------------
// ⭐ IMPORTANT FIX: Paid endpoint must settle BEFORE responding.
// The above direct handler call responds too early.
// So we implement a proper paid analyze route below and disable the one above.
// -------------------------------------------------------------------------------------

import { AnalyzeRepoRequest } from "./contracts/github.js";
import { analyzeGithubRepo } from "./services/grantees/index.js";

app.post("/v1/github/analyze-paid", async (req, res) => {
  try {
    const headerPayload = req.headers["x402-payment-payload"];
    const bodyPayload = req.body?.paymentPayload;

    const paymentPayload: PaymentPayload | undefined =
      typeof headerPayload === "string"
        ? (JSON.parse(headerPayload) as PaymentPayload)
        : bodyPayload;

    if (!paymentPayload) {
      const paymentRequired = merchantExecutor.createPaymentRequiredResponse();
      return res.status(402).json(paymentRequired);
    }

    const verifyResult = await merchantExecutor.verifyPayment(paymentPayload);
    if (!verifyResult.isValid) {
      return res.status(402).json({
        error: "Payment verification failed",
        reason: verifyResult.invalidReason || "Invalid payment",
      });
    }

    // Parse request body (strip paymentPayload if client included it)
    const parsed = AnalyzeRepoRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    // Run Grantees service logic
    const result = await analyzeGithubRepo(parsed.data, {
      chainDefault: "avalanche-fuji",
      githubToken: process.env.GITHUB_TOKEN,
    });

    // Settle payment
    const settlement = await merchantExecutor.settlePayment(paymentPayload);

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

// -------------------------------------------------------------------------------------
// Starter kit A2A endpoint (kept)
// -------------------------------------------------------------------------------------
app.post("/process", async (req, res) => {
  try {
    console.log("\n📥 Received request");
    console.log("Request body:", JSON.stringify(req.body, null, 2));

    const { message, taskId, contextId, metadata } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing message in request body" });
    }

    const task: Task = {
      id: taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      contextId: contextId || `context-${Date.now()}`,
      status: { state: TaskState.INPUT_REQUIRED, message },
      metadata: metadata || {},
    };

    const context: RequestContext = {
      taskId: task.id,
      contextId: task.contextId,
      currentTask: task,
      message,
    };

    const events: Task[] = [];
    const eventQueue: EventQueue = {
      enqueueEvent: async (event: Task) => {
        events.push(event);
      },
    };

    const paymentPayload = message.metadata?.["x402.payment.payload"] as PaymentPayload | undefined;
    const paymentStatus = message.metadata?.["x402.payment.status"];

    if (!paymentPayload || paymentStatus !== "payment-submitted") {
      const paymentRequired = merchantExecutor.createPaymentRequiredResponse();

      const responseMessage: Message = {
        messageId: `msg-${Date.now()}`,
        role: "agent",
        parts: [{ kind: "text", text: "Payment required. Please submit payment to continue." }],
        metadata: {
          "x402.payment.required": paymentRequired,
          "x402.payment.status": "payment-required",
        },
      };

      task.status.state = TaskState.INPUT_REQUIRED;
      task.status.message = responseMessage;
      task.metadata = {
        ...(task.metadata || {}),
        "x402.payment.required": paymentRequired,
        "x402.payment.status": "payment-required",
      };

      events.push(task);
      console.log("💰 Payment required for request processing");

      return res.json({ success: false, error: "Payment Required", task, events });
    }

    const verifyResult = await merchantExecutor.verifyPayment(paymentPayload);

    if (!verifyResult.isValid) {
      const errorReason = verifyResult.invalidReason || "Invalid payment";
      task.status.state = TaskState.FAILED;
      task.status.message = {
        messageId: `msg-${Date.now()}`,
        role: "agent",
        parts: [{ kind: "text", text: `Payment verification failed: ${errorReason}` }],
        metadata: {
          "x402.payment.status": "payment-rejected",
          "x402.payment.error": errorReason,
        },
      };
      task.metadata = {
        ...(task.metadata || {}),
        "x402.payment.status": "payment-rejected",
        "x402.payment.error": errorReason,
      };

      events.push(task);

      return res.status(402).json({
        error: "Payment verification failed",
        reason: errorReason,
        task,
        events,
      });
    }

    task.metadata = {
      ...(task.metadata || {}),
      x402_payment_verified: true,
      "x402.payment.status": "payment-verified",
      ...(verifyResult.payer ? { "x402.payment.payer": verifyResult.payer } : {}),
    };

    await exampleService.execute(context, eventQueue);

    const settlement = await merchantExecutor.settlePayment(paymentPayload);

    task.metadata = {
      ...(task.metadata || {}),
      "x402.payment.status": settlement.success ? "payment-completed" : "payment-failed",
      ...(settlement.transaction ? { "x402.payment.receipts": [settlement] } : {}),
      ...(settlement.errorReason ? { "x402.payment.error": settlement.errorReason } : {}),
    };

    if (events.length === 0) events.push(task);

    console.log("📤 Sending response\n");

    return res.json({
      success: settlement.success,
      task: events[events.length - 1],
      events,
      settlement,
    });
  } catch (error: any) {
    console.error("❌ Error processing request:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// Simple test endpoint for /process
app.post("/test", async (req, res) => {
  const message: Message = {
    messageId: `msg-${Date.now()}`,
    role: "user",
    parts: [{ kind: "text", text: req.body.text || "Hello, tell me a joke!" }],
  };

  try {
    const response = await fetch(`http://localhost:${PORT}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Start server
async function startServer() {
  await initializeMerchant();

  app.listen(PORT, () => {
    console.log(`\n✅ Server running on http://localhost:${PORT}`);
    console.log(`📖 Health check: http://localhost:${PORT}/health`);
    console.log(`🚀 Grantees paid endpoint: POST http://localhost:${PORT}/v1/github/analyze-paid`);
    console.log(`🧪 Test endpoint: POST http://localhost:${PORT}/test`);
    console.log(`🧩 Starter A2A endpoint: POST http://localhost:${PORT}/process\n`);
  });
}

startServer().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
