import { spawn } from "node:child_process";
import {
  createCipheriv,
  createHash,
  randomBytes as randomBytesNode,
  randomUUID,
} from "node:crypto";
import { createReadStream, createWriteStream, statfsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { privateKeyToAccount } from "viem/accounts";

import {
  requestPaymentSettleViaProxy,
  requestStorageUploadConfirmViaProxy,
  requestStorageUploadViaProxy,
  parsePriceStorageQuoteRequest,
  requestPriceStorageViaProxy,
  type BackendSettleForwardResult,
  type StorageUploadConfirmRequest,
  type StorageUploadRequest,
  type StorageUploadResponse,
  type UploadPayload,
  type PriceStorageQuoteRequest,
  type PriceStorageQuoteResponse,
  type ProxySettleOptions,
  type ProxyUploadConfirmOptions,
  type ProxyQuoteOptions,
  type ProxyUploadOptions,
} from "./cloud-price-storage.js";
import { buildMnemosparkLsMessage } from "./cloud-ls-format.js";
import {
  parseStorageObjectRequest,
  requestStorageDeleteViaProxy,
  requestStorageDownloadViaProxy,
  requestStorageLsViaProxy,
  sanitizeFriendlyNameForLocalBasename,
  type ProxyStorageOptions,
  type StorageDeleteResponse,
  type StorageDownloadProxyResponse,
  type StorageLsRequest,
  type StorageLsResponse,
  type StorageObjectRequest,
} from "./cloud-storage.js";
import {
  AES_GCM_NONCE_BYTES,
  parseStoredAes256Key,
  resolveWalletKekPath,
  walletShortHash,
} from "./cloud-storage-crypto.js";
import type { OpenClawPluginCommandDefinition } from "./types.js";
import { createPaymentFetch, type PaymentFetchResult } from "./x402.js";
import { isValidWalletPrivateKey } from "./wallet-key.js";
import { createCloudDatastore, type CronJobRow, type QuoteLookup } from "./cloud-datastore.js";
import { appendJsonlEvent } from "./cloud-jsonl.js";
import type { RequestCorrelation } from "./cloud-correlation.js";

const SUPPORTED_BACKUP_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "linux"]);
const BACKUP_DIR_SUBPATH = join(".openclaw", "mnemospark", "backup");
const DEFAULT_BACKUP_DIR = join(homedir(), BACKUP_DIR_SUBPATH);
const BLOCKRUN_WALLET_KEY_SUBPATH = join(".openclaw", "blockrun", "wallet.key");
const MNEMOSPARK_WALLET_KEY_SUBPATH = join(".openclaw", "mnemospark", "wallet", "wallet.key");
const INLINE_UPLOAD_MAX_BYTES = 4_500_000;
/** Node `fs.readFile` rejects files larger than this (ERR_FS_FILE_TOO_LARGE). */
const NODE_FS_MAX_READFILE_BYTES = 2147483648;
// Standard cron cannot express "every 30 days" from an arbitrary date. */30 in day-of-month
// means days 1 and 31, so in 31-day months it fires twice one day apart (e.g. Jan 31, Feb 1).
// Use 1st of each month so the job runs once per month.
const PAYMENT_CRON_SCHEDULE = "0 0 1 * *";
const TAR_OVERHEAD_BYTES = 10 * 1024 * 1024; // Conservative headroom for tar metadata.

const QUOTE_VALIDITY_USER_NOTE =
  "Quotes are valid for one hour. Please run price-storage again if you need a new quote.";
const MNEMOSPARK_SUPPORT_EMAIL = "pluggedin@mnemospark.ai";

const CLOUD_HELP_FOOTER_STATE =
  "Local state: mnemospark records quotes, objects, payments, cron jobs, friendly names, and operation metadata in ~/.openclaw/mnemospark/state.db (SQLite). For troubleshooting and correlation, commands and the HTTP proxy append structured JSON lines to ~/.openclaw/mnemospark/events.jsonl. Monthly storage billing jobs are listed in ~/.openclaw/cron/jobs.json for OpenClaw scheduling.";

const REQUIRED_PRICE_STORAGE =
  "--wallet-address, --object-id, --object-id-hash, --gb, --provider, --region";
const REQUIRED_UPLOAD = "--quote-id, --wallet-address, --object-id, --object-id-hash";
const REQUIRED_BACKUP = "<file|directory> and --name <friendly-name>";
const REQUIRED_PAYMENT_SETTLE = "--wallet-address and (--quote-id | --renewal with --object-key)";
const PAYMENT_SETTLE_BOOLEAN_FLAGS = new Set(["renewal"]);
const REQUIRED_STORAGE_OBJECT =
  "--wallet-address and one of (--object-key | --name [--latest|--at])";
const REQUIRED_LS =
  "--wallet-address (for one object add --object-key or --name [--latest|--at]; omit both to list the bucket)";
const PAYMENT_SETTLE_FLAG_NAMES = new Set([
  "quote-id",
  "wallet-address",
  "object-id",
  "object-key",
  "storage-price",
  "renewal",
]);
const BOOLEAN_SELECTOR_FLAGS = new Set(["latest"]);
const BOOLEAN_ASYNC_FLAGS = new Set(["async"]);
const BOOLEAN_OP_STATUS_FLAGS = new Set(["cancel"]);
const BOOLEAN_SELECTOR_AND_ASYNC_FLAGS = new Set(["latest", "async"]);
const ORCHESTRATOR_MODES = new Set(["inline", "subagent"]);

/**
 * Expands a leading ~ to the current user's home directory.
 * Does not expand ~user (other users' homes).
 */
export function expandTilde(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return path;
}

const CLOUD_HELP_TEXT = [
  "☁️ **mnemospark - Wallet and go.** 💙",
  "",
  "**Cloud Commands**",
  "",
  "• `/mnemospark_cloud` or `/mnemospark_cloud help` — show this message",
  "",
  "• `/mnemospark_cloud backup <file|directory> --name <friendly-name> [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`",
  "  Purpose: create a local tar+gzip archive under ~/.openclaw/mnemospark/backup (filename from sanitized friendly name) and record metadata in SQLite for later price-storage and upload.",
  "  Required: " + REQUIRED_BACKUP,
  "",
  "• `/mnemospark_cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider aws --region us-east-1`",
  "  Purpose: request a storage quote before upload (defaults shown; override `--provider` / `--region` for other regions).",
  "  Required: " + REQUIRED_PRICE_STORAGE,
  "",
  "• `/mnemospark_cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`",
  "  Purpose: upload an encrypted object using a valid quote-id.",
  "  Required: " + REQUIRED_UPLOAD,
  "",
  "• `/mnemospark_cloud payment-settle (--quote-id <quote-id> | --renewal --object-key <key>) --wallet-address <addr> [--object-id <id>] [--storage-price <n>]`",
  "  Purpose: settle storage payment before upload (quote) or on the monthly cron (renewal, no new quote). Uses the same proxy + x402 path as upload pre-settlement.",
  "  Required: " + REQUIRED_PAYMENT_SETTLE + " (wallet private key must match the address).",
  "",
  "• `/mnemospark_cloud ls --wallet-address <addr> [--object-key <key> | --name <friendly-name> | omit both to list bucket] [--latest|--at <timestamp>]`",
  "  Purpose: stat one object or list all keys in the wallet bucket (S3).",
  "  Required: " + REQUIRED_LS,
  "",
  "• `/mnemospark_cloud download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`",
  "  Purpose: fetch an object to local disk.",
  "  Required: " + REQUIRED_STORAGE_OBJECT,
  "",
  "• `/mnemospark_cloud delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`",
  "  Purpose: remove a remote object and local cron tracking when present.",
  "  Required: " + REQUIRED_STORAGE_OBJECT,
  "",
  "• `/mnemospark_cloud op-status --operation-id <id> [--cancel]`",
  "  Purpose: inspect async operation status, or request cancellation for subagent runs.",
  "  Required: --operation-id",
  "",
  "Async orchestration flags (`backup`, `upload`, `download` only):",
  "• `--async`",
  "  Start operation in background and return quickly with operation-id.",
  "• `--orchestrator <inline|subagent>`",
  "  Choose async engine. Default when omitted is `inline`.",
  "  Use `subagent` for explicit subagent session tracking and cancellation.",
  "• `--timeout-seconds <n>`",
  "  Optional per-operation timeout. Valid only with `--async --orchestrator subagent`.",
  "  `n` must be a positive integer (seconds).",
  "• `op-status --cancel`",
  "  Cancel a subagent-orchestrated operation by operation-id (idempotent).",
  "",
  "Examples:",
  "• `/mnemospark_cloud upload ... --async --orchestrator subagent`",
  "• `/mnemospark_cloud download ... --async --orchestrator subagent --timeout-seconds 900`",
  "• `/mnemospark_cloud op-status --operation-id <id>`",
  "• `/mnemospark_cloud op-status --operation-id <id> --cancel`",
  "",
  CLOUD_HELP_FOOTER_STATE,
  "",
  "Backup uses your configured mnemospark wallet key (no `--wallet-address` flag). Commands price-storage, upload, ls, download, delete, and payment-settle require `--wallet-address` on the command line (must match that wallet).",
].join("\n");

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type UploadCommandRequest = {
  quote_id: string;
  wallet_address: string;
  object_id: string;
  object_id_hash: string;
};

type PaymentSettleCommandRequest = {
  wallet_address: string;
  renewal?: boolean;
  quote_id?: string;
  object_id?: string;
  object_key?: string;
  storage_price?: number;
};

type BackupObjectOptions = {
  platform?: NodeJS.Platform;
  tmpDir?: string;
  homeDir?: string;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  availableDiskBytes?: number;
  /** Sanitized basename for the archive file under tmpDir (production backup). */
  archiveBasename?: string;
};

type BackupObjectResult = {
  objectId: string;
  objectIdHash: string;
  objectSizeGb: string;
  archivePath: string;
};

type NameSelector = { name: string; latest?: boolean; at?: string };
type StorageObjectRequestInput = Omit<StorageObjectRequest, "object_key"> & {
  object_key?: string;
};
type OrchestratorMode = "inline" | "subagent";
type AsyncOperationArgs = {
  async?: boolean;
  orchestrator?: OrchestratorMode;
  timeoutSeconds?: number;
};

type MnemosparkSubagentTaskV1 = {
  schema: "mnemospark.subagent-task.v1";
  operationId: string;
  traceId: string;
  command: "upload" | "download" | "backup";
  args: string;
  timeoutSeconds?: number;
  requestedBy: {
    pluginCommand: "mnemospark_cloud";
    chatId?: string;
    senderId?: string;
  };
};

type MnemosparkSubagentDispatchHooks = {
  onRunning?: (sessionId: string) => Promise<void> | void;
  onProgress?: (sessionId: string, message: string) => Promise<void> | void;
  onCompleted?: (
    sessionId: string,
    result: { text: string; isError?: boolean },
  ) => Promise<void> | void;
  onFailed?: (
    sessionId: string,
    details: { code: string; message: string },
  ) => Promise<void> | void;
  onCancelled?: (sessionId: string, reason?: string) => Promise<void> | void;
  onTimedOut?: (sessionId: string) => Promise<void> | void;
};

type MnemosparkSubagentDispatchInput = {
  task: MnemosparkSubagentTaskV1;
  timeoutSeconds?: number;
  runTask: () => Promise<{ text: string; isError?: boolean }>;
  hooks?: MnemosparkSubagentDispatchHooks;
};

type MnemosparkSubagentDispatchResult = {
  sessionId: string;
};

type MnemosparkSubagentCancelResult = {
  accepted: boolean;
  alreadyTerminal?: boolean;
};

type MnemosparkSubagentOrchestrator = {
  dispatch: (input: MnemosparkSubagentDispatchInput) => Promise<MnemosparkSubagentDispatchResult>;
  cancel: (sessionId: string, reason?: string) => Promise<MnemosparkSubagentCancelResult>;
};

type ParsedCloudArgs =
  | { mode: "help" }
  | ({ mode: "backup"; backupTarget: string; friendlyName: string } & AsyncOperationArgs)
  | { mode: "backup-invalid" }
  | { mode: "backup-invalid-async" }
  | { mode: "backup-invalid-name" }
  | { mode: "price-storage"; priceStorageRequest: PriceStorageQuoteRequest }
  | { mode: "price-storage-invalid" }
  | ({
      mode: "upload";
      uploadRequest: UploadCommandRequest;
      friendlyName?: string;
    } & AsyncOperationArgs)
  | { mode: "upload-invalid" }
  | { mode: "upload-invalid-async" }
  | { mode: "payment-settle"; paymentSettleRequest: PaymentSettleCommandRequest }
  | { mode: "payment-settle-invalid" }
  | { mode: "ls"; storageObjectRequest: StorageObjectRequestInput; nameSelector?: NameSelector }
  | { mode: "ls-invalid" }
  | ({
      mode: "download";
      storageObjectRequest: StorageObjectRequestInput;
      nameSelector?: NameSelector;
    } & AsyncOperationArgs)
  | { mode: "download-invalid" }
  | { mode: "download-invalid-async" }
  | { mode: "delete"; storageObjectRequest: StorageObjectRequestInput; nameSelector?: NameSelector }
  | { mode: "delete-invalid" }
  | { mode: "op-status"; operationId: string; cancel?: boolean }
  | { mode: "op-status-invalid" }
  | { mode: "unknown" };

type CreateCloudCommandOptions = {
  backupOptions?: BackupObjectOptions;
  buildBackupObjectFn?: (
    targetPath: string,
    options?: BackupObjectOptions,
  ) => Promise<BackupObjectResult>;
  requestPriceStorageQuoteFn?: (
    request: PriceStorageQuoteRequest,
    options?: ProxyQuoteOptions,
  ) => Promise<PriceStorageQuoteResponse>;
  requestStorageUploadFn?: (
    request: StorageUploadRequest,
    options?: ProxyUploadOptions,
  ) => Promise<StorageUploadResponse>;
  requestStorageUploadConfirmFn?: (
    request: StorageUploadConfirmRequest,
    options?: ProxyUploadConfirmOptions,
  ) => Promise<StorageUploadResponse>;
  resolveWalletPrivateKeyFn?: (homeDir?: string) => Promise<`0x${string}`>;
  createPaymentFetchFn?: (privateKey: `0x${string}`) => PaymentFetchResult;
  fetchImpl?: FetchLike;
  nowDateFn?: () => Date;
  idempotencyKeyFn?: () => string;
  proxyQuoteOptions?: ProxyQuoteOptions;
  proxyUploadOptions?: ProxyUploadOptions;
  proxySettleOptions?: ProxySettleOptions;
  proxyUploadConfirmOptions?: ProxyUploadConfirmOptions;
  requestPaymentSettleViaProxyFn?: (
    quoteId: string,
    walletAddress: string,
    options?: ProxySettleOptions,
  ) => Promise<BackendSettleForwardResult>;
  requestStorageLsFn?: (
    request: StorageLsRequest,
    options?: ProxyStorageOptions,
  ) => Promise<StorageLsResponse>;
  requestStorageDownloadFn?: (
    request: StorageObjectRequest,
    options?: ProxyStorageOptions,
  ) => Promise<StorageDownloadProxyResponse>;
  requestStorageDeleteFn?: (
    request: StorageObjectRequest,
    options?: ProxyStorageOptions,
  ) => Promise<StorageDeleteResponse>;
  openClawCronAdapter?: OpenClawCronAdapter;
  subagentOrchestrator?: MnemosparkSubagentOrchestrator;
  proxyStorageOptions?: ProxyStorageOptions;
  mnemosparkHomeDir?: string;
};

