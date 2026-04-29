"use strict";
/**
 * marketplace — assembles the plugin loader + manifest builders + 402 builder
 * into a single HTTP handler you can mount on an http.Server or Express app.
 *
 * NOTE: this v0.1 marketplace handler does NOT verify or settle EIP-3009
 * payments — that's the resource server's responsibility (or a separate
 * facilitator). The marketplace only generates the 402 challenge response,
 * dispatches paid handler calls when the X-Payment header is present, and
 * delegates payment verification to a `verifyPayment(payment, endpoint, ctx)`
 * callback you supply. This keeps the marketplace dependency-free (no viem,
 * no chain RPC) — pluggable for any settlement backend.
 *
 * For a working settlement reference, see Autonomagic's x402-server.js
 * (which uses viem on Base mainnet). That implementation is the model for
 * what verifyPayment should do; replicate or adapt as needed.
 */

const { buildPaymentRequired } = require("./402-builder.js");
const { buildManifest, buildAgentCard, buildOpenApi } = require("./manifest-builder.js");
const { createPluginLoader } = require("./plugin-loader.js");

/**
 * Create a marketplace HTTP handler.
 *
 * @param {object} opts
 * @param {string} opts.pluginsDir - Absolute path to plugin .js directory
 * @param {string} opts.payToAddress - Wallet address that receives USDC
 * @param {string} [opts.network="eip155:8453"] - "eip155:8453" or "eip155:84532"
 * @param {string} [opts.serviceName] - Shown in manifests + 402 metadata
 * @param {string} [opts.serviceDescription]
 * @param {string} [opts.iconUrl]
 * @param {(payment: object, endpoint: object, ctx: object) => Promise<{ok: boolean, fromAddress?: string, txHash?: string, amountUsdc?: number, error?: string}>} [opts.verifyPayment]
 *        Optional: pluggable payment verifier. If omitted, paid endpoints
 *        always return 402 (challenge mode only — useful for read-only
 *        manifest/discovery serving without settlement).
 * @param {(msg: string, ...args: any[]) => void} [opts.log]
 * @returns {object} - { handler: (req, res) => void, addPlugin, removePlugin, getEndpoints, stop }
 */
