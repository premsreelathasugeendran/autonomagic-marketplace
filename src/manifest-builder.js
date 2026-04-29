"use strict";
/**
 * manifest-builder — generates the three discovery surfaces:
 *
 *   - /.well-known/x402.json        (canonical x402 v1 manifest)
 *   - /.well-known/agent-card.json  (EIP-8004 / A2A agent card)
 *   - /openapi.json                 (OpenAPI 3.0 spec)
 *
 * All pure functions over (endpoints, ctx). No I/O.
 */

const { jsonSchemaToFieldDefs, inferKind } = require("./schema.js");
const { USDC_ADDRESSES, buildBazaarInput, buildBazaarOutput } = require("./402-builder.js");

/**
 * Build /.well-known/x402.json — the canonical x402 v1 discovery manifest.
 * Indexers like x402scan crawl this to enumerate paid endpoints on a server.
 */
function buildManifest(endpoints, ctx) {
  const network = ctx.network || "eip155:8453";
  const usdcAddress = USDC_ADDRESSES[network];

  return {
    x402Version: 1,
    name: ctx.serviceName || "x402 Service",
    description: ctx.serviceDescription || "x402-paid HTTP endpoints",
    payTo: ctx.payToAddress,
    network,
    asset: usdcAddress,
    endpoints: endpoints.map((e) => ({
      path: e.path,
      method: e.method.toUpperCase(),
      // Atomic units (USDC has 6 decimals)
      price: BigInt(Math.round(e.priceUsdc * 1_000_000)).toString(),
      priceUsdc: e.priceUsdc,
      description: e.description,
      // Bazaar-shape full schema (so indexers don't need to probe each endpoint)
      inputSchema: e.inputSchema || (e.bazaarInput ? null : undefined),
      outputSchema: {
        input: buildBazaarInput(e),
        output: buildBazaarOutput(e),
      },
    })),
  };
}

/**
 * Build /.well-known/agent-card.json — EIP-8004 / A2A agent card.
 * Used for cross-agent discovery (Google A2A protocol, EIP-8004 agent registry).
 */
function buildAgentCard(endpoints, ctx) {
  const baseUrl = ctx.publicBaseUrl || "http://localhost:3402";

  return {
    name: ctx.serviceName || "x402 Service",
    description: ctx.serviceDescription || "x402-paid HTTP endpoints",
    url: baseUrl,
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    x402Support: true,
    payTo: ctx.payToAddress,
    network: ctx.network || "eip155:8453",
    skills: endpoints.map((e) => ({
      id: e.path.replace(/^\/api\//, ""),
      name: e.description,
      description: `${e.method.toUpperCase()} ${e.path} — $${e.priceUsdc} USDC per call`,
      inputModes:  ["application/json"],
      outputModes: ["application/json"],
    })),
  };
}

/**
 * Build /openapi.json — OpenAPI 3.0 spec auto-generated from plugin schemas.
 * Useful for AI agents using OpenAPI SDKs to discover + call endpoints.
 */
function buildOpenApi(endpoints, ctx) {
  const baseUrl = ctx.publicBaseUrl || "http://localhost:3402";
  const network = ctx.network || "eip155:8453";

  const paths = {};
  for (const e of endpoints) {
    const methodLower = e.method.toLowerCase();
    paths[e.path] = paths[e.path] || {};

    const operation = {
      operationId: e.path.replace(/[^a-zA-Z0-9]+/g, "_") + "_" + methodLower,
      summary: e.description,
      description: `Price: $${e.priceUsdc} USDC via x402 on ${network}`,
      responses: {
        "200": {
          description: "Success",
          content: { "application/json": { schema: { type: "object" } } },
        },
        "402": {
          description: "Payment Required (x402 challenge)",
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    };

    // Add request body schema if present
    if (e.inputSchema && ["POST", "PUT", "PATCH"].includes(e.method.toUpperCase())) {
      operation.requestBody = {
        content: {
          "application/json": { schema: e.inputSchema },
        },
      };
    }

    paths[e.path][methodLower] = operation;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: ctx.serviceName || "x402 Service",
      description: ctx.serviceDescription || "x402-paid HTTP endpoints. Pay USDC on Base, get response in <2 sec.",
      version: "1.0.0",
    },
    servers: [{ url: baseUrl, description: "Production" }],
    paths,
  };
}

module.exports = {
  buildManifest,
  buildAgentCard,
  buildOpenApi,
};
