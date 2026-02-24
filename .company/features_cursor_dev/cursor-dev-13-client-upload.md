# Cursor Dev: Client /cloud upload

**ID:** cursor-dev-13  
**Repo:** mnemospark  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). Client features (11–14) are in this repo (plugin/client). Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Implement the **mnemospark-client** and **mnemospark-proxy** flow for `/cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <object-id> --object-id-hash <object-id-hash>`: proxy checks wallet USDC balance on Base; if sufficient, client signs EIP-712 payment authorization; proxy sends POST /storage/upload with quote, payment, and file (or presigned URL flow per API spec); client receives response, writes to object log, prints success message, and builds or documents cron for 30-day USDC payment (with note that backend deletes after 32-day deadline if unpaid). Use design pattern from `examples/object_storage_management_aws.py` for encryption (KEK/DEK) and bucket per wallet. Depends on backend POST /storage/upload (cursor-dev-04).

## References

- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — upload command (client, proxy, backend, cron hint)
- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) §6, §9 (upload, idempotency)
- [clawrouter_wallet_gen_payment_eip712.md](../clawrouter_wallet_gen_payment_eip712.md) — EIP-712 payment
- Design pattern: `examples/object_storage_management_aws.py`

## Cloud Agent

- **Install (idempotent):** `npm install` (and any Node deps for wallet/signing).
- **Start (if needed):** None or mock backend.
- **Secrets:** API base URL, x-api-key; wallet key path (e.g. ~/.openclaw/blockrun or ~/.openclaw/mnemospark/key); Base RPC if checking balance/signing.
- **Acceptance criteria (checkboxes):**
  - [ ] Client parses upload args (quote-id, wallet-address, object-id, object-id-hash); proxy checks USDC balance for quote amount; if insufficient, end with clear message.
  - [ ] Client signs EIP-712 payment authorization; proxy sends POST /storage/upload with quote, payment, and payload (inline or presigned URL per backend).
  - [ ] Client writes upload response to object log (quote_id, addr, trans_id, object_key, bucket, etc.); prints success message with object-id and object-key.
  - [ ] Cron or doc: 30-day payment reminder; note 32-day backend deadline if unpaid.
  - [ ] 402/payment headers: conform to API spec (v2 names; legacy accepted) when sending payment on retry.
  - [ ] Unit or integration test (mock or real backend).

## Task string (optional)

Work only in this repo; do not use BlockRun/ClawRouter or any other repo. Implement /cloud upload: quote-id, wallet, object-id, object-id-hash; balance check, EIP-712 sign, POST /storage/upload; object log and success message; cron/doc for 30-day payment. Ref: full_workflow, API spec §6/§9, object_storage_management_aws.py. Acceptance: [ ] args and balance check; [ ] payment sign and upload; [ ] object log and message; [ ] 30-day note; [ ] test.
