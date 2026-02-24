# Critical Questions: mnemospark Full Workflow

**Sources:** [mnemospark_full_workflow.md](./mnemospark_full_workflow.md), [mnemospark_PRD.md](./mnemospark_PRD.md), [spec_feedback_for_sr_engineer.md](./features/spec_feedback_for_sr_engineer.md), [slash_commands.md](./slash_commands.md), repo examples and .company docs.  
**Purpose:** Blockers, unknowns, and ambiguities that must be resolved before or at the start of development.

---

## 1. BLOCKERS (must resolve before development)

### B1. Encryption phase: Phase 1 vs Phase 2 only

- **Conflict:** PRD and feature roadmap define **Phase 1** (SSE-S3/SSE-KMS, no client-held key) then **Phase 2** (client-held KEK/DEK). Spec feedback states: _"Sr. Engineer - remove Phase 1 we will only implement Phase 2"_.
- **Question:** Is the product scope **Phase 2 only** (client-held envelope encryption from day one), or Phase 1 then Phase 2? This affects backend (no SSE-S3/SSE-KMS vs full KEK/DEK flow), plugin, and examples (e.g. `object_storage_management_aws.py` already uses client-held encryption).
- **Blocker because:** Backend design (encryption at rest, key handling), feature order, and PRD/feature specs are inconsistent.

### B2. Backend payment recipient wallet

- **Workflow:** Backend housekeeping: _"payment in the amount of USDC &lt;storage-price&gt; ... should be received to wallet (wallet address will be added in the future)"_.
- **Question:** What is the **backend’s USDC recipient wallet address** (Base mainnet)? Who decides it (config, env, deployment)? Without it, backend cannot verify “payment received” or settle TransferWithAuthorization to a known payTo.
- **Blocker because:** Payment verification and scheduled “payment received” checks cannot be implemented without a defined recipient.

### B3. Command naming: /cloud vs /storage

- **Workflow:** Commands are `/cloud`, `/cloud backup`, `/cloud price-storage`, `/cloud upload`, `/cloud ls`, `/cloud download`, `/cloud delete`, `/wallet`.
- **PRD R8:** _"commands `/wallet`, `/storage`"_ and _"Get storage usage"_.
- **slash_commands.md:** Uses `/cloud` and `/cloud store` (not “upload”), and different argument patterns (e.g. `price-storage $object-id $location` without --wallet-address, --gb, etc.).
- **Question:** What is the **canonical command set** for the plugin: `/cloud`-prefixed (as in workflow) or `/storage` (as in PRD)? Is the upload command named **upload** or **store**? Which doc is source of truth for arguments and flags?
- **Blocker because:** Plugin implementation and user/docs cannot proceed with conflicting command contracts.

### B4. Repo split and ownership

- **Workflow:** _"examples will need to be moved to its own GitHub repo ... mnemospark-backend"_; _"This repo will also hold all of the cloudformation scripts"_; _"two repos: (1) mnemospark - OpenClaw plugin (2) mnemospark-backend"_.
- **Question:** Confirm: **(1)** This repo (mnemospark) = **plugin + client + proxy only**; **(2)** mnemospark-backend repo = **Lambda, DynamoDB, CloudFormation, and logic moved from examples**? Where do CloudFormation scripts live—only in mnemospark-backend, or also referenced from here?
- **Blocker because:** Development cannot start without a clear repo boundary and where to implement backend vs plugin.

---

## 2. CRITICAL UNKNOWNS (needed for implementation)

### U1. Payment cadence: 30 days vs 32 days

- **Workflow upload (client):** _"cron job to send x402 payment of USDC &lt;storage-price&gt; every **30 days**"_.
- **Workflow backend housekeeping:** _"Every **32 days** payment ... should be received ... if payment is not confirmed the &lt;object-id&gt; will be deleted"_.
- **Question:** What is the **contracted billing interval** (30 or 32 days)? How many days of grace after the due date before backend deletes the object? Align client cron and backend scheduled job.

### U2. Where and how quote is stored

- **Workflow:** Quote row in DynamoDB with fields listed; _"The quote-id row is **deleted after 1 hour**"_.
- **Question:** Is quote expiry implemented via **DynamoDB TTL** or application logic? What is the **DynamoDB table schema** (partition key, sort key, attributes)? Is there a single “quotes” table or multiple tables?

### U3. Proxy balance check and Base RPC

