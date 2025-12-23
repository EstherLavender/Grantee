import { ethers } from "ethers";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import type { PaymentPayload, PaymentRequirements, Network } from "@x402/core/types";

// NOTE: The default x402 facilitator only supports TESTNETS
// For mainnet support, you need to run your own facilitator or use direct settlement (EVM only)
const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

/**
 * Parse EVM payment errors and provide helpful, actionable error messages.
 */
function parsePaymentError(error: unknown): {
  message: string;
  suggestion: string;
  code: string;
} {
  const errorStr = error instanceof Error ? error.message : String(error);
  const errorJson = JSON.stringify(error);

  // EVM-specific errors
  if (
    errorStr.includes("insufficient funds for gas") ||
    errorStr.includes("gas required exceeds allowance")
  ) {
    return {
      code: "INSUFFICIENT_GAS",
      message: "Not enough native tokens for gas fees",
      suggestion:
        "🔧 FIX: Fund the payer wallet with enough AVAX (Fuji) to cover gas. Use a Fuji faucet for test AVAX.",
    };
  }

  if (
    errorStr.includes("transfer amount exceeds balance") ||
    errorStr.includes("ERC20: transfer amount exceeds balance") ||
    errorStr.toLowerCase().includes("insufficient usdc")
  ) {
    return {
      code: "INSUFFICIENT_USDC",
      message: "Not enough USDC for the transfer",
      suggestion:
        "🔧 FIX: Fund the payer wallet with enough USDC on Avalanche Fuji, or lower the required amount.",
    };
  }

  if (errorStr.includes("execution reverted") || errorStr.includes("transaction reverted")) {
    return {
      code: "TRANSACTION_REVERTED",
      message: "Transaction reverted by the token contract",
      suggestion:
        "🔧 FIX: Common causes: expired authorization (validBefore), reused nonce, invalid signature, or insufficient allowance.",
    };
  }

  if (
    errorStr.includes("nonce too low") ||
    errorStr.includes("replacement transaction underpriced")
  ) {
    return {
      code: "NONCE_ISSUE",
      message: "Nonce/transaction replacement issue",
      suggestion:
        "🔧 FIX: Retry with a fresh transaction. If using an RPC with lag, switch to another Fuji RPC endpoint.",
    };
  }

  // Helpful extraction of inner error when present
  const instructionErrorMatch = errorJson.match(/revert reason.*?\"(.*?)\"/i);
  if (instructionErrorMatch?.[1]) {
    return {
      code: "REVERT_REASON",
      message: `Reverted: ${instructionErrorMatch[1]}`,
      suggestion:
        "🔧 FIX: Check token contract requirements (authorization timing, nonce uniqueness, signature correctness).",
    };
  }

  // Generic fallback
  return {
    code: "UNKNOWN_ERROR",
    message: errorStr,
    suggestion: "Check logs above for details. Ensure network/asset/payTo/amount are correct.",
  };
}

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

export type SettlementMode = "facilitator" | "direct";

// Map legacy network names to eip155 CAIP-2 format (EVM only)
const NETWORK_MAP: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
  avalanche: "eip155:43114",
  "avalanche-fuji": "eip155:43113",
  iotex: "eip155:4689",
  sei: "eip155:1329",
  "sei-testnet": "eip155:1328",
  peaq: "eip155:3338",
};

type LegacyNetwork =
  | "base"
  | "base-sepolia"
  | "polygon"
  | "polygon-amoy"
  | "avalanche-fuji"
  | "avalanche"
  | "iotex"
  | "sei"
  | "sei-testnet"
  | "peaq";

const BUILT_IN_NETWORKS: Record<
  LegacyNetwork,
  {
    chainId?: number;
    assetAddress: string;
    assetName: string;
    explorer?: string;
  }
