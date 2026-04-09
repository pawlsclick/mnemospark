# Mnemospark Commands Reference

Use explicit Node plus the absolute Mnemospark CLI path.

Host path on this machine:

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js
```

## Wallet entrypoint

Wallet lives outside the `cloud` subcommand family.

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js wallet
```

Use it for:

- wallet status
- funding info
- checking the configured wallet before cloud operations

## Cloud entrypoint

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud <subcommand> [arguments...]
```

Rules:

- Use `--key value` flags.
- Do not use slash-command syntax in shell commands.
- Do not rely on cwd.
- Prefer explicit `/usr/bin/node` in runbooks and stable automation.

## Backup

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud backup <file|directory> --name <friendly-name>
```

Optional async form:

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud backup <file|directory> --name <friendly-name> --async [--orchestrator <inline|subagent>] [--timeout-seconds <n>]
```

Notes:

- `--name` is required.
- `backup` does not require `--wallet-address`.

## Price storage

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud price-storage --wallet-address <wallet> --object-id <object-id> [--object-id-hash <hash>] --gb <size-gb> --provider <provider> --region <region>
```

Notes:

- `--provider` and `--region` are required.
- After a local backup, `--object-id-hash` may be omitted if SQLite lookup works.
- If lookup fails, pass `--object-id-hash` explicitly from `backup.completed`.

## Upload

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud upload --quote-id <quote-id> --wallet-address <wallet> --object-id <object-id> --object-id-hash <hash> [--name <friendly-name>]
```

Optional async form:

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud upload --quote-id <quote-id> --wallet-address <wallet> --object-id <object-id> --object-id-hash <hash> [--name <friendly-name>] --async [--orchestrator <inline|subagent>] [--timeout-seconds <n>]
```

Notes:

- `--name` must match local SQLite metadata exactly when supplied.

## List

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud ls --wallet-address <wallet> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]
```

## Download

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud download --wallet-address <wallet> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]
```

Optional async form:

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud download --wallet-address <wallet> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] --async [--orchestrator <inline|subagent>] [--timeout-seconds <n>]
```

## Delete

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud delete --wallet-address <wallet> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]
```

## Payment settle

Quote path:

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud payment-settle --quote-id <quote-id> --wallet-address <wallet> [--object-id <object-id>] [--object-key <object-key>] [--storage-price <price>]
```

Renewal path:

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud payment-settle --renewal --object-key <object-key> --wallet-address <wallet> [--object-id <object-id>] [--storage-price <price>]
```

## Operation status

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud op-status --operation-id <id>
```

Cancel:

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud op-status --operation-id <id> --cancel
```

## Name selector rules

- `--object-key` and `--name` are mutually exclusive.
- If `--name` is ambiguous, use `--latest` or `--at <timestamp>`.

## Slash equivalents (OpenClaw chat only)

The same arguments work after `/mnemospark cloud …` (e.g. `/mnemospark cloud backup …`). Do not paste slash forms into a shell.

## OpenClaw dedicated agents

On **OpenClaw 2026.4.x**, the mnemospark plugin applies dedicated-agent runbooks on install/update and gateway load: **`mnemospark-renewal`** (monthly cron) and **`mnemospark`** (interactive wallet/cloud CLI), each with `tools.deny: ["subagents"]`, `tools.exec.ask: "off"`, and `/usr/bin/node` in `exec-approvals.json` (path overridable via `MNEMOSPARK_CRON_NODE_BIN`). After upload, renewal cron uses agent `mnemospark-renewal` by default (`MNEMOSPARK_CRON_AGENT_ID`). Interactive work should route through **`mnemospark`** (`MNEMOSPARK_AGENT_ID` if overridden). See `references/openclaw-routing.md`.