- **Workflow upload:** _"Proxy ... Check wallet --wallet-address &lt;addr&gt; on the Base blockchain for USDC balance &gt; &lt;storage-price&gt;"_.
- **Question:** Does the **proxy** call Base (RPC + USDC contract) directly to check balance, or does it call the **backend** to check balance? If proxy calls Base, how is RPC URL and USDC contract address configured? If backend checks, what endpoint does proxy call?

### U4. Upload: how object bytes reach the backend

- **Workflow backend step 9:** _"Request &lt;object-id&gt; from **mnemospark-proxy**"_; step 10: _"Transfer the &lt;object-id&gt; to the S3 bucket"_.
- **Question:** Does the **client** send the file to the **proxy**, and the proxy **streams** it to the backend? Or does the client send the file directly to the backend after proxy authorizes? What is the **protocol** (e.g. multipart/form-data, chunked upload, presigned URL from backend)? Who holds the file during “request object from proxy” (proxy as relay vs proxy returning a token)?

### U5. HTTP/API contract for backend

- **Workflow:** Describes “sends command to backend” and “returns response” but not **HTTP method**, **path**, **request body**, or **response schema**.
- **Question:** For each command (price-storage, upload, ls, download, delete), what are the **REST endpoints** (method + path), **request body/query/headers**, and **response shape** (JSON fields, error format)? Needed for mnemospark-backend and for proxy→backend calls.

### U6. Log file location and activity log

- **Workflow:** _"Logs: ~/.openclaw/mnemospark/object.log"_; client writes quote and upload results to a log file.
- **PRD / spec feedback:** Activity log under `~/.openclaw/mnemospark/logs/` (JSONL) for audit/support; R8 says _"logs under ~/.openclaw/mnemospark/logs/"_.
- **Question:** Is **object.log** the same as the activity log, or separate? Single path for “object lifecycle” log vs “request/audit” log? Confirm exact paths and formats (e.g. object.log = CSV vs logs/\*.jsonl).

### U7. Wallet directory and key path

- **Workflow:** _"If ~/.openclaw/blockrun exists use it as the wallet directory, else ~/.openclaw/mnemospark/key"_; _"Wallet Key: if ~/.openclaw/blockrun/wallet.key exists use it, if not ~/.openclaw/mnemospark/key/wallet.key"_.
- **PRD R8:** _"wallet at ~/.openclaw/mnemospark/wallet.key"_.
- **Question:** **Single resolution order** for wallet: (1) blockrun path first, (2) mnemospark path? And is the key file **wallet.key** in the chosen directory (so mnemospark path = `~/.openclaw/mnemospark/key/wallet.key` or `~/.openclaw/mnemospark/wallet.key`)? Align workflow and PRD.

### U8. Get storage usage command

- **PRD:** "Get storage usage" and open question whether it requires 402 or is free. Spec feedback: _"Sr. Engineer - no charge per command only a monthly fee"_ and _"Product Manager - this is a free call"_.
- **Workflow:** No explicit “usage” or “storage usage” command; only /cloud ls (list objects).
- **Question:** Is there a **separate “get storage usage”** command (e.g. `/cloud usage` or `/storage usage`)? If yes, is it **free** (no 402)? What does it return (e.g. total size, object count, from AWS APIs)?

---

## 3. AMBIGUITIES (clarify for consistency)

### A1. Download command header typo

- **Workflow lines 207–208:** Section title and argument descriptions say _"/cloud **ls**"_ for the **download** command; body then describes download behavior.
- **Question:** Confirm: download command is **/cloud download** with args (e.g. --wallet-address, --object-key), not /cloud ls. Fix document typo.

### A2. object-id vs object-key

- **Workflow:** backup creates **object-id** (and object-id-hash, object-size-gb); upload returns **object-key**; ls/download/delete use **object-key**.
- **Question:** Confirm: **object-id** = local backup artifact name (e.g. tar.gz in /tmp); **object-key** = S3 object key (returned after upload). No ambiguity in code/docs: use object-id only for backup/quote/upload flow; use object-key for ls/download/delete.

### A3. addr-hash and bucket naming

- **Workflow:** Upload response includes **addr-hash**; backend creates bucket using wallet; spec feedback: bucket name **mnemospark-&lt;wallet-id-hash&gt;** (no region in name).
- **Question:** Is **addr-hash** the same as **wallet-id-hash** used in bucket name (e.g. first 16 hex chars of sha256(wallet address))? Confirm so backend and client use same convention.

### A4. Region for upload

