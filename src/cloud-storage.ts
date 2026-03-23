import { createDecipheriv } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import {
  AES_GCM_NONCE_BYTES,
  AES_KEY_BYTES,
  parseStoredAes256Key,
  resolveWalletKekPath,
} from "./cloud-storage-crypto.js";
import { PROXY_PORT } from "./config.js";
import { applyCorrelationHeaders, type RequestCorrelation } from "./cloud-correlation.js";
import {
  asNonEmptyString,
  asNumber,
  asRecord,
  normalizeBaseUrl,
  normalizePaymentRequired,
  normalizePaymentResponse,
} from "./cloud-utils.js";
import { normalizeWalletSignature } from "./wallet-signature.js";

export const STORAGE_LS_PROXY_PATH = "/mnemospark/storage/ls";
export const STORAGE_DOWNLOAD_PROXY_PATH = "/mnemospark/storage/download";
export const STORAGE_DELETE_PROXY_PATH = "/mnemospark/storage/delete";

export type StorageObjectRequest = {
  wallet_address: string;
  object_key: string;
  location?: string;
};

/** POST /storage/ls body: wallet required; omit object_key for S3 list mode. */
export type StorageLsRequest = {
  wallet_address: string;
  object_key?: string;
  location?: string;
  continuation_token?: string;
  max_keys?: number;
  prefix?: string;
};

export type StorageLsStatResponse = {
  mode: "stat";
  success: boolean;
  key: string;
  size_bytes: number;
  bucket: string;
  object_id?: string;
};

export type StorageLsListObject = {
  key: string;
  size_bytes: number;
  last_modified?: string;
};

export type StorageLsListResponse = {
  mode: "list";
  success: boolean;
  list_mode: true;
  bucket: string;
  objects: StorageLsListObject[];
  is_truncated: boolean;
  next_continuation_token: string | null;
};

export type StorageLsResponse = StorageLsStatResponse | StorageLsListResponse;

export function isStorageLsListResponse(r: StorageLsResponse): r is StorageLsListResponse {
  return r.mode === "list";
}

export type StorageDeleteResponse = {
  success: boolean;
  key: string;
  bucket: string;
  bucket_deleted: boolean;
};

export type StorageDownloadProxyResponse = {
  success: boolean;
  key: string;
  file_path: string;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ProxyStorageOptions = {
  proxyBaseUrl?: string;
  fetchImpl?: FetchLike;
  correlation?: RequestCorrelation;
  /** Proxy-only: preferred on-disk basename under the download directory (not sent to the backend). */
  downloadLocalBasename?: string;
};

type BackendStorageOptions = {
  backendBaseUrl?: string;
  walletSignature?: string;
  fetchImpl?: FetchLike;
};

type BackendStorageForwardResult = {
  status: number;
  bodyText: string;
  bodyBuffer: Buffer;
  contentType: string;
  contentDisposition?: string;
  paymentRequired?: string;
  paymentResponse?: string;
};

type DownloadStorageToDiskOptions = {
  outputDir?: string;
  homeDir?: string;
  fetchImpl?: FetchLike;
  /** When set, used as the relative path key for resolveDownloadPath instead of object_key. */
  localOutputBasename?: string;
};

type DownloadStorageToDiskResult = {
  key: string;
  filePath: string;
  bytesWritten: number;
};

const AES_GCM_TAG_BYTES = 16;

function asBooleanOrDefault(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return defaultValue;
}

function parseJsonText(text: string, errorMessage: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(errorMessage);
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new Error(errorMessage);
  }
  return record;
}

const MAX_LOCAL_FRIENDLY_BASENAME_LEN = 200;

/**
 * Maps a user-supplied friendly name to a single safe filename segment for local backup/download paths.
 * Throws if the result would be empty or invalid.
 */
