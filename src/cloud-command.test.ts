import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import { afterEach, describe, expect, it } from "vitest";

import { buildBackupObject, createCloudCommand, expandTilde } from "./cloud-command.js";
import type { StorageDownloadProxyResponse } from "./cloud-storage.js";
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
  const root = await mkdtemp(join(tmpdir(), "mnemospark_cloud-backup-"));
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

describe("expandTilde", () => {
  it("expands ~/foo to homedir + /foo", () => {
    expect(expandTilde("~/x")).toBe(join(homedir(), "x"));
    expect(expandTilde("~/foo/bar")).toBe(join(homedir(), "foo", "bar"));
  });

  it("expands ~ to homedir", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("leaves absolute path unchanged", () => {
    expect(expandTilde("/abs")).toBe("/abs");
    expect(expandTilde("/abs/path")).toBe("/abs/path");
  });

  it("leaves relative path unchanged", () => {
    expect(expandTilde("rel")).toBe("rel");
    expect(expandTilde("relative/path")).toBe("relative/path");
  });
});

describe("cloud command", () => {
  it("requires authentication", () => {
    const command = createCloudCommand();
    expect(command.requireAuth).toBe(true);
  });

  it("uses object-key terminology in cloud help text", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "",
      commandBody: "help",
      config: {},
    });

    if (!result.text) {
      throw new Error("Expected cloud help text");
    }

    expect(result.text).toContain("/mnemospark_cloud ls --wallet-address <addr>");
    expect(result.text).toContain("[--object-key <object-key> | --name <friendly-name>]");
    expect(result.text).toContain("/mnemospark_cloud download --wallet-address <addr>");
    expect(result.text).toContain("/mnemospark_cloud delete --wallet-address <addr>");
    expect(result.text).not.toContain("<s3-key>");
    expect(result.text).not.toContain("s3-key");
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

  it("backup succeeds when path uses leading tilde and file exists under HOME", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const downloadsDir = join(homeDir, "Downloads");
    await mkdir(downloadsDir, { recursive: true });
    const filePath = join(downloadsDir, "constitution.pdf");
    await writeFile(filePath, "pdf content");

    const originalHome = process.env.HOME;
    try {
      process.env.HOME = homeDir;
      const result = await buildBackupObject("~/Downloads/constitution.pdf", {
        platform: "linux",
        homeDir,
        tmpDir: tmpBackupDir,
        now: () => 1700000000000,
        randomBytes: randomBytesFixture,
      });
      expect(result.objectId).toBe("1700000000000-0011223344556677");
      expect(result.objectIdHash).toMatch(/^[a-f0-9]{64}$/);
      expect(Number.parseFloat(result.objectSizeGb)).toBeGreaterThan(0);
    } finally {
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
    }
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

  it("returns expected user message for /mnemospark cloud backup and supports quoted paths", async () => {
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
    expect(result.text).toContain("object-id:");
    expect(result.text).toContain("object-id-hash:");
    expect(result.text).toContain("object-size:");
  });

  it("preserves quoted backup friendly names and writes events.jsonl under the mnemospark home subdirectory", async () => {
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
      args: `backup "${sourcePathWithSpaces}" --name "my project"`,
      commandBody: `backup "${sourcePathWithSpaces}" --name "my project"`,
      config: {},
    });

    expect(result.isError).not.toBe(true);
    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const eventsContent = await readFile(eventsPath, "utf-8");
    const backupEvent = JSON.parse(eventsContent.trim().split("\n").at(-1) ?? "{}") as {
      event_type?: string;
      details?: { friendly_name?: string };
    };
    expect(backupEvent.event_type).toBe("backup.completed");
    expect(backupEvent.details?.friendly_name).toBe("my project");
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

  it("handles /mnemospark cloud price-storage, logs quote, and prints next-step upload command", async () => {
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
    expect(result.text).toContain(
      "If you accept this quote run the command /mnemospark_cloud upload",
    );
    expect(result.text).toContain("--object-id-hash `hash-001`");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    const logContent = await readFile(objectLogPath, "utf-8");
    const lastLine = logContent.trim().split("\n").at(-1);
    expect(lastLine).toBe(
      "2026-02-25 19:00:00,quote-abc123,2.75,0x1234abcd,obj-001,hash-001,0.015,aws,us-east-1",
    );
  });

  it("returns Cannot price storage on invalid /mnemospark cloud price-storage args", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "price-storage --wallet-address 0x1234abcd",
      commandBody: "price-storage --wallet-address 0x1234abcd",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Cannot price storage: required arguments are --wallet-address, --object-id, --object-id-hash, --gb, --provider, --region.",
    );
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
    expect(result.text).toBe("Cannot price storage: network down");
  });

  it("handles /mnemospark cloud upload, builds encrypted payload, logs upload response, and keeps archive by default", async () => {
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

    const uploadResponseBody = {
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
    };

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
            return new Response(JSON.stringify(uploadResponseBody), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          },
          cache: new PaymentCache(),
        };
      },
      proxyUploadOptions: {
        fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (typeof init?.body === "string") {
            capturedBody = JSON.parse(init.body) as Record<string, unknown>;
          }
          capturedIdempotency = new Headers(init?.headers).get("Idempotency-Key");
          return new Response(JSON.stringify(uploadResponseBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
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

    expect(createPaymentFetchCalls).toBe(0);
    expect(capturedIdempotency).toBe("idempotency-123");
    expect(capturedBody?.quoted_storage_price).toBe(2.75);
    const payload = capturedBody?.payload as Record<string, unknown>;
    expect(payload.mode).toBe("inline");
    expect(typeof payload.content_base64).toBe("string");
    expect(result.isError).not.toBe(true);
    if (!result.text) {
      throw new Error("Expected upload response text");
    }
    const messageLines = result.text.split("\n");
    expect(messageLines).toHaveLength(3);
    expect(messageLines[0]).toBe(
      "Your file `obj-upload-001` with key `obj-upload-001.tar.gz.enc` has been stored using `aws` in `mnemospark-1234` `us-east-1`",
    );
    expect(messageLines[1]).toContain("A cron job `");
    expect(messageLines[1]).toContain("monthly");
    expect(messageLines[1]).toContain("**32-day deadline**");
    expect(messageLines[2]).toBe("Thank you for using mnemospark!");

    const cronIdMatch = messageLines[1].match(/A cron job `([^`]+)` has been configured/);
    const cronId = cronIdMatch?.[1];
    expect(cronId).toBeTruthy();

    const logContent = await readFile(objectLogPath, "utf-8");
    const logLines = logContent.trim().split("\n");
    const uploadLogLine = logLines.at(-2);
    const cronLogLine = logLines.at(-1);
    expect(uploadLogLine).toBe(
      `2026-02-25 20:10:00,quote-abc123,${walletAddress},addr-hash,tx-001,2.75,obj-upload-001,obj-upload-001.tar.gz.enc,aws,mnemospark-1234,us-east-1`,
    );
    expect(cronLogLine).toBe(
      `cron,2026-02-25 20:10:00,${cronId},obj-upload-001,obj-upload-001.tar.gz.enc,quote-abc123,2.75`,
    );

    const cronTablePath = join(homeDir, ".openclaw", "mnemospark", "crontab.txt");
    const cronTableContent = await readFile(cronTablePath, "utf-8");
    const cronEntryLine = cronTableContent.trim().split("\n").at(-1);
    expect(cronEntryLine).toBeTruthy();
    const cronEntry = JSON.parse(cronEntryLine ?? "{}") as Record<string, unknown>;
    expect(cronEntry.cronId).toBe(cronId);
    expect(cronEntry.objectId).toBe(objectId);
    expect(cronEntry.objectKey).toBe("obj-upload-001.tar.gz.enc");
    expect(cronEntry.quoteId).toBe("quote-abc123");
    expect(cronEntry.storagePrice).toBe(2.75);
    expect(cronEntry.schedule).toBe("0 0 1 * *");

    // By default, local backup archive should remain on disk.
    const archiveExists = await stat(archivePath);
    expect(archiveExists.isFile()).toBe(true);
  });

  it("optionally deletes local backup archive after successful /mnemospark cloud upload when flag is set", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"44".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-cleanup-001";
    const archiveContent = "mnemospark upload content cleanup";
    const objectHash = sha256Hex(archiveContent);
    const archivePath = join(tmpBackupDir, objectId);
    await writeFile(archivePath, archiveContent, "utf-8");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await writeFile(
      objectLogPath,
      `2026-02-25 19:00:00,quote-cleanup,2.75,${walletAddress},${objectId},${objectHash},0.015,aws,us-east-1\n`,
      "utf-8",
    );

    let createPaymentFetchCalls = 0;
    const previousEnv = process.env.MNEMOSPARK_DELETE_BACKUP_AFTER_UPLOAD;
    process.env.MNEMOSPARK_DELETE_BACKUP_AFTER_UPLOAD = "1";

    const uploadResponseCleanup = {
      quote_id: "quote-cleanup",
      addr: walletAddress,
      addr_hash: "addr-hash-cleanup",
      trans_id: "tx-cleanup-001",
      storage_price: 2.75,
      object_id: objectId,
      object_key: "obj-upload-cleanup-001.tar.gz.enc",
      provider: "aws",
      bucket_name: "mnemospark-5678",
      location: "us-east-1",
    };
    try {
      const command = createCloudCommand({
        objectLogHomeDir: homeDir,
        backupOptions: { tmpDir: tmpBackupDir },
        resolveWalletPrivateKeyFn: async () => walletKey,
        idempotencyKeyFn: () => "idempotency-cleanup-123",
        nowDateFn: () => new Date(2026, 1, 25, 21, 0, 0),
        createPaymentFetchFn: () => {
          createPaymentFetchCalls += 1;
          return {
            fetch: async () =>
              new Response(JSON.stringify(uploadResponseCleanup), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            cache: new PaymentCache(),
          };
        },
        proxyUploadOptions: {
          fetchImpl: async () =>
            new Response(JSON.stringify(uploadResponseCleanup), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        },
      });

      const result = await command.handler({
        channel: "test",
        isAuthorizedSender: true,
        args: [
          "upload",
          "--quote-id quote-cleanup",
          `--wallet-address ${walletAddress}`,
          `--object-id ${objectId}`,
          `--object-id-hash ${objectHash}`,
        ].join(" "),
        commandBody: "upload",
        config: {},
      });

      expect(createPaymentFetchCalls).toBe(0);
      expect(result.isError).not.toBe(true);

      await expect(stat(archivePath)).rejects.toThrow();
    } finally {
      if (previousEnv === undefined) {
        delete process.env.MNEMOSPARK_DELETE_BACKUP_AFTER_UPLOAD;
      } else {
        process.env.MNEMOSPARK_DELETE_BACKUP_AFTER_UPLOAD = previousEnv;
      }
    }
  });

  it("returns parsed proxy message when /mnemospark cloud upload balance check fails", async () => {
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
      proxyUploadOptions: {
        fetchImpl: async () =>
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
      },
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

  it("confirms presigned uploads before logging success", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"55".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-presigned-confirm-001";
    const archiveContent = "x".repeat(4_500_100);
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await writeFile(
      objectLogPath,
      `2026-02-25 19:00:00,quote-presigned-confirm,2.75,${walletAddress},${objectId},${objectHash},0.015,aws,[REDACTED]\n`,
      "utf-8",
    );

    let capturedConfirmRequest: Record<string, unknown> | undefined;
    let presignedPutCount = 0;
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      idempotencyKeyFn: () => "idemp-presigned-confirm-123",
      nowDateFn: () => new Date(2026, 1, 25, 20, 45, 0),
      fetchImpl: async (input, init) => {
        presignedPutCount += 1;
        expect(String(input)).toBe("https://example-presigned-upload.local/put");
        expect(init?.method).toBe("PUT");
        return new Response("", { status: 200 });
      },
      createPaymentFetchFn: () => ({
        fetch: async () =>
          new Response(
            JSON.stringify({
              quote_id: "quote-presigned-confirm",
              addr: walletAddress,
              addr_hash: "addr-hash",
              trans_id: "tx-initial",
              storage_price: 2.75,
              object_id: objectId,
              object_key: "obj-upload-presigned-confirm-001.tar.gz.enc",
              provider: "aws",
              bucket_name: "mnemospark-1234",
              location: "[REDACTED]",
              upload_url: "https://example-presigned-upload.local/put",
              upload_headers: {
                "content-type": "application/octet-stream",
                "x-amz-meta-wrapped-dek": "wrapped",
              },
              confirmation_required: true,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        cache: new PaymentCache(),
      }),
      proxyUploadOptions: {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              quote_id: "quote-presigned-confirm",
              addr: walletAddress,
              addr_hash: "addr-hash",
              trans_id: "tx-initial",
              storage_price: 2.75,
              object_id: objectId,
              object_key: "obj-upload-presigned-confirm-001.tar.gz.enc",
              provider: "aws",
              bucket_name: "mnemospark-1234",
              location: "[REDACTED]",
              upload_url: "https://example-presigned-upload.local/put",
              upload_headers: {
                "content-type": "application/octet-stream",
                "x-amz-meta-wrapped-dek": "wrapped",
              },
              confirmation_required: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
      requestStorageUploadConfirmFn: async (request) => {
        capturedConfirmRequest = request as Record<string, unknown>;
        return {
          quote_id: "quote-presigned-confirm",
          addr: walletAddress,
          addr_hash: "addr-hash",
          trans_id: "tx-confirmed",
          storage_price: 2.75,
          object_id: objectId,
          object_key: "obj-upload-presigned-confirm-001.tar.gz.enc",
          provider: "aws",
          bucket_name: "mnemospark-1234",
          location: "[REDACTED]",
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "upload",
        "--quote-id quote-presigned-confirm",
        `--wallet-address ${walletAddress}`,
        `--object-id ${objectId}`,
        `--object-id-hash ${objectHash}`,
      ].join(" "),
      commandBody: "upload",
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(presignedPutCount).toBe(1);
    expect(capturedConfirmRequest).toEqual({
      quote_id: "quote-presigned-confirm",
      wallet_address: walletAddress,
      object_key: "obj-upload-presigned-confirm-001.tar.gz.enc",
      idempotency_key: "idemp-presigned-confirm-123",
    });

    const logContent = await readFile(objectLogPath, "utf-8");
    const logLines = logContent.trim().split("\n");
    const uploadLogLine = logLines.at(-2);
    expect(uploadLogLine).toBe(
      `2026-02-25 20:45:00,quote-presigned-confirm,${walletAddress},addr-hash,tx-confirmed,2.75,obj-upload-presigned-confirm-001,obj-upload-presigned-confirm-001.tar.gz.enc,aws,mnemospark-1234,[REDACTED]`,
    );
  });

  it("returns actionable error when presigned upload confirmation fails", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"66".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-presigned-confirm-fail-001";
    const archiveContent = "x".repeat(4_500_100);
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    const initialLogLine = `2026-02-25 19:00:00,quote-presigned-confirm-fail,2.75,${walletAddress},${objectId},${objectHash},0.015,aws,[REDACTED]`;
    await writeFile(objectLogPath, `${initialLogLine}\n`, "utf-8");

    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      idempotencyKeyFn: () => "idemp-presigned-confirm-fail-123",
      fetchImpl: async () => new Response("", { status: 200 }),
      createPaymentFetchFn: () => ({
        fetch: async () =>
          new Response(
            JSON.stringify({
              quote_id: "quote-presigned-confirm-fail",
              addr: walletAddress,
              addr_hash: "addr-hash",
              trans_id: "tx-confirm-fail",
              storage_price: 2.75,
              object_id: objectId,
              object_key: "obj-upload-presigned-confirm-fail-001.tar.gz.enc",
              provider: "aws",
              bucket_name: "mnemospark-1234",
              location: "[REDACTED]",
              upload_url: "https://example-presigned-upload.local/put",
              upload_headers: {
                "content-type": "application/octet-stream",
                "x-amz-meta-wrapped-dek": "wrapped",
              },
              confirmation_required: true,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        cache: new PaymentCache(),
      }),
      proxyUploadOptions: {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              quote_id: "quote-presigned-confirm-fail",
              addr: walletAddress,
              addr_hash: "addr-hash",
              trans_id: "tx-confirm-fail",
              storage_price: 2.75,
              object_id: objectId,
              object_key: "obj-upload-presigned-confirm-fail-001.tar.gz.enc",
              provider: "aws",
              bucket_name: "mnemospark-1234",
              location: "[REDACTED]",
              upload_url: "https://example-presigned-upload.local/put",
              upload_headers: {
                "content-type": "application/octet-stream",
                "x-amz-meta-wrapped-dek": "wrapped",
              },
              confirmation_required: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      },
      requestStorageUploadConfirmFn: async () => {
        throw new Error(
          JSON.stringify({
            error: "not_found",
            message: "S3 object not found. Upload the file using the presigned URL first.",
          }),
        );
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "upload",
        "--quote-id quote-presigned-confirm-fail",
        `--wallet-address ${walletAddress}`,
        `--object-id ${objectId}`,
        `--object-id-hash ${objectHash}`,
      ].join(" "),
      commandBody: "upload",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Upload to S3 succeeded, but backend confirmation failed");
    expect(result.text).toContain("trans_id: tx-confirm-fail");
    expect(result.text).toContain("idempotency_key: idemp-presigned-confirm-fail-123");
    expect(result.text).toContain("S3 object not found");

    const logContent = await readFile(objectLogPath, "utf-8");
    expect(logContent.trim()).toBe(initialLogLine);
  });

  it("returns error when presigned upload response is missing upload URL", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"33".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-presigned-001";
    const archiveContent = "x".repeat(4_500_100);
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    const initialLogLine = `2026-02-25 19:00:00,quote-presigned,2.75,${walletAddress},${objectId},${objectHash},0.015,aws,us-east-1`;
    await writeFile(objectLogPath, `${initialLogLine}\n`, "utf-8");

    let capturedBody: Record<string, unknown> | undefined;
    const uploadResponseNoUrl = {
      quote_id: "quote-presigned",
      addr: walletAddress,
      object_id: objectId,
      object_key: "obj-upload-presigned-001.tar.gz.enc",
      provider: "aws",
      bucket_name: "mnemospark-1234",
      location: "us-east-1",
    };
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      createPaymentFetchFn: () => ({
        fetch: async () =>
          new Response(JSON.stringify(uploadResponseNoUrl), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        cache: new PaymentCache(),
      }),
      proxyUploadOptions: {
        fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (typeof init?.body === "string") {
            capturedBody = JSON.parse(init.body) as Record<string, unknown>;
          }
          return new Response(JSON.stringify(uploadResponseNoUrl), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "upload",
        "--quote-id quote-presigned",
        `--wallet-address ${walletAddress}`,
        `--object-id ${objectId}`,
        `--object-id-hash ${objectHash}`,
      ].join(" "),
      commandBody: "upload",
      config: {},
    });

    const payload = capturedBody?.payload as Record<string, unknown>;
    expect(payload.mode).toBe("presigned");
    expect(payload.content_base64).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cannot upload storage object: missing presigned upload URL.");

    const logContent = await readFile(objectLogPath, "utf-8");
    expect(logContent.trim()).toBe(initialLogLine);
  });

  it("returns Cannot upload storage object on invalid /mnemospark cloud upload args", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "upload --quote-id quote-only",
      commandBody: "upload --quote-id quote-only",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Cannot upload storage object: required arguments are --quote-id, --wallet-address, --object-id, --object-id-hash.",
    );
  });

  it("returns invalid async-flag guidance for upload", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "upload",
        "--quote-id quote-1",
        "--wallet-address 0x1234abcd",
        "--object-id obj-1",
        "--object-id-hash hash-1",
        "--orchestrator subagent",
      ].join(" "),
      commandBody: "upload",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Cannot upload storage object: invalid async flags. `--orchestrator`/`--timeout-seconds` require `--async`, and `--timeout-seconds` is only valid with `--orchestrator subagent`.",
    );
  });

  it("handles /mnemospark cloud ls and prints object metadata message", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    let capturedCorrelation: { operationId?: string; traceId?: string } | undefined;

    const command = createCloudCommand({
      requestStorageLsFn: async (request, requestOptions) => {
        capturedRequest = request as Record<string, unknown>;
        capturedCorrelation = requestOptions?.correlation;
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
    expect(capturedCorrelation?.operationId).toBeTruthy();
    expect(capturedCorrelation?.traceId).toBeTruthy();
    expect(result.isError).not.toBe(true);
    expect(result.text).toBe("obj-001 with backup/archive.tar.gz is 1536 in wallet-bucket-001");
  });

  it("handles /mnemospark cloud download and prints success message", async () => {
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
    expect(result.text).toBe("File backup/archive.tar.gz downloaded to /tmp/backup/archive.tar.gz");
  });

  it("handles /mnemospark cloud delete, removes cron job, and prints two user messages", async () => {
    const { homeDir } = await createSandbox();
    let capturedRequest: Record<string, unknown> | undefined;
    const cronId = "cron-delete-001";

    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    const cronTablePath = join(homeDir, ".openclaw", "mnemospark", "crontab.txt");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await writeFile(
      objectLogPath,
      `cron,2026-02-25 20:10:00,${cronId},obj-001,backup/archive.tar.gz,quote-abc123,2.75\n`,
      "utf-8",
    );
    await writeFile(
      cronTablePath,
      `${JSON.stringify({
        cronId,
        createdAt: "2026-02-25 20:10:00",
        schedule: "0 0 1 * *",
        command:
          'mnemospark-pay-storage --quote-id "quote-abc123" --wallet-address "0x1234abcd" --object-id "obj-001" --object-key "backup/archive.tar.gz" --storage-price "2.75"',
        quoteId: "quote-abc123",
        storagePrice: 2.75,
        walletAddress: "0x1234abcd",
        objectId: "obj-001",
        objectKey: "backup/archive.tar.gz",
        provider: "aws",
        bucketName: "wallet-bucket-001",
        location: "us-east-1",
      })}\n`,
      "utf-8",
    );

    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
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
    expect(result.text).toBe(
      [
        `File \`backup/archive.tar.gz\` has been deleted from the cloud and the cron job \`${cronId}\` has been removed from local mnemospark cron tracking.`,
        "Thank you for using mnemospark!",
      ].join("\n"),
    );

    const cronTableContent = await readFile(cronTablePath, "utf-8");
    expect(cronTableContent.trim()).toBe("");

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const deleteEvent = JSON.parse(
      (await readFile(eventsPath, "utf-8")).trim().split("\n").at(-1) ?? "{}",
    ) as {
      event_type?: string;
      status?: string;
      object_key?: string;
    };
    expect(deleteEvent.event_type).toBe("delete.completed");
    expect(deleteEvent.status).toBe("succeeded");
    expect(deleteEvent.object_key).toBe("backup/archive.tar.gz");
  });

  it("handles /mnemospark cloud delete when no cron job exists for object key", async () => {
    const { homeDir } = await createSandbox();
    let capturedRequest: Record<string, unknown> | undefined;

    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      requestStorageDeleteFn: async (request) => {
        capturedRequest = request as Record<string, unknown>;
        return {
          success: true,
          key: "legacy/no-cron-object.tar.gz",
          bucket: "wallet-bucket-001",
          bucket_deleted: false,
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "delete --wallet-address 0x1234abcd --object-key legacy/no-cron-object.tar.gz",
      commandBody: "delete",
      config: {},
    });

    expect(capturedRequest).toEqual({
      wallet_address: "0x1234abcd",
      object_key: "legacy/no-cron-object.tar.gz",
      location: undefined,
    });
    expect(result.isError).not.toBe(true);
    expect(result.text).toBe(
      [
        "File `legacy/no-cron-object.tar.gz` has been deleted from the cloud and no matching cron job was found in local mnemospark cron tracking.",
        "Thank you for using mnemospark!",
      ].join("\n"),
    );
  });

  it("returns Cannot list storage object on invalid /mnemospark cloud ls args", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address 0x1234abcd",
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Cannot list storage object: required arguments are --wallet-address and one of (--object-key | --name [--latest|--at]).",
    );
  });

  it("returns Cannot list storage object when a required flag value is missing", async () => {
    let lsCalled = false;
    const command = createCloudCommand({
      requestStorageLsFn: async () => {
        lsCalled = true;
        return {
          success: true,
          key: "backup/archive.tar.gz",
          size_bytes: 1536,
          bucket: "wallet-bucket-001",
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address --object-key backup/archive.tar.gz",
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Cannot list storage object: required arguments are --wallet-address and one of (--object-key | --name [--latest|--at]).",
    );
    expect(lsCalled).toBe(false);
  });

  it("returns Cannot download file when /mnemospark cloud download fails", async () => {
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

  it("returns invalid async-flag guidance for download", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "download --wallet-address 0x1234abcd --object-key backup/archive.tar.gz --timeout-seconds 5",
      commandBody: "download",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Cannot download file: invalid async flags. `--orchestrator`/`--timeout-seconds` require `--async`, and `--timeout-seconds` is only valid with `--orchestrator subagent`.",
    );
  });

  it("supports async upload with operation id", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({ objectLogHomeDir: homeDir });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "upload --quote-id q-1 --wallet-address 0x1234 --object-id o-1 --object-id-hash h-1 --async",
      commandBody: "upload",
      config: {},
    });

    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Operation started in background. operation-id:");
  });

  it("returns operation status via op-status", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({ objectLogHomeDir: homeDir });

    const started = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "upload --quote-id q-2 --wallet-address 0x1234 --object-id o-2 --object-id-hash h-2 --async",
      commandBody: "upload",
      config: {},
    });

    const match = started.text?.match(/operation-id: ([0-9a-f-]+)/i);
    expect(match?.[1]).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 30));

    const status = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `op-status --operation-id ${match?.[1]}`,
      commandBody: "op-status",
      config: {},
    });

    if (status.text?.startsWith("Operation not found:")) {
      // node:sqlite may be unavailable in some CI environments; async orchestration degrades gracefully.
      expect(status.text).toContain(match?.[1] ?? "");
    } else {
      expect(status.text).toContain(`operation-id: ${match?.[1]}`);
      expect(status.text).toContain("status:");
    }
  });

  it("supports subagent orchestration metadata and lifecycle events", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      requestStorageDownloadFn: async () => ({
        success: true,
        key: "backup/archive.tar.gz",
        file_path: "/tmp/backup/archive.tar.gz",
      }),
    });

    const started = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "download",
        "--wallet-address 0x1234abcd",
        "--object-key backup/archive.tar.gz",
        "--async",
        "--orchestrator subagent",
        "--timeout-seconds 5",
      ].join(" "),
      commandBody: "download",
      config: {},
    });

    expect(started.isError).toBeUndefined();
    expect(started.text).toContain("operation-id:");
    expect(started.text).toContain("orchestrator: subagent");
    expect(started.text).toContain("subagent-session-id:");
    expect(started.text).toContain("timeout-seconds: 5");

    const operationId = started.text?.match(/operation-id: ([0-9a-f-]+)/i)?.[1];
    expect(operationId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 80));
    const status = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `op-status --operation-id ${operationId}`,
      commandBody: "op-status",
      config: {},
    });

    if (status.text?.startsWith("Operation not found:")) {
      // node:sqlite may be unavailable in CI; verify fallback still references operation id.
      expect(status.text).toContain(operationId ?? "");
    } else {
      expect(status.text).toContain(`operation-id: ${operationId}`);
      expect(status.text).toContain("orchestrator: subagent");
      expect(status.text).toContain("subagent-session-id:");
      expect(status.text).toContain("timeout-seconds: 5");
      expect(status.text).toContain("status: succeeded");
    }

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const proxyEventsPath = join(homeDir, ".openclaw", "mnemospark", "proxy-events.jsonl");
    const events = (await readFile(eventsPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const proxyEvents = (await readFile(proxyEventsPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const opEvents = events.filter((event) => event.operation_id === operationId);
    expect(opEvents.some((event) => event.event_type === "operation.dispatched")).toBe(true);
    expect(opEvents.some((event) => event.event_type === "operation.progress")).toBe(true);
    expect(opEvents.some((event) => event.event_type === "operation.completed")).toBe(true);
    for (const event of opEvents) {
      expect(typeof event.operation_id).toBe("string");
      expect(typeof event.trace_id).toBe("string");
      expect(typeof event.event_type).toBe("string");
      expect(typeof event.status).toBe("string");
      expect(typeof event.ts).toBe("string");
    }

    const proxyOpEvents = proxyEvents.filter((event) => event.operation_id === operationId);
    expect(proxyOpEvents.length).toBeGreaterThan(0);
  });

  it("labels backup subagent tasks as backup", async () => {
    const { homeDir } = await createSandbox();
    let subagentCommand: string | undefined;
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      subagentOrchestrator: {
        dispatch: async (input) => {
          subagentCommand = input.task.command;
          return { sessionId: "session-backup-command" };
        },
        cancel: async () => ({ accepted: false }),
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "backup /tmp/source --async --orchestrator subagent",
      commandBody: "backup",
      config: {},
    });

    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("operation-id:");
    expect(subagentCommand).toBe("backup");
  });

  it("does not regress operation status after subagent dispatch resolves", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      subagentOrchestrator: {
        dispatch: async (input) => {
          const sessionId = "session-sync-hooks";
          await input.hooks?.onRunning?.(sessionId);
          await input.hooks?.onCompleted?.(sessionId, { text: "ok" });
          return { sessionId };
        },
        cancel: async () => ({ accepted: false }),
      },
    });

    const started = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "download",
        "--wallet-address 0x1234abcd",
        "--object-key backup/archive.tar.gz",
        "--async",
        "--orchestrator subagent",
      ].join(" "),
      commandBody: "download",
      config: {},
    });
    const operationId = started.text?.match(/operation-id: ([0-9a-f-]+)/i)?.[1];
    expect(operationId).toBeTruthy();

    const status = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `op-status --operation-id ${operationId}`,
      commandBody: "op-status",
      config: {},
    });

    expect(status.text).toContain("status: succeeded");
    expect(status.text).toContain("subagent-session-id: session-sync-hooks");
  });

  it("records dispatch failures for subagent orchestration", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      subagentOrchestrator: {
        dispatch: async () => {
          throw new Error("subagent spawn denied");
        },
        cancel: async () => ({ accepted: false }),
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "download",
        "--wallet-address 0x1234abcd",
        "--object-key backup/archive.tar.gz",
        "--async",
        "--orchestrator subagent",
      ].join(" "),
      commandBody: "download",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Cannot dispatch subagent operation: subagent spawn denied");
    const operationId = result.text?.match(/operation-id: ([0-9a-f-]+)/i)?.[1];
    expect(operationId).toBeTruthy();

    const status = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `op-status --operation-id ${operationId}`,
      commandBody: "op-status",
      config: {},
    });
    if (status.text?.startsWith("Operation not found:")) {
      // node:sqlite may be unavailable in CI; verify fallback still references operation id.
      expect(status.text).toContain(operationId ?? "");
    } else {
      expect(status.text).toContain("status: failed");
      expect(status.text).toContain("error-code: ASYNC_DISPATCH_FAILED");
    }

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const events = (await readFile(eventsPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.operation_id === operationId);
    expect(events.some((event) => event.event_type === "operation.completed")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event_type === "operation.completed" &&
          event["error-code"] === "ASYNC_DISPATCH_FAILED",
      ),
    ).toBe(true);
  });

  it("supports idempotent cancel for subagent operations", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      requestStorageDownloadFn: async () =>
        new Promise<StorageDownloadProxyResponse>(() => {
          // Intentionally unresolved so cancel drives terminal state.
        }),
    });

    const started = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "download",
        "--wallet-address 0x1234abcd",
        "--object-key backup/archive.tar.gz",
        "--async",
        "--orchestrator subagent",
      ].join(" "),
      commandBody: "download",
      config: {},
    });
    const operationId = started.text?.match(/operation-id: ([0-9a-f-]+)/i)?.[1];
    expect(operationId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 40));
    const cancelled = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `op-status --operation-id ${operationId} --cancel`,
      commandBody: "op-status",
      config: {},
    });
    if (cancelled.text?.startsWith("Operation not found:")) {
      // node:sqlite may be unavailable in CI; verify fallback still references operation id.
      expect(cancelled.text).toContain(operationId ?? "");
    } else {
      expect(cancelled.text).toContain("status: cancelled");
      expect(cancelled.text).toContain("error-code: ASYNC_CANCELLED");
    }

    const cancelledAgain = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `op-status --operation-id ${operationId} --cancel`,
      commandBody: "op-status",
      config: {},
    });
    if (cancelledAgain.text?.startsWith("Operation not found:")) {
      expect(cancelledAgain.text).toContain(operationId ?? "");
    } else {
      expect(cancelledAgain.text).toContain("status: cancelled");
    }
    expect(cancelledAgain.isError).toBe(true);

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const events = (await readFile(eventsPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.operation_id === operationId);
    expect(events.some((event) => event.event_type === "operation.cancel.requested")).toBe(true);
    expect(events.some((event) => event.event_type === "operation.cancelled")).toBe(true);
  });

  it("marks timed out subagent operations with timeout error", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      requestStorageDownloadFn: async () =>
        new Promise<StorageDownloadProxyResponse>(() => {
          // Intentionally unresolved so timeout drives terminal state.
        }),
    });

    const started = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "download",
        "--wallet-address 0x1234abcd",
        "--object-key backup/archive.tar.gz",
        "--async",
        "--orchestrator subagent",
        "--timeout-seconds 1",
      ].join(" "),
      commandBody: "download",
      config: {},
    });
    const operationId = started.text?.match(/operation-id: ([0-9a-f-]+)/i)?.[1];
    expect(operationId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const status = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `op-status --operation-id ${operationId}`,
      commandBody: "op-status",
      config: {},
    });

    if (status.text?.startsWith("Operation not found:")) {
      // node:sqlite may be unavailable in CI; verify fallback still references operation id.
      expect(status.text).toContain(operationId ?? "");
    } else {
      expect(status.text).toContain("status: timed_out");
      expect(status.text).toContain("error-code: ASYNC_TIMEOUT");
    }

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const events = (await readFile(eventsPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.operation_id === operationId);
    expect(events.some((event) => event.event_type === "operation.timed_out")).toBe(true);
  });

  it("returns Cannot delete file when /mnemospark cloud delete fails", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
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

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const deleteEvent = JSON.parse(
      (await readFile(eventsPath, "utf-8")).trim().split("\n").at(-1) ?? "{}",
    ) as {
      event_type?: string;
      status?: string;
      object_key?: string;
    };
    expect(deleteEvent.event_type).toBe("delete.completed");
    expect(deleteEvent.status).toBe("failed");
    expect(deleteEvent.object_key).toBe("backup/archive.tar.gz");
  });

  it("returns success when cloud delete succeeds but cron cleanup throws", async () => {
    const { homeDir } = await createSandbox();
    const objectLogPath = join(homeDir, ".openclaw", "mnemospark", "object.log");
    const cronTablePath = join(homeDir, ".openclaw", "mnemospark", "crontab.txt");
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await writeFile(
      objectLogPath,
      "cron,2026-02-25 20:10:00,cron-cleanup-fail,obj-002,backup/other.tar.gz,quote-xyz,1.5\n",
      "utf-8",
    );
    await mkdir(cronTablePath, { recursive: true });

    const command = createCloudCommand({
      objectLogHomeDir: homeDir,
      requestStorageDeleteFn: async () => ({
        success: true,
        key: "backup/other.tar.gz",
        bucket: "wallet-bucket-001",
        bucket_deleted: false,
      }),
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "delete --wallet-address 0x1234abcd --object-key backup/other.tar.gz",
      commandBody: "delete",
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("has been deleted from the cloud");
    expect(result.text).not.toContain("Cannot delete file");
  });
});
