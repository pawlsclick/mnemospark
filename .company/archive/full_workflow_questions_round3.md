# Critical Questions — Round 3 (Post-Review Updates)

**Purpose:** This document records the **review decisions** from round 2, the **documentation updates** applied, and the **design patterns** to use for the backend API and upload flow. It supersedes round 2 for “remaining blockers” and unknowns.

**Previous:** [full_workflow_questions_round2.md](./full_workflow_questions_round2.md)  
**Canonical workflow:** [mnemospark_full_workflow.md](./mnemospark_full_workflow.md)

---

## 1. Review decisions applied

| Item                                  | Decision                                                                                                                                                                                     | Applied in                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **B1. Encryption scope**              | Phase 2 only; PRD and feature specs updated to client-held encryption only (no Phase 1 SSE-S3/SSE-KMS).                                                                                      | PRD v2.1, features/README.md                                      |
| **B2. Backend USDC recipient wallet** | `0x47D241ae97fE37186AC59894290CA1c54c060A6c` (Base mainnet). Configure via e.g. env `MNEMOSPARK_RECIPIENT_WALLET`.                                                                           | mnemospark_full_workflow.md (housekeeping section)                |
| **U-API. REST contract**              | Use the **design pattern** from **examples/s3-cost-estimate-api**: Lambda + API Gateway, GET/POST with query or JSON body, JSON response, structured errors.                                 | See §2 below                                                      |
| **U-Upload. Upload flow**             | Use the **design pattern** from **examples/object_storage_management_aws.py**: bucket per wallet, client-held encryption (KEK/DEK), S3 put_object with ciphertext + wrapped DEK in metadata. | See §3 below                                                      |
| **U-Usage. Get storage usage**        | **Removed from MVP.** `/cloud ls` is sufficient; no separate “get storage usage” endpoint.                                                                                                   | PRD v2.1, full_workflow_questions round 1 answers                 |
| **slash_commands.md**                 | Document is **out of date**. Canonical source for commands and arguments is **mnemospark_full_workflow.md**.                                                                                 | slash_commands.md replaced with pointer to workflow               |
| **30 / 32 days**                      | **Confirmed:** Client pays every **30 days**; backend allows **2-day grace period** (32-day deadline before deletion).                                                                       | mnemospark_full_workflow.md (housekeeping + upload client step 4) |

---

## 2. Backend REST API design pattern (from examples/s3-cost-estimate-api)

Use this pattern for mnemospark-backend Lambda REST endpoints:

- **Infrastructure:** AWS SAM / CloudFormation: **API Gateway** (REST) + **Lambda**; one or more paths/methods per function (see `template.yaml`: `/estimate`, GET and POST).
- **Request:** Accept **query string** and/or **JSON body**; parse in handler (e.g. `parse_input(event)` merging `queryStringParameters` and parsed `body`).
- **Response:** Return `statusCode`, `headers` (e.g. `Content-Type: application/json`), and `body` as JSON string. Use consistent shapes (e.g. `{ estimatedCost, currency, region, ... }` for success; `{ error, message }` for 4xx/5xx).
- **Errors:** Catch validation/runtime errors; return 400 for bad request, 500 for internal error with a stable error structure.

**Apply to mnemospark-backend:** Define endpoints (e.g. `/price-storage`, `/upload`, `/ls`, `/download`, `/delete`) with the same pattern: Lambda handler, parse query/body, call business logic, return JSON. Auth/402 and payment verification sit in front of or inside these handlers per workflow.

