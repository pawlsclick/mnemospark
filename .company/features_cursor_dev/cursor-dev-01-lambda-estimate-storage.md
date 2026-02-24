# Cursor Dev: Lambda POST /estimate/storage

**ID:** cursor-dev-01  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

## Scope

Implement the Lambda for `POST /estimate/storage`: BCM Pricing Calculator–based S3 storage cost estimate (GB, region). Parse query or JSON body; return JSON per API spec §4.1. Add route to API Gateway (or document integration point). Include unit and integration tests. Use the design pattern from `examples/s3-cost-estimate-api`.

## References

- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) §4.1
- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — mnemospark-backend API architecture
- Design pattern: `examples/s3-cost-estimate-api` (app.py, template.yaml)

## Cloud Agent

- **Install (idempotent):** `pip install -r requirements.txt` (or project’s equivalent for Lambda runtime).
- **Start (if needed):** None for this feature.
- **Secrets (Cursor Settings → Cloud Agents → Secrets):** AWS credentials if integration tests call BCM (e.g. `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`).
- **Acceptance criteria (checkboxes):**
  - [ ] Lambda handler accepts GET or POST with query params or JSON body: `gb` (required), `region`, `rateType`.
  - [ ] Response JSON includes `estimatedCost`, `currency`, `storageGbMonth`, `region`, `rateType` per API spec §4.1.
  - [ ] BCM Pricing Calculator used for S3 storage cost (e.g. TimedStorage-ByteHrs); errors surfaced consistently.
  - [ ] Unit tests for handler and cost function; integration test against real BCM (or skipped if no creds).
  - [ ] Route or integration point for `POST /estimate/storage` documented or wired (e.g. in SAM/CloudFormation).

## Task string (optional)

Implement the mnemospark-backend Lambda for POST /estimate/storage: BCM-based S3 storage cost (gb, region, rateType). Parse query/body; return JSON per mnemospark_backend_api_spec.md §4.1. Use examples/s3-cost-estimate-api as the design pattern. Acceptance: [ ] handler accepts gb/region/rateType; [ ] response shape per spec; [ ] BCM used for cost; [ ] unit + integration tests; [ ] route/integration documented or wired.
