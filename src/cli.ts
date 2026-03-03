#!/usr/bin/env node
/**
 * mnemospark CLI
 *
 * Standalone proxy for deployed setups where the proxy needs to survive gateway restarts.
 *
 * Usage:
 *   npx mnemospark              # Start standalone proxy
 *   npx mnemospark --version    # Show version
 *   npx mnemospark check-update # Check if a new version is available
 *   npx mnemospark update       # Update to latest version
 *   npx mnemospark --port 7120  # Custom port
 *
 * For production deployments, use with PM2:
 *   pm2 start "npx mnemospark" --name mnemospark
 */

import { startProxy, getProxyPort } from "./proxy.js";
import { resolveOrGenerateWalletKey, LEGACY_WALLET_FILE, WALLET_FILE } from "./auth.js";
import { BalanceMonitor } from "./balance.js";
import { VERSION } from "./version.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

function isHexPrivateKey(value: string | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function printHelp(): void {
  console.log(`
mnemospark v${VERSION} - Storage proxy and wallet tools

Usage:
  mnemospark [options]
  mnemospark install --default
  mnemospark install --standard
  mnemospark check-update       Check if a new version is available
  mnemospark update             Update to latest version

Options:
  --version, -v     Show version number
  --help, -h        Show this help message
  --port <number>   Port to listen on (default: ${getProxyPort()})

Examples:
  # Start standalone proxy (survives gateway restarts)
  npx mnemospark

  # Start on custom port
  npx mnemospark --port 9000

  # Install mnemospark wallet with default behavior (create new wallet)
  npx mnemospark install --default

  # Install mnemospark wallet with standard behavior (reuse Blockrun wallet if present)
  npx mnemospark install --standard

  # Production deployment with PM2
  pm2 start "npx mnemospark" --name mnemospark

Environment Variables:
  BLOCKRUN_WALLET_KEY     Private key for x402 storage payments (auto-generated if not set)
  MNEMOSPARK_PROXY_PORT   Default proxy port (default: 7120)

For more info: https://github.com/pawlsclick/mnemospark
`);
}

type ParsedArgs = {
  version: boolean;
  help: boolean;
  port?: number;
  command?: "install" | "update" | "check-update";
  installMode?: "default" | "standard";
};

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    version: false,
    help: false,
    port: undefined,
    command: undefined,
    installMode: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!result.command && !arg.startsWith("-")) {
      if (arg === "install") {
        result.command = "install";
      } else if (arg === "update") {
        result.command = "update";
      } else if (arg === "check-update") {
        result.command = "check-update";
      }
      // Treat first non-flag token as command and continue parsing remaining flags.
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (result.command === "install" && arg === "--default") {
      result.installMode = "default";
    } else if (result.command === "install" && arg === "--standard") {
      result.installMode = "standard";
    } else if (arg === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    }
  }

  return result;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = dirname(__dirname);
const EXTENSIONS_DIR = join(homedir(), ".openclaw", "extensions", "mnemospark");

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function deployExtensionFiles(): Promise<void> {
  await ensureDir(EXTENSIONS_DIR);

  const scriptsSource = join(PACKAGE_ROOT, "scripts");
  if (existsSync(scriptsSource)) {
    await cp(scriptsSource, join(EXTENSIONS_DIR, "scripts"), { recursive: true });
  }

  const pluginJson = join(PACKAGE_ROOT, "openclaw.plugin.json");
  if (existsSync(pluginJson)) {
    const content = await readFile(pluginJson);
    await writeFile(join(EXTENSIONS_DIR, "openclaw.plugin.json"), content);
  }
}