class UnsupportedBackupPlatformError extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`Unsupported platform for backup: ${platform}`);
    this.name = "UnsupportedBackupPlatformError";
  }
}

function toGbString(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  const fixed = gb.toFixed(9).replace(/\.?0+$/, "");
  if (!fixed) return "0";
  return fixed.includes(".") ? fixed : `${fixed}.0`;
}

function stripWrappingQuotes(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length < 2) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tokenizeArgsRaw(input: string): string[] {
  const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!tokens) {
    return [];
  }
  return tokens;
}

function tokenizeArgs(input: string): string[] {
  return tokenizeArgsRaw(input).map((token) => stripWrappingQuotes(token));
}

function parseNamedFlagsTokens(
  tokens: string[],
  booleanFlags: ReadonlySet<string> = new Set(),
): Record<string, string> | null {
  if (tokens.length === 0) {
    return null;
  }

  const parsed: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const keyToken = tokens[i];
    if (!keyToken.startsWith("--")) {
      return null;
    }
    const key = keyToken.slice(2).toLowerCase().replace(/_/g, "-");
    const value = tokens[i + 1];
    if (!value || value.startsWith("--")) {
      if (booleanFlags.has(key)) {
        parsed[key] = "true";
        continue;
      }
      return null;
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function parseNamedFlags(
  input: string,
  booleanFlags: ReadonlySet<string> = new Set(),
): Record<string, string> | null {
  const tokens = tokenizeArgs(input);
  return parseNamedFlagsTokens(tokens, booleanFlags);
}

function parseObjectSelector(
  flags: Record<string, string>,
): { objectKey?: string; nameSelector?: NameSelector } | null {
  const objectKey = flags["object-key"]?.trim();
  const name = flags.name?.trim();
  const latest = flags.latest === "true";
  const at = flags.at?.trim();

  if (objectKey && name) return null;
  if (!objectKey && !name) return null;
  if (latest && at) return null;

  if (objectKey) return { objectKey };
  return { nameSelector: { name: name!, latest, at } };
}

/** Like parseObjectSelector but allows wallet-only list mode (no key, no --name). */
function parseLsObjectSelector(
  flags: Record<string, string>,
): { objectKey?: string; nameSelector?: NameSelector } | null {
  const objectKey = flags["object-key"]?.trim();
  const name = flags.name?.trim();
  const latest = flags.latest === "true";
  const at = flags.at?.trim();

  if (objectKey && name) return null;
  if (latest && at) return null;
  if (!objectKey && !name && (latest || at)) return null;

  if (objectKey) return { objectKey };
  if (name) return { nameSelector: { name, latest, at } };
  return {};
}

function parseStorageObjectRequestInput(
  flags: Record<string, string>,
  selector: { objectKey?: string; nameSelector?: NameSelector },
): StorageObjectRequestInput | null {
  const walletAddress = flags["wallet-address"]?.trim();
  if (!walletAddress) {
    return null;
  }
  const location = flags.location?.trim() || flags.region?.trim() || undefined;
  if (!selector.objectKey) {
    return {
      wallet_address: walletAddress,
      location,
    };
  }
  return parseStorageObjectRequest({
    wallet_address: walletAddress,
    object_key: selector.objectKey,
    location,
  });
}

function parseOrchestratorMode(value?: string): OrchestratorMode | undefined | null {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!ORCHESTRATOR_MODES.has(normalized)) {
    return null;
  }
  return normalized as OrchestratorMode;
}

function parseTimeoutSeconds(value?: string): number | undefined | null {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseAsyncOperationArgs(flags: Record<string, string>): AsyncOperationArgs | null {
  const asyncRequested = flags.async === "true";
  const hasOrchestratorFlag = typeof flags.orchestrator === "string";
  const hasTimeoutFlag = typeof flags["timeout-seconds"] === "string";

  if (!asyncRequested && (hasOrchestratorFlag || hasTimeoutFlag)) {
    return null;
  }

  const parsedOrchestrator = parseOrchestratorMode(flags.orchestrator);
  if (parsedOrchestrator === null) {
    return null;
  }
  const parsedTimeoutSeconds = parseTimeoutSeconds(flags["timeout-seconds"]);
  if (parsedTimeoutSeconds === null) {
    return null;
  }
  if (typeof parsedTimeoutSeconds === "number" && (parsedOrchestrator ?? "inline") !== "subagent") {
    return null;
  }

  return {
    async: asyncRequested,
    orchestrator: parsedOrchestrator === undefined ? undefined : parsedOrchestrator,
    timeoutSeconds: parsedTimeoutSeconds === undefined ? undefined : parsedTimeoutSeconds,
  };
}

const INVALID_ASYNC_FLAGS_MESSAGE =
  "invalid async flags. `--orchestrator`/`--timeout-seconds` require `--async`, and `--timeout-seconds` is only valid with `--orchestrator subagent`.";

function stripAsyncControlFlags(args?: string): string {
  const tokens = tokenizeArgsRaw(args ?? "");
  const filtered: string[] = [];
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx];
    const lowerToken = token.toLowerCase();
    if (lowerToken === "--async") {
      continue;
    }
    if (lowerToken === "--orchestrator" || lowerToken === "--timeout-seconds") {
      idx += 1;
      continue;
    }
    filtered.push(token);
  }
  return filtered.join(" ");
}

function parseCloudArgs(args?: string): ParsedCloudArgs {
  const trimmed = args?.trim() ?? "";
  if (!trimmed) {
    return { mode: "help" };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const subcommand = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  if (subcommand === "help") {
    return { mode: "help" };
  }

  if (subcommand === "backup") {
    const tokens = tokenizeArgs(rest);
    if (tokens.length === 0) {
      return { mode: "unknown" };
    }
    const backupTarget = tokens[0] ?? "";
    if (!backupTarget) {
      return { mode: "unknown" };
    }
    const remainingTokens = tokens.slice(1);
    const flags =
      remainingTokens.length === 0
        ? ({} as Record<string, string>)
        : parseNamedFlagsTokens(remainingTokens, BOOLEAN_ASYNC_FLAGS);
    if (!flags) {
      return { mode: "backup-invalid" };
    }
    const asyncArgs = parseAsyncOperationArgs(flags);
    if (!asyncArgs) {
      return { mode: "backup-invalid-async" };
    }
    const friendlyName = flags.name?.trim();
    if (!friendlyName) {
      return { mode: "backup-invalid-name" };
    }
    return {
      mode: "backup",
      backupTarget,
      friendlyName,
      ...asyncArgs,
    };
  }

  if (subcommand === "price-storage") {
    const flags = parseNamedFlags(rest);
    if (!flags) {
      return { mode: "price-storage-invalid" };
    }
    const gb = Number.parseFloat(flags.gb ?? "");
    const request = parsePriceStorageQuoteRequest({
      wallet_address: flags["wallet-address"],
      object_id: flags["object-id"],
      object_id_hash: flags["object-id-hash"],
      gb,
      provider: flags.provider,
      region: flags.region,
    });
    if (!request) {
      return { mode: "price-storage-invalid" };
    }
    return { mode: "price-storage", priceStorageRequest: request };
  }

  if (subcommand === "upload") {
    const flags = parseNamedFlags(rest, BOOLEAN_ASYNC_FLAGS);
    if (!flags) {
      return { mode: "upload-invalid" };
    }
    const asyncArgs = parseAsyncOperationArgs(flags);
    if (!asyncArgs) {
      return { mode: "upload-invalid-async" };
    }

    const quoteId = flags["quote-id"]?.trim();
    const walletAddress = flags["wallet-address"]?.trim();
    const objectId = flags["object-id"]?.trim();
    const objectIdHash = flags["object-id-hash"]?.trim();

    if (!quoteId || !walletAddress || !objectId || !objectIdHash) {
      return { mode: "upload-invalid" };
    }

    return {
      mode: "upload",
      friendlyName: flags.name?.trim() || undefined,
      ...asyncArgs,
      uploadRequest: {
        quote_id: quoteId,
        wallet_address: walletAddress,
        object_id: objectId,
        object_id_hash: objectIdHash,
      },
    };
  }

  if (subcommand === "payment-settle") {
    const flags = parseNamedFlags(rest, PAYMENT_SETTLE_BOOLEAN_FLAGS);
    if (!flags) {
      return { mode: "payment-settle-invalid" };
    }
    for (const key of Object.keys(flags)) {
      if (!PAYMENT_SETTLE_FLAG_NAMES.has(key)) {
        return { mode: "payment-settle-invalid" };
      }
    }
    const walletAddress = flags["wallet-address"]?.trim();
    if (!walletAddress) {
      return { mode: "payment-settle-invalid" };
    }
    const isRenewal = flags.renewal === "true";
    const quoteId = flags["quote-id"]?.trim();
    const objectKey = flags["object-key"]?.trim();
    if (isRenewal) {
      if (quoteId) {
        return { mode: "payment-settle-invalid" };
      }
      if (!objectKey) {
        return { mode: "payment-settle-invalid" };
      }
    } else if (!quoteId) {
      return { mode: "payment-settle-invalid" };
    }
    let storagePrice: number | undefined;
    if (flags["storage-price"] !== undefined && flags["storage-price"] !== "") {
      const raw = flags["storage-price"]?.trim() ?? "";
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n) || n < 0) {
        return { mode: "payment-settle-invalid" };
      }
      storagePrice = n;
    }
    return {
      mode: "payment-settle",
      paymentSettleRequest: {
        wallet_address: walletAddress,
        renewal: isRenewal || undefined,
        quote_id: quoteId || undefined,
        object_id: flags["object-id"]?.trim() || undefined,
        object_key: objectKey || undefined,
        storage_price: storagePrice,
      },
    };
  }

  if (subcommand === "ls") {
    const flags = parseNamedFlags(rest, BOOLEAN_SELECTOR_FLAGS);
    if (!flags) {
      return { mode: "ls-invalid" };
    }
    const walletAddress = flags["wallet-address"]?.trim() ?? flags["wallet_address"]?.trim() ?? "";
    if (!walletAddress) {
      return { mode: "ls-invalid" };
    }
    const selector = parseLsObjectSelector(flags);
    if (!selector) {
      return { mode: "ls-invalid" };
    }
    const location = flags.location?.trim() || flags.region?.trim() || undefined;
    if (selector.nameSelector) {
      return {
        mode: "ls",
        storageObjectRequest: { wallet_address: walletAddress, location },
        nameSelector: selector.nameSelector,
      };
    }
    if (selector.objectKey) {
      return {
        mode: "ls",
        storageObjectRequest: {
          wallet_address: walletAddress,
          object_key: selector.objectKey,
          location,
        },
      };
    }
    return {
      mode: "ls",
      storageObjectRequest: { wallet_address: walletAddress, location },
    };
  }

  if (subcommand === "download") {
    const flags = parseNamedFlags(rest, BOOLEAN_SELECTOR_AND_ASYNC_FLAGS);
    if (!flags) {
      return { mode: "download-invalid" };
    }
    const asyncArgs = parseAsyncOperationArgs(flags);
    if (!asyncArgs) {
      return { mode: "download-invalid-async" };
    }
    const selector = parseObjectSelector(flags);
    if (!selector) {
      return { mode: "download-invalid" };
    }
    const request = parseStorageObjectRequestInput(flags, selector);
    if (!request) {
      return { mode: "download-invalid" };
    }
    return {
      mode: "download",
      storageObjectRequest: request,
      nameSelector: selector.nameSelector,
      ...asyncArgs,
    };
  }

  if (subcommand === "delete") {
    const flags = parseNamedFlags(rest, BOOLEAN_SELECTOR_FLAGS);
    if (!flags) {
      return { mode: "delete-invalid" };
    }
    const selector = parseObjectSelector(flags);
    if (!selector) {
      return { mode: "delete-invalid" };
    }
    const request = parseStorageObjectRequestInput(flags, selector);
    if (!request) {
      return { mode: "delete-invalid" };
    }
    return { mode: "delete", storageObjectRequest: request, nameSelector: selector.nameSelector };
  }

  if (subcommand === "op-status") {
    const flags = parseNamedFlags(rest, BOOLEAN_OP_STATUS_FLAGS);
    const operationId = flags?.["operation-id"]?.trim();
    if (!operationId) {
      return { mode: "op-status-invalid" };
    }
    return { mode: "op-status", operationId, cancel: flags?.cancel === "true" };
  }

  return { mode: "unknown" };
}

async function calculateInputSizeBytes(targetPath: string): Promise<number> {
  const targetStats = await lstat(targetPath);
  if (targetStats.isFile() || targetStats.isSymbolicLink()) {
    return targetStats.size;
  }

  if (!targetStats.isDirectory()) {
    throw new Error("Backup target must be a file or directory");
  }

  let total = 0;
  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    total += await calculateInputSizeBytes(join(targetPath, entry.name));
  }
  return total;
}

function getAvailableDiskBytes(tmpDir: string, options: BackupObjectOptions): number {
  if (typeof options.availableDiskBytes === "number") {
    return options.availableDiskBytes;
  }
  const stats = statfsSync(tmpDir);
  return stats.bavail * stats.bsize;
}

async function runTarGzip(archivePath: string, sourcePath: string): Promise<void> {
  const sourceDir = dirname(sourcePath);
  const sourceName = basename(sourcePath);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let stderr = "";
    const child = spawn("tar", ["-czf", archivePath, "-C", sourceDir, sourceName], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(stderr.trim() || `tar exited with code ${code ?? "unknown"}`));
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise());
  });
  return hash.digest("hex");
}

async function resolveLocalUploadArchivePath(
  backupDir: string,
  objectId: string,
  friendlyName: string,
): Promise<{ ok: true; archivePath: string } | { ok: false; message: string }> {
  if (friendlyName?.trim()) {
    try {
      const sanitized = sanitizeFriendlyNameForLocalBasename(friendlyName);
      const candidate = join(backupDir, sanitized);
      try {
        const st = await stat(candidate);
        if (st.isFile()) {
          return { ok: true, archivePath: candidate };
        }
      } catch {
        // Missing friendly-name path; try legacy.
      }
    } catch {
      // Invalid friendly name for path; try legacy.
    }
  }

  const legacyPath = join(backupDir, objectId);
  try {
    const legacyStats = await stat(legacyPath);
    if (!legacyStats.isFile()) {
      return {
        ok: false,
        message: `Cannot upload storage object: local archive path is not a file (${legacyPath}).`,
      };
    }
    return { ok: true, archivePath: legacyPath };
  } catch {
    return {
      ok: false,
      message: `Cannot upload storage object: local archive not found. Run /mnemospark_cloud backup with --name (canonical layout) or restore the legacy file at ${legacyPath}.`,
    };
  }
}

function createObjectId(options: BackupObjectOptions): string {
  const nowFn = options.now ?? Date.now;
  const randomFn = options.randomBytes ?? randomBytesNode;
  return `${nowFn()}-${randomFn(8).toString("hex")}`;
}

