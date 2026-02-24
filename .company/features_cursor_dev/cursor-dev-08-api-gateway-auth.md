# Cursor Dev: API Gateway + API key + CORS

**ID:** cursor-dev-08  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

## Scope

Implement the single internet-facing REST API using **CloudFormation or SAM**: API Gateway (REST) with one stage, path-based routing to Lambda functions, **API key required** (usage plan + API key), throttling and quotas, request validation where applicable, and CORS (allow headers: `Content-Type`, `x-api-key`, `Idempotency-Key`; methods: GET, POST, DELETE, OPTIONS). TLS only. Follow [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) for auth, throttling, and least privilege. Routes can be placeholders or wired to existing Lambdas (estimate/storage, estimate/transfer, price-storage, storage/upload, storage/ls, storage/download, storage/delete).

## References

- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) §1 (auth, CORS)
- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — path-to-Lambda table
- [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) — API Gateway, TLS, throttling, request validation

## Cloud Agent

- **Install (idempotent):** AWS CLI; SAM CLI if using SAM.
- **Start (if needed):** None.
- **Secrets (Cursor Settings → Cloud Agents → Secrets):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- **Acceptance criteria (checkboxes):**
  - [ ] CloudFormation or SAM template defines API Gateway REST API, one stage (e.g. prod), and path-based routing for at least the paths in the backend API spec (§3).
  - [ ] Usage plan and API key created; `ApiKeyRequired: true` on relevant methods; header `x-api-key` required.
  - [ ] Throttling and quotas set (account or stage/method level) per design doc.
  - [ ] CORS configured: allowed headers include `Content-Type`, `x-api-key`, `Idempotency-Key`; methods GET, POST, DELETE, OPTIONS.
  - [ ] Request validation enabled for body/query/headers where applicable.
  - [ ] Template validates (`aws cloudformation validate-template` or `sam validate`); stack deploys or dry-run succeeds.

## Task string (optional)

Implement API Gateway for mnemospark-backend via CloudFormation or SAM: REST API, stage, path-based routing to Lambdas, API key (usage plan + x-api-key), throttling, CORS (Content-Type, x-api-key, Idempotency-Key; GET, POST, DELETE, OPTIONS), request validation. Ref: infrastructure_design/internet_facing_API.md. Acceptance: [ ] API + routes; [ ] API key required; [ ] throttling; [ ] CORS; [ ] template validates and deploys.
