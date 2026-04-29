"use strict";
/**
 * Basic smoke tests for autonomagic-marketplace.
 * Run with: node tests/basic.test.js
 *
 * No external test framework. If anything throws, the test fails.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const {
  validatePlugin,
  buildPaymentRequired,
  buildManifest,
  buildAgentCard,
  buildOpenApi,
  createPluginLoader,
} = require("../src/index.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

console.log("");
console.log("=== validatePlugin ===");

test("rejects null", () => {
  const r = validatePlugin(null);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test("rejects empty object", () => {
  const r = validatePlugin({});
  assert.equal(r.ok, false);
});

test("rejects bad path", () => {
  const r = validatePlugin({
    path: "/wrong/format",
    method: "POST",
    priceUsdc: 0.01,
    description: "x",
    handle: async () => {},
  });
  assert.equal(r.ok, false);
});

test("rejects negative price", () => {
  const r = validatePlugin({
    path: "/api/test",
    method: "POST",
    priceUsdc: -0.01,
    description: "x",
    handle: async () => {},
  });
  assert.equal(r.ok, false);
});

test("rejects price over 1.0", () => {
  const r = validatePlugin({
    path: "/api/test",
    method: "POST",
    priceUsdc: 1.5,
    description: "x",
    handle: async () => {},
  });
  assert.equal(r.ok, false);
});

test("accepts valid plugin", () => {
  const r = validatePlugin({
    path: "/api/test",
    method: "POST",
    priceUsdc: 0.01,
    description: "test endpoint",
    handle: async () => ({ ok: true }),
  });
  assert.equal(r.ok, true, "errors: " + JSON.stringify(r.errors));
});

console.log("");
console.log("=== buildPaymentRequired ===");

const fakeEndpoint = {
  path: "/api/dev-profile",
  method: "POST",
  priceUsdc: 0.02,
  description: "Enriched developer profile from public sources.",
  inputSchema: {
    type: "object",
    properties: {
      github: { type: "string", description: "GitHub username" },
    },
    required: ["github"],
  },
  handle: async () => ({}),
};

const fakeCtx = {
  network: "eip155:8453",
  payToAddress: "0x6C6013313dfa397f792c72f61b36A5d6bc20919b",
  publicBaseUrl: "https://api.example.com",
  serviceName: "Example Service",
  serviceDescription: "Example.",
};

test("402 body has x402Version 1", () => {
  const body = buildPaymentRequired(fakeEndpoint, fakeCtx);
  assert.equal(body.x402Version, 1);
});

test("402 body has accepts array of length 1", () => {
  const body = buildPaymentRequired(fakeEndpoint, fakeCtx);
  assert.equal(body.accepts.length, 1);
});

test("402 body's accepts[0] has required fields", () => {
  const a = buildPaymentRequired(fakeEndpoint, fakeCtx).accepts[0];
  assert.equal(a.scheme, "exact");
  assert.equal(a.network, "eip155:8453");
  assert.equal(a.maxAmountRequired, "20000"); // 0.02 USDC * 1_000_000
  assert.equal(a.payTo, fakeCtx.payToAddress);
  assert.equal(a.mimeType, "application/json");
  assert.equal(a.maxTimeoutSeconds, 60);
  assert.ok(a.asset.startsWith("0x"));
});

test("402 body resource is absolute URL", () => {
  const a = buildPaymentRequired(fakeEndpoint, fakeCtx).accepts[0];
  assert.equal(a.resource, "https://api.example.com/api/dev-profile");
});

test("402 body has Bazaar outputSchema.input", () => {
  const a = buildPaymentRequired(fakeEndpoint, fakeCtx).accepts[0];
  assert.equal(a.outputSchema.input.type, "http");
  assert.equal(a.outputSchema.input.method, "POST");
  assert.equal(a.outputSchema.input.bodyType, "json");
  assert.ok(a.outputSchema.input.bodyFields);
  assert.equal(a.outputSchema.input.bodyFields.github.required, true);
  assert.equal(a.outputSchema.input.bodyFields.github.type, "string");
});

test("402 body has EIP-712 domain in extra", () => {
  const a = buildPaymentRequired(fakeEndpoint, fakeCtx).accepts[0];
  assert.equal(a.extra.name, "USD Coin");
  assert.equal(a.extra.version, "2");
  assert.equal(a.extra.chainId, 8453);
  assert.equal(a.extra.decimals, 6);
  assert.deepEqual(a.extra.eip712, { name: "USD Coin", version: "2" });
});

test("402 builder rejects unknown network", () => {
  assert.throws(() => buildPaymentRequired(fakeEndpoint, { ...fakeCtx, network: "eip155:1" }));
});

console.log("");
console.log("=== buildManifest ===");

test("manifest has 22 fields per endpoint when 1 endpoint", () => {
  const m = buildManifest([fakeEndpoint], fakeCtx);
  assert.equal(m.x402Version, 1);
  assert.equal(m.endpoints.length, 1);
  assert.equal(m.endpoints[0].path, "/api/dev-profile");
});

test("manifest endpoints have outputSchema.input", () => {
  const m = buildManifest([fakeEndpoint], fakeCtx);
  assert.ok(m.endpoints[0].outputSchema.input);
  assert.equal(m.endpoints[0].outputSchema.input.type, "http");
});

console.log("");
console.log("=== buildAgentCard ===");

test("agent card has skills array", () => {
  const c = buildAgentCard([fakeEndpoint], fakeCtx);
  assert.equal(c.skills.length, 1);
  assert.equal(c.skills[0].id, "dev-profile");
  assert.equal(c.x402Support, true);
});

console.log("");
console.log("=== buildOpenApi ===");

test("openapi has paths", () => {
  const o = buildOpenApi([fakeEndpoint], fakeCtx);
  assert.equal(o.openapi, "3.0.3");
  assert.ok(o.paths["/api/dev-profile"].post);
});

console.log("");
console.log("=== createPluginLoader ===");

test("loader registers a valid plugin file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-"));
  const pluginPath = path.join(tmpDir, "test-plugin.js");
  fs.writeFileSync(pluginPath, `
    module.exports = {
      path: "/api/loadertest",
      method: "POST",
      priceUsdc: 0.001,
      description: "Loader test plugin.",
      async handle(body) { return { echo: body }; },
    };
  `);
  const loader = createPluginLoader({ pluginsDir: tmpDir });
  loader.start();
  const eps = loader.getEndpoints();
  assert.equal(eps.length, 1);
  assert.equal(eps[0].path, "/api/loadertest");
  loader.stop();
  fs.unlinkSync(pluginPath);
  fs.rmdirSync(tmpDir);
});

test("loader rejects an invalid plugin", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-"));
  const pluginPath = path.join(tmpDir, "bad-plugin.js");
  fs.writeFileSync(pluginPath, `
    module.exports = {
      path: "/wrong/path",
      method: "POST",
      priceUsdc: 999,
      description: "",
      handle: "not a function",
    };
  `);
  const loader = createPluginLoader({ pluginsDir: tmpDir });
  loader.start();
  assert.equal(loader.getEndpoints().length, 0);
  loader.stop();
  fs.unlinkSync(pluginPath);
  fs.rmdirSync(tmpDir);
});

console.log("");
console.log(`=== Result: ${passed} passed, ${failed} failed ===`);
console.log("");

process.exit(failed > 0 ? 1 : 0);
