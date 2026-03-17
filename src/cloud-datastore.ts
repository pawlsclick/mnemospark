import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DB_SUBPATH = join(".openclaw", "mnemospark", "state.db");
const SCHEMA_VERSION = 2;

export type StorageObjectRow = {
  object_id: string;
  object_key: string | null;
  wallet_address: string;
  quote_id: string | null;
  provider: string | null;
  bucket_name: string | null;
  region: string | null;
  sha256: string | null;
  status: string;
};

export type PaymentRow = {
  quote_id: string;
  wallet_address: string;
  trans_id: string | null;
  amount: number;
  network: string | null;
  status: string;
  settled_at?: string | null;
};

export type CronJobRow = {
  cron_id: string;
  object_id: string;
  object_key: string;
  quote_id: string;
  schedule: string;
  command: string;
  status: string;
};

export type OperationRow = {
  operation_id: string;
  type: string;
  object_id: string | null;
  quote_id: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
};

export type QuoteLookup = {
  quoteId: string;
  storagePrice: number;
  walletAddress: string;
  objectId: string;
  objectIdHash: string;
  provider: string;
  location: string;
};

export type FriendlyNameRow = {
  friendly_name: string;
  object_id: string;
  object_key: string | null;
  quote_id: string | null;
  wallet_address: string;
  is_active?: number;
};

export type FriendlyNameLookup = {
  friendlyNameId: string;
  friendlyName: string;
  objectId: string;
  objectKey: string | null;
  quoteId: string | null;
  walletAddress: string;
  createdAt: string;
};

export type CloudDatastore = {
  dbPath: string;
  ensureReady: () => Promise<void>;
  upsertObject: (row: StorageObjectRow) => Promise<void>;
  findObjectByObjectKey: (objectKey: string) => Promise<StorageObjectRow | null>;
  findObjectById: (objectId: string) => Promise<StorageObjectRow | null>;
  upsertPayment: (row: PaymentRow) => Promise<void>;
  upsertCronJob: (row: CronJobRow) => Promise<void>;
  removeCronJob: (cronId: string) => Promise<boolean>;
  findCronByObjectKey: (objectKey: string) => Promise<{ cronId: string; objectId: string } | null>;
  upsertOperation: (row: OperationRow) => Promise<void>;
  findOperationById: (operationId: string) => Promise<{
    operation_id: string;
    type: string;
    status: string;
    error_code: string | null;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
    updated_at: string;
  } | null>;
  findQuoteById: (quoteId: string) => Promise<QuoteLookup | null>;
  upsertFriendlyName: (row: FriendlyNameRow) => Promise<void>;
  resolveFriendlyName: (params: {
    walletAddress: string;
    friendlyName: string;
    latest?: boolean;
    at?: string;
  }) => Promise<FriendlyNameLookup | null>;
  countFriendlyNameMatches: (walletAddress: string, friendlyName: string) => Promise<number>;
};

function resolveDbPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), DB_SUBPATH);
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function createCloudDatastore(homeDir?: string): Promise<CloudDatastore> {
  const dbPath = resolveDbPath(homeDir);
  type DbLike = {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...args: unknown[]) => { changes?: number };
      get: (...args: unknown[]) => unknown;
    };
  };

  let db: DbLike | null = null;

  const ensureReady = async (): Promise<void> => {
    if (db) return;
    if (process.env.MNEMOSPARK_DISABLE_SQLITE === "1") {
      throw new Error("SQLite disabled by MNEMOSPARK_DISABLE_SQLITE=1");
    }

    await mkdir(dirname(dbPath), { recursive: true });
    const sqliteMod = (await import("node:sqlite")) as {
      DatabaseSync?: new (path: string) => DbLike;
    };
    const DatabaseSync = sqliteMod.DatabaseSync;
    if (!DatabaseSync) {
      throw new Error("node:sqlite DatabaseSync is unavailable");
    }

    const nextDb = new DatabaseSync(dbPath);
    nextDb.exec("PRAGMA journal_mode=WAL;");
    nextDb.exec("PRAGMA foreign_keys=ON;");

    nextDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS objects (
        object_id TEXT PRIMARY KEY,
        object_key TEXT,
        wallet_address TEXT NOT NULL,
        quote_id TEXT,
        provider TEXT,
        bucket_name TEXT,
        region TEXT,
        sha256 TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_objects_wallet ON objects(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_objects_quote ON objects(quote_id);
      CREATE INDEX IF NOT EXISTS idx_objects_object_key ON objects(object_key);

      CREATE TABLE IF NOT EXISTS payments (
        quote_id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        trans_id TEXT,
        amount REAL NOT NULL,
        network TEXT,
        status TEXT NOT NULL,
        settled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_payments_wallet ON payments(wallet_address);

      CREATE TABLE IF NOT EXISTS cron_jobs (
        cron_id TEXT PRIMARY KEY,
        object_id TEXT NOT NULL,
        object_key TEXT NOT NULL,
        quote_id TEXT NOT NULL,
        schedule TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_object_key ON cron_jobs(object_key);

      CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        object_id TEXT,
        quote_id TEXT,
        status TEXT NOT NULL,
        error_code TEXT,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operations_type ON operations(type);
      CREATE INDEX IF NOT EXISTS idx_operations_object_id ON operations(object_id);
      CREATE INDEX IF NOT EXISTS idx_operations_quote_id ON operations(quote_id);

      CREATE TABLE IF NOT EXISTS friendly_names (
        friendly_name_id TEXT PRIMARY KEY,
        friendly_name TEXT NOT NULL,
        object_id TEXT NOT NULL,
        object_key TEXT,
        quote_id TEXT,
        wallet_address TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_friendly_names_name ON friendly_names(friendly_name);
      CREATE INDEX IF NOT EXISTS idx_friendly_names_object_id ON friendly_names(object_id);
      CREATE INDEX IF NOT EXISTS idx_friendly_names_wallet ON friendly_names(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_friendly_names_created_at ON friendly_names(created_at);
    `);

    nextDb
      .prepare(
        `INSERT INTO schema_migrations(version, applied_at)
       VALUES(?, ?)
       ON CONFLICT(version) DO NOTHING`,
      )
      .run(SCHEMA_VERSION, nowIso());
    db = nextDb;
  };

  const safe = async <T>(fn: () => T, fallback: T): Promise<T> => {
    try {
      await ensureReady();
      return fn();
    } catch {
      return fallback;
    }
  };

  return {
    dbPath,
    ensureReady,
    upsertObject: async (row) => {
      await safe(() => {
        const ts = nowIso();
        db!
          .prepare(
            `INSERT INTO objects(object_id, object_key, wallet_address, quote_id, provider, bucket_name, region, sha256, status, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(object_id) DO UPDATE SET
             object_key=excluded.object_key,
             wallet_address=excluded.wallet_address,
             quote_id=excluded.quote_id,
             provider=excluded.provider,
             bucket_name=excluded.bucket_name,
             region=excluded.region,
             sha256=excluded.sha256,
             status=excluded.status,
             updated_at=excluded.updated_at`,
          )
          .run(
            row.object_id,
            row.object_key,
            row.wallet_address,
            row.quote_id,
            row.provider,
            row.bucket_name,
            row.region,
            row.sha256,
            row.status,
            ts,
            ts,
          );
      }, undefined);
    },
    findObjectByObjectKey: async (objectKey) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT object_id, object_key, wallet_address, quote_id, provider, bucket_name, region, sha256, status
             FROM objects
             WHERE object_key = ?
             ORDER BY updated_at DESC
             LIMIT 1`,
          )
          .get(objectKey) as StorageObjectRow | undefined;
        return row ?? null;
      }, null),
    findObjectById: async (objectId) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT object_id, object_key, wallet_address, quote_id, provider, bucket_name, region, sha256, status
             FROM objects
             WHERE object_id = ?
             LIMIT 1`,
          )
          .get(objectId) as StorageObjectRow | undefined;
        return row ?? null;
      }, null),
    upsertPayment: async (row) => {
      await safe(() => {
        const ts = nowIso();
        db!
          .prepare(
            `INSERT INTO payments(quote_id, wallet_address, trans_id, amount, network, status, settled_at, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(quote_id) DO UPDATE SET
             wallet_address=excluded.wallet_address,
             trans_id=excluded.trans_id,
             amount=excluded.amount,
             network=excluded.network,
             status=excluded.status,
             settled_at=excluded.settled_at,
             updated_at=excluded.updated_at`,
          )
          .run(
            row.quote_id,
            row.wallet_address,
            row.trans_id,
            row.amount,
            row.network,
            row.status,
            row.settled_at ?? null,
            ts,
            ts,
          );
      }, undefined);
    },
    upsertCronJob: async (row) => {
      await safe(() => {
        const ts = nowIso();
        db!
          .prepare(
            `INSERT INTO cron_jobs(cron_id, object_id, object_key, quote_id, schedule, command, status, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(cron_id) DO UPDATE SET
             object_id=excluded.object_id,
             object_key=excluded.object_key,
             quote_id=excluded.quote_id,
             schedule=excluded.schedule,
             command=excluded.command,
             status=excluded.status,
             updated_at=excluded.updated_at`,
          )
          .run(
            row.cron_id,
            row.object_id,
            row.object_key,
            row.quote_id,
            row.schedule,
            row.command,
            row.status,
            ts,
            ts,
          );
      }, undefined);
    },
    removeCronJob: async (cronId) =>
      safe(() => {
        const res = db!.prepare(`DELETE FROM cron_jobs WHERE cron_id = ?`).run(cronId);
        return Number(res.changes ?? 0) > 0;
      }, false),
    findCronByObjectKey: async (objectKey) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT cron_id, object_id FROM cron_jobs WHERE object_key = ? ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(objectKey) as { cron_id: string; object_id: string } | undefined;
        if (!row) return null;
        return { cronId: row.cron_id, objectId: row.object_id };
      }, null),
    upsertOperation: async (row) => {
      await safe(() => {
        const ts = nowIso();
        db!
          .prepare(
            `INSERT INTO operations(operation_id, type, object_id, quote_id, status, error_code, error_message, started_at, finished_at, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(operation_id) DO UPDATE SET
             type=excluded.type,
             object_id=COALESCE(excluded.object_id, operations.object_id),
             quote_id=excluded.quote_id,
             status=excluded.status,
             error_code=excluded.error_code,
             error_message=excluded.error_message,
             started_at=COALESCE(excluded.started_at, operations.started_at),
             finished_at=COALESCE(excluded.finished_at, operations.finished_at),
             updated_at=excluded.updated_at`,
          )
          .run(
            row.operation_id,
            row.type,
            row.object_id,
            row.quote_id,
            row.status,
            row.error_code,
            row.error_message,
            row.status === "started" ? ts : null,
            row.status === "succeeded" || row.status === "failed" ? ts : null,
            ts,
            ts,
          );
      }, undefined);
    },
    findOperationById: async (operationId) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT operation_id, type, status, error_code, error_message, started_at, finished_at, updated_at
             FROM operations
             WHERE operation_id = ?
             LIMIT 1`,
          )
          .get(operationId) as
          | {
              operation_id: string;
              type: string;
              status: string;
              error_code: string | null;
              error_message: string | null;
              started_at: string | null;
              finished_at: string | null;
              updated_at: string;
            }
          | undefined;
        return row ?? null;
      }, null),
    findQuoteById: async (quoteId) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT quote_id, amount, wallet_address FROM payments WHERE quote_id = ? ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(quoteId) as { quote_id: string; amount: number; wallet_address: string } | undefined;
        const object = db!
          .prepare(
            `SELECT object_id, sha256, provider, region FROM objects WHERE quote_id = ? ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(quoteId) as
          | {
              object_id: string;
              sha256: string | null;
              provider: string | null;
              region: string | null;
            }
          | undefined;
        if (!row || !object) return null;
        if (object.sha256 === null || object.provider === null || object.region === null)
          return null;
        return {
          quoteId,
          storagePrice: Number(row.amount),
          walletAddress: row.wallet_address,
          objectId: object.object_id,
          objectIdHash: object.sha256,
          provider: object.provider,
          location: object.region,
        };
      }, null),
    upsertFriendlyName: async (row) => {
      await safe(() => {
        const ts = nowIso();
        db!
          .prepare(
            `INSERT INTO friendly_names(friendly_name_id, friendly_name, object_id, object_key, quote_id, wallet_address, created_at, updated_at, is_active)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            row.friendly_name,
            row.object_id,
            row.object_key,
            row.quote_id,
            row.wallet_address,
            ts,
            ts,
            row.is_active ?? 1,
          );
      }, undefined);
    },
    resolveFriendlyName: async (params) =>
      safe(() => {
        const atIso = params.at ? new Date(params.at).toISOString() : null;
        const row =
          params.latest || !atIso
            ? (db!
                .prepare(
                  `SELECT friendly_name_id, friendly_name, object_id, object_key, quote_id, wallet_address, created_at
                 FROM friendly_names
                 WHERE wallet_address = ? AND friendly_name = ? AND is_active = 1
                 ORDER BY created_at DESC
                 LIMIT 1`,
                )
                .get(params.walletAddress, params.friendlyName) as
                | {
                    friendly_name_id: string;
                    friendly_name: string;
                    object_id: string;
                    object_key: string | null;
                    quote_id: string | null;
                    wallet_address: string;
                    created_at: string;
                  }
                | undefined)
            : (db!
                .prepare(
                  `SELECT friendly_name_id, friendly_name, object_id, object_key, quote_id, wallet_address, created_at
                 FROM friendly_names
                 WHERE wallet_address = ? AND friendly_name = ? AND is_active = 1 AND created_at <= ?
                 ORDER BY created_at DESC
                 LIMIT 1`,
                )
                .get(params.walletAddress, params.friendlyName, atIso) as
                | {
                    friendly_name_id: string;
                    friendly_name: string;
                    object_id: string;
                    object_key: string | null;
                    quote_id: string | null;
                    wallet_address: string;
                    created_at: string;
                  }
                | undefined);

        if (!row) return null;
        return {
          friendlyNameId: row.friendly_name_id,
          friendlyName: row.friendly_name,
          objectId: row.object_id,
          objectKey: row.object_key,
          quoteId: row.quote_id,
          walletAddress: row.wallet_address,
          createdAt: row.created_at,
        };
      }, null),
    countFriendlyNameMatches: async (walletAddress, friendlyName) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT COUNT(1) AS cnt
             FROM friendly_names
             WHERE wallet_address = ? AND friendly_name = ? AND is_active = 1`,
          )
          .get(walletAddress, friendlyName) as { cnt: number } | undefined;
        return Number(row?.cnt ?? 0);
      }, 0),
  };
}

export { DB_SUBPATH, SCHEMA_VERSION, resolveDbPath as resolveCloudDatastorePath };
