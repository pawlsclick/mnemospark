# Feature: Agent-Facing Storage API

**Source:** mnemospark Product Spec v3 — Sections 3.2(5), 3.3.3, 6, 8, 10.2–10.3  
**PRD:** [mnemospark_PRD.md](../mnemospark_PRD.md) — R1 (402 flow), R7 (REST: upload, download, list, get usage; idempotency TBD), R10–R11 (Phase 1 scope)  
**Status:** Definable now (idempotency contract noted as open)

---

## Feature Name

Agent-Facing Storage API (REST, 402, Upload / Download / List / Get Usage)

## Problem

Agents and OpenClaw clients need a **clear, stable REST API** to upload, download, list, and get storage usage. Every operation must be gated by 402 (pay per request); the API shape and 402 response must be documented so clients can implement payment and retries correctly. Without a defined contract, clients and gateway can diverge and we risk double charges or duplicate uploads on retries.

**User job:** “I call a simple REST API to store and retrieve my agent data; I get a 402 when I need to pay, and after paying I get the result.”

## Solution

Define and implement the **Agent-Facing Storage API**:

1. **REST endpoints** (e.g. under `/v1/store/` or similar):
   - **Upload object:** e.g. `PUT /v1/store/{region}/{key}` or `PUT /v1/store/objects` with body and headers (region, key).
   - **Download object:** e.g. `GET /v1/store/{region}/{key}`.
   - **List prefix:** e.g. `GET /v1/store/{region}?prefix=...` or `GET /v1/store/objects?region=...&prefix=...`.
   - **Get storage usage:** e.g. `GET /v1/store/usage` or `GET /v1/store/{region}/usage` — returns usage derived from **AWS APIs** (no internal ledger); may be read-only and still require 402 for consistency, or documented as “no charge” for usage read.

2. **402 contract:**
   - All mutating and data operations return **402** when no valid payment is present.
   - Response body: amount, payTo, asset, network (and any other fields required for x402 signing). Amount comes from **Pricing Module** (BCM + markup or GetCostForecast + markup for storage fee).

3. **Payment header:**
   - Client retries with same method/path/body and adds payment proof (e.g. header per existing x402 convention). Gateway verifies on-chain then performs operation and returns 200 (or error).

4. **Idempotency:**
   - Support optional **`Idempotency-Key`** header (UUID or opaque string) for **mutating** operations (PUT, DELETE).
   - If key was already seen and operation succeeded, return **same 200** and do **not** charge again or perform operation again.
   - Store key + response with **TTL** (e.g. 24 hours). Duplicate key within TTL → 200 with cached response.
   - _Spec leaves open: TTL value and whether Idempotency-Key is required for mutating calls. This feature assumes optional key and 24h TTL until confirmed (see spec feedback)._

5. **Get storage usage:**
   - Returns usage from AWS (e.g. S3 list + sum, or Cost Explorer/usage API). No internal ledger. Whether this endpoint requires 402 or is free “usage read” is product decision — document clearly.

## Success Metrics

- API is documented (OpenAPI or equivalent) with 402 response shape, payment header, and idempotency behavior.
- All operations (upload, download, list) succeed with 402 → pay → 200 in integration tests.
- Retry with same Idempotency-Key within TTL does not double-charge and does not duplicate object.
- Client SDK or example (e.g. in OpenClaw plugin) can implement the flow from docs alone.

## Acceptance Criteria

1. REST routes are implemented for: Upload (PUT), Download (GET), List (GET with prefix), Get storage usage (GET). Exact paths and query params are documented.
2. Each operation that modifies or returns data returns 402 when payment is missing; body includes amount, payTo, asset, network.
3. Request with valid payment header is verified on-chain; on success, gateway calls Orchestrator and returns 200 with appropriate body (e.g. metadata for PUT, object body for GET, list result for LIST).
4. Optional `Idempotency-Key` header is supported for PUT (and DELETE if implemented). Duplicate key within TTL returns cached 200; no second charge or second write.
5. TTL for idempotency cache is configurable (default 24h); documented.
6. Get storage usage returns data from AWS APIs only (no internal ledger); response format is documented.
7. OpenAPI or markdown spec is produced and checked in; describes 402, payment header, idempotency, and error codes (4xx/5xx).

## Dependencies

