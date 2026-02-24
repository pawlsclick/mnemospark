# Product Spec v3 — Feedback for Sr. Engineer Discussion

**Source:** [mnemospark_product_spec_v3.md](../mnemospark_product_spec_v3.md); [mnemospark_PRD.md](../mnemospark_PRD.md)  
**Purpose:** Open decisions, ambiguities, and technical follow-ups to align implementation with the spec v3, PRD v2, and feature specs in this folder.  
**Audience:** Sr. Engineer, Product

---

## 1. Resolved vs Open: Quick Reference

Spec v3 and the PRD explicitly **resolve** (Sections 10.1 / PRD “Requirements”):

- **Tenant model:** **Single AWS account. One S3 bucket per wallet** (per region as configured); agents are keyed inside that bucket by prefix.
- **Charging model:** **Per-request x402 only** (no pre-paid balance); activity fee via **BCM Pricing Calculator API + markup**, storage fee via **GetCostForecast + markup** with one monthly x402 per wallet.
- **Usage source of truth:** **AWS APIs only** (S3, Cost Explorer/GetCostForecast) for usage and billing; **no internal GB-stored ledger.**
- **MVP scope:** AWS S3 only, **no Glacier**, 2–3 regions, no region premium; **Phase 1 encryption = SSE-S3/SSE-KMS**, **Phase 2 = client-held envelope encryption (KEK/DEK)**.
- **Verification:** **On-chain** verification before any S3 operation or bucket creation.

**Still open** (Spec v3 §10.2–10.3 and PRD “Open questions”) and need a decision before or during implementation:

1. **Idempotency and retries** — contract so clients can retry without double charge or double upload. `Sr. Engineer1 - how would you build this?`
2. **Activity log / metering storage (our own records)** — whether and where we store request logs, payment outcomes, and audit trail for support/debugging. `Sr. Engineer - we need a log file to track customer requests and debugging`
3. **Get storage usage 402 behavior** — whether “get usage” always requires a 402 (strict pay-per-call) or can be a free/read-more-often endpoint. `Sr. Engineer - this call will not incure a fee` `Product Manager - this is a free call to check existing storage use`
4. **Encryption migration (Phase 1 → Phase 2)** — how to handle existing plaintext-at-rest objects when client-held KEK/DEK rolls out (re-upload vs mixed encryption modes). `Not a concern`

The spec also includes **recommendations** (Section 10.3) that are not yet signed off as product decisions (notably idempotency behavior).

---

## 2. Idempotency (Spec v3 §10.2–10.3, PRD “Open questions”)

**Spec recommendation:** Optional `Idempotency-Key` header (e.g. UUID); for mutating operations (PUT, etc.): if key already seen and operation succeeded, return same 200 and do not charge or perform again; store key + response with TTL (e.g. 24h); duplicate key within TTL → 200 with cached response.
`Sr. Engineer - this is acceptable`

**Feedback for sr. engineer:** `Sr. Engineer - read the below`

- **TTL:** Confirm 24h default and whether it should be configurable (config vs hardcoded). Longer TTL reduces double-submit risk; shorter reduces storage and replay surface.
- **Optional vs required:** Spec and PRD list “idempotency key required for all mutating calls” as **nice-to-have**. For Phase 1 MVP, should we:
  - Ship **optional** keys (backwards compatible), or
  - Make keys **required for mutating calls** from day one (stricter but safer, especially when integrating with OpenClaw tooling)?
- **Scope of “same response”:** If client sends same key but **different body** (e.g. same key, different object content), do we return cached 200 (treat as duplicate) or 400 “key reused with different body”? Recommendation in feature 06 remains: treat as duplicate (cached 200) to avoid double charge; confirm this is acceptable.
- **Implementation strategy:** Where to store keys and responses so idempotency survives gateway restarts (in-process cache vs JSONL/SQLite vs something else) and how much detail we persist (full response vs minimal metadata).

---

## 3. Activity Log / Our Own Records (Spec v3 §10.2, §10.3; PRD “Open questions”)

**Clarification:** Usage _for billing_ is resolved: AWS APIs only (S3, Cost Explorer / GetCostForecast), no internal “GB stored” ledger.

**Open question:** Where (if anywhere) do we store **our own** records of activity (request type, wallet, amount, success/failure) for support, debugging, and audit (“who paid for what and when”)? `Sr. Engineer - we need a log file to track customer requests and debugging`

**Spec options (mirroring PRD R13–R15 and v3 decisions table):**

- **(A)** Lightweight activity log in-process: e.g. JSONL under `~/.openclaw/mnemospark/logs/` — timestamp, request type (upload/download/list/usage), wallet, amount, success/failure. No separate DB for MVP; file-based.  
  `Sr. Engineer - yes we need this functionality for the customer using the mnemospark product`
- **(B)** No persistent metering store — rely only on AWS APIs and on-chain payment history.

**Feedback for sr. engineer:**