export function sanitizeFriendlyNameForLocalBasename(raw: string): string {
  const normalized = raw.replace(/\\/g, "/").trim();
  if (!normalized) {
    throw new Error("Friendly name is empty");
  }
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  const segment = segments[segments.length - 1] ?? "";
  if (!segment || segment === "." || segment === "..") {
    throw new Error("Invalid friendly name for local file path");
  }
  // eslint-disable-next-line no-control-regex -- intentional strip of C0 control chars for filenames
  const noCtrl = segment.replace(/[\x00-\x1f]/g, "").trim();
  if (!noCtrl || noCtrl === "." || noCtrl === "..") {
    throw new Error("Invalid friendly name for local file path");
  }
  return noCtrl.length > MAX_LOCAL_FRIENDLY_BASENAME_LEN
    ? noCtrl.slice(0, MAX_LOCAL_FRIENDLY_BASENAME_LEN)
    : noCtrl;
}

function sanitizeObjectKeyToRelativePath(objectKey: string): string {
  const normalized = objectKey.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (segments.length === 0) {
    return "downloaded-object";
  }
  return join(...segments);
}

function resolveDownloadPath(outputDir: string, objectKey: string): string {
  const resolvedOutputDir = resolve(outputDir);
  const relativeObjectPath = sanitizeObjectKeyToRelativePath(objectKey);
  const resolvedTargetPath = resolve(resolvedOutputDir, relativeObjectPath);

  if (
    resolvedTargetPath !== resolvedOutputDir &&
    !resolvedTargetPath.startsWith(`${resolvedOutputDir}${sep}`)
  ) {
    throw new Error("Resolved download target escapes output directory");
  }

  return resolvedTargetPath;
}

function parseFilenameFromContentDisposition(contentDisposition?: string): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return undefined;
}

async function loadWalletKek(walletAddress: string, homeDir?: string): Promise<Buffer> {
  const keyPath = resolveWalletKekPath(walletAddress, homeDir);
  const raw = await readFile(keyPath);
  return parseStoredAes256Key(raw, "Invalid KEK file format");
}

