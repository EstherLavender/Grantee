import { x402Facilitator } from "@x402/core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
  Network,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import dotenv from "dotenv";
import express from "express";
import { createWalletClient, http, publicActions, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  base,
  baseSepolia,
  polygon,
  polygonAmoy,
  avalanche,
  avalancheFuji,
  iotex,
  sei,
  seiTestnet,
} from "viem/chains";

dotenv.config();

// Configuration
const PORT = process.env.FACILITATOR_PORT || "4022";

// ✅ Fuji-first (EVM only)
const EVM_NETWORK = process.env.FACILITATOR_EVM_NETWORK || "avalanche-fuji";

// Map network names to viem chains
const VIEM_CHAINS: Record<string, Chain> = {
  base,
  "base-sepolia": baseSepolia,
  polygon,
  "polygon-amoy": polygonAmoy,
  avalanche,
  "avalanche-fuji": avalancheFuji,
  iotex,
  sei,
  "sei-testnet": seiTestnet,
};

// Map legacy network names to CAIP-2 format (EVM only)
const NETWORK_TO_CAIP2: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
  avalanche: "eip155:43114",
  "avalanche-fuji": "eip155:43113",
  iotex: "eip155:4689",
  sei: "eip155:1329",
  "sei-testnet": "eip155:1328",
};

function getEvmCaip2Network(network: string): Network {
  if (network.startsWith("eip155:")) return network as Network;
  const mapped = NETWORK_TO_CAIP2[network];
  if (!mapped) throw new Error(`Unknown EVM network "${network}"`);
  return mapped as Network;
}

/**
 * Parse payment errors and provide helpful, actionable error messages (EVM only).
 */
