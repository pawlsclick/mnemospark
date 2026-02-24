# Cursor Dev: Client /cloud price-storage

**ID:** cursor-dev-12  
**Repo:** mnemospark  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). Client features (11–14) are in this repo (plugin/client). Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Implement the **mnemospark-client** and **mnemospark-proxy** flow for `/cloud price-storage`: client accepts args `--wallet-address`, `--object-id`, `--object-id-hash`, `--gb`, `--provider`, `--region`; proxy forwards to backend `POST /price-storage` with JSON body; client receives response (timestamp, quote_id, storage_price, addr, object_id, object_id_hash, object_size_gb, provider, location); client writes quote to object log and prints user message including "If you accept this quote run the command /cloud upload --quote-id \<quote-id\> ...". On error print "Cannot price storage". Depends on backend POST /price-storage (cursor-dev-03) and API base URL config.

## References

- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — price-storage command (client, proxy, backend)
- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) §5.3 (request/response)

## Cloud Agent

- **Install (idempotent):** `npm install` (or project equivalent).
- **Start (if needed):** None (or mock backend for tests).
- **Secrets:** API base URL and x-api-key for proxy→backend (e.g. in Cursor Settings → Cloud Agents → Secrets or config).
- **Acceptance criteria (checkboxes):**
  - [ ] Client parses `/cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider <provider> --region <region>`.
  - [ ] Proxy sends POST /price-storage with JSON body per API spec §5.3; includes x-api-key header.
  - [ ] Client writes response to object log (timestamp, quote_id, storage_price, etc.); prints quote valid 1 hour and storage price; prints next-step message with /cloud upload command.
  - [ ] On error (e.g. network, 4xx/5xx): print "Cannot price storage"; fail gracefully.
  - [ ] 402/payment headers: conform to API spec (v2 names; legacy accepted) when proxy handles 402 from backend.
  - [ ] Unit or integration test (with mock or real backend).

## Task string (optional)

Work only in this repo; do not use BlockRun/ClawRouter or any other repo. Implement /cloud price-storage: client args → proxy → POST /price-storage; client writes quote to object log and prints quote + next-step /cloud upload message. Ref: full_workflow and API spec §5.3. Acceptance: [ ] args and request; [ ] object log; [ ] user messages; [ ] error handling; [ ] test.
