# Cursor Dev: Proxy — remove API key, add X-Wallet-Signature

**ID:** auth-06  
**Repo:** mnemospark  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). Client features (11–14) and proxy are in this repo. Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

**Config/env:** Remove use of `MNEMOSPARK_BACKEND_API_KEY` and legacy `MNEMOSPARK_API_KEY`; do not send `x-api-key` on any request to the mnemospark backend. Keep `MNEMOSPARK_BACKEND_API_BASE_URL`. **Forwarding:** Use the request signing module (auth-05). **POST /price-storage:** build body as today; optionally if proxy has wallet key and body.wallet_address matches proxy wallet, add `X-Wallet-Signature` (method POST, path `/price-storage`, walletAddress from body); do not send x-api-key. **POST /storage/upload:** add **required** X-Wallet-Signature (method POST, path `/storage/upload`, walletAddress from body); do not send x-api-key. **GET/POST /storage/ls, /storage/download, /storage/delete:** add **required** X-Wallet-Signature with method, path, and wallet_address from query or body; do not send x-api-key. **Error handling:** If backend returns 401/403, surface as "unauthorized" or "wallet proof invalid"; do not retry with API key. Remove any logic that requires MNEMOSPARK_BACKEND_API_KEY for proxy to start; replace with "wallet required for storage endpoints" (wallet key must be present to sign). Depends on auth-05 (signing module) and backend accepting wallet proof (auth-01, auth-02, auth-04). Ref: [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §4.

## References

- [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §4 (proxy changes)
- [cursor-dev-auth-05-request-signing-module.md](cursor-dev-auth-05-request-signing-module.md) — signing module
- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — price-storage, upload, ls, download, delete flows
- [cursor-dev-12-client-price-storage.md](cursor-dev-12-client-price-storage.md), [cursor-dev-13-client-upload.md](cursor-dev-13-client-upload.md), [cursor-dev-14-client-ls-download-delete.md](cursor-dev-14-client-ls-download-delete.md) — proxy flows

## Cloud Agent

- **Install (idempotent):** `npm install` (or project equivalent).
- **Start (if needed):** None (or mock backend for tests).
- **Secrets:** `MNEMOSPARK_BACKEND_API_BASE_URL` (no API key).
- **Acceptance criteria (checkboxes):**
  - [ ] Proxy does not read or send `MNEMOSPARK_BACKEND_API_KEY` / `MNEMOSPARK_API_KEY`; no `x-api-key` on any mnemospark backend request.
  - [ ] POST /price-storage: body as today; optional X-Wallet-Signature when wallet key and body.wallet_address match; no x-api-key.
  - [ ] POST /storage/upload: required X-Wallet-Signature (POST, /storage/upload, walletAddress from body); no x-api-key.
  - [ ] GET/POST /storage/ls, /storage/download, /storage/delete: required X-Wallet-Signature with method, path, wallet_address from query/body; no x-api-key.
  - [ ] 401/403 from backend surfaced as "unauthorized" or "wallet proof invalid"; no retry with API key.
  - [ ] Proxy startup: no requirement for backend API key; "wallet required for storage endpoints" when wallet key missing and storage call attempted.
  - [ ] Unit or integration test: proxy forwards with X-Wallet-Signature (and without x-api-key); error handling for 401/403.
  - [ ] 402/payment headers unchanged (PAYMENT-SIGNATURE etc.) per API spec.

## Task string (optional)

Work only in this repo. Proxy: remove MNEMOSPARK_BACKEND_API_KEY; never send x-api-key. Add X-Wallet-Signature via auth-05 module: optional for POST /price-storage when wallet available; required for upload, ls, download, delete. Handle 401/403 as wallet proof invalid/unauthorized. Startup: wallet required for storage, not API key. Ref: auth_no_api_key_wallet_proof_spec.md §4. Depends on auth-05. Acceptance: [ ] no API key; [ ] X-Wallet-Signature per endpoint; [ ] error handling; [ ] tests.
