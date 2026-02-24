# Feature: Add development tools verification script

**Source:** [development_tools_requirements_doc.md](../development_tools_requirements_doc.md) §4  
**Effort:** S | **Dependencies:** Features 01–03 (tools install/config); script can still be added before tools are present (will fail until tools exist)

---

## Problem

Ops and agents need a **single runnable script** that verifies all required development tools (AWS CLI, Node, pnpm, Git, gh, and optionally build/test). The requirements doc §4 lists commands but does not provide a script in the repo. Without it, verification is manual and error-prone.

## Solution

Add a **verification script** in the repo (e.g. `scripts/verify-dev-tools.sh` or `.company/devops_features/scripts/verify-dev-tools.sh`) that runs the checks from the requirements doc §4. Script must: exit 0 only if all required checks pass; exit non-zero and print clear message on first failure. Checks: `aws --version`, `aws sts get-caller-identity`, `node -v`, `pnpm -v`, `git --version`, `gh auth status`. Optional: from repo root, `pnpm install`, `pnpm build`, `pnpm test` (or skip test if no AWS creds). Document how to run the script (e.g. from repo root: `./scripts/verify-dev-tools.sh`).

## Acceptance criteria

- [ ] Repo contains a script (e.g. `scripts/verify-dev-tools.sh`) that runs in order: aws --version, aws sts get-caller-identity, node -v, pnpm -v, git --version, gh auth status. Script uses `set -e` or equivalent so first failure exits non-zero.
- [ ] Script prints a short message per check (e.g. "Checking aws... ok") and on failure prints which check failed.
- [ ] Script is executable. Doc (scripts/README or devops_features) states how to run it and that AWS credentials and gh auth must be configured for full pass.
- [ ] Optional: script includes steps for `pnpm install`, `pnpm build`, and `pnpm test` from repo root (can be behind a flag or env to skip test when no creds).
- [ ] When all required tools are installed and configured, running the script from repo root exits 0. When any required check fails, script exits non-zero.

## Antfarm task string

```
Add a verification script for development tools per development_tools_requirements_doc.md §4. Create scripts/verify-dev-tools.sh that runs: aws --version, aws sts get-caller-identity, node -v, pnpm -v, git --version, gh auth status. Use set -e; print short message per check; on failure print which check failed and exit non-zero. Script must be executable. Document in scripts/README or devops_features: how to run, that AWS and gh auth must be configured. Optional: add pnpm install, pnpm build, pnpm test from repo root (flag or env to skip test if no creds). Acceptance: script exists and is executable; when tools and config are present, script exits 0; when e.g. aws missing, script exits non-zero and reports failure; doc exists.
```

## Hand-off notes

- **REPO:** mnemospark. Script should assume it is run from repo root (or detect repo root).
- **Verifier:** Run with all tools present → 0; run with AWS CLI removed or unconfigured → non-zero and clear output.
