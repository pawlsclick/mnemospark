# Development Tools — Requirements Document

**Version:** 1.0  
**Last updated:** February 2026  
**Audience:** Ops, DevOps, onboarding; AI agent orchestrators (Antfarm, OpenClaw-based agents)  
**Source:** [development_tools_requirements_spec.md](development_tools_requirements_spec.md)

---

## 1. Goal

This document defines the **development tools** that must be installed and configured on the **Ubuntu development instance** so that:

- **AI agents** (e.g. Antfarm, OpenClaw-based agents) can develop the **mnemospark** project per the product spec.
- Ops and onboarding can **provision and verify** the instance consistently.
- Agent orchestrators know **what is available** on the instance (CLI binaries, runtimes, config).

**In scope:** CLI binaries and runtimes on the host (e.g. `aws`, `node`, `git`, `gh`, `pnpm`), their versions and configuration.  
**Out of scope:** Application-level dependencies (e.g. `@aws-sdk/client-s3`, `viem`) — those are installed via the project’s `package.json`. OpenClaw **skills** (how agents use these tools) are specified in **development_skills_requirements_spec.md**.

**Target environment:** Ubuntu 24.04 LTS (noble). Current tool status is from [system_audit_2026-02-19.md](system_audit_2026-02-19.md).

---

## 2. Tools by area

### 2.1 AWS (infrastructure and APIs)

| Tool        | Purpose                                                                                                                                                                                                                                                                              | Required | Status (per audit)               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------- |
| **AWS CLI** | Create and manage AWS resources: Organizations (management/member accounts, OUs), S3 buckets (one per agent), IAM roles, CloudFormation stacks (2–3 regions). Used by agents for infra and ops; BCM Pricing Calculator and Cost Explorer are used from application code via AWS SDK. | **Yes**  | **NOT INSTALLED — must install** |

