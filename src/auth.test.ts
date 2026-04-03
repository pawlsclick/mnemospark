import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHome = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports -- hoisted before ESM imports resolve */
  const pathMod = require("node:path") as typeof import("node:path");
  const osMod = require("node:os") as typeof import("node:os");
  return {
    path: pathMod.join(
      osMod.tmpdir(),
      `mnemospark-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ),
  };
});

vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  return {
    ...os,
    homedir: () => mockHome.path,
  };
});

import {
  createMnemosparkWalletWithOptionalBackup,
  LEGACY_WALLET_FILE,
  pickUniqueWalletKeyBackupPath,
  resolveWalletKeyForSlashCommandsSync,
  WALLET_FILE,
} from "./auth.js";

const TEST_KEY =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;

function wipeOpenclawDir() {
  try {
    rmSync(join(mockHome.path, ".openclaw"), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("resolveWalletKeyForSlashCommandsSync", () => {
  beforeEach(() => {
    wipeOpenclawDir();
    delete process.env.MNEMOSPARK_WALLET_KEY;
  });

  afterEach(() => {
    delete process.env.MNEMOSPARK_WALLET_KEY;
  });

  it("returns null when no env and no wallet files", () => {
    expect(resolveWalletKeyForSlashCommandsSync()).toBeNull();
  });

  it("prefers MNEMOSPARK_WALLET_KEY over files", () => {
    process.env.MNEMOSPARK_WALLET_KEY = TEST_KEY;
    mkdirSync(join(mockHome.path, ".openclaw", "mnemospark", "wallet"), { recursive: true });
    writeFileSync(
      join(mockHome.path, ".openclaw", "mnemospark", "wallet", "wallet.key"),
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
      { mode: 0o600 },
    );
    const r = resolveWalletKeyForSlashCommandsSync();
    expect(r?.walletKey).toBe(TEST_KEY);
    expect(r?.keyPathLabel).toContain("MNEMOSPARK_WALLET_KEY");
  });

  it("loads legacy blockrun path when mnemospark file is absent", () => {
    const legacyDir = join(mockHome.path, ".openclaw", "blockrun");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "wallet.key"), `${TEST_KEY}\n`, { mode: 0o600 });
    const r = resolveWalletKeyForSlashCommandsSync();
    expect(r?.walletKey).toBe(TEST_KEY);
    expect(r?.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(r?.keyPathLabel).toBe(LEGACY_WALLET_FILE);
  });

  it("prefers mnemospark file over legacy when both exist", () => {
    const primaryKey =
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as `0x${string}`;
    mkdirSync(join(mockHome.path, ".openclaw", "mnemospark", "wallet"), { recursive: true });
    const legacyDir = join(mockHome.path, ".openclaw", "blockrun");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "wallet.key"), `${TEST_KEY}\n`, { mode: 0o600 });
    writeFileSync(
      join(mockHome.path, ".openclaw", "mnemospark", "wallet", "wallet.key"),
      `${primaryKey}\n`,
      {
        mode: 0o600,
      },
    );
    const r = resolveWalletKeyForSlashCommandsSync();
    expect(r?.walletKey).toBe(primaryKey);
    expect(r?.keyPathLabel).toBe(WALLET_FILE);
  });
});

describe("pickUniqueWalletKeyBackupPath", () => {
  beforeEach(() => {
    wipeOpenclawDir();
  });

  it("returns base dated path when it does not exist", () => {
    const p = join(mockHome.path, "wallet.key");
    const b = pickUniqueWalletKeyBackupPath(p);
    expect(b).toMatch(/wallet\.key\.bak-\d{4}-\d{2}-\d{2}$/);
  });

  it("appends -2 when base backup exists", () => {
    const p = join(mockHome.path, "wallet.key");
    mkdirSync(mockHome.path, { recursive: true });
    const first = pickUniqueWalletKeyBackupPath(p);
    writeFileSync(first, "x");
    const second = pickUniqueWalletKeyBackupPath(p);
    expect(second).toMatch(/\.bak-\d{4}-\d{2}-\d{2}-2$/);
  });
});

describe("createMnemosparkWalletWithOptionalBackup", () => {
  beforeEach(() => {
    wipeOpenclawDir();
    delete process.env.MNEMOSPARK_WALLET_KEY;
  });

  it("writes a new wallet when none exists", async () => {
    const r = await createMnemosparkWalletWithOptionalBackup();
    expect(r.backupPath).toBeUndefined();
    expect(r.key).toMatch(/^0x[0-9a-f]{64}$/);
    const onDisk = readFileSync(WALLET_FILE, "utf-8").trim();
    expect(onDisk).toBe(r.key);
  });

  it("backs up existing mnemospark wallet.key then writes a new key", async () => {
    mkdirSync(join(mockHome.path, ".openclaw", "mnemospark", "wallet"), { recursive: true });
    writeFileSync(WALLET_FILE, `${TEST_KEY}\n`, { mode: 0o600 });
    const r = await createMnemosparkWalletWithOptionalBackup();
    expect(r.backupPath).toBeDefined();
    expect(readFileSync(r.backupPath!, "utf-8").trim()).toBe(TEST_KEY);
    expect(readFileSync(WALLET_FILE, "utf-8").trim()).not.toBe(TEST_KEY);
    expect(readFileSync(WALLET_FILE, "utf-8").trim()).toBe(r.key);
  });
});
