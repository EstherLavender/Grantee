#!/usr/bin/env node
import { ethers } from "ethers";

// Usage:
// NODE_OPTIONS=--experimental-json-modules node scripts/signTransferAuth.js '<privateKey>' '<from>' '<to>' '<value>' '<validAfter>' '<validBefore>' '<nonce>'
// Example:
// node scripts/signTransferAuth.js b9e7... 0xPAYER 0xPAYTO 100000 0 9999999999 0x0123

function usageAndExit(msg) {
  if (msg) console.error(msg);
  console.error("\nUsage: node scripts/signTransferAuth.js <privateKey> <from> <to> <value> <validAfter> <validBefore> <nonce>\n");
  process.exit(msg ? 1 : 0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 7) return usageAndExit();

  const [privateKey, from, to, valueStr, validAfterStr, validBeforeStr, nonce] = args;

  if (!privateKey || !from || !to) return usageAndExit("Missing required args");

  const wallet = new ethers.Wallet(privateKey);

  const value = valueStr;
  const validAfter = validAfterStr;
  const validBefore = validBeforeStr;

  // Build domain: user likely wants Fuji (43113) by default; allow override via env
  const chainId = process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : 43113;
  const verifyingContract = process.env.ASSET_ADDRESS || "0x5425890298aed601595a70AB815c96711a31Bc65"; // common Fuji USDC
  const name = process.env.ASSET_NAME || "USD Coin";
  const version = process.env.ASSET_VERSION || "2";

  const domain = {
    name,
    version,
    chainId,
    verifyingContract,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const message = {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  try {
    const signature = await wallet._signTypedData(domain, types, message);

    // Output a minimal payment payload structure your server accepts
    const paymentPayload = {
      accepted: {
        network: process.env.NETWORK || "eip155:43113",
        scheme: "exact",
      },
      payload: {
        authorization: message,
        signature,
      },
    };

    console.log(JSON.stringify({ paymentPayload }, null, 2));
  } catch (err) {
    console.error("Failed to sign typed data:", err);
    process.exit(1);
  }
}

main();