export async function buildBackupObject(
  targetPathArg: string,
  options: BackupObjectOptions = {},
): Promise<BackupObjectResult> {
  const platform = options.platform ?? process.platform;
  if (!SUPPORTED_BACKUP_PLATFORMS.has(platform)) {
    throw new UnsupportedBackupPlatformError(platform);
  }

  const targetPath = resolve(expandTilde(targetPathArg));
  const targetStats = await lstat(targetPath);
  if (!targetStats.isFile() && !targetStats.isDirectory()) {
    throw new Error("Backup target must be a file or directory");
  }

  const tmpDir = options.tmpDir ?? DEFAULT_BACKUP_DIR;
  let tmpStats;
  try {
    tmpStats = await stat(tmpDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await mkdir(tmpDir, { recursive: true });
      tmpStats = await stat(tmpDir);
    } else {
      throw error;
    }
  }
  if (!tmpStats.isDirectory()) {
    throw new Error("Backup path is not a directory");
  }

  const inputSizeBytes = await calculateInputSizeBytes(targetPath);
  const availableDiskBytes = getAvailableDiskBytes(tmpDir, options);
  const requiredDiskBytes = inputSizeBytes + TAR_OVERHEAD_BYTES;
  if (availableDiskBytes < requiredDiskBytes) {
    throw new Error("Insufficient disk space for backup object");
  }

  const objectId = createObjectId(options);
  const archiveBaseSegment = options.archiveBasename?.trim() || objectId;
  const archivePath = join(tmpDir, archiveBaseSegment);

  if (options.archiveBasename?.trim()) {
    try {
      const existing = await stat(archivePath);
      if (existing.isFile() || existing.isDirectory()) {
        throw new Error(
          `Backup archive path already exists: ${archivePath}. Choose a different --name.`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("already exists")) {
        throw err;
      }
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  try {
    await runTarGzip(archivePath, targetPath);
    const archiveStats = await stat(archivePath);
    const objectIdHash = await sha256File(archivePath);
    const objectSizeGb = toGbString(archiveStats.size);

    return {
      objectId,
      objectIdHash,
      objectSizeGb,
      archivePath,
    };
  } catch (error) {
    await rm(archivePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

type StoragePaymentCronJob = {
  cronId: string;
  createdAt: string;
  schedule: string;
  command: string;
  quoteId: string;
  storagePrice: number;
  walletAddress: string;
  objectId: string;
  objectKey: string;
  provider: string;
  bucketName: string;
  location: string;
};

type OpenClawCronSchedule = {
  kind: "cron";
  expr: string;
  tz: string;
};

type OpenClawCronPayload = {
  kind: "agentTurn";
  message: string;
};

type OpenClawCronDelivery = {
  mode: "announce";
  text: string;
};

type OpenClawCronJobEntry = {
  jobId: string;
  name: string;
  schedule: OpenClawCronSchedule;
  payload: OpenClawCronPayload;
  sessionTarget: "isolated";
  delivery: OpenClawCronDelivery;
};

type OpenClawCronJobForLookup = {
  jobId: string;
  message: string;
};

type OpenClawCronAdapter = {
  add: (job: OpenClawCronJobEntry) => Promise<{ jobId: string }>;
  remove: (jobId: string) => Promise<boolean>;
  list: () => Promise<OpenClawCronJobForLookup[]>;
};

function normalizeOpenClawCronJobForLookup(value: unknown): OpenClawCronJobForLookup | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const jobIdRaw = typeof record.jobId === "string" ? record.jobId : record.id;
  const jobId = typeof jobIdRaw === "string" ? jobIdRaw.trim() : "";
  const payloadRaw = record.payload;
  if (!jobId || !payloadRaw || typeof payloadRaw !== "object") {
    return null;
  }
  const payloadRecord = payloadRaw as Record<string, unknown>;
  const payloadKind = payloadRecord.kind;
  const payloadMessage =
    typeof payloadRecord.message === "string" ? payloadRecord.message.trim() : "";
  if (payloadKind !== "agentTurn" || !payloadMessage) {
    return null;
  }

  return {
    jobId,
    message: payloadMessage,
  };
}

type OpenClawCliResult = { stdout: string; stderr: string };

async function runOpenClawCli(args: string[], homeDir?: string): Promise<OpenClawCliResult> {
  return await new Promise<OpenClawCliResult>((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("openclaw", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: homeDir ?? process.env.HOME,
      },
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `openclaw ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

function parseOpenClawCliJson<T>(stdout: string, commandLabel: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`openclaw ${commandLabel} returned empty JSON output`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`openclaw ${commandLabel} returned invalid JSON output`);
  }
}

function createOpenClawCliCronAdapter(homeDir?: string): OpenClawCronAdapter {
  return {
    add: async (job) => {
      const { stdout } = await runOpenClawCli(
        [
          "cron",
          "add",
          "--name",
          job.name,
          "--cron",
          job.schedule.expr,
          "--tz",
          job.schedule.tz,
          "--session",
          job.sessionTarget,
          "--message",
          job.payload.message,
          "--announce",
          "--description",
          job.delivery.text,
          "--json",
        ],
        homeDir,
      );
      const payload = parseOpenClawCliJson<Record<string, unknown>>(stdout, "cron add");
      const createdIdRaw = typeof payload.id === "string" ? payload.id : payload.jobId;
      const createdId = typeof createdIdRaw === "string" ? createdIdRaw.trim() : "";
      if (!createdId) {
        throw new Error("openclaw cron add did not return a job id");
      }
      return { jobId: createdId };
    },
    remove: async (jobId) => {
      const { stdout } = await runOpenClawCli(["cron", "rm", jobId, "--json"], homeDir);
      const payload = parseOpenClawCliJson<Record<string, unknown>>(stdout, "cron rm");
      if (typeof payload.removed === "boolean") {
        return payload.removed;
      }
      return true;
    },
    list: async () => {
      const { stdout } = await runOpenClawCli(["cron", "list", "--all", "--json"], homeDir);
      const payload = parseOpenClawCliJson<Record<string, unknown>>(stdout, "cron list");
      const jobsRaw = Array.isArray(payload.jobs) ? payload.jobs : [];
      return jobsRaw
        .map((entry) => normalizeOpenClawCronJobForLookup(entry))
        .filter((entry): entry is OpenClawCronJobForLookup => entry !== null);
    },
  };
}

/** Latest matching OpenClaw cron job in jobs.json for an object key (scan from end of file). */
async function findCronJobInOpenClawCronJobsByObjectKey(
  objectKey: string,
  adapter: OpenClawCronAdapter,
): Promise<{ cronId: string; objectId: string; objectKey: string } | null> {
  const cronJobs = await adapter.list();
  for (let idx = cronJobs.length - 1; idx >= 0; idx -= 1) {
    const cronJob = cronJobs[idx];
    const parsed = parseStoragePaymentCronCommand(cronJob.message);
    if (parsed && parsed.objectKey === objectKey) {
      return {
        cronId: cronJob.jobId,
        objectId: parsed.objectId,
        objectKey: parsed.objectKey,
      };
    }
  }
  return null;
}

function quoteCronArgument(value: string | number): string {
  return JSON.stringify(String(value));
}

type StoragePaymentRenewalJobFields = {
  walletAddress: string;
  objectId: string;
  objectKey: string;
  storagePrice: number;
};

/** Args after `cloud` for `node …/cli.js cloud …` (same shape as slash command without `/mnemospark_cloud`). */
function buildStoragePaymentRenewalArgs(job: StoragePaymentRenewalJobFields): string {
  return [
    "payment-settle",
    "--renewal",
    "--wallet-address",
    quoteCronArgument(job.walletAddress),
    "--object-id",
    quoteCronArgument(job.objectId),
    "--object-key",
    quoteCronArgument(job.objectKey),
    "--storage-price",
    quoteCronArgument(job.storagePrice),
  ].join(" ");
}

function buildStoragePaymentCronCommand(job: StoragePaymentRenewalJobFields): string {
  return `/mnemospark_cloud ${buildStoragePaymentRenewalArgs(job)}`;
}

function buildOpenClawRenewalAgentMessage(openClawHome: string, renewalArgs: string): string {
  const cliPath = join(openClawHome, ".openclaw/extensions/mnemospark/dist/cli.js");
  return `Execute: node ${cliPath} cloud ${renewalArgs}`;
}

function parseStoragePaymentCronCommand(
  command: string,
): { objectId: string; objectKey: string } | null {
  const objectIdMatch = command.match(/--object-id\s+("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+)/);
  const objectKeyMatch = command.match(/--object-key\s+("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|\S+)/);
  if (!objectIdMatch || !objectKeyMatch) {
    return null;
  }

  const parseToken = (token: string): string | null => {
    const trimmed = token.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  const objectId = parseToken(objectIdMatch[1] ?? "");
  const objectKey = parseToken(objectKeyMatch[1] ?? "");
  if (!objectId || !objectKey) {
    return null;
  }

  return { objectId, objectKey };
}

async function appendStoragePaymentCronJob(
  cronJob: StoragePaymentCronJob,
  adapter: OpenClawCronAdapter,
  payloadMessage: string,
): Promise<{ jobId: string }> {
  const openClawJob: OpenClawCronJobEntry = {
    jobId: cronJob.cronId,
    name: "Mnemospark Monthly Renewal",
    schedule: {
      kind: "cron",
      expr: PAYMENT_CRON_SCHEDULE,
      tz: "UTC",
    },
    payload: {
      kind: "agentTurn",
      message: payloadMessage,
    },
    sessionTarget: "isolated",
    delivery: {
      mode: "announce",
      text: "Thank you for using mnemospark cloud storage. Your renewal has been processed.",
    },
  };
  return adapter.add(openClawJob);
}

async function removeStoragePaymentCronJob(
  cronId: string,
  adapter: OpenClawCronAdapter,
): Promise<boolean> {
  return adapter.remove(cronId);
}

async function createStoragePaymentCronJob(
  upload: StorageUploadResponse,
  storagePrice: number,
  openClawCronAdapter: OpenClawCronAdapter,
  openClawHomeDir: string,
  nowDateFn: () => Date = () => new Date(),
): Promise<StoragePaymentCronJob> {
  const renewalFields: StoragePaymentRenewalJobFields = {
    walletAddress: upload.addr,
    objectId: upload.object_id,
    objectKey: upload.object_key,
    storagePrice,
  };
  const renewalArgs = buildStoragePaymentRenewalArgs(renewalFields);
  const provisionalCronId = randomUUID();
  const cronJob: StoragePaymentCronJob = {
    cronId: provisionalCronId,
    createdAt: nowDateFn().toISOString(),
    schedule: PAYMENT_CRON_SCHEDULE,
    command: buildStoragePaymentCronCommand(renewalFields),
    quoteId: upload.quote_id,
    storagePrice,
    walletAddress: upload.addr,
    objectId: upload.object_id,
    objectKey: upload.object_key,
    provider: upload.provider,
    bucketName: upload.bucket_name,
    location: upload.location,
  };

  const payloadMessage = buildOpenClawRenewalAgentMessage(openClawHomeDir, renewalArgs);
  const created = await appendStoragePaymentCronJob(cronJob, openClawCronAdapter, payloadMessage);
  // Use the actual OpenClaw job id so datastore and delete cleanup stay in sync.
  if (created.jobId?.trim()) {
    cronJob.cronId = created.jobId.trim();
  }
  return cronJob;
}

async function readWalletKeyIfPresent(walletPath: string): Promise<`0x${string}` | null> {
  try {
    const key = (await readFile(walletPath, "utf-8")).trim();
    return isValidWalletPrivateKey(key) ? key : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function resolveWalletPrivateKey(homeDir?: string): Promise<`0x${string}`> {
  const envKey = process.env.MNEMOSPARK_WALLET_KEY?.trim();
  if (isValidWalletPrivateKey(envKey)) {
    return envKey;
  }

  const baseHome = homeDir ?? homedir();
  const primaryWalletPath = join(baseHome, MNEMOSPARK_WALLET_KEY_SUBPATH);
  const fallbackWalletPath = join(baseHome, BLOCKRUN_WALLET_KEY_SUBPATH);

  const fromPrimary = await readWalletKeyIfPresent(primaryWalletPath);
  if (fromPrimary) {
    return fromPrimary;
  }

  const fromFallback = await readWalletKeyIfPresent(fallbackWalletPath);
  if (fromFallback) {
    return fromFallback;
  }

  throw new Error(
    "No mnemospark wallet found. Run `openclaw plugins install mnemospark` or set MNEMOSPARK_WALLET_KEY.",
  );
}

function sha256Buffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function bucketNameForWallet(walletAddress: string): string {
  return `mnemospark-${walletShortHash(walletAddress)}`;
}

export function encryptAesGcm(
  plaintext: Buffer,
  key: Buffer,
  randomFn: (size: number) => Buffer = randomBytesNode,
): Buffer {
  if (key.length !== 32) {
    throw new Error("Expected 32-byte AES key");
  }
  const nonce = randomFn(AES_GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

/**
 * Stream plaintext from disk through AES-256-GCM and write `nonce || ciphertext || tag`
 * to `outPath`. Same wire format as {@link encryptAesGcm}.
 */
export async function encryptPlaintextFileToAesGcmPath(
  plaintextPath: string,
  dek: Buffer,
  outPath: string,
  randomFn: (size: number) => Buffer = randomBytesNode,
): Promise<void> {
  if (dek.length !== 32) {
    throw new Error("Expected 32-byte AES key");
  }
  const nonce = randomFn(AES_GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dek, nonce);
  const writeStream = createWriteStream(outPath, { flags: "w" });
  writeStream.write(nonce);
  try {
    for await (const chunk of createReadStream(plaintextPath)) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const out = cipher.update(buf);
      if (out.length) {
        await new Promise<void>((resolve, reject) => {
          writeStream.write(out, (err) => (err ? reject(err) : resolve()));
        });
      }
    }
    const final = cipher.final();
    const tag = cipher.getAuthTag();
    await new Promise<void>((resolve, reject) => {
      writeStream.write(final, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      writeStream.write(tag, (err) => (err ? reject(err) : resolve()));
    });
    writeStream.end();
    await finished(writeStream);
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

async function loadOrCreateKek(
  walletAddress: string,
  homeDir?: string,
): Promise<{ kek: Buffer; keyPath: string }> {
  const keyPath = resolveWalletKekPath(walletAddress, homeDir);
  await mkdir(dirname(keyPath), { recursive: true });

  try {
    const existing = await readFile(keyPath);
    return { kek: parseStoredAes256Key(existing), keyPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const generated = randomBytesNode(32);
  await writeFile(keyPath, generated, { mode: 0o600 });
  return { kek: generated, keyPath };
}

type PreparedUploadPayload = {
  payload: UploadPayload;
  /** Set when the archive was small enough to buffer; null when using {@link encryptedTempPath}. */
  encryptedContent: Buffer | null;
  /** Encrypted ciphertext file (presigned path); remove after upload completes. */
  encryptedTempPath?: string;
};

async function prepareUploadPayload(
  archivePath: string,
  walletAddress: string,
  homeDir?: string,
): Promise<PreparedUploadPayload> {
  const archiveStat = await stat(archivePath);
  if (!archiveStat.isFile()) {
    throw new Error(`Cannot read backup archive: not a file (${archivePath}).`);
  }

  const { kek, keyPath } = await loadOrCreateKek(walletAddress, homeDir);
  const dek = randomBytesNode(32);
  const wrappedDek = encryptAesGcm(dek, kek);

  if (archiveStat.size >= NODE_FS_MAX_READFILE_BYTES) {
    const encryptedTempPath = join(tmpdir(), `mnemospark-upload-${randomUUID()}.enc`);
    try {
      await encryptPlaintextFileToAesGcmPath(archivePath, dek, encryptedTempPath);
      const encStat = await stat(encryptedTempPath);
      const payloadHash = await sha256File(encryptedTempPath);

      const payload: UploadPayload = {
        mode: "presigned",
        content_base64: undefined,
        content_sha256: payloadHash,
        content_length_bytes: encStat.size,
        wrapped_dek: wrappedDek.toString("base64"),
        encryption_algorithm: "AES-256-GCM",
        bucket_name_hint: bucketNameForWallet(walletAddress),
        key_store_path_hint: keyPath,
      };

      return {
        payload,
        encryptedContent: null,
        encryptedTempPath,
      };
    } catch (err) {
      await rm(encryptedTempPath, { force: true }).catch(() => {});
      throw err;
    }
  }

  const plaintext = await readFile(archivePath);
  const encryptedContent = encryptAesGcm(plaintext, dek);
  const payloadHash = sha256Buffer(encryptedContent);

  const payload: UploadPayload = {
    mode: encryptedContent.length <= INLINE_UPLOAD_MAX_BYTES ? "inline" : "presigned",
    content_base64:
      encryptedContent.length <= INLINE_UPLOAD_MAX_BYTES
        ? encryptedContent.toString("base64")
        : undefined,
    content_sha256: payloadHash,
    content_length_bytes: encryptedContent.length,
    wrapped_dek: wrappedDek.toString("base64"),
    encryption_algorithm: "AES-256-GCM",
    bucket_name_hint: bucketNameForWallet(walletAddress),
    key_store_path_hint: keyPath,
  };

  return {
    payload,
    encryptedContent,
  };
}

type PresignedPutFetchInit = RequestInit & { duplex?: "half" };

function presignedPutBodyInit(
  encryptedContent: Buffer | null,
  encryptedTempPath: string | undefined,
): { body: BodyInit; duplex?: "half" } {
  if (encryptedTempPath?.trim()) {
    const body = Readable.toWeb(createReadStream(encryptedTempPath)) as unknown as BodyInit;
    return { body, duplex: "half" };
  }
  if (encryptedContent) {
    return { body: new Uint8Array(encryptedContent) };
  }
  throw new Error("Cannot upload storage object: missing encrypted payload body.");
}

async function uploadPresignedObjectIfNeeded(
  uploadResponse: StorageUploadResponse,
  uploadMode: UploadPayload["mode"],
  encryptedContent: Buffer | null,
  encryptedTempPath: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!uploadResponse.upload_url) {
    if (uploadMode === "presigned") {
      throw new Error("Cannot upload storage object: missing presigned upload URL.");
    }
    return;
  }

  const headers = new Headers(uploadResponse.upload_headers ?? {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }

  const { body, duplex } = presignedPutBodyInit(encryptedContent, encryptedTempPath);
  const firstInit: PresignedPutFetchInit = {
    method: "PUT",
    headers,
    body,
    redirect: "manual",
  };
  if (duplex) {
    firstInit.duplex = duplex;
  }
  const firstAttempt = await fetchImpl(uploadResponse.upload_url, firstInit);

  if (firstAttempt.ok) {
    return;
  }

  // Some S3 presigned PUT URLs can return a temporary redirect (307/308)
  // when the request is sent to a non-regional endpoint. Retry once against
  // the Location target with the same signed query parameters.
  if (
    (firstAttempt.status === 307 || firstAttempt.status === 308) &&
    firstAttempt.headers.has("location")
  ) {
    const location = firstAttempt.headers.get("location")?.trim();
    if (location) {
      const retryBody = presignedPutBodyInit(encryptedContent, encryptedTempPath);
      const retryInit: PresignedPutFetchInit = {
        method: "PUT",
        headers,
        body: retryBody.body,
        redirect: "manual",
      };
      if (retryBody.duplex) {
        retryInit.duplex = retryBody.duplex;
      }
      const redirectedAttempt = await fetchImpl(location, retryInit);
      if (redirectedAttempt.ok) {
        return;
      }
      const redirectedDetails = (await redirectedAttempt.text()).trim();
      throw new Error(
        `Presigned upload failed after redirect with status ${redirectedAttempt.status}${redirectedDetails ? `: ${redirectedDetails}` : ""}`,
      );
    }
  }

  const details = (await firstAttempt.text()).trim();
  throw new Error(
    `Presigned upload failed with status ${firstAttempt.status}${details ? `: ${details}` : ""}`,
  );
}

function envMeansExplicitRemoveOrKeep(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const n = trimmed.toLowerCase();
  if (n === "0" || n === "false" || n === "no" || n === "n") {
    return false;
  }
  if (n === "1" || n === "true" || n === "yes" || n === "y") {
    return true;
  }
  return null;
}

function shouldRemoveLocalBackupAfterUpload(): boolean {
  const parsed = envMeansExplicitRemoveOrKeep(process.env.MNEMOSPARK_REMOVE_BACKUP_FILE);
  if (parsed !== null) {
    return parsed;
  }
  return true;
}

async function maybeCleanupLocalBackupArchive(archivePath: string): Promise<void> {
  if (!shouldRemoveLocalBackupAfterUpload()) {
    return;
  }
  try {
    await rm(archivePath, { force: true });
  } catch {
    // Best-effort cleanup; ignore failures.
  }
}

function formatStorageUploadUserMessage(upload: StorageUploadResponse, cronJobId: string): string {
  const lsLine = `/mnemospark_cloud ls --wallet-address \`${upload.addr}\``;
  return [
    `Your file \`${upload.object_id}\` with key \`${upload.object_key}\` has been stored using \`${upload.provider}\` in folder \`${upload.bucket_name}\` in region \`${upload.location}\``,
    "",
    `A cron job \`${cronJobId}\` has been configured to send renewal payment monthly (1st of the month, UTC), matching backend calendar billing. The object is skipped for deletion in its first UTC calendar month after upload; after that, if renewal is missing for a month, housekeeping may remove the object shortly after the 3rd (UTC).`,
    "",
    "To view your cloud storage run the command:",
    "",
    lsLine,
    "",
    "Thank you for using mnemospark!",
    `Reach out if you need anything: ${MNEMOSPARK_SUPPORT_EMAIL}`,
  ].join("\n");
}

function formatStorageDeleteUserMessage(
  objectKey: string,
  cronId: string | null,
  cronDeleted: boolean,
): string {
  const statusLine = cronId
    ? cronDeleted
      ? `File \`${objectKey}\` has been deleted from the cloud and the cron job \`${cronId}\` has been removed from local mnemospark cron tracking.`
      : `File \`${objectKey}\` has been deleted from the cloud and the cron job \`${cronId}\` was not found in local mnemospark cron tracking.`
    : `File \`${objectKey}\` has been deleted from the cloud and no matching cron job was found in local mnemospark cron tracking.`;

  return [statusLine, "Thank you for using mnemospark!"].join("\n");
}

function extractUploadErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message.trim();
  if (!message) {
    return null;
  }

  try {
    const payload = JSON.parse(message) as {
      message?: string;
      error?: { message?: string } | string;
    };
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error.trim();
    }
    if (
      payload.error &&
      typeof payload.error === "object" &&
      typeof payload.error.message === "string" &&
      payload.error.message.trim().length > 0
    ) {
      return payload.error.message.trim();
    }
  } catch {
    // Not JSON. Fall back to raw message.
  }

  return message;
}

function extractLsErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message.trim();
  if (!message) {
    return null;
  }
  if (
    message.startsWith("ls response") ||
    message.startsWith("ls list response") ||
    message.startsWith("Invalid ls response payload")
  ) {
    return `Cannot list storage object: ${message}`;
  }
  if (message === "formatBytesForDisplay expects a non-negative integer") {
    return "Cannot list storage object: ls response has invalid size_bytes; expected non-negative integer";
  }
  return null;
}

function formatPriceStorageUserMessage(
  quote: PriceStorageQuoteResponse,
  localArchiveHint?: string | null,
): string {
  const uploadLine = `/mnemospark_cloud upload --quote-id \`${quote.quote_id}\` --wallet-address \`${quote.addr}\` --object-id \`${quote.object_id}\` --object-id-hash \`${quote.object_id_hash}\``;
  const lines = [
    `Your storage quote \`${quote.quote_id}\`: storage price \`$${quote.storage_price}\` for file \`${quote.object_id}\` with file size \`${quote.object_size_gb}\` in \`${quote.provider}\` \`${quote.location}\`.`,
    "",
    "If you accept this quote, run:",
    "",
    uploadLine,
    "",
  ];
  if (localArchiveHint?.trim()) {
    lines.push(
      `Local backup archive uses friendly name \`${localArchiveHint.trim()}\` (on-disk basename is sanitized).`,
      "",
    );
  }
  lines.push(QUOTE_VALIDITY_USER_NOTE);
  return lines.join("\n");
}

function quoteLookupMatchesPriceStorageResponse(
  lookup: QuoteLookup,
  quote: PriceStorageQuoteResponse,
): boolean {
  return (
    lookup.quoteId === quote.quote_id &&
    lookup.walletAddress.trim().toLowerCase() === quote.addr.trim().toLowerCase() &&
    lookup.objectId === quote.object_id &&
    lookup.objectIdHash.toLowerCase() === quote.object_id_hash.toLowerCase() &&
    lookup.storagePrice === quote.storage_price &&
    lookup.provider === quote.provider &&
    lookup.location === quote.location
  );
}

/** Default provider/region for the copy-paste `price-storage` line after backup (single source of truth for docs/tests). */
export const DEFAULT_BACKUP_QUOTE_PROVIDER = "aws";
export const DEFAULT_BACKUP_QUOTE_REGION = "us-east-1";

function formatBackupSuccessUserMessage(
  result: BackupObjectResult,
  walletAddress: string,
  friendlyName: string,
): string {
  const hash = result.objectIdHash.replace(/\s/g, "");
  const priceStorageLine = `/mnemospark_cloud price-storage --wallet-address \`${walletAddress}\` --object-id \`${result.objectId}\` --object-id-hash \`${hash}\` --gb \`${result.objectSizeGb}\` --provider ${DEFAULT_BACKUP_QUOTE_PROVIDER} --region ${DEFAULT_BACKUP_QUOTE_REGION}`;
  return [
    `Backup archive: \`${result.archivePath}\``,
    "",
    `friendly-name: ${friendlyName}`,
    `object-id: ${result.objectId}`,
    `object-id-hash: ${hash}`,
    `object-size: ${result.objectSizeGb}`,
    "",
    "Next, request a storage quote.",
    "",
    priceStorageLine,
    "",
    `The default region is ${DEFAULT_BACKUP_QUOTE_REGION}. Change the command parameters to switch regions (not required).`,
    "",
    "Region examples (merge into the command above):",
    "North America: `--provider aws --region us-east-1`",
    "Europe: `--provider aws --region eu-north-1`",
    "South America: `--provider aws --region sa-east-1`",
    "Asia Pacific: `--provider aws --region ap-northeast-1`",
  ].join("\n");
}

function createInProcessSubagentOrchestrator(): MnemosparkSubagentOrchestrator {
  type SessionState = {
    terminal: boolean;
    cancelRequested: boolean;
    timeoutHandle?: NodeJS.Timeout;
    hooks?: MnemosparkSubagentDispatchHooks;
  };

  const sessions = new Map<string, SessionState>();

  const completeSession = async (
    sessionId: string,
    handler: (hooks?: MnemosparkSubagentDispatchHooks) => Promise<void> | void,
  ): Promise<boolean> => {
    const session = sessions.get(sessionId);
    if (!session || session.terminal) {
      return false;
    }
    session.terminal = true;
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }
    sessions.delete(sessionId);
    await handler(session.hooks);
    return true;
  };

  return {
    dispatch: async (input) => {
      const sessionId = `agent:mnemospark:subagent:${randomUUID()}`;
      const state: SessionState = {
        terminal: false,
        cancelRequested: false,
        hooks: input.hooks,
      };
      sessions.set(sessionId, state);

      if (typeof input.timeoutSeconds === "number" && input.timeoutSeconds > 0) {
        state.timeoutHandle = setTimeout(() => {
          void completeSession(sessionId, async (hooks) => {
            await hooks?.onTimedOut?.(sessionId);
          });
        }, input.timeoutSeconds * 1000);
      }

      setTimeout(() => {
        void (async () => {
          try {
            await input.hooks?.onRunning?.(sessionId);
            await input.hooks?.onProgress?.(sessionId, "subagent execution started");
            const result = await input.runTask();
            const session = sessions.get(sessionId);
            if (!session || session.terminal) {
              return;
            }
            if (session.cancelRequested) {
              await completeSession(sessionId, async (hooks) => {
                await hooks?.onCancelled?.(sessionId, "cancel requested");
              });
              return;
            }
            if (result.isError) {
              await completeSession(sessionId, async (hooks) => {
                await hooks?.onFailed?.(sessionId, {
                  code: "ASYNC_FAILED",
                  message: result.text,
                });
              });
              return;
            }
            await completeSession(sessionId, async (hooks) => {
              await hooks?.onCompleted?.(sessionId, result);
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const session = sessions.get(sessionId);
            if (!session || session.terminal) {
              return;
            }
            if (session.cancelRequested) {
              await completeSession(sessionId, async (hooks) => {
                await hooks?.onCancelled?.(sessionId, "cancel requested");
              });
              return;
            }
            await completeSession(sessionId, async (hooks) => {
              await hooks?.onFailed?.(sessionId, {
                code: "ASYNC_EXCEPTION",
                message,
              });
            });
          }
        })();
      }, 0);

      return { sessionId };
    },
    cancel: async (sessionId, reason) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { accepted: false };
      }
      if (session.terminal) {
        return { accepted: false, alreadyTerminal: true };
      }
      session.cancelRequested = true;
      await completeSession(sessionId, async (hooks) => {
        await hooks?.onCancelled?.(sessionId, reason ?? "cancel requested");
      });
      return { accepted: true };
    },
  };
}

export function createCloudCommand(
  options: CreateCloudCommandOptions = {},
): OpenClawPluginCommandDefinition {
  const subagentOrchestrator =
    options.subagentOrchestrator ?? createInProcessSubagentOrchestrator();
  return {
    name: "mnemospark_cloud",
    nativeNames: {
      default: "mnemospark_cloud",
    },
    description: "Manage mnemospark cloud storage workflow commands",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      try {
        return await runCloudCommandHandler(ctx, {
          buildBackupObjectFn: options.buildBackupObjectFn ?? buildBackupObject,
          requestPriceStorageQuoteFn:
            options.requestPriceStorageQuoteFn ?? requestPriceStorageViaProxy,
          requestStorageUploadFn: options.requestStorageUploadFn ?? requestStorageUploadViaProxy,
          requestStorageUploadConfirmFn:
            options.requestStorageUploadConfirmFn ?? requestStorageUploadConfirmViaProxy,
          resolveWalletKeyFn: options.resolveWalletPrivateKeyFn ?? resolveWalletPrivateKey,
          createPaymentFetchFn: options.createPaymentFetchFn ?? createPaymentFetch,
          fetchImpl: options.fetchImpl ?? fetch,
          nowDateFn: options.nowDateFn ?? (() => new Date()),
          idempotencyKeyFn: options.idempotencyKeyFn ?? randomUUID,
          requestStorageLsFn: options.requestStorageLsFn ?? requestStorageLsViaProxy,
          requestStorageDownloadFn:
            options.requestStorageDownloadFn ?? requestStorageDownloadViaProxy,
          requestStorageDeleteFn: options.requestStorageDeleteFn ?? requestStorageDeleteViaProxy,
          requestPaymentSettleViaProxyFn:
            options.requestPaymentSettleViaProxyFn ?? requestPaymentSettleViaProxy,
          mnemosparkHomeDir: options.mnemosparkHomeDir ?? options.backupOptions?.homeDir,
          openClawCronAdapter:
            options.openClawCronAdapter ??
            createOpenClawCliCronAdapter(
              options.mnemosparkHomeDir ?? options.backupOptions?.homeDir,
            ),
          backupOptions: options.backupOptions,
          proxyQuoteOptions: options.proxyQuoteOptions,
          proxyUploadOptions: options.proxyUploadOptions,
          proxySettleOptions: options.proxySettleOptions,
          proxyUploadConfirmOptions: options.proxyUploadConfirmOptions,
          subagentOrchestrator,
          proxyStorageOptions: options.proxyStorageOptions,
        });
      } catch (outerError) {
        const message =
          outerError instanceof Error
            ? outerError.message
            : typeof outerError === "string"
              ? outerError
              : "An unexpected error occurred";
        return { text: message.trim() || "An unexpected error occurred", isError: true };
      }
    },
  };
}

type RunCloudCommandHandlerOptions = {
  buildBackupObjectFn: NonNullable<CreateCloudCommandOptions["buildBackupObjectFn"]>;
  requestPriceStorageQuoteFn: NonNullable<CreateCloudCommandOptions["requestPriceStorageQuoteFn"]>;
  requestStorageUploadFn: NonNullable<CreateCloudCommandOptions["requestStorageUploadFn"]>;
  requestStorageUploadConfirmFn: NonNullable<
    CreateCloudCommandOptions["requestStorageUploadConfirmFn"]
  >;
  resolveWalletKeyFn: NonNullable<CreateCloudCommandOptions["resolveWalletPrivateKeyFn"]>;
  createPaymentFetchFn: NonNullable<CreateCloudCommandOptions["createPaymentFetchFn"]>;
  fetchImpl: NonNullable<CreateCloudCommandOptions["fetchImpl"]>;
  nowDateFn: NonNullable<CreateCloudCommandOptions["nowDateFn"]>;
  idempotencyKeyFn: NonNullable<CreateCloudCommandOptions["idempotencyKeyFn"]>;
  requestStorageLsFn: NonNullable<CreateCloudCommandOptions["requestStorageLsFn"]>;
  requestStorageDownloadFn: NonNullable<CreateCloudCommandOptions["requestStorageDownloadFn"]>;
  requestStorageDeleteFn: NonNullable<CreateCloudCommandOptions["requestStorageDeleteFn"]>;
  requestPaymentSettleViaProxyFn: NonNullable<
    CreateCloudCommandOptions["requestPaymentSettleViaProxyFn"]
  >;
  openClawCronAdapter: NonNullable<CreateCloudCommandOptions["openClawCronAdapter"]>;
  mnemosparkHomeDir: string | undefined;
  backupOptions: CreateCloudCommandOptions["backupOptions"];
  proxyQuoteOptions: CreateCloudCommandOptions["proxyQuoteOptions"];
  proxyUploadOptions: CreateCloudCommandOptions["proxyUploadOptions"];
  proxySettleOptions: CreateCloudCommandOptions["proxySettleOptions"];
  proxyUploadConfirmOptions: CreateCloudCommandOptions["proxyUploadConfirmOptions"];
  subagentOrchestrator: MnemosparkSubagentOrchestrator;
  proxyStorageOptions: CreateCloudCommandOptions["proxyStorageOptions"];
};

type RunCloudCommandExecutionContext = {
  forcedOperationId?: string;
  forcedTraceId?: string;
};

async function resolveNameSelectorIfNeeded(
  datastore: Awaited<ReturnType<typeof createCloudDatastore>>,
  request: StorageObjectRequestInput,
  selector?: NameSelector,
): Promise<{
  request?: StorageObjectRequest | StorageLsRequest;
  error?: string;
}> {
  if (!selector) {
    const walletAddress = request.wallet_address?.trim();
    if (!walletAddress) {
      return { error: "Cannot resolve storage object request." };
    }
    const objectKey = request.object_key?.trim();
    if (!objectKey) {
      const listRequest: StorageLsRequest = { wallet_address: walletAddress };
      if (request.location) {
        listRequest.location = request.location;
      }
      return { request: listRequest };
    }
    const parsedRequest = parseStorageObjectRequest({
      wallet_address: walletAddress,
      object_key: objectKey,
      location: request.location,
    });
    if (!parsedRequest) {
      return { error: "Cannot resolve storage object request." };
    }
    return { request: parsedRequest };
  }
  try {
    await datastore.ensureReady();
  } catch {
    return {
      error:
        "Cannot resolve --name: local SQLite (~/.openclaw/mnemospark/state.db) is unavailable. Use --object-key or restore SQLite access.",
    };
  }
  const matches = await datastore.countFriendlyNameMatches(request.wallet_address, selector.name);
  if (matches > 1 && !selector.latest && !selector.at) {
    return {
      error: `Multiple objects match --name ${selector.name}. Add --latest or --at <timestamp>.`,
    };
  }

  const resolved = await datastore.resolveFriendlyName({
    walletAddress: request.wallet_address,
    friendlyName: selector.name,
    latest: selector.latest,
    at: selector.at,
  });

  const resolvedObjectKey = resolved?.objectKey ?? null;

  if (!resolvedObjectKey) {
    return { error: `No object found for --name ${selector.name}.` };
  }

  const parsedRequest = parseStorageObjectRequest({
    ...request,
    object_key: resolvedObjectKey,
  });
  if (!parsedRequest) {
    return { error: "Cannot resolve storage object request." };
  }
  return { request: parsedRequest };
}

function toStorageObjectRequestOrError(
  request: StorageObjectRequest | StorageLsRequest,
  missingKeyMessage: string,
): { ok: true; request: StorageObjectRequest } | { ok: false; error: string } {
  const key = request.object_key?.trim();
  if (!key) {
    return { ok: false, error: missingKeyMessage };
  }
  const parsed = parseStorageObjectRequest({
    wallet_address: request.wallet_address,
    object_key: key,
    location: request.location,
  });
  if (!parsed) {
    return { ok: false, error: "Cannot resolve storage object request." };
  }
  return { ok: true, request: parsed };
}

async function emitCloudEvent(
  eventType: string,
  details: Record<string, unknown>,
  homeDir?: string,
): Promise<void> {
  await appendJsonlEvent(
    "events.jsonl",
    {
      ...details,
      ts: new Date().toISOString(),
      event_type: eventType,
      source: "command",
    },
    homeDir,
  );
}

async function emitCloudEventBestEffort(
  eventType: string,
  details: Record<string, unknown>,
  homeDir?: string,
): Promise<void> {
  try {
    await emitCloudEvent(eventType, details, homeDir);
  } catch {
    // Event logging is non-critical and must not affect command results.
  }
}

type OperationEventContext = {
  operationId: string;
  traceId: string;
  status: string;
  walletAddress?: string | null;
  objectId?: string | null;
  objectKey?: string | null;
  quoteId?: string | null;
  orchestrator?: OrchestratorMode | null;
  subagentSessionId?: string | null;
  timeoutSeconds?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  progressMessage?: string | null;
};

function toOperationEventPayload(
  eventType: string,
  context: OperationEventContext,
): Record<string, unknown> {
  return {
    operation_id: context.operationId,
    trace_id: context.traceId,
    event_type: eventType,
    status: context.status,
    source: "command",
    ts: new Date().toISOString(),
    wallet_address: context.walletAddress ?? undefined,
    object_id: context.objectId ?? undefined,
    object_key: context.objectKey ?? undefined,
    quote_id: context.quoteId ?? undefined,
    orchestrator: context.orchestrator ?? undefined,
    "subagent-session-id": context.subagentSessionId ?? undefined,
    "timeout-seconds": context.timeoutSeconds ?? undefined,
    "error-code": context.errorCode ?? undefined,
    "error-message": context.errorMessage ?? undefined,
    progress: context.progressMessage ?? undefined,
  };
}

async function emitOperationEvent(
  eventType: string,
  context: OperationEventContext,
  homeDir?: string,
): Promise<void> {
  const payload = toOperationEventPayload(eventType, context);
  await appendJsonlEvent("events.jsonl", payload, homeDir);
}

async function emitOperationEventBestEffort(
  eventType: string,
  context: OperationEventContext,
  homeDir?: string,
): Promise<void> {
  try {
    await emitOperationEvent(eventType, context, homeDir);
  } catch {
    // Operation event logging is best-effort only.
  }
}

function buildRequestCorrelation(
  forcedOperationId?: string,
  forcedTraceId?: string,
): Required<RequestCorrelation> {
  const operationId = forcedOperationId?.trim() || randomUUID();
  const traceId = forcedTraceId?.trim() || randomUUID();
  return { operationId, traceId };
}

function parseTransIdFromPaymentSettleBody(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { trans_id?: unknown };
    const tid = parsed.trans_id;
    return typeof tid === "string" && tid.trim() ? tid.trim() : null;
  } catch {
    return null;
  }
}

function parseQuoteIdFromPaymentSettleBody(bodyText: string): string | null {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { quote_id?: unknown };
    const q = parsed.quote_id;
    return typeof q === "string" && q.trim() ? q.trim() : null;
  } catch {
    return null;
  }
}

