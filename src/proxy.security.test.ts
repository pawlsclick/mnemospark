import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { startProxy } from "./proxy.js";

describe("local proxy HTTP hardening", () => {
  const walletKey = generatePrivateKey();
  const port = 21000 + Math.floor(Math.random() * 2000);
  let handle: Awaited<ReturnType<typeof startProxy>>;

  beforeAll(async () => {
    handle = await startProxy({ walletKey, port });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("sends nosniff and no-store on /health", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    expect(r.ok).toBe(true);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("404 is generic without route enumeration in body", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/unknown-probe-path`);
    expect(r.status).toBe(404);
    const j = (await r.json()) as { error?: string; message?: string };
    expect(j.error).toBe("Not found");
    expect(j.message).toBeUndefined();
  });

  it("returns 403 wallet_proof_invalid for wrong wallet on price-storage", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/mnemospark/price-storage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: "0x0000000000000000000000000000000000000001",
        object_id: "o",
        object_id_hash: "h",
        gb: 1,
        provider: "p",
        region: "r",
      }),
    });
    expect(r.status).toBe(403);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const j = (await r.json()) as { error?: string };
    expect(j.error).toBe("wallet_proof_invalid");
  });
});
