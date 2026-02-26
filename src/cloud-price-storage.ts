import { PROXY_PORT } from "./config.js";

export const PRICE_STORAGE_PROXY_PATH = "/mnemospark/price-storage";
export const UPLOAD_PROXY_PATH = "/mnemospark/upload";

export type PriceStorageQuoteRequest = {
  wallet_address: string;
  object_id: string;
  object_id_hash: string;
  gb: number;
  provider: string;
  region: string;
};

export type PriceStorageQuoteResponse = {
  timestamp: string;
  quote_id: string;
  storage_price: number;
  addr: string;
  object_id: string;
  object_id_hash: string;
  object_size_gb: number;
  provider: string;
  location: string;
};

export type UploadPayload = {
  mode: "inline" | "presigned";
  content_base64?: string;
  content_sha256: string;
  content_length_bytes: number;
  wrapped_dek: string;
  encryption_algorithm: "AES-256-GCM";
  bucket_name_hint: string;
  key_store_path_hint: string;
};

export type StorageUploadRequest = {
  quote_id: string;
  wallet_address: string;
  object_id: string;
  object_id_hash: string;
  quoted_storage_price: number;
  payload: UploadPayload;
};

export type StorageUploadResponse = {
  quote_id: string;
  addr: string;
  addr_hash?: string;
  trans_id?: string;
  storage_price?: number;
  object_id: string;
  object_key: string;
  provider: string;
  bucket_name: string;
  location: string;
  upload_url?: string;
  upload_headers?: Record<string, string>;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ProxyQuoteOptions = {
  proxyBaseUrl?: string;
  fetchImpl?: FetchLike;
};

type ProxyUploadOptions = {
  proxyBaseUrl?: string;
  fetchImpl?: FetchLike;
  idempotencyKey?: string;
};

type BackendQuoteOptions = {
  backendBaseUrl?: string;
  backendApiKey?: string;
  fetchImpl?: FetchLike;
};

type BackendUploadOptions = {
  backendBaseUrl?: string;
  backendApiKey?: string;
  fetchImpl?: FetchLike;
  paymentSignature?: string;
  legacyPayment?: string;
  idempotencyKey?: string;
};

type BackendQuoteForwardResult = {
  status: number;
  bodyText: string;
  contentType: string;
  paymentRequired?: string;
  paymentResponse?: string;
};

type BackendUploadForwardResult = {
  status: number;
  bodyText: string;
  contentType: string;
  paymentRequired?: string;
  paymentResponse?: string;
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

function asStringRecord(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      return null;
    }
    output[key] = entry;
  }
  return output;
}

export function parsePriceStorageQuoteRequest(payload: unknown): PriceStorageQuoteRequest | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const walletAddress = asNonEmptyString(record.wallet_address);
  const objectId = asNonEmptyString(record.object_id);
  const objectIdHash = asNonEmptyString(record.object_id_hash);
  const gb = asNumber(record.gb);
  const provider = asNonEmptyString(record.provider);
  const region = asNonEmptyString(record.region);

  if (!walletAddress || !objectId || !objectIdHash || gb === null || !provider || !region) {
    return null;
  }

  return {
    wallet_address: walletAddress,
    object_id: objectId,
    object_id_hash: objectIdHash,
    gb,
    provider,
    region,
  };
}

export function parsePriceStorageQuoteResponse(payload: unknown): PriceStorageQuoteResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Invalid price-storage response payload");
  }

  const timestamp = asNonEmptyString(record.timestamp);
  const quoteId = asNonEmptyString(record.quote_id);
  const storagePrice = asNumber(record.storage_price);
  const addr = asNonEmptyString(record.addr);
  const objectId = asNonEmptyString(record.object_id);
  const objectIdHash = asNonEmptyString(record.object_id_hash);
  const objectSizeGb = asNumber(record.object_size_gb);
  const provider = asNonEmptyString(record.provider);
  const location = asNonEmptyString(record.location);

  if (
    !timestamp ||
    !quoteId ||
    storagePrice === null ||
    !addr ||
    !objectId ||
    !objectIdHash ||
    objectSizeGb === null ||
    !provider ||
    !location
  ) {
    throw new Error("Price-storage response is missing required fields");
  }

  return {
    timestamp,
    quote_id: quoteId,
    storage_price: storagePrice,
    addr,
    object_id: objectId,
    object_id_hash: objectIdHash,
    object_size_gb: objectSizeGb,
    provider,
    location,
  };
}

