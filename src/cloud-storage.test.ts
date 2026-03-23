import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { MNEMOSPARK_OPERATION_ID_HEADER, MNEMOSPARK_TRACE_ID_HEADER } from "./cloud-correlation.js";

import {
  downloadStorageToDisk,
  forwardStorageDeleteToBackend,
  forwardStorageDownloadToBackend,
  forwardStorageLsToBackend,
  jsonBodyForLsRequest,
  parseProxyStorageDownloadPayload,
  parseStorageLsResponse,
  requestStorageLsViaProxy,
  sanitizeFriendlyNameForLocalBasename,
  type BackendStorageForwardResult,
  type StorageObjectRequest,
} from "./cloud-storage.js";
import { AES_GCM_NONCE_BYTES, resolveWalletKekPath } from "./cloud-storage-crypto.js";
import { formatBytesForDisplay } from "./cloud-utils.js";

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

function encryptAesGcm(plaintext: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

describe("sanitizeFriendlyNameForLocalBasename", () => {
  it("uses the last path segment and strips control characters", () => {
    expect(sanitizeFriendlyNameForLocalBasename("my backup")).toBe("my backup");
    expect(sanitizeFriendlyNameForLocalBasename("a/b/c")).toBe("c");
  });

  it("throws on empty or invalid names", () => {
    expect(() => sanitizeFriendlyNameForLocalBasename("")).toThrow();
    expect(() => sanitizeFriendlyNameForLocalBasename("..")).toThrow();
  });
});

describe("parseProxyStorageDownloadPayload", () => {
  it("parses backend fields and optional mnemospark_local_filename", () => {
    expect(
      parseProxyStorageDownloadPayload({
        wallet_address: "0xabc",
        object_key: "k1",
      }),
    ).toEqual({
      request: { wallet_address: "0xabc", object_key: "k1" },
    });
    expect(
      parseProxyStorageDownloadPayload({
        wallet_address: "0xabc",
        object_key: "k1",
        mnemospark_local_filename: "friendly.bin",
      }),
    ).toEqual({
      request: { wallet_address: "0xabc", object_key: "k1" },
      localBasename: "friendly.bin",
    });
    expect(parseProxyStorageDownloadPayload({})).toBeNull();
  });
});

describe("formatBytesForDisplay", () => {
  it("uses decimal SI units and handles zero", () => {
    expect(formatBytesForDisplay(0)).toBe("0 B");
    expect(formatBytesForDisplay(1)).toBe("1 B");
    expect(formatBytesForDisplay(1000)).toBe("1 KB");
    expect(formatBytesForDisplay(1_500_000)).toBe("1.5 MB");
  });
});

describe("cloud storage transport", () => {
  it("sends ls request to local proxy and parses response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const lsResult = await requestStorageLsViaProxy(SAMPLE_REQUEST, {
      proxyBaseUrl: "http://127.0.0.1:7120/",
      correlation: {
        operationId: "op-ls-1",
        traceId: "trace-ls-1",
      },
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
    expect((capturedInit?.headers as Record<string, string>)[MNEMOSPARK_OPERATION_ID_HEADER]).toBe(
      "op-ls-1",
    );
    expect((capturedInit?.headers as Record<string, string>)[MNEMOSPARK_TRACE_ID_HEADER]).toBe(
      "trace-ls-1",
    );
    expect(capturedInit?.body).toBe(JSON.stringify(SAMPLE_REQUEST));
    expect(lsResult.mode).toBe("stat");
    if (lsResult.mode === "stat") {
      expect(lsResult.size_bytes).toBe(2048);
      expect(lsResult.bucket).toBe("wallet-bucket-001");
    }
  });

  it("sends wallet-only ls JSON without object_key", async () => {
    let body = "";
    await requestStorageLsViaProxy(
      { wallet_address: "0xaaaabbbbccccddddeeeeffff00001111aaaabbbb" },
      {
        proxyBaseUrl: "http://127.0.0.1:7120/",
        fetchImpl: async (_input, init) => {
          body = String(init?.body ?? "");
          return new Response(
            JSON.stringify({
              success: true,
              list_mode: true,
              bucket: "b",
              objects: [],
              is_truncated: false,
              next_continuation_token: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    );
    expect(body).toBe(
      JSON.stringify(
        jsonBodyForLsRequest({ wallet_address: "0xaaaabbbbccccddddeeeeffff00001111aaaabbbb" }),
      ),
    );
  });

  it("parses list and stat ls responses", () => {
    const list = parseStorageLsResponse({
      success: true,
      list_mode: true,
      bucket: "bk",
      objects: [{ key: "x", size_bytes: 1000, last_modified: "2025-01-01T00:00:00Z" }],
      is_truncated: true,
      next_continuation_token: "tok",
    });
    expect(list.mode).toBe("list");
    if (list.mode === "list") {
      expect(list.objects).toHaveLength(1);
    }

    const stat = parseStorageLsResponse({
      success: true,
      key: "y",
      size_bytes: 99,
      bucket: "bk2",
    });
    expect(stat.mode).toBe("stat");
    if (stat.mode === "stat") {
      expect(stat.key).toBe("y");
    }
  });

  it("rejects stat ls responses with invalid size_bytes", () => {
    expect(() =>
      parseStorageLsResponse({
        success: true,
        key: "fractional",
        size_bytes: 1.5,
        bucket: "bk",
      }),
    ).toThrow("ls response has invalid size_bytes; expected non-negative integer");

    expect(() =>
      parseStorageLsResponse({
        success: true,
        key: "negative",
        size_bytes: -1,
        bucket: "bk",
      }),
    ).toThrow("ls response has invalid size_bytes; expected non-negative integer");
  });

  it("forwards delete request to backend with wallet proof header", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardStorageDeleteToBackend(SAMPLE_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
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
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-Wallet-Signature"]).toBe("wallet-proof-header");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(forwarded.status).toBe(200);
    expect(forwarded.paymentResponse).toBe("payment-ok");
  });

  it("forwards download request to backend /storage/download", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const forwarded = await forwardStorageDownloadToBackend(SAMPLE_REQUEST, {
      backendBaseUrl: "https://api.example.com/prod/",
      walletSignature: "wallet-proof-header",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response("download-bytes", {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
          },
        });
      },
    });

    expect(capturedUrl).toBe("https://api.example.com/prod/storage/download");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-Wallet-Signature"]).toBe("wallet-proof-header");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(forwarded.status).toBe(200);
    expect(forwarded.bodyBuffer.toString("utf-8")).toBe("download-bytes");
  });

  it("requires wallet proof for storage endpoint forwarding", async () => {
    await expect(
      forwardStorageLsToBackend(SAMPLE_REQUEST, {
        backendBaseUrl: "https://api.example.com/prod/",
      }),
    ).rejects.toThrow("Wallet required for storage endpoints");
  });

  it("downloads file via presigned URL and writes to disk", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mnemospark_cloud-storage-"));
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

  it("uses localOutputBasename for on-disk path when provided", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mnemospark_cloud-storage-basename-"));
    sandboxDirs.push(outputDir);

    const backendResponse: BackendStorageForwardResult = {
      status: 200,
      bodyText: JSON.stringify({
        download_url: "https://example.com/presigned-download",
        object_key: "cloud/key.tar.gz.enc",
      }),
      bodyBuffer: Buffer.from("{}"),
      contentType: "application/json",
    };

    const result = await downloadStorageToDisk(SAMPLE_REQUEST, backendResponse, {
      outputDir,
      localOutputBasename: "my-friendly-backup",
      fetchImpl: async () =>
        new Response("x", { status: 200, headers: { "Content-Type": "application/octet-stream" } }),
    });

    expect(result.filePath).toBe(join(outputDir, "my-friendly-backup"));
    expect(await readFile(result.filePath, "utf-8")).toBe("x");
  });

  it("decrypts presigned download bytes when wrapped DEK metadata is present", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mnemospark_cloud-storage-decrypt-"));
    sandboxDirs.push(outputDir);
    const homeDir = await mkdtemp(join(tmpdir(), "mnemospark_cloud-storage-home-"));
    sandboxDirs.push(homeDir);

    const keyPath = resolveWalletKekPath(SAMPLE_REQUEST.wallet_address, homeDir);
    const kekDir = join(homeDir, ".openclaw", "mnemospark", "keys");
    const kek = randomBytes(32);
    await mkdir(kekDir, { recursive: true });
    await writeFile(keyPath, kek, { mode: 0o600 });

    const plaintext = Buffer.from("hello from decrypted object", "utf-8");
    const dek = randomBytes(32);
    const encryptedPayload = encryptAesGcm(plaintext, dek);
    const wrappedDek = encryptAesGcm(dek, kek).toString("base64");

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

    try {
      const result = await downloadStorageToDisk(SAMPLE_REQUEST, backendResponse, {
        outputDir,
        homeDir,
        fetchImpl: async () => {
          return new Response(new Uint8Array(encryptedPayload), {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "x-amz-meta-wrapped-dek": wrappedDek,
            },
          });
        },
      });

      expect(result.filePath).toBe(join(outputDir, "downloads", "file.txt"));
      expect(await readFile(result.filePath, "utf-8")).toBe("hello from decrypted object");
    } finally {
      await rm(keyPath, { force: true });
    }
  });

  it("writes inline base64 download payload to disk", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "mnemospark_cloud-storage-inline-"));
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
