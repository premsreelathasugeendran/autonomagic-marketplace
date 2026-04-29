"use strict";
/**
 * autonomagic-marketplace
 *
 * Open plugin primitive for x402. Drop a JS file matching the contract,
 * the loader registers it as a paid HTTP endpoint in ~400ms.
 *
 * Public API:
 *   - createMarketplace(opts) -> { handler, addPlugin, removePlugin, getEndpoints }
 *   - validatePlugin(plugin) -> { ok, errors }
 *   - buildPaymentRequired(endpoint, ctx) -> 402 response body (Bazaar-shape)
 *   - buildManifest(opts) -> /.well-known/x402.json shape
 *
 * See README.md for usage, SPEC.md for the protocol details.
 */

const { createMarketplace } = require("./marketplace.js");
const { validatePlugin } = require("./schema.js");
const { buildPaymentRequired } = require("./402-builder.js");
const { buildManifest, buildAgentCard, buildOpenApi } = require("./manifest-builder.js");
const { createPluginLoader } = require("./plugin-loader.js");

module.exports = {
  createMarketplace,
  validatePlugin,
  buildPaymentRequired,
  buildManifest,
  buildAgentCard,
  buildOpenApi,
  createPluginLoader,
  VERSION: "0.1.0",
};
