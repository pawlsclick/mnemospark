# Cursor Dev: Lambda POST /estimate/transfer

**ID:** cursor-dev-02  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

## Scope

Implement the Lambda for `POST /estimate/transfer`: BCM-based data transfer (egress/ingress) cost estimate. Parse query or JSON body; return JSON per API spec §4.2. Add route to API Gateway (or document integration point). Include unit and integration tests. Use the design pattern from `examples/data-transfer-cost-estimate-api`.

## References

- [mnemospark_backend_api_spec.md](../mnemospark_backend_api_spec.md) §4.2
- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — mnemospark-backend API architecture
- Design pattern: `examples/data-transfer-cost-estimate-api`

## Cloud Agent

- **Install (idempotent):** `pip install -r requirements.txt` (or project’s equivalent for Lambda runtime).
- **Start (if needed):** None.
- **Secrets (Cursor Settings → Cloud Agents → Secrets):** AWS credentials if integration tests call BCM.
- **Acceptance criteria (checkboxes):**
  - [ ] Lambda handler accepts GET or POST with query params or JSON body: `direction`, `gb`, `region`, `rateType` (defaults per spec).
  - [ ] Response JSON includes `estimatedCost`, `currency`, `dataGb`, `direction`, `region`, `rateType` per API spec §4.2.
  - [ ] BCM used for data transfer cost; errors surfaced consistently.
  - [ ] Unit tests for handler and cost function; integration test against real BCM (or skipped if no creds).
  - [ ] Route or integration point for `POST /estimate/transfer` documented or wired.

## Task string (optional)

Implement the mnemospark-backend Lambda for POST /estimate/transfer: BCM-based data transfer cost (direction, gb, region). Parse query/body; return JSON per mnemospark_backend_api_spec.md §4.2. Use examples/data-transfer-cost-estimate-api as the design pattern. Acceptance: [ ] handler accepts direction/gb/region/rateType; [ ] response shape per spec; [ ] BCM used; [ ] unit + integration tests; [ ] route/integration documented or wired.
