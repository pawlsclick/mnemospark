/**
 * Local mnemospark proxy server.
 *
 * This proxy only forwards mnemospark storage endpoints to the backend API and
 * serves health checks. It does not handle chat completions or model routing.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { BalanceMonitor } from "./balance.js";
import { PROXY_PORT, MNEMOSPARK_BACKEND_API_BASE_URL } from "./config.js";
import { createWalletSignatureHeaderValue } from "./mnemospark-request-sign.js";
import {
  PAYMENT_SETTLE_PROXY_PATH,
  PRICE_STORAGE_PROXY_PATH,
  UPLOAD_PROXY_PATH,
  UPLOAD_CONFIRM_PROXY_PATH,
  forwardPaymentSettleToBackend,
  forwardStorageUploadConfirmToBackend,
  forwardPriceStorageToBackend,
  forwardStorageUploadToBackend,
  parseStorageUploadConfirmRequest,
  parsePriceStorageQuoteRequest,
  parseStorageUploadRequest,
} from "./cloud-price-storage.js";
import { createPaymentFetch } from "./x402.js";
import {
  STORAGE_DELETE_PROXY_PATH,
  STORAGE_DOWNLOAD_PROXY_PATH,
  STORAGE_LS_PROXY_PATH,
  downloadStorageToDisk,
  forwardStorageDeleteToBackend,
  forwardStorageDownloadToBackend,
  forwardStorageLsToBackend,
  parseStorageObjectRequest,
} from "./cloud-storage.js";
import { appendJsonlEvent } from "./cloud-jsonl.js";
import { MNEMOSPARK_OPERATION_ID_HEADER, MNEMOSPARK_TRACE_ID_HEADER } from "./cloud-correlation.js";

const HEALTH_CHECK_TIMEOUT_MS = 2_000; // Timeout for checking existing proxy
const PORT_RETRY_ATTEMPTS = 5; // Max attempts to bind port (handles TIME_WAIT)
const PORT_RETRY_DELAY_MS = 1_000; // Delay between retry attempts
const DEFAULT_DOWNLOAD_OUTPUT_DIR = join(homedir(), ".openclaw", "mnemospark", "downloads");

function resolveDownloadOutputDir(): string {
  const configuredOutputDir = process.env.MNEMOSPARK_DOWNLOAD_DIR?.trim();
  if (configuredOutputDir && configuredOutputDir.length > 0) {
    return configuredOutputDir;
  }
  return DEFAULT_DOWNLOAD_OUTPUT_DIR;
}

function matchesProxyPath(url: string | undefined, path: string): boolean {
  return url === path || url?.startsWith(`${path}?`) === true;
}

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

async function readProxyJsonBody(req: IncomingMessage): Promise<unknown> {
  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const bodyText = Buffer.concat(bodyChunks).toString("utf-8").trim();
  if (bodyText.length === 0) {
    return {};
  }

  return JSON.parse(bodyText);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function logProxyEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = JSON.stringify({ event, ...fields });
  const message = `[mnemospark] ${payload}`;
  if (level === "error") {
    console.error(message);
    return;
  }
  if (level === "warn") {
    console.warn(message);
    return;
  }
  console.info(message);
}

type ProxyEventCorrelation = {
  trace_id: string;
  operation_id: string;
  quote_id?: string;
  wallet_address?: string;
  object_id?: string;
  object_key?: string;
};

function emitProxyEvent(
  eventType: string,
  status: "start" | "result" | "success" | "failure" | "decision",
  correlation: ProxyEventCorrelation,
  details: Record<string, unknown> = {},
): void {
  void appendJsonlEvent("proxy-events.jsonl", {
    ts: new Date().toISOString(),
    event_type: eventType,
    status,
    trace_id: correlation.trace_id,
    operation_id: correlation.operation_id,
    quote_id: correlation.quote_id ?? null,
    wallet_address: correlation.wallet_address ?? null,
    object_id: correlation.object_id ?? null,
    object_key: correlation.object_key ?? null,
    details,
  }).catch(() => undefined);
}

function createProxyCorrelation(headers: IncomingMessage["headers"]): ProxyEventCorrelation {
  const traceId =
    readHeaderValue(headers[MNEMOSPARK_TRACE_ID_HEADER.toLowerCase()]) ?? randomUUID();
  const operationId =
    readHeaderValue(
      headers[MNEMOSPARK_OPERATION_ID_HEADER.toLowerCase()] ?? headers["idempotency-key"],
    ) ?? randomUUID();
  return { trace_id: traceId, operation_id: operationId };
}

function emitProxyTerminalFromStatus(
  correlation: ProxyEventCorrelation,
  statusCode: number,
  details: Record<string, unknown> = {},
): void {
  if (statusCode >= 200 && statusCode < 300) {
    emitProxyEvent("terminal.success", "success", correlation, { status: statusCode, ...details });
    return;
  }
  emitProxyEvent("terminal.failure", "failure", correlation, { status: statusCode, ...details });
}

function isAlreadySettledConflict(status: number, bodyText: string): boolean {
  if (status !== 409) {
    return false;
  }
  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>;
    const errorCode = String(payload.error_code ?? payload.error ?? "").toLowerCase();
    const message = String(payload.message ?? "").toLowerCase();
    return errorCode === "payment_already_settled" || message.includes("already settled");
  } catch {
    return false;
  }
}

function createBackendForwardHeaders(response: {
  contentType: string;
  paymentRequired?: string;
  paymentResponse?: string;
}): Record<string, string> {
  const responseHeaders: Record<string, string> = {
    "Content-Type": response.contentType,
  };

  // Preserve v2 payment headers while also supporting legacy names.
  if (response.paymentRequired) {
    responseHeaders["PAYMENT-REQUIRED"] = response.paymentRequired;
    responseHeaders["x-payment-required"] = response.paymentRequired;
  }
  if (response.paymentResponse) {
    responseHeaders["PAYMENT-RESPONSE"] = response.paymentResponse;
    responseHeaders["x-payment-response"] = response.paymentResponse;
  }

  return responseHeaders;
}

type BackendAuthFailure = {
  status: number;
  contentType: string;
  bodyText: string;
};

function isLikelyWalletProofFailure(bodyText: string): boolean {
  return /(wallet|signature|proof|nonce|timestamp|expired|authoriz)/i.test(bodyText);
}

export function normalizeBackendAuthFailure(
  status: number,
  bodyText: string,
): BackendAuthFailure | undefined {
  if (status !== 401 && status !== 403) {
    return undefined;
  }

  const message = isLikelyWalletProofFailure(bodyText) ? "wallet proof invalid" : "unauthorized";
  return {
    status,
    contentType: "application/json",
    bodyText: createAuthErrorBody(message),
  };
}

function createAuthErrorBody(message: "unauthorized" | "wallet proof invalid"): string {
  return JSON.stringify({
    error: message.replace(/\s+/g, "_"),
    message,
  });
}

function createWalletRequiredBody(): string {
  return JSON.stringify({
    error: "wallet_required",
    message: "wallet required for storage endpoints",
  });
}

/**
 * Get the proxy port from pre-loaded configuration.
 * Port is validated at module load time, this just returns the cached value.
 */
