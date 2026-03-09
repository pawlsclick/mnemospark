import { describe, expect, it } from "vitest";

import {
  forwardPriceStorageToBackend,
  forwardStorageUploadToBackend,
  requestPriceStorageViaProxy,
  requestStorageUploadViaProxy,
  type PriceStorageQuoteRequest,
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

  it("forwards price-storage request to backend with optional wallet signature", async () => {
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
  });

  it("forwards upload request with payment and idempotency headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardStorageUploadToBackend(SAMPLE_UPLOAD_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      paymentSignature: "signed-payment-payload",
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
    expect(headers["PAYMENT-SIGNATURE"]).toBe("signed-payment-payload");
    expect(headers["x-payment"]).toBe("signed-payment-payload");
    const forwardedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(forwardedBody.quote_id).toBe(SAMPLE_UPLOAD_REQUEST.quote_id);
    expect(forwardedBody.wallet_address).toBe(SAMPLE_UPLOAD_REQUEST.wallet_address);
    expect(forwardedBody.object_id).toBe(SAMPLE_UPLOAD_REQUEST.object_id);
    expect(forwardedBody.object_id_hash).toBe(SAMPLE_UPLOAD_REQUEST.object_id_hash);
    expect(forwardedBody.ciphertext).toBe(SAMPLE_UPLOAD_REQUEST.payload.content_base64);
    expect(forwardedBody.wrapped_dek).toBe(SAMPLE_UPLOAD_REQUEST.payload.wrapped_dek);
    expect(forwardedBody.mode).toBe("inline");
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

  it("requires wallet proof for upload forwarding", async () => {
    await expect(
      forwardStorageUploadToBackend(SAMPLE_UPLOAD_REQUEST, {
        backendBaseUrl: "https://api.example.com/prod/",
      }),
    ).rejects.toThrow("Wallet required for storage endpoints");
  });
});