- **x402 Storage Gateway** (implements these routes).
- **Pricing Module** (for quote in 402).
- **Orchestrator** and **S3 Storage Backend** (for execution).
- Resolved spec: idempotency TTL and required vs optional (Section 10.2, 10.3).

## RICE Score

| R                    | I   | C   | E              | Score |
| -------------------- | --- | --- | -------------- | ----- |
| All agents / clients | 3   | 90% | 2 person-weeks | High  |

- **Reach:** Every client of mnemospark.
- **Impact:** 3 (contract clarity and safe retries).
- **Confidence:** 90% (idempotency details TBD).
- **Effort:** M (~2 weeks).

## Timeline

**M** (2 weeks)

## Hand-off Questions

1. Exact URL design: path-based key (`/v1/store/{region}/{key}`) vs query params (`/v1/store/objects?region=...&key=...`)? Key encoding (e.g. base64 for slashes)?
2. Should “Get storage usage” require 402 or be a free endpoint (e.g. once per session after a paid operation)?
3. Confirm idempotency: 24h TTL and optional header as default for MVP unless product says otherwise.

---

## Antfarm hand-off

### Task string (copy-paste for `workflow run feature-dev`)

```
Build the Agent-Facing Storage API for mnemospark: REST under /v1/store/ (or equivalent) — Upload (PUT), Download (GET), List (GET with prefix), Get storage usage (GET). All data/mutating ops return 402 when no payment; body includes amount, payTo, asset, network from Pricing Module. Client retries with payment header; gateway verifies on-chain then Orchestrator then 200. Optional Idempotency-Key for PUT (and DELETE if implemented); duplicate key within TTL returns cached 200, no double charge. Get storage usage from AWS APIs only; document 402/payment header/idempotency and error codes. Constraints: Phase 1 scope; no internal ledger for usage. Acceptance: [ ] REST routes for PUT, GET (download, list, usage); paths and params documented; [ ] 402 when payment missing, body with amount, payTo, asset, network; [ ] valid payment → verify → Orchestrator → 200 with correct body; [ ] Idempotency-Key optional for PUT, duplicate within TTL = cached 200 no second charge/write; [ ] TTL configurable (default 24h), documented; [ ] Get storage usage from AWS only, format documented; [ ] OpenAPI or markdown spec checked in (402, payment header, idempotency, 4xx/5xx).
```

### Verifier acceptance checklist

- [ ] REST routes implemented for: Upload (PUT), Download (GET), List (GET with prefix), Get storage usage (GET). Paths and query params documented.
- [ ] Each operation that modifies or returns data returns 402 when payment missing; body includes amount, payTo, asset, network.
- [ ] Request with valid payment header verified on-chain; on success gateway calls Orchestrator and returns 200 with appropriate body (metadata for PUT, object for GET, list for LIST).
- [ ] Optional `Idempotency-Key` header supported for PUT (and DELETE if implemented). Duplicate key within TTL returns cached 200; no second charge or second write.
- [ ] TTL for idempotency cache configurable (default 24h); documented.
- [ ] Get storage usage returns data from AWS APIs only (no internal ledger); response format documented.
- [ ] OpenAPI or markdown spec produced and checked in; describes 402, payment header, idempotency, and error codes (4xx/5xx).

---

## Customer Journey Map

Agent or OpenClaw user issues HTTP requests to store and retrieve data. They first get 402, pay with wallet, retry with payment header, then get 200. The API is the only programmatic surface they use.

## UX Flow

1. Client: PUT /v1/store/... (body).
2. Server: 402 { amount, payTo, asset, network }.
3. Client: signs payment, retries PUT with same body + payment header (and optionally Idempotency-Key).
4. Server: verifies → provisions if needed → orchestrates → 200 + metadata.

## Edge Cases and Error States

| Scenario                                              | Handling                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout after client sent payment                     | Client retries with same Idempotency-Key; server returns 200 from cache if first attempt succeeded, or processes once.                                                           |
| Client sends different body with same Idempotency-Key | Spec: “same success response”; treat as duplicate key (return cached 200) or 400 “key reused with different body” — recommend duplicate key → cached 200 to avoid double charge. |
| 402 with amount 0 or quote failed                     | Return 503 or 402 with message “quote unavailable.”                                                                                                                              |
| Key too long / invalid chars                          | 400 Bad Request; document key format and limits.                                                                                                                                 |

## Data Requirements

- API does not persist usage; usage is from AWS. Request/response and payment outcomes may be logged for audit (see spec feedback on activity log).
