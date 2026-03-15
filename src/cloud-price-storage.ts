import { PROXY_PORT } from "./config.js";
import {
  asNonEmptyString,
  asNumber,
  asRecord,
  normalizeBaseUrl,
  normalizePaymentRequired,
  normalizePaymentResponse,
} from "./cloud-utils.js";
import { normalizeWalletSignature } from "./wallet-signature.js";

export const PRICE_STORAGE_PROXY_PATH = "/mnemospark/price-storage";
export const PAYMENT_SETTLE_PROXY_PATH = "/mnemospark/payment/settle";
export const UPLOAD_PROXY_PATH = "/mnemospark/upload";
export const UPLOAD_CONFIRM_PROXY_PATH = "/mnemospark/upload/confirm";

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

export type StorageUploadConfirmRequest = {
  quote_id: string;
  wallet_address: string;
  object_key: string;
  idempotency_key: string;
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
  confirmation_required?: boolean;
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
  maxRetries?: number;
};

type ProxyUploadConfirmOptions = {
  proxyBaseUrl?: string;
  fetchImpl?: FetchLike;
};

/**
 * Options for forwarding price-storage to the backend directly.
 * When backendBaseUrl is set, walletSignature is required (backend requires X-Wallet-Signature).
 * Use the proxy for price-storage if you do not have a wallet signature, or pass walletSignature.
 */
type BackendQuoteOptions = {
  backendBaseUrl?: string;
  /** Required when calling the backend directly. Omit only when using the proxy. */
  walletSignature?: string;
  fetchImpl?: FetchLike;
};

type BackendUploadOptions = {
  backendBaseUrl?: string;
  walletSignature?: string;
  fetchImpl?: FetchLike;
  idempotencyKey?: string;
};

type BackendUploadConfirmOptions = {
  backendBaseUrl?: string;
  walletSignature?: string;
  fetchImpl?: FetchLike;
};

/** Options for forwarding payment/settle to the backend. */
export type BackendSettleOptions = {
  backendBaseUrl?: string;
  walletSignature?: string;
  fetchImpl?: FetchLike;
  /** Optional payment authorization (PAYMENT-SIGNATURE / x-payment) for 402 retry. */
  paymentSignature?: string;
  legacyPayment?: string;
};

/** Options for requesting payment/settle via the proxy. */
export type ProxySettleOptions = {
  proxyBaseUrl?: string;
  fetchImpl?: FetchLike;
};

/** Result from forwarding payment/settle to the backend (or proxy). */
export type BackendSettleForwardResult = {
  status: number;
  bodyText: string;
  contentType: string;
  paymentRequired?: string;
  paymentResponse?: string;
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

export function parseStorageUploadConfirmRequest(
  payload: unknown,
): StorageUploadConfirmRequest | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const quoteId = asNonEmptyString(record.quote_id);
  const walletAddress = asNonEmptyString(record.wallet_address);
  const objectKey = asNonEmptyString(record.object_key);
  const idempotencyKey = asNonEmptyString(record.idempotency_key);

  if (!quoteId || !walletAddress || !objectKey || !idempotencyKey) {
    return null;
  }

  return {
    quote_id: quoteId,
    wallet_address: walletAddress,
    object_key: objectKey,
    idempotency_key: idempotencyKey,
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
  const confirmationRequired =
    typeof record.confirmation_required === "boolean" ? record.confirmation_required : undefined;

  if (!quoteId || !addr || !objectId || !objectKey || !provider || !bucketName || !location) {
    throw new Error("Upload response is missing required fields");
  }

  if (record.upload_headers !== undefined && !uploadHeaders) {
    throw new Error("Upload response has invalid upload_headers");
  }
  if (record.confirmation_required !== undefined && confirmationRequired === undefined) {
    throw new Error("Upload response has invalid confirmation_required");
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
    confirmation_required: confirmationRequired,
  };
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
  const maxRetries =
    typeof options.maxRetries === "number" &&
    Number.isFinite(options.maxRetries) &&
    options.maxRetries >= 0
      ? Math.floor(options.maxRetries)
      : 2;
  const baseUrl = normalizeBaseUrl(
    options.proxyBaseUrl ?? `http://127.0.0.1:${PROXY_PORT.toString()}`,
  );
  const targetUrl = `${baseUrl}${UPLOAD_PROXY_PATH}`;
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.idempotencyKey && options.idempotencyKey.trim().length > 0) {
    requestHeaders["Idempotency-Key"] = options.idempotencyKey.trim();
  }

  const requestBody = JSON.stringify(request);
  const sendUploadRequest = async (): Promise<{ response: Response; bodyText: string }> => {
    const response = await fetchImpl(targetUrl, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });
    return { response, bodyText: await response.text() };
  };

  let { response, bodyText: responseBody } = await sendUploadRequest();
  if (response.status === 207) {
    let parsed207: unknown;
    try {
      parsed207 = JSON.parse(responseBody);
    } catch {
      parsed207 = null;
    }
    const retryablePayload = asRecord(parsed207);
    if (retryablePayload?.upload_failed === true) {
      let transId = asNonEmptyString(retryablePayload.trans_id) ?? "unknown";
      let exhaustedRetryableFailures = true;

      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        try {
          ({ response, bodyText: responseBody } = await sendUploadRequest());
        } catch {
          continue;
        }

        if (response.ok && response.status !== 207) {
          let retryPayload: unknown;
          try {
            retryPayload = JSON.parse(responseBody);
          } catch {
            throw new Error("Upload proxy returned invalid JSON");
          }
          return parseStorageUploadResponse(retryPayload);
        }

        if (response.status === 207) {
          let retryParsed207: unknown;
          try {
            retryParsed207 = JSON.parse(responseBody);
          } catch {
            retryParsed207 = null;
          }
          const retryableRetryPayload = asRecord(retryParsed207);
          if (retryableRetryPayload?.upload_failed === true) {
            transId = asNonEmptyString(retryableRetryPayload.trans_id) ?? transId;
            continue;
          }
          exhaustedRetryableFailures = false;
          break;
        }
      }

      if (exhaustedRetryableFailures) {
        throw new Error(
          `Payment confirmed (trans_id: ${transId}) but file storage failed after ${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}. Contact support with your trans_id.`,
        );
      }
    }
  }

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

