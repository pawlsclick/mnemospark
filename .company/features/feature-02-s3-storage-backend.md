# Feature: S3 Storage Backend

**Source:** mnemospark Product Spec v3 — Sections 3.2(1), 3.3.1, 5.2, 7, 8, 11  
**PRD:** [mnemospark_PRD.md](../mnemospark_PRD.md) — R4 (S3 backend, one bucket per wallet), R9 (usage from AWS only), R10–R11 (Phase 1 scope)  
**Status:** Definable now

---

## Feature Name

S3 Storage Backend (MVP)

## Problem

The product must persist agent data in cloud storage. MVP uses a single provider (AWS S3) with a clear contract: create bucket (or use existing), PUT, GET, LIST, delete, get metadata. Agents do not touch S3 directly; the backend is used by the Orchestrator after payment is verified. Without a dedicated S3 backend module, orchestration and gateway would be coupled to AWS APIs and bucket strategy would be unclear.

**User job:** “My agent’s data is stored reliably in S3, with one bucket per wallet and clear isolation, with no Glacier complexity in MVP.”

## Solution

Implement a **Storage Backend** module that:

- Exposes a single “storage provider” interface: create bucket (or use existing), PUT, GET, LIST, delete, get metadata.
- First implementation: **AWS S3** via **@aws-sdk/client-s3** (v3).
- **Credentials:** IAM roles or users for dev and prod in a **single AWS account** (no long-lived keys in env where possible).
- **Bucket strategy:** **One bucket per wallet.** Given a wallet identifier, the backend uses or creates exactly one bucket (per region) for that wallet, and stores agent data under prefixes (e.g. `agent=<agent-id>/...`) within that bucket.
- No Glacier; MVP uses S3 Standard (and optionally Standard-IA per spec). No multipart upload required for MVP unless needed for large-object reliability (can be scoped in implementation).

Orchestrator calls this backend; the backend does not handle payment or 402.

## Success Metrics

- All S3 operations (PUT, GET, LIST, delete, metadata) succeed against real S3 in integration tests (Vitest).
- Bucket naming and IAM usage are consistent with “one bucket per wallet” in a single AWS account.
- No storage operation is performed without Orchestrator (and thus gateway) having already verified payment upstream.

## Acceptance Criteria

1. Module uses **@aws-sdk/client-s3** (v3) and IAM roles for authentication (dev and prod).
2. Interface supports: createOrUseBucket(walletId, region), putObject(bucket, key, body, options?), getObject(bucket, key), listObjects(bucket, prefix?), deleteObject(bucket, key), getMetadata(bucket, key).
3. One bucket per wallet: bucket name or mapping is deterministic from wallet id (or wallet-id hash) within the scope of the single AWS account; agent data is organized via prefixes inside that bucket.
4. Storage class is S3 Standard (or one other non-Glacier class as config allows); no Glacier.
5. Integration tests run against **real S3** (no localstack per spec); tests create/use test bucket and clean up.
6. Errors from S3 (e.g. access denied, not found, throttling) are surfaced to the Orchestrator in a consistent way for gateway to map to appropriate HTTP status.

## Dependencies

- Single AWS account and IAM roles/users for dev and prod.
- **Orchestrator** will call this module; no dependency on Gateway or Pricing for this feature.
- Bucket-per-wallet provisioning must create the bucket when needed; backend may “use existing” bucket created by provisioning or create-on-first-use via `createOrUseBucket`.

## RICE Score

| R               | I   | C    | E             | Score |
| --------------- | --- | ---- | ------------- | ----- |
| All MVP storage | 3   | 100% | 1 person-week | High  |

- **Reach:** All agent data in MVP.
- **Impact:** 3 (foundation for all persistence).
- **Confidence:** 100%.
- **Effort:** S (~1 week).

## Timeline

**S** (1 week)

## Hand-off Questions

1. Exact bucket naming convention: prefix + agent id hash, or org-scoped name? Any AWS naming/length constraints to enforce?
2. Should createOrUseBucket be called by Orchestrator on first use, or by Tenant Provisioning once per agent? Spec says “payment triggers sub-account creation and infra build” — does “infra” include bucket creation in the same CloudFormation stack?
3. For GET, do we need to support range requests in MVP or only full-object download?

---

## Antfarm hand-off

### Task string (copy-paste for `workflow run feature-dev`)

```
Build the S3 Storage Backend for mnemospark: storage provider module with createOrUseBucket(walletId, region), putObject, getObject, listObjects, deleteObject, getMetadata. Use @aws-sdk/client-s3 (v3), IAM in single AWS account. One bucket per wallet per region; agent data under prefixes inside bucket. S3 Standard only, no Glacier. Constraints: single account; bucket name deterministic from wallet id + region; no payment/402 in backend. Acceptance: [ ] @aws-sdk/client-s3 v3 and IAM auth; [ ] interface createOrUseBucket(walletId, region), putObject, getObject, listObjects, deleteObject, getMetadata; [ ] one bucket per wallet, agent data via prefixes; [ ] S3 Standard (or one non-Glacier class); [ ] integration tests against real S3, create/use test bucket and clean up; [ ] S3 errors surfaced consistently for gateway HTTP mapping.
```

### Verifier acceptance checklist

- [ ] Module uses **@aws-sdk/client-s3** (v3) and IAM roles for authentication (dev and prod).
- [ ] Interface supports: createOrUseBucket(walletId, region), putObject(bucket, key, body, options?), getObject(bucket, key), listObjects(bucket, prefix?), deleteObject(bucket, key), getMetadata(bucket, key).
- [ ] One bucket per wallet: bucket name or mapping deterministic from wallet id within single AWS account; agent data organized via prefixes.
- [ ] Storage class is S3 Standard (or one other non-Glacier class as config allows); no Glacier.
- [ ] Integration tests run against **real S3**; tests create/use test bucket and clean up.
- [ ] Errors from S3 (e.g. access denied, not found, throttling) surfaced to Orchestrator consistently for gateway HTTP status mapping.

---

## Customer Journey Map

Agent data is written and read through the gateway and orchestrator. The S3 backend is the final step where bytes are stored or retrieved. The agent never sees S3; they see “upload/download/list” and payment.

## UX Flow

Orchestrator receives (region, agentId, key, body for PUT). It resolves bucket (one per agent), then calls backend.putObject(bucket, key, body). Backend uses S3 PutObject. Flow is internal (no direct user UX beyond “request succeeded”).

## Edge Cases and Error States

| Scenario                  | Handling                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Bucket does not exist     | Backend or Orchestrator creates via createOrUseBucket (bucket-per-wallet in single account); retry. |
| S3 throttling (503)       | Retry with backoff; surface to gateway as 503 or 429.                                               |
| Key not found on GET      | Return 404 to Orchestrator → gateway returns 404.                                                   |
| Access denied (IAM)       | Log; return 403; ensure IAM role has correct bucket policy.                                         |
| Large object (e.g. > 5GB) | MVP: single PUT; if S3 limit exceeded, document and consider multipart in a later iteration.        |

## Data Requirements

- Backend does not store usage in a ledger; usage is derived from AWS APIs (S3, Cost Explorer) per spec.
- Backend may need to expose “bucket name for wallet” for Pricing or billing reporting (e.g. for GetCostForecast filter by bucket/tag).
