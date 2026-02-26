# Scripts

Development and install scripts for mnemospark.

## Install scripts (run once per machine)

**Prerequisites:** Node.js v20+ is required for pnpm. AWS credentials and GitHub auth are configured separately (IAM role, `aws configure`, `gh auth login`).

| Script                         | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `./scripts/install-pnpm.sh`    | Enable pnpm via Node corepack. Idempotent.       |
| `./scripts/install-aws-cli.sh` | Install AWS CLI v2 on Ubuntu x86_64. Idempotent. |
| `./scripts/install-jq.sh`      | Optional: install jq via apt. Idempotent.        |

Run from repo root, e.g.:

```bash
./scripts/install-pnpm.sh
./scripts/install-aws-cli.sh
```

AWS CLI credentials are not installed by the script; use IAM role or `aws configure` per environment.

## Verification

```bash
./scripts/verify-dev-tools.sh
```

Checks: `aws --version`, `aws sts get-caller-identity`, `node -v`, `pnpm -v`, `git --version`, `gh auth status`. Optionally runs `pnpm install`, `pnpm build`, `pnpm test` unless `SKIP_PNPM_BUILD=1`.

Full pass requires AWS credentials and `gh auth login` to be configured.

## Optional: jq

jq is optional (per development_tools_requirements_doc). To install on Ubuntu:

```bash
sudo apt install -y jq
```

Or run `./scripts/install-jq.sh` if present.

## Documentation (`.company`)

Documentation lives in the **mnemospark-docs** Git submodule at `.company`. After cloning this repo, run `git submodule update --init` to populate `.company` (or clone with `git clone --recurse-submodules`). Do not edit `.company` here; edit in the [mnemospark-docs](https://github.com/pawlsclick/mnemospark-docs) repo, then update the submodule pointer in this repo.

## Seed mnemospark-backend (examples and legacy)

Before running Cursor Cloud Agent on backend features (01–10, 15–18), you may seed **mnemospark-backend** with examples from this repo (docs are now provided via the mnemospark-docs submodule in both repos):

```bash
./scripts/seed-mnemospark-backend.sh /path/to/mnemospark-backend
```

Then open mnemospark-backend in Cursor and start the Cloud Agent there. See [.company/features_cursor_dev/README.md](../.company/features_cursor_dev/README.md) for where to run each feature.

## Other scripts

- `reinstall.sh` — Reinstall mnemospark OpenClaw plugin.
- `uninstall.sh` — Uninstall mnemospark plugin and clean config.
