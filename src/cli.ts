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
import { resolveOrGenerateWalletKey } from "./auth.js";
import { BalanceMonitor } from "./balance.js";
import { VERSION } from "./version.js";

function printHelp(): void {
  console.log(`
mnemospark v${VERSION} - Smart LLM Router

Usage:
  mnemospark [options]

Options:
  --version, -v     Show version number
  --help, -h        Show this help message
  --port <number>   Port to listen on (default: ${getProxyPort()})

Examples:
  # Start standalone proxy (survives gateway restarts)
  npx mnemospark

  # Start on custom port
  npx mnemospark --port 9000

  # Production deployment with PM2
  pm2 start "npx mnemospark" --name mnemospark

Environment Variables:
  BLOCKRUN_WALLET_KEY     Private key for x402 payments (auto-generated if not set)
  MNEMOSPARK_PROXY_PORT   Default proxy port (default: 7120)

For more info: https://github.com/pawlsclick/mnemospark
`);
}

function parseArgs(args: string[]): { version: boolean; help: boolean; port?: number } {
  const result = { version: false, help: false, port: undefined as number | undefined };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    }
  }

  return result;
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
    onRouted: (decision) => {
      const cost = decision.costEstimate.toFixed(4);
      const saved = (decision.savings * 100).toFixed(0);
      console.log(`[mnemospark] [${decision.tier}] ${decision.model} $${cost} (saved ${saved}%)`);
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
