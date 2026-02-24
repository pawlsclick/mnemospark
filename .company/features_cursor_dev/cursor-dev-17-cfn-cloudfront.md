# Cursor Dev: CloudFormation — CloudFront (optional)

**ID:** cursor-dev-17  
**Repo:** mnemospark-backend  
**Rough size:** One Cloud Agent run

## Scope

**Optional.** Add a **CloudFormation** template for **Amazon CloudFront** in front of the API: distribution with origin = API Gateway (custom domain or invoke URL), HTTPS only, TLS at the edge. If using a custom domain, ACM certificate (in us-east-1 for CloudFront) can be parameter or separate stack. Per [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) § Optional: CloudFront in front. Depends on cursor-dev-08 (API Gateway).

## References

- [infrastructure_design/internet_facing_API.md](../infrastructure_design/internet_facing_API.md) — Optional: CloudFront in front (TLS, custom domain, origin = API Gateway)

## Cloud Agent

- **Install (idempotent):** AWS CLI.
- **Start (if needed):** None.
- **Secrets (Cursor Settings → Cloud Agents → Secrets):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- **Acceptance criteria (checkboxes):**
  - [ ] CloudFormation defines CloudFront distribution (AWS::CloudFront::Distribution) with origin pointing to API Gateway (invoke URL or custom domain).
  - [ ] Viewer protocol policy enforces HTTPS; TLS 1.2+ (default policy or custom).
  - [ ] If custom domain: ACM certificate (us-east-1) referenced; alternate domain name(s) and DNS can be documented.
  - [ ] Template validates; stack deploys or change-set succeeds (or README with deploy steps).

## Task string (optional)

Add optional CloudFormation for CloudFront: distribution with origin = API Gateway, HTTPS only, TLS at edge. Optional ACM + custom domain. Ref: infrastructure_design/internet_facing_API.md. Depends on 08. Acceptance: [ ] CloudFront resource; [ ] HTTPS; [ ] template validates and deploys.
