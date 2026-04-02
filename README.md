# mnemospark

**Wallet and go. 💙**  
_No forms. No email. Just Base. 💙_

mnemospark is an agentic service layer for OpenClaw plus a standalone x402 payment + verification backend. It enables encrypted, authenticated, fully autonomous cloud and data workflows—paid via x402 with USDC on Base. No human onboarding. No API keys. The blockchain transaction is the record.

---

## What is mnemospark?

mnemospark connects OpenClaw agents to cloud workflows with wallet-native auth + payment rails.

- **Wallet-native authentication** for storage/API actions
- **x402-native payments** with USDC on Base
- **Agent-first flow** (quote → pay → provision)
- **Encrypted payload support** and structured request signing
- **Built for automation** (cron-friendly, idempotent-friendly workflows)

---

## Quick Start

### 1) Install the plugin in OpenClaw

```bash
openclaw plugins install mnemospark --dangerously-force-unsafe-install
openclaw gateway start
```

> Plugin registration is done by `openclaw plugins install mnemospark`.
> The install also bundles the `skills/mnemospark` skill package so the main agent can delegate mnemospark workflows.

### 2) (Optional) Initialize wallet helpers

```bash
npx mnemospark install --standard
```

This creates/reuses local wallet helper files under `~/.openclaw/mnemospark/`.

### 3) Restart gateway after updates

```bash
openclaw gateway restart
```

### 4) Use slash commands in OpenClaw chat

- `/mnemospark wallet` → wallet status; `/mnemospark wallet help` → commands
- `/mnemospark cloud help` → storage command guide

---

## OpenClaw Install Warning

If OpenClaw shows a warning about **dangerous code patterns** when installing or updating mnemospark—often mentioning shell execution (`child_process`), environment variables, and network access—here is what is going on.

mnemospark is an **OpenClaw plugin** that talks to **your configured mnemospark backend**, runs a **local HTTP proxy** for storage workflows, and can **invoke the `openclaw` CLI** and system tools when needed (for example creating archives with `tar` or running `npm` when you use the update command). Those features use the same low-level Node.js APIs—`child_process` and `fetch`—that security tools also associate with risky software, so the installer may warn you even when the behavior is intentional and benign.

We also read **environment variables** you set on purpose (such as `MNEMOSPARK_BACKEND_API_BASE_URL`, `MNEMOSPARK_PROXY_PORT`, or wallet-related settings) so you can configure the plugin without editing code. Automated scans sometimes flag “environment access + network” as a possible credential-stealing pattern. In mnemospark, that combination exists because the plugin is **configurable and networked by design**, not because we are harvesting your unrelated secrets.

mnemospark is **open source**. If you want extra assurance, review the repository, search for `child_process`, `process.env`, and `fetch`, and run your own tests in a safe environment. The warning helps keep the ecosystem safe; for mnemospark it reflects **capabilities**, not a finding of malicious intent.

Have ChatGPT or your favorite LLM evaluate the mnemospark codebase. Here's a [starter link](https://chatgpt.com/share/69ce6119-52cc-8394-b9f9-c06528d85ea7).

---

## Slash command reference

**Syntax**

- **Chat / OpenClaw (primary):** use `key:value` for arguments (for example `wallet-address:0x…`, `region:us-east-1`). `key=value` is also accepted.
- **Agent-driven workflows and CLI-style usage:** prefer `--parameter value` (for example `npx mnemospark` or shell scripts).

**Top-level routes** (after `/mnemospark`)

- `/mnemospark` or `/mnemospark help` — overview
- `/mnemospark cloud …` — cloud storage (see below)
- `/mnemospark wallet …` — wallet helpers

**`/mnemospark cloud`** — includes: `cloud` / `cloud help`, `backup`, `price-storage`, `upload`, `payment-settle`, `ls`, `download`, `delete`, `op-status`. Optional flags include `async:true`, `orchestrator:inline|subagent`, `timeout-seconds:<n>`. For the full cloud guide, run `/mnemospark cloud help` in chat.

**`/mnemospark wallet`**

- `/mnemospark wallet` — address, balance, and key file path
- `/mnemospark wallet help` — command list and funding link
- `/mnemospark wallet export` — export private key for backup (sensitive)

---

## Core Commands

Use via `/mnemospark cloud …` (or `/mnemospark wallet …`) in OpenClaw chat. Prefer `key:value` in chat; use `--wallet-address` style for scripted or agent-driven flows.

### Get a storage quote

```text
/mnemospark cloud price-storage wallet-address:<addr> object-id:<id> object-id-hash:<sha256> gb:<gb> provider:aws region:us-east-1
```

Use other regions by changing `provider:` and `region:` (defaults: `aws` / `us-east-1`).

### Upload using quote

```text
/mnemospark cloud upload quote-id:<quote-id> wallet-address:<addr> object-id:<id> object-id-hash:<sha256>
```

### List objects

```text
/mnemospark cloud ls wallet-address:<addr> object-key:<object-key>
```

### Download object

```text
/mnemospark cloud download wallet-address:<addr> object-key:<object-key>
```

### Delete object

```text
/mnemospark cloud delete wallet-address:<addr> object-key:<object-key>
```

---

## Payment Model (x402 + Base)

