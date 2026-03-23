import { describe, expect, it, vi } from "vitest";
import { MNEMOSPARK_OPERATION_ID_HEADER, MNEMOSPARK_TRACE_ID_HEADER } from "./cloud-correlation.js";

import {
  forwardPaymentSettleToBackend,
  forwardPriceStorageToBackend,
  forwardStorageUploadConfirmToBackend,
  forwardStorageUploadToBackend,
  requestPaymentSettleViaProxy,
  requestPriceStorageViaProxy,
  requestStorageUploadConfirmViaProxy,
  requestStorageUploadViaProxy,
  type PriceStorageQuoteRequest,
  type StorageUploadConfirmRequest,
  type StorageUploadRequest,
} from "./cloud-price-storage.js";

const SAMPLE_REQUEST: PriceStorageQuoteRequest = {
  wallet_address: "0x1234abcd",
  object_id: "obj-001",
  object_id_hash: "hash-001",
  gb: 0.015,
  provider: "aws",
  region: "us-east-1",
};

const SAMPLE_UPLOAD_REQUEST: StorageUploadRequest = {
  quote_id: "quote-123",
  wallet_address: "0x1234abcd",
  object_id: "obj-001",
  object_id_hash: "hash-001",
  quoted_storage_price: 2.75,
  payload: {
    mode: "inline",
    content_base64: "ZmFrZS1lbmNyeXB0ZWQtYnl0ZXM=",
    content_sha256: "abcd1234",
    content_length_bytes: 21,
    wrapped_dek: "wrapped-dek",
    encryption_algorithm: "AES-256-GCM",
    bucket_name_hint: "mnemospark-1234",
    key_store_path_hint: "/tmp/key",
  },
};

const SAMPLE_UPLOAD_REQUEST_PRESIGNED: StorageUploadRequest = {
  ...SAMPLE_UPLOAD_REQUEST,
  payload: {
    ...SAMPLE_UPLOAD_REQUEST.payload,
    mode: "presigned",
    content_base64: undefined,
  },
};

const SAMPLE_UPLOAD_CONFIRM_REQUEST: StorageUploadConfirmRequest = {
  quote_id: "quote-123",
  wallet_address: "0x1234abcd",
  object_key: "obj-001.tar.gz.enc",
  idempotency_key: "idemp-123",
};