async function resolveAmountForPaymentSettle(
  quoteId: string | undefined,
  storagePriceFromFlag: number | undefined,
  datastore: Awaited<ReturnType<typeof createCloudDatastore>>,
): Promise<number> {
  if (storagePriceFromFlag !== undefined && Number.isFinite(storagePriceFromFlag)) {
    return storagePriceFromFlag;
  }
  if (!quoteId) {
    return 0;
  }
  const quoteLookup = await datastore.findQuoteById(quoteId);
  if (quoteLookup && Number.isFinite(quoteLookup.storagePrice)) {
    return quoteLookup.storagePrice;
  }
  const payment = await datastore.findPaymentByQuoteId(quoteId);
  if (payment && Number.isFinite(payment.amount)) {
    return payment.amount;
  }
  return 0;
}

async function resolveCronRowForPaymentSettle(
  req: PaymentSettleCommandRequest,
  datastore: Awaited<ReturnType<typeof createCloudDatastore>>,
): Promise<CronJobRow | null> {
  if (req.renewal) {
    const key = req.object_key?.trim();
    if (!key) {
      return null;
    }
    return datastore.findCronJobRowByObjectKey(key);
  }
  const qid = req.quote_id?.trim();
  if (!qid) {
    return null;
  }
  return datastore.findCronByQuoteId(qid);
}

