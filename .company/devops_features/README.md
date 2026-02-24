# DevOps Features — Antfarm feature-dev tasks

**Source:** [development_tools_requirements_doc.md](../development_tools_requirements_doc.md)  
**Purpose:** Discrete, token-efficient features for the AI agent team to implement so the Ubuntu development instance meets the development tools requirements. Each feature has a **task string** ready for `workflow run feature-dev "<task>"`.

**Target:** Ubuntu 24.04 LTS (noble). Repo = mnemospark.

---

## Feature list (implementation order)

| #   | Feature                                                    | Effort | Deliverable             |
| --- | ---------------------------------------------------------- | ------ | ----------------------- |
| 1   | [AWS CLI install](./feature-01-aws-cli-install.md)         | S      | Install script + doc    |
| 2   | [pnpm install](./feature-02-pnpm-install.md)               | XS     | Install script + doc    |
| 3   | [Git and GitHub CLI config](./feature-03-git-gh-config.md) | S      | Doc or script + README  |
| 4   | [Verification script](./feature-04-verification-script.md) | S      | Runnable script in repo |
| 5   | [Optional: jq install](./feature-05-optional-jq.md)        | XS     | Install step + doc      |

**Dependencies:** 1 and 2 can run in parallel. 3 can run after 1–2. 4 should run after 1–3 (verifies all). 5 is optional and independent.

---

## How to run with Antfarm

1. Copy the **Antfarm task string** from the feature doc (section "Antfarm task string") or from the table below.
2. Run: `workflow run feature-dev "<paste task string>"`.
3. Verifier checks the acceptance criteria; fix and retry if needed.

**Token tips:** One feature per run. Task string includes acceptance criteria so the verifier can gate without extra context. Scripts live in repo (e.g. `scripts/` or `.company/devops_features/`) so agents have a single source of truth.

### Task strings (copy-paste)

| Feature          | Task string (abbreviated; use full string from feature doc)                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 01 AWS CLI       | Implement AWS CLI v2 install for Ubuntu... script in scripts/install-aws-cli.sh... idempotent... doc with run instructions. |
| 02 pnpm          | Add pnpm install via corepack... scripts/install-pnpm.sh... idempotent... doc prerequisite Node v20+.                       |
| 03 Git/gh config | Document Git and GitHub CLI configuration... .company/devops_features/GIT_GH_CONFIG.md... user.name, user.email, gh auth.   |
| 04 Verification  | Add scripts/verify-dev-tools.sh... aws, node, pnpm, git, gh auth status... set -e, exit non-zero on failure.                |
| 05 jq (optional) | Document or script for apt install jq; optional; doc states optional.                                                       |

---

## Traceability

| Requirements doc section | Feature(s) |
| ------------------------ | ---------- |
| §2.1 AWS CLI             | Feature 01 |
| §2.2 pnpm                | Feature 02 |
| §2.3 Git / gh config     | Feature 03 |
| §4 Verification          | Feature 04 |
| §2.7 jq (optional)       | Feature 05 |
