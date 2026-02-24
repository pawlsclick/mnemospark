# Critical Questions — Round 2 (After Answers)

**Purpose:** After answering the questions in [full_workflow_questions.md](./full_workflow_questions.md), this document identifies **remaining blockers** and **remaining unknowns/ambiguities** that could still block or delay development.

---

## 1. REMAINING BLOCKERS (must resolve before development)

These two items are still **blockers** because they require a **product or deployment decision** that only stakeholders can make. Implementation cannot proceed for affected components until they are decided.

### B1. Encryption scope: Phase 2 only? (still open)

- **Status:** Answer in round 1 was “Phase 2 only per spec feedback”; PRD and feature specs still describe Phase 1 (SSE-S3/SSE-KMS) then Phase 2.
- **Blocker for:** Backend encryption design, feature roadmap, PRD/feature docs, and any Phase-1-only work.
- **Action:** **Product/tech lead:** Confirm whether MVP is **Phase 2 only** (client-held KEK/DEK from day one). If yes: update PRD (R10, R11, R12), feature README, and workflow to remove Phase 1 and state Phase 2 as the only encryption model. If no: confirm Phase 1 first, then Phase 2 later, and align spec feedback with that.

### B2. Backend USDC recipient wallet (still open)

- **Status:** Workflow says “wallet address will be added in the future.” No address or config mechanism is specified.
- **Blocker for:** Backend payment verification, EIP-712 `payTo`, scheduled job that checks “payment received,” and any payout/reconciliation logic.
- **Action:** **Product/infra:** Define the **Base mainnet USDC recipient wallet address** and how it is configured (e.g. env `MNEMOSPARK_RECIPIENT_WALLET` or SSM). Document in backend repo and in workflow (housekeeping section). Until this exists, backend cannot implement “payment received” or deletion-after-non-payment.

---

## 2. REMAINING UNKNOWNS (clarify during early development)

These are not strict blockers to **starting** development but should be pinned down early so backend and plugin stay aligned.

### U-API. Exact REST contract for mnemospark-backend

- **Status:** Round 1 gave a recommended shape (POST /price-storage, POST /upload, GET/POST ls, GET download, DELETE delete). Exact **paths**, **query vs body**, **response JSON keys**, and **error schema** are not yet written down in one place.
- **Risk:** Backend and proxy may implement slightly different contracts; rework later.
- **Action:** In **mnemospark-backend** (or in .company), add a short **API spec** (OpenAPI fragment or markdown) with: method + path, request body/query/headers, success response, and error codes. Reference it from the workflow doc.

### U-Upload. Upload flow: proxy-stream vs presigned URL

- **Status:** Round 1 recommended “proxy streams body to backend, backend writes to S3.” Alternative is “backend returns presigned S3 PUT URL; client/proxy uploads directly to S3.”
- **Risk:** Affects backend Lambda (payload size, timeout) and proxy (streaming, timeouts). Presigned URL avoids large payloads through Lambda but adds a two-step flow.
- **Action:** **Sr. Engineer / backend owner:** Choose one approach for MVP (proxy → backend → S3 vs presigned URL) and document in workflow and API spec. If Lambda payload limits are a concern, presigned URL is safer for large files.

### U-Usage. Whether to implement “get storage usage” in MVP

- **Status:** Round 1: usage is free; workflow does not yet describe a usage command. PRD mentions “Get storage usage.”
- **Risk:** Low; “ls” may be enough for MVP. If usage is deferred, document it as post-MVP so no one blocks on it.
- **Action:** **Product:** Confirm if **/cloud usage** (or equivalent) is in MVP scope. If yes, add one short section to the workflow (command + no 402 + response shape). If no, add to “post-MVP” in PRD/workflow.

---

## 3. REMAINING AMBIGUITIES (doc/consistency only)

Fix these in the docs so they don’t cause confusion; they do not block coding.

### A-Doc. Workflow doc corrections

- **Download section:** Replace “/cloud ls” with “/cloud download” in the download command header and argument descriptions (see round 1, A1).
- **slash_commands.md:** Align with workflow: use “upload” not “store”; add full argument list for price-storage (--wallet-address, --object-id, --object-id-hash, --gb, --provider, --region); fix “Cannon list” → “Cannot list.”
- **PRD R8:** Update to “commands `/wallet`, `/cloud` (and subcommands)” and wallet path resolution (blockrun first, else mnemospark/key/wallet.key).

### A-Cadence. 30 vs 32 days in workflow text

- **Status:** Round 1 recommended: client pays every 30 days; backend allows 32 days before deletion (30 + 2 grace).
- **Action:** Update **mnemospark_full_workflow.md** so both “client cron” and “backend housekeeping” sections state this explicitly (30-day billing, 32-day deadline before delete).

---

## 4. CAN DEVELOPMENT START?

| Condition                 | Status                                                    |
| ------------------------- | --------------------------------------------------------- |
| **B1 (Encryption phase)** | **Open** — decide Phase 2 only vs Phase 1 then Phase 2.   |
| **B2 (Recipient wallet)** | **Open** — define recipient address and config.           |
| **B3 (Commands)**         | Resolved — workflow canonical; update PRD/slash_commands. |
| **B4 (Repos)**            | Resolved — plugin here, backend in mnemospark-backend.    |
| **All other Q’s**         | Answered with recommendations.                            |

**Verdict:**

- **Backend (mnemospark-backend):** Can **start** on structure, DynamoDB (quotes + TTL), S3 bucket-per-wallet, and non-payment logic. **Cannot** complete payment verification or housekeeping until **B2** is resolved. **Cannot** finalize encryption design until **B1** is resolved.
- **Plugin (this repo):** Can **start** on slash commands (/cloud, /wallet), client flow (backup, price-storage, upload, ls, download, delete), and proxy forwarding, using the workflow as the contract. Wallet resolution and EIP-712 signing can follow existing clawrouter patterns. No dependency on B2 for client/proxy flow; only backend needs the recipient.
- **Full E2E (payments + housekeeping):** **Blocked** until **B1** and **B2** are decided and documented.

**Recommended next steps:**

1. **Product/tech lead:** Resolve **B1** and **B2** (document decisions and, for B2, the config var and recipient address).
2. **Sr. Engineer:** Add a short **API spec** for mnemospark-backend (U-API) and choose **upload flow** (U-Upload). Optionally add **/cloud usage** to workflow if in MVP (U-Usage).
3. **Docs:** Apply workflow and slash_commands/PRD corrections (A-Doc, A-Cadence).
4. After (1)–(3), treat **full_workflow_questions.md** (with its answers) and this round-2 doc as the handoff for implementation; no remaining blockers to starting development once B1 and B2 are closed.
