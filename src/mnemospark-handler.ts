import { existsSync, readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { BalanceMonitor } from "./balance.js";
import { resolveOrGenerateWalletKey, WALLET_FILE } from "./auth.js";
import { createCloudCommand } from "./cloud-command.js";
import { routeMnemosparkArgs } from "./mnemospark-route.js";
import { stripSubcommandVerbose } from "./mnemospark-route.js";
import type { PluginCommandContext, PluginCommandResult } from "./types.js";

function firstTokenAndRest(input: string): { first: string; rest: string } {
  const t = input.trim();
  if (!t) return { first: "", rest: "" };
  const spaceIdx = t.search(/\s/);
  if (spaceIdx === -1) return { first: t, rest: "" };
  return { first: t.slice(0, spaceIdx), rest: t.slice(spaceIdx + 1).trim() };
}

export const MNEMOSPARK_ROOT_HELP_TEXT = [
  "☁️ **mnemospark - Wallet and go.** 💙",
  "",
  "**Syntax:** `/mnemospark cloud …` or `/mnemospark wallet …`",
  "Arguments may use `key:value`, `key=value`, or `--key value`. Optional verbose markers: `cloud:true`, `price-storage:true`, etc. (same as bare words).",
  "Aliases include `wallet:` → wallet-address, `object:` → object-id, `quote:` → quote-id (see `/mnemospark cloud help`).",
  "",
  "**Cloud storage** — full reference:",
  "• `/mnemospark cloud help`",
  "",
  "**Wallet** — status:",
  "• `/mnemospark wallet`",
  "• `/mnemospark wallet help` — commands and funding link",
].join("\n");

export const MNEMOSPARK_WALLET_HELP_TEXT = (address: string) =>
  [
    "☁️ **mnemospark Wallet**",
    "",
    "**Commands:**",
    "• `/mnemospark wallet` — Show address, balance, and key file path",
    "• `/mnemospark wallet help` — This message",
    "• `/mnemospark wallet export` — Export private key for backup (sensitive)",
    "",
    `**Fund with USDC on Base:** https://basescan.org/address/${address}`,
  ].join("\n");

const cloudCommandHandler = createCloudCommand().handler;

/**
 * OpenClaw + CLI: same handler for `/mnemospark` (args = everything after the command name).
 */
export async function runMnemosparkSlashHandler(
  ctx: PluginCommandContext,
): Promise<PluginCommandResult> {
  const route = routeMnemosparkArgs(ctx.args);

  if (route.kind === "root-help") {
    return { text: MNEMOSPARK_ROOT_HELP_TEXT };
  }

  if (route.kind === "error") {
    return { text: route.message, isError: true };
  }

  if (route.kind === "cloud") {
    return cloudCommandHandler({ ...ctx, args: route.rest });
  }

  return handleWalletSlash(ctx, route.rest);
}

async function handleWalletSlash(
  ctx: PluginCommandContext,
  rest: string,
): Promise<PluginCommandResult> {
  const trimmed = rest.trim();
  if (!trimmed) {
    return buildWalletStatusResponse();
  }

  const { first, rest: afterFirst } = firstTokenAndRest(trimmed);
  const parsed = stripSubcommandVerbose(first);
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

  return {
    text: `Unknown wallet command "${parsed.name}". Try \`/mnemospark wallet help\`.`,
    isError: true,
  };
}

async function buildWalletStatusResponse(): Promise<PluginCommandResult> {
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
    // ignore
  }

  if (!walletKey || !address) {
    return {
      text: "No mnemospark wallet found. Run `openclaw plugins install mnemospark`.",
      isError: true,
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
      "• `/mnemospark wallet` — Show this status",
      "• `/mnemospark wallet help` — Commands and funding link",
      "• `/mnemospark wallet export` — Export private key for backup",
      "",
      `**Fund with USDC on Base:** https://basescan.org/address/${address}`,
    ].join("\n"),
  };
}

async function buildWalletHelpResponse(): Promise<PluginCommandResult> {
  const { address } = await resolveOrGenerateWalletKey();
  return { text: MNEMOSPARK_WALLET_HELP_TEXT(address) };
}

async function buildWalletExportResponse(): Promise<PluginCommandResult> {
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
    // ignore
  }

  if (!walletKey || !address) {
    return {
      text: "No mnemospark wallet found. Run `openclaw plugins install mnemospark`.",
      isError: true,
    };
  }

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
