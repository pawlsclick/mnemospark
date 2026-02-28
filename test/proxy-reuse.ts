/**
 * Tests for proxy reuse and port configuration features.
 *
 * Tests:
 *   1. Port config resolves default when env var not set
 *   2. Port config resolves custom port when MNEMOSPARK_PROXY_PORT is set
 *   3. startProxy() reuses existing proxy instead of failing with EADDRINUSE
 *   4. Reused proxy returns correct wallet address
 *
 * Usage:
 *   npx tsx test/proxy-reuse.ts
 */

import { startProxy } from "../src/proxy.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// ─── Helpers ───

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function loadProxyPortFromFreshConfig(
  envValue: string | undefined,
): Promise<{ port: number; defaultPort: number }> {
  const original = process.env.MNEMOSPARK_PROXY_PORT;
  if (envValue === undefined) {
    delete process.env.MNEMOSPARK_PROXY_PORT;
  } else {
    process.env.MNEMOSPARK_PROXY_PORT = envValue;
  }

  try {
    const cacheBuster = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const configModule = (await import(
      `../src/config.ts?proxy-reuse-test=${cacheBuster}`
    )) as typeof import("../src/config.ts");
    return {
      port: configModule.PROXY_PORT,
      defaultPort: 7120,
    };
  } finally {
    if (original === undefined) {
      delete process.env.MNEMOSPARK_PROXY_PORT;
    } else {
      process.env.MNEMOSPARK_PROXY_PORT = original;
    }
  }
}

// ─── Part 1: Port config resolution ───

console.log("\n═══ Part 1: Port config resolution ═══\n");

{
  // Test 1: Default port when env var not set
  const defaultConfig = await loadProxyPortFromFreshConfig(undefined);
  assert(
    defaultConfig.port === defaultConfig.defaultPort,
    `Default port is ${defaultConfig.defaultPort}: ${defaultConfig.port}`,
  );

  // Test 2: Custom port from env var
  const customConfig = await loadProxyPortFromFreshConfig("9999");
  const customPort = customConfig.port;
  assert(customPort === 9999, `Custom port from env: ${customPort}`);

  // Test 3: Invalid port falls back to default
  const invalidConfig = await loadProxyPortFromFreshConfig("invalid");
  const invalidPort = invalidConfig.port;
  assert(
    invalidPort === invalidConfig.defaultPort,
    `Invalid env falls back to ${invalidConfig.defaultPort}: ${invalidPort}`,
  );

  // Test 4: Out of range port falls back to default
  const outOfRangeConfig = await loadProxyPortFromFreshConfig("99999");
  const outOfRange = outOfRangeConfig.port;
  assert(
    outOfRange === outOfRangeConfig.defaultPort,
    `Out of range falls back to ${outOfRangeConfig.defaultPort}: ${outOfRange}`,
  );

  // Test 5: Zero port falls back to default
  const zeroConfig = await loadProxyPortFromFreshConfig("0");
  const zeroPort = zeroConfig.port;
  assert(
    zeroPort === zeroConfig.defaultPort,
    `Zero falls back to ${zeroConfig.defaultPort}: ${zeroPort}`,
  );
}

// ─── Part 2: Proxy Reuse ───

console.log("\n═══ Part 2: Proxy Reuse ═══\n");

{
  // Generate a test wallet key
  const walletKey = generatePrivateKey();
  const account = privateKeyToAccount(walletKey);

  console.log(`  Using test wallet: ${account.address}`);

  // Use a random port to avoid conflicts
  const testPort = 18402 + Math.floor(Math.random() * 1000);
  console.log(`  Using test port: ${testPort}`);

  try {
    // Start first proxy
    console.log("\n  Starting first proxy...");
    const proxy1 = await startProxy({
      walletKey,
      port: testPort,
      onReady: (port) => console.log(`  First proxy ready on port ${port}`),
    });

    assert(proxy1.port === testPort, `First proxy on correct port: ${proxy1.port}`);
    assert(
      proxy1.walletAddress === account.address,
      `First proxy wallet matches: ${proxy1.walletAddress}`,
    );

    // Verify health endpoint
    const health1 = await fetch(`http://127.0.0.1:${testPort}/health`);
    const health1Data = (await health1.json()) as { status: string; wallet: string };
    assert(health1Data.status === "ok", `First proxy health check: ${health1Data.status}`);

    // Start second proxy on same port — should reuse
    console.log("\n  Starting second proxy (should reuse)...");
    const proxy2 = await startProxy({
      walletKey,
      port: testPort,
      onReady: (port) => console.log(`  Second proxy ready on port ${port}`),
    });

    assert(proxy2.port === testPort, `Second proxy on same port: ${proxy2.port}`);
    assert(
      proxy2.walletAddress === account.address,
      `Second proxy wallet matches: ${proxy2.walletAddress}`,
    );

    // Verify the proxy is still working
    const health2 = await fetch(`http://127.0.0.1:${testPort}/health`);
    const health2Data = (await health2.json()) as { status: string; wallet: string };
    assert(health2Data.status === "ok", `Reused proxy health check: ${health2Data.status}`);

    // Close second proxy (should be no-op since it didn't start the server)
    await proxy2.close();
    console.log("  Second proxy closed (no-op).");

    // Verify original proxy is still running
    const health3 = await fetch(`http://127.0.0.1:${testPort}/health`);
    const health3Data = (await health3.json()) as { status: string; wallet: string };
    assert(
      health3Data.status === "ok",
      `Original proxy still running after reused handle closed: ${health3Data.status}`,
    );

    // Close first proxy
    await proxy1.close();
    console.log("  First proxy closed.");

    // Verify proxy is now stopped
    try {
      await fetch(`http://127.0.0.1:${testPort}/health`);
      assert(false, "Proxy should be stopped");
    } catch {
      assert(true, "Proxy correctly stopped after close()");
    }
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ─── Part 3: Different Wallet Warning ───

console.log("\n═══ Part 3: Different Wallet Warning ═══\n");

{
  // Generate two different wallet keys
  const walletKey1 = generatePrivateKey();
  const walletKey2 = generatePrivateKey();
  const account1 = privateKeyToAccount(walletKey1);
  const account2 = privateKeyToAccount(walletKey2);

  console.log(`  Wallet 1: ${account1.address}`);
  console.log(`  Wallet 2: ${account2.address}`);

  const testPort = 19402 + Math.floor(Math.random() * 1000);
  console.log(`  Using test port: ${testPort}`);

  try {
    // Start proxy with wallet 1
    console.log("\n  Starting proxy with wallet 1...");
    const proxy1 = await startProxy({
      walletKey: walletKey1,
      port: testPort,
      onReady: (port) => console.log(`  Proxy 1 ready on port ${port}`),
    });

    assert(proxy1.walletAddress === account1.address, `Proxy 1 wallet: ${proxy1.walletAddress}`);

    // Start proxy with wallet 2 on same port — should reuse but return existing wallet
    console.log("\n  Starting proxy with wallet 2 (should reuse existing with wallet 1)...");
    const proxy2 = await startProxy({
      walletKey: walletKey2,
      port: testPort,
      onReady: (port) => console.log(`  Proxy 2 ready on port ${port}`),
    });

    // The reused proxy should report the EXISTING wallet address, not the new one
    assert(
      proxy2.walletAddress === account1.address,
      `Reused proxy reports existing wallet: ${proxy2.walletAddress}`,
    );

    // Cleanup
    await proxy2.close();
    await proxy1.close();
    console.log("  Proxies closed.");
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ─── Summary ───

console.log("\n═══════════════════════════════════");
console.log(`  ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