function decryptAesGcm(payload: Buffer, key: Buffer): Buffer {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error("Expected 32-byte AES key");
  }
  if (payload.length <= AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
    throw new Error("Encrypted payload is too short");
  }

  const nonce = payload.subarray(0, AES_GCM_NONCE_BYTES);
  const tag = payload.subarray(payload.length - AES_GCM_TAG_BYTES);
  const ciphertext = payload.subarray(AES_GCM_NONCE_BYTES, payload.length - AES_GCM_TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function decryptDownloadBytes(
  encryptedBytes: Buffer,
  wrappedDekBase64: string,
  walletAddress: string,
  homeDir?: string,
): Promise<Buffer> {
  const kek = await loadWalletKek(walletAddress, homeDir);
  const wrappedDek = Buffer.from(wrappedDekBase64, "base64");
  const dek = decryptAesGcm(wrappedDek, kek);
  if (dek.length !== AES_KEY_BYTES) {
    throw new Error("Unwrapped DEK length is invalid");
  }
  return decryptAesGcm(encryptedBytes, dek);
}

async function requestJsonViaProxy<T>(
  proxyPath: string,
  jsonBody: Record<string, unknown>,
  parser: (payload: unknown) => T,
  options: ProxyStorageOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(
    options.proxyBaseUrl ?? `http://127.0.0.1:${PROXY_PORT.toString()}`,
  );

  const response = await fetchImpl(`${baseUrl}${proxyPath}`, {
    method: "POST",
    headers: applyCorrelationHeaders(
      {
        "Content-Type": "application/json",
      },
      options.correlation,
    ),
    body: JSON.stringify(jsonBody),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(bodyText || `Cloud storage proxy failed with status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error("Cloud storage proxy returned invalid JSON");
  }

  return parser(payload);
}

async function forwardStorageToBackend(
  path: string,
  method: "POST" | "DELETE" | "GET",
  jsonBody: Record<string, unknown>,
  options: BackendStorageOptions = {},
): Promise<BackendStorageForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const backendBaseUrl = (options.backendBaseUrl ?? "").trim();
  const walletSignature = normalizeWalletSignature(options.walletSignature);

  if (!backendBaseUrl) {
    throw new Error("MNEMOSPARK_BACKEND_API_BASE_URL is not configured");
  }
  if (!walletSignature) {
    throw new Error(
      "Wallet required for storage endpoints: wallet key must be present to sign requests.",
    );
  }

  const targetUrl = `${normalizeBaseUrl(backendBaseUrl)}${path}`;
  const response = await fetchImpl(targetUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Signature": walletSignature,
    },
    body: JSON.stringify(jsonBody),
  });

  const bodyBuffer = Buffer.from(await response.arrayBuffer());

  return {
    status: response.status,
    bodyText: bodyBuffer.toString("utf-8"),
    bodyBuffer,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    contentDisposition: response.headers.get("content-disposition") ?? undefined,
    paymentRequired: normalizePaymentRequired(response.headers),
    paymentResponse: normalizePaymentResponse(response.headers),
  };
}

export function parseStorageObjectRequest(payload: unknown): StorageObjectRequest | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const walletAddress = asNonEmptyString(record.wallet_address);
  const objectKey = asNonEmptyString(record.object_key);
  const location = asNonEmptyString(record.location) ?? undefined;

  if (!walletAddress || !objectKey) {
    return null;
  }

  return {
    wallet_address: walletAddress,
    object_key: objectKey,
    location,
  };
}

/** Proxy POST body for download: backend fields plus optional local filename hint (stripped before backend forward). */
export function parseProxyStorageDownloadPayload(payload: unknown): {
  request: StorageObjectRequest;
  localBasename?: string;
} | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const walletAddress = asNonEmptyString(record.wallet_address);
  const objectKey = asNonEmptyString(record.object_key);
  const location = asNonEmptyString(record.location) ?? undefined;
  if (!walletAddress || !objectKey) {
    return null;
  }
  const localRaw = asNonEmptyString(record.mnemospark_local_filename) ?? undefined;
  return {
    request: {
      wallet_address: walletAddress,
      object_key: objectKey,
      ...(location ? { location } : {}),
    },
    ...(localRaw ? { localBasename: localRaw } : {}),
  };
}

function jsonBodyForObjectRequest(request: StorageObjectRequest): Record<string, unknown> {
  const o: Record<string, unknown> = {
    wallet_address: request.wallet_address,
    object_key: request.object_key,
  };
  if (request.location) {
    o.location = request.location;
  }
  return o;
}

function jsonBodyForProxyDownloadRequest(
  request: StorageObjectRequest,
  downloadLocalBasename?: string,
): Record<string, unknown> {
  const body = jsonBodyForObjectRequest(request);
  const trimmed = downloadLocalBasename?.trim();
  if (trimmed) {
    body.mnemospark_local_filename = trimmed;
  }
  return body;
}

export function jsonBodyForLsRequest(request: StorageLsRequest): Record<string, unknown> {
  const o: Record<string, unknown> = { wallet_address: request.wallet_address };
  if (request.object_key) {
    o.object_key = request.object_key;
  }
  if (request.location) {
    o.location = request.location;
  }
  if (request.continuation_token) {
    o.continuation_token = request.continuation_token;
  }
  if (typeof request.max_keys === "number") {
    o.max_keys = request.max_keys;
  }
  if (request.prefix) {
    o.prefix = request.prefix;
  }
  return o;
}

/** Proxy / local CLI: parse JSON body for /storage/ls (object_key optional). */
export function parseStorageLsRequestPayload(payload: unknown): StorageLsRequest | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const walletAddress = asNonEmptyString(record.wallet_address);
  if (!walletAddress) {
    return null;
  }
  const objectKey = asNonEmptyString(record.object_key) ?? undefined;
  const location = asNonEmptyString(record.location) ?? undefined;
  const continuation_token = asNonEmptyString(record.continuation_token) ?? undefined;
  const maxRaw = asNumber(record.max_keys);
  const max_keys = maxRaw !== null && Number.isInteger(maxRaw) && maxRaw >= 1 ? maxRaw : undefined;
  const prefix = asNonEmptyString(record.prefix) ?? undefined;
  return {
    wallet_address: walletAddress,
    ...(objectKey ? { object_key: objectKey } : {}),
    ...(location ? { location } : {}),
    ...(continuation_token ? { continuation_token } : {}),
    ...(typeof max_keys === "number" ? { max_keys } : {}),
    ...(prefix ? { prefix } : {}),
  };
}

export function parseStorageLsResponse(payload: unknown): StorageLsResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Invalid ls response payload");
  }

  if (record.list_mode === true) {
    const bucket = asNonEmptyString(record.bucket) ?? asNonEmptyString(record.bucket_name);
    const rawObjects = record.objects;
    if (!bucket || !Array.isArray(rawObjects)) {
      throw new Error("ls list response is missing required fields");
    }
    const objects: StorageLsListObject[] = [];
    for (const item of rawObjects) {
      const row = asRecord(item);
      if (!row) {
        continue;
      }
      const key = asNonEmptyString(row.key);
      const sizeBytes = asNumber(row.size_bytes);
      if (!key || sizeBytes === null || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
        continue;
      }
      const last_modified = asNonEmptyString(row.last_modified) ?? undefined;
      objects.push({ key, size_bytes: sizeBytes, last_modified });
    }
    const is_truncated = asBooleanOrDefault(record.is_truncated, false);
    const nextRaw = record.next_continuation_token;
    const next_continuation_token =
      nextRaw === undefined || nextRaw === null ? null : String(nextRaw);
    return {
      mode: "list",
      success: asBooleanOrDefault(record.success, true),
      list_mode: true,
      bucket,
      objects,
      is_truncated,
      next_continuation_token,
    };
  }

  const key = asNonEmptyString(record.key) ?? asNonEmptyString(record.object_key);
  const sizeBytes = asNumber(record.size_bytes);
  const bucket = asNonEmptyString(record.bucket) ?? asNonEmptyString(record.bucket_name);
  const objectId = asNonEmptyString(record.object_id) ?? undefined;

  if (!key || sizeBytes === null || !bucket) {
    throw new Error("ls response is missing required fields");
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("ls response has invalid size_bytes; expected non-negative integer");
  }

  return {
    mode: "stat",
    success: asBooleanOrDefault(record.success, true),
    key,
    size_bytes: sizeBytes,
    bucket,
    object_id: objectId,
  };
}

export function parseStorageDeleteResponse(payload: unknown): StorageDeleteResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Invalid delete response payload");
  }

  const key = asNonEmptyString(record.key) ?? asNonEmptyString(record.object_key);
  const bucket = asNonEmptyString(record.bucket) ?? asNonEmptyString(record.bucket_name);
  const bucketDeleted = asBooleanOrDefault(record.bucket_deleted, false);

  if (!key || !bucket) {
    throw new Error("delete response is missing required fields");
  }

  return {
    success: asBooleanOrDefault(record.success, true),
    key,
    bucket,
    bucket_deleted: bucketDeleted,
  };
}

export function parseStorageDownloadProxyResponse(payload: unknown): StorageDownloadProxyResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Invalid download response payload");
  }

  const key = asNonEmptyString(record.key) ?? asNonEmptyString(record.object_key);
  const filePath = asNonEmptyString(record.file_path);
  if (!key || !filePath) {
    throw new Error("download response is missing required fields");
  }

  return {
    success: asBooleanOrDefault(record.success, true),
    key,
    file_path: filePath,
  };
}

export async function requestStorageLsViaProxy(
  request: StorageLsRequest,
  options: ProxyStorageOptions = {},
): Promise<StorageLsResponse> {
  return requestJsonViaProxy(
    STORAGE_LS_PROXY_PATH,
    jsonBodyForLsRequest(request),
    parseStorageLsResponse,
    options,
  );
}

export async function requestStorageDownloadViaProxy(
  request: StorageObjectRequest,
  options: ProxyStorageOptions = {},
): Promise<StorageDownloadProxyResponse> {
  return requestJsonViaProxy(
    STORAGE_DOWNLOAD_PROXY_PATH,
    jsonBodyForProxyDownloadRequest(request, options.downloadLocalBasename),
    parseStorageDownloadProxyResponse,
    options,
  );
}

export async function requestStorageDeleteViaProxy(
  request: StorageObjectRequest,
  options: ProxyStorageOptions = {},
): Promise<StorageDeleteResponse> {
  return requestJsonViaProxy(
    STORAGE_DELETE_PROXY_PATH,
    jsonBodyForObjectRequest(request),
    parseStorageDeleteResponse,
    options,
  );
}

export async function forwardStorageLsToBackend(
  request: StorageLsRequest,
  options: BackendStorageOptions = {},
): Promise<BackendStorageForwardResult> {
  return forwardStorageToBackend("/storage/ls", "POST", jsonBodyForLsRequest(request), options);
}

export async function forwardStorageDownloadToBackend(
  request: StorageObjectRequest,
  options: BackendStorageOptions = {},
): Promise<BackendStorageForwardResult> {
  return forwardStorageToBackend(
    "/storage/download",
    "POST",
    jsonBodyForObjectRequest(request),
    options,
  );
}

export async function forwardStorageDeleteToBackend(
  request: StorageObjectRequest,
  options: BackendStorageOptions = {},
): Promise<BackendStorageForwardResult> {
  return forwardStorageToBackend(
    "/storage/delete",
    "POST",
    jsonBodyForObjectRequest(request),
    options,
  );
}

export async function downloadStorageToDisk(
  request: StorageObjectRequest,
  backendResponse: BackendStorageForwardResult,
  options: DownloadStorageToDiskOptions = {},
): Promise<DownloadStorageToDiskResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const outputDir = options.outputDir ?? process.cwd();
  const homeDir = options.homeDir;

  let objectKey = request.object_key;
  let bytes = backendResponse.bodyBuffer;
  const contentType = backendResponse.contentType.toLowerCase();

  if (contentType.includes("application/json")) {
    const payload = parseJsonText(
      backendResponse.bodyText,
      "Download response was JSON but not parseable",
    );
    const payloadObjectKey =
      asNonEmptyString(payload.object_key) ??
      asNonEmptyString(payload.key) ??
      asNonEmptyString(payload.object_id);
    const downloadUrl = asNonEmptyString(payload.download_url);
    const inlineContent =
      asNonEmptyString(payload.content) ??
      asNonEmptyString(payload.body_base64) ??
      asNonEmptyString(payload.data);
    const payloadWrappedDek =
      asNonEmptyString(payload.wrapped_dek) ?? asNonEmptyString(payload["wrapped-dek"]);

    if (payloadObjectKey) {
      objectKey = payloadObjectKey;
    }

    if (downloadUrl) {
      const fileResponse = await fetchImpl(downloadUrl, { method: "GET" });
      if (!fileResponse.ok) {
        throw new Error(`Presigned download failed with status ${fileResponse.status}`);
      }
      bytes = Buffer.from(await fileResponse.arrayBuffer());
      const wrappedDekHeader = fileResponse.headers.get("x-amz-meta-wrapped-dek")?.trim();
      if (wrappedDekHeader) {
        bytes = await decryptDownloadBytes(
          bytes,
          wrappedDekHeader,
          request.wallet_address,
          homeDir,
        );
      }
    } else if (inlineContent) {
      bytes = Buffer.from(inlineContent, "base64");
      if (payloadWrappedDek) {
        bytes = await decryptDownloadBytes(
          bytes,
          payloadWrappedDek,
          request.wallet_address,
          homeDir,
        );
      }
    } else {
      throw new Error("Download response did not include download_url or inline content");
    }
  } else {
    const filenameFromHeader = parseFilenameFromContentDisposition(
      backendResponse.contentDisposition,
    );
    if (filenameFromHeader) {
      objectKey = filenameFromHeader;
    }
  }

  const pathKey =
    options.localOutputBasename?.trim() && options.localOutputBasename.trim().length > 0
      ? options.localOutputBasename.trim()
      : objectKey;
  const filePath = resolveDownloadPath(outputDir, pathKey);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);

  return {
    key: objectKey,
    filePath,
    bytesWritten: bytes.length,
  };
}

export type {
  BackendStorageForwardResult,
  BackendStorageOptions,
  DownloadStorageToDiskOptions,
  DownloadStorageToDiskResult,
  ProxyStorageOptions,
};