export function parseStorageUploadRequest(payload: unknown): StorageUploadRequest | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const quoteId = asNonEmptyString(record.quote_id);
  const walletAddress = asNonEmptyString(record.wallet_address);
  const objectId = asNonEmptyString(record.object_id);
  const objectIdHash = asNonEmptyString(record.object_id_hash);
  const quotedStoragePrice = asNumber(record.quoted_storage_price);

  const payloadRecord = asRecord(record.payload);
  if (!payloadRecord) {
    return null;
  }

  const modeRaw = asNonEmptyString(payloadRecord.mode);
  const mode = modeRaw === "inline" || modeRaw === "presigned" ? modeRaw : null;
  const contentBase64 =
    payloadRecord.content_base64 === undefined
      ? undefined
      : asNonEmptyString(payloadRecord.content_base64);
  const contentSha256 = asNonEmptyString(payloadRecord.content_sha256);
  const contentLengthBytes = asNumber(payloadRecord.content_length_bytes);
  const wrappedDek = asNonEmptyString(payloadRecord.wrapped_dek);
  const encryptionAlgorithm = asNonEmptyString(payloadRecord.encryption_algorithm);
  const bucketNameHint = asNonEmptyString(payloadRecord.bucket_name_hint);
  const keyStorePathHint = asNonEmptyString(payloadRecord.key_store_path_hint);

  if (
    !quoteId ||
    !walletAddress ||
    !objectId ||
    !objectIdHash ||
    quotedStoragePrice === null ||
    !mode ||
    !contentSha256 ||
    contentLengthBytes === null ||
    !wrappedDek ||
    encryptionAlgorithm !== "AES-256-GCM" ||
    !bucketNameHint ||
    !keyStorePathHint
  ) {
    return null;
  }

  if (mode === "inline" && !contentBase64) {
    return null;
  }

  return {
    quote_id: quoteId,
    wallet_address: walletAddress,
    object_id: objectId,
    object_id_hash: objectIdHash,
    quoted_storage_price: quotedStoragePrice,
    payload: {
      mode,
      content_base64: contentBase64 ?? undefined,
      content_sha256: contentSha256,
      content_length_bytes: contentLengthBytes,
      wrapped_dek: wrappedDek,
      encryption_algorithm: "AES-256-GCM",
      bucket_name_hint: bucketNameHint,
      key_store_path_hint: keyStorePathHint,
    },
  };
}

export function parseStorageUploadResponse(payload: unknown): StorageUploadResponse {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Invalid upload response payload");
  }

  const quoteId = asNonEmptyString(record.quote_id);
  const addr = asNonEmptyString(record.addr);
  const addrHash = asNonEmptyString(record.addr_hash);
  const transId = asNonEmptyString(record.trans_id);
  const storagePrice = asNumber(record.storage_price);
  const objectId = asNonEmptyString(record.object_id);
  const objectKey = asNonEmptyString(record.object_key);
  const provider = asNonEmptyString(record.provider);
  const bucketName = asNonEmptyString(record.bucket_name);
  const location = asNonEmptyString(record.location);
  const uploadUrl = asNonEmptyString(record.upload_url);
  const uploadHeaders =
    record.upload_headers === undefined ? undefined : asStringRecord(record.upload_headers);

  if (!quoteId || !addr || !objectId || !objectKey || !provider || !bucketName || !location) {
    throw new Error("Upload response is missing required fields");
  }

  if (record.upload_headers !== undefined && !uploadHeaders) {
    throw new Error("Upload response has invalid upload_headers");
  }

  return {
    quote_id: quoteId,
    addr,
    addr_hash: addrHash ?? undefined,
    trans_id: transId ?? undefined,
    storage_price: storagePrice ?? undefined,
    object_id: objectId,
    object_key: objectKey,
    provider,
    bucket_name: bucketName,
    location,
    upload_url: uploadUrl ?? undefined,
    upload_headers: uploadHeaders ?? undefined,
  };
}

function normalizePaymentRequired(headers: Headers): string | undefined {
  return headers.get("PAYMENT-REQUIRED") ?? headers.get("x-payment-required") ?? undefined;
}

function normalizePaymentResponse(headers: Headers): string | undefined {
  return headers.get("PAYMENT-RESPONSE") ?? headers.get("x-payment-response") ?? undefined;
}

