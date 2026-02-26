import { describe, expect, it } from "vitest";

import { normalizeBackendAuthFailure } from "./proxy.js";

describe("normalizeBackendAuthFailure", () => {
  it("maps generic 401 backend failures to unauthorized", () => {
    const normalized = normalizeBackendAuthFailure(401, '{"message":"denied"}');

    expect(normalized).toEqual({
      status: 401,
      contentType: "application/json",
      bodyText: JSON.stringify({
        error: "unauthorized",
        message: "unauthorized",
      }),
    });
  });

  it("maps signature-related 403 failures to wallet proof invalid", () => {
    const normalized = normalizeBackendAuthFailure(403, '{"error":"signature expired"}');

    expect(normalized).toEqual({
      status: 403,
      contentType: "application/json",
      bodyText: JSON.stringify({
        error: "wallet_proof_invalid",
        message: "wallet proof invalid",
      }),
    });
  });

  it("does not change non-auth failures", () => {
    expect(normalizeBackendAuthFailure(402, '{"error":"payment required"}')).toBeUndefined();
  });
});
