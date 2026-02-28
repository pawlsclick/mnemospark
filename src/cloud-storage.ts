import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { PROXY_PORT } from "./config.js";
import { normalizeWalletSignature } from "./wallet-utils.js";

export const STORAGE_LS_PROXY_PATH = "/mnemospark/storage/ls";
export const STORAGE_DOWNLOAD_PROXY_PATH = "/mnemospark/storage/download";
export const STORAGE_DELETE_PROXY_PATH = "/mnemospark/storage/delete";

export type StorageObjectRequest = {
  wallet_address: string;
  object_key: string;
  location?: string;
};

export type StorageLsResponse = {
  success: boolean;
  key: string;
  size_bytes: number;
  bucket: string;
  object_id?: string;
};

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
  fetchImpl?: FetchLike;
};

type DownloadStorageToDiskResult = {
  key: string;
  filePath: string;
  bytesWritten: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePaymentRequired(headers: Headers): string | undefined {
  return headers.get("PAYMENT-REQUIRED") ?? headers.get("x-payment-required") ?? undefined;
}

function normalizePaymentResponse(headers: Headers): string | undefined {
  return headers.get("PAYMENT-RESPONSE") ?? headers.get("x-payment-response") ?? undefined;
}

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

async function requestJsonViaProxy<T>(
  proxyPath: string,
  request: StorageObjectRequest,
  parser: (payload: unknown) => T,
  options: ProxyStorageOptions = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(
    options.proxyBaseUrl ?? `http://127.0.0.1:${PROXY_PORT.toString()}`,
  );

  const response = await fetchImpl(`${baseUrl}${proxyPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
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
  request: StorageObjectRequest,
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
    body: JSON.stringify(request),
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

export function parseStorageLsResponse(payload: unknown): StorageLsResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Invalid ls response payload");
  }

  const key = asNonEmptyString(record.key) ?? asNonEmptyString(record.object_key);
  const sizeBytes = asNumber(record.size_bytes);
  const bucket = asNonEmptyString(record.bucket) ?? asNonEmptyString(record.bucket_name);
  const objectId = asNonEmptyString(record.object_id) ?? undefined;

  if (!key || sizeBytes === null || !bucket) {
    throw new Error("ls response is missing required fields");
  }

  return {
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
  request: StorageObjectRequest,
  options: ProxyStorageOptions = {},
): Promise<StorageLsResponse> {
  return requestJsonViaProxy(STORAGE_LS_PROXY_PATH, request, parseStorageLsResponse, options);
}

export async function requestStorageDownloadViaProxy(
  request: StorageObjectRequest,
  options: ProxyStorageOptions = {},
): Promise<StorageDownloadProxyResponse> {
  return requestJsonViaProxy(
    STORAGE_DOWNLOAD_PROXY_PATH,
    request,
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
    request,
    parseStorageDeleteResponse,
    options,
  );
}

export async function forwardStorageLsToBackend(
  request: StorageObjectRequest,
  options: BackendStorageOptions = {},
): Promise<BackendStorageForwardResult> {
  return forwardStorageToBackend("/storage/ls", "POST", request, options);
}

export async function forwardStorageDownloadToBackend(
  request: StorageObjectRequest,
  options: BackendStorageOptions = {},
): Promise<BackendStorageForwardResult> {
  return forwardStorageToBackend("/storage/download", "POST", request, options);
}

export async function forwardStorageDeleteToBackend(
  request: StorageObjectRequest,
  options: BackendStorageOptions = {},
): Promise<BackendStorageForwardResult> {
  return forwardStorageToBackend("/storage/delete", "POST", request, options);
}

export async function downloadStorageToDisk(
  request: StorageObjectRequest,
  backendResponse: BackendStorageForwardResult,
  options: DownloadStorageToDiskOptions = {},
): Promise<DownloadStorageToDiskResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const outputDir = options.outputDir ?? process.cwd();

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

    if (payloadObjectKey) {
      objectKey = payloadObjectKey;
    }

    if (downloadUrl) {
      const fileResponse = await fetchImpl(downloadUrl, { method: "GET" });
      if (!fileResponse.ok) {
        throw new Error(`Presigned download failed with status ${fileResponse.status}`);
      }
      bytes = Buffer.from(await fileResponse.arrayBuffer());
    } else if (inlineContent) {
      bytes = Buffer.from(inlineContent, "base64");
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

  const filePath = resolveDownloadPath(outputDir, objectKey);
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