export async function requestPriceStorageViaProxy(
  request: PriceStorageQuoteRequest,
  options: ProxyQuoteOptions = {},
): Promise<PriceStorageQuoteResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(
    options.proxyBaseUrl ?? `http://127.0.0.1:${PROXY_PORT.toString()}`,
  );
  const response = await fetchImpl(`${baseUrl}${PRICE_STORAGE_PROXY_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(responseBody || `Price-storage proxy failed with status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new Error("Price-storage proxy returned invalid JSON");
  }
  return parsePriceStorageQuoteResponse(payload);
}

export async function requestStorageUploadViaProxy(
  request: StorageUploadRequest,
  options: ProxyUploadOptions = {},
): Promise<StorageUploadResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(
    options.proxyBaseUrl ?? `http://127.0.0.1:${PROXY_PORT.toString()}`,
  );
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.idempotencyKey && options.idempotencyKey.trim().length > 0) {
    requestHeaders["Idempotency-Key"] = options.idempotencyKey.trim();
  }

  const response = await fetchImpl(`${baseUrl}${UPLOAD_PROXY_PATH}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(request),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(responseBody || `Upload proxy failed with status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new Error("Upload proxy returned invalid JSON");
  }
  return parseStorageUploadResponse(payload);
}

export async function forwardPriceStorageToBackend(
  request: PriceStorageQuoteRequest,
  options: BackendQuoteOptions = {},
): Promise<BackendQuoteForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const backendBaseUrl = (options.backendBaseUrl ?? "").trim();
  const backendApiKey = (options.backendApiKey ?? "").trim();

  if (!backendBaseUrl) {
    throw new Error("MNEMOSPARK_BACKEND_API_BASE_URL is not configured");
  }
  if (!backendApiKey) {
    throw new Error("MNEMOSPARK_BACKEND_API_KEY is not configured");
  }

  const targetUrl = `${normalizeBaseUrl(backendBaseUrl)}/price-storage`;
  const response = await fetchImpl(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": backendApiKey,
    },
    body: JSON.stringify(request),
  });

  return {
    status: response.status,
    bodyText: await response.text(),
    contentType: response.headers.get("content-type") ?? "application/json",
    paymentRequired: normalizePaymentRequired(response.headers),
    paymentResponse: normalizePaymentResponse(response.headers),
  };
}

export async function forwardStorageUploadToBackend(
  request: StorageUploadRequest,
  options: BackendUploadOptions = {},
): Promise<BackendUploadForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const backendBaseUrl = (options.backendBaseUrl ?? "").trim();
  const backendApiKey = (options.backendApiKey ?? "").trim();

  if (!backendBaseUrl) {
    throw new Error("MNEMOSPARK_BACKEND_API_BASE_URL is not configured");
  }
  if (!backendApiKey) {
    throw new Error("MNEMOSPARK_BACKEND_API_KEY is not configured");
  }

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": backendApiKey,
  };

  if (options.idempotencyKey && options.idempotencyKey.trim().length > 0) {
    requestHeaders["Idempotency-Key"] = options.idempotencyKey.trim();
  }

  const paymentSignature = options.paymentSignature?.trim();
  const legacyPayment = options.legacyPayment?.trim();
  if (paymentSignature) {
    requestHeaders["PAYMENT-SIGNATURE"] = paymentSignature;
    requestHeaders["x-payment"] = paymentSignature;
  }
  if (legacyPayment) {
    requestHeaders["x-payment"] = legacyPayment;
    requestHeaders["PAYMENT-SIGNATURE"] = requestHeaders["PAYMENT-SIGNATURE"] ?? legacyPayment;
  }

  const targetUrl = `${normalizeBaseUrl(backendBaseUrl)}/storage/upload`;
  const response = await fetchImpl(targetUrl, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(request),
  });

  return {
    status: response.status,
    bodyText: await response.text(),
    contentType: response.headers.get("content-type") ?? "application/json",
    paymentRequired: normalizePaymentRequired(response.headers),
    paymentResponse: normalizePaymentResponse(response.headers),
  };
}

export type {
  BackendQuoteForwardResult,
  BackendQuoteOptions,
  BackendUploadForwardResult,
  BackendUploadOptions,
  ProxyQuoteOptions,
  ProxyUploadOptions,
};
