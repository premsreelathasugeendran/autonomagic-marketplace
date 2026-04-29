# SPEC: x402 v1 + Bazaar-shape conformance

This document describes how `autonomagic-marketplace` interprets and extends the [Coinbase x402 v1 specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md), and the deltas that emerged from shipping a working reference and registering it on [x402scan](https://www.x402scan.com) in strict mode.

The intent: document the shape that **x402scan and other indexers actually require**, so the next builder doesn't spend 4 hours debugging "Missing input schema" errors before learning the spec's `outputSchema` field is under-specified.

---

## Plugin contract

The marketplace consumes plugins matching this contract:

```typescript
interface MarketplacePlugin {
  // Required — must match /^\/api\/[a-z0-9-_]+$/
  path: string;

  // Required — case-insensitive
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

  // Required — USDC price per call. MUST be in [0, 1.0]. Hard-capped to protect
  // against fat-finger or compromised plugin files; without this, a buggy plugin
  // could ship a $1,000,000 endpoint and strand authorizations.
  priceUsdc: number;

  // Required — short human-readable explanation. Shown in manifests + 402 responses.
  description: string;

  // OPTIONAL — JSON Schema for the request body. Marketplace auto-converts
  // to Bazaar `bodyFields` shape for x402scan strict-mode compatibility.
  inputSchema?: JSONSchema;

  // OPTIONAL — JSON Schema for the response. Currently informational only.
  outputSchema?: JSONSchema;

  // OPTIONAL — pre-built Bazaar-shape input. If provided, used as-is
  // (skips JSON Schema → Bazaar conversion).
  bazaarInput?: BazaarInput;

  // OPTIONAL — pre-built Bazaar-shape output. Same as above.
  bazaarOutput?: BazaarOutput;

  // OPTIONAL — categorization hint for marketplace UIs.
  // One of: "enrichment" | "fetch" | "utility" | "llm" | "api" (default).
  kind?: string;

  // Required — async handler. Receives parsed body (POST/PUT/PATCH) or
  // query params (GET/DELETE), and a context object.
  handle: (body: any, ctx: PluginContext) => Promise<any>;
}

interface PluginContext {
  // The buyer's wallet address (recovered from EIP-3009 signature)
  fromAddress: string;
  // The settled tx hash
  txHash: string;
  // The amount paid (USDC, with 6 decimals already applied)
  amountUsdc: number;
  // Original request headers
  headers: Record<string, string>;
}
```

---

## 402 response shape (the part Coinbase's spec under-specifies)

Coinbase's x402 v1 spec defines the top-level shape as:

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "...",
    "maxAmountRequired": "...",
    "asset": "0x...",
    "payTo": "0x...",
    "resource": "...",
    "description": "...",
    "mimeType": "application/json",
    "outputSchema": null,
    "maxTimeoutSeconds": 60,
    "extra": {}
  }]
}
```

But the spec leaves `outputSchema` typed as `object | null` with no shape requirement, and `extra` as a free-form object. **Indexers like x402scan reject `null`** and require specific fields in `extra`. Below is what actually works.

### `outputSchema` (Bazaar HTTPRequestStructure)

x402scan and other Bazaar-discovery extension consumers read `outputSchema.input` as the request shape and `outputSchema.output` as the response shape:

```typescript
interface BazaarOutputSchema {
  input: {
    type: "http";
    method: string;
    // Required for POST/PUT/PATCH; optional for GET/DELETE
    bodyType?: "json" | "form-data" | "text";
    bodyFields?: Record<string, FieldDef>;
    queryParams?: Record<string, FieldDef>;
    headerFields?: Record<string, FieldDef>;
  };
  output: Record<string, FieldDef>;
}

interface FieldDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  description?: string;
  enum?: string[];
  default?: any;
}
```

Note: this is **NOT JSON Schema** (no `properties`, no `required: []` array). Each field is a flat record with `{type, required, description, enum?, default?}`. JSON Schema's `properties` becomes top-level keys; `required: ["foo"]` becomes `{foo: {required: true}}`.

`autonomagic-marketplace` converts JSON Schema → Bazaar field-defs automatically (see `_jsonSchemaToFieldDefs` in `src/manifest-builder.js`).

### `extra` (required EIP-712 domain + service metadata)

The `extra` object is spec-blessed as "scheme-specific additional information." For `scheme: exact` on USDC, indexers + buyer wallets require:

```typescript
interface ExtraFields {
  // CRITICAL — without these, buyer wallets cannot compute the
  // transferWithAuthorization typed-data hash correctly. EIP-3009 signing fails.
  name: "USD Coin";
  version: "2";
  eip712: { name: "USD Coin"; version: "2" };
  chainId: number;       // 8453 for Base mainnet, 84532 for Base Sepolia
  decimals: 6;

