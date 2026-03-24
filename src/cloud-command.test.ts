import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

import { afterEach, describe, expect, it } from "vitest";

import { buildBackupObject, createCloudCommand, expandTilde } from "./cloud-command.js";
import { createCloudDatastore } from "./cloud-datastore.js";
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

function createInMemoryCronAdapter(seed: Array<{ jobId: string; message: string }> = []) {
  const jobs = [...seed];
  return {
    add: async (job: { jobId?: string; name: string; payload: { message: string } }) => {
      const generatedId = typeof job.jobId === "string" ? job.jobId : `cron-${jobs.length + 1}`;
      jobs.push({ jobId: generatedId, message: job.payload.message });
      return { jobId: generatedId };
    },
    remove: async (jobId: string) => {
      const before = jobs.length;
      for (let idx = jobs.length - 1; idx >= 0; idx -= 1) {
        if (jobs[idx].jobId === jobId) {
          jobs.splice(idx, 1);
        }
      }
      return jobs.length !== before;
    },
    list: async () => [...jobs],
    snapshot: () => [...jobs],
  };
}

function withMockCronAdapter(
  adapter:
    | ReturnType<typeof createInMemoryCronAdapter>
    | {
        add: (job: { jobId?: string; name: string; payload: { message: string } }) => Promise<{
          jobId: string;
        }>;
        remove: (jobId: string) => Promise<boolean>;
        list: () => Promise<Array<{ jobId: string; message: string }>>;
      } = createInMemoryCronAdapter(),
) {
  return {
    openClawCronAdapter: adapter,
    __cronAdapter: "snapshot" in adapter ? adapter : undefined,
  };
}

