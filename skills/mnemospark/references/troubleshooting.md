# mnemospark Troubleshooting Reference

## Async workflow checks

1. Start with `--async` for upload/download.
2. Capture `operation-id`.
3. Query: `/mnemospark-cloud op-status --operation-id <id>`.
4. Correlate with `events.jsonl` and `proxy-events.jsonl`.

## Frequent failure patterns

- `Operation not found: <id>`
  - Check SQLite health or `MNEMOSPARK_DISABLE_SQLITE`.
- Name ambiguity for `--name`
  - Re-run with `--latest` or `--at <timestamp>`.
- Repeated settle/upload mismatch
  - Inspect `proxy-events.jsonl` `payment.settle` and `storage.call` events for matching `operation_id`.

## Operator fallback

- Use direct `--object-key` if friendly-name resolution is uncertain.
- Re-run sync (without `--async`) for one-shot detailed failure output.
