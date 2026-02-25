# Cursor Dev: Client/docs — remove API key, error handling for 401/403

**ID:** auth-07  
**Repo:** mnemospark  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). Client and docs are in this repo. Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

**Config/secrets:** Remove any mention of "API base URL and x-api-key" for proxy→backend from user-facing config, env docs, and secrets guidance. User config is: API base URL (or default) and wallet (already required for upload and BlockRun). No backend API key to set. **User-facing args:** price-storage, upload, ls, download, delete unchanged; proxy adds wallet signature (auth-06). **Error messages:** When backend returns 401/403, show clear message (e.g. "Wallet signature invalid or expired"; "Cannot price storage" / "Cannot upload" etc. as today). **Docs:** Update mnemospark_backend_api_spec.md §1 (in this repo if present, or document the required content): authentication = wallet proof (no shared API key); header X-Wallet-Signature; when required (storage) vs optional (price-storage); CORS without x-api-key. Ref: [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §4.4, §5, §3.4.

## References

- [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §4.4 (error handling), §5 (client), §3.4 (API spec)
- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) — §1 to update (if in repo) or document required wording
- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — user commands

## Cloud Agent

- **Install (idempotent):** None.
- **Start (if needed):** None.
- **Secrets:** None (docs say no backend API key).
- **Acceptance criteria (checkboxes):**
  - [ ] Config/docs: no reference to setting or passing MNEMOSPARK_BACKEND_API_KEY or x-api-key for proxy→backend; user config = API base URL + wallet.
  - [ ] Client error handling: 401/403 from backend produce clear user message (e.g. "Wallet signature invalid or expired", or existing "Cannot price storage" / "Cannot upload" etc. as appropriate).
  - [ ] README or env docs updated: list required env (e.g. MNEMOSPARK_BACKEND_API_BASE_URL, wallet); explicitly state no backend API key needed.
  - [ ] If mnemospark_backend_api_spec.md (or equivalent) lives in this repo: §1 updated with wallet-proof auth (no API key; X-Wallet-Signature; required vs optional; CORS without x-api-key). If spec lives in backend repo only, add a short note in this repo pointing to the spec and that auth is wallet proof.
  - [ ] No code paths that prompt for or validate backend API key for mnemospark.

## Task string (optional)

Work only in this repo. Remove API key from client config and docs: user config = API base URL + wallet; no backend API key. Error messages for 401/403: clear (e.g. wallet signature invalid/expired, Cannot price storage/upload). Update README/env docs and API spec §1 (if in repo) for wallet-proof auth and CORS. Ref: auth_no_api_key_wallet_proof_spec.md §4.4, §5, §3.4. Acceptance: [ ] no API key in config/docs; [ ] 401/403 messages; [ ] API spec §1 or note updated.
