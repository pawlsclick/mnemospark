# mnemospark State and Logs Reference

## Primary state

- SQLite: `~/.openclaw/mnemospark/state.db`

### Key tables

- `objects`
- `payments`
- `cron_jobs`
- `operations`
- `friendly_names`

## Observability streams

- Client events: `~/.openclaw/mnemospark/events.jsonl`
- Friendly-name manifest: `~/.openclaw/mnemospark/manifest.jsonl`
- Proxy events: `~/.openclaw/mnemospark/proxy-events.jsonl`

## Legacy compatibility paths

- `~/.openclaw/mnemospark/object.log`
- `~/.openclaw/mnemospark/crontab.txt`

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

## Operation lifecycle JSONL events

Operation lifecycle events emitted to `events.jsonl` and `proxy-events.jsonl`:

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
