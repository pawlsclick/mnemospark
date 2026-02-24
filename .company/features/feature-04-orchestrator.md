# Feature: Orchestrator

**Source:** mnemospark Product Spec v3 — Sections 1.2, 3.2(3), 3.3.1, 5.2, 6, 8  
**PRD:** [mnemospark_PRD.md](../mnemospark_PRD.md) — R5 (orchestrator: region, bucket per wallet, storage class)  
**Status:** Definable now

---

## Feature Name

Orchestrator (region + bucket selection, S3 execution)

## Problem

Storage operations must be executed in the right **region** and the right **bucket** (**one per wallet**) with the right **storage class**. The gateway verifies payment and then needs a single component that decides “where” and “how” and runs the S3 operation. Without an orchestrator, gateway would embed region/bucket logic and couple directly to S3, making multi-region and multi-agent scaling harder.

**User job:** “My sync runs in the region I need, in my agent’s bucket, with the right storage class.”

## Solution

Implement an **Orchestrator** module that:

- **Inputs:** Region (from request or config), **wallet id** (or wallet-derived id), **agent id**, key, body (for PUT), and operation type (PUT, GET, LIST, etc.).
- **Logic:** Resolve **bucket** for this wallet (one bucket per wallet in the single AWS account). Within that bucket, resolve the **object key/prefix** for the agent (e.g. `agent=<agent-id>/...`). Resolve **storage class** (MVP: S3 Standard or one other non-Glacier class from config).
- **Output:** Call **S3 Storage Backend** (createOrUseBucket if needed, then putObject / getObject / listObjects / deleteObject / getMetadata). Return result or throw for gateway to map to HTTP response.

Orchestrator does not handle payment, 402, or quoting; it is called only after payment verification. It uses the Storage Backend (S3) only; no direct AWS SDK in orchestrator for S3 (backend encapsulates that).

## Success Metrics

- Every gateway-initiated storage operation after payment goes through the Orchestrator.
- Region and bucket selection are deterministic and consistent with “one bucket per wallet” and 2–3 regions in MVP.
- Integration tests: given region + walletId + agentId + key, orchestrator performs PUT then GET and returns correct body.

## Acceptance Criteria

1. Orchestrator exposes: `upload(region, walletId, agentId, key, body, options?)`, `download(region, walletId, agentId, key)`, `list(region, walletId, agentId, prefix?)`, and optionally `delete(region, walletId, agentId, key)`, `getMetadata(region, walletId, agentId, key)`.
2. Bucket resolution: walletId maps to exactly one bucket per region in the single AWS account; implementation uses Storage Backend `createOrUseBucket` or equivalent. Agent data is organized under prefixes within that bucket.
3. Region must be one of the configured MVP regions (2–3); otherwise return validation error.
4. Storage class is from config (S3 Standard for MVP); passed to backend if backend supports per-request class.
5. Errors from Storage Backend are propagated to caller (gateway) with enough context to return appropriate HTTP status (e.g. 404, 403, 503).
6. No payment or pricing logic in Orchestrator; no direct BCM or GetCostForecast calls.
7. Integration test with real S3: upload then download in one region; list prefix; verify bucket per wallet.

## Dependencies

- **S3 Storage Backend** (must exist first).
- Config: region list, storage class, any bucket-naming rules.
- Tenant model: Orchestrator assumes bucket exists or can be created in the single AWS account for the wallet (Bucket-per-wallet provisioning may create bucket; Orchestrator/backend create or use bucket).

## RICE Score

| R                  | I   | C    | E             | Score |
| ------------------ | --- | ---- | ------------- | ----- |
| All MVP operations | 3   | 100% | 1 person-week | High  |

- **Reach:** Every post-payment storage operation.
- **Impact:** 3 (enables correct placement and isolation).
- **Confidence:** 100%.
- **Effort:** S (~1 week).

## Timeline

**S** (1 week)

## Hand-off Questions

1. Is “region” always from the request (e.g. header or path), or can it default from config per tenant?
2. For “agent id”: is this the OpenClaw agent id? Spec: wallet → bucket per region; agent id → prefix within bucket.
3. Should Orchestrator call createOrUseBucket on first use, or does Bucket-per-wallet Provisioning always create the bucket so Orchestrator only “use”?

---

## Antfarm hand-off

### Task string (copy-paste for `workflow run feature-dev`)

```
Build the Orchestrator for mnemospark: given region, walletId, agentId, key (and body for PUT), resolve bucket per wallet in single AWS account and object key/prefix for agent (e.g. agent=<id>/...); call S3 Storage Backend (createOrUseBucket if needed, then putObject/getObject/listObjects/delete/getMetadata). Expose upload(region, walletId, agentId, key, body?), download(region, walletId, agentId, key), list(region, walletId, agentId, prefix?), optionally delete and getMetadata. Storage class from config (S3 Standard for MVP). No payment, 402, or BCM/GetCostForecast in Orchestrator. Constraints: 2-3 MVP regions; bucket per wallet; agent data under prefix in bucket. Acceptance: [ ] upload, download, list (and optional delete, getMetadata) exposed with walletId+agentId; [ ] walletId maps to one bucket per region; agent data under prefix in bucket; [ ] region must be configured MVP region or validation error; [ ] storage class from config; [ ] backend errors propagated for gateway HTTP status; [ ] no payment/pricing logic; [ ] integration test with real S3: upload then download, list prefix, verify bucket per wallet.
```

### Verifier acceptance checklist

- [ ] Orchestrator exposes: `upload(region, walletId, agentId, key, body, options?)`, `download(region, walletId, agentId, key)`, `list(region, walletId, agentId, prefix?)`, and optionally `delete`, `getMetadata`.
- [ ] Bucket resolution: walletId maps to exactly one bucket per region in single AWS account; agent data under prefixes within bucket.
- [ ] Region must be one of configured MVP regions (2–3); otherwise return validation error.
- [ ] Storage class from config (S3 Standard for MVP); passed to backend if supported.
- [ ] Errors from Storage Backend propagated to caller (gateway) with enough context for HTTP status (404, 403, 503).
- [ ] No payment or pricing logic in Orchestrator; no direct BCM or GetCostForecast calls.
- [ ] Integration test with real S3: upload then download in one region; list prefix; verify bucket per wallet.

---

## Customer Journey Map

After the agent pays, the gateway calls the Orchestrator. The agent’s data is written to or read from the chosen region and bucket. The agent does not see “orchestrator”; they see “upload succeeded” or “download succeeded.”

## UX Flow

Gateway (after verification) → Orchestrator.upload(region, agentId, key, body) → Backend.putObject(bucket, key, body) → result back to gateway → 200 to client. Internal only.

## Edge Cases and Error States

| Scenario                                   | Handling                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Region not in allowed list                 | Return 400 Bad Request to gateway.                                                         |
| Bucket missing (e.g. provisioning not run) | Backend createOrUseBucket or return 503 and log; gateway may retry or ask client to retry. |
| Backend returns 404 on GET                 | Propagate 404 to gateway.                                                                  |
| Backend throttled                          | Propagate 503/429; gateway can return same or 503.                                         |

## Data Requirements

- Orchestrator needs: region, agentId (or equivalent), key, body (PUT), prefix (LIST). No persistence of usage in Orchestrator; usage is from AWS APIs per spec.
