import dotenv from "dotenv";
import { randomBytes } from "crypto";
import { Wallet } from "ethers";

dotenv.config();

// Polyfill BigInt serialization for JSON.stringify (safe to keep)
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const API_URL =
  process.env.AGENT_URL ||
  process.env.API_URL ||
  process.env.PUBLIC_BASE_URL ||
  "http://localhost:3000";

const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY;

// Your Grantees paid endpoint
const ENDPOINT = "/v1/github/analyze-paid";

// EIP-3009 typed data schema used by USDC
const TRANSFER_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

type PaymentRequirements = {
  scheme: string;
  network: string; // eip155:43113 OR legacy
  asset: string; // USDC contract
  payTo: string;
  amount?: string; // v2
  maxAmountRequired?: string; // fallback
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};

type PaymentRequiredResponse = {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
  resource?: unknown;
};

type PaymentPayloadV2 = {
  accepted: {
    scheme: string;
    network: string;
    asset: string;
    payTo: string;
    amount: string;
    maxTimeoutSeconds: number;
    extra?: Record<string, unknown>;
  };
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
};

function must<T>(value: T | undefined | null, msg: string): T {
  if (value === undefined || value === null || value === "") throw new Error(msg);
  return value;
}

function generateNonce(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

function chainIdFromNetwork(network: string): number {
  // CAIP-2 format: eip155:43113
  if (network.startsWith("eip155:")) {
    const id = Number(network.split(":")[1]);
    if (!Number.isFinite(id)) throw new Error(`Invalid CAIP-2 network: ${network}`);
    return id;
  }

  // Legacy fallback
  const map: Record<string, number> = {
    avalanche: 43114,
    "avalanche-fuji": 43113,
    base: 8453,
    "base-sepolia": 84532,
    polygon: 137,
    "polygon-amoy": 80002,
    sei: 1329,
    "sei-testnet": 1328,
    iotex: 4689,
    peaq: 3338,
  };

  const id = map[network];
  if (!id) throw new Error(`Unsupported network "${network}". Use CAIP-2 like eip155:43113 or add mapping.`);
  return id;
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // ignore
  }

  return { status: res.status, json, text };
}

function pickEvmRequirement(paymentRequired: PaymentRequiredResponse): PaymentRequirements {
  if (!Array.isArray(paymentRequired?.accepts) || paymentRequired.accepts.length === 0) {
    throw new Error("No payment requirements returned (accepts[] is empty)");
  }

  // Prefer EVM (eip155:*). If server returns legacy avalanche-fuji, also accept.
  const evm = paymentRequired.accepts.find(
    (r) => r.network?.startsWith("eip155:") || r.network === "avalanche-fuji" || r.network === "avalanche",
  );

  if (!evm) {
    throw new Error(
      `No EVM payment option found. Available: ${paymentRequired.accepts.map((r) => r.network).join(", ")}`,
    );
  }

  return evm;
}

async function createPaymentPayloadEvm(
  paymentRequired: PaymentRequiredResponse,
  wallet: Wallet,
): Promise<PaymentPayloadV2> {
  const req = pickEvmRequirement(paymentRequired);

  const requiredAmount = req.amount ?? req.maxAmountRequired;
  if (!requiredAmount) throw new Error("Payment requirement missing amount (expected req.amount)");

  const now = Math.floor(Date.now() / 1000);
  const validBefore = now + (req.maxTimeoutSeconds ?? 600);

  const authorization = {
    from: wallet.address,
    to: req.payTo,
    value: String(requiredAmount),
    validAfter: "0",
    validBefore: String(validBefore),
    nonce: generateNonce(),
  };

  const domain = {
    name: (req.extra?.["name"] as string | undefined) || "USDC",
    version: (req.extra?.["version"] as string | undefined) || "2",
    chainId: chainIdFromNetwork(req.network),
    verifyingContract: req.asset,
  };

  const signature = await wallet.signTypedData(domain as any, TRANSFER_AUTH_TYPES as any, authorization as any);

  return {
    accepted: {
      scheme: req.scheme,
      network: req.network,
      asset: req.asset,
      payTo: req.payTo,
      amount: String(requiredAmount),
      maxTimeoutSeconds: req.maxTimeoutSeconds ?? 600,
      extra: (req.extra ?? {}) as Record<string, unknown>,
    },
    payload: { signature, authorization },
  };
}

export class GranteesEvmTestClient {
  private apiUrl: string;

  constructor(apiUrl: string = API_URL) {
    this.apiUrl = apiUrl;
  }

