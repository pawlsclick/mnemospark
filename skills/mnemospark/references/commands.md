# mnemospark Commands Reference

## `/mnemospark_cloud`

### Backup

`backup <file|directory> --name <friendly-name> [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

- Purpose: create a local tar+gzip backup artifact under `~/.openclaw/mnemospark/backup/` and index metadata in SQLite.
- **Required:** `--name <friendly-name>` (stored in `state.db`; on-disk filename is a sanitized single path segment derived from it).
- Duplicate `--name` values that resolve to the same on-disk basename will fail with an “already exists” error.
- `--timeout-seconds <n>` only applies when `--async --orchestrator subagent`.

### Price storage quote

`price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider aws --region us-east-1` (defaults; override `--provider` / `--region` for other regions)

### Upload

`upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

- Purpose: upload encrypted object for a valid quote.
- Local archive path: prefers `backup/<sanitized-friendly-name>` from SQLite (see `backup` + `friendly_names`); falls back to legacy `backup/<object-id>` if that file exists.
- Optional `--name` must exactly match the friendly name in SQLite for that `object_id` (validation only; not sent to the backend).
- `--timeout-seconds <n>` only applies when `--async --orchestrator subagent`.

### Payment settle (scheduled / manual)

**Quote path (upload prep):** `payment-settle --quote-id <quote-id> --wallet-address <addr> [--object-id <id>] [--object-key <key>] [--storage-price <n>]`

**Monthly renewal (no new quote):** `payment-settle --renewal --object-key <key> --wallet-address <addr> [--object-id <id>] [--storage-price <n>]`

- Purpose: call the same proxy + x402 payment settlement path as upload. Cron lines after upload use **renewal** mode so the backend reads price from active inventory (no `QUOTES_TABLE` row).
- Required: `--wallet-address` and either `--quote-id` or (`--renewal` and `--object-key`). The configured private key must match the address.

### List

`ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

### Download

`download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

- Purpose: download object content to local filesystem (default directory `~/.openclaw/mnemospark/downloads/`, overridable with `MNEMOSPARK_DOWNLOAD_DIR`).
- When SQLite has a friendly name for the object, the saved file basename is the sanitized friendly name; otherwise the layout follows `object_key` as before. The backend still receives only `object_id` / `object_key` semantics via the API.
- `--timeout-seconds <n>` only applies when `--async --orchestrator subagent`.

### Delete

`delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

### Operation status

`op-status --operation-id <id> [--cancel]`

- `--cancel` requests cancellation for subagent-orchestrated operations.
- Cancellation is idempotent and safe to call repeatedly.

## Async orchestration flags (long-running commands only)

Applies to `backup`, `upload`, `download`.

- `--async`
  - Run in background and return immediately with `operation-id`.
- `--orchestrator <inline|subagent>`
  - Select async execution mode.
  - Current default when omitted with `--async`: `inline`.
  - Use `subagent` for explicit subagent session metadata and cancel controls.
- `--timeout-seconds <n>`
  - Positive integer timeout in seconds.
  - Valid only with `--async --orchestrator subagent`.

## Async examples

- `/mnemospark_cloud upload ... --async --orchestrator subagent`
- `/mnemospark_cloud download ... --async --orchestrator subagent --timeout-seconds 900`
- `/mnemospark_cloud op-status --operation-id <id>`
- `/mnemospark_cloud op-status --operation-id <id> --cancel`

## Name selector rules

- `--object-key` and `--name` are mutually exclusive.
- If `--name` maps to multiple active objects, require `--latest` or `--at`.

## One-step debug helper

```bash
./skills/mnemospark/scripts/debug-operation.sh <operation-id>
```
