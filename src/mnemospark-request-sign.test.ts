import { describe, expect, it } from "vitest";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BASE_SEPOLIA_CHAIN_ID,
  MNEMOSPARK_REQUEST_TYPES,
  createMnemosparkRequestDomain,
  createMnemosparkRequestPayload,
  createWalletSignatureHeaderValue,
  decodeWalletSignatureHeaderValue,
  decodeWalletSignaturePayload,
} from "./mnemospark-request-sign.js";

const TEST_PRIVATE_KEY = `0x${"9".repeat(64)}` as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

describe("mnemospark request signing", () => {
  it("builds deterministic canonical payload", () => {
    const fixedNonce = `0x${"ab".repeat(32)}` as const;
    const fixedTimestamp = "1735689600";

    const payload = createMnemosparkRequestPayload(
      " post ",
      "/storage/upload?object_id=abc#fragment",
      TEST_ACCOUNT.address.toLowerCase(),
      { nonce: fixedNonce, timestamp: fixedTimestamp },
    );

    expect(payload).toEqual({
      method: "POST",
      path: "/storage/upload",
      walletAddress: TEST_ACCOUNT.address,
      nonce: fixedNonce,
      timestamp: fixedTimestamp,
    });
  });

  it("creates a signed X-Wallet-Signature header that verifies", async () => {
    const fixedNonce = `0x${"cd".repeat(32)}` as const;
    const fixedTimestamp = "1735689601";

    const headerValue = await createWalletSignatureHeaderValue(
      "POST",
      "https://api.mnemospark.dev/storage/ls?wallet_address=ignored-in-path",
      TEST_ACCOUNT.address,
      TEST_PRIVATE_KEY,
      {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        nonce: fixedNonce,
        timestamp: fixedTimestamp,
      },
    );

    const headerEnvelope = decodeWalletSignatureHeaderValue(headerValue);
    const payload = decodeWalletSignaturePayload(headerEnvelope.payloadB64);

    expect(headerEnvelope.address).toBe(TEST_ACCOUNT.address);
    expect(payload).toEqual({
      method: "POST",
      path: "/storage/ls",
      walletAddress: TEST_ACCOUNT.address,
      nonce: fixedNonce,
      timestamp: fixedTimestamp,
    });

    const signatureValid = await verifyTypedData({
      address: headerEnvelope.address,
      domain: createMnemosparkRequestDomain(BASE_SEPOLIA_CHAIN_ID),
      types: MNEMOSPARK_REQUEST_TYPES,
      primaryType: "MnemosparkRequest",
      message: {
        method: payload.method,
        path: payload.path,
        walletAddress: payload.walletAddress,
        nonce: payload.nonce,
        timestamp: BigInt(payload.timestamp),
      },
      signature: headerEnvelope.signature as `0x${string}`,
    });

    expect(signatureValid).toBe(true);
  });
});