> = {
  base: {
    chainId: 8453,
    assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetName: "USD Coin",
    explorer: "https://basescan.org",
  },
  "base-sepolia": {
    chainId: 84532,
    assetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    assetName: "USDC",
    explorer: "https://sepolia.basescan.org",
  },
  polygon: {
    chainId: 137,
    assetAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    assetName: "USD Coin",
    explorer: "https://polygonscan.com",
  },
  "polygon-amoy": {
    chainId: 80002,
    assetAddress: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    assetName: "USDC",
    explorer: "https://amoy.polygonscan.com",
  },
  "avalanche-fuji": {
    chainId: 43113,
    // Fuji USDC (commonly used test token address in many kits; confirm if your kit expects another)
    assetAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
    assetName: "USD Coin",
    explorer: "https://testnet.snowtrace.io",
  },
  avalanche: {
    chainId: 43114,
    assetAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    assetName: "USD Coin",
    explorer: "https://snowtrace.io",
  },
  iotex: {
    chainId: 4689,
    assetAddress: "0xcdf79194c6c285077a58da47641d4dbe51f63542",
    assetName: "Bridged USDC",
    explorer: "https://iotexscan.io",
  },
  sei: {
    chainId: 1329,
    assetAddress: "0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392",
    assetName: "USDC",
    explorer: "https://sei.explorers.guru",
  },
  "sei-testnet": {
    chainId: 1328,
    assetAddress: "0x4fcf1784b31630811181f670aea7a7bef803eaed",
    assetName: "USDC",
    explorer: "https://testnet.sei.explorers.guru",
  },
  peaq: {
    chainId: 3338,
    assetAddress: "0xbbA60da06c2c5424f03f7434542280FCAd453d10",
    assetName: "USDC",
    explorer: "https://scan.peaq.network",
  },
};

export interface MerchantExecutorOptions {
  payToAddress: string;
  network: string; // legacy or CAIP-2
  price: number;

  // Grantees route metadata (per-endpoint)
  route?: string; // e.g. "/v1/github/analyze"
  resourceName?: string; // e.g. "Grantees GitHub Repo Analysis"
  resourceDescription?: string; // e.g. "Analyzes repo + matches grants"
  mimeType?: string; // default: "application/json"

  facilitatorUrl?: string;
  facilitatorApiKey?: string;
  resourceUrl?: string;
  settlementMode?: SettlementMode;
  rpcUrl?: string;
  privateKey?: string;
  assetAddress?: string;
  assetName?: string;
  explorerUrl?: string;
  chainId?: number;
}

export interface VerifyResult {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
}

export interface SettlementResult {
  success: boolean;
  transaction?: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

export class MerchantExecutor {
  private requirements: PaymentRequirements;

  private readonly explorerUrl?: string;
  private readonly mode: SettlementMode;
  private readonly facilitatorUrl?: string;
  private readonly facilitatorApiKey?: string;

  private settlementProvider?: ethers.JsonRpcProvider;
  private settlementWallet?: ethers.Wallet;

  private readonly network: Network;
  private readonly legacyNetwork: string;
  private readonly assetName: string;
  private readonly chainId?: number;

  private resourceServer?: x402ResourceServer;

  // Grantees metadata for richer 402 responses
  private readonly route?: string;
  private readonly resourceName?: string;
  private readonly resourceDescription?: string;
  private readonly mimeType: string;