async function readLegacyWalletIfPresent(): Promise<`0x${string}` | null> {
  try {
    const key = (await readFile(LEGACY_WALLET_FILE, "utf-8")).trim();
    return isHexPrivateKey(key) ? (key as `0x${string}`) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeMnemosparkWallet(key: `0x${string}`): Promise<void> {
  const dir = dirname(WALLET_FILE);
  await ensureDir(dir);
  await writeFile(WALLET_FILE, `${key}\n`, { mode: 0o600 });
}

async function promptReuseLegacyWallet(): Promise<boolean> {
  process.stdout.write(
    `Found existing Blockrun wallet at ${LEGACY_WALLET_FILE}.\nReuse this wallet for mnemospark? [Y/n]: `,
  );

  return new Promise<boolean>((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data) => {
      const input = typeof data === "string" ? data : data.toString("utf-8");
      const answer = input.trim().toLowerCase();
      if (!answer || answer === "y" || answer === "yes") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

const NPM_REGISTRY_URL = "https://registry.npmjs.org/mnemospark/latest";

interface NpmLatestResponse {
  version?: string;
}

/**
 * Compare two semver strings (e.g. "1.2.3"). Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Only compares major.minor.patch; ignores prerelease suffixes.
 */
function compareVersion(a: string, b: string): number {
  const partsA = a.split("-")[0].split(".").map(Number);
  const partsB = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const na = partsA[i] ?? 0;
    const nb = partsB[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NpmLatestResponse;
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function runCheckUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (!latest) {
    console.log("[mnemospark] Could not fetch latest version from registry.");
    process.exit(1);
  }
  const cmp = compareVersion(VERSION, latest);
  if (cmp < 0) {
    console.log(`[mnemospark] A new version is available: ${latest} (current: ${VERSION})`);
    console.log("Run: npx mnemospark update");
  } else if (cmp === 0) {
    console.log("You are on the latest version.");
  } else {
    console.log(`You are on the latest version. (current: ${VERSION}, registry: ${latest})`);
  }
}

async function runUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (!latest) {
    console.log("[mnemospark] Could not fetch latest version from registry.");
    process.exit(1);
  }
  const cmp = compareVersion(VERSION, latest);
  if (cmp < 0) {
    console.log(`[mnemospark] Updating from ${VERSION} to ${latest}...`);
    const { execSync } = await import("node:child_process");
    try {
      execSync(`npm install mnemospark@${latest}`, { stdio: "inherit" });
      console.log(`[mnemospark] Updated to ${latest}.`);
    } catch {
      console.log(
        "[mnemospark] npm install failed. You can update manually: npm install mnemospark@latest",
      );
      process.exit(1);
    }
  } else {
    console.log("You are on the latest version.");
  }
}

async function runInstall(mode: "default" | "standard"): Promise<void> {
  if (mode === "standard") {
    const legacyWallet = await readLegacyWalletIfPresent();
    if (legacyWallet) {
      const reuse = await promptReuseLegacyWallet();
      if (reuse) {
        await writeMnemosparkWallet(legacyWallet);
        await deployExtensionFiles();
        console.log("\n[mnemospark] Reused existing Blockrun wallet for mnemospark.");
        console.log(
          "[mnemospark] Wallet file: ~/.openclaw/mnemospark/wallet/wallet.key (chmod 600 expected).",
        );
        console.log(
          "[mnemospark] Your wallet will be used for mnemospark storage payments on Base.",
        );
        return;
      }
    }
  }

  const { address, source } = await resolveOrGenerateWalletKey();

  await deployExtensionFiles();

  console.log("[mnemospark] Install complete.");
  console.log(`Your new Base blockchain wallet is: ${address}`);
  if (source === "env") {
    console.log(
      "Wallet is sourced from BLOCKRUN_WALLET_KEY. To persist it, save it under ~/.openclaw/mnemospark/wallet/wallet.key with chmod 600.",
    );
  } else {
    console.log(
      "Wallet key stored under ~/.openclaw/mnemospark/wallet/wallet.key (permissions should be chmod 600).",
    );
  }
  console.log("Add USDC on the Base network to start using mnemospark today.");
  console.log(
    "You can acquire USDC on Base from providers like Coinbase and Moonpay. Fund the wallet before running mnemospark.",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.command === "install") {
    const mode = args.installMode ?? "standard";
    await runInstall(mode);
    return;
  }

  if (args.command === "check-update") {
    await runCheckUpdate();
    return;
  }

  if (args.command === "update") {
    await runUpdate();
    return;
  }

  // Resolve wallet key
  const { key: walletKey, address, source } = await resolveOrGenerateWalletKey();

  if (source === "generated") {
    console.log(`[mnemospark] Generated new wallet: ${address}`);
  } else if (source === "saved") {
    console.log(`[mnemospark] Using saved wallet: ${address}`);
  } else {
    console.log(`[mnemospark] Using wallet from BLOCKRUN_WALLET_KEY: ${address}`);
  }

  // Start the proxy
  const proxy = await startProxy({
    walletKey,
    port: args.port,
    onReady: (port) => {
      console.log(`[mnemospark] Proxy listening on http://127.0.0.1:${port}`);
      console.log(`[mnemospark] Health check: http://127.0.0.1:${port}/health`);
    },
    onError: (error) => {
      console.error(`[mnemospark] Error: ${error.message}`);
    },
    onLowBalance: (info) => {
      console.warn(`[mnemospark] Low balance: ${info.balanceUSD}. Fund: ${info.walletAddress}`);
    },
    onInsufficientFunds: (info) => {
      console.error(
        `[mnemospark] Insufficient funds. Balance: ${info.balanceUSD}, Need: ${info.requiredUSD}`,
      );
    },
  });

  // Check balance
  const monitor = new BalanceMonitor(address);
  try {
    const balance = await monitor.checkBalance();
    if (balance.isEmpty) {
      console.log(`[mnemospark] Wallet balance: $0.00 (using FREE model)`);
      console.log(`[mnemospark] Fund wallet for premium models: ${address}`);
    } else if (balance.isLow) {
      console.log(`[mnemospark] Wallet balance: ${balance.balanceUSD} (low)`);
    } else {
      console.log(`[mnemospark] Wallet balance: ${balance.balanceUSD}`);
    }
  } catch {
    console.log(`[mnemospark] Wallet: ${address} (balance check pending)`);
  }

  console.log(`[mnemospark] Ready - Ctrl+C to stop`);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[mnemospark] Received ${signal}, shutting down...`);
    try {
      await proxy.close();
      console.log(`[mnemospark] Proxy closed`);
      process.exit(0);
    } catch (err) {
      console.error(`[mnemospark] Error during shutdown: ${err}`);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(`[mnemospark] Fatal error: ${err.message}`);
  process.exit(1);
});
