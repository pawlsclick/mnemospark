# Cursor Dev: Lambda authorizer (X-Wallet-Signature)

**ID:** auth-01  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). This repo is mnemospark-backend. Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Implement a **Lambda authorizer** (request or token type) that validates the `X-Wallet-Signature` (or legacy `x-wallet-signature`) header. **POST /price-storage:** if header present, verify EIP-712 signature and return allow + context (e.g. `walletAddress`); if invalid, deny; if header absent, allow (no context). **POST /storage/upload, GET/POST /storage/ls, /storage/download, /storage/delete:** require the header; verify signature; ensure signer matches `wallet_address` in body or query; return allow + context (`walletAddress`) or deny. Payload format: base64 JSON with `payloadB64`, `signature`, `address`. Canonical payload = EIP-712 MnemosparkRequest (method, path, walletAddress, nonce, timestamp); domain name `Mnemospark`, version `1`, chainId 8453/84532; reject if timestamp older than 5 minutes. Output: IAM policy allow/deny + context for Lambda integration. Single source of truth: [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §2–§3.1.

## References

- [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §2 (header, payload, canonical request), §3.1 (authorizer behavior)
- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) §1 (to be updated with wallet proof)
- [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) — Lambda authorizer pattern

## Cloud Agent

- **Install (idempotent):** Runtime per backend (e.g. Node/Python); dependencies for EIP-712 / signature verification (e.g. viem, eth-sig-util, or equivalent).
- **Start (if needed):** None.
- **Secrets:** None required for authorizer logic (no API key).
- **Acceptance criteria (checkboxes):**
  - [ ] Lambda authorizer function exists; accepts API Gateway request/token event (method, path, headers, body/query for wallet_address).
  - [ ] **POST /price-storage:** If X-Wallet-Signature (or x-wallet-signature) present: verify signature; if valid return allow + context (walletAddress); if invalid return deny. If header absent: return allow with no wallet context.
  - [ ] **Storage paths** (upload, ls, download, delete): Require X-Wallet-Signature; verify signature; ensure signer address matches wallet_address in body/query; return allow + context (walletAddress) or deny.
  - [ ] Payload parsing: base64 JSON with payloadB64, signature, address; canonical payload = MnemosparkRequest (method, path, walletAddress, nonce, timestamp); replay check: reject if timestamp > 5 minutes old.
  - [ ] Output: IAM policy allow/deny + context key `walletAddress` when allowed.
  - [ ] Unit tests: valid/invalid signature, missing header (price-storage allow, storage deny), replay (old timestamp) rejected.
  - [ ] All taggable resources tagged with `Project: mnemospark` (or `Application: mnemospark`).

## Task string (optional)

Work only in this repo. Implement Lambda authorizer for X-Wallet-Signature: parse base64 JSON (payloadB64, signature, address); verify EIP-712 MnemosparkRequest; reject if timestamp > 5 min. POST /price-storage: optional header (if present verify; if absent allow). Storage paths: require header; verify; match wallet_address. Return IAM allow/deny + context walletAddress. Ref: auth_no_api_key_wallet_proof_spec.md §2–3.1. Acceptance: [ ] price-storage optional; [ ] storage required; [ ] replay rejected; [ ] tests.
