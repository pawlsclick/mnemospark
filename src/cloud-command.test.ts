import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import { afterEach, describe, expect, it } from "vitest";

import { buildBackupObject, createCloudCommand } from "./cloud-command.js";
import { PaymentCache } from "./payment-cache.js";

const sandboxDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    sandboxDirs.map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
  sandboxDirs.length = 0;
});

async function createSandbox() {
  const root = await mkdtemp(join(tmpdir(), "mnemospark-cloud-backup-"));
  sandboxDirs.push(root);
  const homeDir = join(root, "home");
  const tmpBackupDir = join(root, "tmp");
  const sourceDir = join(root, "source");

  await mkdir(homeDir, { recursive: true });
  await mkdir(tmpBackupDir, { recursive: true });
  await mkdir(sourceDir, { recursive: true });

  return { root, homeDir, tmpBackupDir, sourceDir };
}

function randomBytesFixture(size: number): Buffer {
  return Buffer.from("0011223344556677".slice(0, size * 2), "hex");
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

describe("cloud command", () => {
  it("requires authentication", () => {
    const command = createCloudCommand();
    expect(command.requireAuth).toBe(true);
  });

  it("builds tar.gz object, computes hash/size, and appends object.log entry", async () => {
    const { homeDir, tmpBackupDir, sourceDir } = await createSandbox();
    await writeFile(join(sourceDir, "notes.txt"), "hello from mnemospark backup");

    const result = await buildBackupObject(sourceDir, {
      platform: "linux",
      homeDir,
      tmpDir: tmpBackupDir,
      now: () => 1700000000000,
      randomBytes: randomBytesFixture,
    });

    expect(result.objectId).toBe("1700000000000-0011223344556677");
    expect(result.objectIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number.parseFloat(result.objectSizeGb)).toBeGreaterThan(0);

    const archiveStats = await stat(result.archivePath);
    expect(archiveStats.size).toBeGreaterThan(0);

    const logContent = await readFile(result.objectLogPath, "utf-8");
    const lastLine = logContent.trim().split("\n").at(-1);
    expect(lastLine).toBe(`${result.objectId},${result.objectIdHash},${result.objectSizeGb}`);
  });

  it("removes archive when metadata logging fails after archive creation", async () => {
    const { root, tmpBackupDir, sourceDir } = await createSandbox();
    await writeFile(join(sourceDir, "notes.txt"), "hello from mnemospark backup");

    const invalidHomeDir = join(root, "home-file");
    await writeFile(invalidHomeDir, "not a directory");
    const filesBefore = await readdir(tmpBackupDir);

    await expect(
      buildBackupObject(sourceDir, {
        platform: "linux",
        homeDir: invalidHomeDir,
        tmpDir: tmpBackupDir,
        now: () => 1700000002000,
        randomBytes: randomBytesFixture,
      }),
    ).rejects.toThrow();

    const filesAfter = await readdir(tmpBackupDir);
    expect(filesAfter).toEqual(filesBefore);
  });

  it("returns expected user message for /cloud backup and supports quoted paths", async () => {
    const { homeDir, tmpBackupDir, root } = await createSandbox();
    const sourcePathWithSpaces = join(root, "source file.txt");
    await writeFile(sourcePathWithSpaces, "backup me");

    const command = createCloudCommand({
      backupOptions: {
        platform: "linux",
        homeDir,
        tmpDir: tmpBackupDir,
        now: () => 1700000001000,
        randomBytes: randomBytesFixture,
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `backup "${sourcePathWithSpaces}"`,
      commandBody: `backup "${sourcePathWithSpaces}"`,
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("Your object-id is");
    expect(result.text).toContain("your object-id-hash is");
    expect(result.text).toContain("and your object-size is");
  });

  it("returns graceful unsupported-platform message", async () => {
    const command = createCloudCommand({
      backupOptions: {
        platform: "win32",
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "backup /tmp/something",
      commandBody: "backup /tmp/something",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cloud backup is only supported on macOS and Linux.");
  });

  it("handles /cloud price-storage, logs quote, and prints next-step upload command", async () => {
    const { homeDir } = await createSandbox();
    let capturedRequest: Record<string, unknown> | undefined;

    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      requestPriceStorageQuoteFn: async (request) => {
        capturedRequest = request as Record<string, unknown>;
        return {
          timestamp: "2026-02-25 19:00:00",
          quote_id: "quote-abc123",
          storage_price: 2.75,
          addr: "0x1234abcd",
          object_id: "obj-001",
          object_id_hash: "hash-001",
          object_size_gb: 0.015,
          provider: "aws",
          location: "us-east-1",
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "price-storage",
        "--wallet-address 0x1234abcd",
        "--object-id obj-001",
        "--object-id-hash hash-001",
        "--gb 0.015",
        "--provider aws",
        "--region us-east-1",
      ].join(" "),
      commandBody: "price-storage",
      config: {},
    });

    expect(capturedRequest).toEqual({
      wallet_address: "0x1234abcd",
      object_id: "obj-001",
      object_id_hash: "hash-001",
      gb: 0.015,
      provider: "aws",
      region: "us-east-1",
    });
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("Your storage quote `quote-abc123` is valid for 1 hour");
    expect(result.text).toContain("If you accept this quote run the command /cloud upload");
    expect(result.text).toContain("--object-id-hash `hash-001`");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    const logContent = await readFile(objectLogPath, "utf-8");
    const lastLine = logContent.trim().split("\n").at(-1);
    expect(lastLine).toBe(
      "2026-02-25 19:00:00,quote-abc123,2.75,0x1234abcd,obj-001,hash-001,0.015,aws,us-east-1",
    );
  });

  it("returns Cannot price storage on invalid /cloud price-storage args", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "price-storage --wallet-address 0x1234abcd",
      commandBody: "price-storage --wallet-address 0x1234abcd",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cannot price storage");
  });

  it("returns Cannot price storage when proxy quote request fails", async () => {
    const command = createCloudCommand({
      requestPriceStorageQuoteFn: async () => {
        throw new Error("network down");
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "price-storage",
        "--wallet-address 0x1234abcd",
        "--object-id obj-001",
        "--object-id-hash hash-001",
        "--gb 0.015",
        "--provider aws",
        "--region us-east-1",
      ].join(" "),
      commandBody: "price-storage",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cannot price storage");
  });

  it("handles /cloud upload, builds encrypted payload, and logs upload response", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"11".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-001";
    const archiveContent = "mnemospark upload content";
    const objectHash = sha256Hex(archiveContent);
    const archivePath = join(tmpBackupDir, objectId);
    await writeFile(archivePath, archiveContent, "utf-8");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await writeFile(
      objectLogPath,
      `2026-02-25 19:00:00,quote-abc123,2.75,${walletAddress},${objectId},${objectHash},0.015,aws,us-east-1\n`,
      "utf-8",
    );

    let createPaymentFetchCalls = 0;
    let capturedBody: Record<string, unknown> | undefined;
    let capturedIdempotency: string | null = null;

    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      idempotencyKeyFn: () => "idempotency-123",
      nowDateFn: () => new Date(2026, 1, 25, 20, 10, 0),
      createPaymentFetchFn: () => {
        createPaymentFetchCalls += 1;
        return {
          fetch: async (_input, init) => {
            capturedIdempotency = new Headers(init?.headers).get("Idempotency-Key");
            if (typeof init?.body === "string") {
              capturedBody = JSON.parse(init.body) as Record<string, unknown>;
            }
            return new Response(
              JSON.stringify({
                quote_id: "quote-abc123",
                addr: walletAddress,
                addr_hash: "addr-hash",
                trans_id: "tx-001",
                storage_price: 2.75,
                object_id: objectId,
                object_key: "obj-upload-001.tar.gz.enc",
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
          cache: new PaymentCache(),
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "upload",
        "--quote-id quote-abc123",
        `--wallet-address ${walletAddress}`,
        `--object-id ${objectId}`,
        `--object-id-hash ${objectHash}`,
      ].join(" "),
      commandBody: "upload",
      config: {},
    });

    expect(createPaymentFetchCalls).toBe(1);
    expect(capturedIdempotency).toBe("idempotency-123");
    expect(capturedBody?.quoted_storage_price).toBe(2.75);
    const payload = capturedBody?.payload as Record<string, unknown>;
    expect(payload.mode).toBe("inline");
    expect(typeof payload.content_base64).toBe("string");
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain(
      "Your file `obj-upload-001` with key `obj-upload-001.tar.gz.enc`",
    );
    expect(result.text).toContain("30-day USDC payment reminder");
    expect(result.text).toContain("32-day deadline");

    const logContent = await readFile(objectLogPath, "utf-8");
    const lastLine = logContent.trim().split("\n").at(-1);
    expect(lastLine).toBe(
      `2026-02-25 20:10:00,quote-abc123,${walletAddress},addr-hash,tx-001,2.75,obj-upload-001,obj-upload-001.tar.gz.enc,aws,mnemospark-1234,us-east-1`,
    );
  });

  it("returns parsed proxy message when /cloud upload balance check fails", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"22".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-002";
    const archiveContent = "mnemospark upload content 2";
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await writeFile(
      objectLogPath,
      `2026-02-25 19:00:00,quote-xyz,2.75,${walletAddress},${objectId},${objectHash},0.015,aws,us-east-1\n`,
      "utf-8",
    );

    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      createPaymentFetchFn: () => ({
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: "insufficient_balance",
              message: "Insufficient USDC balance. Current: $0.10, Required: $2.75",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
        cache: new PaymentCache(),
      }),
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "upload",
        "--quote-id quote-xyz",
        `--wallet-address ${walletAddress}`,
        `--object-id ${objectId}`,
        `--object-id-hash ${objectHash}`,
      ].join(" "),
      commandBody: "upload",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Insufficient USDC balance. Current: $0.10, Required: $2.75");
  });

  it("returns Cannot upload storage object on invalid /cloud upload args", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "upload --quote-id quote-only",
      commandBody: "upload --quote-id quote-only",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cannot upload storage object");
  });

  it("handles /cloud ls and prints object metadata message", async () => {
    let capturedRequest: Record<string, unknown> | undefined;

    const command = createCloudCommand({
      requestStorageLsFn: async (request) => {
        capturedRequest = request as Record<string, unknown>;
        return {
          success: true,
          key: "backup/archive.tar.gz",
          size_bytes: 1536,
          bucket: "wallet-bucket-001",
          object_id: "obj-001",
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address 0x1234abcd --object-key backup/archive.tar.gz",
      commandBody: "ls",
      config: {},
    });

    expect(capturedRequest).toEqual({
      wallet_address: "0x1234abcd",
      object_key: "backup/archive.tar.gz",
      location: undefined,
    });
    expect(result.isError).not.toBe(true);
    expect(result.text).toBe("obj-001 with backup/archive.tar.gz is 1536 in wallet-bucket-001");
  });

  it("handles /cloud download and prints success message", async () => {
    let capturedRequest: Record<string, unknown> | undefined;

    const command = createCloudCommand({
      requestStorageDownloadFn: async (request) => {
        capturedRequest = request as Record<string, unknown>;
        return {
          success: true,
          key: "backup/archive.tar.gz",
          file_path: "/tmp/backup/archive.tar.gz",
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "download --wallet-address 0x1234abcd --object-key backup/archive.tar.gz",
      commandBody: "download",
      config: {},
    });

    expect(capturedRequest).toEqual({
      wallet_address: "0x1234abcd",
      object_key: "backup/archive.tar.gz",
      location: undefined,
    });
    expect(result.isError).not.toBe(true);
    expect(result.text).toBe("File backup/archive.tar.gz downloaded");
  });

  it("handles /cloud delete and prints success message", async () => {
    let capturedRequest: Record<string, unknown> | undefined;

    const command = createCloudCommand({
      requestStorageDeleteFn: async (request) => {
        capturedRequest = request as Record<string, unknown>;
        return {
          success: true,
          key: "backup/archive.tar.gz",
          bucket: "wallet-bucket-001",
          bucket_deleted: false,
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "delete --wallet-address 0x1234abcd --object-key backup/archive.tar.gz",
      commandBody: "delete",
      config: {},
    });

    expect(capturedRequest).toEqual({
      wallet_address: "0x1234abcd",
      object_key: "backup/archive.tar.gz",
      location: undefined,
    });
    expect(result.isError).not.toBe(true);
    expect(result.text).toBe("File backup/archive.tar.gz deleted");
  });

  it("returns Cannot list storage object on invalid /cloud ls args", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address 0x1234abcd",
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cannot list storage object");
  });

  it("returns Cannot download file when /cloud download fails", async () => {
    const command = createCloudCommand({
      requestStorageDownloadFn: async () => {
        throw new Error("download failed");
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "download --wallet-address 0x1234abcd --object-key backup/archive.tar.gz",
      commandBody: "download",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cannot download file");
  });

  it("returns Cannot delete file when /cloud delete fails", async () => {
    const command = createCloudCommand({
      requestStorageDeleteFn: async () => {
        throw new Error("delete failed");
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "delete --wallet-address 0x1234abcd --object-key backup/archive.tar.gz",
      commandBody: "delete",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cannot delete file");
  });
});