- **Workflow:** price-storage has **--region &lt;location&gt;**; quote contains **&lt;provider&gt;**, **&lt;location&gt;**; upload command in workflow does not list --region.
- **Question:** Is **region** for upload **inferred from the quote** (so backend uses quote’s location for bucket/region)? Or does upload accept an explicit --region that must match the quote?

### A5. Idempotency contract

- **PRD / spec feedback:** Optional Idempotency-Key; 24h TTL; same key with different body → cached 200 (treat as duplicate). Sr. Engineer accepted.
- **Workflow:** No mention of idempotency.
- **Question:** Add to workflow: **which operations** support Idempotency-Key (e.g. upload only, or upload + delete)? Where is the key passed (header)? So backend and proxy implement the same contract.

### A6. Error messages and codes

- **Workflow:** Various strings: "Cannot build storage object", "Cannot price storage", "no quote", "no quote mismatch", "payment failed", "Cannot list storage objects", etc. slash_commands has "Cannon list" (typo).
- **Question:** Single **error code / message table** for client and backend (e.g. INSUFFICIENT_FUNDS, QUOTE_EXPIRED, PAYMENT_FAILED, OBJECT_NOT_FOUND) so UX and API responses are consistent.

### A7. Cron and scheduled job ownership

- **Workflow client:** _"Builds a **cron job** to send x402 payment ... every 30 days"_ (on user machine).
- **Workflow backend:** _"**scheduled job** to see if payment has been received per &lt;object-id&gt;"_; delete if not paid in 32 days.
- **Question:** Confirm: **client** is responsible for triggering the recurring payment (cron on user’s machine); **backend** is responsible for checking receipt and deleting object if unpaid. No server-side “pull” of payment from client—client must push payment. Document this split so both sides implement correctly.

---

## 4. SUMMARY

| Category    | Count | Action                                          |
| ----------- | ----- | ----------------------------------------------- |
| Blockers    | 4     | Resolve before starting development.            |
| Unknowns    | 8     | Answer from repo, design, or product; document. |
| Ambiguities | 7     | Clarify and fix in workflow/PRD/specs.          |

**Suggested order:** Resolve B1–B4 first; then U1–U8 so backend and plugin contracts are clear; then A1–A7 and update the workflow doc and PRD accordingly.

---

# ANSWERS (from repo, design decisions, and best practices)

Answers below are derived from the repo (workflow, PRD, spec*feedback, slash_commands, examples, clawrouter EIP-712, balance.ts), AWS docs, and common design practice. **Product/tech lead must confirm** any answer marked as \_Decision needed* before implementation.

---

## 1. BLOCKERS — Answers

### B1. Encryption phase: Phase 1 vs Phase 2 only

- **Answer:** Spec feedback explicitly says _"remove Phase 1 we will only implement Phase 2"_. That implies **Phase 2 only** (client-held envelope encryption from day one). The example `object_storage_management_aws.py` already implements client-held KEK/DEK.
- **Action:** **Decision needed.** Product/PRD must be updated to drop Phase 1 (SSE-S3/SSE-KMS) and define Phase 2 as the only MVP encryption model. Feature roadmap and R10/R11/R12 in the PRD should be aligned (single phase = client-held KEK/DEK; key store at `~/.openclaw/mnemospark/keys/` per workflow).

### B2. Backend payment recipient wallet

- **Answer:** The workflow states _"wallet address will be added in the future"_ — so this is **not yet defined**. Best practice: backend recipient wallet is a **deployment-time config** (env var or SSM/Secrets Manager), not hardcoded. The backend uses this as `payTo` when verifying/settling USDC TransferWithAuthorization.
- **Action:** **Decision needed.** Product/infra must define the **recipient wallet address** (Base mainnet) and how it is configured (e.g. `MNEMOSPARK_RECIPIENT_WALLET`). Until then, backend payment verification and housekeeping (“payment received”) cannot be implemented.

### B3. Command naming: /cloud vs /storage

- **Answer:** The **full workflow** is the most detailed and uses **/cloud** and **/cloud upload** (not “store”). The PRD’s “/storage” is likely a generic term; the implemented plugin surface in the workflow is **/cloud**-prefixed. Spec feedback and product spec v3 do not override the workflow’s command list.
- **Recommendation:** Treat **mnemospark_full_workflow.md** as canonical for **command names and arguments**: `/cloud`, `/cloud backup`, `/cloud price-storage`, `/cloud upload`, `/cloud ls`, `/cloud download`, `/cloud delete`, `/wallet`. Use **upload** (not “store”). Update PRD R8 to say “commands `/wallet`, `/cloud` (and subcommands)” and align slash_commands.md with the workflow’s argument list (e.g. price-storage with --wallet-address, --object-id, --object-id-hash, --gb, --provider, --region).

