# mnemospark Feature Specs (from Product Spec v3 + PRD v2)

Feature decomposition from [mnemospark_product_spec_v3.md](../mnemospark_product_spec_v3.md) and [mnemospark_PRD.md](../mnemospark_PRD.md). Each feature is MVP-complete, shippable independently, and sized for ~1 sprint (2 weeks max) where possible. **MVP scope:** single AWS account, one bucket per wallet, **client-held envelope encryption only** (KEK/DEK; no Phase 1 SSE-S3/SSE-KMS). See PRD v2.1 and [mnemospark_full_workflow.md](../mnemospark_full_workflow.md).

## Feature Roadmap (8–12 weeks)

| #   | Feature                                                                    | Timeline | Type                 |
| --- | -------------------------------------------------------------------------- | -------- | -------------------- |
| 1   | [x402 Storage Gateway](./feature-01-x402-storage-gateway.md)               | M        | Technical Foundation |
| 2   | [S3 Storage Backend](./feature-02-s3-storage-backend.md)                   | S        | Technical Foundation |
| 3   | [Pricing Module](./feature-03-pricing-module.md)                           | M        | Technical Foundation |
| 4   | [Orchestrator](./feature-04-orchestrator.md)                               | S        | Technical Foundation |
| 5   | [Bucket-per-wallet provisioning](./feature-05-tenant-provisioning.md)      | M        | Technical Foundation |
| 6   | [Agent-Facing Storage API](./feature-06-agent-facing-storage-api.md)       | M        | Customer-facing      |
| 7   | [OpenClaw Plugin Integration](./feature-07-openclaw-plugin-integration.md) | M        | Customer-facing      |

## Implementation Plan

- **Weeks 1–2:** S3 Storage Backend (feature 2), Orchestrator (feature 4) — foundation pieces with no payment dependency; one bucket per wallet in single account.
- **Weeks 3–4:** Pricing Module (feature 3) — BCM + GetCostForecast + markup; required before gateway can quote.
- **Weeks 5–6:** x402 Storage Gateway (feature 1) — 402 flow, quote, verify, call orchestrator; depends on 2, 3, 4.
- **Weeks 7–8:** Agent-Facing Storage API (feature 6) — REST contract and idempotency; can be developed in parallel with gateway, finalized after gateway.
- **Weeks 9–10:** Bucket-per-wallet provisioning (feature 5) — create bucket for wallet in single AWS account when needed; triggered on first verified payment (no Organizations/CloudFormation).
- **Weeks 11–12:** OpenClaw Plugin Integration (feature 7) — plugin surface, config, commands, gateway lifecycle.

## Prioritization (Weighted RICE)

Impact 40%, Confidence 30%, Reach 20%, Effort 10%. Foundation features (2, 3, 4, 5) build first; gateway (1) and API (6) unlock customer value; plugin (7) completes the MVP. PRD v2.1 drives Antfarm task strings and acceptance criteria.

## PRD and requirements traceability

- **PRD v2.1:** [mnemospark_PRD.md](../mnemospark_PRD.md) — Problem, Goals, Users, Requirements (R1–R14), MVP = client-held encryption only, Success metrics, Out of scope, Open questions, Antfarm contract.
- **Traceability:** Each feature doc lists the PRD requirements it fulfills (e.g. R1, R2). The PRD’s “PRD → Feature mapping” section maps requirements to features.

## Spec Feedback for Sr. Engineer

See [spec_feedback_for_sr_engineer.md](./spec_feedback_for_sr_engineer.md) for open decisions, ambiguities, and technical follow-ups to align with the spec.
