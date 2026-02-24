# Development Tools Requirements — Specification (for PM)

**Purpose:** This spec defines the **development tools** that must be installed and configured on the **Ubuntu development instance** so that AI agents (e.g. Antfarm or OpenClaw-based agents) can develop the mnemospark project. The Product Manager should use this spec to produce the **development_tools_requirements_doc.md** (the canonical requirements document for ops/onboarding).

**Audience:** Product Manager (consumer of this spec); ops / DevOps (consumer of the resulting requirements doc); agent orchestrators (who need to know what is available on the instance).

**References:**

- **Target environment:** [.company/system_audit_2026-02-19.md](.company/system_audit_2026-02-19.md) — Ubuntu 24.04 LTS (noble), current tool status.
- **Product context:** [.company/mnemospark_product_spec_v2.md](.company/mnemospark_product_spec_v2.md) — technologies, AWS (S3, Organizations, CloudFormation, BCM, Cost Explorer), Node/TypeScript, OpenClaw plugin, Vitest.

---

## 1. Scope and definitions

### 1.1 What “development tools” means

- **CLI binaries and runtimes** that agents run on the host (e.g. `aws`, `node`, `git`, `gh`, `docker`).
- **Version and configuration requirements** so that agents can create and manage AWS resources (sub-accounts, S3 buckets, IAM roles, CloudFormation stacks), run the Node/TypeScript codebase, run tests (Vitest), and interact with OpenClaw (gateway, plugin) and Git/GitHub (PRs, issues).

### 1.2 Out of scope

- Application-level dependencies (e.g. `@aws-sdk/client-s3`, `viem`) are installed via the project’s `package.json`; they are not “development tools” in this spec.
- OpenClaw **skills** (how agents _use_ these tools) are specified separately in **development_skills_requirements_spec.md**.

---

## 2. Tools required by technology area

Derived from mnemospark product spec v2 and the system audit.

### 2.1 AWS (infrastructure and APIs)

| Tool        | Purpose                                                                                                                                                                                                                                                                                                                                             | Install method                                                                                                                                         | Min version / notes                                                                                      | Status (per system audit)    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **AWS CLI** | Create and manage AWS resources: Organizations (management/member accounts, OUs), S3 buckets (one per agent), IAM roles, CloudFormation stacks (2–3 regions). Agents may also use CLI for ad-hoc S3/CFN checks and scripting. BCM Pricing Calculator and Cost Explorer are used from application code via AWS SDK/APIs; CLI supports infra and ops. | Official installer (e.g. `curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"` + unzip + install) or `apt` if available. | v2.x recommended. Configure with `aws configure` or IAM role (instance profile) for the Ubuntu instance. | **NOT INSTALLED** — required |

**Configuration:**

- Credentials: IAM role attached to the EC2/instance (preferred) or `aws configure` with access key/secret for the management account (or a CI role).
- Region: Default region set (e.g. `us-east-1`); agents may pass `--region` for multi-region (2–3 regions in MVP).

### 2.2 Node.js runtime and package manager

| Tool        | Purpose                                                                                                                    | Install method                                                                                   | Min version / notes                         | Status (per system audit)                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------- |
| **Node.js** | Run OpenClaw plugin (mnemospark), TypeScript build (tsup), tests (Vitest). Product spec and package.json require Node ≥20. | `apt` (NodeSource), nvm, or official binary.                                                     | v20+ (v22 preferred; audit shows v22.22.0). | **INSTALLED** (22.22.0)                             |
| **pnpm**    | Package manager for workspace/plugin development; aligns with OpenClaw ecosystem. Used for install, build, test.           | `npm install -g pnpm` or corepack: `corepack enable && corepack prepare pnpm@latest --activate`. | Latest stable.                              | Not in audit — **recommend install** if not present |
| **npm**     | Fallback; package.json scripts use `npm` in places.                                                                        | Bundled with Node.                                                                               | Bundled.                                    | **INSTALLED** (10.9.4)                              |

**Note:** If the project standardizes on pnpm, the requirements doc should state “pnpm required”; otherwise “npm or pnpm.”

### 2.3 Version control and collaboration

| Tool                | Purpose                                                                                           | Install method                     | Min version / notes | Status (per system audit) |
| ------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------- | ------------------------- |
| **Git**             | Clone, branch, commit, push; required for PR-based workflows (e.g. Antfarm feature-dev, bug-fix). | `apt install git`.                 | 2.x.                | **INSTALLED** (2.43.0)    |
| **GitHub CLI (gh)** | Create and manage PRs, issues, repos from the command line; used by agents for “open PR” step.    | `apt install gh` or official docs. | v2.x.               | **INSTALLED** (2.86.0)    |

**Configuration:**

- Git: `user.name` and `user.email` (or equivalent automation identity).
- `gh`: `gh auth login` (or token) so agents can create PRs in the target org/repo.

### 2.4 OpenClaw (plugin host and CLI)