  async checkHealth(): Promise<void> {
    console.log("\n🏥 Checking API health...");
    const res = await fetch(`${this.apiUrl}/health`);
    const data = (await safeJson(res)) ?? {};

    if (!res.ok) {
      console.log("❌ Health check failed:", res.status, res.statusText);
      console.log(data);
      return;
    }

    console.log("✅ API is healthy");
    console.log(`   Service: ${String(data["service"] ?? "")}`);
    console.log(`   Version: ${String(data["version"] ?? "")}`);

    const payment = (data["payment"] as Record<string, unknown> | undefined) ?? {};
    console.log(`   Network: ${String(payment["network"] ?? "")}`);
    console.log(`   Price: ${String(payment["price"] ?? "")}`);
  }

  /**
   * 1) call without payment => expect 402
   */
  async requestPaymentRequired(repoUrl: string, depth: string = "standard"): Promise<PaymentRequiredResponse> {
    console.log(`\n📤 Requesting payment requirements for repo analysis...`);
    const url = `${this.apiUrl}${ENDPOINT}`;

    const { status, json, text } = await postJson(url, { repoUrl, depth });

    if (status !== 402) {
      console.log(`❌ Expected 402 but got ${status}`);
      console.log(text);
      throw new Error(`Expected 402 Payment Required but got ${status}`);
    }

    if (!json || !Array.isArray((json as any).accepts)) {
      console.log("❌ 402 returned but missing accepts[] payload:");
      console.log(text);
      throw new Error("Payment required response missing accepts[]");
    }

    const parsed: PaymentRequiredResponse = {
      x402Version: Number((json as any).x402Version ?? 2),
      accepts: (json as any).accepts as PaymentRequirements[],
      error: (json as any).error,
      resource: (json as any).resource,
    };

    console.log("✅ Got 402 Payment Required");
    console.log(`   x402Version: ${parsed.x402Version}`);
    console.log(`   options: ${parsed.accepts.length}`);
    return parsed;
  }

  /**
   * 2) pay + call again
   */
  async analyzeRepoPaid(repoUrl: string, depth: string = "standard"): Promise<void> {
    const privateKey = must(CLIENT_PRIVATE_KEY, "CLIENT_PRIVATE_KEY missing in .env");
    const wallet = new Wallet(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);

    console.log(`\n💼 Client wallet: ${wallet.address}`);
    console.log(`🌐 API: ${this.apiUrl}`);

    const paymentRequired = await this.requestPaymentRequired(repoUrl, depth);

    console.log("\n🔐 Signing EIP-3009 payment (EIP-712 typed data)...");
    const paymentPayload = await createPaymentPayloadEvm(paymentRequired, wallet);
    console.log("✅ Payment payload signed");

    console.log("\n📡 Submitting paid request...");
    const url = `${this.apiUrl}${ENDPOINT}`;
    const { status, text } = await postJson(url, {
      repoUrl,
      depth,
      paymentPayload,
    });

    console.log(`HTTP: ${status}`);
    console.log(text);

    if (status === 402) {
      throw new Error("Still receiving 402 after sending paymentPayload (server not reading paymentPayload?)");
    }
    if (status >= 400) {
      throw new Error(`Paid request failed with status ${status}`);
    }

    console.log("\n✅ Paid analysis completed!");
  }
}

async function main() {
  console.log("🧪 Grantees EVM x402 v2 Test Client (Avalanche Fuji)");
  console.log("====================================================\n");

  const client = new GranteesEvmTestClient();

  await client.checkHealth();

  // TEST 1: payment required
  console.log("\n\n📋 TEST 1: Request without payment (expect 402)");
  console.log("===============================================");
  try {
    await client.requestPaymentRequired("https://github.com/Talent-Index/team1-dashboard", "standard");
    console.log("✅ TEST 1 PASSED");
  } catch (e) {
    console.error("❌ TEST 1 FAILED:", e);
  }

  // TEST 2: paid flow (requires CLIENT_PRIVATE_KEY funded w/ Fuji USDC)
  console.log("\n\n📋 TEST 2: Paid request (requires CLIENT_PRIVATE_KEY)");
  console.log("====================================================");
  if (!CLIENT_PRIVATE_KEY) {
    console.log("⚠️ Skipped: CLIENT_PRIVATE_KEY not set in .env");
    console.log("Add:");
    console.log("  CLIENT_PRIVATE_KEY=0x...");
    console.log("This wallet must have Fuji USDC + (maybe) AVAX for gas depending on settlement mode.");
  } else {
    try {
      await client.analyzeRepoPaid("https://github.com/Talent-Index/team1-dashboard", "standard");
      console.log("✅ TEST 2 PASSED");
    } catch (e) {
      console.error("❌ TEST 2 FAILED:", e);
    }
  }

  console.log("\n✅ Tests complete!");
}

// Run if executed directly (works for both ts-node/tsx and compiled JS)
const ranDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  /testClient\.(ts|js)$/.test(process.argv[1]);

if (ranDirectly) {
  main().catch((err) => {
    console.error("❌ Test client crashed:", err);
    process.exit(1);
  });
}

export { main as runEvmTests };