**Install method (AWS CLI v2):**

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip
sudo ./aws/install
rm -rf aws awscliv2.zip
```

Alternatively, use official [AWS CLI v2 install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) for Ubuntu.

**Minimum version:** v2.x.

**Configuration:**

- **Credentials:** IAM role attached to the EC2/instance (preferred) or `aws configure` with access key/secret for the management account (or a CI role). Agents must be able to call `aws sts get-caller-identity` successfully.
- **Region:** Default region set (e.g. `us-east-1`). Agents may pass `--region` for multi-region (2–3 regions in MVP).

---

### 2.2 Node.js runtime and package manager

| Tool        | Purpose                                                                                                                               | Required              | Status (per audit)                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------- |
| **Node.js** | Run OpenClaw plugin (mnemospark), TypeScript build (tsup), tests (Vitest). Product spec and package.json require Node ≥20.            | **Yes**               | **INSTALLED** (22.22.0)               |
| **pnpm**    | Package manager for workspace/plugin development; aligns with OpenClaw ecosystem. Used for `pnpm install`, `pnpm build`, `pnpm test`. | **Yes** (recommended) | Not in audit — **install if missing** |
| **npm**     | Fallback; package.json scripts may use `npm`.                                                                                         | Yes (bundled)         | **INSTALLED** (10.9.4)                |

**Install method (pnpm):**

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Or: `npm install -g pnpm`.

**Minimum version:** Node.js v20+ (v22 preferred). pnpm: latest stable.

**Note:** The instance must be able to run `pnpm install`, `pnpm build`, and `pnpm test` (and optionally `pnpm openclaw ...` or `npx openclaw ...`). If the project standardizes on pnpm, state “pnpm required”; otherwise “npm or pnpm.”

---

### 2.3 Version control and collaboration

| Tool                | Purpose                                                                                           | Required | Status (per audit)     |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------- | ---------------------- |
| **Git**             | Clone, branch, commit, push; required for PR-based workflows (e.g. Antfarm feature-dev, bug-fix). | **Yes**  | **INSTALLED** (2.43.0) |
| **GitHub CLI (gh)** | Create and manage PRs, issues, repos from the command line; used by agents for “open PR” step.    | **Yes**  | **INSTALLED** (2.86.0) |

**Install method:** `apt install git gh` (or follow [GitHub CLI install](https://cli.github.com/) for Ubuntu).

**Minimum version:** Git 2.x; gh v2.x.

**Configuration:**

- **Git:** `user.name` and `user.email` (or equivalent automation identity) set for commits.
- **gh:** `gh auth login` (or token) so agents can create PRs in the target org/repo. Verify with `gh auth status`.

---

### 2.4 OpenClaw (plugin host and CLI)

| Tool                    | Purpose                                                                                                                                               | Required | Status (per audit)                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| **OpenClaw (via Node)** | Run gateway, install/load plugins (mnemospark), send messages, run agent. Agents use it to test the mnemospark plugin in a real OpenClaw environment. | **Yes**  | Available via Node (project has `openclaw` in devDependencies) |

**Install method:** No separate system binary. Requirement: **Node.js** plus **openclaw** package available globally (`npm install -g openclaw`) or via project (`pnpm install` then `pnpm openclaw` / `npx openclaw`).

**Version:** Matches peer in package.json (e.g. `>=2025.1.0`).

**Usage:** Agents are expected to invoke OpenClaw via `npx openclaw gateway`, `pnpm openclaw onboard`, or equivalent project script.

---

### 2.5 Build and test (via Node / project)

| Tool                 | Purpose                                                                      | Required              | Status (per audit)    |
| -------------------- | ---------------------------------------------------------------------------- | --------------------- | --------------------- |
| **Vitest**           | Run unit and integration tests; product spec requires tests against real S3. | **Yes** (via project) | Project devDependency |
| **tsup**             | Build TypeScript (plugin bundle).                                            | Yes (via project)     | Project devDependency |
| **TypeScript (tsc)** | Type-check.                                                                  | Yes (via project)     | Project devDependency |

**Note:** These are **not** host-level installs. Requirement: **Node + project install** (`pnpm install`) so that `pnpm build` and `pnpm test` succeed. The instance must have network and credentials (AWS) for real S3 integration tests.

---

### 2.6 Containers (optional for MVP)

| Tool       | Purpose                                                                                                              | Required     | Status (per audit)     |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- |
| **Docker** | Run containers for isolation, local services, or future sandboxing. Product spec v2 does not mandate Docker for MVP. | **Optional** | **INSTALLED** (29.2.1) |

**Install method:** `apt install docker.io` or Docker CE.  
**Note:** List as optional unless PM decides otherwise for MVP.

---

### 2.7 Other (optional)

| Tool          | Purpose                                                                            | Required | Status (per audit)           |
| ------------- | ---------------------------------------------------------------------------------- | -------- | ---------------------------- |
| **Make**      | Build automation if used by repo scripts.                                          | Optional | **INSTALLED** (4.3)          |
| **jq**        | Parse JSON (e.g. AWS CLI output) in scripts.                                       | Optional | Not in audit                 |
| **Terraform** | Not required; product uses **CloudFormation** (AWS CLI / AWS SDK) for 2–3 regions. | **No**   | NOT INSTALLED — not required |

**Install (jq):** `apt install jq`.

---

## 3. Instance status summary

| Tool                | Required          | Status              | Action                                        |
| ------------------- | ----------------- | ------------------- | --------------------------------------------- |
| AWS CLI             | Yes               | NOT INSTALLED       | **Install** (see §2.1)                        |
| Node.js             | Yes               | INSTALLED (22.22.0) | Satisfied                                     |
| pnpm                | Yes (recommended) | Not in audit        | **Install if missing** (see §2.2)             |
| npm                 | Yes               | INSTALLED (10.9.4)  | Satisfied                                     |
| Git                 | Yes               | INSTALLED (2.43.0)  | Satisfied                                     |
| GitHub CLI (gh)     | Yes               | INSTALLED (2.86.0)  | Satisfied                                     |
| OpenClaw (via Node) | Yes               | Via project         | Ensure `pnpm install` and `npx openclaw` work |
| Vitest / tsup / tsc | Yes (project)     | Project deps        | Ensure `pnpm build` and `pnpm test` work      |
| Docker              | Optional          | INSTALLED (29.2.1)  | Satisfied                                     |
| Make                | Optional          | INSTALLED (4.3)     | Satisfied                                     |
| jq                  | Optional          | Unknown             | Install if needed                             |
| Terraform           | No                | NOT INSTALLED       | Not required                                  |

---

## 4. Verification

Run these commands to confirm each tool. Ops or onboarding can use this as a checklist.

| Tool              | Command                                                                          | Expected (example)                                             |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| AWS CLI           | `aws --version`                                                                  | `aws-cli/2.x.x ...`                                            |
| AWS credentials   | `aws sts get-caller-identity`                                                    | Returns account id, user/role ARN                              |
| Node.js           | `node -v`                                                                        | `v22.x.x` or `v20.x.x`                                         |
| pnpm              | `pnpm -v`                                                                        | `9.x.x` or similar                                             |
| npm               | `npm -v`                                                                         | `10.x.x` or similar                                            |
| Git               | `git --version`                                                                  | `git version 2.x.x`                                            |
| GitHub CLI        | `gh auth status`                                                                 | Logged in to github.com; no auth errors                        |
| OpenClaw          | `cd <mnemospark-repo> && pnpm install && npx openclaw --version` (or equivalent) | Version or help output                                         |
| Build             | `cd <mnemospark-repo> && pnpm build`                                             | Exit 0                                                         |
| Test              | `cd <mnemospark-repo> && pnpm test`                                              | Tests pass (requires AWS credentials for S3 integration tests) |
| Docker (optional) | `docker --version`                                                               | `Docker version 29.x.x`                                        |
| jq (optional)     | `jq --version`                                                                   | `jq-1.7` or similar                                            |

**Full verification script (example):**

```bash
set -e
aws --version && aws sts get-caller-identity
node -v
pnpm -v
git --version
gh auth status
cd /path/to/mnemospark && pnpm install && pnpm build && pnpm test
```

---

## 5. Traceability

| Product spec v2 area                                           | Tools required                            |
| -------------------------------------------------------------- | ----------------------------------------- |
| AWS S3, Organizations, CloudFormation (2–3 regions), IAM roles | AWS CLI                                   |
| Node/TypeScript plugin, OpenClaw peer, Vitest                  | Node.js, pnpm (or npm), OpenClaw via Node |
| One bucket per agent; sub-account creation                     | AWS CLI (Orgs, S3, IAM, CloudFormation)   |
| REST gateway, x402, BCM/GetCostForecast (in-app)               | Node.js (runtime); AWS CLI (infra only)   |
| PRs, branches, agent workflows                                 | Git, GitHub CLI                           |
| Real S3 integration tests                                      | AWS CLI + credentials/role; Node + Vitest |

---

## 6. References

- **Source spec:** [development_tools_requirements_spec.md](development_tools_requirements_spec.md)
- **System audit:** [system_audit_2026-02-19.md](system_audit_2026-02-19.md)
- **Product context:** [mnemospark_product_spec_v2.md](mnemospark_product_spec_v2.md)
- **Skills (how agents use tools):** development_skills_requirements_spec.md
