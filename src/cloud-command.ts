import { spawn } from "node:child_process";
import {
  createCipheriv,
  createHash,
  randomBytes as randomBytesNode,
  randomUUID,
} from "node:crypto";
import { createReadStream, statfsSync } from "node:fs";
import { appendFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import {
  requestStorageUploadViaProxy,
  parsePriceStorageQuoteRequest,
  requestPriceStorageViaProxy,
  type StorageUploadRequest,
  type StorageUploadResponse,
  type UploadPayload,
  type PriceStorageQuoteRequest,
  type PriceStorageQuoteResponse,
  type ProxyQuoteOptions,
  type ProxyUploadOptions,
} from "./cloud-price-storage.js";
import {
  parseStorageObjectRequest,
  requestStorageDeleteViaProxy,
  requestStorageDownloadViaProxy,
  requestStorageLsViaProxy,
  type ProxyStorageOptions,
  type StorageDeleteResponse,
  type StorageDownloadProxyResponse,
  type StorageLsResponse,
  type StorageObjectRequest,
} from "./cloud-storage.js";
import type { OpenClawPluginCommandDefinition } from "./types.js";
import { createPaymentFetch, type PaymentFetchResult } from "./x402.js";
import { isValidWalletPrivateKey } from "./wallet-key.js";

const SUPPORTED_BACKUP_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "linux"]);
const BACKUP_DIR_SUBPATH = join(".openclaw", "mnemospark", "backup");
const DEFAULT_BACKUP_DIR = join(homedir(), BACKUP_DIR_SUBPATH);
const OBJECT_LOG_SUBPATH = join(".openclaw", "mnemospark", "object.log");
const CRON_TABLE_SUBPATH = join(".openclaw", "mnemospark", "crontab.txt");
const BLOCKRUN_WALLET_KEY_SUBPATH = join(".openclaw", "blockrun", "wallet.key");
const MNEMOSPARK_WALLET_KEY_SUBPATH = join(".openclaw", "mnemospark", "wallet", "wallet.key");
const KEY_STORE_SUBPATH = join(".openclaw", "mnemospark", "keys");
const INLINE_UPLOAD_MAX_BYTES = 4_500_000;
const AES_GCM_NONCE_BYTES = 12;
const PAYMENT_REMINDER_INTERVAL_DAYS = 30;
const PAYMENT_DELETE_DEADLINE_DAYS = 32;
// Standard cron cannot express "every 30 days" from an arbitrary date. */30 in day-of-month
// means days 1 and 31, so in 31-day months it fires twice one day apart (e.g. Jan 31, Feb 1).
// Use 1st of each month so the job runs once per month.
const PAYMENT_CRON_SCHEDULE = "0 0 1 * *";
const CRON_LOG_ROW_PREFIX = "cron";
const TAR_OVERHEAD_BYTES = 10 * 1024 * 1024; // Conservative headroom for tar metadata.

const REQUIRED_PRICE_STORAGE =
  "--wallet-address, --object-id, --object-id-hash, --gb, --provider, --region";
const REQUIRED_UPLOAD = "--quote-id, --wallet-address, --object-id, --object-id-hash";
const REQUIRED_STORAGE_OBJECT = "--wallet-address, --object-key";

