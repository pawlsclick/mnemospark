/**
 * Install/load check: after build, (1) assert the plugin entry point loads and
 * exports expected symbols; (2) assert `mnemospark install` does NOT create
 * ~/.openclaw/extensions/mnemospark (plugin registration is only via openclaw plugins install).
 *
 * Usage: npm run test:install-check (from repo root)
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const distPath = join(repoRoot, "dist", "index.js");
const distUrl = pathToFileURL(distPath).href;

const mod = await import(distUrl);

const required = [
  ["default", "plugin"],
  ["startProxy", "proxy"],
];

for (const [key, label] of required) {
  if (mod[key] === undefined) {
    console.error(`Install check failed: missing export "${key}" (${label})`);
    process.exit(1);
  }
}

console.log("Install check: plugin entry point loads with required exports.");

// Assert install does not create ~/.openclaw/extensions/mnemospark
const tmpHome = mkdtempSync(join(tmpdir(), "mnemospark-install-check-"));
const extensionsMnemospark = join(tmpHome, ".openclaw", "extensions", "mnemospark");
try {
  const cliPath = join(repoRoot, "dist", "cli.js");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "install", "--default"], {
      cwd: repoRoot,
      env: { ...process.env, HOME: tmpHome },
      stdio: "pipe",
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr}`)),
    );
  });
  if (existsSync(extensionsMnemospark)) {
    console.error(
      "Install check failed: install created ~/.openclaw/extensions/mnemospark (must not exist)",
    );
    process.exit(1);
  }
  console.log("Install check: install does not create extensions/mnemospark.");
} finally {
  rmSync(tmpHome, { recursive: true, force: true });
}

console.log("Install check passed.");
