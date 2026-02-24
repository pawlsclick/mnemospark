# Cursor Dev: Client /cloud ls, download, delete

**ID:** cursor-dev-14  
**Repo:** mnemospark  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). Client features (11–14) are in this repo (plugin/client). Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Implement the **mnemospark-client** and **mnemospark-proxy** flows for `/cloud ls`, `/cloud download`, and `/cloud delete`. Each command takes `--wallet-address <addr>` and `--object-key <s3-key>`. Proxy calls backend GET/POST /storage/ls, /storage/download, /storage/delete respectively; client prints user-facing messages per [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) (ls: object and size; download: "File \<s3-key\> downloaded"; delete: "File \<s3-key\> deleted"). For download, proxy receives presigned URL or stream and writes file to disk then returns to client. Depends on backend storage Lambdas (cursor-dev-05, 06, 07).

## References

- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — ls, download, delete commands (client, proxy, backend)
- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) §6, §7

## Cloud Agent

- **Install (idempotent):** `npm install` (or project equivalent).
- **Start (if needed):** None or mock backend.
- **Secrets:** API base URL, x-api-key for proxy.
- **Acceptance criteria (checkboxes):**
  - [ ] `/cloud ls --wallet-address <addr> --object-key <s3-key>`: proxy calls GET or POST /storage/ls; client prints message with object/key and size (e.g. "`<object-id>` with `<s3-key>` is `<size-bytes>` in `<bucket-name>`").
  - [ ] `/cloud download --wallet-address <addr> --object-key <s3-key>`: proxy calls /storage/download; if presigned URL, proxy GETs URL and writes file to disk; client prints "File `<s3-key>` downloaded".
  - [ ] `/cloud delete --wallet-address <addr> --object-key <s3-key>`: proxy calls POST or DELETE /storage/delete; client prints "File `<s3-key>` deleted".
  - [ ] All commands fail gracefully on backend error; proxy forwards errors to client.
  - [ ] Unit or integration tests (mock or real backend).

## Task string (optional)

Work only in this repo; do not use BlockRun/ClawRouter or any other repo. Implement /cloud ls, /cloud download, /cloud delete: args --wallet-address and --object-key; proxy calls /storage/ls, /storage/download, /storage/delete; client messages per full_workflow. Download: handle presigned URL and write file. Acceptance: [ ] ls; [ ] download; [ ] delete; [ ] error handling; [ ] tests.
