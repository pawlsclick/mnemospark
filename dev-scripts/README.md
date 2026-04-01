# Dev scripts

Development and install helpers for mnemospark. They live in the repo under `dev-scripts/` but are not part of the published npm package (`package.json` `files`). The `dev-scripts/` entry in `.gitignore` keeps extra scratch files there from being picked up accidentally.

## Install scripts (run once per machine)

**Prerequisites:** Node.js v20+ is required for pnpm. AWS credentials and GitHub auth are configured separately (IAM role, `aws configure`, `gh auth login`).

| Script                             | Purpose                                          |
| ---------------------------------- | ------------------------------------------------ |
| `./dev-scripts/install-pnpm.sh`    | Enable pnpm via Node corepack. Idempotent.       |
| `./dev-scripts/install-aws-cli.sh` | Install AWS CLI v2 on Ubuntu x86_64. Idempotent. |
| `./dev-scripts/install-jq.sh`      | Optional: install jq via apt. Idempotent.        |

Run from repo root, e.g.:

```bash
./dev-scripts/install-pnpm.sh
./dev-scripts/install-aws-cli.sh
```

AWS CLI credentials are not installed by the script; use IAM role or `aws configure` per environment.

## Verification

```bash
./dev-scripts/verify-dev-tools.sh
```

Checks: `aws --version`, `aws sts get-caller-identity`, `node -v`, `pnpm -v`, `git --version`, `gh auth status`. Optionally runs `pnpm install`, `pnpm build`, `pnpm test` unless `SKIP_PNPM_BUILD=1`.

Full pass requires AWS credentials and `gh auth login` to be configured.

## Optional: jq

jq is optional (per development_tools_requirements_doc). To install on Ubuntu:

```bash
sudo apt install -y jq
```

Or run `./dev-scripts/install-jq.sh` if present.

## Documentation

Documentation lives in the separate **mnemospark-docs** repository. Clone or open that repo directly when editing product and API docs:

- Repo: `git@github.com:pawlsclick/mnemospark-docs.git`

Do not expect a `.company` subdirectory in this repo; that Git submodule has been removed in favor of working directly in `mnemospark-docs`.

## Other scripts

- `reinstall.sh` — Reinstall mnemospark OpenClaw plugin.
- `uninstall.sh` — Uninstall mnemospark plugin and clean config.
