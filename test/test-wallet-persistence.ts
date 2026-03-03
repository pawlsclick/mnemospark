/**
 * Systemd-free wallet persistence integration checks.
 *
 * These tests avoid `openclaw gateway start` so they can run in cloud/CI
 * environments without user-level systemd. They validate the same core
 * behavior using runtime modules directly:
 *   - Wallet persistence across proxy restarts
 *   - Auto-generation and wallet file writes when no files exist
 */

import assert from "node:assert";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

type RuntimeModules = {
  resolveOrGenerateWalletKey: () => Promise<{
    key: string;
    address: string;
    source: "saved" | "env" | "generated";
  }>;
  WALLET_FILE: string;
  LEGACY_WALLET_FILE: string;
  startProxy: (options: {
    walletKey: string;
    port?: number;
    onReady?: (port: number) => void;
    onError?: (error: Error) => void;
  }) => Promise<{ close: () => Promise<void>; port: number }>;
};

const TEST_TIMEOUT_MS = 10_000;
const originalHome = process.env.HOME;
let testHomeDir = "";
let runtime: RuntimeModules;
let activeProxyCloser: (() => Promise<void>) | null = null;

function randomPort(): number {
  return 21000 + Math.floor(Math.random() * 2000);
}

async function waitForProxyHealth(port: number, timeoutMs = TEST_TIMEOUT_MS): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const payload = (await response.json()) as { status?: string };
        if (payload.status === "ok") {
          return;
        }
      }
    } catch {
      // proxy may still be starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Proxy failed to become healthy on port ${port} within timeout`);
}

async function removeFileIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

describe("Wallet Persistence (systemd-free)", () => {
  before(async () => {
    testHomeDir = await mkdtemp(join(tmpdir(), "mnemospark-wallet-persist-"));
    process.env.HOME = testHomeDir;
    await mkdir(join(testHomeDir, ".openclaw"), { recursive: true });

    const cacheBuster = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const authModule = (await import(
      `../src/auth.ts?wallet-persistence-test=${cacheBuster}`
    )) as typeof import("../src/auth.ts");
    const proxyModule = (await import(
      `../src/proxy.ts?wallet-persistence-test=${cacheBuster}`
    )) as typeof import("../src/proxy.ts");

    runtime = {
      resolveOrGenerateWalletKey: authModule.resolveOrGenerateWalletKey,
      WALLET_FILE: authModule.WALLET_FILE,
      LEGACY_WALLET_FILE: authModule.LEGACY_WALLET_FILE,
      startProxy: proxyModule.startProxy,
    };
  });

  after(async () => {
    if (activeProxyCloser) {
      try {
        await activeProxyCloser();
      } catch {
        // Best-effort cleanup.
      } finally {
        activeProxyCloser = null;
      }
    }
    delete process.env.MNEMOSPARK_WALLET_KEY;

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (testHomeDir) {
      await rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it("persists wallet across proxy restarts", async () => {
    delete process.env.MNEMOSPARK_WALLET_KEY;
    await removeFileIfExists(runtime.WALLET_FILE);
    await removeFileIfExists(runtime.LEGACY_WALLET_FILE);

    const generated = await runtime.resolveOrGenerateWalletKey();
    assert.equal(generated.source, "generated");
    assert.ok(generated.key.startsWith("0x"));
    assert.equal(generated.key.length, 66);

    const walletOnDisk = (await readFile(runtime.WALLET_FILE, "utf-8")).trim();
    assert.equal(walletOnDisk, generated.key);

    const port = randomPort();
    const firstProxy = await runtime.startProxy({
      walletKey: generated.key,
      port,
    });
    activeProxyCloser = firstProxy.close;
    await waitForProxyHealth(port);
    await firstProxy.close();
    activeProxyCloser = null;

    const loaded = await runtime.resolveOrGenerateWalletKey();
    assert.equal(loaded.source, "saved");
    assert.equal(loaded.key, generated.key);

    const secondProxy = await runtime.startProxy({
      walletKey: loaded.key,
      port,
    });
    activeProxyCloser = secondProxy.close;
    await waitForProxyHealth(port);
    await secondProxy.close();
    activeProxyCloser = null;

    const walletAfterRestart = (await readFile(runtime.WALLET_FILE, "utf-8")).trim();
    assert.equal(walletAfterRestart, generated.key);
  });

  it("auto-generates wallet and writes to disk when no files exist", async () => {
    delete process.env.MNEMOSPARK_WALLET_KEY;

    await removeFileIfExists(runtime.WALLET_FILE);
    await removeFileIfExists(runtime.LEGACY_WALLET_FILE);

    const resolved = await runtime.resolveOrGenerateWalletKey();
    assert.equal(resolved.source, "generated");
    assert.ok(resolved.key.startsWith("0x"));
    assert.equal(resolved.key.length, 66);

    const walletOnDisk = (await readFile(runtime.WALLET_FILE, "utf-8")).trim();
    assert.equal(walletOnDisk, resolved.key);

    const port = randomPort();
    const proxy = await runtime.startProxy({
      walletKey: resolved.key,
      port,
    });
    activeProxyCloser = proxy.close;
    await waitForProxyHealth(port);
    await proxy.close();
    activeProxyCloser = null;
  });
});