describe("cloud price-storage transport", () => {
  it("sends price-storage request to local proxy and parses quote response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const quote = await requestPriceStorageViaProxy(SAMPLE_REQUEST, {
      proxyBaseUrl: "http://127.0.0.1:7120/",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            timestamp: "2026-02-25 20:00:00",
            quote_id: "quote-123",
            storage_price: 3.5,
            addr: SAMPLE_REQUEST.wallet_address,
            object_id: SAMPLE_REQUEST.object_id,
            object_id_hash: SAMPLE_REQUEST.object_id_hash,
            object_size_gb: SAMPLE_REQUEST.gb,
            provider: SAMPLE_REQUEST.provider,
            location: SAMPLE_REQUEST.region,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    expect(capturedUrl).toBe("http://127.0.0.1:7120/mnemospark/price-storage");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(capturedInit?.body).toBe(JSON.stringify(SAMPLE_REQUEST));
    expect(quote.quote_id).toBe("quote-123");
    expect(quote.storage_price).toBe(3.5);
  });

  it("adds cross-stream correlation headers to proxy requests", async () => {
    const seenHeaders: Record<string, string> = {};

    await requestPriceStorageViaProxy(SAMPLE_REQUEST, {
      proxyBaseUrl: "http://127.0.0.1:7120/",
      correlation: {
        operationId: "op-corr-1",
        traceId: "trace-corr-1",
      },
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers);
        headers.forEach((value, key) => {
          seenHeaders[key] = value;
        });
        return new Response(
          JSON.stringify({
            timestamp: "2026-02-25 20:00:00",
            quote_id: "quote-123",
            storage_price: 3.5,
            addr: SAMPLE_REQUEST.wallet_address,
            object_id: SAMPLE_REQUEST.object_id,
            object_id_hash: SAMPLE_REQUEST.object_id_hash,
            object_size_gb: SAMPLE_REQUEST.gb,
            provider: SAMPLE_REQUEST.provider,
            location: SAMPLE_REQUEST.region,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    expect(seenHeaders[MNEMOSPARK_OPERATION_ID_HEADER.toLowerCase()]).toBe("op-corr-1");
    expect(seenHeaders[MNEMOSPARK_TRACE_ID_HEADER.toLowerCase()]).toBe("trace-corr-1");
  });

  it("forwards price-storage request to backend with required wallet signature", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardPriceStorageToBackend(SAMPLE_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "x-payment-required": "legacy-required-header",
          },
        });
      },
    });

    expect(capturedUrl).toBe("https://api.example.com/prod/price-storage");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-Wallet-Signature"]).toBe("wallet-proof-header");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(forwarded.status).toBe(402);
    expect(forwarded.paymentRequired).toBe("legacy-required-header");
  });

  it("throws when backendBaseUrl is set but walletSignature is missing for price-storage", async () => {
    await expect(
      forwardPriceStorageToBackend(SAMPLE_REQUEST, {
        backendBaseUrl: "https://api.example.com/prod/",
      }),
    ).rejects.toThrow(
      "Wallet proof is required for /price-storage when calling the backend directly. Use the proxy or provide walletSignature.",
    );
  });

  it("throws when backendBaseUrl is set but walletSignature is empty for price-storage", async () => {
    await expect(
      forwardPriceStorageToBackend(SAMPLE_REQUEST, {
        backendBaseUrl: "https://api.example.com/prod/",
        walletSignature: "  ",
      }),
    ).rejects.toThrow(
      "Wallet proof is required for /price-storage when calling the backend directly. Use the proxy or provide walletSignature.",
    );
  });

  it("sends upload request to local proxy with Idempotency-Key and parses response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const upload = await requestStorageUploadViaProxy(SAMPLE_UPLOAD_REQUEST, {
      proxyBaseUrl: "http://127.0.0.1:7120/",
      idempotencyKey: "idemp-123",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            quote_id: "quote-123",
            addr: "0x1234abcd",
            addr_hash: "addr-hash",
            trans_id: "tx-001",
            storage_price: 2.75,
            object_id: "obj-001",
            object_key: "obj-001.tar.gz.enc",
            provider: "aws",
            bucket_name: "mnemospark-1234",
            confirmation_required: true,
            location: "us-east-1",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    expect(capturedUrl).toBe("http://127.0.0.1:7120/mnemospark/upload");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idemp-123");
    expect(upload.object_key).toBe("obj-001.tar.gz.enc");
    expect(upload.confirmation_required).toBe(true);
  });

  it("sends upload confirm request to local proxy and parses response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const upload = await requestStorageUploadConfirmViaProxy(SAMPLE_UPLOAD_CONFIRM_REQUEST, {
      proxyBaseUrl: "http://127.0.0.1:7120/",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            quote_id: "quote-123",
            addr: "0x1234abcd",
            addr_hash: "addr-hash",
            trans_id: "tx-confirm-001",
            storage_price: 2.75,
            object_id: "obj-001",
            object_key: "obj-001.tar.gz.enc",
            provider: "aws",
            bucket_name: "mnemospark-1234",
            location: "[REDACTED]",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    expect(capturedUrl).toBe("http://127.0.0.1:7120/mnemospark/upload/confirm");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe(JSON.stringify(SAMPLE_UPLOAD_CONFIRM_REQUEST));
    expect(upload.trans_id).toBe("tx-confirm-001");
  });

  it("retries upload on 207 upload_failed and succeeds on retry", async () => {
    const capturedInits: Array<RequestInit | undefined> = [];
    let requestCount = 0;

    vi.useFakeTimers();
    try {
      const uploadPromise = requestStorageUploadViaProxy(SAMPLE_UPLOAD_REQUEST, {
        proxyBaseUrl: "http://127.0.0.1:7120/",
        idempotencyKey: "idemp-207",
        maxRetries: 2,
        fetchImpl: async (_input, init) => {
          requestCount += 1;
          capturedInits.push(init);

          if (requestCount === 1) {
            return new Response(
              JSON.stringify({
                quote_id: "quote-123",
                addr: "0x1234abcd",
                trans_id: "tx-207",
                upload_failed: true,
                error: "S3 upload failed after payment settlement. Retry the upload.",
              }),
              {
                status: 207,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          return new Response(
            JSON.stringify({
              quote_id: "quote-123",
              addr: "0x1234abcd",
              addr_hash: "addr-hash",
              trans_id: "tx-207",
              storage_price: 2.75,
              object_id: "obj-001",
              object_key: "obj-001.tar.gz.enc",
              provider: "aws",
              bucket_name: "mnemospark-1234",
              location: "us-east-1",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        },
      });

      await vi.advanceTimersByTimeAsync(1000);
      const upload = await uploadPromise;

      expect(upload.object_key).toBe("obj-001.tar.gz.enc");
      expect(requestCount).toBe(2);
      expect(capturedInits).toHaveLength(2);
      for (const init of capturedInits) {
        const headers = new Headers(init?.headers);
        expect(headers.get("Idempotency-Key")).toBe("idemp-207");
        expect(init?.body).toBe(JSON.stringify(SAMPLE_UPLOAD_REQUEST));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws clear trans_id error after retryable 207 responses exhaust retries", async () => {
    let requestCount = 0;

    vi.useFakeTimers();
    try {
      const uploadPromise = requestStorageUploadViaProxy(SAMPLE_UPLOAD_REQUEST, {
        proxyBaseUrl: "http://127.0.0.1:7120/",
        maxRetries: 1,
        fetchImpl: async () => {
          requestCount += 1;
          return new Response(
            JSON.stringify({
              quote_id: "quote-123",
              addr: "0x1234abcd",
              trans_id: "tx-exhausted",
              upload_failed: true,
              error: "S3 upload failed after payment settlement. Retry the upload.",
            }),
            {
              status: 207,
              headers: { "Content-Type": "application/json" },
            },
          );
        },
      });
      const rejectionExpectation = expect(uploadPromise).rejects.toThrow(
        "Payment confirmed (trans_id: tx-exhausted) but file storage failed after 1 retry. Contact support with your trans_id.",
      );

      await vi.advanceTimersByTimeAsync(1000);
      await rejectionExpectation;
      expect(requestCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats 207 without upload_failed as normal 2xx payload", async () => {
    let requestCount = 0;

    const upload = await requestStorageUploadViaProxy(SAMPLE_UPLOAD_REQUEST, {
      proxyBaseUrl: "http://127.0.0.1:7120/",
      fetchImpl: async () => {
        requestCount += 1;
        return new Response(
          JSON.stringify({
            quote_id: "quote-123",
            addr: "0x1234abcd",
            addr_hash: "addr-hash",
            trans_id: "tx-207-no-flag",
            storage_price: 2.75,
            object_id: "obj-001",
            object_key: "obj-001.tar.gz.enc",
            provider: "aws",
            bucket_name: "mnemospark-1234",
            location: "us-east-1",
          }),
          {
            status: 207,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    expect(requestCount).toBe(1);
    expect(upload.object_key).toBe("obj-001.tar.gz.enc");
  });

  it("forwards upload request with wallet and idempotency headers (no payment headers)", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardStorageUploadToBackend(SAMPLE_UPLOAD_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      idempotencyKey: "idemp-456",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "PAYMENT-RESPONSE": "response-header",
          },
        });
      },
    });

    expect(capturedUrl).toBe("https://api.example.com/prod/storage/upload");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-Wallet-Signature"]).toBe("wallet-proof-header");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["Idempotency-Key"]).toBe("idemp-456");
    expect(headers["PAYMENT-SIGNATURE"]).toBeUndefined();
    expect(headers["x-payment"]).toBeUndefined();
    const forwardedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(forwardedBody.quote_id).toBe(SAMPLE_UPLOAD_REQUEST.quote_id);
    expect(forwardedBody.wallet_address).toBe(SAMPLE_UPLOAD_REQUEST.wallet_address);
    expect(forwardedBody.object_id).toBe(SAMPLE_UPLOAD_REQUEST.object_id);
    expect(forwardedBody.object_id_hash).toBe(SAMPLE_UPLOAD_REQUEST.object_id_hash);
    expect(forwardedBody.ciphertext).toBe(SAMPLE_UPLOAD_REQUEST.payload.content_base64);
    expect(forwardedBody.wrapped_dek).toBe(SAMPLE_UPLOAD_REQUEST.payload.wrapped_dek);
    expect(forwardedBody.mode).toBe("inline");
    expect(forwardedBody.encryption_algorithm).toBeUndefined();
    expect(forwardedBody.payload).toBeUndefined();
    expect(forwardedBody.quoted_storage_price).toBeUndefined();
    expect(forwarded.status).toBe(200);
    expect(forwarded.paymentResponse).toBe("response-header");
  });

  it("forwards presigned upload request with flat body and no ciphertext", async () => {
    let capturedInit: RequestInit | undefined;

    await forwardStorageUploadToBackend(SAMPLE_UPLOAD_REQUEST_PRESIGNED, {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    const forwardedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(forwardedBody.mode).toBe("presigned");
    expect(forwardedBody.ciphertext).toBeUndefined();
    expect(forwardedBody.wrapped_dek).toBe(SAMPLE_UPLOAD_REQUEST_PRESIGNED.payload.wrapped_dek);
    expect(forwardedBody.payload).toBeUndefined();
    expect(forwardedBody.object_key).toBe(SAMPLE_UPLOAD_REQUEST_PRESIGNED.object_id);
  });

  it("forwards upload confirm request to backend with wallet signature", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardStorageUploadConfirmToBackend(SAMPLE_UPLOAD_CONFIRM_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "PAYMENT-RESPONSE": "response-header",
          },
        });
      },
    });

    expect(capturedUrl).toBe("https://api.example.com/prod/storage/upload/confirm");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-Wallet-Signature"]).toBe("wallet-proof-header");
    expect(headers["x-api-key"]).toBeUndefined();
    const forwardedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(forwardedBody).toEqual(SAMPLE_UPLOAD_CONFIRM_REQUEST);
    expect(forwarded.status).toBe(200);
    expect(forwarded.paymentResponse).toBe("response-header");
  });

  it("requires wallet proof for upload forwarding", async () => {
    await expect(
      forwardStorageUploadToBackend(SAMPLE_UPLOAD_REQUEST, {
        backendBaseUrl: "https://api.example.com/prod/",
      }),
    ).rejects.toThrow("Wallet required for storage endpoints");
  });

  it("forwards payment/settle to backend with wallet signature", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const result = await forwardPaymentSettleToBackend("quote-123", "0x1234abcd", {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      paymentAuthorization: "signed-inline-payment",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            quote_id: "quote-123",
            wallet_address: "0x1234abcd",
            trans_id: "tx-001",
            payment_status: "confirmed",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    expect(capturedUrl).toBe("https://api.example.com/prod/payment/settle");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-Wallet-Signature"]).toBe("wallet-proof-header");
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body.quote_id).toBe("quote-123");
    expect(body.wallet_address).toBe("0x1234abcd");
    expect(body.payment_authorization).toBe("signed-inline-payment");
    expect(result.status).toBe(200);
  });

  it("forwards renewal payment/settle without quote_id", async () => {
    let capturedInit: RequestInit | undefined;

    await forwardPaymentSettleToBackend("", "0x1234abcd", {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      renewal: true,
      objectKey: "obj/k.enc",
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify({ payment_status: "confirmed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body.quote_id).toBeUndefined();
    expect(body.renewal).toBe(true);
    expect(body.object_key).toBe("obj/k.enc");
    expect(body.wallet_address).toBe("0x1234abcd");
  });

  it("requestPaymentSettleViaProxy POSTs to proxy path", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    const result = await requestPaymentSettleViaProxy("quote-456", "0xabcd", {
      proxyBaseUrl: "http://127.0.0.1:9999/",
      payment: { intent: "charge" },
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedBody = typeof init?.body === "string" ? init.body : "";
        return new Response(JSON.stringify({ payment_status: "confirmed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    expect(capturedUrl).toBe("http://127.0.0.1:9999/mnemospark/payment/settle");
    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(body.quote_id).toBe("quote-456");
    expect(body.wallet_address).toBe("0xabcd");
    expect(body.payment).toEqual({ intent: "charge" });
    expect(result.status).toBe(200);
  });

  it("requestPaymentSettleViaProxy sends renewal body when flagged", async () => {
    let capturedBody = "";

    await requestPaymentSettleViaProxy("", "0xabcd", {
      proxyBaseUrl: "http://127.0.0.1:9999/",
      renewal: true,
      objectKey: "a/b.enc",
      fetchImpl: async (input, init) => {
        capturedBody = typeof init?.body === "string" ? init.body : "";
        return new Response(JSON.stringify({ payment_status: "confirmed" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(body.quote_id).toBeUndefined();
    expect(body.renewal).toBe(true);
    expect(body.object_key).toBe("a/b.enc");
  });
});
