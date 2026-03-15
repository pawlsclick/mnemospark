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

- `/mnemospark-wallet` → wallet status/export/help
- `/mnemospark-cloud help` → storage command guide

---

## Core Commands

Use via `/mnemospark-cloud ...` in OpenClaw chat.

### Get a storage quote

```text
/mnemospark-cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <sha256> --gb <gb> --provider <provider> --region <region>
```

### Upload using quote

```text
/mnemospark-cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <sha256>
```

### List objects

```text
/mnemospark-cloud ls --wallet-address <addr> --object-key <object-key>
```

### Download object

```text
/mnemospark-cloud download --wallet-address <addr> --object-key <object-key>
```

### Delete object

```text
/mnemospark-cloud delete --wallet-address <addr> --object-key <object-key>
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

---

## Repos

- Plugin: `pawlsclick/mnemospark`
- Backend: `pawlsclick/mnemospark-backend`

