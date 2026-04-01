#!/usr/bin/env node
/**
 * Sync openclaw.plugin.json "version" from package.json.
 * Run from repo root: node scripts/sync-plugin-version.js
 * Used in prepare script so version cannot drift.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pkgPath = join(root, "package.json");
const pluginPath = join(root, "openclaw.plugin.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));

// Keep plugin metadata in sync with package.json for version and description.
plugin.version = pkg.version;
plugin.description = pkg.description;

writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n", "utf8");
