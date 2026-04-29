"use strict";
/**
 * Example plugin: SHA-256 hash of input text.
 *
 * Drop this file in your `pluginsDir` (e.g. ./endpoints/) — the loader
 * registers it as POST /api/hash within ~400ms. No restart.
 */

const { createHash } = require("node:crypto");

module.exports = {
  path: "/api/hash",
  method: "POST",
  priceUsdc: 0.001,
  description: "SHA-256 hash of input text. Cheap utility endpoint.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to hash (any length).",
      },
      algorithm: {
        type: "string",
        description: "Hash algorithm. Default: sha256.",
        enum: ["sha256", "sha512", "sha1", "md5"],
        default: "sha256",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      algorithm: { type: "string" },
      digest:    { type: "string", description: "Hex-encoded hash digest." },
      length:    { type: "number", description: "Length of the input text in bytes." },
    },
  },
  async handle(body, _ctx) {
    const text = String(body.text || "");
    const algorithm = String(body.algorithm || "sha256").toLowerCase();
    if (!["sha256", "sha512", "sha1", "md5"].includes(algorithm)) {
      throw new Error("unsupported algorithm: " + algorithm);
    }
    const digest = createHash(algorithm).update(text).digest("hex");
    return { algorithm, digest, length: Buffer.byteLength(text, "utf-8") };
  },
};
