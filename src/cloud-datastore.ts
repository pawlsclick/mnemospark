import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DB_SUBPATH = join(".openclaw", "mnemospark", "state.db");
const SCHEMA_VERSION = 3;
const require = createRequire(import.meta.url);

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
  trace_id?: string | null;
  orchestrator?: string | null;
  subagent_session_id?: string | null;
  timeout_seconds?: number | null;
  cancel_requested_at?: string | null;
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
  findCronByQuoteId: (quoteId: string) => Promise<CronJobRow | null>;
  findPaymentByQuoteId: (quoteId: string) => Promise<PaymentRow | null>;
  upsertOperation: (row: OperationRow) => Promise<void>;
  findOperationById: (operationId: string) => Promise<{
    operation_id: string;
    type: string;
    object_id: string | null;
    quote_id: string | null;
    trace_id: string | null;
    orchestrator: string | null;
    subagent_session_id: string | null;
    timeout_seconds: number | null;
    cancel_requested_at: string | null;
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
  findLatestFriendlyNameForObjectKey: (
    walletAddress: string,
    objectKey: string,
  ) => Promise<string | null>;
  findCronAndPaymentForObjectKey: (
    walletAddress: string,
    objectKey: string,
  ) => Promise<{
    cronId: string;
    schedule: string;
    quoteId: string;
    cronStatus: string;
    amount: number | null;
    network: string | null;
    paymentStatus: string | null;
  } | null>;
};

function resolveDbPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), DB_SUBPATH);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeWalletAddress(value: string): string {
  return value.trim().toLowerCase();
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

    // Use runtime require("node:sqlite") to prevent bundlers from rewriting
    // the built-in specifier to "sqlite" in dist output.
    const sqliteMod = require("node:sqlite") as {
      DatabaseSync?: new (path: string) => DbLike;
    };
    const DatabaseSyncCtor = sqliteMod.DatabaseSync;
    if (!DatabaseSyncCtor) {
      throw new Error("node:sqlite DatabaseSync is unavailable");
    }

    const nextDb = new DatabaseSyncCtor(dbPath);
    nextDb.exec("PRAGMA journal_mode=WAL;");
    nextDb.exec("PRAGMA foreign_keys=ON;");
    // Multiple DatabaseSync handles may open the same file (e.g. tests + handler); wait on locks.
    nextDb.exec("PRAGMA busy_timeout=5000;");

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
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_quote_id ON cron_jobs(quote_id);

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

    // Keep wallet_address canonical across tables for reliable matching/indexing.
    nextDb.exec(`
      UPDATE objects
      SET wallet_address = lower(trim(wallet_address))
      WHERE wallet_address <> lower(trim(wallet_address));

      UPDATE payments
      SET wallet_address = lower(trim(wallet_address))
      WHERE wallet_address <> lower(trim(wallet_address));

      UPDATE friendly_names
      SET wallet_address = lower(trim(wallet_address))
      WHERE wallet_address <> lower(trim(wallet_address));
    `);

    const addOperationsColumn = (columnName: string, sqlType: string): void => {
      try {
        nextDb.exec(`ALTER TABLE operations ADD COLUMN ${columnName} ${sqlType}`);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error);
        if (!message.includes("duplicate column name")) {
          throw error;
        }
      }
    };
    addOperationsColumn("trace_id", "TEXT");
    addOperationsColumn("orchestrator", "TEXT");
    addOperationsColumn("subagent_session_id", "TEXT");
    addOperationsColumn("timeout_seconds", "INTEGER");
    addOperationsColumn("cancel_requested_at", "TEXT");

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
    } catch (error) {
      if (process.env.MNEMOSPARK_SQLITE_STRICT === "1") {
        throw error;
      }
      return fallback;
    }
  };

  return {
    dbPath,
    ensureReady,
    upsertObject: async (row) => {
      await safe(() => {
        const normalizedWalletAddress = normalizeWalletAddress(row.wallet_address);
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
            normalizedWalletAddress,
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
        const normalizedWalletAddress = normalizeWalletAddress(row.wallet_address);
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
            normalizedWalletAddress,
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
    findCronByQuoteId: async (quoteId) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT cron_id, object_id, object_key, quote_id, schedule, command, status
             FROM cron_jobs WHERE quote_id = ? ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(quoteId) as
          | {
              cron_id: string;
              object_id: string;
              object_key: string;
              quote_id: string;
              schedule: string;
              command: string;
              status: string;
            }
          | undefined;
        if (!row) return null;
        return {
          cron_id: row.cron_id,
          object_id: row.object_id,
          object_key: row.object_key,
          quote_id: row.quote_id,
          schedule: row.schedule,
          command: row.command,
          status: row.status,
        };
      }, null),
    findPaymentByQuoteId: async (quoteId) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT quote_id, wallet_address, trans_id, amount, network, status, settled_at
             FROM payments WHERE quote_id = ? LIMIT 1`,
          )
          .get(quoteId) as
          | {
              quote_id: string;
              wallet_address: string;
              trans_id: string | null;
              amount: number;
              network: string | null;
              status: string;
              settled_at: string | null;
            }
          | undefined;
        if (!row) return null;
        return {
          quote_id: row.quote_id,
          wallet_address: row.wallet_address,
          trans_id: row.trans_id,
          amount: row.amount,
          network: row.network,
          status: row.status,
          settled_at: row.settled_at,
        };
      }, null),
    upsertOperation: async (row) => {
      await safe(() => {
        const ts = nowIso();
        const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
        db!
          .prepare(
            `INSERT INTO operations(operation_id, type, object_id, quote_id, trace_id, orchestrator, subagent_session_id, timeout_seconds, cancel_requested_at, status, error_code, error_message, started_at, finished_at, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(operation_id) DO UPDATE SET
             type=excluded.type,
             object_id=COALESCE(excluded.object_id, operations.object_id),
             quote_id=COALESCE(excluded.quote_id, operations.quote_id),
             trace_id=COALESCE(excluded.trace_id, operations.trace_id),
             orchestrator=COALESCE(excluded.orchestrator, operations.orchestrator),
             subagent_session_id=COALESCE(excluded.subagent_session_id, operations.subagent_session_id),
             timeout_seconds=COALESCE(excluded.timeout_seconds, operations.timeout_seconds),
             cancel_requested_at=COALESCE(excluded.cancel_requested_at, operations.cancel_requested_at),
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
            row.trace_id ?? null,
            row.orchestrator ?? null,
            row.subagent_session_id ?? null,
            row.timeout_seconds ?? null,
            row.cancel_requested_at ?? null,
            row.status,
            row.error_code,
            row.error_message,
            row.status === "started" ? ts : null,
            terminalStatuses.has(row.status) ? ts : null,
            ts,
            ts,
          );
      }, undefined);
    },
    findOperationById: async (operationId) =>
      safe(() => {
        const row = db!
          .prepare(
            `SELECT operation_id, type, object_id, quote_id, trace_id, orchestrator, subagent_session_id, timeout_seconds, cancel_requested_at, status, error_code, error_message, started_at, finished_at, updated_at
             FROM operations
             WHERE operation_id = ?
             LIMIT 1`,
          )
          .get(operationId) as
          | {
              operation_id: string;
              type: string;
              object_id: string | null;
              quote_id: string | null;
              trace_id: string | null;
              orchestrator: string | null;
              subagent_session_id: string | null;
              timeout_seconds: number | null;
              cancel_requested_at: string | null;
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
        const normalizedWalletAddress = normalizeWalletAddress(row.wallet_address);
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
            normalizedWalletAddress,
            ts,
            ts,
            row.is_active ?? 1,
          );
      }, undefined);
    },
    resolveFriendlyName: async (params) =>
      safe(() => {
        const normalizedWalletAddress = normalizeWalletAddress(params.walletAddress);
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
                .get(normalizedWalletAddress, params.friendlyName) as
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
                .get(normalizedWalletAddress, params.friendlyName, atIso) as
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
        const normalizedWalletAddress = normalizeWalletAddress(walletAddress);
        const row = db!
          .prepare(
            `SELECT COUNT(1) AS cnt
             FROM friendly_names
             WHERE wallet_address = ? AND friendly_name = ? AND is_active = 1`,
          )
          .get(normalizedWalletAddress, friendlyName) as { cnt: number } | undefined;
        return Number(row?.cnt ?? 0);
      }, 0),
    findLatestFriendlyNameForObjectKey: async (walletAddress, objectKey) =>
      safe(() => {
        const w = normalizeWalletAddress(walletAddress);
        const byKey = db!
          .prepare(
            `SELECT friendly_name
             FROM friendly_names
             WHERE wallet_address = ? AND object_key = ? AND is_active = 1
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .get(w, objectKey) as { friendly_name: string } | undefined;
        if (byKey) {
          return byKey.friendly_name;
        }
        const obj = db!
          .prepare(
            `SELECT object_id FROM objects WHERE wallet_address = ? AND object_key = ? LIMIT 1`,
          )
          .get(w, objectKey) as { object_id: string } | undefined;
        if (!obj) {
          return null;
        }
        const byObj = db!
          .prepare(
            `SELECT friendly_name
             FROM friendly_names
             WHERE wallet_address = ? AND object_id = ? AND is_active = 1
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .get(w, obj.object_id) as { friendly_name: string } | undefined;
        return byObj?.friendly_name ?? null;
      }, null),
    findCronAndPaymentForObjectKey: async (walletAddress, objectKey) =>
      safe(() => {
        const w = normalizeWalletAddress(walletAddress);
        const cron = db!
          .prepare(
            `SELECT c.cron_id, c.quote_id, c.schedule, c.status
             FROM cron_jobs c
             INNER JOIN objects o ON o.object_id = c.object_id
             WHERE c.object_key = ? AND o.wallet_address = ?
             ORDER BY c.updated_at DESC
             LIMIT 1`,
          )
          .get(objectKey, w) as
          | { cron_id: string; quote_id: string; schedule: string; status: string }
          | undefined;
        if (!cron) {
          return null;
        }
        const pay = db!
          .prepare(
            `SELECT amount, network, status
             FROM payments
             WHERE quote_id = ? AND wallet_address = ?
             LIMIT 1`,
          )
          .get(cron.quote_id, w) as
          | { amount: number; network: string | null; status: string }
          | undefined;
        return {
          cronId: cron.cron_id,
          schedule: cron.schedule,
          quoteId: cron.quote_id,
          cronStatus: cron.status,
          amount: pay?.amount ?? null,
          network: pay?.network ?? null,
          paymentStatus: pay?.status ?? null,
        };
      }, null),
  };
}

export { DB_SUBPATH, SCHEMA_VERSION, resolveDbPath as resolveCloudDatastorePath };
