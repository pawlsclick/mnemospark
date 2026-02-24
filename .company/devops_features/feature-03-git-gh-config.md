# Feature: Document Git and GitHub CLI configuration for agents

**Source:** [development_tools_requirements_doc.md](../development_tools_requirements_doc.md) §2.3  
**Effort:** S | **Dependencies:** None (Git and gh already installed)

---

## Problem

Git and GitHub CLI are installed but must be **configured** for agent use: Git needs `user.name` and `user.email` for commits; `gh` needs auth (token or `gh auth login`) so agents can create PRs. The requirements doc specifies this; there is no single place in the repo that tells ops or agents how to set it.

## Solution

Add a **configuration doc** (and optionally a small script that sets Git config only) in the repo. Doc must state: (1) Git: set `user.name` and `user.email` for the automation/agent identity; (2) GitHub CLI: run `gh auth login` or set token so `gh auth status` succeeds and PRs can be created. Do not store secrets in repo; doc only. Optional: script that accepts env vars (e.g. `GIT_USER_NAME`, `GIT_USER_EMAIL`) and runs `git config --global user.name` / `user.email`.

## Acceptance criteria

- [ ] Repo contains a doc (e.g. `.company/devops_features/GIT_GH_CONFIG.md` or section in `development_tools_requirements_doc.md` / `scripts/README.md`) that describes: (a) Git: set `user.name` and `user.email` (with example or env var names); (b) gh: authenticate via `gh auth login` or token, verify with `gh auth status`.
- [ ] Doc states that no secrets should be committed; use env or interactive auth.
- [ ] Optional: script `scripts/configure-git-for-agent.sh` (or similar) that sets `git config --global user.name "$GIT_USER_NAME"` and `user.email "$GIT_USER_EMAIL"` when env vars are set; script is executable and documented.
- [ ] A reader can follow the doc to configure a fresh instance so that `git config user.name` and `gh auth status` show expected state.

## Antfarm task string

```
Document Git and GitHub CLI configuration for agent use on the dev instance. Add doc (e.g. .company/devops_features/GIT_GH_CONFIG.md) with: (1) Git: set user.name and user.email for commits (example or env vars GIT_USER_NAME, GIT_USER_EMAIL); (2) gh: authenticate via gh auth login or token, verify with gh auth status. State that secrets must not be committed. Optional: add script that sets git config --global user.name and user.email from env vars; document script. Acceptance: doc exists and describes both Git and gh config; optional script if present is executable and documented; reader can follow doc to get git config and gh auth status working.
```

## Hand-off notes

- **REPO:** mnemospark. Git 2.43 and gh 2.86 are already installed; this feature is config only.
- **Verifier:** Doc exists; instructions are complete; no secrets in repo.
