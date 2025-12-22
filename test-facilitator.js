import { randomBytes } from "crypto";
import { Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;
const HOST = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:4022";

// We default to Fuji because your project is Fuji-only
const NETWORK = process.env.NETWORK || "avalanche-fuji";

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

// Legacy names -> chainId (must include Fuji)
const CHAIN_IDS = {
  base: 8453,
  "base-sepolia": 84532,
  ethereum: 1,
  polygon: 137,
  "polygon-amoy": 80002,
  avalanche: 43114,
  "avalanche-fuji": 43113,
};

// CAIP2 eip155:43113 -> chainId
function chainIdFromNetwork(network) {
  if (network.startsWith("eip155:")) {
    const parts = network.split(":");
    const id = Number(parts[1]);
    if (!Number.isFinite(id)) throw new Error(`Invalid CAIP2 network: ${network}`);
    return id;
  }
  const id = CHAIN_IDS[network];
  if (!id) throw new Error(`Unsupported network "${network}" (add to CHAIN_IDS)`);
  return id;
}

function generateNonce() {
  return `0x${randomBytes(32).toString("hex")}`;
}

function selectPaymentRequirement(paymentRequired) {
  if (!paymentRequired?.accepts || !Array.isArray(paymentRequired.accepts) || paymentRequired.accepts.length === 0) {
    throw new Error("No payment requirements provided (accepts[] is empty)");
  }
  return paymentRequired.accepts[0];
}

async function createPaymentPayloadV2(paymentRequired, wallet) {
  const req = selectPaymentRequirement(paymentRequired);

  // In v2 requirements, required amount is in req.amount (atomic units, 6 decimals for USDC)
  // Some older variants used maxAmountRequired; we support both just in case.
  const requiredAmount = req.amount ?? req.maxAmountRequired;
  if (!requiredAmount) {
    throw new Error("Payment requirement missing amount (expected req.amount)");
  }

  const now = Math.floor(Date.now() / 1000);

  const authorization = {
    from: wallet.address,
    to: req.payTo,
    value: String(requiredAmount),
    validAfter: "0",
    validBefore: String(now + (req.maxTimeoutSeconds || 600)),
    nonce: generateNonce(),
  };

  const domain = {
    name: req.extra?.name || "USDC",
    version: req.extra?.version || "2",
    chainId: chainIdFromNetwork(req.network),
    verifyingContract: req.asset,
  };

  const signature = await wallet.signTypedData(domain, TRANSFER_AUTH_TYPES, authorization);

  // x402 v2 payment payload structure (matches your MerchantExecutor + facilitator.ts)
  return {
    accepted: {
      scheme: req.scheme,
      network: req.network,
      asset: req.asset,
      payTo: req.payTo,
      amount: String(requiredAmount),
      maxTimeoutSeconds: req.maxTimeoutSeconds || 600,
      extra: req.extra || {},
    },
    payload: {
      signature,
      authorization,
    },
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json
  }
  return { res, text, json };
}

async function main() {
  console.log("🧪 Grantees x402 v2 End-to-End Test (Avalanche Fuji)");
  console.log("==================================================\n");

  if (!CLIENT_PRIVATE_KEY) {
    console.error("❌ CLIENT_PRIVATE_KEY not set in .env");
    console.error("Add: CLIENT_PRIVATE_KEY=0x...");
    process.exit(1);
  }

  const wallet = new Wallet(CLIENT_PRIVATE_KEY);
  console.log(`💼 Client wallet: ${wallet.address}`);
  console.log(`🌐 API HOST: ${HOST}`);
  console.log(`🌐 Facilitator: ${FACILITATOR_URL}`);
  console.log(`🔗 Network env: ${NETWORK}\n`);

  // 1) Get payment requirements from your API (expect 402)
  console.log("1️⃣ Requesting payment requirements from API...");
  const reqBody = {
    repoUrl: "https://github.com/Talent-Index/team1-dashboard",
    depth: "standard",
  };

  const { res: prRes, text: prText, json: paymentRequired } = await postJson(
    `${HOST}/v1/github/analyze-paid`,
    reqBody
  );

  console.log(`HTTP: ${prRes.status} ${prRes.statusText}`);
  if (prRes.status !== 402) {
    console.log("❌ Expected 402 from API. Got:");
    console.log(prText);
    process.exit(1);
  }

  console.log("✅ Received payment requirements.");
  // console.log(JSON.stringify(paymentRequired, null, 2));

  // 2) Create signed payment payload (EIP-3009 typed data)
  console.log("\n2️⃣ Signing payment payload (EIP-3009 transferWithAuthorization)...");
  const paymentPayload = await createPaymentPayloadV2(paymentRequired, wallet);
  console.log("✅ Payment payload signed.");

  // 3) Verify with facilitator
  console.log("\n3️⃣ Verifying payment with facilitator...");
  const requirement = selectPaymentRequirement(paymentRequired);

  const verifyUrl = `${FACILITATOR_URL}/verify`;
  const verifyBody = {
    x402Version: 2,
    paymentPayload,
    paymentRequirements: requirement,
  };

  const { res: vRes, text: vText, json: vJson } = await postJson(verifyUrl, verifyBody);
  console.log(`HTTP: ${vRes.status} ${vRes.statusText}`);
  console.log(vText);

  if (!vRes.ok) {
    console.log("❌ Verify failed. Fix verify before settle.");
    process.exit(1);
  }

  if (vJson && vJson.isValid === false) {
    console.log("❌ Facilitator says payment is invalid:", vJson.invalidReason);
    process.exit(1);
  }

  console.log("✅ Verify passed.");

  // 4) Settle with facilitator
  console.log("\n4️⃣ Settling payment with facilitator...");
  const settleUrl = `${FACILITATOR_URL}/settle`;
  const settleBody = {
    x402Version: 2,
    paymentPayload,
    paymentRequirements: requirement,
  };

  const { res: sRes, text: sText, json: sJson } = await postJson(settleUrl, settleBody);
  console.log(`HTTP: ${sRes.status} ${sRes.statusText}`);
  console.log(sText);

  if (!sRes.ok) {
    console.log("❌ Settle failed.");
    process.exit(1);
  }

  if (sJson && sJson.success === false) {
    console.log("❌ Settlement not successful:", sJson.errorReason);
    process.exit(1);
  }

  console.log("✅ Settlement succeeded.");

  // 5) Call API again with paymentPayload to receive result
  console.log("\n5️⃣ Calling API again with paymentPayload to get analysis result...");
  const finalBody = {
    ...reqBody,
    paymentPayload,
  };

  const { res: aRes, text: aText } = await postJson(`${HOST}/v1/github/analyze-paid`, finalBody);
  console.log(`HTTP: ${aRes.status} ${aRes.statusText}`);
  console.log(aText);

  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
