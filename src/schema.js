"use strict";
/**
 * Plugin contract schema + validation.
 *
 * A valid plugin exports a single object matching:
 *   {
 *     path: string,                  // /^\/api\/[a-z0-9-_]+$/
 *     method: "GET" | "POST" | ...,
 *     priceUsdc: number,             // [0, 1.0]
 *     description: string,           // non-empty
 *     inputSchema?: object,          // JSON Schema or Bazaar-shape
 *     outputSchema?: object,
 *     bazaarInput?: object,          // overrides inputSchema if present
 *     bazaarOutput?: object,
 *     kind?: string,
 *     handle: async (body, ctx) => any,
 *   }
 */

const ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const PATH_REGEX = /^\/api\/[a-z0-9_-]+$/;
const MAX_PRICE_USDC = 1.0;
const MIN_PRICE_USDC = 0.0;

/**
 * Validate a plugin object. Returns { ok: boolean, errors: string[] }.
 * Pure function — no side effects, no logging.
 */
function validatePlugin(plugin) {
  const errors = [];

  if (!plugin || typeof plugin !== "object") {
    return { ok: false, errors: ["plugin must be a non-null object"] };
  }

  // path
  if (typeof plugin.path !== "string") {
    errors.push("path must be a string");
  } else if (!PATH_REGEX.test(plugin.path)) {
    errors.push(`path must match ${PATH_REGEX} (got: ${JSON.stringify(plugin.path)})`);
  }

  // method
  if (typeof plugin.method !== "string") {
    errors.push("method must be a string");
  } else if (!ALLOWED_METHODS.includes(plugin.method.toUpperCase())) {
    errors.push(`method must be one of ${ALLOWED_METHODS.join(", ")} (got: ${plugin.method})`);
  }

  // priceUsdc
  if (typeof plugin.priceUsdc !== "number" || !Number.isFinite(plugin.priceUsdc)) {
    errors.push("priceUsdc must be a finite number");
  } else if (plugin.priceUsdc < MIN_PRICE_USDC || plugin.priceUsdc > MAX_PRICE_USDC) {
    errors.push(`priceUsdc must be in [${MIN_PRICE_USDC}, ${MAX_PRICE_USDC}] USDC (got: ${plugin.priceUsdc})`);
  }

  // description
  if (typeof plugin.description !== "string" || plugin.description.trim().length === 0) {
    errors.push("description must be a non-empty string");
  }

  // handle
  if (typeof plugin.handle !== "function") {
    errors.push("handle must be a function");
  }

  // Optional fields — type-check if present
  if (plugin.inputSchema !== undefined && (typeof plugin.inputSchema !== "object" || plugin.inputSchema === null)) {
    errors.push("inputSchema, if present, must be an object");
  }
  if (plugin.outputSchema !== undefined && (typeof plugin.outputSchema !== "object" || plugin.outputSchema === null)) {
    errors.push("outputSchema, if present, must be an object");
  }
  if (plugin.bazaarInput !== undefined && (typeof plugin.bazaarInput !== "object" || plugin.bazaarInput === null)) {
    errors.push("bazaarInput, if present, must be an object");
  }
  if (plugin.bazaarOutput !== undefined && (typeof plugin.bazaarOutput !== "object" || plugin.bazaarOutput === null)) {
    errors.push("bazaarOutput, if present, must be an object");
  }
  if (plugin.kind !== undefined && typeof plugin.kind !== "string") {
    errors.push("kind, if present, must be a string");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Convert JSON Schema { properties, required } to Bazaar field-defs.
 * Used when a plugin provides JSON Schema instead of pre-built Bazaar shape.
 */
function jsonSchemaToFieldDefs(schema) {
  if (!schema || typeof schema !== "object") return {};
  const props = schema.properties || {};
  const requiredList = Array.isArray(schema.required) ? schema.required : [];
  const out = {};
  for (const [key, prop] of Object.entries(props)) {
    if (typeof prop !== "object" || prop === null) continue;
    const def = {
      type: prop.type || "string",
      required: requiredList.includes(key),
    };
    if (prop.description) def.description = String(prop.description);
    if (Array.isArray(prop.enum)) def.enum = prop.enum;
    if (prop.default !== undefined) def.default = prop.default;
    out[key] = def;
  }
  return out;
}

/**
 * Infer the `kind` (categorization hint) from path keywords if not explicitly set.
 */
function inferKind(plugin) {
  if (plugin.kind) return plugin.kind;
  const p = (plugin.path || "").toLowerCase();
  if (p.includes("profile") || p.includes("enrich")) return "enrichment";
  if (p.includes("scrape") || p.includes("fetch") || p.includes("dns")) return "fetch";
  if (p.includes("hash") || p.includes("uuid") || p.includes("encode") || p.includes("validate") || p.includes("slugify")) return "utility";
  if (p.includes("summarize") || p.includes("generate") || p.includes("llm") || p.includes("gpt")) return "llm";
  return "api";
}

module.exports = {
  validatePlugin,
  jsonSchemaToFieldDefs,
  inferKind,
  ALLOWED_METHODS,
  PATH_REGEX,
  MAX_PRICE_USDC,
};
