"use strict";
/**
 * Standalone example: boot a marketplace server on :3402 with the example
 * plugins (hash, echo). No payment verification — runs in challenge-only mode
 * (every paid endpoint always returns 402).
 *
 * Usage:
 *   node examples/standalone-server.js
 *
 * Then:
 *   curl http://localhost:3402/.well-known/x402.json     # discovery manifest
 *   curl -X POST http://localhost:3402/api/hash \
 *     -H "Content-Type: application/json" \
 *     -d '{"text":"hello"}'                              # 402 challenge
 *
 * To exit: Ctrl+C
 */

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const { createMarketplace } = require("../src/index.js");

// Set up a temp pluginsDir + copy the example plugins into it
const pluginsDir = path.resolve(__dirname, "_plugins-tmp");
if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
for (const f of ["hash-endpoint.js", "echo-endpoint.js"]) {
  fs.copyFileSync(
    path.resolve(__dirname, f),
    path.resolve(pluginsDir, f)
  );
}

const marketplace = createMarketplace({
  pluginsDir,
  payToAddress: "0xDEADBEEF00000000000000000000000000000000",
  network: "eip155:8453",
  serviceName: "autonomagic-marketplace example",
  serviceDescription: "Local example server. Plugins are not really paid; this is challenge-only mode.",
  log: console.log,
});

const server = http.createServer(marketplace.handler);
const PORT = process.env.PORT || 3402;
server.listen(PORT, () => {
  console.log("");
  console.log(`autonomagic-marketplace example server listening on :${PORT}`);
  console.log("");
  console.log("Try:");
  console.log(`  curl http://localhost:${PORT}/.well-known/x402.json`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/hash -H "Content-Type: application/json" -d '{"text":"hello"}'`);
  console.log("");
  console.log(`Drop new .js plugins in ${pluginsDir} to see hot-reload (debounced 400ms)`);
  console.log("");
  console.log("Ctrl+C to exit.");
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  marketplace.stop();
  server.close(() => process.exit(0));
});