**Reference:** [examples/s3-cost-estimate-api/](https://github.com/.../examples/s3-cost-estimate-api/) — `app.py` (lambda_handler, parse_input, response), `template.yaml` (Api events, Path, Method).

---

## 3. Upload flow design pattern (from examples/object_storage_management_aws.py)

Use this pattern for the upload path (client/proxy/backend → S3):

- **Bucket:** One bucket per wallet: `mnemospark-<wallet-id-hash>` with `wallet_hash(addr) = sha256(addr.encode()).hexdigest()[:16]`. Validate bucket name per S3 rules; create if not exists in the target region (`ensure_bucket_exists`).
- **Encryption:** **Client-held envelope encryption.** Client (or proxy on behalf of client) holds KEK (in `~/.openclaw/mnemospark/keys/<wallet_short_hash>.key`); generates DEK per object; encrypts payload with DEK (AES-GCM); wraps DEK with KEK; sends ciphertext + wrapped DEK (e.g. in S3 object metadata as `wrapped-dek`) to backend. Backend stores **only** ciphertext + metadata; never persists KEK.
- **S3 write:** `put_object(Bucket=..., Key=object_key, Body=ciphertext, Metadata={"wrapped-dek": wrapped_dek_b64})`. Key can be the object key returned to the user (e.g. filename or agreed key).
- **Logging:** Append to object log (e.g. CSV or JSONL) for audit; path per workflow (`~/.openclaw/mnemospark/object.log` for client-side object lifecycle).

**Apply to mnemospark-backend:** Backend receives either (a) encrypted payload + metadata from proxy (proxy-stream) or (b) validates payment then issues presigned URL; if (a), backend writes to S3 as in the example (bucket per wallet, key, Body=ciphertext, Metadata=wrapped_DEK). Use the same bucket naming and wallet_hash convention as in the example.

**Reference:** [examples/object_storage_management_aws.py](https://github.com/.../examples/object_storage_management_aws.py) — `upload_object`, `bucket_name`, `wallet_hash`, `ensure_bucket_exists`, `encrypt_with_dek`, `wrap_dek`, KEK load/store.

---

## 4. Documentation updates performed

- **mnemospark_full_workflow.md**
  - **Housekeeping:** Billing interval clarified: client charged every **30 days**; backend expects payment within **32 days** (2-day grace); if not confirmed by 32-day deadline, delete object. Recipient wallet set to `0x47D241ae97fE37186AC59894290CA1c54c060A6c` with config note (e.g. `MNEMOSPARK_RECIPIENT_WALLET`). Typo “Lamdba” → “Lambda.”
  - **Upload (client step 4):** Cron sends payment every **30 days**; backend deletes object after **32-day deadline** (30 + 2-day grace).
- **slash_commands.md**
  - Replaced with a short note that the file is **out of date** and that **[mnemospark_full_workflow.md](./mnemospark_full_workflow.md)** is the **canonical source** for commands and arguments. Listed command names (e.g. **upload** not “store”) and pointed to workflow for full args and behavior.
- **mnemospark_PRD.md**
  - **Changelog v2.1:** MVP encryption = Phase 2 only (client-held KEK/DEK); get storage usage removed from MVP; ls is sufficient.
  - **Goals:** Single “Ship MVP” goal with client-held encryption only; commands `/wallet`, `/cloud`; reference to full workflow.
  - **Requirements:** Must-have reframed as “MVP — Phase 2 encryption only”; R7 = no get storage usage, ls sufficient; R8 = wallet path resolution (blockrun first, else mnemospark/key/wallet.key), commands `/wallet`, `/cloud`; R10/R11 = MVP scope and encryption (client-held only); R12–R14 = renumbered nice-to-have. Removed open questions 3 and 4 (get storage usage, encryption migration). PRD → Feature mapping and Antfarm scoping updated to R1–R11, client-held only.
  - **Evidence:** Product spec sentence updated to “client-held envelope encryption only.”
- **.company/features/README.md**
  - Scope set to **client-held envelope encryption only**; PRD v2.1 and mnemospark_full_workflow referenced; Phase 1 MVP wording removed.

---

## 5. Status after round 3

| Blocker / unknown            | Status                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| B1 (Encryption Phase 2 only) | **Resolved.** PRD and feature specs updated.                       |
| B2 (Recipient wallet)        | **Resolved.** Address and config documented in workflow.           |
| U-API (REST contract)        | **Resolved.** Use s3-cost-estimate-api design pattern.             |
| U-Upload (Upload flow)       | **Resolved.** Use object_storage_management_aws.py design pattern. |
| U-Usage (Get storage usage)  | **Resolved.** Removed from MVP; ls is enough.                      |
| slash_commands canonical     | **Resolved.** Workflow is canonical; slash_commands points to it.  |
| 30/32 days + 2-day grace     | **Resolved.** Stated in workflow housekeeping and upload step.     |

**Verdict:** No remaining blockers from round 2. Development can proceed using:

- [mnemospark_full_workflow.md](./mnemospark_full_workflow.md) for behavior and commands.
- [mnemospark_PRD.md](./mnemospark_PRD.md) (v2.1) for requirements and scope.
- **examples/s3-cost-estimate-api** for backend REST/Lambda pattern.
- **examples/object_storage_management_aws.py** for upload and client-held encryption pattern.

---

## 6. Suggested next steps

1. **mnemospark-backend repo:** Implement price-storage, upload, ls, download, delete using the s3-cost-estimate-api pattern; configure `MNEMOSPARK_RECIPIENT_WALLET`; implement housekeeping job (32-day deadline, 2-day grace).
2. **Plugin (this repo):** Implement `/cloud` subcommands and proxy flow per workflow; wallet resolution and EIP-712 per existing clawrouter; activity log under `~/.openclaw/mnemospark/logs/` per PRD.
3. **Optional:** Add a short **API spec** (paths, methods, request/response, errors) to mnemospark-backend or .company, referencing the s3-cost-estimate-api and workflow for each command.
