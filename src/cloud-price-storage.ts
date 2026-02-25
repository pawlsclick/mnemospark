import { PROXY_PORT } from "./config.js";

export const PRICE_STORAGE_PROXY_PATH = "/mnemospark/price-storage";

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

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ProxyQuoteOptions = {
  proxyBaseUrl?: string;
  fetchImpl?: FetchLike;
};

type BackendQuoteOptions = {
  backendBaseUrl?: string;
  backendApiKey?: string;
  fetchImpl?: FetchLike;
};

type BackendQuoteForwardResult = {
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

export type { BackendQuoteForwardResult, BackendQuoteOptions, ProxyQuoteOptions };
