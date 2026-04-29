# autonomagic-marketplace

> An open plugin primitive for the x402 protocol. Drop a JS file in `endpoints/`, the loader registers it as a paid HTTP endpoint in **~400 ms**. No restart, no redeploy. Bazaar-discovery compliant out of the box.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![x402](https://img.shields.io/badge/x402-v1-brightgreen.svg)](https://docs.cdp.coinbase.com/x402/welcome)
[![Built on Base](https://img.shields.io/badge/Base-mainnet-0052FF.svg)](https://www.base.org)

This is the production-tested plugin layer behind [Autonomagic](https://api.autonomagic.org) — an autonomous AI agent earning USDC on Base mainnet via x402. It's been extracted into a reusable SDK so any builder can add the same hot-reload + marketplace surface to their own x402 service.

---

## Why this exists

The x402 protocol fixes the payment plumbing (HTTP 402 + EIP-3009 USDC settlement on Base) but leaves the question of **what an x402 service should sell** entirely open. Every service today reinvents:

- The plugin format (how to declare a paid endpoint)
- The 402 response shape (Coinbase's spec under-specifies `outputSchema`, `extra`, EIP-712 domain)
- The discovery manifest format (so indexers like [x402scan](https://www.x402scan.com) can register the service)
- The hot-reload story (most agents need a full restart to ship a new endpoint)

`autonomagic-marketplace` standardizes all four. Drop in a JS file matching the contract; the loader handles the rest.

## The plugin contract

A plugin is a single JS file that exports an object with five fields:

```js
// b2b-profile.js
module.exports = {
  path: "/api/b2b-profile",            // required, must match /^\/api\/[a-z0-9-_]+$/
  method: "POST",                       // "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  priceUsdc: 0.05,                      // required, ≤ 1.0 (fat-finger / compromise protection)
  description: "Public-sources-only B2B company profile.",

  // OPTIONAL but recommended — Bazaar-shape input description for x402scan strict mode.
  // Either JSON Schema (auto-converted to Bazaar field-defs) or raw Bazaar shape.
  inputSchema: {
    type: "object",
    properties: {
      domain: { type: "string", description: "Company domain (e.g. 'stripe.com')" },
    },
    required: ["domain"],
  },

  // OPTIONAL — describes the response. Helps composer UIs render results.
  outputSchema: {
    type: "object",
    properties: {
      domain:    { type: "string" },
      homepage:  { type: "object" },
      dns:       { type: "object" },
    },
  },

  // The handler. Async function. Receives the parsed JSON body (or query params for GETs)
  // and a context object with the buyer's address, settled tx hash, etc.
  async handle(body, ctx) {
    const { domain } = body;
    // ... do the work ...
    return { domain, homepage: {/*...*/}, dns: {/*...*/} };
  },
};
```

That's the entire contract. **Five fields plus an async function.**

## Install

```bash
npm install autonomagic-marketplace
```

## Quick start

```js
const http = require("node:http");
const { createMarketplace } = require("autonomagic-marketplace");

const marketplace = createMarketplace({
  pluginsDir: "./endpoints",       // hot-reload watches this directory
  payToAddress: "0xYOUR_WALLET",   // where USDC goes
  network: "eip155:8453",          // Base mainnet
  serviceName: "My x402 Service",
  serviceDescription: "What I sell",
});

const server = http.createServer(marketplace.handler);
server.listen(3402, () => {
  console.log("x402 service live on :3402");
  console.log("Drop JS files in ./endpoints to add new paid endpoints");
});
```

Drop a file in `./endpoints/hash.js`:

```js
const { createHash } = require("node:crypto");

module.exports = {
  path: "/api/hash",
  method: "POST",
  priceUsdc: 0.001,
  description: "SHA-256 of input text.",
  async handle(body) {
    const text = String(body.text || "");
    return { sha256: createHash("sha256").update(text).digest("hex") };
  },
};
```

Within ~400 ms, the loader registers `/api/hash` and the new endpoint is live. `curl https://your-host/api/hash` now returns the standard x402 challenge.

## What the marketplace generates for free

- **402 challenge response** — Bazaar-shape `outputSchema.input` (compatible with [x402scan strict mode](https://www.x402scan.com)) with proper EIP-712 domain in `extra` (so buyer wallets sign correctly)
- **`/.well-known/x402.json`** — the canonical discovery manifest (x402 v1 spec)
- **`/.well-known/agent-card.json`** — EIP-8004-compatible agent card (for A2A / Google Agent-to-Agent discovery)
- **`/openapi.json`** — OpenAPI 3.0 spec generated from your plugin schemas
- **Content-negotiated root `/`** — JSON for agents (Accept: application/json), HTML landing for browsers
- **Settlement** — USDC `transferWithAuthorization` verification + on-chain broadcast via [viem](https://viem.sh/)

## What it does NOT do

- ❌ **No centralized registry** — the marketplace is a SHAPE, not a service. Any agent can be a registry.
- ❌ **No identity / reputation system** — out of scope. Use ENS, EIP-8004, optional reputation oracles.
- ❌ **No pricing dynamics** — fixed prices per call, capped at $1.00 USDC (fat-finger / compromise protection).
- ❌ **No KYC / compliance layer** — your service, your jurisdiction. Marketplace stays neutral.

## Spec deltas vs Coinbase's x402 v1

The x402 v1 spec under-specifies several fields that x402scan and other indexers actually require. See [SPEC.md](./SPEC.md) for the full delta. Key items the marketplace handles:

1. **`outputSchema.input` is Bazaar-shape, not JSON Schema** — `{ type: "http", method, bodyType, bodyFields }` with `{type, required, description}` field defs
2. **`extra.eip712` is required for buyer-wallet signing** — without it, EIP-3009 signatures fail
3. **Resource URL must be absolute** — `https://...` form, not relative path
4. **Price ceiling not in spec** — but enforced here at $1.00 USDC for safety

## Production reference

The marketplace runs in production at [api.autonomagic.org](https://api.autonomagic.org) — 22 paid endpoints, ~$0.0001 per-call gas on Base, registered on x402scan with full strict-mode conformance.

- Live manifest: https://api.autonomagic.org/.well-known/x402.json
- 90-second walkthrough: https://youtu.be/v8xL53fo8Q4
- DEV.to writeup: https://dev.to/autonomagic/how-i-built-an-ai-agent-that-ships-its-own-revenue-endpoints-as-code-59ci

## Contributing

PRs welcome. The current scope is intentionally narrow — see [CONTRIBUTING.md](./CONTRIBUTING.md) for what's in/out of scope and how the plugin contract evolves.

## Status

`v0.1` — production-extracted but API surface may evolve. Pin your version. We follow semver from `v1.0` onward.

## License

MIT — see [LICENSE](./LICENSE).
