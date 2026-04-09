# Mnemospark State and Logs

## Primary state

SQLite:

- `~/.openclaw/mnemospark/state.db`

Important rule:

- Do not use host `sqlite3` to inspect Mnemospark SQLite.
- Mnemospark uses Node’s built-in SQLite.

## Unified event log

JSONL:

- `~/.openclaw/mnemospark/events.jsonl`

This is the main source of truth when command output is clipped or local lookup behaves inconsistently.

## Useful event types

Look for:

- `backup.completed`
- `price-storage.completed`
- `upload.completed`
- `download.completed`
- `delete.completed`
- `ls.completed`
- `payment-settle.started`
- `payment-settle.completed`
- proxy `storage.call` lines
- proxy `payment.settle` lines

## Critical fields

Correlate on:

- `operation_id`
- `trace_id`
- `quote_id`
- `object_id`
- `object_key`

## Backup metadata recovery

If command output is truncated, inspect `backup.completed` and recover:

- `object_id`
- `details.object_id_hash`
- `details.object_size_gb`
- `details.friendly_name`
- `details.archive_path`

This is especially important before:

- `price-storage`
- `upload`

## Validation signals

Healthy runs typically show:

- command-side `*.completed` events with terminal success
- proxy/backend `storage.call` or `payment.settle` events with `details.status: 200`

## Other useful paths

Backup directory:

- `~/.openclaw/mnemospark/backup/`

Download directory default:

- `~/.openclaw/mnemospark/downloads/`

Scheduler bookkeeping:

- `~/.openclaw/mnemospark/crontab.txt`

## One-step operation correlation

Run `./skills/mnemospark/scripts/debug-operation.sh <operation-id>` (or omit ID to use latest).
