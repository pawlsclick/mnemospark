# mnemospark

## When to use

Use this skill for mnemospark cloud backup/storage workflows, async operation tracking, and troubleshooting using SQLite + JSONL observability.

## Inputs expected

- User intent: backup, price-storage, upload, ls, download, delete, op-status
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
6. Poll with `/mnemospark_cloud op-status --operation-id <id>` until terminal status.
7. Use `/mnemospark_cloud op-status --operation-id <id> --cancel` for subagent cancellation.
8. Use SQLite (`state.db`) as source of truth; use JSONL streams for correlation and audit context.
9. On ambiguity with `--name`, require `--latest` or `--at`.
10. On SQLite unavailability, report graceful fallback and continue with JSONL + legacy logs.

## Command catalog

- `/mnemospark_cloud backup <file|directory> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `/mnemospark_cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider <provider> --region <region>`
- `/mnemospark_cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `/mnemospark_cloud ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`
- `/mnemospark_cloud download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `/mnemospark_cloud delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`
- `/mnemospark_cloud op-status --operation-id <id> [--cancel]`

## Async quick examples

- Start async with subagent orchestration:
  - `/mnemospark_cloud upload ... --async --orchestrator subagent`
- Start async with timeout:
  - `/mnemospark_cloud download ... --async --orchestrator subagent --timeout-seconds 900`
- Check status:
  - `/mnemospark_cloud op-status --operation-id <id>`
- Cancel subagent operation:
  - `/mnemospark_cloud op-status --operation-id <id> --cancel`

## References

- `references/commands.md`
- `references/state-and-logs.md`
- `references/troubleshooting.md`
- `scripts/debug-operation.sh` (one-step operation correlation debugger)
