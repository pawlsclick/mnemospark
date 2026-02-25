# Cursor Dev: Lambdas — authorizer context, no x-api-key

**ID:** auth-04  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). This repo is mnemospark-backend. Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Update **price-storage, upload, ls, download, delete** Lambdas to **stop** reading or validating `x-api-key`. **price-storage:** no change to request body; optionally read authorizer context (`walletAddress`) for logging or per-wallet rate limiting. **upload:** require authorizer context `walletAddress` and ensure it matches body `wallet_address`; deny if mismatch; keep existing payment (EIP-712) validation. **ls, download, delete:** require authorizer context `walletAddress` and ensure it matches `wallet_address` in query/body; deny if mismatch. All storage Lambdas receive context from the Lambda authorizer (auth-01); do not use `x-api-key`. Coordinate with auth-02 so Gateway and Lambdas switch in one coherent change or ordered steps. Ref: [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §3.3.

## References

- [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §3.3 (Lambda business logic)
- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) — request/response; cursor-dev-03, 04, 05, 06, 07 for each Lambda

## Cloud Agent

- **Install (idempotent):** Per Lambda runtime (e.g. `pip install -r requirements.txt` or project equivalent).
- **Start (if needed):** None.
- **Secrets:** AWS credentials; no backend API key.
- **Acceptance criteria (checkboxes):**
  - [ ] **price-storage Lambda:** Does not read or validate x-api-key; request body unchanged (wallet_address, object_id, etc.); optionally reads authorizer context (walletAddress) for logging/rate limiting.
  - [ ] **upload Lambda:** Does not use x-api-key; requires authorizer context walletAddress; validates walletAddress matches body wallet_address; denies on mismatch; payment (EIP-712) validation unchanged.
  - [ ] **ls Lambda:** Does not use x-api-key; requires authorizer context walletAddress; validates match to wallet_address in query/body; denies on mismatch.
  - [ ] **download Lambda:** Same as ls.
  - [ ] **delete Lambda:** Same as ls.
  - [ ] Consistent error shape (e.g. 403) when wallet mismatch or missing context; per API spec §10.
  - [ ] Unit/integration tests updated: no API key; authorizer context passed through; mismatch returns 403.
  - [ ] All taggable resources tagged with `Project: mnemospark` (or `Application: mnemospark`).

## Task string (optional)

Work only in this repo. Update price-storage, upload, ls, download, delete Lambdas: remove x-api-key usage. price-storage: optional authorizer context for logging/rate limit. upload/ls/download/delete: require authorizer context walletAddress; match wallet_address in body/query; deny on mismatch. Ref: auth_no_api_key_wallet_proof_spec.md §3.3. Acceptance: [ ] no x-api-key; [ ] walletAddress enforced on storage; [ ] tests updated.
