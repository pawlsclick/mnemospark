/**
 * Minimal install/load check: after build, assert the plugin entry point loads
 * and exports expected symbols. Run in CI after `npm run build`.
 *
 * Usage: npm run test:install-check (from repo root)
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "..", "dist", "index.js");
const distUrl = pathToFileURL(distPath).href;

const mod = await import(distUrl);

const required = [
  ["default", "plugin"],
  ["blockrunProvider", "provider"],
  ["startProxy", "proxy"],
];

for (const [key, label] of required) {
  if (mod[key] === undefined) {
    console.error(`Install check failed: missing export "${key}" (${label})`);
    process.exit(1);
  }
}

console.log("Install check passed: plugin entry point loads with required exports.");
