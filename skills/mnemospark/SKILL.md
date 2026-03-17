# mnemospark

## When to use

Use this skill for mnemospark cloud backup/storage workflows, async operation tracking, and troubleshooting using SQLite + JSONL observability.

## Inputs expected

- User intent: backup, price-storage, upload, ls, download, delete, op-status
- Wallet context (`--wallet-address`) where required
- Optional selector context (`--object-key` or `--name`, plus `--latest` / `--at`)

## Execution rules

1. Validate required args before execution.
2. Prefer `--async` for long-running `upload` and `download`.
3. Return `operation-id` immediately for async commands.
4. Poll with `/mnemospark-cloud op-status --operation-id <id>` until terminal status.
5. Use SQLite (`state.db`) as source of truth; use JSONL streams for correlation and audit context.
6. On ambiguity with `--name`, require `--latest` or `--at`.
7. On SQLite unavailability, report graceful fallback and continue with JSONL + legacy logs.

## Command catalog

- `/mnemospark-cloud backup <file|directory> [--name <friendly-name>]`
- `/mnemospark-cloud price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider <provider> --region <region>`
- `/mnemospark-cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async]`
- `/mnemospark-cloud ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`
- `/mnemospark-cloud download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async]`
- `/mnemospark-cloud delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`
- `/mnemospark-cloud op-status --operation-id <id>`

## References

- `references/commands.md`
- `references/state-and-logs.md`
- `references/troubleshooting.md`
