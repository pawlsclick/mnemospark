# Auth Without API Key: Wallet Proof Spec

**Version:** 1.0  
**Last updated:** February 2026  
**Status:** Design spec — implement via new Cursor Dev feature files derived from this doc.

This spec defines how to remove the shared backend API key from the client-side proxy and replace it with **wallet-proof authentication**. It aligns with the ideal solution: no BFF, no shared key on client; CloudFront + WAF + Lambda authorizer; wallet proof optional for price-storage and required for upload / ls / download / delete.

**Design patterns:** Follow the structure and conventions of [features_cursor_dev/README.md](features_cursor_dev/README.md). New cursor-dev feature files for this work **must be created from this spec**; do **not** modify existing files in `features_cursor_dev/`. This document is the single source of truth for the auth change; it references existing cursor-dev IDs only for dependencies and ordering.

---

## 1. Goals and constraints

- **No shared API key on the client.** The proxy runs on the user's machine; it must not hold `MNEMOSPARK_BACKEND_API_KEY` (or any `x-api-key`) for the mnemospark backend.
- **Payment workflows** (upload, and any paid ls/download) already require wallet signature (x402 / EIP-712). Auth for those endpoints can be “valid payment or valid wallet proof.”
- **price-storage** is the only call that does not require the user’s wallet for payment; it only needs protection from abuse. Options: allow unauthenticated with strict WAF/rate limit, or add **optional** wallet proof for per-wallet rate limiting.
- **upload, ls, download, delete** will **require** wallet proof so the backend can enforce “only the wallet owner can access this wallet’s data.”
- **Edge:** Requests go through **CloudFront** (optional) and **WAF**; security is enforced at WAF + API Gateway (Lambda authorizer) + Lambda business logic. No dependency on a secret in the client.

---

## 2. Wallet proof: definition and format

### 2.1 Purpose

- **Wallet proof** = cryptographic proof that the request is authorized by the holder of `wallet_address`. The proxy signs a payload with the user’s wallet private key; the backend (or Lambda authorizer) verifies the signature and ensures the signer matches `wallet_address` in the request.
- Used for: optional rate limiting per wallet on price-storage; required auth for upload, ls, download, delete.

### 2.2 Header and payload

- **Header name (v2):** `X-Wallet-Signature`  
  **Legacy (accepted):** `x-wallet-signature`.
- **Header value:** Base64-encoded JSON object:
  ```json
  {
    "payloadB64": "<base64 of canonical request payload>",
    "signature": "<hex signature from signTypedData or personal_sign>",
    "address": "<wallet address that signed>"
  }
  ```

  - `payloadB64`: base64 of the **canonical request payload** (see below).
  - `signature`: EIP-712 or `personal_sign` output (hex string, with or without `0x`).
  - `address`: signer’s address (so backend can verify without recovering from signature if desired).

### 2.3 Canonical request payload (signed by the wallet)

The payload that the client signs **must** be deterministic and include enough context to prevent replay and bind the signature to this request. Define:

- **MnemosparkRequest** (EIP-712 typed data):
  - `method`: string (e.g. `"POST"`, `"GET"`).
  - `path`: string (e.g. `"/price-storage"`, `"/storage/upload"`). Must match the actual path (no query string in path; query params are not signed in this version to keep authorizer simple).
  - `walletAddress`: string (Ethereum address, same as in body/query).
  - `nonce`: string (hex, 32 bytes recommended, e.g. from `crypto.getRandomValues`).
  - `timestamp`: string (Unix seconds; e.g. `Math.floor(Date.now()/1000).toString()`).

- **Domain for EIP-712:**
  - `name`: `"Mnemospark"`.
  - `version`: `"1"`.
  - `chainId`: `8453` (Base mainnet) or `84532` (Base Sepolia) — should match the network the backend expects for payments.
  - `verifyingContract`: a fixed address (e.g. backend’s “verifying contract” or a well-known constant like `0x0000000000000000000000000000000000000001` for request-signing only). Document this in the API spec so backend and client agree.

- **Signing:** Use `signTypedData` (viem/accounts) with the wallet private key, the domain above, `primaryType: "MnemosparkRequest"`, and the message. Encode the **message** (or a deterministic JSON string of the message fields) as the **payload** that gets base64’d into `payloadB64`. Backend must reconstruct the same message and verify `signTypedData` (ecrecover) or accept a provided `address` and verify signature.

