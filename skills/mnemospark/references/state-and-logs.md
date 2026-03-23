# mnemospark State and Logs Reference

## Environment variables (local behavior)

- `MNEMOSPARK_REMOVE_BACKUP_FILE` — after a successful **upload**, remove the local backup archive under `~/.openclaw/mnemospark/backup/`. Default when unset: **remove**. Set to `0`, `false`, `no`, or `n` to keep the file; `1`, `true`, `yes`, or `y` to remove.
- `MNEMOSPARK_DOWNLOAD_DIR` — override the directory used for download output (default `~/.openclaw/mnemospark/downloads/`).

## Primary state

- SQLite: `~/.openclaw/mnemospark/state.db`

### Key tables

- `objects`
- `payments`
- `cron_jobs`
- `operations`
- `friendly_names`

## Observability

- **Unified JSONL:** `~/.openclaw/mnemospark/events.jsonl` — command handler, async operation lifecycle, client-side `payment.settle` observations, and HTTP proxy traffic share this file. Use the `source` field to distinguish writers:
  - `command` — CLI / plugin paths (including `payment.settle` lines that mirror proxy semantics for local troubleshooting)
  - `proxy` — mnemospark HTTP proxy

## Scheduler bookkeeping

- `~/.openclaw/mnemospark/crontab.txt` — JSON lines describing scheduled storage payment jobs (for your system scheduler)

## Correlation fields

Cross-stream troubleshooting should correlate by:

- `operation_id`
- `trace_id`
- `quote_id`
- `object_id`
- `object_key`

## Operation lifecycle status values

`operations.status` values used by async orchestration:

- `started`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `timed_out`

Common async terminal error codes:

- `ASYNC_FAILED`
- `ASYNC_EXCEPTION`
- `ASYNC_CANCELLED`
- `ASYNC_TIMEOUT`
- `ASYNC_DISPATCH_FAILED`

## Orchestration metadata in operations

For async runs, `operations` may include:

- `trace_id`
- `orchestrator` (`inline` or `subagent`)
- `subagent_session_id`
- `timeout_seconds`
- `cancel_requested_at`

## Payment settle JSONL events

When `/mnemospark_cloud payment-settle` runs:

- `payment-settle.started` / `payment-settle.completed` → `events.jsonl` with `source: "command"` (structured command events)
- `payment.settle` with `status` `start` / `result` → same `events.jsonl` file, `source: "command"`, with `details.client_observation: true` where applicable

The HTTP proxy emits `payment.settle` into the same file with `source: "proxy"`.

## Operation lifecycle JSONL events

Emitted to `events.jsonl` with `source: "command"`:

- `operation.dispatched`
- `operation.progress`
- `operation.cancel.requested`
- `operation.cancelled`
- `operation.timed_out`
- `operation.completed`

## Quick correlation command

```bash
./skills/mnemospark/scripts/debug-operation.sh <operation-id>
```

## Migration note

Older releases wrote `object.log`, `manifest.jsonl`, and `proxy-events.jsonl`. Current mnemospark no longer reads those paths; use SQLite plus `events.jsonl` only.
