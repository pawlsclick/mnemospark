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
