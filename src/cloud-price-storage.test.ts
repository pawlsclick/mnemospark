import { describe, expect, it } from "vitest";

import {
  forwardPriceStorageToBackend,
  requestPriceStorageViaProxy,
  type PriceStorageQuoteRequest,
} from "./cloud-price-storage.js";

const SAMPLE_REQUEST: PriceStorageQuoteRequest = {
  wallet_address: "0x1234abcd",
  object_id: "obj-001",
  object_id_hash: "hash-001",
  gb: 0.015,
  provider: "aws",
  region: "us-east-1",
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

  it("forwards price-storage request to backend with x-api-key and normalizes payment header", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardPriceStorageToBackend(SAMPLE_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      backendApiKey: "test-api-key",
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
    expect((capturedInit?.headers as Record<string, string>)["x-api-key"]).toBe("test-api-key");
    expect(forwarded.status).toBe(402);
    expect(forwarded.paymentRequired).toBe("legacy-required-header");
  });
});