- **Recommendation in spec/PRD:** (A) is framed as a **nice-to-have**, but strongly recommended for MVP to make debugging and support tractable.
- **Implementation impact:** (A) implies: after each verified request (or after each 402 + verify), append one line to a JSONL file; define rotation/retention policy (e.g. 90 days, size cap). (B) implies: no new persistence; rely on existing logs + chain + AWS.
- **Decision needed:** Confirm (A) vs (B) for Phase 1 so feature 01 (gateway) and 06 (API) know whether to write audit records and where.
  `Sr. Engineer - do option A`

---

## 4. Technical Ambiguities (Implementation)

These are not necessarily “open product questions” but need `Sr. Engineer` input so feature specs can be implemented consistently and Antfarm task strings can be precise.

### 4.1 BCM Pricing Calculator API

- **Exact usage:** Spec v3/PRD reference “BCM Pricing Calculator API” for S3 (service, region, attributes, usage). Need: exact API name (e.g. AWS Pricing API vs BCM Calculator), endpoint, request shape (service id, attribute names for storage class, region, usage quantity), and whether we use a dedicated SDK or REST. Feature 03 (Pricing Module) depends on this.
  `Sr. Engineer - see this API endpoint for building a S3 data storage cost estimate`
  [s3-cost-estimate-api](../../examples/s3-cost-estimate-api)

- **Egress:** Same API for “data transfer out” — attribute or product code to use for egress quote.
  `Sr. Engineer - see this API endpoint for building a egress data transfer out cost estimate`
  [data-trasfer-cost-estimate-api](../../examples/data-transfer-cost-estimate-api/)

### 4.2 GetCostForecast Scoping

- **Filter by tenant/bucket:** GetCostForecast supports filters (service, region, tags, etc.). How do we scope “this tenant’s storage cost” in the **single-account** model — by AWS cost allocation tag on the bucket, by bucket name/prefix, or both? Feature 03 and 05 depend on this for monthly storage fee and for future reporting.
  `Sr. Engineer - we don't need this. We will bill one monthly fee`

### 4.3 Bucket Naming and Ownership

- **Naming:** Spec v3 gives an example like `mnemospark-<wallet-id-hash>-<region>`. We still need a concrete, code-ready convention (allowed chars, max length, how we hash/shorten wallet id) and a shared helper across features 02 and 05.

`Sr. Engineer - use mnemospark-<wallet-id-hash> see below`

# Python Hash Functions for AWS Lambda

Use **`hashlib`** from the standard library: no extra dependencies, and hashes are **deterministic** (same input → same output across invocations). Python’s built-in `hash()` is randomized per process, so it’s not suitable when you need stable hashes in Lambda.

## Recommendation

| Use case                                | Function                                | Notes                                 |
| --------------------------------------- | --------------------------------------- | ------------------------------------- |
| General (IDs, partitioning, cache keys) | `hashlib.sha256()`                      | Good speed, 64-char hex output        |
| Short hashes / checksums only           | `hashlib.md5()`                         | Faster, 32-char hex; not for security |
| Need crypto security                    | `hashlib.sha256()` or `sha384`/`sha512` | Use for signatures, secrets           |

## Example

import hashlib

def stable_hash(s: str) -> str:
"""Deterministic hash suitable for Lambda (same input → same output)."""
return hashlib.sha256(s.encode()).hexdigest()

# Short version if you don't need full 64 chars

def short_hash(s: str, length: int = 16) -> str:
return hashlib.sha256(s.encode()).hexdigest()[:length]

# AWS S3 Bucket Naming Rules

## Length

- **Minimum:** 3 characters
- **Maximum:** 63 characters

## Allowed Characters

- **Lowercase letters:** `a-z`
- **Digits:** `0-9`
- **Period:** `.`
- **Hyphen:** `-`

No uppercase letters or underscores are allowed.

## Additional Rules

- Must **start and end** with a letter or number (not `.` or `-`).
- Must **not** contain two adjacent periods (e.g. `example..com`).
- Must **not** be formatted as an IP address (e.g. `192.168.5.4`).
- Must **not** start with: `xn--`, `sthree-`, `amzn-s3-demo-`.
- Must **not** end with: `-s3alias`, `--ol-s3`, `.mrap`, `--x-s3`, `--table-s3`.
- Bucket names must be **globally unique** across all AWS accounts and regions within a partition.

## Reference

[General purpose bucket naming rules - Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)

- **Who creates bucket:** PRD says “payment verification triggers bucket creation” in the single account. Implementation detail to confirm: is bucket creation:
  - **Eager:** On first verified payment for a wallet, create buckets in all configured regions, or
  - **Lazy per region:** Create bucket in the specific region when first used?  
    This affects orchestrator behavior and test setup.

  `Sr. Engineer - when the user accepts the price of storage, check to see if the user has a S3 bucket tied to the users wallet address, if yes use the existing bucket, if not create the bucket`

### 4.4 Agent Id vs Wallet vs Bucket Mapping

- **Exact mapping:** Spec v3: “wallet = tenant,” “one bucket per wallet,” agent data keyed inside that bucket by prefix (e.g. `agent=<agent-id>/...`). Need unambiguous mapping: (OpenClaw agent id? wallet address?) → wallet → bucket → prefix. Feature 04 (Orchestrator) and 05 (Bucket-per-wallet Provisioning) must use the same identity model (e.g. wallet from payment, agent id from OpenClaw context, prefix convention).

