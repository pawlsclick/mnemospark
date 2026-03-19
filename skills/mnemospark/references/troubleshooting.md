# mnemospark Troubleshooting Reference

## Async workflow checks

1. Start with `--async` for backup/upload/download.
2. If explicit session lifecycle control is needed, add `--orchestrator subagent`.
3. If timeout control is needed, add `--timeout-seconds <n>` with `--orchestrator subagent`.
4. Capture `operation-id`.
5. Query: `/mnemospark_cloud op-status --operation-id <id>`.
6. If needed, request cancel: `/mnemospark_cloud op-status --operation-id <id> --cancel`.
7. Correlate with `events.jsonl` and `proxy-events.jsonl`.

## One-step correlation debugger

From repo root:

```bash
./skills/mnemospark/scripts/debug-operation.sh <operation-id>
```

If you omit `<operation-id>`, the latest operation from SQLite is used:

```bash
./skills/mnemospark/scripts/debug-operation.sh
```

## Frequent failure patterns

- `Operation not found: <id>`
  - Check SQLite health or `MNEMOSPARK_DISABLE_SQLITE`.
- `Cannot build storage object: invalid async flags`
  - `--orchestrator`/`--timeout-seconds` require `--async`.
  - `--timeout-seconds` requires `--orchestrator subagent`.
- `error-code: ASYNC_DISPATCH_FAILED`
  - Subagent dispatch could not start; inspect recent operation events.
- `error-code: ASYNC_TIMEOUT`
  - Operation exceeded timeout; increase `--timeout-seconds` or retry without timeout.
- `error-code: ASYNC_CANCELLED`
  - Operation was cancelled through `op-status --cancel`.
- Name ambiguity for `--name`
  - Re-run with `--latest` or `--at <timestamp>`.
- Repeated settle/upload mismatch
  - Inspect `proxy-events.jsonl` `payment.settle` and `storage.call` events for matching `operation_id`.

## Operator fallback

- Use direct `--object-key` if friendly-name resolution is uncertain.
- Re-run sync (without `--async`) for one-shot detailed failure output.
