import { getAddress } from "viem";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import { createNonce } from "./nonce.js";

export const MNEMOSPARK_DOMAIN_NAME = "Mnemospark";
export const MNEMOSPARK_DOMAIN_VERSION = "1";
export const MNEMOSPARK_VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000001" as const;

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export type MnemosparkChainId = typeof BASE_MAINNET_CHAIN_ID | typeof BASE_SEPOLIA_CHAIN_ID;

export type MnemosparkRequestPayload = {
  method: string;
  path: string;
  walletAddress: `0x${string}`;
  nonce: `0x${string}`;
  timestamp: string;
};

export type WalletSignatureHeaderEnvelope = {
  payloadB64: string;
  signature: string;
  address: `0x${string}`;
};

export const MNEMOSPARK_REQUEST_TYPES = {
  MnemosparkRequest: [
    { name: "method", type: "string" },
    { name: "path", type: "string" },
    { name: "walletAddress", type: "string" },
    { name: "nonce", type: "string" },
    { name: "timestamp", type: "string" },
  ],
} as const;

type BuildPayloadOptions = {
  nonce?: `0x${string}`;
  timestamp?: string;
};

export type CreateWalletSignatureHeaderOptions = BuildPayloadOptions & {
  chainId?: MnemosparkChainId;
};

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeBase64Json<T>(value: string): T {
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return JSON.parse(decoded) as T;
}

function normalizeMethod(method: string): string {
  const normalized = method.trim().toUpperCase();
  if (!normalized) {
    throw new Error("Request signing requires a non-empty HTTP method.");
  }
  return normalized;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Request signing requires a non-empty path.");
  }

  let parsedPath: string;
  if (/^https?:\/\//i.test(trimmed)) {
    parsedPath = new URL(trimmed).pathname;
  } else {
    parsedPath = trimmed.split("?")[0]?.split("#")[0] ?? "";
  }

  if (!parsedPath) {
    throw new Error("Request signing requires a valid request path.");
  }

  const prefixed = parsedPath.startsWith("/") ? parsedPath : `/${parsedPath}`;
  const deduplicated = prefixed.replace(/\/{2,}/g, "/");
  return deduplicated.length > 1 && deduplicated.endsWith("/")
    ? deduplicated.slice(0, -1)
    : deduplicated;
}

function normalizeTimestamp(value: string | undefined): string {
  const timestamp = value ?? Math.floor(Date.now() / 1000).toString();
  if (!/^\d+$/.test(timestamp)) {
    throw new Error("Request signing timestamp must be a Unix timestamp in seconds.");
  }
  return timestamp;
}

function normalizeNonce(value: `0x${string}` | undefined): `0x${string}` {
  const nonce = value ?? createNonce();
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new Error("Request signing nonce must be a 32-byte hex value.");
  }
  return nonce;
}

function normalizeChainId(chainId: MnemosparkChainId | undefined): MnemosparkChainId {
  const selected = chainId ?? BASE_MAINNET_CHAIN_ID;
  if (selected !== BASE_MAINNET_CHAIN_ID && selected !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Unsupported chainId for request signing: ${selected}`);
  }
  return selected;
}

export function createMnemosparkRequestDomain(chainId?: MnemosparkChainId) {
  return {
    name: MNEMOSPARK_DOMAIN_NAME,
    version: MNEMOSPARK_DOMAIN_VERSION,
    chainId: normalizeChainId(chainId),
    verifyingContract: MNEMOSPARK_VERIFYING_CONTRACT,
  } as const;
}

export function createMnemosparkRequestPayload(
  method: string,
  path: string,
  walletAddress: string,
  options?: BuildPayloadOptions,
): MnemosparkRequestPayload {
  return {
    method: normalizeMethod(method),
    path: normalizePath(path),
    walletAddress: getAddress(walletAddress),
    nonce: normalizeNonce(options?.nonce),
    timestamp: normalizeTimestamp(options?.timestamp),
  };
}

export function decodeWalletSignatureHeaderValue(
  headerValue: string,
): WalletSignatureHeaderEnvelope {
  return decodeBase64Json<WalletSignatureHeaderEnvelope>(headerValue);
}

export function decodeWalletSignaturePayload(payloadB64: string): MnemosparkRequestPayload {
  return decodeBase64Json<MnemosparkRequestPayload>(payloadB64);
}

export async function createWalletSignatureHeaderValue(
  method: string,
  path: string,
  walletAddress: string,
  walletPrivateKey: `0x${string}`,
  options?: CreateWalletSignatureHeaderOptions,
): Promise<string> {
  const payload = createMnemosparkRequestPayload(method, path, walletAddress, {
    nonce: options?.nonce,
    timestamp: options?.timestamp,
  });
  const signer = privateKeyToAccount(walletPrivateKey);

  if (signer.address.toLowerCase() !== payload.walletAddress.toLowerCase()) {
    throw new Error(
      `Wallet address ${payload.walletAddress} does not match signer address ${signer.address}.`,
    );
  }

  const signature = await signTypedData({
    privateKey: walletPrivateKey,
    domain: createMnemosparkRequestDomain(options?.chainId),
    types: MNEMOSPARK_REQUEST_TYPES,
    primaryType: "MnemosparkRequest",
    message: payload,
  });

  const headerEnvelope: WalletSignatureHeaderEnvelope = {
    payloadB64: encodeBase64Json(payload),
    signature,
    address: signer.address,
  };

  return encodeBase64Json(headerEnvelope);
}
