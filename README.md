# mnemospark

**Wallet and go. 💙**  
_No forms. No email. Just Base. 💙_

mnemospark is an agentic service layer for OpenClaw and a standalone x402 payment and wallet-proof verification backend. It provides encrypted, authenticated, and fully autonomous access to cloud infrastructure and proprietary data, paid via x402 with USDC on Base. No human onboarding. No API keys. The blockchain transaction is the record.

---

## What is mnemospark?

mnemospark connects OpenClaw agents to cloud workflows with wallet-native auth + payment rails.

- **Wallet-proof authentication** for storage/API actions
- **x402-native payments** with USDC on Base
- **Agent-first flow** (quote → pay → provision)
- **Encrypted payload support** and structured request signing
- **Built for automation** (cron-friendly, idempotent-friendly workflows)

---

## Quick Start

### 1) Install the plugin in OpenClaw

```bash
openclaw plugins install mnemospark
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

- `/mnemospark_wallet` → wallet status/export/help
- `/mnemospark_cloud help` → storage command guide

---

## Core Commands

Use via `/mnemospark_cloud ...` in OpenClaw chat.

### Get a storage quote

```text
/mnemospark_cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <sha256> --gb <gb> --provider aws --region us-east-1
```

Use other regions by changing `--provider` and `--region` (defaults: `aws` / `us-east-1`).

### Upload using quote

```text
/mnemospark_cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <sha256>
```

### List objects

```text
/mnemospark_cloud ls --wallet-address <addr> --object-key <object-key>
```

### Download object

```text
/mnemospark_cloud download --wallet-address <addr> --object-key <object-key>
```

### Delete object

```text
/mnemospark_cloud delete --wallet-address <addr> --object-key <object-key>
```

---

## Payment Model (x402 + Base)

mnemospark follows a quote-and-pay execution model:

1. Agent requests a quote.
2. Agent provides wallet-proof + payment authorization.
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

| Variable                          | Purpose                                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MNEMOSPARK_BACKEND_API_BASE_URL` | Base URL for the mnemospark backend API (required for the local HTTP proxy to forward storage calls). Example: `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}`.                                                             |
| `MNEMOSPARK_PROXY_PORT`           | TCP port for the mnemospark HTTP proxy (default `7120`).                                                                                                                                                                                  |
| `MNEMOSPARK_DOWNLOAD_DIR`         | Directory where the proxy writes downloaded objects (default `~/.openclaw/mnemospark/downloads/`).                                                                                                                                        |
| `MNEMOSPARK_WALLET_KEY`           | Path to the wallet private key file when not using the default `~/.openclaw/mnemospark/wallet/wallet.key`.                                                                                                                                |
| `MNEMOSPARK_REMOVE_BACKUP_FILE`   | After a **successful** cloud upload, delete the local backup archive under `~/.openclaw/mnemospark/backup/`. **Default when unset:** remove the file. Set to `0`, `false`, `no`, or `n` to keep it; `1`, `true`, `yes`, or `y` to remove. |
| `MNEMOSPARK_DISABLED`             | Set to `true` or `1` to disable plugin registration.                                                                                                                                                                                      |
| `MNEMOSPARK_DISABLE_SQLITE`       | Set to `1` to disable local SQLite (`state.db`); cloud commands that need local state will fail.                                                                                                                                          |
| `MNEMOSPARK_SQLITE_STRICT`        | Set to `1` so certain SQLite consistency checks (e.g. friendly-name verification after upload) throw instead of warning.                                                                                                                  |

---

## Typical Workflow

1. Install plugin
2. Fund Base wallet with USDC
3. Request quote
4. Execute upload
5. Confirm/list/download/delete as needed

---

## Troubleshooting

- **Missing wallet/auth errors**: verify wallet key is present and request signature headers are generated.
- **402 payment required**: expected in challenge flow; ensure client retries with payment authorization.
- **Upload/storage backend errors**: verify cloud permissions (e.g., bucket access + IAM role rights).
- **Command not recognized**: confirm plugin installed and gateway restarted.
- **One-step operation correlation**: run `./skills/mnemospark/scripts/debug-operation.sh <operation-id>` (or omit ID to use latest).

---

## Repos

- Plugin: `pawlsclick/mnemospark`
- Backend: `pawlsclick/mnemospark-backend`
