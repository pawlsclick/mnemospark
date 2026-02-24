# Feature: Install AWS CLI on Ubuntu dev instance

**Source:** [development_tools_requirements_doc.md](../development_tools_requirements_doc.md) §2.1  
**Effort:** S | **Dependencies:** None

---

## Problem

AWS CLI is **NOT INSTALLED** on the Ubuntu development instance (per system audit). Agents need it to create and manage AWS resources (Organizations, S3, IAM, CloudFormation) for mnemospark. Without it, infra and real S3 tests cannot run.

## Solution

Add a **reusable install script** for AWS CLI v2 on Ubuntu (x86_64) and document it. Script must be idempotent (skip or upgrade if already v2). Optionally set default region (e.g. `us-east-1`) via script or doc. Credentials are out of scope (IAM role or `aws configure` per environment).

## Acceptance criteria

- [ ] Repo contains a script (e.g. `scripts/install-aws-cli.sh` or `.company/devops_features/scripts/install-aws-cli.sh`) that installs AWS CLI v2 on Ubuntu using the official method (curl zip, unzip, `sudo ./aws/install`, cleanup).
- [ ] Script is executable and idempotent: if `aws --version` already reports v2.x, script exits 0 without reinstalling (or upgrades if desired).
- [ ] README or doc in repo (e.g. in `scripts/README.md` or `.company/devops_features/README.md`) states: how to run the script, minimum version v2.x, and that credentials must be configured separately (IAM role or `aws configure`).
- [ ] After running the script on a clean Ubuntu 24.04 (no AWS CLI), `aws --version` prints `aws-cli/2.x.x` and `aws sts get-caller-identity` succeeds when credentials are configured.

## Antfarm task string

```
Implement AWS CLI v2 install for Ubuntu dev instance. Add a script that: (1) Downloads AWS CLI v2 Linux x86_64 zip from official URL, (2) unzips and runs sudo ./aws/install, (3) removes zip and extracted dir. Make script idempotent: if aws --version already shows v2.x, exit 0. Place script in scripts/install-aws-cli.sh or .company/devops_features/scripts/install-aws-cli.sh. Add short doc (scripts/README or devops_features) with run instructions and note that credentials (IAM role or aws configure) are configured separately. Acceptance: script exists and is executable; on Ubuntu 24.04 without AWS CLI, running the script then aws --version shows aws-cli/2.x.x; doc exists.
```

## Hand-off notes

- **REPO:** mnemospark (this repo).
- **Branch:** feature branch per Antfarm; merge to main after review.
- **Verifier:** Run script on a box without AWS CLI (or in CI with mock) and assert `aws --version`; assert script is idempotent when run twice.
