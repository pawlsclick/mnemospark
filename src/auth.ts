/**
 * mnemospark Auth Methods for OpenClaw
 *
 * Provides wallet-based authentication for the mnemospark provider.
 * Operators configure their wallet private key, which is used to
 * sign x402 micropayments for LLM inference.
 *
 * Two methods:
 *   1. Auto-generate — create a new wallet on first run, save to ~/.openclaw/mnemospark/wallet/wallet.key
 *   2. Manual input — operator enters private key via wizard
 *
 * SECURITY NOTE (for OpenClaw scanner):
 * This module reads MNEMOSPARK_WALLET_KEY environment variable and uses it
 * to sign x402 payment requests. This is INTENTIONAL and REQUIRED behavior:
 * - The wallet key signs USDC payments on Base L2 for each LLM API call
 * - Without the key, mnemospark cannot authorize payments to BlockRun
 * - The key is NEVER transmitted over the network, only used locally for signing
 * - This is standard x402 payment flow, not credential harvesting
 *
 * @see https://x402.org - x402 payment protocol specification
 * @see https://blockrun.ai/docs - BlockRun API documentation
 * @openclaw-security env-access=MNEMOSPARK_WALLET_KEY purpose=x402-payment-signing
 */

import { existsSync, readFileSync } from "node:fs";
import { copyFile, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { ProviderAuthMethod, ProviderAuthContext, ProviderAuthResult } from "./types.js";
import { isValidWalletPrivateKey } from "./wallet-key.js";

const LEGACY_WALLET_DIR = join(homedir(), ".openclaw", "blockrun");
const LEGACY_WALLET_FILE = join(LEGACY_WALLET_DIR, "wallet.key");
const WALLET_DIR = join(homedir(), ".openclaw", "mnemospark", "wallet");
const WALLET_FILE = join(WALLET_DIR, "wallet.key");

// Export for use by wallet command and CLI
export { WALLET_FILE, LEGACY_WALLET_FILE };

/** Resolved wallet for slash commands (`/mnemospark wallet`); never auto-generates a key. */
export type SlashCommandWalletResolution = {
  walletKey: string;
  address: string;
  /** Absolute path to key file, or env label for `MNEMOSPARK_WALLET_KEY`. */
  keyPathLabel: string;
};

/**
 * Same resolution order as `resolveOrGenerateWalletKey` but does not generate a wallet.
 * Used by `/mnemospark wallet` so blockrun legacy path matches plugin startup.
 */
export function resolveWalletKeyForSlashCommandsSync(): SlashCommandWalletResolution | null {
  const envKey = process.env.MNEMOSPARK_WALLET_KEY?.trim();
  if (isValidWalletPrivateKey(envKey)) {
    const account = privateKeyToAccount(envKey);
    return {
      walletKey: envKey,
      address: account.address,
      keyPathLabel: "MNEMOSPARK_WALLET_KEY (environment variable)",
    };
  }

  for (const path of [WALLET_FILE, LEGACY_WALLET_FILE]) {
    try {
      if (!existsSync(path)) {
        continue;
      }
      const raw = readFileSync(path, "utf-8").trim();
      if (!isValidWalletPrivateKey(raw)) {
        continue;
      }
      const account = privateKeyToAccount(raw);
      return { walletKey: raw, address: account.address, keyPathLabel: path };
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Try to load a previously auto-generated wallet key from disk.
 */
async function loadSavedWallet(): Promise<string | undefined> {
  // Prefer mnemospark-specific wallet file, fall back to legacy Blockrun path.
  for (const path of [WALLET_FILE, LEGACY_WALLET_FILE]) {
    try {
      const key = (await readFile(path, "utf-8")).trim();
      if (key.startsWith("0x") && key.length === 66) {
        console.log(`[mnemospark] ✓ Loaded existing wallet from ${path}`);
        return key;
      }
      console.warn(`[mnemospark] ⚠ Wallet file exists but is invalid (wrong format): ${path}`);
    } catch (err) {
      // File doesn't exist yet - this is expected on first run
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          `[mnemospark] ✗ Failed to read wallet file ${path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return undefined;
}

/**
 * Generate a new wallet, save to disk, return the private key.
 * CRITICAL: Verifies the file was actually written after generation.
 */
async function generateAndSaveWallet(): Promise<{ key: string; address: string }> {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);

  // Create directory
  await mkdir(WALLET_DIR, { recursive: true });

  // Write wallet file
  await writeFile(WALLET_FILE, key + "\n", { mode: 0o600 });

  // CRITICAL: Verify the file was actually written
  try {
    const verification = (await readFile(WALLET_FILE, "utf-8")).trim();
    if (verification !== key) {
      throw new Error("Wallet file verification failed - content mismatch");
    }
    console.log(`[mnemospark] ✓ Wallet saved and verified at ${WALLET_FILE}`);
  } catch (err) {
    throw new Error(
      `Failed to verify wallet file after creation: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { key, address: account.address };
}

/**
 * Pick `wallet.key.bak-YYYY-MM-DD` next to `wallet.key`, or append `-2`, `-3`, … if that name exists.
 */
export function pickUniqueWalletKeyBackupPath(walletKeyPath: string): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const base = `${walletKeyPath}.bak-${y}-${m}-${day}`;
  if (!existsSync(base)) {
    return base;
  }
  let n = 2;
  for (;;) {
    const candidate = `${base}-${n}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
    n += 1;
  }
}

/**
 * If a key exists at the mnemospark default path, copy it to a dated `.bak-*` file, then generate and save a new wallet.
 * Does not touch the legacy blockrun path.
 */
export async function createMnemosparkWalletWithOptionalBackup(): Promise<{
  backupPath?: string;
  key: string;
  address: string;
}> {
  let backupPath: string | undefined;
  if (existsSync(WALLET_FILE)) {
    backupPath = pickUniqueWalletKeyBackupPath(WALLET_FILE);
    await copyFile(WALLET_FILE, backupPath);
  }
  const { key, address } = await generateAndSaveWallet();
  return { backupPath, key, address };
}

/**
 * Resolve wallet key: load saved file → auto-generate.
 * Called by index.ts before the auth wizard runs.
 *
 * Resolution order:
 *   1. MNEMOSPARK_WALLET_KEY environment variable.
 *   2. Saved file: prefer WALLET_FILE (mnemospark), then LEGACY_WALLET_FILE (blockrun).
 *   3. Auto-generate a new wallet and write to WALLET_FILE.
 */
export async function resolveOrGenerateWalletKey(): Promise<{
  key: string;
  address: string;
  source: "saved" | "env" | "generated";
}> {
  // 1. Environment variable
  const envKey = process.env.MNEMOSPARK_WALLET_KEY?.trim();
  if (isValidWalletPrivateKey(envKey)) {
    const account = privateKeyToAccount(envKey);
    return { key: envKey, address: account.address, source: "env" };
  }

  // 2. Previously saved wallet (mnemospark path first, then legacy blockrun path)
  const saved = await loadSavedWallet();
  if (saved) {
    const account = privateKeyToAccount(saved as `0x${string}`);
    return { key: saved, address: account.address, source: "saved" };
  }

  // 3. Auto-generate
  const { key, address } = await generateAndSaveWallet();
  return { key, address, source: "generated" };
}

/**
 * Auth method: operator enters their wallet private key directly.
 */
export const walletKeyAuth: ProviderAuthMethod = {
  id: "wallet-key",
  label: "Wallet Private Key",
  hint: "Enter your EVM wallet private key (0x...) for x402 payments to BlockRun",
  kind: "api_key",
  run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
    const key = await ctx.prompter.text({
      message: "Enter your wallet private key (0x...)",
      validate: (value: string) => {
        const trimmed = value.trim();
        if (!trimmed.startsWith("0x")) return "Key must start with 0x";
        if (trimmed.length !== 66) return "Key must be 66 characters (0x + 64 hex)";
        if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return "Key must be valid hex";
        return undefined;
      },
    });

    if (!key || typeof key !== "string") {
      throw new Error("Wallet key is required");
    }

    return {
      profiles: [
        {
          profileId: "default",
          credential: { apiKey: key.trim() },
        },
      ],
      notes: [
        "Wallet key stored securely in OpenClaw credentials.",
        "Your wallet signs x402 USDC payments on Base for each LLM call.",
        "Fund your wallet with USDC on Base to start using BlockRun models.",
      ],
    };
  },
};

/**
 * Auth method: read wallet key from MNEMOSPARK_WALLET_KEY environment variable.
 */
export const envKeyAuth: ProviderAuthMethod = {
  id: "env-key",
  label: "Environment Variable",
  hint: "Use MNEMOSPARK_WALLET_KEY environment variable",
  kind: "api_key",
  run: async (): Promise<ProviderAuthResult> => {
    const key = process.env.MNEMOSPARK_WALLET_KEY;

    if (!key) {
      throw new Error(
        "MNEMOSPARK_WALLET_KEY environment variable is not set. " +
          "Set it to your EVM wallet private key (0x...).",
      );
    }

    return {
      profiles: [
        {
          profileId: "default",
          credential: { apiKey: key.trim() },
        },
      ],
      notes: ["Using wallet key from MNEMOSPARK_WALLET_KEY environment variable."],
    };
  },
};
