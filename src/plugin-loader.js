"use strict";
/**
 * plugin-loader — fs.watch-based hot reload for plugin files.
 *
 * Watches a directory; when files are added/changed/deleted, re-loads them
 * (clearing Node's module cache) and validates against the plugin contract.
 * Debounced at 400ms to skip atomic-rename storms (editor / file-sync writes).
 *
 * Public API:
 *   const loader = createPluginLoader({ pluginsDir, onChange });
 *   loader.start();
 *   loader.stop();
 *   loader.getEndpoints();  // -> Plugin[]
 *   loader.addPluginFromFile(absPath);  // manual reload
 */

const fs = require("node:fs");
const path = require("node:path");
const { validatePlugin } = require("./schema.js");

const DEFAULT_DEBOUNCE_MS = 400;
const PLUGIN_EXT = ".js";

/**
 * Create a plugin loader bound to a directory.
 *
 * @param {object} opts
 * @param {string} opts.pluginsDir - Absolute path to the directory containing plugin .js files
 * @param {number} [opts.debounceMs=400] - Debounce window for fs.watch events
 * @param {(change: { type: string, path: string, plugin?: object, errors?: string[] }) => void} [opts.onChange]
 *        Called on every load/unload event. `type` is one of "loaded", "removed", "error", "rejected".
 * @param {(msg: string, ...args: any[]) => void} [opts.log] - Logger (defaults to no-op)
 * @returns {object} loader
 */
function createPluginLoader(opts) {
  const pluginsDir = opts.pluginsDir;
  if (!pluginsDir || typeof pluginsDir !== "string") {
    throw new Error("pluginsDir must be an absolute path string");
  }
  const debounceMs = typeof opts.debounceMs === "number" ? opts.debounceMs : DEFAULT_DEBOUNCE_MS;
  const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};
  const log = typeof opts.log === "function" ? opts.log : () => {};

  // path -> plugin object (validated)
  const endpoints = new Map();
  // path -> file's mtime as string, used for change detection
  const mtimes = new Map();
  // pending debounce timer per file
  const pendingTimers = new Map();
  let watcher = null;
  let started = false;

  function getEndpoints() {
    return Array.from(endpoints.values());
  }

  /**
   * Load (or re-load) a single plugin file.
   * Returns { ok: boolean, plugin?, errors? }
   */
  function loadPlugin(absPath) {
    if (!absPath.endsWith(PLUGIN_EXT)) {
      return { ok: false, errors: [`not a .js file: ${absPath}`] };
    }
    if (!fs.existsSync(absPath)) {
      return { ok: false, errors: [`file does not exist: ${absPath}`] };
    }
    // Clear require cache so re-edits are picked up
    delete require.cache[require.resolve(absPath)];

    let mod;
    try {
      mod = require(absPath);
    } catch (err) {
      return { ok: false, errors: [`require failed: ${err.message}`] };
    }

    const plugin = mod && mod.default ? mod.default : mod;
    const validation = validatePlugin(plugin);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }

    return { ok: true, plugin };
  }

  /**
   * Reload a file: validate + register or reject.
   */
  function reloadFile(absPath) {
    const result = loadPlugin(absPath);

    if (!result.ok) {
      // Failed to load — drop any prior registration for this file.
      const existing = findEndpointByFile(absPath);
      if (existing) {
        endpoints.delete(existing.path);
        onChange({ type: "removed", path: existing.path, file: absPath });
      }
      log(`plugin REJECTED: ${absPath} — ${result.errors.join("; ")}`);
      onChange({ type: "rejected", path: absPath, errors: result.errors });
      return;
    }

    const plugin = result.plugin;
    // Tag the plugin with its source file so we can re-find it on delete
    plugin.__file = absPath;

    // If the plugin path changed (file edited to register a different /api path),
    // remove the old registration.
    const existing = findEndpointByFile(absPath);
    if (existing && existing.path !== plugin.path) {
      endpoints.delete(existing.path);
    }

    endpoints.set(plugin.path, plugin);
    log(`plugin LOADED: ${plugin.method.toUpperCase()} ${plugin.path} ($${plugin.priceUsdc}) <- ${path.basename(absPath)}`);
    onChange({ type: "loaded", path: plugin.path, plugin });
  }

  function findEndpointByFile(absPath) {
    for (const ep of endpoints.values()) {
      if (ep.__file === absPath) return ep;
    }
    return null;
  }

  /**
   * Initial load — scan the directory once, register everything that validates.
   */
  function initialLoad() {
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      log(`created pluginsDir: ${pluginsDir}`);
    }
    const files = fs.readdirSync(pluginsDir).filter((f) => f.endsWith(PLUGIN_EXT));
    for (const f of files) {
      const abs = path.resolve(pluginsDir, f);
      reloadFile(abs);
      try {
        mtimes.set(abs, fs.statSync(abs).mtimeMs);
      } catch (_) { /* ignore */ }
    }
    log(`initial load complete: ${endpoints.size} plugin(s) registered from ${pluginsDir}`);
  }

  /**
   * Handle a fs.watch event. Debounces per-file.
   */
  function handleWatchEvent(eventType, filename) {
    if (!filename || !filename.endsWith(PLUGIN_EXT)) return;
    const abs = path.resolve(pluginsDir, filename);

    // Debounce: clear any pending timer for this file, set new one.
    if (pendingTimers.has(abs)) clearTimeout(pendingTimers.get(abs));
    const t = setTimeout(() => {
      pendingTimers.delete(abs);
      if (!fs.existsSync(abs)) {
        // File deleted
        const existing = findEndpointByFile(abs);
        if (existing) {
          endpoints.delete(existing.path);
          mtimes.delete(abs);
          log(`plugin REMOVED: ${existing.path} (file deleted)`);
          onChange({ type: "removed", path: existing.path, file: abs });
        }
        return;
      }
      // mtime check — skip duplicate "change" events for unchanged files
      let mtime;
      try { mtime = fs.statSync(abs).mtimeMs; } catch (_) { return; }
      if (mtimes.get(abs) === mtime) return;
      mtimes.set(abs, mtime);
      reloadFile(abs);
    }, debounceMs);
    pendingTimers.set(abs, t);
  }

  function start() {
    if (started) return;
    started = true;
    initialLoad();
    watcher = fs.watch(pluginsDir, { persistent: false }, handleWatchEvent);
    watcher.on("error", (err) => {
      log(`pluginsDir watch error: ${err.message}`);
      onChange({ type: "error", path: pluginsDir, errors: [err.message] });
    });
    log(`watching pluginsDir for hot-reload: ${pluginsDir} (debounce ${debounceMs}ms)`);
  }

  function stop() {
    if (!started) return;
    started = false;
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    for (const t of pendingTimers.values()) clearTimeout(t);
    pendingTimers.clear();
  }

  return {
    start,
    stop,
    getEndpoints,
    addPluginFromFile: reloadFile, // manual reload (e.g. for tests)
    findEndpointByFile,
  };
}

module.exports = { createPluginLoader };
