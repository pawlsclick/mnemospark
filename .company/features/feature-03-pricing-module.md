# Feature: Pricing Module

**Source:** mnemospark Product Spec v3 — Sections 2, 3.2(4), 6, 7, 8, 10.1  
**PRD:** [mnemospark_PRD.md](../mnemospark_PRD.md) — R2 (activity fee quote), R3 (storage fee quote), R9 (no internal ledger)  
**Status:** Definable now

---

## Feature Name

Pricing Module (BCM + GetCostForecast + Markup)

## Problem

Every storage operation and monthly storage fee must be quoted and charged with a consistent model: **activity** (per-request) from BCM Pricing Calculator API + markup, **storage fee** (monthly) from GetCostForecast + markup. Without a dedicated pricing module, the gateway would duplicate pricing logic and markup configuration, and we’d risk inconsistent quotes or missing forecast data.

**User job:** “I see the exact cost (plus markup) for this upload/download/list and for my monthly storage, and I pay that amount via x402.”

## Solution

Implement a **Pricing Module** that:

1. **Activity quotes (per-request)**
   - **Upload (PUT):** Call **AWS BCM Pricing Calculator API** for S3 (service "Amazon Simple Storage Service", attributes: storage class, region, usage quantity). Produce estimates for storage, requests, and data transfer. Apply **markup percentage** (configurable). Return amount and breakdown for the gateway to put in 402 body.
   - **Download (GET):** Quote **egress** (data transfer out) via BCM Pricing Calculator API; apply markup; return amount.
   - **List:** Quote per LIST (or per 1000 keys) via BCM + markup.

2. **Storage fee (monthly)**
   - Use **AWS Cost Explorer GetCostForecast API**: TimePeriod, Metric (e.g. BLENDED_COST), Granularity (e.g. MONTHLY), Filter (by service, region, tags/bucket as needed).
   - Apply **markup** to forecasted amount. This is the **monthly storage fee** for one x402 per month per wallet/tenant.

3. **Config**
   - Markup percentage (single or separate for activity vs storage).
   - Region list (2–3 for MVP).
   - Storage class mapping (S3 Standard for MVP).
   - No internal ledger; usage source of truth is AWS APIs only.

Gateway (and any monthly billing flow) calls this module for quotes only; the module does not perform payments or storage operations.

## Success Metrics

- Activity quote (upload/download/list) matches BCM-based cost + configured markup within a defined tolerance (e.g. unit test with mocked BCM response).
- Monthly storage fee quote matches GetCostForecast result + markup.
- Markup is applied consistently and is configurable (e.g. via config or env).
- No region premium in MVP (cost + markup only).

## Acceptance Criteria

1. Module exposes: `getActivityQuote(operation, region, sizeOrCount?)` (and optionally key-specific params) returning amount and currency/metadata for 402.
2. Module exposes: `getStorageFeeQuote(tenantOrBucketScope, period)` using GetCostForecast, returning amount + markup for monthly x402.
3. BCM Pricing Calculator API is called with correct service, region, and usage attributes for S3 (storage, requests, data transfer) and for egress.
4. GetCostForecast is called with correct TimePeriod, Metric, Granularity, and Filter (e.g. by service S3, region, and scope for the tenant/bucket).
5. Markup percentage is read from config; applied to all quotes.
6. Unit tests with mocked BCM and GetCostForecast responses verify quote + markup math.
7. Documentation or code comments specify which BCM/GetCostForecast parameters are used (service names, attribute keys) for future maintenance.

## Dependencies

- AWS BCM Pricing Calculator API and Cost Explorer GetCostForecast API (credentials via IAM roles).
- Config: region list, storage class, markup.
- No dependency on Gateway or Orchestrator; Gateway depends on this module.

## RICE Score

| R                  | I   | C    | E              | Score |
| ------------------ | --- | ---- | -------------- | ----- |
| All MVP operations | 3   | 100% | 2 person-weeks | High  |

- **Reach:** Every quoted operation and monthly fee.
- **Impact:** 3 (revenue and trust in pricing).
- **Confidence:** 100% (APIs and markup model specified).
- **Effort:** M (~2 weeks).

## Timeline

**M** (2 weeks)

## Hand-off Questions

1. BCM Pricing Calculator API: exact endpoint and request shape for S3 (service id, attribute names for storage class, region, usage)? Is there a public doc or SDK we should align to?
2. GetCostForecast: how do we scope the filter to “this tenant’s bucket(s)” in a single-account model — by tag, by cost allocation tag on the bucket, by prefix, or a combination?
3. Should markup be one global percentage or separate for activity vs storage (e.g. 10% activity, 15% storage)?

---

## Antfarm hand-off

### Task string (copy-paste for `workflow run feature-dev`)

```
Build the Pricing Module for mnemospark: activity quotes (upload/download/list) via AWS BCM Pricing Calculator API + configurable markup; monthly storage fee quote via Cost Explorer GetCostForecast + markup. Expose getActivityQuote(operation, region, sizeOrCount?) and getStorageFeeQuote(tenantOrBucketScope, period). Config: markup %, region list (2-3), storage class (S3 Standard). No internal ledger; usage source of truth is AWS APIs. Constraints: Gateway calls for quotes only; no payment or storage ops in module. Acceptance: [ ] getActivityQuote and getStorageFeeQuote exposed with correct signatures; [ ] BCM called with correct S3 service, region, usage for upload/download/list and egress; [ ] GetCostForecast with correct TimePeriod, Metric, Granularity, Filter for tenant/bucket; [ ] markup from config applied to all quotes; [ ] unit tests with mocked BCM and GetCostForecast verify quote+markup math; [ ] docs or comments on BCM/GetCostForecast params used.
```

### Verifier acceptance checklist

- [ ] Module exposes `getActivityQuote(operation, region, sizeOrCount?)` returning amount and currency/metadata for 402.
- [ ] Module exposes `getStorageFeeQuote(tenantOrBucketScope, period)` using GetCostForecast, returning amount + markup for monthly x402.
- [ ] BCM Pricing Calculator API called with correct service, region, and usage attributes for S3 (storage, requests, data transfer) and egress.
- [ ] GetCostForecast called with correct TimePeriod, Metric, Granularity, and Filter (e.g. by service S3, region, scope for tenant/bucket).
- [ ] Markup percentage read from config; applied to all quotes.
- [ ] Unit tests with mocked BCM and GetCostForecast responses verify quote + markup math.
- [ ] Documentation or code comments specify which BCM/GetCostForecast parameters are used (service names, attribute keys).

---

## Customer Journey Map

Before the agent pays, they (or the client) need a quote. The Pricing Module provides that quote so the gateway can return 402 with the correct amount. For monthly storage, the same module provides the forecast-based fee.

## UX Flow

Gateway receives request → calls Pricing Module with operation type, region, size (if known) → Module returns amount + metadata → Gateway puts amount in 402 body. No direct user-facing UX; flow is internal.

## Edge Cases and Error States

| Scenario                                     | Handling                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| BCM or GetCostForecast unavailable / timeout | Return error to gateway; gateway returns 503 or 402 with “quote unavailable, retry later.” |
| New region not in config                     | Quote only for configured regions; otherwise error.                                        |
| Zero or negative forecast                    | Treat as zero; apply markup (0); or return minimal fee — product decision.                 |
| Missing or invalid config (markup, region)   | Fail at startup or at first quote; log clearly.                                            |

## Data Requirements

- Inputs: operation type, region, size or count (for LIST), tenant/bucket scope for storage fee.
- Outputs: amount (and optionally currency, breakdown) for 402. No persistence of quotes in this module unless we add audit (see spec feedback on activity log).