export async function requestStorageUploadConfirmViaProxy(
  request: StorageUploadConfirmRequest,
  options: ProxyUploadConfirmOptions = {},
): Promise<StorageUploadResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(
    options.proxyBaseUrl ?? `http://127.0.0.1:${PROXY_PORT.toString()}`,
  );
  const response = await fetchImpl(`${baseUrl}${UPLOAD_CONFIRM_PROXY_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(responseBody || `Upload confirm proxy failed with status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new Error("Upload confirm proxy returned invalid JSON");
  }
  return parseStorageUploadResponse(payload);
}

/**
 * Forwards a price-storage quote request to the backend API.
 * When calling the backend directly (backendBaseUrl set), wallet proof is required:
 * pass walletSignature or the backend will return 403. Use the proxy or provide walletSignature.
 */
export async function forwardPriceStorageToBackend(
  request: PriceStorageQuoteRequest,
  options: BackendQuoteOptions = {},
): Promise<BackendQuoteForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const backendBaseUrl = (options.backendBaseUrl ?? "").trim();
  const walletSignature = normalizeWalletSignature(options.walletSignature);

  if (!backendBaseUrl) {
    throw new Error("MNEMOSPARK_BACKEND_API_BASE_URL is not configured");
  }

  if (!walletSignature) {
    throw new Error(
      "Wallet proof is required for /price-storage when calling the backend directly. Use the proxy or provide walletSignature.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Wallet-Signature": walletSignature,
  };

  const targetUrl = `${normalizeBaseUrl(backendBaseUrl)}/price-storage`;
  const response = await fetchImpl(targetUrl, {
    method: "POST",
    headers,
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

/**
 * Forwards a payment/settle request to the backend API.
 * Use fetchImpl from createPaymentFetch for 402 handling (sign and retry).
 */
export async function forwardPaymentSettleToBackend(
  quoteId: string,
  walletAddress: string,
  options: BackendSettleOptions = {},
): Promise<BackendSettleForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const backendBaseUrl = (options.backendBaseUrl ?? "").trim();
  const walletSignature = normalizeWalletSignature(options.walletSignature);

  if (!backendBaseUrl) {
    throw new Error("MNEMOSPARK_BACKEND_API_BASE_URL is not configured");
  }
  if (!walletSignature) {
    throw new Error(
      "Wallet proof is required for /payment/settle when calling the backend directly.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Wallet-Signature": walletSignature,
  };
  const paymentSignature = options.paymentSignature?.trim();
  const legacyPayment = options.legacyPayment?.trim();
  if (paymentSignature) {
    headers["PAYMENT-SIGNATURE"] = paymentSignature;
    headers["x-payment"] = paymentSignature;
  }
  if (legacyPayment) {
    headers["x-payment"] = legacyPayment;
    if (!headers["PAYMENT-SIGNATURE"]) {
      headers["PAYMENT-SIGNATURE"] = legacyPayment;
    }
  }

  const targetUrl = `${normalizeBaseUrl(backendBaseUrl)}/payment/settle`;
  const response = await fetchImpl(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ quote_id: quoteId, wallet_address: walletAddress }),
  });

  return {
    status: response.status,
    bodyText: await response.text(),
    contentType: response.headers.get("content-type") ?? "application/json",
    paymentRequired: normalizePaymentRequired(response.headers),
    paymentResponse: normalizePaymentResponse(response.headers),
  };
}

