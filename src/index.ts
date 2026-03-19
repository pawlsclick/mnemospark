/**
 * mnemospark plugin entrypoint.
 *
 * This plugin provides wallet and cloud storage commands and starts a local
 * proxy that forwards mnemospark backend storage endpoints.
 */

import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  PluginCommandContext,
  OpenClawPluginCommandDefinition,
} from "./types.js";
import { startProxy } from "./proxy.js";
import { resolveOrGenerateWalletKey, WALLET_FILE } from "./auth.js";
import { BalanceMonitor } from "./balance.js";
import { existsSync, readFileSync } from "node:fs";
import { VERSION } from "./version.js";
import { privateKeyToAccount } from "viem/accounts";
import { createCloudCommand } from "./cloud-command.js";

/**
 * Detect if we're running in shell completion mode.
 * In completion mode, avoid side effects and logging.
 */
function isCompletionMode(): boolean {
  const args = process.argv;
  return args.some((arg, i) => arg === "completion" && i >= 1 && i <= 3);
}

/**
 * Detect if we're running in gateway mode.
 * The proxy should only start when the gateway is running.
 */
function isGatewayMode(): boolean {
  const args = process.argv;
  return args.includes("gateway");
}

// Store active proxy handle for cleanup on gateway_stop
let activeProxyHandle: Awaited<ReturnType<typeof startProxy>> | null = null;

/**
 * Start the proxy in the background.
 * Called from register() in gateway mode.
 */
async function startProxyInBackground(api: OpenClawPluginApi): Promise<void> {
  const { key: walletKey, address, source } = await resolveOrGenerateWalletKey();

  if (source === "generated") {
    api.logger.info(`Generated new wallet: ${address}`);
  } else if (source === "saved") {
    api.logger.info(`Using saved wallet: ${address}`);
  } else {
    api.logger.info(`Using wallet from MNEMOSPARK_WALLET_KEY: ${address}`);
  }

  const proxy = await startProxy({
    walletKey,
    onReady: (port) => {
      api.logger.info(`mnemospark proxy listening on port ${port}`);
    },
    onError: (error) => {
      api.logger.error(`mnemospark proxy error: ${error.message}`);
    },
    onLowBalance: (info) => {
      api.logger.warn(`[!] Low balance: ${info.balanceUSD}. Fund wallet: ${info.walletAddress}`);
    },
    onInsufficientFunds: (info) => {
      api.logger.error(
        `[!] Insufficient funds. Balance: ${info.balanceUSD}, Needed: ${info.requiredUSD}. Fund wallet: ${info.walletAddress}`,
      );
    },
  });

  activeProxyHandle = proxy;
  api.logger.info("mnemospark ready");

  // Non-blocking startup balance check
  const startupMonitor = new BalanceMonitor(address);
  startupMonitor
    .checkBalance()
    .then((balance) => {
      if (balance.isEmpty) {
        api.logger.info(`Wallet: ${address} | Balance: $0.00`);
      } else if (balance.isLow) {
        api.logger.info(`Wallet: ${address} | Balance: ${balance.balanceUSD} (low)`);
      } else {
        api.logger.info(`Wallet: ${address} | Balance: ${balance.balanceUSD}`);
      }
    })
    .catch(() => {
      api.logger.info(`Wallet: ${address} | Balance: (checking...)`);
    });
}

/**
 * /mnemospark-wallet command handler.
 * - /mnemospark-wallet or /mnemospark-wallet status: Show wallet address, balance, and key file location
 * - /mnemospark-wallet export: Show private key for backup
 */
