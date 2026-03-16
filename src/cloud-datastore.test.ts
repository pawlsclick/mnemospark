import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { createCloudDatastore, resolveCloudDatastorePath } from "./cloud-datastore.js";

describe("cloud datastore", () => {
  let homeDir: string;
  let sqliteAvailable = true;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "mnemospark-db-"));
    try {
      await import("node:sqlite");
      sqliteAvailable = true;
    } catch {
      sqliteAvailable = false;
    }
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  it("initializes database and schema migrations", async () => {
    const datastore = await createCloudDatastore(homeDir);
    if (!sqliteAvailable) {
      await expect(datastore.ensureReady()).rejects.toThrow();
      return;
    }
    await datastore.ensureReady();

    expect(datastore.dbPath).toBe(resolveCloudDatastorePath(homeDir));
  });

  it("supports insert/update/query for quote + object", async () => {
    const datastore = await createCloudDatastore(homeDir);
    if (!sqliteAvailable) {
      await datastore.upsertObject({
        object_id: "obj-1",
        object_key: null,
        wallet_address: "0xabc",
        quote_id: "q-1",
        provider: "s3",
        bucket_name: null,
        region: "us-east-1",
        sha256: "hash1",
        status: "quoted",
      });
      const quote = await datastore.findQuoteById("q-1");
      expect(quote).toBeNull();
      return;
    }
    await datastore.upsertObject({
      object_id: "obj-1",
      object_key: null,
      wallet_address: "0xabc",
      quote_id: "q-1",
      provider: "s3",
      bucket_name: null,
      region: "us-east-1",
      sha256: "hash1",
      status: "quoted",
    });
    await datastore.upsertPayment({
      quote_id: "q-1",
      wallet_address: "0xabc",
      trans_id: null,
      amount: 1.23,
      network: "base",
      status: "quoted",
    });

    const quote = await datastore.findQuoteById("q-1");
    expect(quote).not.toBeNull();
    expect(quote?.objectId).toBe("obj-1");
    expect(quote?.storagePrice).toBe(1.23);

    await datastore.upsertObject({
      object_id: "obj-1",
      object_key: "k-1",
      wallet_address: "0xabc",
      quote_id: "q-1",
      provider: "s3",
      bucket_name: "bkt",
      region: "us-east-1",
      sha256: "hash1",
      status: "uploaded",
    });

    const updated = await datastore.findQuoteById("q-1");
    expect(updated?.objectId).toBe("obj-1");
  });

  it("returns null quote lookup when object metadata is missing", async () => {
    const datastore = await createCloudDatastore(homeDir);
    if (!sqliteAvailable) {
      expect(await datastore.findQuoteById("q-nulls")).toBeNull();
      return;
    }

    await datastore.upsertObject({
      object_id: "obj-nulls",
      object_key: null,
      wallet_address: "0xabc",
      quote_id: "q-nulls",
      provider: null,
      bucket_name: null,
      region: null,
      sha256: null,
      status: "deleted",
    });
    await datastore.upsertPayment({
      quote_id: "q-nulls",
      wallet_address: "0xabc",
      trans_id: null,
      amount: 1.23,
      network: null,
      status: "quoted",
    });

    expect(await datastore.findQuoteById("q-nulls")).toBeNull();
  });

  it("resolves friendly names with latest and at selectors", async () => {
    const datastore = await createCloudDatastore(homeDir);

    if (!sqliteAvailable) {
      expect(
        await datastore.resolveFriendlyName({
          walletAddress: "0xabc",
          friendlyName: "project-alpha",
        }),
      ).toBeNull();
      return;
    }

    await datastore.upsertFriendlyName({
      friendly_name: "project-alpha",
      object_id: "obj-1",
      object_key: "key-1",
      quote_id: "q-1",
      wallet_address: "0xabc",
    });
    await new Promise((r) => setTimeout(r, 2));
    await datastore.upsertFriendlyName({
      friendly_name: "project-alpha",
      object_id: "obj-2",
      object_key: "key-2",
      quote_id: "q-2",
      wallet_address: "0xabc",
    });

    expect(await datastore.countFriendlyNameMatches("0xabc", "project-alpha")).toBe(2);

    const latest = await datastore.resolveFriendlyName({
      walletAddress: "0xabc",
      friendlyName: "project-alpha",
      latest: true,
    });
    expect(latest?.objectId).toBe("obj-2");

    const at = await datastore.resolveFriendlyName({
      walletAddress: "0xabc",
      friendlyName: "project-alpha",
      at: latest?.createdAt,
    });
    expect(at).not.toBeNull();
  });

  it("tracks and removes cron rows", async () => {
    const datastore = await createCloudDatastore(homeDir);

    if (!sqliteAvailable) {
      const found = await datastore.findCronByObjectKey("obj-key-1");
      expect(found).toBeNull();
      const removed = await datastore.removeCronJob("cron-1");
      expect(removed).toBe(false);
      return;
    }

    await datastore.upsertCronJob({
      cron_id: "cron-1",
      object_id: "obj-1",
      object_key: "obj-key-1",
      quote_id: "q-1",
      schedule: "0 0 1 * *",
      command: "mnemospark-pay-storage",
      status: "active",
    });

    const found = await datastore.findCronByObjectKey("obj-key-1");
    expect(found?.cronId).toBe("cron-1");

    const removed = await datastore.removeCronJob("cron-1");
    expect(removed).toBe(true);

    const missing = await datastore.findCronByObjectKey("obj-key-1");
    expect(missing).toBeNull();
  });
});
