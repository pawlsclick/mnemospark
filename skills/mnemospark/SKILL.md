# mnemospark

## When to use

Use this skill for mnemospark cloud backup/storage workflows, async operation tracking, and troubleshooting using SQLite + JSONL observability.

## Inputs expected

- User intent: backup, price-storage, upload, payment-settle, ls, download, delete, op-status
- Wallet context (`--wallet-address`) where required
- Optional selector context (`--object-key` or `--name`, plus `--latest` / `--at`)
- Optional async orchestration context for long-running work:
  - `--async`
  - `--orchestrator <inline|subagent>` (default async mode: `inline`)
  - `--timeout-seconds <n>` (valid only with `--async --orchestrator subagent`)

## Execution rules

1. Validate required args before execution.
2. For long-running `backup`/`upload`/`download`, prefer `--async`.
3. Use `--orchestrator subagent` when explicit subagent session tracking/cancel support is required.
4. If timeout control is needed, require `--timeout-seconds <n>` with `--orchestrator subagent`.
5. Return `operation-id` immediately for async commands.
6. Poll with `/mnemospark cloud op-status --operation-id <id>` until terminal status; on **succeeded**, the status message includes the same full user-visible output as a synchronous run (e.g. backup `price-storage` line, upload confirmation, download path).
7. Use `/mnemospark cloud op-status --operation-id <id> --cancel` for subagent cancellation.
8. Use SQLite (`state.db`) as source of truth; use JSONL streams for correlation and audit context.
9. On ambiguity with `--name`, require `--latest` or `--at`.
10. On SQLite unavailability, report graceful fallback and continue with JSONL + legacy logs.

## Command catalog

- `/mnemospark cloud backup <file|directory> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `/mnemospark cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider aws --region us-east-1` (override for other regions)
- `/mnemospark cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `/mnemospark cloud payment-settle --quote-id <quote-id> --wallet-address <addr> [--object-id <id>] [--object-key <key>] [--storage-price <n>]`
- `/mnemospark cloud ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`
- `/mnemospark cloud download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `/mnemospark cloud delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`
- `/mnemospark cloud op-status --operation-id <id> [--cancel]`

## Async quick examples

- Start async with subagent orchestration:
  - `/mnemospark cloud upload ... --async --orchestrator subagent`
- Start async with timeout:
  - `/mnemospark cloud download ... --async --orchestrator subagent --timeout-seconds 900`
- Check status:
  - `/mnemospark cloud op-status --operation-id <id>`
- Cancel subagent operation:
  - `/mnemospark cloud op-status --operation-id <id> --cancel`

## References

- `references/commands.md`
- `references/state-and-logs.md`
- `references/troubleshooting.md`
- `scripts/debug-operation.sh` (one-step operation correlation debugger)