async function emitPaymentSettleClientObservationBestEffort(params: {
  phase: "start" | "result";
  correlation: RequestCorrelation;
  quoteId: string;
  walletAddress: string;
  objectId?: string;
  objectKey?: string;
  httpStatus?: number;
  outcomeStatus?: "succeeded" | "failed";
  homeDir?: string;
}): Promise<void> {
  try {
    const {
      phase,
      correlation,
      quoteId,
      walletAddress,
      objectId,
      objectKey,
      httpStatus,
      outcomeStatus,
      homeDir,
    } = params;
    const ts = new Date().toISOString();

    if (phase === "start") {
      await emitCloudEventBestEffort(
        "payment-settle.started",
        {
          operation_id: correlation.operationId,
          trace_id: correlation.traceId,
          quote_id: quoteId,
          wallet_address: walletAddress,
          object_id: objectId,
          object_key: objectKey,
          status: "running",
        },
        homeDir,
      );
      await appendJsonlEvent(
        "events.jsonl",
        {
          ts,
          event_type: "payment.settle",
          status: "start",
          source: "command",
          trace_id: correlation.traceId,
          operation_id: correlation.operationId,
          quote_id: quoteId,
          wallet_address: walletAddress,
          object_id: objectId ?? null,
          object_key: objectKey ?? null,
          details: { client_observation: true },
        },
        homeDir,
      );
      return;
    }

    const terminal = outcomeStatus ?? "failed";
    await emitCloudEventBestEffort(
      "payment-settle.completed",
      {
        operation_id: correlation.operationId,
        trace_id: correlation.traceId,
        quote_id: quoteId,
        wallet_address: walletAddress,
        object_id: objectId,
        object_key: objectKey,
        status: terminal === "succeeded" ? "succeeded" : "failed",
        http_status: httpStatus,
      },
      homeDir,
    );
    await appendJsonlEvent(
      "events.jsonl",
      {
        ts,
        event_type: "payment.settle",
        status: "result",
        source: "command",
        trace_id: correlation.traceId,
        operation_id: correlation.operationId,
        quote_id: quoteId,
        wallet_address: walletAddress,
        object_id: objectId ?? null,
        object_key: objectKey ?? null,
        http_status: httpStatus ?? null,
        details: { client_observation: true },
      },
      homeDir,
    );
  } catch {
    // best-effort only
  }
}