/**
 * Sends payment/settle to the proxy (POST /mnemospark/payment/settle).
 * Use fetchImpl from createPaymentFetch for 402 handling.
 */
export async function requestPaymentSettleViaProxy(
  quoteId: string,
  walletAddress: string,
  options: ProxySettleOptions = {},
): Promise<BackendSettleForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(
    options.proxyBaseUrl ?? `http://127.0.0.1:${PROXY_PORT.toString()}`,
  );
  const targetUrl = `${baseUrl}${PAYMENT_SETTLE_PROXY_PATH}`;
  const response = await fetchImpl(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote_id: quoteId, wallet_address: walletAddress }),
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
  const walletSignature = normalizeWalletSignature(options.walletSignature);

  if (!backendBaseUrl) {
    throw new Error("MNEMOSPARK_BACKEND_API_BASE_URL is not configured");
  }
  if (!walletSignature) {
    throw new Error(
      "Wallet required for storage endpoints: wallet key must be present to sign requests.",
    );
  }

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Wallet-Signature": walletSignature,
  };

  if (options.idempotencyKey && options.idempotencyKey.trim().length > 0) {
    requestHeaders["Idempotency-Key"] = options.idempotencyKey.trim();
  }

  // Payment is settled via POST /payment/settle before upload; backend checks the ledger.
  // Do not send PAYMENT-SIGNATURE / x-payment on upload.

  const payloadHints = request.payload as UploadPayload & {
    object_key?: unknown;
    object_key_hint?: unknown;
    provider?: unknown;
    provider_hint?: unknown;
    location?: unknown;
    location_hint?: unknown;
  };
  const requestHints = request as StorageUploadRequest & {
    object_key?: unknown;
    provider?: unknown;
    location?: unknown;
  };
  const objectKey =
    asNonEmptyString(requestHints.object_key) ??
    asNonEmptyString(payloadHints.object_key) ??
    asNonEmptyString(payloadHints.object_key_hint) ??
    request.object_id;
  const provider =
    asNonEmptyString(requestHints.provider) ??
    asNonEmptyString(payloadHints.provider) ??
    asNonEmptyString(payloadHints.provider_hint);
  const location =
    asNonEmptyString(requestHints.location) ??
    asNonEmptyString(payloadHints.location) ??
    asNonEmptyString(payloadHints.location_hint);

  const backendRequestBody: Record<string, unknown> = {
    quote_id: request.quote_id,
    wallet_address: request.wallet_address,
    object_id: request.object_id,
    object_id_hash: request.object_id_hash,
    wrapped_dek: request.payload.wrapped_dek,
    mode: request.payload.mode,
    content_sha256: request.payload.content_sha256,
    content_length_bytes: request.payload.content_length_bytes,
    encryption_algorithm: request.payload.encryption_algorithm,
    object_key: objectKey,
  };
  if (request.payload.content_base64) {
    backendRequestBody.ciphertext = request.payload.content_base64;
  }
  if (provider) {
    backendRequestBody.provider = provider;
  }
  if (location) {
    backendRequestBody.location = location;
  }

  const targetUrl = `${normalizeBaseUrl(backendBaseUrl)}/storage/upload`;
  const response = await fetchImpl(targetUrl, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(backendRequestBody),
  });

  return {
    status: response.status,
    bodyText: await response.text(),
    contentType: response.headers.get("content-type") ?? "application/json",
    paymentRequired: normalizePaymentRequired(response.headers),
    paymentResponse: normalizePaymentResponse(response.headers),
  };
}

export async function forwardStorageUploadConfirmToBackend(
  request: StorageUploadConfirmRequest,
  options: BackendUploadConfirmOptions = {},
): Promise<BackendUploadForwardResult> {
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

  const targetUrl = `${normalizeBaseUrl(backendBaseUrl)}/storage/upload/confirm`;
  const response = await fetchImpl(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wallet-Signature": walletSignature,
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

export type {
  BackendQuoteForwardResult,
  BackendQuoteOptions,
  BackendUploadForwardResult,
  BackendUploadOptions,
  BackendUploadConfirmOptions,
  ProxyQuoteOptions,
  ProxyUploadOptions,
  ProxyUploadConfirmOptions,
};
