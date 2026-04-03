import { BalanceMonitor } from "./balance.js";
import {
  createMnemosparkWalletWithOptionalBackup,
  resolveWalletKeyForSlashCommandsSync,
} from "./auth.js";
import { CLOUD_ONBOARDING_BLOCK_LINES } from "./cloud-help-onboarding.js";
import { createCloudCommand } from "./cloud-command.js";
import { firstTokenAndRest, parseVerboseToken, routeMnemosparkArgs } from "./mnemospark-route.js";
import type { PluginCommandContext, PluginCommandHandler, PluginCommandResult } from "./types.js";

export const MNEMOSPARK_ROOT_HELP_TEXT = [
  "☁️ **mnemospark - Wallet and go.** 💙",
  ...CLOUD_ONBOARDING_BLOCK_LINES,
  "To view the full help menu use these commands:",
  "",
  "**Cloud storage**",
  "• `/mnemospark cloud help`",
  "",
  "**Wallet status and funding link:**",
  "• `/mnemospark wallet`",
  "• `/mnemospark wallet help`",
  "• `/mnemospark wallet create`",
  "",
  "**Let your agent run mnemospark for you:**",
  "",
  "mnemospark installs as an OpenClaw extension under `~/.openclaw/extensions/mnemospark/`. Point your agent at the bundled skill:",
  "",
  "Install the mnemospark skill available at `~/.openclaw/extensions/mnemospark/skills/mnemospark/SKILL.md`",
].join("\n");

export const MNEMOSPARK_WALLET_HELP_TEXT = (address: string) =>
  [
    "☁️ **mnemospark Wallet**",
    "",
    "**Commands:**",
    "• `/mnemospark wallet` — Show address, balance, and key file path",
    "• `/mnemospark wallet help` — This message",
    "• `/mnemospark wallet create` — Create a new wallet (and backup an existing wallet)",
    "• `/mnemospark wallet export` — Export private key for backup (sensitive)",
    "",
    `**Fund with USDC on Base:** https://basescan.org/address/${address}`,
  ].join("\n");

export type RunMnemosparkSlashHandlerOptions = {
  cloudCommandHandler?: PluginCommandHandler;
};

let defaultCloudCommandHandler: PluginCommandHandler | undefined;

function getDefaultCloudCommandHandler(): PluginCommandHandler {
  defaultCloudCommandHandler ??= createCloudCommand().handler;
  return defaultCloudCommandHandler;
}

const NO_WALLET_FOUND_TEXT =
  "No mnemospark wallet found. Run `openclaw plugins install mnemospark` or set MNEMOSPARK_WALLET_KEY.";

/**
 * OpenClaw + CLI: same handler for `/mnemospark` (args = everything after the command name).
 */
export async function runMnemosparkSlashHandler(
  ctx: PluginCommandContext,
  options?: RunMnemosparkSlashHandlerOptions,
): Promise<PluginCommandResult> {
  const route = routeMnemosparkArgs(ctx.args);

  if (route.kind === "root-help") {
    return { text: MNEMOSPARK_ROOT_HELP_TEXT };
  }

  if (route.kind === "error") {
    return { text: route.message, isError: true };
  }

  if (route.kind === "cloud") {
    const cloudCommandHandler = options?.cloudCommandHandler ?? getDefaultCloudCommandHandler();
    return cloudCommandHandler({ ...ctx, args: route.rest });
  }

  return handleWalletSlash(route.rest);
}

async function handleWalletSlash(rest: string): Promise<PluginCommandResult> {
  const trimmed = rest.trim();
  if (!trimmed) {
    return buildWalletStatusResponse();
  }

  const { first, rest: afterFirst } = firstTokenAndRest(trimmed);
  const parsed = parseVerboseToken(first);
  if (!parsed.ok) {
    return {
      text: `Invalid token "${first}". Use name:true only with value true.`,
      isError: true,
    };
  }

  if (parsed.name === "help") {
    if (afterFirst.trim()) {
      return {
        text: "Unexpected extra arguments after `help`. Use `/mnemospark wallet help` alone.",
        isError: true,
      };
    }
    return buildWalletHelpResponse();
  }

  if (parsed.name === "export") {
    if (afterFirst.trim()) {
      return {
        text: "Unexpected extra arguments after `export`. Use `/mnemospark wallet export` alone.",
        isError: true,
      };
    }
    return buildWalletExportResponse();
  }

  if (parsed.name === "create") {
    if (afterFirst.trim()) {
      return {
        text: "Unexpected extra arguments after `create`. Use `/mnemospark wallet create` alone.",
        isError: true,
      };
    }
    return buildWalletCreateResponse();
  }

  if (parsed.name === "status") {
    return buildWalletStatusResponse();
  }

  return {
    text: `Unknown wallet command "${parsed.name}". Try \`/mnemospark wallet help\`.`,
    isError: true,
  };
}

async function buildWalletStatusResponse(): Promise<PluginCommandResult> {
  const wallet = resolveWalletKeyForSlashCommandsSync();
  if (!wallet) {
    return {
      text: NO_WALLET_FOUND_TEXT,
      isError: true,
    };
  }
  const { address, keyPathLabel } = wallet;

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
      `**Key File:** \`${keyPathLabel}\``,
      "",
      "**Commands:**",
      "• `/mnemospark wallet` — Show this status",
      "• `/mnemospark wallet help` — Commands and funding link",
      "• `/mnemospark wallet create` — Create a new wallet (and backup an existing wallet)",
      "• `/mnemospark wallet export` — Export private key for backup",
      "",
      `**Fund with USDC on Base:** https://basescan.org/address/${address}`,
    ].join("\n"),
  };
}

async function buildWalletCreateResponse(): Promise<PluginCommandResult> {
  try {
    await createMnemosparkWalletWithOptionalBackup();
  } catch (err) {
    return {
      text: `Failed to create wallet: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
  return buildWalletStatusResponse();
}

async function buildWalletHelpResponse(): Promise<PluginCommandResult> {
  const wallet = resolveWalletKeyForSlashCommandsSync();
  if (!wallet) {
    return {
      text: NO_WALLET_FOUND_TEXT,
      isError: true,
    };
  }
  const { address } = wallet;

  return { text: MNEMOSPARK_WALLET_HELP_TEXT(address) };
}

async function buildWalletExportResponse(): Promise<PluginCommandResult> {
  const wallet = resolveWalletKeyForSlashCommandsSync();
  if (!wallet) {
    return {
      text: NO_WALLET_FOUND_TEXT,
      isError: true,
    };
  }
  const { walletKey, address } = wallet;

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
