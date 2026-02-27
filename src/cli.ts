#!/usr/bin/env node
/**
 * mnemospark CLI
 *
 * Standalone proxy for deployed setups where the proxy needs to survive gateway restarts.
 *
 * Usage:
 *   npx mnemospark              # Start standalone proxy
 *   npx mnemospark --version    # Show version
 *   npx mnemospark --port 7120  # Custom port
 *
 * For production deployments, use with PM2:
 *   pm2 start "npx mnemospark" --name mnemospark
 */

import { startProxy, getProxyPort } from "./proxy.js";
import { resolveOrGenerateWalletKey, LEGACY_WALLET_FILE, WALLET_FILE } from "./auth.js";
import { BalanceMonitor } from "./balance.js";
import { VERSION } from "./version.js";
import { dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
  command?: "install";
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

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
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

async function runInstall(mode: "default" | "standard"): Promise<void> {
  if (mode === "standard") {
    const legacyWallet = await readLegacyWalletIfPresent();
    if (legacyWallet) {
      const reuse = await promptReuseLegacyWallet();
      if (reuse) {
        await writeMnemosparkWallet(legacyWallet);
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