export function getProxyPort(): number {
  return PROXY_PORT;
}

/**
 * Check if a proxy is already running on the given port.
 * Returns the wallet address if running, undefined otherwise.
 */
async function checkExistingProxy(port: number): Promise<string | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as { status?: string; wallet?: string };
      if (data.status === "ok" && data.wallet) {
        return data.wallet;
      }
    }
    return undefined;
  } catch {
    clearTimeout(timeoutId);
    return undefined;
  }
}

/** Callback info for low balance warning */
export type LowBalanceInfo = {
  balanceUSD: string;
  walletAddress: string;
};

/** Callback info for insufficient funds error */
export type InsufficientFundsInfo = {
  balanceUSD: string;
  requiredUSD: string;
  walletAddress: string;
};

export type ProxyOptions = {
  walletKey: string;
  /** Port to listen on (default: 7120) */
  port?: number;
  onReady?: (port: number) => void;
  onError?: (error: Error) => void;
  /** Called when balance drops below $1.00 (warning, request still proceeds) */
  onLowBalance?: (info: LowBalanceInfo) => void;
  /** Called when balance is insufficient for a request (request fails) */
  onInsufficientFunds?: (info: InsufficientFundsInfo) => void;
};

export type ProxyHandle = {
  port: number;
  baseUrl: string;
  walletAddress: string;
  balanceMonitor: BalanceMonitor;
  close: () => Promise<void>;
};

/**
 * Start the local mnemospark backend proxy server.
 *
 * If a proxy is already running on the target port, reuses it instead of failing.
 * Port can be configured via MNEMOSPARK_PROXY_PORT environment variable.
 *
 * Returns a handle with the assigned port, base URL, and a close function.
 */