async function createWalletCommand(): Promise<OpenClawPluginCommandDefinition> {
  return {
    name: "mnemospark-wallet",
    nativeNames: {
      default: "mnemospark_wallet",
    },
    description: "Show mnemospark wallet info or export private key for backup",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: PluginCommandContext) => {
      const subcommand = ctx.args?.trim().toLowerCase() || "status";

      // Read wallet key if it exists
      let walletKey: string | undefined;
      let address: string | undefined;
      try {
        if (existsSync(WALLET_FILE)) {
          walletKey = readFileSync(WALLET_FILE, "utf-8").trim();
          if (walletKey.startsWith("0x") && walletKey.length === 66) {
            const account = privateKeyToAccount(walletKey as `0x${string}`);
            address = account.address.replace(/\s/g, "");
          }
        }
      } catch {
        // Wallet file doesn't exist or is invalid
      }

      if (!walletKey || !address) {
        return {
          text: "No mnemospark wallet found. Run `openclaw plugins install mnemospark`.",
          isError: true,
        };
      }

      if (subcommand === "export") {
        const addressDisplay = address.replace(/\s/g, "");
        const keyDisplay = walletKey.replace(/\s/g, "");
        return {
          text: [
            "☁️ **mnemospark Wallet Export**",
            "",
            "⚠️ **SECURITY WARNING**: Your private key controls your wallet funds.",
            "Never share this key. Anyone with this key can spend your USDC.",
            "",
            `**Address:** \`${addressDisplay}\``,
            "",
            "**Private Key:**",
            `\`${keyDisplay}\``,
            "",
            "**To restore on a new machine:**",
            "1. Set the environment variable before running OpenClaw:",
            `   \`export MNEMOSPARK_WALLET_KEY=${keyDisplay}\``,
            "2. Or save to file:",
            `   \`mkdir -p ~/.openclaw/mnemospark/wallet && echo "${keyDisplay}" > ~/.openclaw/mnemospark/wallet/wallet.key && chmod 600 ~/.openclaw/mnemospark/wallet/wallet.key\``,
          ].join("\n"),
        };
      }

      let balanceText = "Balance: (checking...)";
      try {
        const monitor = new BalanceMonitor(address);
        const balance = await monitor.checkBalance();
        balanceText = `Balance: ${balance.balanceUSD}`;
      } catch {
        balanceText = "Balance: (could not check)";
      }

      return {
        text: [
          "☁️ **mnemospark Wallet**",
          "",
          `**Address:** \`${address}\``,
          `**${balanceText}**`,
          `**Key File:** \`${WALLET_FILE}\``,
          "",
          "**Commands:**",
          "• `/mnemospark-wallet` - Show this status",
          "• `/mnemospark-wallet export` - Export private key for backup",
          "",
          `**Fund with USDC on Base:** https://basescan.org/address/${address}`,
        ].join("\n"),
      };
    },
  };
}

const plugin: OpenClawPluginDefinition = {
  id: "mnemospark",
  name: "mnemospark",
  description: "mnemospark storage and wallet plugin",
  version: VERSION,

  async register(api: OpenClawPluginApi) {
    const isDisabled =
      process.env.MNEMOSPARK_DISABLED === "true" || process.env.MNEMOSPARK_DISABLED === "1";
    if (isDisabled) {
      api.logger.info("mnemospark disabled (MNEMOSPARK_DISABLED=true).");
      return;
    }

    if (isCompletionMode()) {
      return;
    }

    createWalletCommand()
      .then((walletCommand) => {
        api.registerCommand(walletCommand);
      })
      .catch((err) => {
        api.logger.warn(
          `Failed to register /mnemospark-wallet command: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    try {
      api.registerCommand(createCloudCommand());
    } catch (err) {
      api.logger.warn(
        `Failed to register /mnemospark-cloud command: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Register service for cleanup on gateway shutdown.
    api.registerService({
      id: "mnemospark-proxy",
      start: () => {
        // No-op: proxy starts below in non-blocking mode.
      },
      stop: async () => {
        if (activeProxyHandle) {
          try {
            await activeProxyHandle.close();
            api.logger.info("mnemospark proxy closed");
          } catch (err) {
            api.logger.warn(
              `Error closing proxy: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            activeProxyHandle = null;
          }
        }
      },
    });

    // Proxy only runs in gateway mode.
    if (!isGatewayMode()) {
      return;
    }

    startProxyInBackground(api).catch((err) => {
      api.logger.error(
        `Failed to start mnemospark proxy: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  },
};

export default plugin;

// Re-export for programmatic use
export { startProxy, getProxyPort } from "./proxy.js";
export type { ProxyOptions, ProxyHandle, LowBalanceInfo, InsufficientFundsInfo } from "./proxy.js";
export { PaymentCache } from "./payment-cache.js";
export type { CachedPaymentParams } from "./payment-cache.js";
export { createPaymentFetch } from "./x402.js";
export type { PreAuthParams, PaymentFetchResult } from "./x402.js";
export { BalanceMonitor, BALANCE_THRESHOLDS } from "./balance.js";
export type { BalanceInfo, SufficiencyResult } from "./balance.js";
export {
  InsufficientFundsError,
  EmptyWalletError,
  RpcError,
  isInsufficientFundsError,
  isEmptyWalletError,
  isBalanceError,
  isRpcError,
} from "./errors.js";
export { fetchWithRetry, isRetryable, DEFAULT_RETRY_CONFIG } from "./retry.js";
export type { RetryConfig } from "./retry.js";
export { createCloudCommand } from "./cloud-command.js";
