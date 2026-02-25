# Cursor Dev: API Gateway — remove API key, attach Lambda authorizer, CORS

**ID:** auth-02  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). This repo is mnemospark-backend. Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Update API Gateway (CloudFormation or SAM) to **remove** API key requirement: do not set `ApiKeyRequired: true` on methods; remove dependency on `x-api-key` for auth. **Attach** the Lambda authorizer (auth-01) to the API: configure authorizer resource and associate with routes (price-storage, storage/upload, storage/ls, storage/download, storage/delete). **CORS:** allowed headers must include `X-Wallet-Signature`, `x-wallet-signature`, `PAYMENT-SIGNATURE`, `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `Idempotency-Key`, `Content-Type`; **remove** `x-api-key` from required or allowed. Request validation: keep body/query validation; do not require `x-api-key` in headers. Depends on auth-01 (authorizer Lambda must exist). Ref: [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §3.1; existing API Gateway from cursor-dev-08.

## References

- [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §3.1 (API Gateway, authorizer, CORS)
- [cursor-dev-08-api-gateway-auth.md](cursor-dev-08-api-gateway-auth.md) — current API Gateway (auth-02 replaces API key with authorizer)
- [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) — API Gateway, Lambda authorizer

## Cloud Agent

- **Install (idempotent):** AWS CLI; SAM CLI if using SAM.
- **Start (if needed):** None.
- **Secrets (Cursor Settings → Cloud Agents → Secrets):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- **Acceptance criteria (checkboxes):**
  - [ ] API key requirement removed: `ApiKeyRequired: false` (or not set) on all relevant methods; no usage plan required for auth.
  - [ ] Lambda authorizer (auth-01) attached to API Gateway; authorizer invoked for POST /price-storage, POST /storage/upload, GET/POST /storage/ls, /storage/download, /storage/delete.
  - [ ] CORS configured: allowed headers include `X-Wallet-Signature`, `x-wallet-signature`, `PAYMENT-SIGNATURE`, `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `Idempotency-Key`, `Content-Type`; `x-api-key` not required or in allow list.
  - [ ] Request validation unchanged for body/query; no header validation for x-api-key.
  - [ ] Template validates and stack deploys (or dry-run) without errors.
  - [ ] All taggable resources tagged with `Project: mnemospark` (or `Application: mnemospark`).

## Task string (optional)

Work only in this repo. Update API Gateway: remove API key requirement; attach Lambda authorizer (auth-01) to price-storage and storage routes. CORS: allow X-Wallet-Signature, x-wallet-signature, PAYMENT-\*, Idempotency-Key, Content-Type; remove x-api-key. Ref: auth_no_api_key_wallet_proof_spec.md §3.1. Depends on auth-01. Acceptance: [ ] no API key; [ ] authorizer attached; [ ] CORS updated; [ ] template validates and deploys.