export async function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  // Determine port: options.port > env var > default
  const listenPort = options.port ?? getProxyPort();

  // Check if a proxy is already running on this port
  const existingWallet = await checkExistingProxy(listenPort);
  if (existingWallet) {
    // Proxy already running — reuse it instead of failing with EADDRINUSE
    const account = privateKeyToAccount(options.walletKey as `0x${string}`);
    const balanceMonitor = new BalanceMonitor(account.address);
    const baseUrl = `http://127.0.0.1:${listenPort}`;

    // Verify the existing proxy is using the same wallet (or warn if different)
    if (existingWallet !== account.address) {
      console.warn(
        `[mnemospark] Existing proxy on port ${listenPort} uses wallet ${existingWallet}, but current config uses ${account.address}. Reusing existing proxy.`,
      );
    }

    options.onReady?.(listenPort);

    return {
      port: listenPort,
      baseUrl,
      walletAddress: existingWallet,
      balanceMonitor,
      close: async () => {
        // No-op: we didn't start this proxy, so we shouldn't close it
      },
    };
  }

  const walletPrivateKey = options.walletKey.trim() as `0x${string}`;
  const account = privateKeyToAccount(walletPrivateKey);
  const balanceMonitor = new BalanceMonitor(account.address);
  const proxyWalletAddressLower = account.address.toLowerCase();

  // Track active connections for graceful cleanup
  const connections = new Set<import("net").Socket>();

  const createBackendWalletSignature = async (
    method: "GET" | "POST" | "DELETE",
    path: string,
    walletAddress: string,
  ): Promise<string | undefined> => {
    if (walletAddress.toLowerCase() !== proxyWalletAddressLower) {
      return undefined;
    }

    try {
      return await createWalletSignatureHeaderValue(method, path, walletAddress, walletPrivateKey);
    } catch (err) {
      console.warn(
        `[mnemospark] Failed to create wallet proof for ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    req.on("error", (err) => {
      console.error(`[mnemospark] Request stream error: ${err.message}`);
    });
    res.on("error", (err) => {
      console.error(`[mnemospark] Response stream error: ${err.message}`);
    });

    // Mnemospark backend proxy endpoint for /mnemospark_cloud price-storage command.
    if (req.method === "POST" && matchesProxyPath(req.url, PRICE_STORAGE_PROXY_PATH)) {
      const correlation = createProxyCorrelation(req.headers);
      logProxyEvent("info", "proxy_price_storage_received");
      emitProxyEvent("request.received", "start", correlation, { path: PRICE_STORAGE_PROXY_PATH });
      try {
        let payload: unknown;
        try {
          payload = await readProxyJsonBody(req);
        } catch {
          logProxyEvent("warn", "proxy_price_storage_invalid_json");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_json" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid JSON body for /mnemospark_cloud price-storage",
          });
          return;
        }

        const requestPayload = parsePriceStorageQuoteRequest(payload);
        if (!requestPayload) {
          logProxyEvent("warn", "proxy_price_storage_missing_fields");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "missing_fields" });
          sendJson(res, 400, {
            error: "Bad request",
            message:
              "Missing required fields: wallet_address, object_id, object_id_hash, gb, provider, region",
          });
          return;
        }

        correlation.wallet_address = requestPayload.wallet_address;
        correlation.object_id = requestPayload.object_id;
        emitProxyEvent("storage.call", "start", correlation, { target: "price-storage" });

        const walletSignature = await createBackendWalletSignature(
          "POST",
          "/price-storage",
          requestPayload.wallet_address,
        );
        if (!walletSignature) {
          logProxyEvent("warn", "proxy_price_storage_wallet_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "wallet_signature_missing" });
          return;
        }
        const backendResponse = await forwardPriceStorageToBackend(requestPayload, {
          backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
          walletSignature,
        });
        logProxyEvent("info", "proxy_price_storage_backend_response", {
          status: backendResponse.status,
        });
        emitProxyEvent("storage.call", "result", correlation, { status: backendResponse.status });

        const authFailure = normalizeBackendAuthFailure(
          backendResponse.status,
          backendResponse.bodyText,
        );
        if (authFailure) {
          logProxyEvent("warn", "proxy_price_storage_auth_failure", {
            status: authFailure.status,
          });
          const responseHeaders = createBackendForwardHeaders({
            contentType: authFailure.contentType,
            paymentRequired: backendResponse.paymentRequired,
            paymentResponse: backendResponse.paymentResponse,
          });
          res.writeHead(authFailure.status, responseHeaders);
          res.end(authFailure.bodyText);
          emitProxyTerminalFromStatus(correlation, authFailure.status, { reason: "auth_failure" });
          return;
        }

        const responseHeaders = createBackendForwardHeaders(backendResponse);
        res.writeHead(backendResponse.status, responseHeaders);
        res.end(backendResponse.bodyText);
        emitProxyTerminalFromStatus(correlation, backendResponse.status);
      } catch (err) {
        emitProxyEvent("terminal.failure", "failure", correlation, {
          error: err instanceof Error ? err.message : String(err),
        });
        logProxyEvent("error", "proxy_price_storage_forward_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 502, {
          error: "proxy_error",
          message: `Failed to forward /mnemospark_cloud price-storage: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Mnemospark proxy endpoint for payment/settle (forwards to backend POST /payment/settle).
    if (req.method === "POST" && matchesProxyPath(req.url, PAYMENT_SETTLE_PROXY_PATH)) {
      const correlation = createProxyCorrelation(req.headers);
      logProxyEvent("info", "proxy_payment_settle_received");
      emitProxyEvent("request.received", "start", correlation, { path: PAYMENT_SETTLE_PROXY_PATH });
      try {
        let payload: unknown;
        try {
          payload = await readProxyJsonBody(req);
        } catch {
          logProxyEvent("warn", "proxy_payment_settle_invalid_json");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_json" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid JSON body for /mnemospark/payment/settle",
          });
          return;
        }

        const record =
          payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
        const quoteId = typeof record?.quote_id === "string" ? record.quote_id.trim() : "";
        const walletAddress =
          typeof record?.wallet_address === "string" ? record.wallet_address.trim() : "";
        const inlinePayment = record?.payment;
        const inlinePaymentAuthorization = record?.payment_authorization;
        if (!quoteId || !walletAddress) {
          logProxyEvent("warn", "proxy_payment_settle_missing_fields");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "missing_fields" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Missing required fields: quote_id, wallet_address",
          });
          return;
        }
        if (
          inlinePayment !== undefined &&
          (inlinePayment === null ||
            typeof inlinePayment !== "object" ||
            Array.isArray(inlinePayment))
        ) {
          logProxyEvent("warn", "proxy_payment_settle_invalid_payment_shape");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_payment_shape" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid field: payment must be an object when provided",
          });
          return;
        }
        if (
          inlinePaymentAuthorization !== undefined &&
          !(
            typeof inlinePaymentAuthorization === "string" ||
            (inlinePaymentAuthorization !== null &&
              typeof inlinePaymentAuthorization === "object" &&
              !Array.isArray(inlinePaymentAuthorization))
          )
        ) {
          logProxyEvent("warn", "proxy_payment_settle_invalid_payment_authorization_shape");
          emitProxyTerminalFromStatus(correlation, 400, {
            reason: "invalid_payment_authorization_shape",
          });
          sendJson(res, 400, {
            error: "Bad request",
            message:
              "Invalid field: payment_authorization must be an object or string when provided",
          });
          return;
        }

        if (walletAddress.toLowerCase() !== proxyWalletAddressLower) {
          logProxyEvent("warn", "proxy_payment_settle_wallet_mismatch", {
            request_wallet: walletAddress,
            proxy_wallet: account.address,
          });
          emitProxyTerminalFromStatus(correlation, 403, { reason: "wallet_mismatch" });
          sendJson(res, 403, {
            error: "wallet_proof_invalid",
            message: "wallet proof invalid",
          });
          return;
        }

        const walletSignature = await createBackendWalletSignature(
          "POST",
          "/payment/settle",
          walletAddress,
        );
        if (!walletSignature) {
          logProxyEvent("warn", "proxy_payment_settle_wallet_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "wallet_signature_missing" });
          return;
        }

        correlation.quote_id = quoteId;
        correlation.wallet_address = walletAddress;
        emitProxyEvent("payment.settle", "start", correlation);

        const paymentFetch = createPaymentFetch(walletPrivateKey).fetch;
        const backendResponse = await forwardPaymentSettleToBackend(quoteId, walletAddress, {
          backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
          walletSignature,
          fetchImpl: paymentFetch,
          paymentSignature: readHeaderValue(req.headers["payment-signature"]),
          legacyPayment: readHeaderValue(req.headers["x-payment"]),
          payment:
            inlinePayment && typeof inlinePayment === "object" && !Array.isArray(inlinePayment)
              ? (inlinePayment as Record<string, unknown>)
              : undefined,
          paymentAuthorization:
            typeof inlinePaymentAuthorization === "string"
              ? inlinePaymentAuthorization.trim() || undefined
              : inlinePaymentAuthorization !== undefined
                ? (inlinePaymentAuthorization as Record<string, unknown>)
                : undefined,
        });
        logProxyEvent("info", "proxy_payment_settle_backend_response", {
          status: backendResponse.status,
        });
        emitProxyEvent("payment.settle", "result", correlation, { status: backendResponse.status });

        const authFailure = normalizeBackendAuthFailure(
          backendResponse.status,
          backendResponse.bodyText,
        );
        if (authFailure) {
          logProxyEvent("warn", "proxy_payment_settle_auth_failure", {
            status: authFailure.status,
          });
          const responseHeaders = createBackendForwardHeaders({
            contentType: authFailure.contentType,
            paymentRequired: backendResponse.paymentRequired,
            paymentResponse: backendResponse.paymentResponse,
          });
          res.writeHead(authFailure.status, responseHeaders);
          res.end(authFailure.bodyText);
          emitProxyTerminalFromStatus(correlation, authFailure.status, { reason: "auth_failure" });
          return;
        }

        const responseHeaders = createBackendForwardHeaders(backendResponse);
        res.writeHead(backendResponse.status, responseHeaders);
        res.end(backendResponse.bodyText);
        emitProxyTerminalFromStatus(correlation, backendResponse.status);
      } catch (err) {
        emitProxyEvent("terminal.failure", "failure", correlation, {
          error: err instanceof Error ? err.message : String(err),
        });
        logProxyEvent("error", "proxy_payment_settle_forward_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 502, {
          error: "proxy_error",
          message: `Failed to forward /mnemospark/payment/settle: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Mnemospark backend proxy endpoint for /mnemospark_cloud upload command.
    if (req.method === "POST" && matchesProxyPath(req.url, UPLOAD_PROXY_PATH)) {
      const correlation = createProxyCorrelation(req.headers);
      logProxyEvent("info", "proxy_upload_received");
      emitProxyEvent("request.received", "start", correlation, { path: UPLOAD_PROXY_PATH });
      try {
        let payload: unknown;
        try {
          payload = await readProxyJsonBody(req);
        } catch {
          logProxyEvent("warn", "proxy_upload_invalid_json");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_json" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid JSON body for /mnemospark_cloud upload",
          });
          return;
        }

        const requestPayload = parseStorageUploadRequest(payload);
        if (!requestPayload) {
          logProxyEvent("warn", "proxy_upload_missing_fields");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "missing_fields" });
          sendJson(res, 400, {
            error: "Bad request",
            message:
              "Missing required fields: quote_id, wallet_address, object_id, object_id_hash, quoted_storage_price, payload",
          });
          return;
        }

        correlation.quote_id = requestPayload.quote_id;
        correlation.wallet_address = requestPayload.wallet_address;
        correlation.object_id = requestPayload.object_id;

        if (requestPayload.wallet_address.toLowerCase() !== proxyWalletAddressLower) {
          logProxyEvent("warn", "proxy_upload_wallet_mismatch", {
            request_wallet: requestPayload.wallet_address,
            proxy_wallet: account.address,
          });
          emitProxyTerminalFromStatus(correlation, 403, { reason: "wallet_mismatch" });
          sendJson(res, 403, {
            error: "wallet_proof_invalid",
            message: "wallet proof invalid",
          });
          return;
        }

        const walletSignature = await createBackendWalletSignature(
          "POST",
          "/storage/upload",
          requestPayload.wallet_address,
        );
        if (!walletSignature) {
          logProxyEvent("warn", "proxy_upload_wallet_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "wallet_signature_missing" });
          return;
        }

        const requiredMicros = BigInt(
          Math.max(1, Math.ceil(requestPayload.quoted_storage_price * 1_000_000)),
        );
        const uploadBalanceMonitor =
          requestPayload.wallet_address.toLowerCase() === account.address.toLowerCase()
            ? balanceMonitor
            : new BalanceMonitor(requestPayload.wallet_address);
        const sufficiency = await uploadBalanceMonitor.checkSufficient(requiredMicros);
        const requiredUSD = uploadBalanceMonitor.formatUSDC(requiredMicros);

        if (!sufficiency.sufficient) {
          logProxyEvent("warn", "proxy_upload_insufficient_balance", {
            wallet_address: requestPayload.wallet_address,
            balance_usd: sufficiency.info.balanceUSD,
            required_usd: requiredUSD,
          });
          options.onInsufficientFunds?.({
            balanceUSD: sufficiency.info.balanceUSD,
            requiredUSD,
            walletAddress: requestPayload.wallet_address,
          });
          emitProxyTerminalFromStatus(correlation, 400, { reason: "insufficient_balance" });
          sendJson(res, 400, {
            error: "insufficient_balance",
            message: `Insufficient USDC balance. Current: ${sufficiency.info.balanceUSD}, Required: ${requiredUSD}`,
            wallet: requestPayload.wallet_address,
            help: `Fund wallet ${requestPayload.wallet_address} on Base before running /mnemospark_cloud upload`,
          });
          return;
        }

        if (sufficiency.info.isLow) {
          logProxyEvent("warn", "proxy_upload_low_balance", {
            wallet_address: requestPayload.wallet_address,
            balance_usd: sufficiency.info.balanceUSD,
          });
          options.onLowBalance?.({
            balanceUSD: sufficiency.info.balanceUSD,
            walletAddress: requestPayload.wallet_address,
          });
        }

        // Settle payment first (with 402 handling); then upload without payment headers.
        const settleWalletSignature = await createBackendWalletSignature(
          "POST",
          "/payment/settle",
          requestPayload.wallet_address,
        );
        if (!settleWalletSignature) {
          logProxyEvent("warn", "proxy_upload_settle_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "settle_signature_missing" });
          return;
        }
        const uploadPaymentFetch = createPaymentFetch(walletPrivateKey).fetch;
        emitProxyEvent("payment.settle", "start", correlation, { via: "upload" });
        const settleResponse = await forwardPaymentSettleToBackend(
          requestPayload.quote_id,
          requestPayload.wallet_address,
          {
            backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
            walletSignature: settleWalletSignature,
            fetchImpl: uploadPaymentFetch,
          },
        );
        emitProxyEvent("payment.settle", "result", correlation, { status: settleResponse.status });
        const settledAlready = isAlreadySettledConflict(
          settleResponse.status,
          settleResponse.bodyText,
        );
        if (settleResponse.status !== 200 && !settledAlready) {
          logProxyEvent("warn", "proxy_upload_settle_failed", {
            status: settleResponse.status,
          });
          const responseHeaders = createBackendForwardHeaders({
            contentType: settleResponse.contentType,
            paymentRequired: settleResponse.paymentRequired,
            paymentResponse: settleResponse.paymentResponse,
          });
          res.writeHead(settleResponse.status, responseHeaders);
          res.end(settleResponse.bodyText);
          emitProxyTerminalFromStatus(correlation, settleResponse.status, {
            reason: "settle_failed",
          });
          return;
        }
        if (settledAlready) {
          emitProxyEvent("retry.decision", "decision", correlation, {
            reason: "payment_already_settled_conflict",
            status: settleResponse.status,
          });
          logProxyEvent("info", "proxy_upload_settle_already_confirmed", {
            status: settleResponse.status,
          });
        }

        emitProxyEvent("storage.call", "start", correlation, { target: "storage/upload" });
        const backendResponse = await forwardStorageUploadToBackend(requestPayload, {
          backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
          walletSignature,
          idempotencyKey: readHeaderValue(req.headers["idempotency-key"]),
        });
        logProxyEvent("info", "proxy_upload_backend_response", {
          status: backendResponse.status,
        });
        emitProxyEvent("storage.call", "result", correlation, { status: backendResponse.status });

        const authFailure = normalizeBackendAuthFailure(
          backendResponse.status,
          backendResponse.bodyText,
        );
        if (authFailure) {
          logProxyEvent("warn", "proxy_upload_auth_failure", {
            status: authFailure.status,
          });
          const responseHeaders = createBackendForwardHeaders({
            contentType: authFailure.contentType,
            paymentRequired: backendResponse.paymentRequired,
            paymentResponse: backendResponse.paymentResponse,
          });
          res.writeHead(authFailure.status, responseHeaders);
          res.end(authFailure.bodyText);
          emitProxyTerminalFromStatus(correlation, authFailure.status, { reason: "auth_failure" });
          return;
        }

        const responseHeaders = createBackendForwardHeaders(backendResponse);
        res.writeHead(backendResponse.status, responseHeaders);
        res.end(backendResponse.bodyText);
        emitProxyTerminalFromStatus(correlation, backendResponse.status);
      } catch (err) {
        emitProxyEvent("terminal.failure", "failure", correlation, {
          error: err instanceof Error ? err.message : String(err),
        });
        logProxyEvent("error", "proxy_upload_forward_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 502, {
          error: "proxy_error",
          message: `Failed to forward /mnemospark_cloud upload: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Mnemospark backend proxy endpoint for /mnemospark_cloud upload confirm command.
    if (req.method === "POST" && matchesProxyPath(req.url, UPLOAD_CONFIRM_PROXY_PATH)) {
      const correlation = createProxyCorrelation(req.headers);
      logProxyEvent("info", "proxy_upload_confirm_received");
      emitProxyEvent("request.received", "start", correlation, { path: UPLOAD_CONFIRM_PROXY_PATH });
      try {
        let payload: unknown;
        try {
          payload = await readProxyJsonBody(req);
        } catch {
          logProxyEvent("warn", "proxy_upload_confirm_invalid_json");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_json" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid JSON body for /mnemospark_cloud upload/confirm",
          });
          return;
        }

        const requestPayload = parseStorageUploadConfirmRequest(payload);
        if (!requestPayload) {
          logProxyEvent("warn", "proxy_upload_confirm_missing_fields");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "missing_fields" });
          sendJson(res, 400, {
            error: "Bad request",
            message:
              "Missing required fields: quote_id, wallet_address, object_key, idempotency_key",
          });
          return;
        }
        correlation.quote_id = requestPayload.quote_id;
        correlation.wallet_address = requestPayload.wallet_address;
        correlation.object_key = requestPayload.object_key;

        if (requestPayload.wallet_address.toLowerCase() !== proxyWalletAddressLower) {
          logProxyEvent("warn", "proxy_upload_confirm_wallet_mismatch", {
            request_wallet: requestPayload.wallet_address,
            proxy_wallet: account.address,
          });
          emitProxyTerminalFromStatus(correlation, 403, { reason: "wallet_mismatch" });
          sendJson(res, 403, {
            error: "wallet_proof_invalid",
            message: "wallet proof invalid",
          });
          return;
        }

        const walletSignature = await createBackendWalletSignature(
          "POST",
          "/storage/upload/confirm",
          requestPayload.wallet_address,
        );
        if (!walletSignature) {
          logProxyEvent("warn", "proxy_upload_confirm_wallet_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "wallet_signature_missing" });
          return;
        }

        emitProxyEvent("storage.call", "start", correlation, { target: "storage/upload/confirm" });
        const backendResponse = await forwardStorageUploadConfirmToBackend(requestPayload, {
          backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
          walletSignature,
        });
        logProxyEvent("info", "proxy_upload_confirm_backend_response", {
          status: backendResponse.status,
        });
        emitProxyEvent("storage.call", "result", correlation, { status: backendResponse.status });

        const authFailure = normalizeBackendAuthFailure(
          backendResponse.status,
          backendResponse.bodyText,
        );
        if (authFailure) {
          logProxyEvent("warn", "proxy_upload_confirm_auth_failure", {
            status: authFailure.status,
          });
          const responseHeaders = createBackendForwardHeaders({
            contentType: authFailure.contentType,
            paymentRequired: backendResponse.paymentRequired,
            paymentResponse: backendResponse.paymentResponse,
          });
          res.writeHead(authFailure.status, responseHeaders);
          res.end(authFailure.bodyText);
          emitProxyTerminalFromStatus(correlation, authFailure.status, { reason: "auth_failure" });
          return;
        }

        const responseHeaders = createBackendForwardHeaders(backendResponse);
        res.writeHead(backendResponse.status, responseHeaders);
        res.end(backendResponse.bodyText);
        emitProxyTerminalFromStatus(correlation, backendResponse.status);
      } catch (err) {
        emitProxyEvent("terminal.failure", "failure", correlation, {
          error: err instanceof Error ? err.message : String(err),
        });
        logProxyEvent("error", "proxy_upload_confirm_forward_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 502, {
          error: "proxy_error",
          message: `Failed to forward /mnemospark_cloud upload/confirm: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Mnemospark backend proxy endpoint for /mnemospark_cloud ls command.
    if (req.method === "POST" && matchesProxyPath(req.url, STORAGE_LS_PROXY_PATH)) {
      const correlation = createProxyCorrelation(req.headers);
      logProxyEvent("info", "proxy_ls_received");
      emitProxyEvent("request.received", "start", correlation, { path: STORAGE_LS_PROXY_PATH });
      try {
        let payload: unknown;
        try {
          payload = await readProxyJsonBody(req);
        } catch {
          logProxyEvent("warn", "proxy_ls_invalid_json");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_json" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid JSON body for /mnemospark_cloud ls",
          });
          return;
        }

        const requestPayload = parseStorageObjectRequest(payload);
        if (!requestPayload) {
          logProxyEvent("warn", "proxy_ls_missing_fields");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "missing_fields" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Missing required fields: wallet_address, object_key",
          });
          return;
        }

        correlation.wallet_address = requestPayload.wallet_address;
        correlation.object_key = requestPayload.object_key;

        if (requestPayload.wallet_address.toLowerCase() !== proxyWalletAddressLower) {
          logProxyEvent("warn", "proxy_ls_wallet_mismatch");
          emitProxyTerminalFromStatus(correlation, 403, { reason: "wallet_mismatch" });
          sendJson(res, 403, {
            error: "wallet_proof_invalid",
            message: "wallet proof invalid",
          });
          return;
        }

        const walletSignature = await createBackendWalletSignature(
          "POST",
          "/storage/ls",
          requestPayload.wallet_address,
        );
        if (!walletSignature) {
          logProxyEvent("warn", "proxy_ls_wallet_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "wallet_signature_missing" });
          return;
        }

        emitProxyEvent("storage.call", "start", correlation, { target: "storage/ls" });
        const backendResponse = await forwardStorageLsToBackend(requestPayload, {
          backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
          walletSignature,
        });
        logProxyEvent("info", "proxy_ls_backend_response", { status: backendResponse.status });
        emitProxyEvent("storage.call", "result", correlation, { status: backendResponse.status });

        const authFailure = normalizeBackendAuthFailure(
          backendResponse.status,
          backendResponse.bodyText,
        );
        if (authFailure) {
          logProxyEvent("warn", "proxy_ls_auth_failure", { status: authFailure.status });
          const responseHeaders = createBackendForwardHeaders({
            contentType: authFailure.contentType,
            paymentRequired: backendResponse.paymentRequired,
            paymentResponse: backendResponse.paymentResponse,
          });
          res.writeHead(authFailure.status, responseHeaders);
          res.end(authFailure.bodyText);
          emitProxyTerminalFromStatus(correlation, authFailure.status, { reason: "auth_failure" });
          return;
        }

        const responseHeaders = createBackendForwardHeaders(backendResponse);
        res.writeHead(backendResponse.status, responseHeaders);
        res.end(backendResponse.bodyText);
        emitProxyTerminalFromStatus(correlation, backendResponse.status);
      } catch (err) {
        emitProxyEvent("terminal.failure", "failure", correlation, {
          error: err instanceof Error ? err.message : String(err),
        });
        logProxyEvent("error", "proxy_ls_forward_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 502, {
          error: "proxy_error",
          message: `Failed to forward /mnemospark_cloud ls: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Mnemospark backend proxy endpoint for /mnemospark_cloud download command.
    if (req.method === "POST" && matchesProxyPath(req.url, STORAGE_DOWNLOAD_PROXY_PATH)) {
      const correlation = createProxyCorrelation(req.headers);
      logProxyEvent("info", "proxy_download_received");
      emitProxyEvent("request.received", "start", correlation, {
        path: STORAGE_DOWNLOAD_PROXY_PATH,
      });
      try {
        let payload: unknown;
        try {
          payload = await readProxyJsonBody(req);
        } catch {
          logProxyEvent("warn", "proxy_download_invalid_json");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_json" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid JSON body for /mnemospark_cloud download",
          });
          return;
        }

        const requestPayload = parseStorageObjectRequest(payload);
        if (!requestPayload) {
          logProxyEvent("warn", "proxy_download_missing_fields");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "missing_fields" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Missing required fields: wallet_address, object_key",
          });
          return;
        }

        correlation.wallet_address = requestPayload.wallet_address;
        correlation.object_key = requestPayload.object_key;

        if (requestPayload.wallet_address.toLowerCase() !== proxyWalletAddressLower) {
          logProxyEvent("warn", "proxy_download_wallet_mismatch");
          emitProxyTerminalFromStatus(correlation, 403, { reason: "wallet_mismatch" });
          sendJson(res, 403, {
            error: "wallet_proof_invalid",
            message: "wallet proof invalid",
          });
          return;
        }

        const walletSignature = await createBackendWalletSignature(
          "POST",
          "/storage/download",
          requestPayload.wallet_address,
        );
        if (!walletSignature) {
          logProxyEvent("warn", "proxy_download_wallet_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "wallet_signature_missing" });
          return;
        }

        emitProxyEvent("storage.call", "start", correlation, { target: "storage/download" });
        const backendResponse = await forwardStorageDownloadToBackend(requestPayload, {
          backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
          walletSignature,
        });
        logProxyEvent("info", "proxy_download_backend_response", {
          status: backendResponse.status,
        });
        emitProxyEvent("storage.call", "result", correlation, { status: backendResponse.status });

        const authFailure = normalizeBackendAuthFailure(
          backendResponse.status,
          backendResponse.bodyText,
        );
        if (authFailure) {
          logProxyEvent("warn", "proxy_download_auth_failure", {
            status: authFailure.status,
          });
          const responseHeaders = createBackendForwardHeaders({
            contentType: authFailure.contentType,
            paymentRequired: backendResponse.paymentRequired,
            paymentResponse: backendResponse.paymentResponse,
          });
          res.writeHead(authFailure.status, responseHeaders);
          res.end(authFailure.bodyText);
          emitProxyTerminalFromStatus(correlation, authFailure.status, { reason: "auth_failure" });
          return;
        }

        // Forward backend failures directly so client gets original status/details.
        if (backendResponse.status < 200 || backendResponse.status >= 300) {
          logProxyEvent("warn", "proxy_download_backend_non_success", {
            status: backendResponse.status,
          });
          const responseHeaders = createBackendForwardHeaders(backendResponse);
          res.writeHead(backendResponse.status, responseHeaders);
          res.end(backendResponse.bodyText);
          emitProxyTerminalFromStatus(correlation, backendResponse.status);
          return;
        }

        const downloadResult = await downloadStorageToDisk(requestPayload, backendResponse, {
          outputDir: resolveDownloadOutputDir(),
        });
        logProxyEvent("info", "proxy_download_written_to_disk", {
          key: downloadResult.key,
          file_path: downloadResult.filePath,
          bytes_written: downloadResult.bytesWritten,
        });
        sendJson(res, 200, {
          success: true,
          key: downloadResult.key,
          file_path: downloadResult.filePath,
          bytes_written: downloadResult.bytesWritten,
        });
        emitProxyTerminalFromStatus(correlation, 200);
      } catch (err) {
        emitProxyEvent("terminal.failure", "failure", correlation, {
          error: err instanceof Error ? err.message : String(err),
        });
        logProxyEvent("error", "proxy_download_forward_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 502, {
          error: "proxy_error",
          message: `Failed to forward /mnemospark_cloud download: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Mnemospark backend proxy endpoint for /mnemospark_cloud delete command.
    if (req.method === "POST" && matchesProxyPath(req.url, STORAGE_DELETE_PROXY_PATH)) {
      const correlation = createProxyCorrelation(req.headers);
      logProxyEvent("info", "proxy_delete_received");
      emitProxyEvent("request.received", "start", correlation, { path: STORAGE_DELETE_PROXY_PATH });
      try {
        let payload: unknown;
        try {
          payload = await readProxyJsonBody(req);
        } catch {
          logProxyEvent("warn", "proxy_delete_invalid_json");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "invalid_json" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Invalid JSON body for /mnemospark_cloud delete",
          });
          return;
        }

        const requestPayload = parseStorageObjectRequest(payload);
        if (!requestPayload) {
          logProxyEvent("warn", "proxy_delete_missing_fields");
          emitProxyTerminalFromStatus(correlation, 400, { reason: "missing_fields" });
          sendJson(res, 400, {
            error: "Bad request",
            message: "Missing required fields: wallet_address, object_key",
          });
          return;
        }

        correlation.wallet_address = requestPayload.wallet_address;
        correlation.object_key = requestPayload.object_key;

        if (requestPayload.wallet_address.toLowerCase() !== proxyWalletAddressLower) {
          logProxyEvent("warn", "proxy_delete_wallet_mismatch");
          emitProxyTerminalFromStatus(correlation, 403, { reason: "wallet_mismatch" });
          sendJson(res, 403, {
            error: "wallet_proof_invalid",
            message: "wallet proof invalid",
          });
          return;
        }

        const walletSignature = await createBackendWalletSignature(
          "POST",
          "/storage/delete",
          requestPayload.wallet_address,
        );
        if (!walletSignature) {
          logProxyEvent("warn", "proxy_delete_wallet_signature_missing");
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(createWalletRequiredBody());
          emitProxyTerminalFromStatus(correlation, 400, { reason: "wallet_signature_missing" });
          return;
        }

        emitProxyEvent("storage.call", "start", correlation, { target: "storage/delete" });
        const backendResponse = await forwardStorageDeleteToBackend(requestPayload, {
          backendBaseUrl: MNEMOSPARK_BACKEND_API_BASE_URL,
          walletSignature,
        });
        logProxyEvent("info", "proxy_delete_backend_response", {
          status: backendResponse.status,
        });
        emitProxyEvent("storage.call", "result", correlation, { status: backendResponse.status });

        const authFailure = normalizeBackendAuthFailure(
          backendResponse.status,
          backendResponse.bodyText,
        );
        if (authFailure) {
          logProxyEvent("warn", "proxy_delete_auth_failure", {
            status: authFailure.status,
          });
          const responseHeaders = createBackendForwardHeaders({
            contentType: authFailure.contentType,
            paymentRequired: backendResponse.paymentRequired,
            paymentResponse: backendResponse.paymentResponse,
          });
          res.writeHead(authFailure.status, responseHeaders);
          res.end(authFailure.bodyText);
          emitProxyTerminalFromStatus(correlation, authFailure.status, { reason: "auth_failure" });
          return;
        }

        const responseHeaders = createBackendForwardHeaders(backendResponse);
        res.writeHead(backendResponse.status, responseHeaders);
        res.end(backendResponse.bodyText);
        emitProxyTerminalFromStatus(correlation, backendResponse.status);
      } catch (err) {
        emitProxyEvent("terminal.failure", "failure", correlation, {
          error: err instanceof Error ? err.message : String(err),
        });
        logProxyEvent("error", "proxy_delete_forward_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        sendJson(res, 502, {
          error: "proxy_error",
          message: `Failed to forward /mnemospark_cloud delete: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Health check with optional balance info
    if (req.url === "/health" || req.url?.startsWith("/health?")) {
      const url = new URL(req.url, "http://localhost");
      const full = url.searchParams.get("full") === "true";

      const response: Record<string, unknown> = {
        status: "ok",
        wallet: account.address,
        backendConfigured: MNEMOSPARK_BACKEND_API_BASE_URL.trim().length > 0,
      };

      if (full) {
        try {
          const balanceInfo = await balanceMonitor.checkBalance();
          response.balance = balanceInfo.balanceUSD;
          response.isLow = balanceInfo.isLow;
          response.isEmpty = balanceInfo.isEmpty;
        } catch {
          response.balanceError = "Could not fetch balance";
        }
      }

      sendJson(res, 200, response);
      return;
    }

    sendJson(res, 404, {
      error: "Not found",
      message: "Supported paths: /health and /mnemospark/* storage endpoints",
    });
  });

  // Listen on configured port with retry logic for TIME_WAIT handling
  // When gateway restarts quickly, the port may still be in TIME_WAIT state.
  // We retry with delay instead of incorrectly assuming a proxy is running.
  const tryListen = (attempt: number): Promise<void> => {
    return new Promise<void>((resolveAttempt, rejectAttempt) => {
      const onError = async (err: NodeJS.ErrnoException) => {
        server.removeListener("error", onError);

        if (err.code === "EADDRINUSE") {
          // Port is in use - check if a proxy is actually running
          const existingWallet = await checkExistingProxy(listenPort);
          if (existingWallet) {
            // Proxy is actually running - this is fine, reuse it
            console.log(`[mnemospark] Existing proxy detected on port ${listenPort}, reusing`);
            rejectAttempt({ code: "REUSE_EXISTING", wallet: existingWallet });
            return;
          }

          // Port is in TIME_WAIT (no proxy responding) - retry after delay
          if (attempt < PORT_RETRY_ATTEMPTS) {
            console.log(
              `[mnemospark] Port ${listenPort} in TIME_WAIT, retrying in ${PORT_RETRY_DELAY_MS}ms (attempt ${attempt}/${PORT_RETRY_ATTEMPTS})`,
            );
            rejectAttempt({ code: "RETRY", attempt });
            return;
          }

          // Max retries exceeded
          console.error(
            `[mnemospark] Port ${listenPort} still in use after ${PORT_RETRY_ATTEMPTS} attempts`,
          );
          rejectAttempt(err);
          return;
        }

        rejectAttempt(err);
      };

      server.once("error", onError);
      server.listen(listenPort, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolveAttempt();
      });
    });
  };

  // Retry loop for port binding
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= PORT_RETRY_ATTEMPTS; attempt++) {
    try {
      await tryListen(attempt);
      break; // Success
    } catch (err: unknown) {
      const error = err as { code?: string; wallet?: string };

      if (error.code === "REUSE_EXISTING" && error.wallet) {
        // Proxy is running, reuse it
        const baseUrl = `http://127.0.0.1:${listenPort}`;
        options.onReady?.(listenPort);
        return {
          port: listenPort,
          baseUrl,
          walletAddress: error.wallet,
          balanceMonitor,
          close: async () => {
            // No-op: we didn't start this proxy, so we shouldn't close it
          },
        };
      }

      if (error.code === "RETRY") {
        // Wait before retry
        await new Promise((r) => setTimeout(r, PORT_RETRY_DELAY_MS));
        continue;
      }

      // Other error - throw
      lastError = err as Error;
      break;
    }
  }

  if (lastError) {
    throw lastError;
  }

  // Server is now listening - set up remaining handlers
  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  options.onReady?.(port);

  // Add runtime error handler AFTER successful listen
  // This handles errors that occur during server operation (not just startup)
  server.on("error", (err) => {
    console.error(`[mnemospark] Server runtime error: ${err.message}`);
    options.onError?.(err);
  });

  // Handle client connection errors (bad requests, socket errors)
  server.on("clientError", (err, socket) => {
    console.error(`[mnemospark] Client error: ${err.message}`);
    // Send 400 Bad Request if socket is still writable
    if (socket.writable && !socket.destroyed) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  // Track connections for graceful cleanup
  server.on("connection", (socket) => {
    connections.add(socket);

    // Keep alignment with prior behavior for long-running uploads/downloads.
    socket.setTimeout(300_000);

    socket.on("timeout", () => {
      console.error(`[mnemospark] Socket timeout, destroying connection`);
      socket.destroy();
    });

    socket.on("error", (err) => {
      console.error(`[mnemospark] Socket error: ${err.message}`);
    });

    socket.on("close", () => {
      connections.delete(socket);
    });
  });

  return {
    port,
    baseUrl,
    walletAddress: account.address,
    balanceMonitor,
    close: () =>
      new Promise<void>((res, rej) => {
        const timeout = setTimeout(() => {
          rej(new Error("[mnemospark] Close timeout after 4s"));
        }, 4000);

        // Destroy all active connections before closing server
        for (const socket of connections) {
          socket.destroy();
        }
        connections.clear();
        server.close((err) => {
          clearTimeout(timeout);
          if (err) {
            rej(err);
          } else {
            res();
          }
        });
      }),
  };
}