function parsePaymentError(error: unknown, network?: string): {
  message: string;
  suggestion: string;
  code: string;
} {
  const errorStr = error instanceof Error ? error.message : String(error);

  if (
    errorStr.includes("insufficient funds for gas") ||
    errorStr.includes("gas required exceeds allowance")
  ) {
    return {
      code: "INSUFFICIENT_GAS",
      message: "Not enough native tokens for gas fees",
      suggestion:
        "🔧 FIX: Fund the facilitator EVM wallet with test AVAX on Fuji (enough for gas).",
    };
  }

  if (
    errorStr.includes("transfer amount exceeds balance") ||
    errorStr.includes("ERC20: transfer amount exceeds balance") ||
    errorStr.toLowerCase().includes("insufficient usdc")
  ) {
    return {
      code: "INSUFFICIENT_USDC",
      message: "Not enough USDC tokens for the payment",
      suggestion:
        "🔧 FIX: Ensure the payer wallet has enough USDC on Avalanche Fuji for the required amount.",
    };
  }

  if (errorStr.includes("execution reverted") || errorStr.includes("transaction reverted")) {
    return {
      code: "TRANSACTION_REVERTED",
      message: "Transaction was reverted by the smart contract",
      suggestion:
        "🔧 FIX: Common causes: expired authorization (validBefore), reused nonce, invalid signature, or invalid payTo/asset.",
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: errorStr,
    suggestion: "Check logs above and verify the network, token address, and signatures are correct.",
  };
}

async function startFacilitator() {
  const hasEvmKey = !!process.env.EVM_PRIVATE_KEY;

  if (!hasEvmKey) {
    console.error("❌ EVM_PRIVATE_KEY is required for the facilitator (EVM-only setup).");
    console.error("");
    console.error("   Example:");
    console.error("     EVM_PRIVATE_KEY=0x...");
    console.error("     FACILITATOR_EVM_NETWORK=avalanche-fuji  (optional, default: avalanche-fuji)");
    console.error("     FACILITATOR_EVM_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc (optional)");
    process.exit(1);
  }

  // Initialize the x402 Facilitator with lifecycle hooks for logging
  const facilitator = new x402Facilitator()
    .onBeforeVerify(async (context) => {
      console.log("🔍 Verifying payment...", {
        network: context.requirements.network,
        amount: context.requirements.amount,
        payTo: context.requirements.payTo,
      });
    })
    .onAfterVerify(async (context) => {
      console.log("✅ Payment verified:", {
        isValid: context.result.isValid,
        payer: context.result.payer,
      });
    })
    .onVerifyFailure(async (context) => {
      const parsed = parsePaymentError(context.error, context.requirements?.network);
      console.log("\n❌ Verify failure:");
      console.log(`   Code: ${parsed.code}`);
      console.log(`   Message: ${parsed.message}`);
      if (parsed.code !== "UNKNOWN_ERROR") console.log(`\n${parsed.suggestion}`);
    })
    .onBeforeSettle(async (context) => {
      console.log("💰 Settling payment...", {
        network: context.requirements.network,
        amount: context.requirements.amount,
      });
    })
    .onAfterSettle(async (context) => {
      console.log("✅ Payment settled:", {
        success: context.result.success,
        transaction: context.result.transaction,
        network: context.result.network,
      });
    })
    .onSettleFailure(async (context) => {
      const parsed = parsePaymentError(context.error, context.requirements?.network);
      console.log("\n❌ Settle failure:");
      console.log(`   Code: ${parsed.code}`);
      console.log(`   Message: ${parsed.message}`);
      if (parsed.code !== "UNKNOWN_ERROR") console.log(`\n${parsed.suggestion}`);
    });

  // =========================================================================
  // Initialize EVM
  // =========================================================================
  const evmRpcUrl = process.env.FACILITATOR_EVM_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";

  console.log(`🔧 Facilitator EVM_NETWORK=${EVM_NETWORK}`);
  console.log(`🔧 Facilitator RPC URL: ${evmRpcUrl}`);

  // Resolve viem chain (allow both legacy key or CAIP-2). Try to recover from CAIP-2 values.
  let viemChain = VIEM_CHAINS[EVM_NETWORK];
  if (!viemChain && EVM_NETWORK.startsWith("eip155:")) {
    // Try to map CAIP-2 back to a supported legacy key
    const legacyKey = Object.keys(NETWORK_TO_CAIP2).find((k) => NETWORK_TO_CAIP2[k] === EVM_NETWORK);
    if (legacyKey) {
      viemChain = VIEM_CHAINS[legacyKey];
      console.log(`ℹ️  Mapped CAIP-2 ${EVM_NETWORK} -> legacy key ${legacyKey}`);
    }
  }

  if (!viemChain) {
    console.error(`❌ Unknown or unsupported EVM network "${EVM_NETWORK}"`);
    console.error("   Supported networks:", Object.keys(VIEM_CHAINS).join(", "));
    process.exit(1);
  }

  console.log(`✅ Resolved EVM chain: ${viemChain.name || "(unknown name)"} (id=${(viemChain as any).id})`);

  const evmPrivateKey = process.env.EVM_PRIVATE_KEY!.startsWith("0x")
    ? (process.env.EVM_PRIVATE_KEY as `0x${string}`)
    : (`0x${process.env.EVM_PRIVATE_KEY}` as `0x${string}`);

  const evmAccount = privateKeyToAccount(evmPrivateKey);
  const evmAddress = evmAccount.address;
  console.log(`💼 EVM Facilitator account: ${evmAddress}`);
  console.log(`🌐 EVM Network: ${EVM_NETWORK}`);
  console.log(`🔌 RPC: ${evmRpcUrl}`);

  const viemClient = createWalletClient({
    account: evmAccount,
    chain: viemChain,
    transport: http(evmRpcUrl),
  }).extend(publicActions);

  const evmSigner = toFacilitatorEvmSigner({
    getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
    address: evmAccount.address,
    readContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) =>
      viemClient.readContract({
        ...args,
        args: args.args || [],
      }),
    verifyTypedData: (args: {
      address: `0x${string}`;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: `0x${string}`;
    }) => viemClient.verifyTypedData(args as any),
    writeContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
    }) =>
      viemClient.writeContract({
        ...args,
        chain: viemChain,
        args: args.args || [],
      } as any),
    sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
      viemClient.sendTransaction({
        ...args,
        chain: viemChain,
      } as any),
    waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
      viemClient.waitForTransactionReceipt(args),
  });

  let evmCaip2: string;
  try {
    evmCaip2 = getEvmCaip2Network(EVM_NETWORK);
    registerExactEvmScheme(facilitator, {
      signer: evmSigner,
      networks: evmCaip2,
    });
    console.log(`🔗 Registered EVM network: ${evmCaip2}`);
  } catch (err) {
    console.error("❌ Failed to register EVM scheme with facilitator:", err instanceof Error ? err.message : String(err));
    console.error("Ensure FACILITATOR_EVM_NETWORK is a supported legacy name (e.g. avalanche-fuji) or a valid CAIP-2 value (eip155:43113)");
    process.exit(1);
  }

  // =========================================================================
  // Initialize Express app
  // =========================================================================
  const app = express();
  app.use(express.json());

  /**
   * POST /verify
   */
  app.post("/verify", async (req, res) => {
    try {
      const { paymentPayload, paymentRequirements } = req.body as {
        paymentPayload: PaymentPayload;
        paymentRequirements: PaymentRequirements;
      };

      if (!paymentPayload || !paymentRequirements) {
        return res.status(400).json({
          error: "Missing paymentPayload or paymentRequirements",
        });
      }

      const response: VerifyResponse = await facilitator.verify(
        paymentPayload,
        paymentRequirements,
      );

      return res.json(response);
    } catch (error) {
      const network =
        req.body?.paymentRequirements?.network || req.body?.paymentPayload?.network;
      const parsed = parsePaymentError(error, network);

      console.error("\n❌ Verify endpoint error:");
      console.error(`   Code: ${parsed.code}`);
      console.error(`   Message: ${parsed.message}`);
      if (parsed.code !== "UNKNOWN_ERROR") console.error(`\n${parsed.suggestion}`);

      return res.status(500).json({
        error: parsed.message,
        code: parsed.code,
        suggestion: parsed.suggestion,
      });
    }
  });

  /**
   * POST /settle
   */
  app.post("/settle", async (req, res) => {
    try {
      const { paymentPayload, paymentRequirements } = req.body as {
        paymentPayload: PaymentPayload;
        paymentRequirements: PaymentRequirements;
      };

      if (!paymentPayload || !paymentRequirements) {
        return res.status(400).json({
          error: "Missing paymentPayload or paymentRequirements",
        });
      }

      const response: SettleResponse = await facilitator.settle(
        paymentPayload,
        paymentRequirements,
      );

      return res.json(response);
    } catch (error) {
      const network =
        req.body?.paymentRequirements?.network || req.body?.paymentPayload?.network;
      const parsed = parsePaymentError(error, network);

      console.error("\n❌ Settle endpoint error:");
      console.error(`   Code: ${parsed.code}`);
      console.error(`   Message: ${parsed.message}`);
      if (parsed.code !== "UNKNOWN_ERROR") console.error(`\n${parsed.suggestion}`);

      // If this was an abort from hook
      if (error instanceof Error && error.message.includes("Settlement aborted:")) {
        return res.json({
          success: false,
          errorReason: error.message.replace("Settlement aborted: ", ""),
          network: network || "unknown",
        } as SettleResponse);
      }

      return res.status(500).json({
        error: parsed.message,
        code: parsed.code,
        suggestion: parsed.suggestion,
      });
    }
  });

  /**
   * GET /supported
   */
  app.get("/supported", async (_req, res) => {
    try {
      const response = facilitator.getSupported();
      return res.json(response);
    } catch (error) {
      console.error("Supported error:", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /health
   */
  app.get("/health", (_req, res) => {
    return res.json({
      status: "healthy",
      service: "x402-facilitator",
      networks: {
        evm: {
          network: evmCaip2,
          address: evmAddress,
        },
      },
    });
  });

  // Start the server
  app.listen(parseInt(PORT, 10), () => {
    console.log(`\n✅ x402 Facilitator (EVM-only) running on http://localhost:${PORT}`);
    console.log(`📖 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 Supported: http://localhost:${PORT}/supported`);
    console.log(`\n🌐 Enabled network:`);
    console.log(`   ✅ EVM: ${evmCaip2} (${EVM_NETWORK})`);
    console.log(`\n💡 To use this facilitator, set in your .env:`);
    console.log(`   FACILITATOR_URL=http://localhost:${PORT}`);
  });
}

startFacilitator().catch((error) => {
  console.error("❌ Failed to start facilitator:", error);
  process.exit(1);
});