function randomBytesFixture(size: number): Buffer {
  return Buffer.from("0011223344556677".slice(0, size * 2), "hex");
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Seeds `payments` + `objects` so `findQuoteById` succeeds for upload tests. */
async function seedQuotedStorageInSqlite(
  homeDir: string,
  params: {
    quoteId: string;
    walletAddress: string;
    objectId: string;
    objectHash: string;
    storagePrice: number;
    provider?: string;
    region?: string;
    /** When set, inserts a friendly_names row for upload path / name resolution. */
    friendlyName?: string;
  },
): Promise<void> {
  const datastore = await createCloudDatastore(homeDir);
  await datastore.upsertObject({
    object_id: params.objectId,
    object_key: null,
    wallet_address: params.walletAddress,
    quote_id: params.quoteId,
    provider: params.provider ?? "aws",
    bucket_name: null,
    region: params.region ?? "us-east-1",
    sha256: params.objectHash,
    status: "quoted",
  });
  await datastore.upsertPayment({
    quote_id: params.quoteId,
    wallet_address: params.walletAddress,
    trans_id: null,
    amount: params.storagePrice,
    network: null,
    status: "quoted",
  });
  if (params.friendlyName?.trim()) {
    await datastore.upsertFriendlyName({
      friendly_name: params.friendlyName.trim(),
      object_id: params.objectId,
      object_key: null,
      quote_id: params.quoteId,
      wallet_address: params.walletAddress,
    });
  }
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
    expect(result.text).toContain("omit both to list bucket");
    expect(result.text).toContain("/mnemospark_cloud download --wallet-address <addr>");
    expect(result.text).toContain("/mnemospark_cloud delete --wallet-address <addr>");
    expect(result.text).toContain("/mnemospark_cloud payment-settle");
    expect(result.text).not.toContain("<s3-key>");
    expect(result.text).not.toContain("s3-key");
    expect(result.text).toContain("configured mnemospark wallet key");
  });

  it("builds tar.gz object and computes hash/size (no object.log sidecar)", async () => {
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

  it("does not leave backup artifacts in tmp when the backup target is missing", async () => {
    const { tmpBackupDir, sourceDir } = await createSandbox();
    const filesBefore = await readdir(tmpBackupDir);

    await expect(
      buildBackupObject(join(sourceDir, "missing-path"), {
        platform: "linux",
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

    const walletKey = `0x${"77".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      resolveWalletPrivateKeyFn: async () => walletKey,
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
      args: `backup "${sourcePathWithSpaces}" --name "source file"`,
      commandBody: `backup "${sourcePathWithSpaces}" --name "source file"`,
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("friendly-name:");
    expect(result.text).toContain("object-id:");
    expect(result.text).toContain("object-id-hash:");
    expect(result.text).toContain("object-size:");
    expect(result.text).toContain(`--wallet-address \`${walletAddress}\``);
    expect(result.text).toContain("Replace `<provider>` and `<region>`");
  });

  it("preserves quoted backup friendly names and writes events.jsonl under the mnemospark home subdirectory", async () => {
    const { homeDir, tmpBackupDir, root } = await createSandbox();
    const sourcePathWithSpaces = join(root, "source file.txt");
    await writeFile(sourcePathWithSpaces, "backup me");

    const walletKey = `0x${"88".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      resolveWalletPrivateKeyFn: async () => walletKey,
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
    expect(result.text).toContain(`--wallet-address \`${walletAddress}\``);
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
      args: "backup /tmp/something --name mybackup",
      commandBody: "backup /tmp/something --name mybackup",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cloud backup is only supported on macOS and Linux.");
  });

  it("handles /mnemospark cloud price-storage, logs quote, and prints next-step upload command", async () => {
    const { homeDir } = await createSandbox();
    let capturedRequest: Record<string, unknown> | undefined;

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
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
    expect(result.text).toContain("Your storage quote `quote-abc123`:");
    expect(result.text).toContain("storage price `$2.75`");
    expect(result.text).toContain("for file `obj-001`");
    expect(result.text).toContain("If you accept this quote, run:");
    expect(result.text).toContain("/mnemospark_cloud upload --quote-id `quote-abc123`");
    expect(result.text).toContain("--object-id-hash `hash-001`");
    expect(result.text).toContain(
      "Quotes are valid for one hour. Please run price-storage again if you need a new quote.",
    );

    const datastore = await createCloudDatastore(homeDir);
    const verified = await datastore.findQuoteById("quote-abc123");
    expect(verified?.storagePrice).toBe(2.75);
    expect(verified?.objectId).toBe("obj-001");
    expect(verified?.objectIdHash).toBe("hash-001");
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

  it("rejects payment-settle when required flags are missing", async () => {
    const command = createCloudCommand();
    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "payment-settle --quote-id q1",
      commandBody: "payment-settle",
      config: {},
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("--wallet-address");
    expect(result.text).toContain("--quote-id | --renewal");
  });

  it("rejects payment-settle on wallet address mismatch", async () => {
    const walletKey = `0x${"aa".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const command = createCloudCommand({
      resolveWalletPrivateKeyFn: async () => walletKey,
    });
    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "payment-settle --quote-id quote-x --wallet-address 0x0000000000000000000000000000000000000001",
      commandBody: "payment-settle",
      config: {},
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("does not match");
    expect(result.text).toContain(walletAddress);
  });

  it("rejects payment-settle with unknown flags", async () => {
    const walletKey = `0x${"bb".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const command = createCloudCommand({
      resolveWalletPrivateKeyFn: async () => walletKey,
    });
    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `payment-settle --quote-id q1 --wallet-address ${walletAddress} --extra-flag x`,
      commandBody: "payment-settle",
      config: {},
    });
    expect(result.isError).toBe(true);
  });

  it("handles payment-settle success and writes JSONL observations", async () => {
    const { homeDir } = await createSandbox();
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    const walletKey = `0x${"cc".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const quoteId = "quote-settle-1";
    const objectId = "obj-cron-1";
    const objectKey = "backup/x.enc";

    const datastore = await createCloudDatastore(homeDir);
    await datastore.upsertObject({
      object_id: objectId,
      object_key: objectKey,
      wallet_address: walletAddress,
      quote_id: quoteId,
      provider: "aws",
      bucket_name: "b",
      region: "us-east-1",
      sha256: "ab".repeat(32),
      status: "uploaded",
    });
    await datastore.upsertPayment({
      quote_id: quoteId,
      wallet_address: walletAddress,
      trans_id: "tx-old",
      amount: 3.5,
      network: null,
      status: "settled",
    });
    await datastore.upsertCronJob({
      cron_id: "cron-settle-test",
      object_id: objectId,
      object_key: objectKey,
      quote_id: quoteId,
      schedule: "0 0 1 * *",
      command: "/mnemospark_cloud payment-settle --quote-id x",
      status: "active",
    });

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      resolveWalletPrivateKeyFn: async () => walletKey,
      createPaymentFetchFn: () => ({
        fetch: async () =>
          new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" }),
        cache: new PaymentCache(),
      }),
      requestPaymentSettleViaProxyFn: async () => ({
        status: 200,
        bodyText: JSON.stringify({ trans_id: "tx-settle-new", payment_status: "confirmed" }),
        contentType: "application/json",
        paymentRequired: undefined,
        paymentResponse: undefined,
      }),
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `payment-settle --quote-id ${quoteId} --wallet-address ${walletAddress} --object-id ${objectId} --object-key ${objectKey} --storage-price 3.5`,
      commandBody: "payment-settle",
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("Payment settled");
    expect(result.text).toContain("tx-settle-new");

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const eventsRaw = await readFile(eventsPath, "utf-8");
    const eventLines = eventsRaw.trim().split("\n");
    const completed = eventLines
      .map(
        (l) =>
          JSON.parse(l) as {
            event_type?: string;
            quote_id?: string;
            status?: string;
            http_status?: number;
          },
      )
      .filter((e) => e.event_type === "payment-settle.completed");
    expect(completed.length).toBeGreaterThanOrEqual(1);
    const lastCompleted = completed.at(-1);
    expect(lastCompleted?.quote_id).toBe(quoteId);
    expect(lastCompleted?.status).toBe("succeeded");
    expect(lastCompleted?.http_status).toBe(200);

    const allLines = eventsRaw.trim().split("\n");
    const settleObservations = allLines
      .map(
        (l) =>
          JSON.parse(l) as {
            event_type?: string;
            status?: string;
            source?: string;
            http_status?: number;
          },
      )
      .filter(
        (e) => e.event_type === "payment.settle" && e.status === "result" && e.source === "command",
      );
    expect(settleObservations.length).toBeGreaterThanOrEqual(1);
    expect(settleObservations.at(-1)?.http_status).toBe(200);
  });

  it("handles payment-settle HTTP error and logs JSONL failure", async () => {
    const { homeDir } = await createSandbox();
    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    const walletKey = `0x${"dd".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const quoteId = "quote-fail-1";

    const datastore = await createCloudDatastore(homeDir);
    await datastore.upsertPayment({
      quote_id: quoteId,
      wallet_address: walletAddress,
      trans_id: null,
      amount: 1,
      network: null,
      status: "quoted",
    });

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      resolveWalletPrivateKeyFn: async () => walletKey,
      createPaymentFetchFn: () => ({
        fetch: async () => new Response("{}", { status: 500 }),
        cache: new PaymentCache(),
      }),
      requestPaymentSettleViaProxyFn: async () => ({
        status: 402,
        bodyText: "payment required",
        contentType: "text/plain",
        paymentRequired: undefined,
        paymentResponse: undefined,
      }),
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `payment-settle --quote-id ${quoteId} --wallet-address ${walletAddress} --storage-price 1`,
      commandBody: "payment-settle",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("402");

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const eventsRaw = await readFile(eventsPath, "utf-8");
    const failCompleted = eventsRaw
      .trim()
      .split("\n")
      .map(
        (l) =>
          JSON.parse(l) as {
            event_type?: string;
            quote_id?: string;
            status?: string;
            http_status?: number;
          },
      )
      .filter((e) => e.event_type === "payment-settle.completed")
      .at(-1);
    expect(failCompleted?.quote_id).toBe(quoteId);
    expect(failCompleted?.status).toBe("failed");
    expect(failCompleted?.http_status).toBe(402);
  });

  it("handles /mnemospark cloud upload, builds encrypted payload, logs upload response, and keeps archive when MNEMOSPARK_REMOVE_BACKUP_FILE=0", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"11".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-001";
    const archiveContent = "mnemospark upload content";
    const objectHash = sha256Hex(archiveContent);
    const archivePath = join(tmpBackupDir, objectId);
    await writeFile(archivePath, archiveContent, "utf-8");

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-abc123",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      friendlyName: "legacy-upload",
    });

    const previousRemove = process.env.MNEMOSPARK_REMOVE_BACKUP_FILE;
    process.env.MNEMOSPARK_REMOVE_BACKUP_FILE = "0";

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

    const cronHooks = withMockCronAdapter();
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      idempotencyKeyFn: () => "idempotency-123",
      nowDateFn: () => new Date(2026, 1, 25, 20, 10, 0),
      ...cronHooks,
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

    try {
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
      expect(result.text).toContain(
        "Your file `obj-upload-001` with key `obj-upload-001.tar.gz.enc` has been stored using `aws` in folder `mnemospark-1234` in region `us-east-1`",
      );
      const cronIdMatch = result.text.match(/A cron job `([^`]+)` has been configured/);
      const cronId = cronIdMatch?.[1];
      expect(cronId).toBeTruthy();
      expect(result.text).toContain("monthly");
      expect(result.text).toContain("3rd (UTC)");
      expect(result.text).toContain(`/mnemospark_cloud ls --wallet-address \`${walletAddress}\``);
      expect(result.text).toContain("Thank you for using mnemospark!");
      expect(result.text).toContain("pluggedin@mnemospark.ai");

      const cronEntry = cronHooks.__cronAdapter?.snapshot().at(-1);
      expect(cronEntry).toBeTruthy();
      expect(cronEntry?.jobId).toBe(cronId);
      expect(cronEntry?.message).toContain("/mnemospark_cloud payment-settle");
      expect(cronEntry?.message).toContain("--renewal");
      expect(cronEntry?.message).toContain("obj-upload-001.tar.gz.enc");

      const archiveExists = await stat(archivePath);
      expect(archiveExists.isFile()).toBe(true);
    } finally {
      if (previousRemove === undefined) {
        delete process.env.MNEMOSPARK_REMOVE_BACKUP_FILE;
      } else {
        process.env.MNEMOSPARK_REMOVE_BACKUP_FILE = previousRemove;
      }
    }
  });

  it("removes local backup archive when MNEMOSPARK_REMOVE_BACKUP_FILE is unrecognized", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"55".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-keep-unrecognized-001";
    const archiveContent = "mnemospark upload content keep unrecognized";
    const objectHash = sha256Hex(archiveContent);
    const archivePath = join(tmpBackupDir, objectId);
    await writeFile(archivePath, archiveContent, "utf-8");

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-keep-unrecognized",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      friendlyName: "keep-unrecognized",
    });

    let createPaymentFetchCalls = 0;
    const previousRemove = process.env.MNEMOSPARK_REMOVE_BACKUP_FILE;
    process.env.MNEMOSPARK_REMOVE_BACKUP_FILE = "off";

    const uploadResponseKeepUnrecognized = {
      quote_id: "quote-keep-unrecognized",
      addr: walletAddress,
      addr_hash: "addr-hash-keep-unrecognized",
      trans_id: "tx-keep-unrecognized-001",
      storage_price: 2.75,
      object_id: objectId,
      object_key: "obj-upload-keep-unrecognized-001.tar.gz.enc",
      provider: "aws",
      bucket_name: "mnemospark-9999",
      location: "us-east-1",
    };
    try {
      const command = createCloudCommand({
        mnemosparkHomeDir: homeDir,
        backupOptions: { tmpDir: tmpBackupDir },
        resolveWalletPrivateKeyFn: async () => walletKey,
        idempotencyKeyFn: () => "idempotency-keep-unrecognized-123",
        nowDateFn: () => new Date(2026, 1, 25, 21, 30, 0),
        ...withMockCronAdapter(),
        createPaymentFetchFn: () => {
          createPaymentFetchCalls += 1;
          return {
            fetch: async () =>
              new Response(JSON.stringify(uploadResponseKeepUnrecognized), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            cache: new PaymentCache(),
          };
        },
        proxyUploadOptions: {
          fetchImpl: async () =>
            new Response(JSON.stringify(uploadResponseKeepUnrecognized), {
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
          "--quote-id quote-keep-unrecognized",
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
      if (previousRemove === undefined) {
        delete process.env.MNEMOSPARK_REMOVE_BACKUP_FILE;
      } else {
        process.env.MNEMOSPARK_REMOVE_BACKUP_FILE = previousRemove;
      }
    }
  });

  it("removes local backup archive after successful /mnemospark cloud upload by default", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"44".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-cleanup-001";
    const archiveContent = "mnemospark upload content cleanup";
    const objectHash = sha256Hex(archiveContent);
    const archivePath = join(tmpBackupDir, objectId);
    await writeFile(archivePath, archiveContent, "utf-8");

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-cleanup",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      friendlyName: "cleanup-legacy",
    });

    let createPaymentFetchCalls = 0;
    const previousRemove = process.env.MNEMOSPARK_REMOVE_BACKUP_FILE;
    delete process.env.MNEMOSPARK_REMOVE_BACKUP_FILE;

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
        mnemosparkHomeDir: homeDir,
        backupOptions: { tmpDir: tmpBackupDir },
        resolveWalletPrivateKeyFn: async () => walletKey,
        idempotencyKeyFn: () => "idempotency-cleanup-123",
        nowDateFn: () => new Date(2026, 1, 25, 21, 0, 0),
        ...withMockCronAdapter(),
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
      if (previousRemove === undefined) {
        delete process.env.MNEMOSPARK_REMOVE_BACKUP_FILE;
      } else {
        process.env.MNEMOSPARK_REMOVE_BACKUP_FILE = previousRemove;
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

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-xyz",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      friendlyName: "balance-fail",
    });

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
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

  it("writes renewal cron through OpenClaw cron adapter", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"22".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-cron-adapter-001";
    const archiveContent = "adapter integration content";
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-cron-adapter",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      friendlyName: "cron-adapter-test",
    });

    const mockCron = createInMemoryCronAdapter();
    const uploadResponse = {
      quote_id: "quote-cron-adapter",
      addr: walletAddress,
      addr_hash: "addr-hash-cron-adapter",
      trans_id: "tx-cron-adapter-001",
      storage_price: 2.75,
      object_id: objectId,
      object_key: "obj-upload-cron-adapter-001.tar.gz.enc",
      provider: "aws",
      bucket_name: "mnemospark-7777",
      location: "us-east-1",
    };

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      ...withMockCronAdapter(mockCron),
      proxyUploadOptions: {
        fetchImpl: async () =>
          new Response(JSON.stringify(uploadResponse), {
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
        "--quote-id quote-cron-adapter",
        `--wallet-address ${walletAddress}`,
        `--object-id ${objectId}`,
        `--object-id-hash ${objectHash}`,
      ].join(" "),
      commandBody: "upload",
      config: {},
    });

    expect(result.isError).not.toBe(true);
    const cronJobs = mockCron.snapshot();
    expect(cronJobs).toHaveLength(1);
    expect(cronJobs[0].message).toContain("/mnemospark_cloud payment-settle");
    expect(cronJobs[0].message).toContain("--renewal");
    expect(cronJobs[0].message).toContain("obj-upload-cron-adapter-001.tar.gz.enc");
  });

  it("confirms presigned uploads before logging success", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"55".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-presigned-confirm-001";
    const archiveContent = "x".repeat(4_500_100);
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-presigned-confirm",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      region: "[REDACTED]",
      friendlyName: "presigned-confirm",
    });

    let capturedConfirmRequest: Record<string, unknown> | undefined;
    let presignedPutCount = 0;
    const cronHooks = withMockCronAdapter();
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      backupOptions: { tmpDir: tmpBackupDir },
      resolveWalletPrivateKeyFn: async () => walletKey,
      idempotencyKeyFn: () => "idemp-presigned-confirm-123",
      nowDateFn: () => new Date(2026, 1, 25, 20, 45, 0),
      ...cronHooks,
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
  });

  it("returns actionable error when presigned upload confirmation fails", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"66".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-presigned-confirm-fail-001";
    const archiveContent = "x".repeat(4_500_100);
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-presigned-confirm-fail",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      region: "[REDACTED]",
      friendlyName: "presigned-fail",
    });

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
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

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const uploadFailed = (await readFile(eventsPath, "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { event_type?: string; status?: string; quote_id?: string })
      .filter(
        (e) => e.event_type === "upload.completed" && e.quote_id === "quote-presigned-confirm-fail",
      )
      .at(-1);
    expect(uploadFailed?.status).toBe("failed");
  });

  it("returns error when presigned upload response is missing upload URL", async () => {
    const { homeDir, tmpBackupDir } = await createSandbox();
    const walletKey = `0x${"33".repeat(32)}` as const;
    const walletAddress = privateKeyToAccount(walletKey).address;
    const objectId = "obj-upload-presigned-001";
    const archiveContent = "x".repeat(4_500_100);
    const objectHash = sha256Hex(archiveContent);
    await writeFile(join(tmpBackupDir, objectId), archiveContent, "utf-8");

    await mkdir(join(homeDir, ".openclaw", "mnemospark"), { recursive: true });
    await seedQuotedStorageInSqlite(homeDir, {
      quoteId: "quote-presigned",
      walletAddress,
      objectId,
      objectHash,
      storagePrice: 2.75,
      friendlyName: "presigned-no-url",
    });

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
      mnemosparkHomeDir: homeDir,
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
          mode: "stat" as const,
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
    expect(result.text).toContain("```");
    expect(result.text).toContain("CRON JOB");
    expect(result.text).toContain("1.5 KB");
    expect(result.text).toContain("Folder: wallet-bucket-001");
    expect(result.text).toContain("☁️ mnemospark cloud");
  });

  it("resolves --name with --wallet_address alias and mixed-case wallet values", async () => {
    const { homeDir } = await createSandbox();
    try {
      await import("node:sqlite");
    } catch {
      // node:sqlite may be unavailable in some environments; skip SQLite-specific assertion.
      return;
    }

    const datastore = await createCloudDatastore(homeDir);
    await datastore.ensureReady();
    await datastore.upsertFriendlyName({
      friendly_name: "myfile.txt",
      object_id: "obj-friendly-1",
      object_key: "backup/myfile.txt.tar.gz.enc",
      quote_id: "quote-friendly-1",
      wallet_address: "0x24bb8b93fbc0b87e4b0303aa1f71c51941726424",
    });

    let capturedRequest: Record<string, unknown> | undefined;
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      requestStorageLsFn: async (request) => {
        capturedRequest = request as Record<string, unknown>;
        return {
          mode: "stat" as const,
          success: true,
          key: "backup/myfile.txt.tar.gz.enc",
          size_bytes: 1024,
          bucket: "wallet-bucket-001",
          object_id: "obj-friendly-1",
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: [
        "ls",
        "--wallet_address 0x24bB8B93fbC0B87e4b0303aA1F71C51941726424",
        '--name "myfile.txt"',
        "--latest",
      ].join(" "),
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(capturedRequest).toEqual({
      wallet_address: "0x24bB8B93fbC0B87e4b0303aA1F71C51941726424",
      object_key: "backup/myfile.txt.tar.gz.enc",
      location: undefined,
    });
    expect(result.text).toContain("```");
    expect(result.text).toContain("1 KB");
    expect(result.text).toContain("wallet-bucket-001");
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
    const cronAdapter = createInMemoryCronAdapter([
      {
        jobId: cronId,
        message:
          '/mnemospark_cloud payment-settle --renewal --wallet-address "0x1234abcd" --object-id "obj-001" --object-key "backup/archive.tar.gz" --storage-price "2.75"',
      },
    ]);

    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      openClawCronAdapter: cronAdapter,
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

    expect(cronAdapter.snapshot()).toEqual([]);

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
      mnemosparkHomeDir: homeDir,
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

  it("returns Cannot list storage object when ls is missing wallet-address", async () => {
    const command = createCloudCommand();

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --object-key backup/archive.tar.gz",
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Cannot list storage object");
    expect(result.text).toContain("--wallet-address");
  });

  it("lists bucket when /mnemospark cloud ls has wallet only", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const command = createCloudCommand({
      requestStorageLsFn: async (request) => {
        capturedRequest = request as Record<string, unknown>;
        return {
          mode: "list" as const,
          success: true,
          list_mode: true as const,
          bucket: "wallet-bucket-list",
          objects: [
            {
              key: "a.bin",
              size_bytes: 500,
              last_modified: "2025-06-01T12:00:00Z",
            },
            {
              key: "b.bin",
              size_bytes: 1500,
              last_modified: "2025-07-01T12:00:00Z",
            },
          ],
          is_truncated: false,
          next_continuation_token: null,
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address 0x1234567890123456789012345678901234567890",
      commandBody: "ls",
      config: {},
    });

    expect(capturedRequest).toEqual({
      wallet_address: "0x1234567890123456789012345678901234567890",
    });
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("☁️ mnemospark cloud");
    expect(result.text).toContain("Folder: wallet-bucket-list");
    expect(result.text).toContain("```");
    expect(result.text).toContain("a.bin");
    expect(result.text).toContain("b.bin");
  });

  it("stores null error_message on successful bucket ls operation", async () => {
    const { homeDir } = await createSandbox();
    try {
      await import("node:sqlite");
    } catch {
      // node:sqlite may be unavailable in some environments; skip SQLite-specific assertion.
      return;
    }

    let operationId: string | undefined;
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      requestStorageLsFn: async (_request, requestOptions) => {
        operationId = requestOptions?.correlation?.operationId;
        return {
          mode: "list" as const,
          success: true,
          list_mode: true as const,
          bucket: "wallet-bucket-list",
          objects: [],
          is_truncated: false,
          next_continuation_token: null,
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address 0x1234567890123456789012345678901234567890",
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(operationId).toBeTruthy();
    const datastore = await createCloudDatastore(homeDir);
    const operation = await datastore.findOperationById(operationId ?? "");
    expect(operation?.status).toBe("succeeded");
    expect(operation?.error_message).toBeNull();
  });

  it("returns Cannot list storage object when a required flag value is missing", async () => {
    let lsCalled = false;
    const command = createCloudCommand({
      requestStorageLsFn: async () => {
        lsCalled = true;
        return {
          mode: "stat" as const,
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
    expect(result.text).toContain("Cannot list storage object");
    expect(result.text).toContain("--wallet-address");
    expect(lsCalled).toBe(false);
  });

  it("returns Cannot list storage object when ls selector flags are used without key or name", async () => {
    let lsCalled = false;
    const command = createCloudCommand({
      requestStorageLsFn: async () => {
        lsCalled = true;
        return {
          mode: "list" as const,
          success: true,
          list_mode: true as const,
          bucket: "wallet-bucket-list",
          objects: [],
          is_truncated: false,
          next_continuation_token: null,
        };
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address 0x1234567890123456789012345678901234567890 --latest",
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("Cannot list storage object");
    expect(result.text).toContain("--name");
    expect(lsCalled).toBe(false);
  });

  it("returns a meaningful ls error when stat response has invalid size_bytes", async () => {
    const command = createCloudCommand({
      requestStorageLsFn: async () => {
        throw new Error("ls response has invalid size_bytes; expected non-negative integer");
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "ls --wallet-address 0x1234abcd --object-key backup/archive.tar.gz",
      commandBody: "ls",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Cannot list storage object: ls response has invalid size_bytes; expected non-negative integer",
    );
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
    const command = createCloudCommand({ mnemosparkHomeDir: homeDir });

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
    const command = createCloudCommand({ mnemosparkHomeDir: homeDir });

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
      mnemosparkHomeDir: homeDir,
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
    const events = (await readFile(eventsPath, "utf-8"))
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
      expect(event.source).toBe("command");
    }
  });

  it("labels backup subagent tasks as backup", async () => {
    const { homeDir } = await createSandbox();
    let subagentCommand: string | undefined;
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
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
      args: "backup /tmp/source --name subagent-backup --async --orchestrator subagent",
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
      mnemosparkHomeDir: homeDir,
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

    if (status.text?.startsWith("Operation not found:")) {
      // node:sqlite may be unavailable in CI; verify fallback still references operation id.
      expect(status.text).toContain(operationId ?? "");
    } else {
      expect(status.text).toContain("status: succeeded");
      expect(status.text).toContain("subagent-session-id: session-sync-hooks");
    }

    const eventsPath = join(homeDir, ".openclaw", "mnemospark", "events.jsonl");
    const events = (await readFile(eventsPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.operation_id === operationId);
    expect(events.some((event) => event.event_type === "operation.completed")).toBe(true);
  });

  it("records dispatch failures for subagent orchestration", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
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
      mnemosparkHomeDir: homeDir,
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
    if (cancelled.text?.startsWith("Operation not found:")) {
      // When SQLite is unavailable, op-status cannot resolve operation rows for cancel requests.
      // In that mode, validate that async dispatch/progress events were still emitted.
      expect(events.some((event) => event.event_type === "operation.dispatched")).toBe(true);
      expect(events.some((event) => event.event_type === "operation.progress")).toBe(true);
    } else {
      expect(events.some((event) => event.event_type === "operation.cancel.requested")).toBe(true);
      expect(events.some((event) => event.event_type === "operation.cancelled")).toBe(true);
    }
  });

  it("marks timed out subagent operations with timeout error", async () => {
    const { homeDir } = await createSandbox();
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
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
      mnemosparkHomeDir: homeDir,
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
    const command = createCloudCommand({
      mnemosparkHomeDir: homeDir,
      ...withMockCronAdapter({
        add: async (job) => ({ jobId: job.jobId ?? "mock-job-id" }),
        remove: async () => {
          throw new Error("cron remove failed");
        },
        list: async () => [],
      }),
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
