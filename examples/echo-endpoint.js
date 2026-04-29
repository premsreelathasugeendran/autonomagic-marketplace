"use strict";
/**
 * Example plugin: echo back the request body.
 *
 * Useful for verifying the marketplace pipeline end-to-end (request →
 * 402 challenge → payment → handler call → response).
 */

module.exports = {
  path: "/api/echo",
  method: "POST",
  priceUsdc: 0.001,
  description: "Echo back the request body. Pipeline verification endpoint.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: true,
  },
  outputSchema: {
    type: "object",
    properties: {
      received: { type: "object", description: "The parsed request body." },
      ts:       { type: "string", description: "Server-side ISO timestamp." },
      payer:    { type: "string", description: "Wallet address that paid for this call." },
    },
  },
  async handle(body, ctx) {
    return {
      received: body,
      ts: new Date().toISOString(),
      payer: (ctx && ctx.fromAddress) || null,
    };
  },
};
