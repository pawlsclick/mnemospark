# Feature: Install and enable pnpm on Ubuntu dev instance

**Source:** [development_tools_requirements_doc.md](../development_tools_requirements_doc.md) §2.2  
**Effort:** XS | **Dependencies:** Node.js (already installed per audit)

---

## Problem

pnpm is not listed in the system audit; the requirements doc says "install if missing." Agents need `pnpm install`, `pnpm build`, and `pnpm test` for mnemospark. Without pnpm, the project may not standardize on the preferred package manager.

## Solution

Add a **reusable install script** that enables pnpm via Node corepack (`corepack enable` + `corepack prepare pnpm@latest --activate`). Document how to run it. Script must be idempotent (if `pnpm -v` already works, exit 0).

## Acceptance criteria

- [ ] Repo contains a script (e.g. `scripts/install-pnpm.sh` or `.company/devops_features/scripts/install-pnpm.sh`) that runs `corepack enable` and `corepack prepare pnpm@latest --activate` (or equivalent so `pnpm -v` works).
- [ ] Script is executable and idempotent: if `pnpm -v` succeeds, script exits 0 without failing.
- [ ] README or doc states how to run the script and that Node.js v20+ must be installed first.
- [ ] After running the script on a box with Node but no pnpm, `pnpm -v` returns a version (e.g. 9.x.x) and `pnpm install` works in the mnemospark repo.

## Antfarm task string

```
Add pnpm install for Ubuntu dev instance using Node corepack. Create script that runs: corepack enable; corepack prepare pnpm@latest --activate. Script location: scripts/install-pnpm.sh or .company/devops_features/scripts/install-pnpm.sh. Make idempotent: if pnpm -v succeeds, exit 0. Document in scripts/README or devops_features: run instructions, prerequisite Node v20+. Acceptance: script exists and is executable; after run, pnpm -v returns version and pnpm install works in repo root; doc exists.
```

## Hand-off notes

- **REPO:** mnemospark. Node is already on instance (22.22.0); script only needs corepack.
- **Verifier:** Run script then `pnpm -v` and `pnpm install` in repo; second run of script exits 0.
