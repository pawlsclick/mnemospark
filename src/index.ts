/**
 * mnemospark plugin entrypoint.
 *
 * This plugin provides wallet and cloud storage commands and starts a local
 * proxy that forwards mnemospark backend storage endpoints.
 */

import type { OpenClawPluginDefinition, OpenClawPluginApi, PluginCommandContext } from "./types.js";
import { startProxy } from "./proxy.js";
import { resolveOrGenerateWalletKey } from "./auth.js";
import { BalanceMonitor } from "./balance.js";
import { VERSION } from "./version.js";
import { runMnemosparkSlashHandler } from "./mnemospark-handler.js";
import { ensureOpenClawRenewalPrerequisites } from "./openclaw-renewal-runbook.js";

/**
 * Detect if we're running in shell completion mode.
 * In completion mode, avoid side effects and logging.
 */
function isCompletionMode(): boolean {
  const args = process.argv;
  return args.some((arg, i) => arg === "completion" && i >= 1 && i <= 3);
}

// Store active proxy handle for cleanup on gateway_stop
let activeProxyHandle: Awaited<ReturnType<typeof startProxy>> | null = null;
let startPromise: Promise<void> | null = null;

/**
 * Start the local proxy once via the OpenClaw plugin service lifecycle.
 * Idempotent: concurrent callers share the same in-flight promise.
 */
async function ensureProxyStarted(api: OpenClawPluginApi): Promise<void> {
  if (activeProxyHandle) {
    return;
  }
  if (startPromise) {
    return startPromise;
  }

  startPromise = (async () => {
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
  })().finally(() => {
    startPromise = null;
  });

  return startPromise;
}

const plugin: OpenClawPluginDefinition = {
  id: "mnemospark",
  name: "mnemospark",
  description: "mnemospark storage and wallet plugin",
  version: VERSION,

  register(api: OpenClawPluginApi) {
    const isDisabled =
      process.env.MNEMOSPARK_DISABLED === "true" || process.env.MNEMOSPARK_DISABLED === "1";
    if (isDisabled) {
      api.logger.info("mnemospark disabled (MNEMOSPARK_DISABLED=true).");
      return;
    }

    if (isCompletionMode()) {
      return;
    }

    void ensureOpenClawRenewalPrerequisites().catch((err) => {
      api.logger.warn(
        `mnemospark OpenClaw prerequisites: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    try {
      api.registerCommand({
        name: "mnemospark",
        nativeNames: {
          default: "mnemospark",
        },
        description: "mnemospark wallet and cloud storage commands",
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx: PluginCommandContext) => {
          try {
            return await runMnemosparkSlashHandler(ctx);
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : typeof err === "string"
                  ? err
                  : "An unexpected error occurred";
            return { text: message.trim() || "An unexpected error occurred", isError: true };
          }
        },
      });
    } catch (err) {
      api.logger.warn(
        `Failed to register /mnemospark command: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Register service for proxy lifecycle (start on gateway service start, stop on shutdown).
    api.registerService({
      id: "mnemospark-proxy",
      start: async () => {
        try {
          await ensureProxyStarted(api);
        } catch (err) {
          api.logger.error(
            `Failed to start mnemospark proxy: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
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
export {
  DEFAULT_MNEMOSPARK_AGENT_ID,
  ensureOpenClawRenewalPrerequisites,
  getMnemosparkAgentId,
  getRenewalAgentId,
  getRenewalNodeBinary,
  runbookDedicatedAgentEntry,
} from "./openclaw-renewal-runbook.js";
export type { EnsureOpenClawRenewalPrerequisitesOptions } from "./openclaw-renewal-runbook.js";
export { runMnemosparkSlashHandler } from "./mnemospark-handler.js";
