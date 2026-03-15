import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const AES_GCM_NONCE_BYTES = 12;
export const AES_KEY_BYTES = 32;
export const KEY_STORE_SUBPATH = join(".openclaw", "mnemospark", "keys");

export function walletShortHash(walletAddress: string): string {
  return createHash("sha256").update(walletAddress.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function resolveWalletKekPath(walletAddress: string, homeDir?: string): string {
  return join(homeDir ?? homedir(), KEY_STORE_SUBPATH, `${walletShortHash(walletAddress)}.key`);
}

export function parseStoredAes256Key(
  raw: Buffer,
  errorMessage = "Invalid key file format",
): Buffer {
  if (raw.length === AES_KEY_BYTES) {
    return raw;
  }

  const decoded = Buffer.from(raw.toString("utf-8").trim(), "base64");
  if (decoded.length === AES_KEY_BYTES) {
    return decoded;
  }

  throw new Error(errorMessage);
}