async function runCloudCommandHandler(
  ctx: { args?: string; channel?: string; senderId?: string },
  options: RunCloudCommandHandlerOptions,
  executionContext: RunCloudCommandExecutionContext = {},
): Promise<{ text: string; isError?: boolean }> {
  const parsed = parseCloudArgs(ctx.args);
  const mnemosparkHomeDir = options.mnemosparkHomeDir;
  const backupBuilder = options.buildBackupObjectFn;
  const requestPriceStorageQuote = options.requestPriceStorageQuoteFn;
  const requestStorageUpload = options.requestStorageUploadFn;
  const requestStorageUploadConfirm = options.requestStorageUploadConfirmFn;
  const resolveWalletKey = options.resolveWalletKeyFn;
  const createPayment = options.createPaymentFetchFn;
  const fetchImpl = options.fetchImpl;
  const nowDateFn = options.nowDateFn;
  const idempotencyKeyFn = options.idempotencyKeyFn;
  const requestStorageLs = options.requestStorageLsFn;
  const requestStorageDownload = options.requestStorageDownloadFn;
  const requestStorageDelete = options.requestStorageDeleteFn;
  const requestPaymentSettleViaProxy = options.requestPaymentSettleViaProxyFn;
  const openClawCronAdapter = options.openClawCronAdapter;
  const subagentOrchestrator = options.subagentOrchestrator;

  if (parsed.mode === "help" || parsed.mode === "unknown") {
    return {
      text: CLOUD_HELP_TEXT,
      isError: parsed.mode === "unknown",
    };
  }

  if (parsed.mode === "price-storage-invalid") {
    return {
      text: `Cannot price storage: required arguments are ${REQUIRED_PRICE_STORAGE}.`,
      isError: true,
    };
  }

  if (parsed.mode === "backup-invalid") {
    return {
      text: "Cannot build storage object",
      isError: true,
    };
  }

  if (parsed.mode === "backup-invalid-async") {
    return {
      text: `Cannot build storage object: ${INVALID_ASYNC_FLAGS_MESSAGE}`,
      isError: true,
    };
  }

  if (parsed.mode === "backup-invalid-name") {
    return {
      text: `Cannot build storage object: required arguments are ${REQUIRED_BACKUP}.`,
      isError: true,
    };
  }

  if (parsed.mode === "upload-invalid") {
    return {
      text: `Cannot upload storage object: required arguments are ${REQUIRED_UPLOAD}.`,
      isError: true,
    };
  }

  if (parsed.mode === "upload-invalid-async") {
    return {
      text: `Cannot upload storage object: ${INVALID_ASYNC_FLAGS_MESSAGE}`,
      isError: true,
    };
  }

  if (parsed.mode === "payment-settle-invalid") {
    return {
      text: `Cannot settle payment: required arguments are ${REQUIRED_PAYMENT_SETTLE}. Optional: --object-id, --storage-price.`,
      isError: true,
    };
  }

  if (parsed.mode === "ls-invalid") {
    return {
      text: `Cannot list storage object: required arguments are ${REQUIRED_LS}.`,
      isError: true,
    };
  }

  if (parsed.mode === "download-invalid") {
    return {
      text: `Cannot download file: required arguments are ${REQUIRED_STORAGE_OBJECT}.`,
      isError: true,
    };
  }

  if (parsed.mode === "download-invalid-async") {
    return {
      text: `Cannot download file: ${INVALID_ASYNC_FLAGS_MESSAGE}`,
      isError: true,
    };
  }

  if (parsed.mode === "delete-invalid") {
    return {
      text: `Cannot delete file: required arguments are ${REQUIRED_STORAGE_OBJECT}.`,
      isError: true,
    };
  }

  if (parsed.mode === "op-status-invalid") {
    return {
      text: "Cannot get operation status: required arguments are --operation-id.",
      isError: true,
    };
  }

  const datastore = await createCloudDatastore(mnemosparkHomeDir);
  const terminalOperationStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
  const isTerminalOperationStatus = (status: string): boolean =>
    terminalOperationStatuses.has(status);
  const formatOperationStatus = (operation: {
    operation_id: string;
    type: string;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    orchestrator: string | null;
    subagent_session_id: string | null;
    timeout_seconds: number | null;
    error_code: string | null;
    error_message: string | null;
    result_text: string | null;
  }): { text: string; isError: boolean } => {
    const meta = [
      `operation-id: ${operation.operation_id}`,
      `type: ${operation.type}`,
      `status: ${operation.status}`,
      `started-at: ${operation.started_at ?? "n/a"}`,
      `finished-at: ${operation.finished_at ?? "n/a"}`,
      operation.orchestrator ? `orchestrator: ${operation.orchestrator}` : null,
      operation.subagent_session_id
        ? `subagent-session-id: ${operation.subagent_session_id}`
        : null,
      operation.timeout_seconds ? `timeout-seconds: ${operation.timeout_seconds}` : null,
      operation.error_code ? `error-code: ${operation.error_code}` : null,
      operation.error_message ? `error-message: ${operation.error_message}` : null,
    ]
      .filter((v): v is string => Boolean(v))
      .join("\n");
    const withResult =
      operation.status === "succeeded" && operation.result_text?.trim()
        ? `${meta}\n\n${operation.result_text}`
        : meta;
    return {
      text: withResult,
      isError:
        operation.status === "failed" ||
        operation.status === "cancelled" ||
        operation.status === "timed_out",
    };
  };

  if (parsed.mode === "op-status") {
    let operation = await datastore.findOperationById(parsed.operationId);
    if (!operation) {
      return {
        text: `Operation not found: ${parsed.operationId}`,
        isError: true,
      };
    }

    if (parsed.cancel) {
      if (operation.orchestrator !== "subagent" || !operation.subagent_session_id) {
        return {
          text: "Cancellation is only supported for subagent-orchestrated operations.",
          isError: true,
        };
      }
      if (!isTerminalOperationStatus(operation.status)) {
        const traceId = operation.trace_id ?? randomUUID();
        const cancelRequestedAt = new Date().toISOString();
        await datastore.upsertOperation({
          operation_id: operation.operation_id,
          type: operation.type,
          object_id: operation.object_id,
          quote_id: operation.quote_id,
          trace_id: traceId,
          orchestrator: "subagent",
          subagent_session_id: operation.subagent_session_id,
          timeout_seconds: operation.timeout_seconds,
          cancel_requested_at: cancelRequestedAt,
          status: "running",
          error_code: null,
          error_message: null,
        });
        await emitOperationEventBestEffort(
          "operation.cancel.requested",
          {
            operationId: operation.operation_id,
            traceId,
            status: "running",
            objectId: operation.object_id,
            quoteId: operation.quote_id,
            orchestrator: "subagent",
            subagentSessionId: operation.subagent_session_id,
            timeoutSeconds: operation.timeout_seconds,
          },
          mnemosparkHomeDir,
        );

        const cancelResult = await subagentOrchestrator.cancel(
          operation.subagent_session_id,
          "cancel requested by op-status",
        );
        if (cancelResult.accepted || cancelResult.alreadyTerminal) {
          const afterCancel = await datastore.findOperationById(parsed.operationId);
          if (afterCancel && !isTerminalOperationStatus(afterCancel.status)) {
            await datastore.upsertOperation({
              operation_id: operation.operation_id,
              type: operation.type,
              object_id: operation.object_id,
              quote_id: operation.quote_id,
              trace_id: traceId,
              orchestrator: "subagent",
              subagent_session_id: operation.subagent_session_id,
              timeout_seconds: operation.timeout_seconds,
              cancel_requested_at: cancelRequestedAt,
              status: "cancelled",
              error_code: "ASYNC_CANCELLED",
              error_message: "Operation cancelled by user request.",
            });
            await emitOperationEventBestEffort(
              "operation.cancelled",
              {
                operationId: operation.operation_id,
                traceId,
                status: "cancelled",
                objectId: operation.object_id,
                quoteId: operation.quote_id,
                orchestrator: "subagent",
                subagentSessionId: operation.subagent_session_id,
                timeoutSeconds: operation.timeout_seconds,
                errorCode: "ASYNC_CANCELLED",
                errorMessage: "Operation cancelled by user request.",
              },
              mnemosparkHomeDir,
            );
          }
        }
      }
      operation = await datastore.findOperationById(parsed.operationId);
      if (!operation) {
        return {
          text: `Operation not found: ${parsed.operationId}`,
          isError: true,
        };
      }
    }
    return formatOperationStatus(operation);
  }

  if (parsed.mode === "payment-settle") {
    const req = parsed.paymentSettleRequest;
    let walletKey: `0x${string}`;
    try {
      walletKey = await resolveWalletKey(mnemosparkHomeDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { text: message.trim() || "Cannot resolve wallet key.", isError: true };
    }
    const walletAccount = privateKeyToAccount(walletKey);
    if (walletAccount.address.toLowerCase() !== req.wallet_address.toLowerCase()) {
      return {
        text: `Cannot settle payment: wallet key address ${walletAccount.address} does not match --wallet-address ${req.wallet_address}.`,
        isError: true,
      };
    }

    const correlation = buildRequestCorrelation();
    const settleFetch = createPayment(walletKey).fetch;
    const objectId = req.object_id;
    const objectKey = req.object_key;
    const logQuoteId =
      req.quote_id?.trim() ||
      (req.renewal && objectKey?.trim() ? `renewal:${objectKey.trim()}` : "");

    await emitPaymentSettleClientObservationBestEffort({
      phase: "start",
      correlation,
      quoteId: logQuoteId,
      walletAddress: req.wallet_address,
      objectId,
      objectKey,
      homeDir: mnemosparkHomeDir,
    });

    let settleResult: BackendSettleForwardResult;
    try {
      settleResult = await requestPaymentSettleViaProxy(req.quote_id ?? "", req.wallet_address, {
        ...options.proxySettleOptions,
        correlation,
        fetchImpl: (input, init) => settleFetch(input, init),
        renewal: req.renewal === true,
        objectKey: req.object_key,
      });
    } catch (err) {
      const amountErr = await resolveAmountForPaymentSettle(
        req.quote_id,
        req.storage_price,
        datastore,
      );
      await datastore.upsertPayment({
        quote_id: logQuoteId || req.quote_id?.trim() || "payment-settle-error",
        wallet_address: req.wallet_address,
        trans_id: null,
        amount: amountErr,
        network: null,
        status: "settle_failed",
        settled_at: null,
      });
      const cronErr = await resolveCronRowForPaymentSettle(req, datastore);
      if (cronErr) {
        await datastore.upsertCronJob({ ...cronErr, status: "active" });
      }
      const msg = err instanceof Error ? err.message : String(err);
      await emitPaymentSettleClientObservationBestEffort({
        phase: "result",
        correlation,
        quoteId: logQuoteId,
        walletAddress: req.wallet_address,
        objectId,
        objectKey,
        outcomeStatus: "failed",
        homeDir: mnemosparkHomeDir,
      });
      return { text: `Payment settle failed: ${msg}`, isError: true };
    }

    const ledgerQuoteIdFromBody = parseQuoteIdFromPaymentSettleBody(settleResult.bodyText ?? "");
    const ledgerQuoteId = ledgerQuoteIdFromBody || req.quote_id?.trim() || logQuoteId;
    const amount = await resolveAmountForPaymentSettle(
      req.renewal ? undefined : req.quote_id,
      req.storage_price,
      datastore,
    );
    const transId =
      settleResult.status === 200
        ? parseTransIdFromPaymentSettleBody(settleResult.bodyText ?? "")
        : null;

    if (settleResult.status === 200) {
      await datastore.upsertPayment({
        quote_id: ledgerQuoteId,
        wallet_address: req.wallet_address,
        trans_id: transId,
        amount,
        network: null,
        status: "settled",
        settled_at: new Date().toISOString(),
      });
      const cronRow = await resolveCronRowForPaymentSettle(req, datastore);
      if (cronRow) {
        await datastore.upsertCronJob({ ...cronRow, status: "active" });
      }
      await emitPaymentSettleClientObservationBestEffort({
        phase: "result",
        correlation,
        quoteId: ledgerQuoteId,
        walletAddress: req.wallet_address,
        objectId,
        objectKey,
        httpStatus: settleResult.status,
        outcomeStatus: "succeeded",
        homeDir: mnemosparkHomeDir,
      });
      const label = req.renewal ? `object ${req.object_key}` : `quote ${req.quote_id}`;
      return {
        text: transId
          ? `Payment settled for ${label} (trans_id: ${transId}).`
          : `Payment settled for ${label}.`,
      };
    }

    await datastore.upsertPayment({
      quote_id: ledgerQuoteId,
      wallet_address: req.wallet_address,
      trans_id: transId,
      amount,
      network: null,
      status: "settle_failed",
      settled_at: null,
    });
    const cronRowFailed = await resolveCronRowForPaymentSettle(req, datastore);
    if (cronRowFailed) {
      await datastore.upsertCronJob({ ...cronRowFailed, status: "active" });
    }
    await emitPaymentSettleClientObservationBestEffort({
      phase: "result",
      correlation,
      quoteId: ledgerQuoteId,
      walletAddress: req.wallet_address,
      objectId,
      objectKey,
      httpStatus: settleResult.status,
      outcomeStatus: "failed",
      homeDir: mnemosparkHomeDir,
    });

    const bodySnippet = settleResult.bodyText?.trim();
    const detail =
      bodySnippet && bodySnippet.length > 500 ? `${bodySnippet.slice(0, 500)}…` : bodySnippet;
    return {
      text: detail
        ? `Payment settle failed (HTTP ${settleResult.status}): ${detail}`
        : `Payment settle failed with HTTP ${settleResult.status}.`,
      isError: true,
    };
  }

  if (
    (parsed.mode === "backup" || parsed.mode === "upload" || parsed.mode === "download") &&
    parsed.async
  ) {
    const asyncCorrelation = buildRequestCorrelation();
    const operationId = asyncCorrelation.operationId;
    const opType = parsed.mode;
    const opObject = parsed.mode === "upload" ? parsed.uploadRequest.object_id : null;
    const opQuote = parsed.mode === "upload" ? parsed.uploadRequest.quote_id : null;
    const orchestratorMode = parsed.orchestrator ?? "inline";
    const timeoutSeconds = orchestratorMode === "subagent" ? (parsed.timeoutSeconds ?? null) : null;
    const eventContextBase: Omit<OperationEventContext, "status"> = {
      operationId,
      traceId: asyncCorrelation.traceId,
      walletAddress:
        parsed.mode === "upload"
          ? parsed.uploadRequest.wallet_address
          : parsed.mode === "download"
            ? parsed.storageObjectRequest.wallet_address
            : null,
      objectId: opObject,
      objectKey:
        parsed.mode === "download" ? (parsed.storageObjectRequest.object_key ?? null) : null,
      quoteId: opQuote,
      orchestrator: orchestratorMode,
      timeoutSeconds,
    };
    await datastore.upsertOperation({
      operation_id: operationId,
      type: opType,
      object_id: opObject,
      quote_id: opQuote,
      trace_id: asyncCorrelation.traceId,
      orchestrator: orchestratorMode,
      timeout_seconds: timeoutSeconds,
      status: "started",
      error_code: null,
      error_message: null,
    });

    await emitOperationEventBestEffort(
      "operation.dispatched",
      { ...eventContextBase, status: "started" },
      mnemosparkHomeDir,
    );

    const syncArgs = stripAsyncControlFlags(ctx.args);
    if (orchestratorMode === "subagent") {
      const subagentTask: MnemosparkSubagentTaskV1 = {
        schema: "mnemospark.subagent-task.v1",
        operationId,
        traceId: asyncCorrelation.traceId,
        command: parsed.mode,
        args: syncArgs,
        timeoutSeconds: parsed.timeoutSeconds,
        requestedBy: {
          pluginCommand: "mnemospark_cloud",
          chatId: ctx.channel,
          senderId: ctx.senderId,
        },
      };
      try {
        const dispatchResult = await subagentOrchestrator.dispatch({
          task: subagentTask,
          timeoutSeconds: parsed.timeoutSeconds,
          runTask: async () =>
            runCloudCommandHandler(
              { args: syncArgs, channel: ctx.channel, senderId: ctx.senderId },
              options,
              {
                forcedOperationId: asyncCorrelation.operationId,
                forcedTraceId: asyncCorrelation.traceId,
              },
            ),
          hooks: {
            onRunning: async (sessionId) => {
              await datastore.upsertOperation({
                operation_id: operationId,
                type: opType,
                object_id: opObject,
                quote_id: opQuote,
                trace_id: asyncCorrelation.traceId,
                orchestrator: "subagent",
                subagent_session_id: sessionId,
                timeout_seconds: timeoutSeconds,
                status: "running",
                error_code: null,
                error_message: null,
              });
              await emitOperationEventBestEffort(
                "operation.progress",
                {
                  ...eventContextBase,
                  status: "running",
                  subagentSessionId: sessionId,
                  progressMessage: "subagent running",
                },
                mnemosparkHomeDir,
              );
            },
            onProgress: async (sessionId, message) => {
              await emitOperationEventBestEffort(
                "operation.progress",
                {
                  ...eventContextBase,
                  status: "running",
                  subagentSessionId: sessionId,
                  progressMessage: message,
                },
                mnemosparkHomeDir,
              );
            },
            onCompleted: async (sessionId, result) => {
              await datastore.upsertOperation({
                operation_id: operationId,
                type: opType,
                object_id: opObject,
                quote_id: opQuote,
                trace_id: asyncCorrelation.traceId,
                orchestrator: "subagent",
                subagent_session_id: sessionId,
                timeout_seconds: timeoutSeconds,
                status: "succeeded",
                error_code: null,
                error_message: null,
                result_text: result.isError ? null : result.text,
              });
              await emitOperationEventBestEffort(
                "operation.completed",
                {
                  ...eventContextBase,
                  status: "succeeded",
                  subagentSessionId: sessionId,
                },
                mnemosparkHomeDir,
              );
            },
            onFailed: async (sessionId, details) => {
              await datastore.upsertOperation({
                operation_id: operationId,
                type: opType,
                object_id: opObject,
                quote_id: opQuote,
                trace_id: asyncCorrelation.traceId,
                orchestrator: "subagent",
                subagent_session_id: sessionId,
                timeout_seconds: timeoutSeconds,
                status: "failed",
                error_code: details.code,
                error_message: details.message,
              });
              await emitOperationEventBestEffort(
                "operation.completed",
                {
                  ...eventContextBase,
                  status: "failed",
                  subagentSessionId: sessionId,
                  errorCode: details.code,
                  errorMessage: details.message,
                },
                mnemosparkHomeDir,
              );
            },
            onCancelled: async (sessionId, reason) => {
              await datastore.upsertOperation({
                operation_id: operationId,
                type: opType,
                object_id: opObject,
                quote_id: opQuote,
                trace_id: asyncCorrelation.traceId,
                orchestrator: "subagent",
                subagent_session_id: sessionId,
                timeout_seconds: timeoutSeconds,
                cancel_requested_at: new Date().toISOString(),
                status: "cancelled",
                error_code: "ASYNC_CANCELLED",
                error_message: reason ?? "Operation cancelled.",
              });
              await emitOperationEventBestEffort(
                "operation.cancelled",
                {
                  ...eventContextBase,
                  status: "cancelled",
                  subagentSessionId: sessionId,
                  errorCode: "ASYNC_CANCELLED",
                  errorMessage: reason ?? "Operation cancelled.",
                },
                mnemosparkHomeDir,
              );
            },
            onTimedOut: async (sessionId) => {
              await datastore.upsertOperation({
                operation_id: operationId,
                type: opType,
                object_id: opObject,
                quote_id: opQuote,
                trace_id: asyncCorrelation.traceId,
                orchestrator: "subagent",
                subagent_session_id: sessionId,
                timeout_seconds: timeoutSeconds,
                status: "timed_out",
                error_code: "ASYNC_TIMEOUT",
                error_message: "Operation timed out.",
              });
              await emitOperationEventBestEffort(
                "operation.timed_out",
                {
                  ...eventContextBase,
                  status: "timed_out",
                  subagentSessionId: sessionId,
                  errorCode: "ASYNC_TIMEOUT",
                  errorMessage: "Operation timed out.",
                },
                mnemosparkHomeDir,
              );
            },
          },
        });

        const operationAfterDispatch = await datastore.findOperationById(operationId);
        if (operationAfterDispatch?.subagent_session_id !== dispatchResult.sessionId) {
          await datastore.upsertOperation({
            operation_id: operationId,
            type: opType,
            object_id: opObject,
            quote_id: opQuote,
            trace_id: asyncCorrelation.traceId,
            orchestrator: "subagent",
            subagent_session_id: dispatchResult.sessionId,
            timeout_seconds: timeoutSeconds,
            status: operationAfterDispatch?.status ?? "started",
            error_code: operationAfterDispatch?.error_code ?? null,
            error_message: operationAfterDispatch?.error_message ?? null,
          });
        }

        return {
          text: [
            `Operation started in background. operation-id: ${operationId}`,
            `orchestrator: subagent`,
            `subagent-session-id: ${dispatchResult.sessionId}`,
            timeoutSeconds ? `timeout-seconds: ${timeoutSeconds}` : null,
            `Use /mnemospark_cloud op-status --operation-id ${operationId}`,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
        };
      } catch (dispatchError) {
        const dispatchMessage =
          dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        await datastore.upsertOperation({
          operation_id: operationId,
          type: opType,
          object_id: opObject,
          quote_id: opQuote,
          trace_id: asyncCorrelation.traceId,
          orchestrator: "subagent",
          timeout_seconds: timeoutSeconds,
          status: "failed",
          error_code: "ASYNC_DISPATCH_FAILED",
          error_message: dispatchMessage,
        });
        await emitOperationEventBestEffort(
          "operation.completed",
          {
            ...eventContextBase,
            status: "failed",
            errorCode: "ASYNC_DISPATCH_FAILED",
            errorMessage: dispatchMessage,
          },
          mnemosparkHomeDir,
        );
        return {
          text: `Cannot dispatch subagent operation: ${dispatchMessage}\noperation-id: ${operationId}`,
          isError: true,
        };
      }
    }

    await datastore.upsertOperation({
      operation_id: operationId,
      type: opType,
      object_id: opObject,
      quote_id: opQuote,
      trace_id: asyncCorrelation.traceId,
      orchestrator: "inline",
      status: "running",
      error_code: null,
      error_message: null,
    });
    void runCloudCommandHandler(
      { args: syncArgs, channel: ctx.channel, senderId: ctx.senderId },
      options,
      {
        forcedOperationId: asyncCorrelation.operationId,
        forcedTraceId: asyncCorrelation.traceId,
      },
    )
      .then(async (result) => {
        await datastore.upsertOperation({
          operation_id: operationId,
          type: opType,
          object_id: opObject,
          quote_id: opQuote,
          trace_id: asyncCorrelation.traceId,
          orchestrator: "inline",
          status: result.isError ? "failed" : "succeeded",
          error_code: result.isError ? "ASYNC_FAILED" : null,
          error_message: result.isError ? result.text : null,
          result_text: result.isError ? null : result.text,
        });
        await emitOperationEventBestEffort(
          "operation.completed",
          {
            ...eventContextBase,
            status: result.isError ? "failed" : "succeeded",
            errorCode: result.isError ? "ASYNC_FAILED" : null,
            errorMessage: result.isError ? result.text : null,
          },
          mnemosparkHomeDir,
        );
      })
      .catch(async (err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await datastore.upsertOperation({
          operation_id: operationId,
          type: opType,
          object_id: opObject,
          quote_id: opQuote,
          trace_id: asyncCorrelation.traceId,
          orchestrator: "inline",
          status: "failed",
          error_code: "ASYNC_EXCEPTION",
          error_message: errorMessage,
        });
        await emitOperationEventBestEffort(
          "operation.completed",
          {
            ...eventContextBase,
            status: "failed",
            errorCode: "ASYNC_EXCEPTION",
            errorMessage,
          },
          mnemosparkHomeDir,
        );
      });

    return {
      text: [
        `Operation started in background. operation-id: ${operationId}`,
        `orchestrator: inline`,
        `Use /mnemospark_cloud op-status --operation-id ${operationId}`,
      ].join("\n"),
    };
  }

  if (parsed.mode === "backup") {
    const backupPlatform = options.backupOptions?.platform ?? process.platform;
    if (!SUPPORTED_BACKUP_PLATFORMS.has(backupPlatform)) {
      return {
        text: "Cloud backup is only supported on macOS and Linux.",
        isError: true,
      };
    }

    try {
      let walletAddress: string;
      try {
        const walletKey = await resolveWalletKey(mnemosparkHomeDir);
        walletAddress = privateKeyToAccount(walletKey).address;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
        return {
          text: message.trim() || "No mnemospark wallet found.",
          isError: true,
        };
      }

      let archiveBasename: string;
      try {
        archiveBasename = sanitizeFriendlyNameForLocalBasename(parsed.friendlyName);
      } catch {
        return {
          text: "Cannot build storage object: invalid --name for local file path (use a non-empty name without reserved path segments).",
          isError: true,
        };
      }

      const result = await backupBuilder(parsed.backupTarget, {
        ...options.backupOptions,
        archiveBasename,
      });
      await emitCloudEventBestEffort(
        "backup.completed",
        {
          operation_id: executionContext.forcedOperationId?.trim() || randomUUID(),
          object_id: result.objectId,
          status: "succeeded",
          details: {
            friendly_name: parsed.friendlyName,
            archive_path: result.archivePath,
            object_id_hash: result.objectIdHash.replace(/\s/g, ""),
            object_size_gb: result.objectSizeGb,
          },
        },
        mnemosparkHomeDir,
      );
      await datastore.upsertObject({
        object_id: result.objectId,
        object_key: null,
        wallet_address: walletAddress,
        quote_id: null,
        provider: null,
        bucket_name: null,
        region: null,
        sha256: result.objectIdHash,
        status: "backed_up",
      });
      await datastore.upsertFriendlyName({
        friendly_name: parsed.friendlyName,
        object_id: result.objectId,
        object_key: null,
        quote_id: null,
        wallet_address: walletAddress,
      });
      return {
        text: formatBackupSuccessUserMessage(result, walletAddress, parsed.friendlyName),
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes("already exists")) {
        return {
          text: err.message,
          isError: true,
        };
      }
      return {
        text: "Cannot build storage object",
        isError: true,
      };
    }
  }

  if (parsed.mode === "price-storage") {
    const correlation = buildRequestCorrelation();
    try {
      const quote = await requestPriceStorageQuote(parsed.priceStorageRequest, {
        ...options.proxyQuoteOptions,
        correlation,
      });
      await datastore.ensureReady();
      await datastore.upsertObject({
        object_id: quote.object_id,
        object_key: null,
        wallet_address: quote.addr,
        quote_id: quote.quote_id,
        provider: quote.provider,
        bucket_name: null,
        region: quote.location,
        sha256: quote.object_id_hash,
        status: "quoted",
      });
      await datastore.upsertPayment({
        quote_id: quote.quote_id,
        wallet_address: quote.addr,
        trans_id: null,
        amount: quote.storage_price,
        network: null,
        status: "quoted",
      });
      const verified = await datastore.findQuoteById(quote.quote_id);
      if (!verified || !quoteLookupMatchesPriceStorageResponse(verified, quote)) {
        return {
          text: "Cannot price storage: quote was not saved to local SQLite (~/.openclaw/mnemospark/state.db). Check disk permissions or MNEMOSPARK_DISABLE_SQLITE.",
          isError: true,
        };
      }
      await emitCloudEventBestEffort(
        "price-storage.completed",
        {
          operation_id: correlation.operationId,
          trace_id: correlation.traceId,
          wallet_address: quote.addr,
          object_id: quote.object_id,
          quote_id: quote.quote_id,
          status: "succeeded",
        },
        mnemosparkHomeDir,
      );
      let friendlyForQuote: string | null = null;
      try {
        friendlyForQuote = await datastore.findLatestFriendlyNameForObjectId(quote.object_id);
      } catch {
        friendlyForQuote = null;
      }
      return {
        text: formatPriceStorageUserMessage(quote, friendlyForQuote),
      };
    } catch (err) {
      await emitCloudEventBestEffort(
        "price-storage.completed",
        {
          operation_id: correlation.operationId,
          trace_id: correlation.traceId,
          wallet_address: parsed.priceStorageRequest.wallet_address,
          object_id: parsed.priceStorageRequest.object_id,
          status: "failed",
        },
        mnemosparkHomeDir,
      );
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
      return {
        text: message ? `Cannot price storage: ${message}` : "Cannot price storage",
        isError: true,
      };
    }
  }

  if (parsed.mode === "upload") {
    const uploadCorrelation = buildRequestCorrelation(
      executionContext.forcedOperationId ?? idempotencyKeyFn(),
      executionContext.forcedTraceId,
    );
    let preparedPayload: PreparedUploadPayload | undefined;
    try {
      const loggedQuote = await datastore.findQuoteById(parsed.uploadRequest.quote_id);
      if (!loggedQuote) {
        return {
          text: "Cannot upload storage object: quote-id not found in local SQLite. Run /mnemospark_cloud price-storage first (quotes expire after about one hour on the server).",
          isError: true,
        };
      }

      if (
        loggedQuote.walletAddress.toLowerCase() !==
          parsed.uploadRequest.wallet_address.toLowerCase() ||
        loggedQuote.objectId !== parsed.uploadRequest.object_id ||
        loggedQuote.objectIdHash.toLowerCase() !== parsed.uploadRequest.object_id_hash.toLowerCase()
      ) {
        return {
          text: "Cannot upload storage object: quote details do not match wallet/object arguments.",
          isError: true,
        };
      }

      const backupDir = options.backupOptions?.tmpDir ?? DEFAULT_BACKUP_DIR;
      const dbFriendly = await datastore.findLatestFriendlyNameForObjectId(
        parsed.uploadRequest.object_id,
      );
      if (!dbFriendly?.trim()) {
        return {
          text: "Cannot upload storage object: no friendly name in local SQLite for this object-id. Run /mnemospark_cloud backup with --name first.",
          isError: true,
        };
      }

      if (parsed.friendlyName?.trim()) {
        if (parsed.friendlyName.trim() !== dbFriendly.trim()) {
          return {
            text: "Cannot upload storage object: --name does not match the friendly name stored in local SQLite for this object-id.",
            isError: true,
          };
        }
      }

      const resolvedArchive = await resolveLocalUploadArchivePath(
        backupDir,
        parsed.uploadRequest.object_id,
        dbFriendly,
      );
      if (!resolvedArchive.ok) {
        return { text: resolvedArchive.message, isError: true };
      }
      const archivePath = resolvedArchive.archivePath;

      let archiveStats;
      try {
        archiveStats = await stat(archivePath);
      } catch {
        return {
          text: `Cannot upload storage object: local archive not found at ${archivePath}. Run /mnemospark_cloud backup first.`,
          isError: true,
        };
      }
      if (!archiveStats.isFile()) {
        return {
          text: `Cannot upload storage object: local archive path is not a file (${archivePath}).`,
          isError: true,
        };
      }

      const archiveHash = await sha256File(archivePath);
      if (archiveHash.toLowerCase() !== parsed.uploadRequest.object_id_hash.toLowerCase()) {
        return {
          text: "Cannot upload storage object: object-id-hash does not match local archive.",
          isError: true,
        };
      }

      const walletKey = await resolveWalletKey(mnemosparkHomeDir);
      const walletAccount = privateKeyToAccount(walletKey);
      if (
        walletAccount.address.toLowerCase() !== parsed.uploadRequest.wallet_address.toLowerCase()
      ) {
        return {
          text: `Cannot upload storage object: wallet key address ${walletAccount.address} does not match --wallet-address ${parsed.uploadRequest.wallet_address}.`,
          isError: true,
        };
      }

      preparedPayload = await prepareUploadPayload(
        archivePath,
        parsed.uploadRequest.wallet_address,
        mnemosparkHomeDir,
      );
      const idempotencyKey = uploadCorrelation.operationId;
      const shouldSettleBeforeUpload = requestStorageUpload !== requestStorageUploadViaProxy;

      if (shouldSettleBeforeUpload) {
        const paymentFetch = createPayment(walletKey).fetch;
        // Settle payment first (with 402 handling) when upload transport does not settle itself.
        const settleResult = await requestPaymentSettleViaProxy(
          parsed.uploadRequest.quote_id,
          parsed.uploadRequest.wallet_address,
          {
            ...options.proxyUploadOptions,
            correlation: uploadCorrelation,
            fetchImpl: (input, init) => paymentFetch(input, init),
          },
        );
        if (settleResult.status !== 200) {
          const message =
            settleResult.bodyText?.trim() ||
            `Payment settle failed with status ${settleResult.status}`;
          throw new Error(message);
        }
      }

      const uploadFetchImpl = options.proxyUploadOptions?.fetchImpl ?? fetchImpl;
      const uploadResponse = await requestStorageUpload(
        {
          quote_id: parsed.uploadRequest.quote_id,
          wallet_address: parsed.uploadRequest.wallet_address,
          object_id: parsed.uploadRequest.object_id,
          object_id_hash: parsed.uploadRequest.object_id_hash,
          quoted_storage_price: loggedQuote.storagePrice,
          payload: preparedPayload.payload,
        },
        {
          ...options.proxyUploadOptions,
          idempotencyKey,
          correlation: uploadCorrelation,
          fetchImpl: uploadFetchImpl,
        },
      );

      await uploadPresignedObjectIfNeeded(
        uploadResponse,
        preparedPayload.payload.mode,
        preparedPayload.encryptedContent,
        preparedPayload.encryptedTempPath,
        fetchImpl,
      );
      let finalizedUploadResponse = uploadResponse;
      if (
        preparedPayload.payload.mode === "presigned" &&
        uploadResponse.confirmation_required === true
      ) {
        try {
          finalizedUploadResponse = await requestStorageUploadConfirm(
            {
              quote_id: uploadResponse.quote_id,
              wallet_address: parsed.uploadRequest.wallet_address,
              object_key: uploadResponse.object_key,
              idempotency_key: idempotencyKey,
            },
            {
              ...options.proxyUploadConfirmOptions,
              correlation: uploadCorrelation,
            },
          );
        } catch (confirmError) {
          const transId = uploadResponse.trans_id ?? "unknown";
          const confirmMessage =
            extractUploadErrorMessage(confirmError) ?? "Upload confirmation request failed";
          throw new Error(
            `Upload to S3 succeeded, but backend confirmation failed (trans_id: ${transId}, idempotency_key: ${idempotencyKey}). ${confirmMessage}`,
          );
        }
      }

      const cronStoragePriceCandidate =
        finalizedUploadResponse.storage_price ?? loggedQuote.storagePrice;
      const cronStoragePrice =
        Number.isFinite(cronStoragePriceCandidate) && cronStoragePriceCandidate > 0
          ? cronStoragePriceCandidate
          : loggedQuote.storagePrice;
      const cronJob = await createStoragePaymentCronJob(
        finalizedUploadResponse,
        cronStoragePrice,
        openClawCronAdapter,
        mnemosparkHomeDir ?? homedir(),
        nowDateFn,
      );
      await datastore.upsertObject({
        object_id: finalizedUploadResponse.object_id,
        object_key: finalizedUploadResponse.object_key,
        wallet_address: finalizedUploadResponse.addr,
        quote_id: finalizedUploadResponse.quote_id,
        provider: finalizedUploadResponse.provider,
        bucket_name: finalizedUploadResponse.bucket_name,
        region: finalizedUploadResponse.location,
        sha256: parsed.uploadRequest.object_id_hash,
        status: "uploaded",
      });
      await datastore.upsertPayment({
        quote_id: finalizedUploadResponse.quote_id,
        wallet_address: finalizedUploadResponse.addr,
        trans_id: finalizedUploadResponse.trans_id ?? null,
        amount: cronStoragePrice,
        network: null,
        status: "settled",
        settled_at: new Date().toISOString(),
      });
      await datastore.upsertCronJob({
        cron_id: cronJob.cronId,
        object_id: cronJob.objectId,
        object_key: cronJob.objectKey,
        quote_id: cronJob.quoteId,
        schedule: cronJob.schedule,
        command: cronJob.command,
        status: "active",
      });
      const normalizedFriendlyName = dbFriendly.trim();
      await datastore.upsertFriendlyName({
        friendly_name: normalizedFriendlyName,
        object_id: finalizedUploadResponse.object_id,
        object_key: finalizedUploadResponse.object_key,
        quote_id: finalizedUploadResponse.quote_id,
        wallet_address: finalizedUploadResponse.addr,
      });

      let friendlyNameVerified = false;
      try {
        const readBack = await datastore.resolveFriendlyName({
          walletAddress: finalizedUploadResponse.addr,
          friendlyName: normalizedFriendlyName,
          latest: true,
        });
        friendlyNameVerified =
          Boolean(readBack?.objectKey) &&
          readBack?.objectKey === finalizedUploadResponse.object_key;
      } catch {
        friendlyNameVerified = false;
      }

      if (!friendlyNameVerified) {
        const warning =
          "SQLite friendly-name write verification failed; --name lookups may not resolve until SQLite is healthy.";
        await emitCloudEventBestEffort(
          "friendly_name.write_verification_failed",
          {
            operation_id: uploadCorrelation.operationId,
            trace_id: uploadCorrelation.traceId,
            wallet_address: finalizedUploadResponse.addr,
            object_id: finalizedUploadResponse.object_id,
            object_key: finalizedUploadResponse.object_key,
            quote_id: finalizedUploadResponse.quote_id,
            friendly_name: normalizedFriendlyName,
            warning,
          },
          mnemosparkHomeDir,
        );
        if (process.env.MNEMOSPARK_SQLITE_STRICT === "1") {
          throw new Error(warning);
        }
      }
      await emitCloudEventBestEffort(
        "upload.completed",
        {
          operation_id: idempotencyKey,
          trace_id: uploadCorrelation.traceId,
          wallet_address: finalizedUploadResponse.addr,
          object_id: finalizedUploadResponse.object_id,
          object_key: finalizedUploadResponse.object_key,
          quote_id: finalizedUploadResponse.quote_id,
          status: "succeeded",
        },
        mnemosparkHomeDir,
      );
      await maybeCleanupLocalBackupArchive(archivePath);

      return {
        text: formatStorageUploadUserMessage(finalizedUploadResponse, cronJob.cronId),
      };
    } catch (error) {
      await emitCloudEventBestEffort(
        "upload.completed",
        {
          operation_id: uploadCorrelation.operationId,
          trace_id: uploadCorrelation.traceId,
          wallet_address: parsed.uploadRequest.wallet_address,
          object_id: parsed.uploadRequest.object_id,
          quote_id: parsed.uploadRequest.quote_id,
          status: "failed",
        },
        mnemosparkHomeDir,
      );
      const uploadErrorMessage = extractUploadErrorMessage(error);
      return {
        text: uploadErrorMessage ?? "Cannot upload storage object",
        isError: true,
      };
    } finally {
      if (preparedPayload?.encryptedTempPath) {
        await rm(preparedPayload.encryptedTempPath, { force: true }).catch(() => {});
      }
    }
  }

  if (parsed.mode === "ls") {
    const resolved = await resolveNameSelectorIfNeeded(
      datastore,
      parsed.storageObjectRequest,
      parsed.nameSelector,
    );
    if (resolved.error || !resolved.request) {
      return { text: resolved.error ?? "Cannot resolve storage object request.", isError: true };
    }
    const resolvedRequest = resolved.request;

    const objectKeyForLs = resolvedRequest.object_key?.trim();
    const isBucketList = !objectKeyForLs;
    const correlation = buildRequestCorrelation();
    const operationId = correlation.operationId;
    const knownObject = isBucketList ? null : await datastore.findObjectByObjectKey(objectKeyForLs);
    const operationObjectId = knownObject?.object_id ?? null;
    await datastore.upsertOperation({
      operation_id: operationId,
      type: "ls",
      object_id: operationObjectId,
      quote_id: null,
      status: "started",
      error_code: null,
      error_message: null,
    });
    try {
      const lsResult = await requestStorageLs(resolvedRequest, {
        ...options.proxyStorageOptions,
        correlation,
      });
      if (!lsResult.success) {
        throw new Error("ls failed");
      }
      await datastore.upsertOperation({
        operation_id: operationId,
        type: "ls",
        object_id: operationObjectId,
        quote_id: null,
        status: "succeeded",
        error_code: null,
        error_message: null,
      });
      await emitCloudEventBestEffort(
        "ls.completed",
        {
          operation_id: operationId,
          trace_id: correlation.traceId,
          wallet_address: resolvedRequest.wallet_address,
          object_key: resolvedRequest.object_key ?? null,
          status: "succeeded",
          list_mode: isBucketList,
        },
        mnemosparkHomeDir,
      );
      const lsText = await buildMnemosparkLsMessage(lsResult, {
        walletAddress: resolvedRequest.wallet_address,
        datastore,
      });
      return {
        text: lsText,
      };
    } catch (error) {
      const lsErrorMessage = extractLsErrorMessage(error) ?? "Cannot list storage object";
      await datastore.upsertOperation({
        operation_id: operationId,
        type: "ls",
        object_id: operationObjectId,
        quote_id: null,
        status: "failed",
        error_code: "LS_FAILED",
        error_message: lsErrorMessage,
      });
      await emitCloudEventBestEffort(
        "ls.completed",
        {
          operation_id: operationId,
          trace_id: correlation.traceId,
          wallet_address: resolvedRequest.wallet_address,
          object_key: resolvedRequest.object_key ?? null,
          status: "failed",
          list_mode: isBucketList,
        },
        mnemosparkHomeDir,
      );
      return {
        text: lsErrorMessage,
        isError: true,
      };
    }
  }

  if (parsed.mode === "download") {
    const resolved = await resolveNameSelectorIfNeeded(
      datastore,
      parsed.storageObjectRequest,
      parsed.nameSelector,
    );
    if (resolved.error || !resolved.request) {
      return { text: resolved.error ?? "Cannot resolve storage object request.", isError: true };
    }
    const narrowed = toStorageObjectRequestOrError(
      resolved.request,
      `Cannot download file: required arguments are ${REQUIRED_STORAGE_OBJECT}.`,
    );
    if (!narrowed.ok) {
      return { text: narrowed.error, isError: true };
    }
    const resolvedRequest = narrowed.request;

    const correlation = buildRequestCorrelation(
      executionContext.forcedOperationId,
      executionContext.forcedTraceId,
    );
    const operationId = correlation.operationId;
    const knownObject = await datastore.findObjectByObjectKey(resolvedRequest.object_key);
    const operationObjectId = knownObject?.object_id ?? null;
    await datastore.upsertOperation({
      operation_id: operationId,
      type: "download",
      object_id: operationObjectId,
      quote_id: null,
      status: "started",
      error_code: null,
      error_message: null,
    });
    let downloadLocalBasename: string | undefined;
    try {
      const friendly = await datastore.findLatestFriendlyNameForObjectKey(
        resolvedRequest.wallet_address,
        resolvedRequest.object_key,
      );
      if (friendly?.trim()) {
        try {
          downloadLocalBasename = sanitizeFriendlyNameForLocalBasename(friendly);
        } catch {
          downloadLocalBasename = undefined;
        }
      }
    } catch {
      downloadLocalBasename = undefined;
    }

    try {
      const downloadResult = await requestStorageDownload(resolvedRequest, {
        ...options.proxyStorageOptions,
        correlation,
        ...(downloadLocalBasename ? { downloadLocalBasename } : {}),
      });
      if (!downloadResult.success) {
        throw new Error("download failed");
      }
      await datastore.upsertOperation({
        operation_id: operationId,
        type: "download",
        object_id: operationObjectId,
        quote_id: null,
        status: "succeeded",
        error_code: null,
        error_message: null,
      });
      await emitCloudEventBestEffort(
        "download.completed",
        {
          operation_id: operationId,
          trace_id: correlation.traceId,
          wallet_address: resolvedRequest.wallet_address,
          object_key: resolvedRequest.object_key,
          status: "succeeded",
        },
        mnemosparkHomeDir,
      );
      const downloadText = `File ${resolvedRequest.object_key} downloaded to ${downloadResult.file_path}`;
      return {
        text: downloadText,
      };
    } catch {
      await datastore.upsertOperation({
        operation_id: operationId,
        type: "download",
        object_id: operationObjectId,
        quote_id: null,
        status: "failed",
        error_code: "DOWNLOAD_FAILED",
        error_message: "Cannot download file",
      });
      await emitCloudEventBestEffort(
        "download.completed",
        {
          operation_id: operationId,
          trace_id: correlation.traceId,
          wallet_address: resolvedRequest.wallet_address,
          object_key: resolvedRequest.object_key,
          status: "failed",
        },
        mnemosparkHomeDir,
      );
      return {
        text: "Cannot download file",
        isError: true,
      };
    }
  }

  if (parsed.mode === "delete") {
    const resolved = await resolveNameSelectorIfNeeded(
      datastore,
      parsed.storageObjectRequest,
      parsed.nameSelector,
    );
    if (resolved.error || !resolved.request) {
      return { text: resolved.error ?? "Cannot resolve storage object request.", isError: true };
    }
    const narrowedDelete = toStorageObjectRequestOrError(
      resolved.request,
      `Cannot delete file: required arguments are ${REQUIRED_STORAGE_OBJECT}.`,
    );
    if (!narrowedDelete.ok) {
      return { text: narrowedDelete.error, isError: true };
    }
    const resolvedRequest = narrowedDelete.request;
    const correlation = buildRequestCorrelation();
    const operationId = correlation.operationId;

    const existingObjectByKey = await datastore.findObjectByObjectKey(resolvedRequest.object_key);
    try {
      const deleteResult = await requestStorageDelete(resolvedRequest, {
        ...options.proxyStorageOptions,
        correlation,
      });
      if (!deleteResult.success) {
        throw new Error("delete failed");
      }
    } catch {
      await emitCloudEventBestEffort(
        "delete.completed",
        {
          operation_id: operationId,
          trace_id: correlation.traceId,
          wallet_address: resolvedRequest.wallet_address,
          object_key: resolvedRequest.object_key,
          status: "failed",
        },
        mnemosparkHomeDir,
      );
      return {
        text: "Cannot delete file",
        isError: true,
      };
    }
    let cronEntry: { cronId: string; objectId: string; objectKey: string } | null = null;
    let cronDeleted = false;
    try {
      const dbCron = await datastore.findCronByObjectKey(resolvedRequest.object_key);
      if (dbCron) {
        cronEntry = {
          cronId: dbCron.cronId,
          objectId: dbCron.objectId,
          objectKey: resolvedRequest.object_key,
        };
      }
      if (!cronEntry) {
        cronEntry = await findCronJobInOpenClawCronJobsByObjectKey(
          resolvedRequest.object_key,
          openClawCronAdapter,
        );
      }
      if (cronEntry) {
        const fileCronDeleted = await removeStoragePaymentCronJob(
          cronEntry.cronId,
          openClawCronAdapter,
        );
        const dbCronDeleted = await datastore.removeCronJob(cronEntry.cronId);
        cronDeleted = fileCronDeleted || dbCronDeleted;
      }
    } catch {
      // Cloud delete already succeeded; cron lookup/removal is best-effort.
      // Report success without implying the delete failed.
    }
    const objectId = cronEntry?.objectId ?? existingObjectByKey?.object_id ?? null;
    if (objectId) {
      const existingObject =
        existingObjectByKey?.object_id === objectId
          ? existingObjectByKey
          : await datastore.findObjectById(objectId);
      await datastore.upsertObject({
        object_id: objectId,
        object_key: resolvedRequest.object_key,
        wallet_address: existingObject?.wallet_address ?? resolvedRequest.wallet_address,
        quote_id: existingObject?.quote_id ?? null,
        provider: existingObject?.provider ?? null,
        bucket_name: existingObject?.bucket_name ?? null,
        region: resolvedRequest.location ?? existingObject?.region ?? null,
        sha256: existingObject?.sha256 ?? null,
        status: "deleted",
      });
    }
    await emitCloudEventBestEffort(
      "delete.completed",
      {
        operation_id: operationId,
        trace_id: correlation.traceId,
        wallet_address: resolvedRequest.wallet_address,
        object_key: resolvedRequest.object_key,
        status: "succeeded",
      },
      mnemosparkHomeDir,
    );
    const deleteText = formatStorageDeleteUserMessage(
      resolvedRequest.object_key,
      cronEntry?.cronId ?? null,
      cronDeleted,
    );
    return {
      text: deleteText,
    };
  }

  return {
    text: CLOUD_HELP_TEXT,
    isError: true,
  };
}

export type {
  BackupObjectOptions,
  BackupObjectResult,
  CreateCloudCommandOptions,
  MnemosparkSubagentTaskV1,
  ParsedCloudArgs,
};