  constructor(options: MerchantExecutorOptions) {
    this.legacyNetwork = options.network;
    this.network = this.toCAIP2Network(options.network);

    const builtinConfig = BUILT_IN_NETWORKS[options.network as LegacyNetwork] as
      | (typeof BUILT_IN_NETWORKS)[LegacyNetwork]
      | undefined;

    const assetAddress = options.assetAddress ?? builtinConfig?.assetAddress;
    const assetName = options.assetName ?? builtinConfig?.assetName;
    const chainId = options.chainId ?? builtinConfig?.chainId;
    const explorerUrl = options.explorerUrl ?? builtinConfig?.explorer;

    if (!assetAddress) {
      throw new Error(
        `Asset address must be provided for network "${options.network}". Set ASSET_ADDRESS in the environment.`,
      );
    }

    if (!assetName) {
      throw new Error(
        `Asset name must be provided for network "${options.network}". Set ASSET_NAME in the environment.`,
      );
    }

    this.assetName = assetName;
    this.chainId = chainId;
    this.explorerUrl = explorerUrl;

    // Grantees metadata
    this.route = options.route;
    this.resourceName = options.resourceName;
    this.resourceDescription = options.resourceDescription;
    this.mimeType = options.mimeType ?? "application/json";

    // Build x402 v2 payment requirements
    this.requirements = {
      scheme: "exact",
      network: this.network,
      asset: assetAddress,
      payTo: options.payToAddress,
      amount: this.getAtomicAmount(options.price),
      maxTimeoutSeconds: 600,
      extra: {
        name: assetName,
        version: "2",
      },
    };

    this.mode =
      options.settlementMode ??
      (options.facilitatorUrl || !options.privateKey ? "facilitator" : "direct");

    if (this.mode === "direct") {
      if (!options.privateKey) {
        throw new Error("Direct settlement requires PRIVATE_KEY to be configured.");
      }

      const normalizedKey = options.privateKey.startsWith("0x")
        ? options.privateKey
        : `0x${options.privateKey}`;

      const rpcUrl = options.rpcUrl || this.getDefaultRpcUrl(options.network);

      if (!rpcUrl) {
        throw new Error(
          `Direct settlement requires an RPC URL for network "${options.network}".`,
        );
      }

      if (typeof chainId !== "number") {
        throw new Error(
          `Direct settlement requires a numeric CHAIN_ID for network "${options.network}".`,
        );
      }

      try {
        this.settlementProvider = new ethers.JsonRpcProvider(rpcUrl);
        this.settlementWallet = new ethers.Wallet(normalizedKey, this.settlementProvider);
        console.log("⚡ Local settlement enabled via RPC provider");
      } catch (error) {
        throw new Error(
          `Failed to initialize direct settlement: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      this.facilitatorUrl = options.facilitatorUrl || DEFAULT_FACILITATOR_URL;
      this.facilitatorApiKey = options.facilitatorApiKey;
    }
  }

  /**
   * Initialize the resource server (async initialization for facilitator mode)
   */
  async initialize(): Promise<void> {
    if (this.mode !== "facilitator") return;

    const facilitatorClient = new HTTPFacilitatorClient({
      url: this.facilitatorUrl!,
      ...(this.facilitatorApiKey && {
        headers: { Authorization: `Bearer ${this.facilitatorApiKey}` },
      }),
    });

    this.resourceServer = new x402ResourceServer(facilitatorClient);

    // Register EVM scheme (eip155:* covers all EVM chains)
    registerExactEvmScheme(this.resourceServer);

    try {
      await this.resourceServer.initialize();
      console.log("✅ x402 Resource Server initialized with facilitator");
    } catch {
      // Non-fatal: facilitator might not be reachable yet, but we can still start
      console.warn("⚠️  Could not initialize with facilitator (will retry on first request)");
    }
  }

  private toCAIP2Network(network: string): Network {
    // If already in CAIP-2 format, return as-is
    if (network.includes(":")) return network as Network;

    const caip2 = NETWORK_MAP[network];
    if (!caip2) {
      throw new Error(
        `Unknown network "${network}". Use CAIP-2 format (e.g., eip155:43113) or a supported legacy name.`,
      );
    }
    return caip2 as Network;
  }

  getPaymentRequirements(): PaymentRequirements {
    return this.requirements;
  }

  createPaymentRequiredResponse() {
    const route = this.route ?? "/v1/github/analyze";
    const resourceName = this.resourceName ?? "Grantees API";
    const resourceDescription =
      this.resourceDescription ??
      "Paid endpoint for grant intelligence + capital access insights.";

    return {
      x402Version: 2,
      accepts: [this.requirements],
      error: `Payment required for Grantees: ${route}`,
      resource: {
        name: resourceName,
        description: resourceDescription,
        mimeType: this.mimeType,
      },
    };
  }

  async verifyPayment(payload: PaymentPayload): Promise<VerifyResult> {
    console.log("\n🔍 Verifying payment...");
    console.log(`   Network: ${(payload as any).accepted?.network || this.network}`);
    console.log(`   Scheme: ${(payload as any).accepted?.scheme || "exact"}`);
    console.log(`   To: ${this.requirements.payTo}`);
    console.log(`   Amount: ${this.requirements.amount}`);

    try {
      const result =
        this.mode === "direct"
          ? this.verifyPaymentLocally(payload, this.requirements)
          : await this.callFacilitator<VerifyResult>("verify", payload);

      console.log("\n📋 Verification result:");
      console.log(`   Valid: ${result.isValid}`);
      if (!result.isValid) console.log(`   ❌ Reason: ${result.invalidReason}`);

      return result;
    } catch (error) {
      const parsed = parsePaymentError(error);
      console.error("\n❌ Verification failed:");
      console.error(`   Code: ${parsed.code}`);
      console.error(`   Message: ${parsed.message}`);
      if (parsed.code !== "UNKNOWN_ERROR") console.error(`\n${parsed.suggestion}`);

      return { isValid: false, invalidReason: parsed.message };
    }
  }

  async settlePayment(payload: PaymentPayload): Promise<SettlementResult> {
    console.log("\n💰 Settling payment...");
    console.log(`   Network: ${this.network}`);
    console.log(`   Amount: ${this.requirements.amount} (micro units)`);
    console.log(`   Pay to: ${this.requirements.payTo}`);

    try {
      const result =
        this.mode === "direct"
          ? await this.settleOnChain(payload, this.requirements)
          : await this.callFacilitator<SettlementResult>("settle", payload);

      console.log("\n✅ Payment settlement result:");
      console.log(`   Success: ${result.success}`);
      console.log(`   Network: ${result.network}`);

      if (result.transaction) {
        console.log(`   Transaction: ${result.transaction}`);
        if (this.explorerUrl) console.log(`   Explorer: ${this.explorerUrl}/tx/${result.transaction}`);
      }
      if (result.payer) console.log(`   Payer: ${result.payer}`);
      if (result.errorReason) console.log(`   Error: ${result.errorReason}`);

      return result;
    } catch (error) {
      const parsed = parsePaymentError(error);
      console.error("\n❌ Settlement failed:");
      console.error(`   Code: ${parsed.code}`);
      console.error(`   Message: ${parsed.message}`);
      if (parsed.code !== "UNKNOWN_ERROR") console.error(`\n${parsed.suggestion}`);

      return { success: false, network: this.network, errorReason: parsed.message };
    }
  }

  private verifyPaymentLocally(payload: PaymentPayload, requirements: PaymentRequirements): VerifyResult {
    const exactPayload = payload.payload as any;
    const authorization = exactPayload?.authorization;
    const signature = exactPayload?.signature;

    if (!authorization || !signature) {
      return { isValid: false, invalidReason: "Missing payment authorization data" };
    }

    // v2 payload structure (accepted field) or v1 structure (network field)
    const payloadNetwork = (payload as any).accepted?.network || (payload as any).network;
    if (payloadNetwork !== requirements.network) {
      return {
        isValid: false,
        invalidReason: `Network mismatch: ${payloadNetwork} vs ${requirements.network}`,
      };
    }

    if (authorization.to?.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return { isValid: false, invalidReason: "Authorization recipient does not match requirement" };
    }

    try {
      const requiredAmount = BigInt(requirements.amount);
      const authorizedAmount = BigInt(authorization.value);
      if (authorizedAmount < requiredAmount) {
        return { isValid: false, invalidReason: "Authorized amount is less than required amount" };
      }
    } catch {
      return { isValid: false, invalidReason: "Invalid payment amount provided" };
    }

    const validAfterNum = Number(authorization.validAfter ?? 0);
    const validBeforeNum = Number(authorization.validBefore ?? 0);
    if (Number.isNaN(validAfterNum) || Number.isNaN(validBeforeNum)) {
      return { isValid: false, invalidReason: "Invalid authorization timing fields" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (validAfterNum > now) return { isValid: false, invalidReason: "Authorization not yet valid" };
    if (validBeforeNum <= now) return { isValid: false, invalidReason: "Authorization expired" };

    try {
      const domain = this.buildEip712Domain(requirements);
      const recovered = ethers.verifyTypedData(
        domain,
        TRANSFER_AUTH_TYPES,
        {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          nonce: authorization.nonce,
        },
        signature,
      );

      if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
        return { isValid: false, invalidReason: "Signature does not match payer address" };
      }

      return { isValid: true, payer: recovered };
    } catch (error) {
      return {
        isValid: false,
        invalidReason: `Signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async settleOnChain(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettlementResult> {
    if (!this.settlementWallet) {
      return { success: false, network: requirements.network, errorReason: "Settlement wallet not configured" };
    }

    const exactPayload = payload.payload as any;
    const authorization = exactPayload?.authorization;
    const signature = exactPayload?.signature;

    if (!authorization || !signature) {
      return { success: false, network: requirements.network, errorReason: "Missing payment authorization data" };
    }

    try {
      const usdcContract = new ethers.Contract(
        requirements.asset,
        [
          "function transferWithAuthorization(" +
            "address from," +
            "address to," +
            "uint256 value," +
            "uint256 validAfter," +
            "uint256 validBefore," +
            "bytes32 nonce," +
            "uint8 v," +
            "bytes32 r," +
            "bytes32 s" +
            ") external returns (bool)",
        ],
        this.settlementWallet,
      );

      const parsedSignature = ethers.Signature.from(signature);
      const tx = await usdcContract.transferWithAuthorization(
        authorization.from,
        authorization.to,
        authorization.value,
        authorization.validAfter,
        authorization.validBefore,
        authorization.nonce,
        parsedSignature.v,
        parsedSignature.r,
        parsedSignature.s,
      );

      const receipt = await tx.wait();
      const success = receipt?.status === 1;

      return {
        success,
        transaction: receipt?.hash,
        network: requirements.network,
        payer: authorization.from,
        errorReason: success ? undefined : "Transaction reverted",
      };
    } catch (error) {
      return {
        success: false,
        network: requirements.network,
        payer: authorization.from,
        errorReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getAtomicAmount(priceUsd: number): string {
    // USDC uses 6 decimals => "micro" units
    const atomicUnits = Math.floor(priceUsd * 1_000_000);
    return atomicUnits.toString();
  }

  private buildHeaders() {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.facilitatorApiKey) headers.Authorization = `Bearer ${this.facilitatorApiKey}`;
    return headers;
  }

  private async callFacilitator<T>(endpoint: "verify" | "settle", payload: PaymentPayload): Promise<T> {
    if (!this.facilitatorUrl) throw new Error("Facilitator URL is not configured.");

    const response = await fetch(`${this.facilitatorUrl}/${endpoint}`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: this.requirements,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Facilitator ${endpoint} failed (${response.status}): ${text || response.statusText}`);
    }

    return (await response.json()) as T;
  }

  private buildEip712Domain(requirements: PaymentRequirements) {
    // Determine chainId: use stored chainId, extract from CAIP-2, or default to Fuji
    let chainId = this.chainId;
    if (!chainId && this.network.startsWith("eip155:")) {
      const chainIdStr = this.network.split(":")[1];
      chainId = Number.parseInt(chainIdStr, 10);
    }
    // Fallback to Fuji (43113) if still undefined
    if (!chainId) {
      console.warn("⚠️  chainId undefined; using Fuji default (43113)");
      chainId = 43113;
    }

    return {
      name: (requirements.extra?.name as string) || this.assetName,
      version: (requirements.extra?.version as string) || "2",
      chainId,
      verifyingContract: requirements.asset,
    };
  }

  private getDefaultRpcUrl(network: string): string | undefined {
    switch (network) {
      case "base":
        return "https://mainnet.base.org";
      case "base-sepolia":
        return "https://sepolia.base.org";
      case "polygon":
        return "https://polygon-rpc.com";
      case "polygon-amoy":
        return "https://rpc-amoy.polygon.technology";
      case "avalanche":
        return "https://api.avax.network/ext/bc/C/rpc";
      case "avalanche-fuji":
        return "https://api.avax-test.network/ext/bc/C/rpc";
      case "iotex":
        return "https://rpc.ankr.com/iotex";
      case "sei":
        return "https://sei-rpc.publicnode.com";
      case "sei-testnet":
        return "https://sei-testnet-rpc.publicnode.com";
      case "peaq":
        return "https://erpc.peaq.network";
      default:
        return undefined;
    }
  }
}