| Tool             | Purpose                                                                                                                                               | Install method                                                                                                        | Min version / notes                               | Status (per system audit)                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| **OpenClaw CLI** | Run gateway, install/load plugins (mnemospark), send messages, run agent. Agents use it to test the mnemospark plugin in a real OpenClaw environment. | Via Node: `npm install -g openclaw` or project devDependency `openclaw` and run via `pnpm openclaw` / `npx openclaw`. | Matches peer in package.json (e.g. `>=2025.1.0`). | Available via Node (project has `openclaw` in devDependencies) |

**Note:** No separate “OpenClaw” binary on the system; the requirement is “Node + openclaw package available globally or via project.” The requirements doc should state how agents are expected to invoke OpenClaw (e.g. `npx openclaw gateway`, `pnpm openclaw onboard`).

### 2.5 Containers (optional for MVP)

| Tool       | Purpose                                                                                                                                                      | Install method                        | Min version / notes | Status (per system audit) |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------- | ------------------------- |
| **Docker** | Run containers for isolation, local services, or future sandboxing (product spec mentions Docker for non-main session sandboxing). Optional for initial MVP. | `apt install docker.io` or Docker CE. | Current stable.     | **INSTALLED** (29.2.1)    |

**Note:** Product spec v2 does not mandate Docker for MVP; list as optional in the requirements doc unless PM decides otherwise.

### 2.6 Build and test (via Node)

| Tool                 | Purpose                                                                      | Install method                                                                                            | Min version / notes       | Status (per system audit)                  |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------ |
| **Vitest**           | Run unit and integration tests; product spec requires tests against real S3. | Via project: `pnpm add -D vitest` / already in devDependencies. Run with `pnpm test` or `npx vitest run`. | v4.x (from package.json). | No system install — **project dependency** |
| **tsup**             | Build TypeScript (plugin bundle).                                            | Project devDependency.                                                                                    | From package.json.        | No system install — **project dependency** |
| **TypeScript (tsc)** | Type-check.                                                                  | Project devDependency.                                                                                    | From package.json.        | No system install — **project dependency** |

**Note:** These are not host-level tools; the requirement is “Node + project install (pnpm install) so that `pnpm build` and `pnpm test` work.” The requirements doc should state that the instance must be able to run `pnpm install`, `pnpm build`, and `pnpm test` (and optionally `pnpm openclaw ...`).

### 2.7 Other (optional)

| Tool          | Purpose                                                                                    | Install method      | Status (per system audit)                 |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------- | ----------------------------------------- |
| **Make**      | Build automation if used by repo scripts.                                                  | `apt install make`. | **INSTALLED** (4.3)                       |
| **jq**        | Parse JSON (e.g. AWS CLI output) in scripts.                                               | `apt install jq`.   | Not in audit — optional                   |
| **Terraform** | Not required for MVP; product uses **CloudFormation** (AWS CLI / AWS SDK) for 2–3 regions. | N/A.                | **NOT INSTALLED** — not required per spec |

---

## 3. Summary for PM: what to put in development_tools_requirements_doc.md

The PM should produce a **development_tools_requirements_doc.md** that:

1. **States the goal:** Tools required on the Ubuntu development instance so that AI agents can develop mnemospark per the product spec (AWS infra, Node/OpenClaw plugin, tests, Git/PRs).
2. **Lists each tool** with:
   - **Name** and **purpose** (one line).
   - **Install method** (exact commands or links: e.g. AWS CLI v2 install, pnpm via corepack).
   - **Minimum version** where relevant (Node ≥20, AWS CLI v2, etc.).
   - **Configuration** (e.g. AWS credentials/role, Git identity, `gh auth`).
   - **Required vs optional** (e.g. AWS CLI required; Docker optional; Terraform not required).
3. **Maps to current instance:** Use the system audit to mark “already satisfied” vs “must install” (e.g. AWS CLI must be installed; Node and Git already present).
4. **Includes a verification section:** Commands the PM or ops can run to confirm each tool (e.g. `aws --version`, `node -v`, `pnpm -v`, `gh auth status`).
5. **References** this spec and the product spec v2 and system audit for traceability.

---

## 4. Traceability

| Product spec v2 area                                           | Tools required                            |
| -------------------------------------------------------------- | ----------------------------------------- |
| AWS S3, Organizations, CloudFormation (2–3 regions), IAM roles | AWS CLI                                   |
| Node/TypeScript plugin, OpenClaw peer, Vitest                  | Node.js, pnpm (or npm), OpenClaw via Node |
| One bucket per agent; sub-account creation                     | AWS CLI (Orgs, S3, IAM, CloudFormation)   |
| REST gateway, x402, BCM/GetCostForecast (in-app)               | Node.js (runtime); AWS CLI (infra only)   |
| PRs, branches, agent workflows                                 | Git, GitHub CLI                           |
| Real S3 integration tests                                      | AWS CLI + credentials/role; Node + Vitest |

This spec is the input for **development_tools_requirements_doc.md**. The skills that teach agents _how_ to use these tools are specified in **development_skills_requirements_spec.md**.
