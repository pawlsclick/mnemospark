# Development Skills Requirements — Specification (for PM)

**Purpose:** This spec defines the **OpenClaw skills** that agents need so they know **when and how** to use the development tools required for mnemospark. The Product Manager should use this spec to produce the **development_skills_requirements_doc.md** (the canonical list and scope of skills for authors/maintainers). Skill authors will then implement each skill as a **SKILL.md** (and optional supporting files) following OpenClaw guidelines.

**Audience:** Product Manager (consumer of this spec); skill authors / developers (who write SKILL.md content); agent orchestrators (who assign workflows that depend on these skills).

**OpenClaw skills reference:** [OpenClaw Docs — Tools: Skills](https://docs.openclaw.ai/tools/skills#skills). Skills are stored under the workspace (e.g. `~/.openclaw/workspace/skills/<skill-name>/SKILL.md`). Each skill has a **SKILL.md** with optional YAML frontmatter (name, description, metadata) and prose that instructs the agent when to use the skill and how to perform procedures.

**Example format (from project):** [examples/openclaw-skills-clawdbot-backup-1.0.1/SKILL.md](../examples/openclaw-skills-clawdbot-backup-1.0.1/SKILL.md) — frontmatter with `name`, `description`, `metadata.requires.bins`, `metadata.requires.env`; body with Overview, procedures, commands, examples, troubleshooting.

---

## 1. Scope and definitions

### 1.1 What “development skills” means

- **Skills** are documented capabilities (SKILL.md) that an agent can load to learn:
  - **When** to use a given tool or workflow (e.g. “when you need to create an S3 bucket or deploy CloudFormation”).
  - **How** to use it: commands, options, examples, and common pitfalls.
- Each skill is tied to one or more **tools** from **development_tools_requirements_spec.md**. The PM’s **development_tools_requirements_doc.md** lists what is installed; this spec (and the resulting **development_skills_requirements_doc.md**) lists what **skills** must exist so agents can use those tools correctly.

### 1.2 Skill format (OpenClaw-aligned)

- **Location:** `workspace/skills/<skill-name>/SKILL.md` (or as per OpenClaw workspace layout).
- **Frontmatter (YAML):**
  - `name`: Short identifier (e.g. `aws-cli`).
  - `description`: One or two sentences for discovery and tooltips.
  - `metadata`: Optional. Include `requires.bins` (list of CLI binaries the skill assumes, e.g. `["aws"]`) and `requires.env` (list of env vars if any, e.g. `["AWS_REGION"]`) so the system can gate or warn when the skill is used without the right tools.
- **Body:** Markdown with clear headings: Overview, When to use, Commands / procedures, Examples, Troubleshooting. Use code blocks for commands and outputs.

---

## 2. Skills required by tool area

Derived from **development_tools_requirements_spec.md** and **mnemospark_product_spec_v2.md**. Each subsection gives the PM enough to commission or describe the corresponding skill; the PM’s **development_skills_requirements_doc.md** can summarize these and add ownership, priority, and acceptance criteria.

---

### 2.1 AWS CLI skill (`aws-cli` or `aws_cli_skill`)

**Purpose:** Teaches agents how to use the AWS CLI to create and manage the AWS resources required by mnemospark: Organizations (management/member accounts, OUs), S3 buckets (one per agent), IAM roles, and CloudFormation stacks across 2–3 regions.

**When to use:** When the task involves creating or managing AWS resources: S3 buckets, CloudFormation stacks, Organizations structure, IAM roles/policies, or checking resource state (e.g. listing buckets, describing stacks).

**Requires (metadata):**

- `bins`: `["aws"]`
- `env`: Optional — `AWS_REGION`, `AWS_PROFILE`; document that credentials are via `aws configure` or instance role.

**Suggested SKILL.md outline:**

1. **Overview** — What the AWS CLI is and its role in mnemospark (infra provisioning, S3, CloudFormation, Orgs).
2. **When to use this skill** — Creating buckets, deploying/updating CloudFormation, listing accounts or buckets, inspecting IAM.
3. **Prerequisites** — AWS CLI installed and configured (role or profile); default region.
4. **Common commands:**
   - S3: `aws s3 ls`, `aws s3 mb s3://bucket-name`, `aws s3 cp`, `aws s3 rb`.
   - CloudFormation: `aws cloudformation deploy`, `aws cloudformation create-stack`, `aws cloudformation describe-stacks`, `aws cloudformation delete-stack`.
   - Organizations: `aws organizations list-accounts`, `aws organizations describe-organization`; creating member accounts/OUs if applicable.
   - IAM: `aws iam list-roles`, `aws iam get-role`; creating roles/policies when needed.
5. **Multi-region** — Passing `--region` for MVP’s 2–3 regions; CloudFormation templates per region.
6. **Examples** — One “create bucket in region X” and one “deploy CloudFormation stack” example.
7. **Troubleshooting** — Access denied, region not specified, CLI not configured; link to AWS docs.

**Deliverable for PM:** development_skills_requirements_doc.md should state that the **aws-cli** skill exists (or must be created) with the above scope and reference this spec.

---

### 2.2 Node.js and pnpm skill (`node-pnpm` or `node_pnpm_skill`)

**Purpose:** Teaches agents how to use Node.js and pnpm (or npm) to install dependencies, build the mnemospark plugin, run tests (Vitest), and run the OpenClaw CLI from the project.

**When to use:** When the task involves installing packages, building TypeScript (`pnpm build`), running tests (`pnpm test`), or invoking OpenClaw via the project (`pnpm openclaw ...` or `npx openclaw ...`).

**Requires (metadata):**

- `bins`: `["node", "pnpm"]` (or `["node", "npm"]` if npm-only).
- `env`: Optional — `NODE_ENV`.

**Suggested SKILL.md outline:**

1. **Overview** — Node.js as runtime for mnemospark (OpenClaw plugin); pnpm as package manager.
2. **When to use this skill** — Install, build, test, run OpenClaw CLI from repo.
3. **Prerequisites** — Node ≥20 (22 preferred); pnpm installed.
4. **Commands:**
   - `pnpm install` (or `npm install`) — install deps.
   - `pnpm build` — build plugin (tsup).
   - `pnpm test` / `pnpm run test` — run Vitest.
   - `pnpm openclaw ...` / `npx openclaw ...` — run OpenClaw CLI (gateway, onboard, etc.).
   - `pnpm run typecheck`, `pnpm run lint` — type-check and lint.
5. **Project layout** — Where `package.json`, `src/`, `dist/` live; that openclaw is a devDependency.
6. **Examples** — “After cloning: pnpm install && pnpm build”; “Run tests: pnpm test.”
7. **Troubleshooting** — Node version, ENOENT for pnpm, peer dependency (openclaw) warnings.

**Deliverable for PM:** Doc should state that the **node-pnpm** skill exists (or must be created) with the above scope.

---

### 2.3 Git and GitHub CLI skill (`git-gh` or `git_gh_skill`)

**Purpose:** Teaches agents how to use Git and GitHub CLI for branch-based workflows: create branch, commit, push, open PR, check status. Aligns with Antfarm (e.g. feature-dev, bug-fix) and other agent workflows that end in a PR.

**When to use:** When the task involves version control: cloning, branching, committing, pushing, creating or updating a pull request, or checking repo status.

**Requires (metadata):**

- `bins`: `["git", "gh"]`
- `env`: None required; document that `gh auth login` (or token) must be done for the repo/org.

**Suggested SKILL.md outline:**

1. **Overview** — Git for version control; gh for PRs and issues in GitHub.
2. **When to use this skill** — Creating a feature branch, committing changes, pushing, opening a PR, checking CI.
3. **Prerequisites** — Git configured (user.name, user.email); gh authenticated.
4. **Commands:**
   - Git: `git status`, `git checkout -b <branch>`, `git add`, `git commit -m "..."`, `git push -u origin <branch>`, `git pull --rebase`.
   - GitHub CLI: `gh pr create`, `gh pr list`, `gh pr view`, `gh pr checks`, `gh auth status`.
5. **Workflow** — Typical “feature branch → commit → push → gh pr create” flow.
6. **Examples** — One full example: branch name, commit message, opening PR with title/body.
7. **Troubleshooting** — Auth failures, push rejected, branch protection.

**Deliverable for PM:** Doc should state that the **git-gh** skill exists (or must be created) with the above scope.

---

### 2.4 OpenClaw plugin development skill (`openclaw-plugin` or `openclaw_plugin_skill`)

**Purpose:** Teaches agents how to run and test the mnemospark OpenClaw plugin: start the gateway, ensure the plugin is loaded, use relevant commands (e.g. `/wallet`, `/storage` when implemented), and where plugin config and workspace paths live.

**When to use:** When the task involves running the OpenClaw gateway, testing the mnemospark plugin, or verifying plugin install/config (e.g. after code changes).

**Requires (metadata):**

- `bins`: `["node"]` (OpenClaw runs via Node).
- `env`: Optional — `OPENCLAW_*` or config path if documented.

**Suggested SKILL.md outline:**

1. **Overview** — OpenClaw as the host for the mnemospark plugin; gateway + plugin lifecycle.
2. **When to use this skill** — Testing the plugin locally, running the gateway, checking that the plugin loads.
3. **Prerequisites** — Node; openclaw installed (globally or as project devDependency); mnemospark built (`pnpm build`).
4. **Commands:**
   - `openclaw onboard` (first-time setup).
   - `openclaw gateway --port 18789 --verbose` (start gateway).
   - `openclaw message send --to <target> --message "..."` (if needed).
   - Running from project: `pnpm openclaw gateway` or `npx openclaw gateway`.
5. **Plugin layout** — Where the plugin is loaded from (e.g. `dist/index.js`, openclaw.plugin.json); config under `~/.openclaw/` (openclaw.json, extensions, mnemospark config).
6. **Examples** — “Start gateway from repo after build”; “Verify plugin in OpenClaw.”
7. **Troubleshooting** — Plugin not loading, port in use, config not found.

**Deliverable for PM:** Doc should state that the **openclaw-plugin** skill exists (or must be created) with the above scope.

---

### 2.5 Vitest (testing) skill (`vitest` or `vitest_skill`)

**Purpose:** Teaches agents how to run the project’s Vitest tests, including integration tests against real S3 when applicable, and how to interpret test output and common failures.

**When to use:** When the task involves running tests, debugging test failures, or adding/running tests (unit or integration).

**Requires (metadata):**

- `bins`: `["node", "pnpm"]` (or `npm`).
- `env`: Optional — `AWS_REGION`, credentials for real S3 tests (or instance role).

**Suggested SKILL.md outline:**

1. **Overview** — Vitest as the test runner for mnemospark; unit tests and integration tests (including real S3 per product spec).
2. **When to use this skill** — Running full suite, running a subset, debugging a failing test.
3. **Commands:**
   - `pnpm test` — run all tests.
   - `pnpm run test:watch` — watch mode.
   - `npx vitest run <path>` — run specific file or pattern.
4. **Environment** — Real S3: AWS credentials/role; no localstack per product decision.
5. **Examples** — “Run tests after change”; “Run only tests in src/foo.”
6. **Troubleshooting** — Timeouts, AWS credentials missing, flaky tests.

**Deliverable for PM:** Doc should state that the **vitest** skill exists (or must be created) with the above scope.

---

### 2.6 Docker skill (optional) (`docker` or `docker_skill`)

**Purpose:** Teaches agents how to use Docker for containerized runs (e.g. sandboxing, local services). Optional for MVP per product spec; include if the PM decides agents need Docker for dev or CI.

**When to use:** When the task involves building images, running containers, or using Docker-based test/run scripts.

**Requires (metadata):**

- `bins`: `["docker"]`
- `env`: Optional — none.

**Suggested SKILL.md outline:**

1. **Overview** — Docker available on the instance; used for isolation or auxiliary services if at all.
2. **When to use** — Running a script that uses `docker run`, `docker build`, or docker-compose.
3. **Commands** — `docker run`, `docker build`, `docker ps`, `docker compose up` (if used).
4. **Examples** — As needed by repo (e.g. run a one-off container for tests).
5. **Troubleshooting** — Permission denied, daemon not running.

**Deliverable for PM:** Doc should state that the **docker** skill is **optional** and only required if the team adopts Docker for dev/CI.

---

## 3. Summary for PM: what to put in development_skills_requirements_doc.md

The PM should produce **development_skills_requirements_doc.md** that:

1. **States the goal:** Skills required so that AI agents (Antfarm, OpenClaw, or other) know when and how to use the development tools for mnemospark.
2. **Lists each skill** with:
   - **Name** (e.g. `aws-cli`, `node-pnpm`, `git-gh`, `openclaw-plugin`, `vitest`, optionally `docker`).
   - **One-line purpose** and **when to use**.
   - **Required tools** (from development_tools_requirements_doc.md): which bins and env the skill assumes.
   - **Content outline** (or link to this spec) so authors know what to put in SKILL.md.
   - **OpenClaw format** — Reference to [OpenClaw Docs — Skills](https://docs.openclaw.ai/tools/skills#skills) and the example SKILL.md (frontmatter, structure).
3. **Priority:** Which skills are required for MVP (aws-cli, node-pnpm, git-gh, openclaw-plugin, vitest) vs optional (docker).
4. **Ownership / acceptance:** Who authors or maintains each skill; definition of done (e.g. “SKILL.md exists, frontmatter has requires.bins, procedures cover commands in this spec”).
5. **Traceability:** Reference this spec and **development_tools_requirements_spec.md** (and product spec v2) for context.

---

## 4. Traceability

| Tool (from tools spec) | Skill(s)                                |
| ---------------------- | --------------------------------------- |
| AWS CLI                | aws-cli (aws_cli_skill)                 |
| Node.js, pnpm, npm     | node-pnpm (node_pnpm_skill)             |
| Git, GitHub CLI        | git-gh (git_gh_skill)                   |
| OpenClaw (via Node)    | openclaw-plugin (openclaw_plugin_skill) |
| Vitest (via project)   | vitest (vitest_skill)                   |
| Docker                 | docker (docker_skill) — optional        |

This spec is the input for **development_skills_requirements_doc.md**. Together with **development_tools_requirements_spec.md**, the PM has the full picture: what to install (tools doc) and what to teach (skills doc).