`Sr. Engineer - use mnemospark-<wallet-id-hash>`

### 4.5 Gateway ↔ Orchestrator Boundary

- **Inputs:** Does the gateway pass “region” from the request (header/path) or from config? Does it pass “agent id” from OpenClaw context or derive from wallet? Clarifying this avoids duplicate logic and inconsistent behavior between gateway and orchestrator.

`Sr. Engineer - the region is passed from the installed slash commands see file`
[mnemospark_full_workflow.md](../mnemospark_full_workflow.md)

### 4.6 Error Handling and Status Codes

- **Mapping:** S3 and backend errors (404, 403, 503) → HTTP status and body. Agree on a small set of client-facing error codes and messages (e.g. “insufficient funds,” “quote unavailable,” “storage temporarily unavailable”) so clients and docs are consistent.

`Sr. Engineer - see file slash commanded`
[mnemospark_full_workflow.md](../mnemospark_full_workflow.md)

---

## 5. Get Storage Usage Endpoint Behavior

The PRD highlights an **open question**: should “get storage usage” always require a 402 (consistent pay-per-call) or be a free/read-more-often endpoint?

`Sr. Engineer - no charge per command only a monthly fee`

---

## 6. Encryption Migration (Phase 1 → Phase 2)

Spec v3 and the PRD define **Phase 1** (SSE-S3/SSE-KMS) and **Phase 2** (client-held KEK/DEK) but leave migration behavior open.

**Feedback for sr. engineer:**

- **Strategy options:**
  - **(A) Re-upload:** When a wallet opts into Phase 2, client re-uploads existing objects encrypted with KEK/DEK (potentially expensive but clean semantics).
  - **(B) Mixed modes:** Allow buckets with a mix of Phase 1 (AWS-managed encryption) and Phase 2 (client-held) objects; metadata flags which scheme applies per object.
- **Operational questions:** How will clients know which objects need migration? Do we expose a “mode” flag per wallet/bucket or rely purely on object metadata?
- **Decision needed:** Pick a default migration story for MVP (even if full tooling ships later) so we don’t paint ourselves into a corner with how we store metadata and design the Phase 2 API.

`Sr. Engineer - remove Phase 1 we will only implment Phase 2`

---

## 7. Feature Development Checklist (Spec v3 §13, PRD “PRD → Feature mapping”) — Coverage

The spec’s PM checklist and PRD mapping are reflected in features as follows:

| Spec / PRD checklist item                                                    | Feature(s)               |
| ---------------------------------------------------------------------------- | ------------------------ |
| x402 payment-as-auth                                                         | 01 (Gateway), 06 (API)   |
| Storage gateway API (REST, idempotency, 402 shape)                           | 01, 06                   |
| Activity fee (BCM + markup, 402, verify then operate)                        | 01, 03                   |
| Orchestrator (region + bucket, S3)                                           | 04, 02                   |
| S3 backend (v3, IAM, one bucket per wallet)                                  | 02                       |
| Storage fee (GetCostForecast + markup, monthly x402)                         | 03, 01 (trigger monthly) |
| Tenant model (single account, wallet=tenant, bucket-per-wallet)              | 05                       |
| OpenClaw integration (plugin, config, wallet, commands, gateway)             | 07                       |
| Agent-facing docs                                                            | 06, 07                   |
| Resolve: Idempotency; Activity log; Usage 402 behavior; Encryption migration | This document (§2–§6)    |

**Suggested order for discussion:** Resolve §2 (idempotency) and §3 (activity log) first; then §5 (usage 402 behavior) and §6 (encryption migration); finally §4 (technical ambiguities) so that feature 01, 02, 03, 04, 05 can be implemented without rework.

---

## 8. Out of Scope for MVP (No Change)

Per spec v3 and the PRD, the following remain out of scope and are **not** in the current feature set:

- S3 Glacier, other backends (GCS, Azure, IPFS), region premium, pre-paid balance, off-chain ledger, full CRR/SRR and Multi-Region Access Points, non-AWS storage encryption models.

---

## 9. Suggested Next Steps

1. **Product + Sr. Engineer:** Decide idempotency (TTL, optional vs required, key reuse with different body), activity log (A vs B), and “get storage usage” 402 behavior. Update spec v3 §10.2–10.3, PRD “Open questions,” and feature 01/06 accordingly.
2. **Sr. Engineer:** Confirm or document: BCM API usage (§4.1), GetCostForecast scoping (§4.2), bucket naming and who creates it (§4.3), agent/wallet/bucket mapping (§4.4), gateway–orchestrator contract (§4.5), error code mapping (§4.6), and the preferred encryption migration strategy (§6). Optionally add a short “Technical decisions” section to the spec or a separate ADR.
3. **After alignment:** Feature specs in `.company/features/` can be treated as the developer hand-off set; implementation order remains as in [README.md](./README.md) (S3 backend + Orchestrator first, then Pricing, Gateway, API, Tenant, Plugin); Antfarm feature-dev task strings should reference **spec v3 + PRD v2** and these decisions.
