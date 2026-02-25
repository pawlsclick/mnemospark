import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  downloadStorageToDisk,
  forwardStorageDeleteToBackend,
  forwardStorageDownloadToBackend,
  requestStorageLsViaProxy,
  type BackendStorageForwardResult,
  type StorageObjectRequest,
} from "./cloud-storage.js";

const sandboxDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    sandboxDirs.map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
  sandboxDirs.length = 0;
});

const SAMPLE_REQUEST: StorageObjectRequest = {
  wallet_address: "0x1234abcd",
  object_key: "backup/archive.tar.gz",
};

describe("cloud storage transport", () => {
  it("sends ls request to local proxy and parses response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const lsResult = await requestStorageLsViaProxy(SAMPLE_REQUEST, {
      proxyBaseUrl: "http://127.0.0.1:7120/",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(
          JSON.stringify({
            success: true,
            key: SAMPLE_REQUEST.object_key,
            size_bytes: 2048,
            bucket: "wallet-bucket-001",
            object_id: "obj-001",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    expect(capturedUrl).toBe("http://127.0.0.1:7120/mnemospark/storage/ls");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(capturedInit?.body).toBe(JSON.stringify(SAMPLE_REQUEST));
    expect(lsResult.size_bytes).toBe(2048);
    expect(lsResult.bucket).toBe("wallet-bucket-001");
  });

  it("forwards delete request to backend with api key and payment headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardStorageDeleteToBackend(SAMPLE_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      backendApiKey: "test-api-key",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "PAYMENT-RESPONSE": "payment-ok",
          },
        });
      },
    });

    expect(capturedUrl).toBe("https://api.example.com/prod/storage/delete");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["x-api-key"]).toBe("test-api-key");
    expect(forwarded.status).toBe(200);
    expect(forwarded.paymentResponse).toBe("payment-ok");
  });

  it("forwards download request to backend /storage/download", async () => {
    let capturedUrl = "";

    const forwarded = await forwardStorageDownloadToBackend(SAMPLE_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      backendApiKey: "test-api-key",
      fetchImpl: async (input) => {
        capturedUrl = String(input);
        return new Response("download-bytes", {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
          },
        });
      },
    });

    expect(capturedUrl).toBe("https://api.example.com/prod/storage/download");
    expect(forwarded.status).toBe(200);
    expect(forwarded.bodyBuffer.toString("utf-8")).toBe("download-bytes");
  });

  it("downloads file via presigned URL and writes to disk", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mnemospark-cloud-storage-"));
    sandboxDirs.push(outputDir);

    let fetchedPresignedUrl = "";
    const backendResponse: BackendStorageForwardResult = {
      status: 200,
      bodyText: JSON.stringify({
        download_url: "https://example.com/presigned-download",
        object_key: "downloads/file.txt",
      }),
      bodyBuffer: Buffer.from(
        JSON.stringify({
          download_url: "https://example.com/presigned-download",
          object_key: "downloads/file.txt",
        }),
      ),
      contentType: "application/json",
      paymentRequired: undefined,
      paymentResponse: undefined,
      contentDisposition: undefined,
    };

    const result = await downloadStorageToDisk(SAMPLE_REQUEST, backendResponse, {
      outputDir,
      fetchImpl: async (input) => {
        fetchedPresignedUrl = String(input);
        return new Response("hello from object store", {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        });
      },
    });

    expect(fetchedPresignedUrl).toBe("https://example.com/presigned-download");
    expect(result.filePath).toBe(join(outputDir, "downloads", "file.txt"));
    expect(await readFile(result.filePath, "utf-8")).toBe("hello from object store");
  });

  it("writes inline base64 download payload to disk", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mnemospark-cloud-storage-inline-"));
    sandboxDirs.push(outputDir);

    const inlinePayload = Buffer.from("inline payload bytes", "utf-8").toString("base64");
    const backendResponse: BackendStorageForwardResult = {
      status: 200,
      bodyText: JSON.stringify({
        object_key: "inline/file.bin",
        content: inlinePayload,
      }),
      bodyBuffer: Buffer.from(
        JSON.stringify({
          object_key: "inline/file.bin",
          content: inlinePayload,
        }),
      ),
      contentType: "application/json; charset=utf-8",
      paymentRequired: undefined,
      paymentResponse: undefined,
      contentDisposition: undefined,
    };

    const result = await downloadStorageToDisk(SAMPLE_REQUEST, backendResponse, {
      outputDir,
    });

    expect(result.filePath).toBe(join(outputDir, "inline", "file.bin"));
    expect(await readFile(result.filePath, "utf-8")).toBe("inline payload bytes");
  });
});