  // OPTIONAL — service metadata for marketplace UIs (x402scan, etc.)
  serviceName?: string;
  serviceDescription?: string;
  serviceUrl?: string;
  iconUrl?: string;
  avatarUrl?: string;
  kind?: string;         // "enrichment" | "fetch" | "utility" | "llm" | "api"

  // OPTIONAL — pricing hints (separate from the `maxAmountRequired` field
  // above which is the actual atomic-units USDC price)
  pricing?: {
    amount: number;
    currency: "USDC";
    network: string;
    minAmount?: number;
    defaultAmount?: number;
  };
}
```

### `resource` field

Coinbase's spec example shows the `resource` as either a relative path or a full URL. Bazaar discovery requires **absolute URLs** (e.g. `https://api.autonomagic.org/api/dev-profile`), and x402scan rejects relative paths.

The marketplace builds the absolute URL from `req.headers["x-forwarded-host"]` (when behind Cloudflare / a tunnel) falling back to `req.headers["host"]`.

---

## Discovery surfaces

The marketplace exposes three discovery surfaces. All are free (no payment required) and content-negotiated where applicable.

### `/.well-known/x402.json` (canonical)

The x402 v1 spec format. Indexers use this to enumerate paid endpoints:

```json
{
  "x402Version": 1,
  "name": "Service name",
  "description": "...",
  "payTo": "0x...",
  "network": "eip155:8453",
  "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "endpoints": [
    {
      "path": "/api/hash",
      "method": "POST",
      "price": "1000",
      "priceUsdc": 0.001,
      "description": "SHA-256 of input text.",
      "inputSchema": {/* JSON Schema or Bazaar */},
      "outputSchema": {/* Bazaar shape with input + output */}
    }
  ]
}
```

### `/.well-known/agent-card.json` (EIP-8004 / A2A)

Google Agent-to-Agent (A2A) discovery + EIP-8004 compatibility:

```json
{
  "name": "Service name",
  "description": "...",
  "url": "https://api.autonomagic.org",
  "version": "1.0.0",
  "capabilities": { "streaming": false, "pushNotifications": false },
  "x402Support": true,
  "payTo": "0x...",
  "network": "eip155:8453",
  "skills": [
    {
      "id": "hash",
      "name": "SHA-256 of input text.",
      "description": "POST /api/hash — $0.001 USDC per call",
      "inputModes": ["application/json"],
      "outputModes": ["application/json"]
    }
  ]
}
```

### `/openapi.json` (OpenAPI 3.0)

Standard OpenAPI spec auto-generated from plugin schemas. Useful for programmatic introspection by AI agents using OpenAPI SDKs.

---

## Hot-reload semantics

- Plugin loader watches `pluginsDir` via `fs.watch`
- Debounced at **400ms** — long enough to skip atomic-rename storms (editors / file-syncs that write a temp file then rename), short enough to feel instant
- Each load: `require()` the file, validate against the contract, register in route table
- Validation failures: log error, plugin NOT registered, server stays alive
- Module cache cleared on each reload — same path can be edited and re-loaded freely

---

## Price ceiling rationale

The marketplace caps `priceUsdc` at `1.0` USDC. This is **not in the x402 spec** but is enforced here for safety:

- Without a cap, a typo (`0.05` → `5`) ships a 100x-priced endpoint
- A compromised plugin file could attempt to charge $1,000,000 per call
- Buyer authorizations could be stranded with bad pricing

If you legitimately need higher prices, fork the loader and adjust the cap. But for a marketplace with composable agents calling each other, sub-dollar prices are the norm.

---

## What the spec doesn't define (and we don't either)

These are intentionally out of scope for the marketplace:

- **Identity** — use ENS, EIP-8004, your own scheme
- **Reputation** — out of scope; use community oracles
- **Refunds** — atomic per call; if the handler fails after settlement, that's your problem
- **Idempotency** — x402's `nonce` field handles replay protection; not exposed at plugin level
- **Rate limiting** — implement at your reverse proxy / cloudflared layer
- **Auth beyond payment** — there isn't any. x402 == auth.

---

## Open questions for the next spec iteration

1. **Per-publisher price caps** — replacing the global $1.00 ceiling with reputation-weighted publisher caps. Requires identity layer.
2. **Multi-asset support** — `accepts` is an array, but only USDC-on-Base is wired. ETH/EURC would need new EIP-712 domains + separate verification paths.
3. **Streaming responses** — current contract is `(body, ctx) => Promise<any>`. Generator/stream support would unblock LLM-style endpoints.
4. **Plugin signing** — content-addressed plugins via hash, with optional signed attestations from the publisher's wallet.

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).