### B4. Repo split and ownership

- **Answer:** Workflow states: **(1)** This repo = OpenClaw plugin (mnemospark client + proxy); **(2)** mnemospark-backend = new private repo with examples moved there + CloudFormation for Lambda, DynamoDB, etc. So: **mnemospark** = plugin only; **mnemospark-backend** = all backend logic, Lambdas, DynamoDB, CloudFormation, and code derived from `examples/` (e.g. s3-cost-estimate-api, data-transfer-cost-estimate-api, object_storage_management_aws patterns).
- **Action:** Confirm with team; then document in both repos’ README. CloudFormation lives **only in mnemospark-backend** per workflow.

---

## 2. CRITICAL UNKNOWNS — Answers

### U1. Payment cadence: 30 days vs 32 days

- **Answer:** **Recommendation:** Use **30 days** as the billing interval (client cron and user-facing message). Backend housekeeping should allow a **grace period** (e.g. 2 days) before deletion, so backend checks “payment due” at **32 days** (30 + 2): if not received by then, delete object. So: client pays every 30 days; backend expects payment within 32 days of last due date; after 32 days without payment, backend deletes. Document this in workflow and backend spec.

### U2. Quote storage and expiry

- **Answer:** **DynamoDB TTL** is the standard, cost-effective way to delete quote rows after 1 hour. Enable TTL on the quotes table with an attribute (e.g. `ttl`) set to `current_time_seconds + 3600`. Schema suggestion: partition key `quote_id` (string); attributes: `quote_id`, `created_at`, `storage_price`, `addr`, `object_id`, `object_id_hash`, `object_size_gb`, `provider`, `location`, `ttl`. No sort key needed for simple quote lookup.

### U3. Proxy balance check and Base RPC

