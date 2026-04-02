import { describe, expect, it } from "vitest";

import { parseCloudArgs } from "./cloud-command.js";

const WALLET = "0x24bB8B93fbC0B87e4b0303aA1F71C51941726424";
const OID = "1774816919700-d7bb86a8fab10e34";
const HASH = "9fec74112e2fc5cf0f569b14276c11c62036f4ca57fb5b01c551336876bdd299";
const GB = "0.035035805";

describe("parseCloudArgs", () => {
  it("returns arg-parse-failure when price-storage has no flags", () => {
    const r = parseCloudArgs("price-storage");
    expect(r.mode).toBe("arg-parse-failure");
    if (r.mode !== "arg-parse-failure") return;
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("returns backup-invalid-async when orchestrator is set without --async", () => {
    const r = parseCloudArgs(
      "backup /tmp/mnemospark-backup-src --name fixture.txt --orchestrator inline",
    );
    expect(r.mode).toBe("backup-invalid-async");
  });

  it("returns backup-invalid-async when only --timeout-seconds is set without async", () => {
    const r = parseCloudArgs(
      "backup /tmp/mnemospark-backup-src --name fixture.txt --timeout-seconds 60",
    );
    expect(r.mode).toBe("backup-invalid-async");
  });

  it("returns payment-settle-invalid when --renewal is combined with --quote-id", () => {
    const r = parseCloudArgs(
      "payment-settle --renewal --quote-id deadbeef-0000-0000-0000-000000000000 --wallet-address 0xabc --object-key my-object-key",
    );
    expect(r.mode).toBe("payment-settle-invalid");
  });

  it("accepts payment-settle renewal + object-key after parse", () => {
    const r = parseCloudArgs(
      "payment-settle --renewal --object-key my-object-key --wallet-address 0x1234567890123456789012345678901234567890",
    );
    expect(r.mode).toBe("payment-settle");
    if (r.mode !== "payment-settle") return;
    expect(r.paymentSettleRequest.renewal).toBe(true);
    expect(r.paymentSettleRequest.object_key).toBe("my-object-key");
  });

  it("accepts upload when async flags are valid", () => {
    const r = parseCloudArgs(
      "upload --quote-id q --wallet-address 0xabc --object-id o --object-id-hash h --async --orchestrator inline",
    );
    expect(r.mode).toBe("upload");
    if (r.mode !== "upload") return;
    expect(r.async).toBe(true);
  });

  it("returns upload-invalid-async when --orchestrator is set without --async", () => {
    const r = parseCloudArgs(
      "upload --quote-id q --wallet-address 0xabc --object-id o --object-id-hash h --orchestrator inline",
    );
    expect(r.mode).toBe("upload-invalid-async");
  });

  it("returns price-storage-resolve-hash when object-id-hash is omitted", () => {
    const r = parseCloudArgs(
      `price-storage wallet:${WALLET} object:${OID} gb:${GB} provider:aws region:us-east-1`,
    );
    expect(r.mode).toBe("price-storage-resolve-hash");
    if (r.mode !== "price-storage-resolve-hash") return;
    expect(r.priceStoragePartial.wallet_address).toBe(WALLET);
    expect(r.priceStoragePartial.object_id).toBe(OID);
    expect(r.priceStoragePartial.gb).toBeCloseTo(0.035035805);
  });

  it("returns price-storage when object-id-hash is present", () => {
    const r = parseCloudArgs(
      `price-storage wallet:${WALLET} object:${OID} hash:${HASH} gb:${GB} provider:aws region:us-east-1`,
    );
    expect(r.mode).toBe("price-storage");
    if (r.mode !== "price-storage") return;
    expect(r.priceStorageRequest.object_id_hash).toBe(HASH);
  });
});
