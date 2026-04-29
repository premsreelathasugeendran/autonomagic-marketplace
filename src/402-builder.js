"use strict";
/**
 * 402-builder — generates the Bazaar-shape Payment Required response body.
 *
 * The 402 body is what every paid endpoint returns when called without payment.
 * x402scan and other indexers parse this body to register the endpoint in
 * strict mode, so the shape MUST match what they expect (see SPEC.md).
 *
 * This module is a pure function over (endpoint, ctx). No I/O, no side effects.
 */

const { jsonSchemaToFieldDefs, inferKind } = require("./schema.js");

// USDC contract addresses on Base
const USDC_ADDRESSES = {
  "eip155:8453":  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

/**
 * Build the 402 response body for a given endpoint + context.
 *
 * @param {object} endpoint - Plugin object (see schema.js)
 * @param {object} ctx - Marketplace context: { network, payToAddress, publicBaseUrl, serviceName, serviceDescription, iconUrl }
 * @returns {object} - The 402 body shape (Bazaar-compliant)
 */
function buildPaymentRequired(endpoint, ctx) {
  const network = ctx.network || "eip155:8453";
  const usdcAddress = USDC_ADDRESSES[network];
  if (!usdcAddress) {
    throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(USDC_ADDRESSES).join(", ")}`);
  }

  // Convert priceUsdc to atomic units (USDC has 6 decimals)
  const atomic = BigInt(Math.round(endpoint.priceUsdc * 1_000_000)).toString();

  // Build the Bazaar-shape outputSchema with input + output sub-objects.
  // Plugins can supply their own bazaarInput/bazaarOutput, OR provide JSON Schema
  // via inputSchema/outputSchema (auto-converted), OR neither (permissive default).
  const outSchema = {
    input:  buildBazaarInput(endpoint),
    output: buildBazaarOutput(endpoint),
  };

  // Resolve absolute resource URL — Bazaar requires absolute URLs.
  const baseHost = ctx.publicBaseUrl || `http://localhost:${ctx.port || 3402}`;
  const resourceUrl = endpoint.path.startsWith("http")
    ? endpoint.path
    : `${baseHost.replace(/\/$/, "")}${endpoint.path}`;

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network,
        maxAmountRequired: atomic,
        resource: resourceUrl,
        description: endpoint.description,
        mimeType: "application/json",
        payTo: ctx.payToAddress,
        maxTimeoutSeconds: 60,
        asset: usdcAddress,
        outputSchema: outSchema,
        extra: {
          // EIP-712 domain — REQUIRED for buyer wallets to sign EIP-3009
          // transferWithAuthorization correctly. Without it, signatures fail.
          name: "USD Coin",
          version: "2",
          chainId: network === "eip155:8453" ? 8453 : 84532,
          decimals: 6,
          eip712: { name: "USD Coin", version: "2" },
          // Service metadata — used by marketplace UIs (x402scan, etc.) for
          // rendering. None of these are required by the spec, all are nice-to-have.
          serviceName: ctx.serviceName,
          serviceDescription: ctx.serviceDescription,
          serviceUrl: baseHost,
          iconUrl: ctx.iconUrl,
          avatarUrl: ctx.avatarUrl,
          kind: inferKind(endpoint),
          pricing: {
            amount:        endpoint.priceUsdc,
            currency:      "USDC",
            network:       network === "eip155:8453" ? "Base" : "Base Sepolia",
            defaultAmount: endpoint.priceUsdc,
          },
        },
      },
    ],
  };
}

/**
 * Build Bazaar-shape `input` from a plugin's existing schema.
 * Accepts:
 *   - endpoint.bazaarInput (used as-is)
 *   - endpoint.inputSchema (JSON Schema, auto-converted)
 *   - neither (permissive default)
 */
function buildBazaarInput(endpoint) {
  if (endpoint.bazaarInput) return endpoint.bazaarInput;

  const method = (endpoint.method || "POST").toUpperCase();
  const isBodied = !["GET", "HEAD", "DELETE"].includes(method);

  const base = { type: "http", method };

  if (endpoint.inputSchema && typeof endpoint.inputSchema === "object") {
    const fields = jsonSchemaToFieldDefs(endpoint.inputSchema);
    if (isBodied) {
      base.bodyType   = "json";
      if (Object.keys(fields).length > 0) base.bodyFields = fields;
    } else {
      if (Object.keys(fields).length > 0) base.queryParams = fields;
    }
    return base;
  }

  // Permissive default — describes the shape without prescribing fields.
  if (isBodied) {
    base.bodyType   = "json";
    base.bodyFields = {};
  } else {
    base.queryParams = {};
  }
  return base;
}

/**
 * Build Bazaar-shape `output` from a plugin's existing schema.
 */
function buildBazaarOutput(endpoint) {
  if (endpoint.bazaarOutput) return endpoint.bazaarOutput;

  if (endpoint.outputSchema && typeof endpoint.outputSchema === "object") {
    return jsonSchemaToFieldDefs(endpoint.outputSchema);
  }

  // Generic placeholder when no output schema declared.
  return {
    ok: { type: "boolean", description: "Whether the request succeeded." },
  };
}

module.exports = {
  buildPaymentRequired,
  buildBazaarInput,
  buildBazaarOutput,
  USDC_ADDRESSES,
};