const CLOUD_HELP_TEXT = [
  "☁️ **mnemospark Cloud Commands**",
  "",
  "• `/mnemospark-cloud` or `/mnemospark-cloud help` — show this message",
  "",
  "• `/mnemospark-cloud backup <file>` or `/mnemospark-cloud backup <directory>`",
  "  Required: <file> or <directory> (path to back up)",
  "",
  "• `/mnemospark-cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider <provider> --region <region>`",
  "  Required: " + REQUIRED_PRICE_STORAGE,
  "",
  "• `/mnemospark-cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash>`",
  "  Required: " + REQUIRED_UPLOAD,
  "",
  "• `/mnemospark-cloud ls --wallet-address <addr> --object-key <object-key>`",
  "  Required: " + REQUIRED_STORAGE_OBJECT,
  "",
  "• `/mnemospark-cloud download --wallet-address <addr> --object-key <object-key>`",
  "  Required: " + REQUIRED_STORAGE_OBJECT,
  "",
  "• `/mnemospark-cloud delete --wallet-address <addr> --object-key <object-key>`",
  "  Required: " + REQUIRED_STORAGE_OBJECT,
  "",
  "Backup creates a tar+gzip object in ~/.openclaw/mnemospark/backup and appends object metadata to ~/.openclaw/mnemospark/object.log. Upload appends storage rows and cron-tracking rows to object.log, and keeps job entries in ~/.openclaw/mnemospark/crontab.txt. All storage commands (price-storage, upload, ls, download, delete) require --wallet-address.",
].join("\n");

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type UploadCommandRequest = {
  quote_id: string;
  wallet_address: string;
  object_id: string;
  object_id_hash: string;
};

type BackupObjectOptions = {
  platform?: NodeJS.Platform;
  tmpDir?: string;
  homeDir?: string;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  availableDiskBytes?: number;
};

type BackupObjectResult = {
  objectId: string;
  objectIdHash: string;
  objectSizeGb: string;
  archivePath: string;
  objectLogPath: string;
};

type ParsedCloudArgs =
  | { mode: "help" }
  | { mode: "backup"; backupTarget: string }
  | { mode: "price-storage"; priceStorageRequest: PriceStorageQuoteRequest }
  | { mode: "price-storage-invalid" }
  | { mode: "upload"; uploadRequest: UploadCommandRequest }
  | { mode: "upload-invalid" }
  | { mode: "ls"; storageObjectRequest: StorageObjectRequest }
  | { mode: "ls-invalid" }
  | { mode: "download"; storageObjectRequest: StorageObjectRequest }
  | { mode: "download-invalid" }
  | { mode: "delete"; storageObjectRequest: StorageObjectRequest }
  | { mode: "delete-invalid" }
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
  resolveWalletPrivateKeyFn?: (homeDir?: string) => Promise<`0x${string}`>;
  createPaymentFetchFn?: (privateKey: `0x${string}`) => PaymentFetchResult;
  fetchImpl?: FetchLike;
  nowDateFn?: () => Date;
  idempotencyKeyFn?: () => string;
  proxyQuoteOptions?: ProxyQuoteOptions;
  proxyUploadOptions?: ProxyUploadOptions;
  requestStorageLsFn?: (
    request: StorageObjectRequest,
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
  proxyStorageOptions?: ProxyStorageOptions;
  objectLogHomeDir?: string;
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

function tokenizeArgs(input: string): string[] {
  const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!tokens) {
    return [];
  }
  return tokens.map((token) => stripWrappingQuotes(token));
}

function parseNamedFlags(input: string): Record<string, string> | null {
  const tokens = tokenizeArgs(input);
  if (tokens.length === 0) {
    return null;
  }

  const parsed: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const keyToken = tokens[i];
    if (!keyToken.startsWith("--")) {
      return null;
    }
    const key = keyToken.slice(2).toLowerCase();
    const value = tokens[i + 1];
    if (!value || value.startsWith("--")) {
      return null;
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
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
    const backupTarget = stripWrappingQuotes(rest);
    if (!backupTarget) {
      return { mode: "unknown" };
    }
    return { mode: "backup", backupTarget };
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
    const flags = parseNamedFlags(rest);
    if (!flags) {
      return { mode: "upload-invalid" };
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
      uploadRequest: {
        quote_id: quoteId,
        wallet_address: walletAddress,
        object_id: objectId,
        object_id_hash: objectIdHash,
      },
    };
  }

  if (subcommand === "ls") {
    const flags = parseNamedFlags(rest);
    if (!flags) {
      return { mode: "ls-invalid" };
    }
    const request = parseStorageObjectRequest({
      wallet_address: flags["wallet-address"],
      object_key: flags["object-key"],
      location: flags.location ?? flags.region,
    });
    if (!request) {
      return { mode: "ls-invalid" };
    }
    return { mode: "ls", storageObjectRequest: request };
  }

  if (subcommand === "download") {
    const flags = parseNamedFlags(rest);
    if (!flags) {
      return { mode: "download-invalid" };
    }
    const request = parseStorageObjectRequest({
      wallet_address: flags["wallet-address"],
      object_key: flags["object-key"],
      location: flags.location ?? flags.region,
    });
    if (!request) {
      return { mode: "download-invalid" };
    }
    return { mode: "download", storageObjectRequest: request };
  }

  if (subcommand === "delete") {
    const flags = parseNamedFlags(rest);
    if (!flags) {
      return { mode: "delete-invalid" };
    }
    const request = parseStorageObjectRequest({
      wallet_address: flags["wallet-address"],
      object_key: flags["object-key"],
      location: flags.location ?? flags.region,
    });
    if (!request) {
      return { mode: "delete-invalid" };
    }
    return { mode: "delete", storageObjectRequest: request };
  }

  return { mode: "unknown" };
}

function resolveObjectLogPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), OBJECT_LOG_SUBPATH);
}

function resolveCronTablePath(homeDir?: string): string {
  return join(homeDir ?? homedir(), CRON_TABLE_SUBPATH);
}

async function appendObjectLogLine(line: string, homeDir?: string): Promise<string> {
  const objectLogPath = resolveObjectLogPath(homeDir);
  await mkdir(dirname(objectLogPath), { recursive: true });
  await appendFile(objectLogPath, `${line}\n`, "utf-8");
  return objectLogPath;
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

  const targetPath = resolve(targetPathArg);
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
  const archivePath = join(tmpDir, objectId);

  try {
    await runTarGzip(archivePath, targetPath);
    const archiveStats = await stat(archivePath);
    const objectIdHash = await sha256File(archivePath);
    const objectSizeGb = toGbString(archiveStats.size);

    const objectLogPath = await appendObjectLogLine(
      `${objectId},${objectIdHash},${objectSizeGb}`,
      options.homeDir,
    );

    return {
      objectId,
      objectIdHash,
      objectSizeGb,
      archivePath,
      objectLogPath,
    };
  } catch (error) {
    await rm(archivePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function appendPriceStorageQuoteLog(
  quote: PriceStorageQuoteResponse,
  homeDir?: string,
): Promise<string> {
  return appendObjectLogLine(
    [
      quote.timestamp,
      quote.quote_id,
      quote.storage_price.toString(),
      quote.addr,
      quote.object_id,
      quote.object_id_hash,
      quote.object_size_gb.toString(),
      quote.provider,
      quote.location,
    ].join(","),
    homeDir,
  );
}

type LoggedPriceStorageQuote = {
  quoteId: string;
  storagePrice: number;
  walletAddress: string;
  objectId: string;
  objectIdHash: string;
  provider: string;
  location: string;
};

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

type LoggedStoragePaymentCron = {
  cronId: string;
  objectId: string;
  objectKey: string;
};

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, "0");
  return [
    date.getFullYear().toString(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
  ].join("");
}

function parseLoggedPriceStorageQuote(line: string): LoggedPriceStorageQuote | null {
  const parts = line.split(",");
  if (parts.length < 9) {
    return null;
  }

  const quoteId = parts[1]?.trim() ?? "";
  const storagePriceRaw = parts[2]?.trim() ?? "";
  const walletAddress = parts[3]?.trim() ?? "";
  const objectId = parts[4]?.trim() ?? "";
  const objectIdHash = parts[5]?.trim() ?? "";
  const provider = parts[7]?.trim() ?? "";
  const location = parts[8]?.trim() ?? "";
  const storagePrice = Number.parseFloat(storagePriceRaw);

  if (!quoteId || !walletAddress || !objectId || !objectIdHash || !provider || !location) {
    return null;
  }
  if (!Number.isFinite(storagePrice) || storagePrice <= 0) {
    return null;
  }

  return {
    quoteId,
    storagePrice,
    walletAddress,
    objectId,
    objectIdHash,
    provider,
    location,
  };
}

function parseLoggedStoragePaymentCron(line: string): LoggedStoragePaymentCron | null {
  const parts = line.split(",");
  if (parts.length < 5) {
    return null;
  }
  if ((parts[0]?.trim() ?? "").toLowerCase() !== CRON_LOG_ROW_PREFIX) {
    return null;
  }

  const cronId = parts[2]?.trim() ?? "";
  const objectId = parts[3]?.trim() ?? "";
  const objectKey = parts[4]?.trim() ?? "";
  if (!cronId || !objectId || !objectKey) {
    return null;
  }

  return {
    cronId,
    objectId,
    objectKey,
  };
}

function parseStoragePaymentCronJobLine(line: string): StoragePaymentCronJob | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;

  const cronId = typeof record.cronId === "string" ? record.cronId.trim() : "";
  const createdAt = typeof record.createdAt === "string" ? record.createdAt.trim() : "";
  const schedule = typeof record.schedule === "string" ? record.schedule.trim() : "";
  const command = typeof record.command === "string" ? record.command.trim() : "";
  const quoteId = typeof record.quoteId === "string" ? record.quoteId.trim() : "";
  const storagePrice = typeof record.storagePrice === "number" ? record.storagePrice : Number.NaN;
  const walletAddress = typeof record.walletAddress === "string" ? record.walletAddress.trim() : "";
  const objectId = typeof record.objectId === "string" ? record.objectId.trim() : "";
  const objectKey = typeof record.objectKey === "string" ? record.objectKey.trim() : "";
  const provider = typeof record.provider === "string" ? record.provider.trim() : "";
  const bucketName = typeof record.bucketName === "string" ? record.bucketName.trim() : "";
  const location = typeof record.location === "string" ? record.location.trim() : "";

  if (
    !cronId ||
    !createdAt ||
    !schedule ||
    !command ||
    !quoteId ||
    !Number.isFinite(storagePrice) ||
    storagePrice <= 0 ||
    !walletAddress ||
    !objectId ||
    !objectKey ||
    !provider ||
    !bucketName ||
    !location
  ) {
    return null;
  }

  return {
    cronId,
    createdAt,
    schedule,
    command,
    quoteId,
    storagePrice,
    walletAddress,
    objectId,
    objectKey,
    provider,
    bucketName,
    location,
  };
}

async function findLoggedPriceStorageQuote(
  quoteId: string,
  homeDir?: string,
): Promise<LoggedPriceStorageQuote | null> {
  const objectLogPath = resolveObjectLogPath(homeDir);

  let content: string;
  try {
    content = await readFile(objectLogPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const parsed = parseLoggedPriceStorageQuote(lines[idx]);
    if (parsed && parsed.quoteId === quoteId) {
      return parsed;
    }
  }
  return null;
}

async function findLoggedStoragePaymentCronByObjectKey(
  objectKey: string,
  homeDir?: string,
): Promise<LoggedStoragePaymentCron | null> {
  const objectLogPath = resolveObjectLogPath(homeDir);

  let content: string;
  try {
    content = await readFile(objectLogPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const parsed = parseLoggedStoragePaymentCron(lines[idx]);
    if (parsed && parsed.objectKey === objectKey) {
      return parsed;
    }
  }
  return null;
}

function quoteCronArgument(value: string | number): string {
  return JSON.stringify(String(value));
}

function buildStoragePaymentCronCommand(job: {
  quoteId: string;
  walletAddress: string;
  objectId: string;
  objectKey: string;
  storagePrice: number;
}): string {
  return [
    "mnemospark-pay-storage",
    "--quote-id",
    quoteCronArgument(job.quoteId),
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

async function appendStoragePaymentCronLog(
  cronJob: StoragePaymentCronJob,
  homeDir?: string,
): Promise<string> {
  return appendObjectLogLine(
    [
      CRON_LOG_ROW_PREFIX,
      cronJob.createdAt,
      cronJob.cronId,
      cronJob.objectId,
      cronJob.objectKey,
      cronJob.quoteId,
      cronJob.storagePrice.toString(),
    ].join(","),
    homeDir,
  );
}

async function appendStoragePaymentCronJob(
  cronJob: StoragePaymentCronJob,
  homeDir?: string,
): Promise<string> {
  const cronTablePath = resolveCronTablePath(homeDir);
  await mkdir(dirname(cronTablePath), { recursive: true });
  await appendFile(cronTablePath, `${JSON.stringify(cronJob)}\n`, "utf-8");
  return cronTablePath;
}

async function removeStoragePaymentCronJob(cronId: string, homeDir?: string): Promise<boolean> {
  const cronTablePath = resolveCronTablePath(homeDir);

  let content: string;
  try {
    content = await readFile(cronTablePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const lines = content.split(/\r?\n/);
  let removed = false;
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = parseStoragePaymentCronJobLine(trimmed);
    if (parsed && parsed.cronId === cronId) {
      removed = true;
      continue;
    }
    keptLines.push(trimmed);
  }

  if (!removed) {
    return false;
  }

  await mkdir(dirname(cronTablePath), { recursive: true });
  const nextContent = keptLines.length > 0 ? `${keptLines.join("\n")}\n` : "";
  await writeFile(cronTablePath, nextContent, "utf-8");
  return true;
}

async function createStoragePaymentCronJob(
  upload: StorageUploadResponse,
  storagePrice: number,
  homeDir?: string,
  nowDateFn: () => Date = () => new Date(),
): Promise<StoragePaymentCronJob> {
  const cronId = randomUUID();
  const createdAt = formatTimestamp(nowDateFn());
  const cronJob: StoragePaymentCronJob = {
    cronId,
    createdAt,
    schedule: PAYMENT_CRON_SCHEDULE,
    command: buildStoragePaymentCronCommand({
      quoteId: upload.quote_id,
      walletAddress: upload.addr,
      objectId: upload.object_id,
      objectKey: upload.object_key,
      storagePrice,
    }),
    quoteId: upload.quote_id,
    storagePrice,
    walletAddress: upload.addr,
    objectId: upload.object_id,
    objectKey: upload.object_key,
    provider: upload.provider,
    bucketName: upload.bucket_name,
    location: upload.location,
  };

  await appendStoragePaymentCronJob(cronJob, homeDir);
  await appendStoragePaymentCronLog(cronJob, homeDir);
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

function walletShortHash(walletAddress: string): string {
  return sha256Buffer(Buffer.from(walletAddress.trim().toLowerCase(), "utf-8")).slice(0, 16);
}

function bucketNameForWallet(walletAddress: string): string {
  return `mnemospark-${walletShortHash(walletAddress)}`;
}

function encryptAesGcm(
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

async function loadOrCreateKek(
  walletAddress: string,
  homeDir?: string,
): Promise<{ kek: Buffer; keyPath: string }> {
  const keyPath = join(
    homeDir ?? homedir(),
    KEY_STORE_SUBPATH,
    `${walletShortHash(walletAddress)}.key`,
  );
  await mkdir(dirname(keyPath), { recursive: true });

  try {
    const existing = await readFile(keyPath);
    if (existing.length === 32) {
      return { kek: existing, keyPath };
    }
    const decoded = Buffer.from(existing.toString("utf-8").trim(), "base64");
    if (decoded.length === 32) {
      return { kek: decoded, keyPath };
    }
    throw new Error("Invalid key file format");
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
  encryptedContent: Buffer;
};

async function prepareUploadPayload(
  archivePath: string,
  walletAddress: string,
  homeDir?: string,
): Promise<PreparedUploadPayload> {
  const plaintext = await readFile(archivePath);
  const { kek, keyPath } = await loadOrCreateKek(walletAddress, homeDir);

  const dek = randomBytesNode(32);
  const encryptedContent = encryptAesGcm(plaintext, dek);
  const wrappedDek = encryptAesGcm(dek, kek);
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

async function uploadPresignedObjectIfNeeded(
  uploadResponse: StorageUploadResponse,
  uploadMode: UploadPayload["mode"],
  encryptedContent: Buffer,
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

  const response = await fetchImpl(uploadResponse.upload_url, {
    method: "PUT",
    headers,
    body: new Uint8Array(encryptedContent),
  });
  if (!response.ok) {
    const details = (await response.text()).trim();
    throw new Error(
      `Presigned upload failed with status ${response.status}${details ? `: ${details}` : ""}`,
    );
  }
}

async function appendStorageUploadLog(
  upload: StorageUploadResponse,
  homeDir?: string,
  nowDateFn: () => Date = () => new Date(),
): Promise<string> {
  return appendObjectLogLine(
    [
      formatTimestamp(nowDateFn()),
      upload.quote_id,
      upload.addr,
      upload.addr_hash ?? "",
      upload.trans_id ?? "",
      upload.storage_price?.toString() ?? "",
      upload.object_id,
      upload.object_key,
      upload.provider,
      upload.bucket_name,
      upload.location,
    ].join(","),
    homeDir,
  );
}

async function maybeCleanupLocalBackupArchive(archivePath: string): Promise<void> {
  const flag = process.env.MNEMOSPARK_DELETE_BACKUP_AFTER_UPLOAD;
  if (!flag) {
    return;
  }
  const normalized = flag.trim().toLowerCase();
  if (normalized !== "1" && normalized !== "true" && normalized !== "yes" && normalized !== "y") {
    return;
  }
  try {
    await rm(archivePath, { force: true });
  } catch {
    // Best-effort cleanup; ignore failures.
  }
}

function formatStorageUploadUserMessage(upload: StorageUploadResponse, cronJobId: string): string {
  return [
    `Your file \`${upload.object_id}\` with key \`${upload.object_key}\` has been stored using \`${upload.provider}\` in \`${upload.bucket_name}\` \`${upload.location}\``,
    `A cron job \`${cronJobId}\` has been configured to send payment monthly (on the 1st) for storage services. If payment is not sent, your \`${upload.object_id}\` will be deleted after the **${PAYMENT_DELETE_DEADLINE_DAYS}-day deadline** (${PAYMENT_REMINDER_INTERVAL_DAYS}-day billing interval + 2-day grace period).`,
    "Thank you for using mnemospark!",
  ].join("\n");
}

function formatStorageDeleteUserMessage(
  objectKey: string,
  cronId: string | null,
  cronDeleted: boolean,
): string {
  const statusLine = cronId
    ? cronDeleted
      ? `File \`${objectKey}\` has been deleted from the cloud and the cron job \`${cronId}\` has been deleted from your system.`
      : `File \`${objectKey}\` has been deleted from the cloud and the cron job \`${cronId}\` was not found in your system.`
    : `File \`${objectKey}\` has been deleted from the cloud and no matching cron job was found in your system.`;

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

function formatPriceStorageUserMessage(quote: PriceStorageQuoteResponse): string {
  return [
    `Your storage quote \`${quote.quote_id}\` is valid for 1 hour, the storage price is \`${quote.storage_price}\` for \`${quote.object_id}\` with file size of \`${quote.object_size_gb}\` in \`${quote.provider}\` \`${quote.location}\``,
    `If you accept this quote run the command /mnemospark-cloud upload --quote-id \`${quote.quote_id}\` --wallet-address \`${quote.addr}\` --object-id \`${quote.object_id}\` --object-id-hash \`${quote.object_id_hash}\``,
  ].join("\n");
}

function formatStorageLsUserMessage(result: StorageLsResponse, requestedObjectKey: string): string {
  const objectId = result.object_id ?? result.key;
  return `${objectId} with ${requestedObjectKey} is ${result.size_bytes} in ${result.bucket}`;
}

export function createCloudCommand(
  options: CreateCloudCommandOptions = {},
): OpenClawPluginCommandDefinition {
  const backupBuilder = options.buildBackupObjectFn ?? buildBackupObject;
  const requestPriceStorageQuote =
    options.requestPriceStorageQuoteFn ?? requestPriceStorageViaProxy;
  const requestStorageUpload = options.requestStorageUploadFn ?? requestStorageUploadViaProxy;
  const resolveWalletKey = options.resolveWalletPrivateKeyFn ?? resolveWalletPrivateKey;
  const createPayment = options.createPaymentFetchFn ?? createPaymentFetch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowDateFn = options.nowDateFn ?? (() => new Date());
  const idempotencyKeyFn = options.idempotencyKeyFn ?? randomUUID;
  const requestStorageLs = options.requestStorageLsFn ?? requestStorageLsViaProxy;
  const requestStorageDownload = options.requestStorageDownloadFn ?? requestStorageDownloadViaProxy;
  const requestStorageDelete = options.requestStorageDeleteFn ?? requestStorageDeleteViaProxy;
  const objectLogHomeDir = options.objectLogHomeDir ?? options.backupOptions?.homeDir;

  return {
    name: "mnemospark-cloud",
    description: "Manage mnemospark cloud storage workflow commands",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const parsed = parseCloudArgs(ctx.args);

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

      if (parsed.mode === "upload-invalid") {
        return {
          text: `Cannot upload storage object: required arguments are ${REQUIRED_UPLOAD}.`,
          isError: true,
        };
      }

      if (parsed.mode === "ls-invalid") {
        return {
          text: `Cannot list storage object: required arguments are ${REQUIRED_STORAGE_OBJECT}.`,
          isError: true,
        };
      }

      if (parsed.mode === "download-invalid") {
        return {
          text: `Cannot download file: required arguments are ${REQUIRED_STORAGE_OBJECT}.`,
          isError: true,
        };
      }

      if (parsed.mode === "delete-invalid") {
        return {
          text: `Cannot delete file: required arguments are ${REQUIRED_STORAGE_OBJECT}.`,
          isError: true,
        };
      }

      if (parsed.mode === "backup") {
        try {
          const result = await backupBuilder(parsed.backupTarget, options.backupOptions);
          return {
            text: `Your object-id is ${result.objectId} your object-id-hash is ${result.objectIdHash} and your object-size is ${result.objectSizeGb}`,
          };
        } catch (err) {
          if (err instanceof UnsupportedBackupPlatformError) {
            return {
              text: "Cloud backup is only supported on macOS and Linux.",
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
        try {
          const quote = await requestPriceStorageQuote(
            parsed.priceStorageRequest,
            options.proxyQuoteOptions,
          );
          await appendPriceStorageQuoteLog(quote, objectLogHomeDir);
          return {
            text: formatPriceStorageUserMessage(quote),
          };
        } catch {
          return {
            text: "Cannot price storage",
            isError: true,
          };
        }
      }

      if (parsed.mode === "upload") {
        try {
          const loggedQuote = await findLoggedPriceStorageQuote(
            parsed.uploadRequest.quote_id,
            objectLogHomeDir,
          );
          if (!loggedQuote) {
            return {
              text: "Cannot upload storage object: quote-id not found in object.log. Run /mnemospark cloud price-storage first.",
              isError: true,
            };
          }

          if (
            loggedQuote.walletAddress.toLowerCase() !==
              parsed.uploadRequest.wallet_address.toLowerCase() ||
            loggedQuote.objectId !== parsed.uploadRequest.object_id ||
            loggedQuote.objectIdHash.toLowerCase() !==
              parsed.uploadRequest.object_id_hash.toLowerCase()
          ) {
            return {
              text: "Cannot upload storage object: quote details do not match wallet/object arguments.",
              isError: true,
            };
          }

          const archivePath = join(
            options.backupOptions?.tmpDir ?? DEFAULT_BACKUP_DIR,
            parsed.uploadRequest.object_id,
          );
          let archiveStats;
          try {
            archiveStats = await stat(archivePath);
          } catch {
            return {
              text: `Cannot upload storage object: local archive not found at ${archivePath}. Run /mnemospark cloud backup first.`,
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

          const walletKey = await resolveWalletKey(objectLogHomeDir);
          const walletAccount = privateKeyToAccount(walletKey);
          if (
            walletAccount.address.toLowerCase() !==
            parsed.uploadRequest.wallet_address.toLowerCase()
          ) {
            return {
              text: `Cannot upload storage object: wallet key address ${walletAccount.address} does not match --wallet-address ${parsed.uploadRequest.wallet_address}.`,
              isError: true,
            };
          }

          const preparedPayload = await prepareUploadPayload(
            archivePath,
            parsed.uploadRequest.wallet_address,
            objectLogHomeDir,
          );
          const paymentFetch = createPayment(walletKey).fetch;
          const idempotencyKey = idempotencyKeyFn();

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
              fetchImpl: (input, init) => paymentFetch(input, init),
            },
          );

          await uploadPresignedObjectIfNeeded(
            uploadResponse,
            preparedPayload.payload.mode,
            preparedPayload.encryptedContent,
            fetchImpl,
          );
          await appendStorageUploadLog(uploadResponse, objectLogHomeDir, nowDateFn);
          const cronStoragePriceCandidate =
            uploadResponse.storage_price ?? loggedQuote.storagePrice;
          const cronStoragePrice =
            Number.isFinite(cronStoragePriceCandidate) && cronStoragePriceCandidate > 0
              ? cronStoragePriceCandidate
              : loggedQuote.storagePrice;
          const cronJob = await createStoragePaymentCronJob(
            uploadResponse,
            cronStoragePrice,
            objectLogHomeDir,
            nowDateFn,
          );
          await maybeCleanupLocalBackupArchive(archivePath);

          return {
            text: formatStorageUploadUserMessage(uploadResponse, cronJob.cronId),
          };
        } catch (error) {
          return {
            text: extractUploadErrorMessage(error) ?? "Cannot upload storage object",
            isError: true,
          };
        }
      }

      if (parsed.mode === "ls") {
        try {
          const lsResult = await requestStorageLs(
            parsed.storageObjectRequest,
            options.proxyStorageOptions,
          );
          if (!lsResult.success) {
            throw new Error("ls failed");
          }
          return {
            text: formatStorageLsUserMessage(lsResult, parsed.storageObjectRequest.object_key),
          };
        } catch {
          return {
            text: "Cannot list storage object",
            isError: true,
          };
        }
      }

      if (parsed.mode === "download") {
        try {
          const downloadResult = await requestStorageDownload(
            parsed.storageObjectRequest,
            options.proxyStorageOptions,
          );
          if (!downloadResult.success) {
            throw new Error("download failed");
          }
          return {
            text: `File ${parsed.storageObjectRequest.object_key} downloaded`,
          };
        } catch {
          return {
            text: "Cannot download file",
            isError: true,
          };
        }
      }

      if (parsed.mode === "delete") {
        try {
          const deleteResult = await requestStorageDelete(
            parsed.storageObjectRequest,
            options.proxyStorageOptions,
          );
          if (!deleteResult.success) {
            throw new Error("delete failed");
          }
        } catch {
          return {
            text: "Cannot delete file",
            isError: true,
          };
        }
        let cronEntry: LoggedStoragePaymentCron | null = null;
        let cronDeleted = false;
        try {
          cronEntry = await findLoggedStoragePaymentCronByObjectKey(
            parsed.storageObjectRequest.object_key,
            objectLogHomeDir,
          );
          cronDeleted = cronEntry
            ? await removeStoragePaymentCronJob(cronEntry.cronId, objectLogHomeDir)
            : false;
        } catch {
          // Cloud delete already succeeded; cron lookup/removal is best-effort.
          // Report success without implying the delete failed.
        }
        return {
          text: formatStorageDeleteUserMessage(
            parsed.storageObjectRequest.object_key,
            cronEntry?.cronId ?? null,
            cronDeleted,
          ),
        };
      }

      return {
        text: CLOUD_HELP_TEXT,
        isError: true,
      };
    },
  };
}

export type { BackupObjectOptions, BackupObjectResult, CreateCloudCommandOptions, ParsedCloudArgs };