- **Answer:** Existing **clawrouter** (this repo) uses **balance.ts** with viem + Base RPC and USDC contract to check balance. For mnemospark, the **proxy** can do the same: use Base RPC (configurable URL) and USDC contract address to check `balanceOf(addr)`. So **proxy checks balance directly** (no backend call for balance). Config: RPC URL and USDC contract (e.g. `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base) in plugin config or env.

### U4. Upload: how object bytes reach the backend

- **Answer:** **Recommendation:** Client sends file to **proxy** (e.g. multipart/form-data or binary body); proxy forwards to **backend** (stream or buffer). Backend “requests object from proxy” means: proxy already has the bytes (from client) and sends them in the same request or a follow-up upload request to backend. Alternative: backend returns a **presigned S3 PUT URL**; client (or proxy on behalf of client) uploads directly to S3. Simpler for backend is **proxy streams body to backend**, backend writes to S3. Specify in API contract: e.g. `POST /upload` with `quote_id`, `wallet_address`, `object_id`, `object_id_hash`, and body = file bytes; backend validates quote, payment, then streams to S3.

### U5. HTTP/API contract for backend

- **Answer:** Not fully specified in the repo. **Recommendation:** Define a small REST surface, e.g.:
  - `POST /price-storage` — body: `{ wallet_address, object_id, object_id_hash, gb, provider, region }` → returns quote (quote_id, storage_price, …).
  - `POST /upload` — body: multipart or binary + metadata (quote_id, wallet_address, object_id, object_id_hash); headers: payment/signature; returns object_key, bucket, location, trans_id, …
  - `GET /ls` or `POST /ls` — query/body: wallet_address, object_key → returns list/metadata.
  - `GET /download` — query: wallet_address, object_key → returns file stream.
  - `DELETE /delete` — query/body: wallet_address, object_key → returns success.  
    Document exact paths, methods, request/response JSON, and error format (e.g. 402 body, 4xx codes) in mnemospark-backend and in the workflow doc.

### U6. Log file location and activity log

- **Answer:** **Recommendation:** Keep **two** concepts: **(1)** **object.log** (or similar) at `~/.openclaw/mnemospark/object.log` for **object lifecycle** (backup id, quote, upload result) — CSV or line-oriented, used by client to pass object-id/quote-id between commands. **(2)** **Activity log** at `~/.openclaw/mnemospark/logs/` as **JSONL** (per spec feedback Option A) for **request/audit** (timestamp, request type, wallet, amount, success/failure). So: object.log = client-side state for workflow; logs/ = audit/support. Document both in workflow and PRD.

### U7. Wallet directory and key path

- **Answer:** Workflow and clawrouter_wallet_gen_payment_eip712.md agree: **blockrun first**, then mnemospark. So resolution order: (1) `~/.openclaw/blockrun/wallet.key`, (2) `~/.openclaw/mnemospark/key/wallet.key`. The **directory** for mnemospark is `~/.openclaw/mnemospark/key`, and the key file is **wallet.key** inside it. PRD’s “wallet at ~/.openclaw/mnemospark/wallet.key” is slightly off — should say “wallet at ~/.openclaw/blockrun/wallet.key if present, else ~/.openclaw/mnemospark/key/wallet.key”. Update PRD to match workflow.

### U8. Get storage usage command

- **Answer:** Spec feedback and product spec v3: **Get storage usage is free** (no 402); “no charge per command only a monthly fee”. Workflow does not yet describe a “usage” command. **Recommendation:** Add a command (e.g. `/cloud usage` or `/cloud storage-usage`) that calls backend (or reads from backend/cache) and returns usage (e.g. total size, object count) from **AWS APIs only** (no internal ledger). No 402; optional for MVP if “ls” is enough for now.

---

## 3. AMBIGUITIES — Answers

### A1. Download command header typo

- **Answer:** Yes — the **download** command is **/cloud download** with --wallet-address and --object-key. The workflow doc mistakenly used “/cloud ls” in the download section header and argument block. Fix: replace with “/cloud download” and the correct args.

### A2. object-id vs object-key

- **Answer:** **object-id** = local backup artifact (e.g. filename in /tmp after tar+gzip). **object-key** = S3 object key returned after upload, used for ls/download/delete. Use object-id only in backup → price-storage → upload; use object-key everywhere after upload. Examples and workflow are consistent; document once in workflow glossary.

### A3. addr-hash and bucket naming

- **Answer:** In examples/object_storage_management_aws.py, **wallet_hash** = `hashlib.sha256(wallet_address.encode()).hexdigest()[:16]` and bucket = `mnemospark-{wallet_hash}`. So **addr-hash** in the workflow is the same as **wallet-id-hash** (short deterministic hash of wallet address). Use same convention in backend (e.g. first 16 hex chars of sha256(addr)) so bucket names match.

### A4. Region for upload

- **Answer:** Quote already contains **location** (region). **Recommendation:** Upload uses **region from the quote**; no separate --region on upload. Backend looks up quote by quote_id and uses quote’s location (and provider) for bucket region. If upload is called with a quote that has location X, backend uses region X for bucket/upload.

### A5. Idempotency contract

- **Answer:** Spec feedback: optional key, 24h TTL; same key + different body → return cached 200 (treat as duplicate). **Recommendation:** Support **Idempotency-Key** header on **upload** (and optionally delete). Store key + response in backend (e.g. DynamoDB or cache with TTL 24h). Document in workflow and API spec: header name, TTL, and “same key different body → cached 200”.

### A6. Error messages and codes

- **Answer:** **Recommendation:** Define a small table: e.g. `QUOTE_EXPIRED`, `QUOTE_NOT_FOUND`, `OBJECT_NOT_FOUND`, `PAYMENT_FAILED`, `INSUFFICIENT_FUNDS`, `STORAGE_UNAVAILABLE`, `CANNOT_BUILD_OBJECT`, etc. Map backend and S3 errors to these; client and proxy use same codes/messages. Fix slash_commands typo “Cannon list” → “Cannot list”.

### A7. Cron and scheduled job ownership

- **Answer:** **Client** (user machine): cron triggers **sending** the recurring USDC payment (every 30 days) via x402. **Backend**: scheduled job (e.g. EventBridge + Lambda) checks whether **payment was received** per object (e.g. by 32 days); if not, backend deletes object. So: client pushes payment; backend only verifies receipt and enforces deletion. No server-side “pull” from client. Document in workflow.

---

## Summary after answers

| Item                  | Status                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| B1 (Phase 1 vs 2)     | Decision needed: align PRD/spec to Phase 2 only if that’s final.                          |
| B2 (Recipient wallet) | Decision needed: define recipient address and config.                                     |
| B3 (Commands)         | Resolved: workflow = canonical; use /cloud + upload; update PRD/slash_commands.           |
| B4 (Repos)            | Resolved: plugin here; backend + CloudFormation in mnemospark-backend.                    |
| U1–U8, A1–A7          | Answered with recommendations; implement per above and document in workflow/backend spec. |
