# Cursor Dev: CloudFormation — WAF

**ID:** cursor-dev-15  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

## Scope

Add a **CloudFormation** template (or nested stack) that creates an **AWS WAF Web ACL** with AWS managed rule groups (e.g. Core, Known Bad Inputs), and **associates** the Web ACL with the API Gateway stage. This is the “first line of defense” before API Gateway per [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md). Depends on cursor-dev-08 (API Gateway and stage must exist). Keep this run to WAF only—no other infra.

## References

- [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) — WAF as first line of defense, Web ACL, managed rule groups, association with API stage

## Cloud Agent

- **Install (idempotent):** AWS CLI (`aws cloudformation validate-template`).
- **Start (if needed):** None.
- **Secrets (Cursor Settings → Cloud Agents → Secrets):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- **Acceptance criteria (checkboxes):**
  - [ ] CloudFormation template defines AWS WAF Web ACL (AWS::WAFv2::WebACL or equivalent).
  - [ ] At least one AWS managed rule group attached (e.g. Core rule set, Known bad inputs).
  - [ ] Web ACL is associated with the API Gateway REST API stage (e.g. AWS::WAFv2::WebACLAssociation or console association); stage ID/ARN can be parameter or output from API stack.
  - [ ] Template validates: `aws cloudformation validate-template --template-body file://template.yaml` (or URL) succeeds.
  - [ ] Stack deploys (or deploy dry-run / change-set) without errors; or README documents how to deploy after API stack.

## Task string (optional)

Add CloudFormation template for AWS WAF: Web ACL with AWS managed rule groups (e.g. Core, Known Bad Inputs), associate with API Gateway stage. Ref: infrastructure_design/internet_facing_API.md. Depends on 08. Acceptance: [ ] Web ACL resource; [ ] managed rule groups; [ ] association with API stage; [ ] template validates; [ ] deploy or doc.