mnemospark follows a quote-and-pay execution model:

1. Agent requests a quote.
2. Agent provides wallet-native + payment authorization.
3. Backend verifies payment/auth context.
4. Storage action executes.

The blockchain transaction is the payment record.

---

## Security Model

- Wallet-signed request authentication
- Encrypted payload flow (AES-256-GCM request contract)
- Idempotency-aware upload/payment handling
- Structured auth/payment event logging for traceability

> Keep wallet private keys secure. Anyone with the key can control wallet-authorized actions.

---

## Environment variables

Optional unless noted. All names use the `MNEMOSPARK_` prefix.

| Variable                             | Purpose                                                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MNEMOSPARK_BACKEND_API_BASE_URL`    | Base URL for the mnemospark backend API (required for the local HTTP proxy to forward storage calls). Example: `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}`.                                                             |
| `MNEMOSPARK_PROXY_PORT`              | TCP port for the mnemospark HTTP proxy (default `7120`).                                                                                                                                                                                  |
| `MNEMOSPARK_DOWNLOAD_DIR`            | Directory where the proxy writes downloaded objects (default `~/.openclaw/mnemospark/downloads/`).                                                                                                                                        |
| `MNEMOSPARK_WALLET_KEY`              | Path to the wallet private key file when not using the default `~/.openclaw/mnemospark/wallet/wallet.key`.                                                                                                                                |
| `MNEMOSPARK_REMOVE_BACKUP_FILE`      | After a **successful** cloud upload, delete the local backup archive under `~/.openclaw/mnemospark/backup/`. **Default when unset:** remove the file. Set to `0`, `false`, `no`, or `n` to keep it; `1`, `true`, `yes`, or `y` to remove. |
| `MNEMOSPARK_DISABLED`                | Set to `true` or `1` to disable plugin registration.                                                                                                                                                                                      |
| `MNEMOSPARK_DISABLE_SQLITE`          | Set to `1` to disable local SQLite (`state.db`); cloud commands that need local state will fail.                                                                                                                                          |
| `MNEMOSPARK_SQLITE_STRICT`           | Set to `1` so certain SQLite consistency checks (e.g. friendly-name verification after upload) throw instead of warning.                                                                                                                  |
| `MNEMOSPARK_PROXY_VERBOSE_404`       | When `1`, `true`, or `yes`, the local HTTP proxy includes a `message` field on **404** responses describing supported paths. Default (unset) is a generic JSON body `{ "error": "Not found" }` only (reduces reconnaissance).             |
| `MNEMOSPARK_CRON_AGENT_ID`           | OpenClaw agent id used for the monthly renewal cron (default `mnemospark-renewal`).                                                                                                                                                       |
| `MNEMOSPARK_CRON_NODE_BIN`           | Absolute path to `node` for renewal cron exec (default `/usr/bin/node`).                                                                                                                                                                  |
| `MNEMOSPARK_DISABLE_OPENCLAW_PREREQ` | Set to `1` to skip automatic runbook application everywhere it runs (plugin load, CLI install/update; for advanced debugging only).                                                                                                       |

---

## Typical Workflow

1. Install plugin
2. Fund Base wallet with USDC
3. Request quote
4. Execute upload (supports up to 5 GB files - multipart uploads coming soon!)
5. Confirm/list/download/delete as needed

---

## mnemospark Exec Approvals Runbook

On **OpenClaw 2026.4.x**, the **Mnemospark Renewal Agent Runbook** is applied when you install or update mnemospark (including `npx mnemospark install`, `npx mnemospark update`, `openclaw plugins install`, and when the gateway loads the plugin): it ensures a dedicated agent (`mnemospark-renewal` by default) with `tools.deny: ["subagents"]` and `tools.exec.ask: "off"`, updates `~/.openclaw/exec-approvals.json` so `/usr/bin/node` is allowlisted for that agent, and runs `openclaw config validate`. OpenClaw restarts the gateway when a plugin is installed or updated; mnemospark does not call `openclaw gateway restart` itself. After a **successful upload**, mnemospark registers the monthly renewal cron only (`--no-deliver`, `--agent`, and a `Command: /usr/bin/node …/dist/cli.js cloud payment-settle --renewal …` message). Override paths with `MNEMOSPARK_CRON_AGENT_ID` and `MNEMOSPARK_CRON_NODE_BIN` if your system differs.

---

## Troubleshooting

- **Missing wallet/auth errors**: verify wallet key is present and request signature headers are generated.
- **402 payment required**: expected in challenge flow; ensure client retries with payment authorization.
- **Upload/storage backend errors**: verify cloud permissions (e.g. bucket access + IAM role rights).
- **Command not recognized**: confirm plugin installed and gateway restarted.
- **Renewal cron / exec failures after upload**: ensure mnemospark was installed or updated through the normal path so the runbook ran (gateway load, `npx mnemospark install`, or `openclaw plugins install`). If the gateway never loaded the plugin, run install again or restart the gateway.
- **One-step operation correlation**: run `./skills/mnemospark/scripts/debug-operation.sh <operation-id>` (or omit ID to use latest).

---

## Repos

- Plugin: `pawlsclick/mnemospark`
- Backend: `pawlsclick/mnemospark-backend`
