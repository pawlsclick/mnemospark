# Feature: Optional — Install jq on Ubuntu dev instance

**Source:** [development_tools_requirements_doc.md](../development_tools_requirements_doc.md) §2.7  
**Effort:** XS | **Dependencies:** None | **Required:** No (optional tool)

---

## Problem

jq is useful for parsing JSON (e.g. AWS CLI output) in scripts. The requirements doc lists it as optional and "not in audit." Adding a one-line install or doc ensures consistent onboarding when agents need jq.

## Solution

Either: (1) Add a single line to an existing "install optional tools" script or to the verification doc ("to install jq: `apt install jq`"), or (2) Add a tiny script `scripts/install-jq.sh` that runs `apt install -y jq` (or `sudo apt install -y jq`) and is idempotent. Document in scripts/README or devops_features that jq is optional.

## Acceptance criteria

- [ ] Repo documents how to install jq on Ubuntu (e.g. `apt install jq` or script). If script: `scripts/install-jq.sh` or similar, executable, idempotent (if `jq --version` works, exit 0).
- [ ] Doc states jq is optional per development_tools_requirements_doc.md.
- [ ] After following the doc or running the script, `jq --version` returns a version (e.g. jq-1.7).

## Antfarm task string

```
Add optional jq install for Ubuntu dev instance. Either document in scripts/README or devops_features: install with apt install jq; or add script scripts/install-jq.sh that runs sudo apt install -y jq, idempotent if jq --version already works. State in doc that jq is optional per development_tools_requirements_doc. Acceptance: doc or script exists; after install, jq --version succeeds; doc states optional.
```

## Hand-off notes

- **REPO:** mnemospark. This feature is optional; can be deprioritized or skipped if token budget is tight.
- **Verifier:** Doc or script present; `jq --version` works after following instructions.