function createMarketplace(opts) {
  if (!opts || typeof opts !== "object") throw new Error("createMarketplace requires opts object");
  if (!opts.payToAddress) throw new Error("payToAddress is required");
  if (!opts.pluginsDir) throw new Error("pluginsDir is required");

  const network = opts.network || "eip155:8453";
  const log = typeof opts.log === "function" ? opts.log : () => {};

  const ctx = {
    network,
    payToAddress: opts.payToAddress,
    serviceName: opts.serviceName,
    serviceDescription: opts.serviceDescription,
    iconUrl: opts.iconUrl,
    avatarUrl: opts.avatarUrl,
    port: opts.port,
  };

  const loader = createPluginLoader({
    pluginsDir: opts.pluginsDir,
    log,
  });
  loader.start();

  function getEndpoints() { return loader.getEndpoints(); }

  // -------- Helpers --------
  function publicBaseUrl(req) {
    const proto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim()
      || (req.connection && req.connection.encrypted ? "https" : "http");
    const host = (req.headers["x-forwarded-host"] || req.headers["host"] || "localhost").toString().split(",")[0].trim();
    return `${proto}://${host}`;
  }

  function send(res, status, body, headers) {
    res.writeHead(status, Object.assign(
      { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      headers || {}
    ));
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      const MAX = 1_000_000; // 1 MB hard cap
      req.on("data", (c) => {
        total += c.length;
        if (total > MAX) {
          req.destroy();
          reject(new Error("body too large (>1MB)"));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); }
        catch (err) { reject(new Error("invalid JSON: " + err.message)); }
      });
      req.on("error", reject);
    });
  }

  function decodeBase64Json(s) {
    return JSON.parse(Buffer.from(String(s), "base64").toString("utf-8"));
  }

  function encodeBase64Json(obj) {
    return Buffer.from(JSON.stringify(obj), "utf-8").toString("base64");
  }

  function parseQuery(urlStr) {
    try {
      const u = new URL(urlStr, "http://placeholder");
      const out = {};
      for (const [k, v] of u.searchParams) out[k] = v;
      return out;
    } catch { return {}; }
  }

  // -------- Request handler --------
  async function handler(req, res) {
    try {
      const u = new URL(req.url, "http://placeholder");
      const pathname = u.pathname;
      const reqCtx = Object.assign({}, ctx, { publicBaseUrl: publicBaseUrl(req) });

      // CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Payment, Authorization",
          "Access-Control-Max-Age":       "600",
        });
        return res.end();
      }

      // Discovery: /.well-known/x402.json
      if (req.method === "GET" && pathname === "/.well-known/x402.json") {
        return send(res, 200, buildManifest(getEndpoints(), reqCtx));
      }
      // Discovery: /.well-known/agent-card.json
      if (req.method === "GET" && pathname === "/.well-known/agent-card.json") {
        return send(res, 200, buildAgentCard(getEndpoints(), reqCtx));
      }
      // Discovery: /openapi.json
      if (req.method === "GET" && pathname === "/openapi.json") {
        return send(res, 200, buildOpenApi(getEndpoints(), reqCtx));
      }

      // Health check
      if (req.method === "GET" && pathname === "/health") {
        return send(res, 200, { ok: true, ts: new Date().toISOString(), endpoints: getEndpoints().length });
      }

      // Root: brief JSON summary (HTML landing is the resource server's job)
      if (req.method === "GET" && (pathname === "/" || pathname === "")) {
        return send(res, 200, {
          service: ctx.serviceName,
          payToAddress: ctx.payToAddress,
          network: ctx.network,
          protocol: "x402",
          discovery: {
            x402:      "/.well-known/x402.json",
            agentCard: "/.well-known/agent-card.json",
            openapi:   "/openapi.json",
          },
          endpoints: getEndpoints().map((e) => ({
            path: e.path,
            method: e.method.toUpperCase(),
            priceUsdc: e.priceUsdc,
            description: e.description,
          })),
        });
      }

      // -------- Paid endpoint dispatch --------
      const endpoint = getEndpoints().find((e) =>
        e.path === pathname && e.method.toUpperCase() === req.method.toUpperCase()
      );
      if (!endpoint) {
        return send(res, 404, { error: "not found", path: pathname, method: req.method });
      }

      // 402 challenge if no payment
      const paymentHeader = req.headers["x-payment"] || req.headers["X-Payment"];
      if (!paymentHeader) {
        const pr = buildPaymentRequired(endpoint, reqCtx);
        return send(res, 402, pr, { "X-Payment-Required": encodeBase64Json(pr) });
      }

      // Verify payment via pluggable backend
      let settled;
      if (typeof opts.verifyPayment === "function") {
        try {
          const payment = decodeBase64Json(paymentHeader);
          const result = await opts.verifyPayment(payment, endpoint, reqCtx);
          if (!result || !result.ok) {
            return send(res, 402, { error: "payment verification failed", detail: (result && result.error) || "unknown" });
          }
          settled = result;
        } catch (err) {
          return send(res, 402, { error: "payment verification failed", detail: err.message });
        }
      } else {
        // No verifier configured — challenge-only mode
        return send(res, 402, { error: "payment verification not configured on this server" });
      }

      // Parse body or query
      let body = {};
      if (["GET", "DELETE", "HEAD"].includes(req.method.toUpperCase())) {
        body = parseQuery(req.url);
      } else {
        try { body = await readJsonBody(req); }
        catch (err) { return send(res, 400, { error: "bad request body", detail: err.message }); }
      }

      // Call handler
      const handlerCtx = {
        fromAddress: settled.fromAddress,
        txHash: settled.txHash,
        amountUsdc: settled.amountUsdc,
        headers: req.headers,
      };

      let result;
      try {
        result = await endpoint.handle(body, handlerCtx);
      } catch (err) {
        log(`plugin handler threw: ${endpoint.path} — ${err.message}`);
        return send(res, 500, { error: "handler threw", detail: err.message });
      }

      return send(res, 200, result, {
        "X-Payment-Verified": settled.txHash || "1",
      });
    } catch (err) {
      log(`marketplace handler unhandled error: ${err.message}`);
      return send(res, 500, { error: "internal error", detail: err.message });
    }
  }

  function stop() { loader.stop(); }

  return {
    handler,
    getEndpoints,
    stop,
  };
}

module.exports = { createMarketplace };