- **Replay:** Backend (or authorizer) should reject if `timestamp` is too old (e.g. > 5 minutes). Optional: store `nonce` per wallet with short TTL to reject duplicate nonces.

### 2.4 When wallet proof is sent

| Endpoint                    | Wallet proof | Notes                                                                                 |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| POST /price-storage         | **Optional** | If present: verify and rate limit per wallet. If absent: allow, strict IP rate limit. |
| POST /storage/upload        | **Required** | Payment (PAYMENT-SIGNATURE) is also required; wallet proof proves identity.           |
| GET/POST /storage/ls        | **Required** | Proves caller owns `wallet_address`.                                                  |
| GET/POST /storage/download  | **Required** | Same.                                                                                 |
| POST/DELETE /storage/delete | **Required** | Same.                                                                                 |

- **upload:** Backend may treat a valid `PAYMENT-SIGNATURE` as sufficient proof of wallet ownership for that request, or require both PAYMENT-SIGNATURE and X-Wallet-Signature. This spec **requires** X-Wallet-Signature for upload so that auth is uniform (one mechanism for all storage endpoints).
- **price-storage:** Client/proxy **should** send X-Wallet-Signature when the user’s wallet is available (same wallet as in the body); backend accepts with or without it and applies the appropriate rate limit.

---

## 3. Backend changes

### 3.1 API Gateway and authorizer

- **Remove** usage-plan API key requirement: do **not** set `ApiKeyRequired: true` on methods. Remove dependency on `x-api-key` header for auth.
- **Add** a **Lambda authorizer** (request or token type, as per API Gateway support):
  - **Input:** Request event (method, path, headers, optionally body/query for wallet_address).
  - **Behavior:**
    - **POST /price-storage:**
      - If `X-Wallet-Signature` (or legacy) is present: verify signature; if valid, return allow + optional context (e.g. `walletAddress`); if invalid, return deny.
      - If header absent: return allow (no context). Downstream WAF/rate limit applies by IP.
    - **POST /storage/upload, GET/POST /storage/ls, /storage/download, /storage/delete:**
      - Require `X-Wallet-Signature`. Verify signature; ensure signer address matches `wallet_address` in body or query. If valid, return allow + context (walletAddress); else deny.
  - **Output:** IAM policy allow/deny + context (e.g. `walletAddress`) for Lambda integration.
