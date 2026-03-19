# mnemospark Commands Reference

## `/mnemospark_cloud`

### Backup

`backup <file|directory> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

- Purpose: create a local tar+gzip backup artifact and index metadata.
- `--timeout-seconds <n>` only applies when `--async --orchestrator subagent`.

### Price storage quote

`price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider <provider> --region <region>`

### Upload

`upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

- Purpose: upload encrypted object for a valid quote.
- `--timeout-seconds <n>` only applies when `--async --orchestrator subagent`.

### List

`ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

### Download

`download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

- Purpose: download object content to local filesystem.
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
