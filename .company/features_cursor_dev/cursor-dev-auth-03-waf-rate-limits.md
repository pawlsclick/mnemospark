# Cursor Dev: WAF — rate limits for /price-storage

**ID:** auth-03  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). This repo is mnemospark-backend. Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Add or tune **rate-based rules** in the WAF (AWS WAF Web ACL): **price-storage:** per-IP rate limit (e.g. N requests per 5 minutes per IP). Optionally add per-wallet rate limiting for /price-storage if the authorizer exposes wallet context in a way WAF can key off (e.g. custom header or label); otherwise document that per-wallet rate limiting is enforced in Lambda. Storage paths: optionally stricter per-IP limit; primary auth is wallet proof. Keep existing managed rule groups (e.g. Core, Known Bad Inputs). Depends on cursor-dev-15 (WAF Web ACL exists) and auth-01/auth-02 (authorizer in place). Ref: [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §3.2; [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md).

## References

- [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §3.2 (WAF, rate limiting)
- [cursor-dev-15-cfn-waf.md](cursor-dev-15-cfn-waf.md) — existing WAF
- [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) — WAF, rate-based rules

## Cloud Agent

- **Install (idempotent):** AWS CLI; CloudFormation validate.
- **Start (if needed):** None.
- **Secrets (Cursor Settings → Cloud Agents → Secrets):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- **Acceptance criteria (checkboxes):**
  - [ ] Rate-based rule added for /price-storage: per-IP limit (e.g. configurable N requests per 5 minutes); scope to path /price-storage or equivalent.
  - [ ] Existing managed rule groups (Core, Known Bad Inputs) unchanged.
  - [ ] Optional: per-wallet rate limit for /price-storage if WAF can use authorizer context/header; otherwise README or comment documents that per-wallet limit is in Lambda.
  - [ ] Template or WAF update validates and deploys; no regression on existing WAF behavior.
  - [ ] All taggable resources tagged with `Project: mnemospark` (or `Application: mnemospark`).

## Task string (optional)

Work only in this repo. Add WAF rate-based rule for /price-storage: per-IP limit (e.g. N per 5 min). Keep managed rule groups. Optionally document or implement per-wallet limit. Ref: auth_no_api_key_wallet_proof_spec.md §3.2, cursor-dev-15. Acceptance: [ ] per-IP rate limit for price-storage; [ ] template/WAF update deploys.