- **CORS:** Allow headers must include `X-Wallet-Signature` (and legacy), `PAYMENT-SIGNATURE`, `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `Idempotency-Key`, `Content-Type`. **Remove** `x-api-key` from required or allowed if it is no longer used.
- **Request validation:** Keep body/query validation; do not require `x-api-key` in headers.

### 3.2 WAF and rate limiting

- **WAF:** Keep managed rule groups (e.g. Core, Known Bad Inputs). Add or tune **rate-based rules**:
  - **price-storage:** Per-IP rate limit (e.g. N requests per 5 minutes per IP). If authorizer passes wallet context, optionally add a second rule: per-wallet rate limit (using a custom header or authorizer context if WAF can key off it; otherwise enforce in Lambda).
  - **Storage paths:** Stricter per-IP limit if desired; primary auth is wallet proof.
- **CloudFront:** No change to “proxy sends requests through CloudFront”; if CloudFront is in front, WAF can be attached to CloudFront or to API Gateway per [internet_facing_API.md](infrastructure_design/internet_facing_API.md).

### 3.3 Lambda functions (business logic)

- **price-storage Lambda:** No change to request body (wallet_address, object_id, etc.). Do not read or validate `x-api-key`. Optionally read authorizer context (walletAddress) for logging/rate limiting.
- **upload Lambda:** Already validates payment (EIP-712). In addition, require that the request was authorized by the authorizer with context `walletAddress` matching body `wallet_address`. Do not use `x-api-key`.
- **ls / download / delete Lambdas:** Require authorizer context `walletAddress` and ensure it matches `wallet_address` in query/body. Deny if mismatch. Do not use `x-api-key`.

### 3.4 Backend API spec (mnemospark_backend_api_spec.md) — content to add/change

- **§1 Base URL and authentication:** Replace “API key (proxy/server-to-backend)” with:
  - **Authentication:** Wallet proof (no shared API key).
  - **Header:** `X-Wallet-Signature` (v2) or `x-wallet-signature` (legacy): base64-encoded JSON with `payloadB64`, `signature`, `address`.
  - **When required:** Required for POST /storage/upload, GET/POST /storage/ls, /storage/download, /storage/delete. Optional for POST /price-storage (if present, verified and used for per-wallet rate limiting).
  - **Payload:** EIP-712 typed data `MnemosparkRequest` (method, path, walletAddress, nonce, timestamp); domain name `Mnemospark`, version `1`, chainId 8453/84532, fixed verifyingContract.
  - **Replay:** Backend rejects if timestamp older than 5 minutes (configurable).
- **CORS:** Update allowed headers list: include `X-Wallet-Signature`, remove requirement for `x-api-key`.

---

## 4. Proxy changes (mnemospark repo)

### 4.1 Config and env

- **Remove** use of `MNEMOSPARK_BACKEND_API_KEY` and legacy `MNEMOSPARK_API_KEY` for the mnemospark backend. Do not send `x-api-key` on any request to the mnemospark backend.
- **Keep** `MNEMOSPARK_BACKEND_API_BASE_URL` (or equivalent) so the proxy knows where to forward requests.
- **Secrets:** No backend API key. Wallet key continues to come from `BLOCKRUN_WALLET_KEY` or saved file (`~/.openclaw/blockrun/wallet.key`); the proxy uses it for x402 (BlockRun) and for signing wallet proof for the mnemospark backend.

### 4.2 Request signing module

- **New module** (e.g. `src/mnemospark-request-sign.ts` or under `src/cloud-*.ts`): Given `method`, `path`, `walletAddress`, and wallet private key, build the canonical EIP-712 payload (with nonce and timestamp), sign with `signTypedData`, and return the value for `X-Wallet-Signature` (base64 JSON with `payloadB64`, `signature`, `address`). Reuse same wallet resolution as x402 (viem, same key).
- **Tests:** Unit tests for payload construction and that a signed header verifies correctly (e.g. with a small verification helper or mock).

### 4.3 Forwarding to backend

- **POST /price-storage:**
  - Build request body as today (wallet_address, object_id, object_id_hash, gb, provider, region).
  - **Optional:** If proxy has wallet key and body.wallet_address matches proxy’s wallet, add `X-Wallet-Signature` using the new signing module (method `POST`, path `/price-storage`, walletAddress from body).
  - Do **not** send `x-api-key`.
  - Send request to `MNEMOSPARK_BACKEND_API_BASE_URL/price-storage`.

- **POST /storage/upload:**
  - Build body and payment headers as today.
  - **Required:** Add `X-Wallet-Signature` (method `POST`, path `/storage/upload`, walletAddress from body).
  - Do not send `x-api-key`.

- **GET/POST /storage/ls, /storage/download, /storage/delete:**
  - **Required:** Add `X-Wallet-Signature` with method, path (e.g. `/storage/ls`), and wallet_address from query or body.
  - Do not send `x-api-key`.

### 4.4 Error handling

- If backend returns 401/403 (e.g. authorizer deny or Lambda reject): surface to client as “unauthorized” or “wallet proof invalid” as appropriate. Do not retry with an API key.
- Remove any logic that “requires MNEMOSPARK_BACKEND_API_KEY” for the proxy to start or forward; replace with “wallet required for storage endpoints” (wallet key must be present to sign).

---

## 5. Client changes (mnemospark repo)

- **Config / secrets:** Remove any mention of “API base URL and x-api-key” for proxy→backend. User config is: API base URL (or default), and wallet (already required for upload and for BlockRun). No backend API key to set.
- **price-storage:** No change to user-facing args. Proxy adds optional wallet signature when wallet is available.
- **upload / ls / download / delete:** No change to user-facing args. Proxy adds required wallet signature; wallet must be available (already is for upload; ensure same for ls/download/delete).
- **Error messages:** If backend returns 401/403, show clear message (e.g. “Wallet signature invalid or expired”; “Cannot price storage” / “Cannot upload” etc. as today).

---

## 6. Cursor Dev feature files to create (from this spec)

New feature files **should be created** in a follow-up (not in this spec’s scope) and **must not** modify existing files under `.company/features_cursor_dev/`. The following table is the recommended breakdown for implementation; each row can become one cursor-dev-style doc (ID, Repo, Scope, References, Cloud Agent, Task string).

| Suggested ID | Repo               | Scope summary                                                                                                                                                |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **auth-01**  | mnemospark-backend | Lambda authorizer: validate X-Wallet-Signature; allow/deny + context; price-storage optional, storage paths required.                                        |
| **auth-02**  | mnemospark-backend | API Gateway: remove API key requirement; attach Lambda authorizer to routes; update CORS (X-Wallet-Signature, no x-api-key).                                 |
| **auth-03**  | mnemospark-backend | WAF: rate limits for /price-storage (per-IP; optional per-wallet if authorizer exposes it).                                                                  |
| **auth-04**  | mnemospark-backend | Lambdas (price-storage, upload, ls, download, delete): stop reading x-api-key; enforce authorizer context walletAddress where required.                      |
| **auth-05**  | mnemospark         | Request signing module: EIP-712 MnemosparkRequest, X-Wallet-Signature header builder, tests.                                                                 |
| **auth-06**  | mnemospark         | Proxy: remove backend API key from config and forwarding; add X-Wallet-Signature to all mnemospark backend calls (optional price-storage, required storage). |
| **auth-07**  | mnemospark         | Client/docs: remove API key from secrets/docs; update error handling for 401/403.                                                                            |

**Dependencies:**

- auth-01 before auth-02 (authorizer must exist before attaching).
- auth-02 and auth-04: coordinate so Gateway and Lambdas switch in one coherent change or in ordered steps.
- auth-05 before auth-06 (signing module used by proxy).
- auth-06 depends on backend already accepting wallet proof (auth-01, auth-02, auth-04).

**References for new feature files:**

- This spec: [auth_no_api_key_wallet_proof_spec.md](auth_no_api_key_wallet_proof_spec.md).
- [mnemospark_backend_api_spec.md](mnemospark_backend_api_spec.md) §1 (after update), §2 (x402), §5.3, §6–§8.
- [mnemospark_full_workflow.md](mnemospark_full_workflow.md) — price-storage, upload, ls, download, delete.
- [infrastructure_design/internet_facing_API.md](infrastructure_design/internet_facing_API.md) — Lambda authorizer, WAF, CloudFront.
- [clawrouter_wallet_gen_payment_eip712.md](clawrouter_wallet_gen_payment_eip712.md) — EIP-712 patterns (same viem/accounts usage).
- Existing cursor-dev: [cursor-dev-08-api-gateway-auth.md](features_cursor_dev/cursor-dev-08-api-gateway-auth.md) (current API Gateway; auth-02 replaces API key with authorizer), [cursor-dev-12](features_cursor_dev/cursor-dev-12-client-price-storage.md), [cursor-dev-13](features_cursor_dev/cursor-dev-13-client-upload.md), [cursor-dev-14](features_cursor_dev/cursor-dev-14-client-ls-download-delete.md) for client/proxy flow; [cursor-dev-15](features_cursor_dev/cursor-dev-15-cfn-waf.md) for WAF.

---

## 7. Acceptance criteria (summary)

- **Backend:** No `x-api-key` required; Lambda authorizer validates X-Wallet-Signature where required; price-storage accepts requests with or without wallet proof; storage endpoints require valid wallet proof and authorizer passes walletAddress; WAF rate limits price-storage; Lambdas use authorizer context and do not use API key.
- **Proxy:** Does not read or send MNEMOSPARK_BACKEND_API_KEY; sends X-Wallet-Signature (optional for price-storage, required for upload/ls/download/delete); uses new signing module with wallet key.
- **Client:** No backend API key in config or docs; errors for 401/403 are clear.
- **Docs:** mnemospark_backend_api_spec.md §1 updated to describe wallet-proof auth and CORS without x-api-key.

---

## 8. References

- [mnemospark_backend_api_spec.md](mnemospark_backend_api_spec.md) — API contract; §1 to be updated.
- [mnemospark_full_workflow.md](mnemospark_full_workflow.md) — Commands and flows.
- [infrastructure_design/internet_facing_API.md](infrastructure_design/internet_facing_API.md) — CloudFront, WAF, API Gateway, Lambda authorizer.
- [clawrouter_wallet_gen_payment_eip712.md](clawrouter_wallet_gen_payment_eip712.md) — EIP-712 and wallet usage.
- [features_cursor_dev/README.md](features_cursor_dev/README.md) — Conventions and repo mapping; do not change existing feature files.
