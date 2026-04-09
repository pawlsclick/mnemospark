---
name: mnemospark
description: Use for Mnemospark wallet and cloud storage workflows, including wallet status, backup, price quotes, upload, list, download, delete, payment-settle, async operation tracking, dedicated OpenClaw agent routing, and troubleshooting clipped outputs or local SQLite lookup failures. Triggers when a user asks to use Mnemospark, check the Mnemospark wallet, back up files to Mnemospark cloud, price storage, upload/download/delete stored objects, inspect operation status, or troubleshoot Mnemospark agent execution/approval issues.
---

# mnemospark

## Core execution rule

For OpenClaw automation, prefer routing Mnemospark work through a dedicated OpenClaw agent such as `mnemospark` instead of issuing ad-hoc Mnemospark shell commands from the main chat agent.

Known-good routing pattern:

```bash
openclaw agent --agent mnemospark --message "Run this exact command and report the result clearly: /usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud backup /home/ubuntu/my-notes --name my-notes-2026-04-09"
```

Why this matters:

- Defining a dedicated agent in config is not enough by itself.
- The main chat session does not automatically execute as that agent.
- Running Mnemospark Node commands from the main agent can hit brittle exec allowlist misses before an approval card is even created.
- Routing with `openclaw agent --agent mnemospark ...` makes the dedicated agent policy actually apply.

## Agent shell execution (OpenClaw plugin)

1. Run Mnemospark via Node using an absolute path to the built CLI:

   `node <ABSOLUTE_PATH_TO_EXTENSION>/dist/cli.js <command> [arguments…]`

2. For cloud subcommands, use:

   `node <ABSOLUTE_PATH_TO_EXTENSION>/dist/cli.js cloud <subcommand> [arguments…]`

3. On this host, the known path is:

   `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js ...`

4. Use `--key value` flags for shell execution. Do not use slash-command syntax in shell commands.

5. Do not rely on cwd.

6. Use `/usr/bin/node` explicitly in runbooks and dedicated-agent execution recipes when approvals/allowlists matter.

## Wallet entrypoint

The wallet command exists outside the `cloud` subcommand family.

Use:

```bash
node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js wallet
```

Use it for:

- wallet status
- funding info
- validating the configured Mnemospark wallet before cloud operations

## Command catalog

### Wallet

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js wallet`

### Backup

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud backup <file|directory> --name <friendly-name> [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

Notes:

- `--name` is required.
- `backup` does not require `--wallet-address`.

### Price storage

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud price-storage --wallet-address <addr> --object-id <id> [--object-id-hash <hash>] --gb <gb> --provider <provider> --region <region>`

Notes:

- `--provider` and `--region` are required.
- After a local `backup`, `--object-id-hash` may be omitted if local SQLite lookup works.
- If local lookup fails or metadata is ambiguous, pass `--object-id-hash` explicitly.

### Upload

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

### List

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

### Download

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`

### Delete

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

### Payment settle

- quote path: `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud payment-settle --quote-id <quote-id> --wallet-address <addr> [--object-id <id>] [--object-key <key>] [--storage-price <n>]`
- renewal path: `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud payment-settle --renewal --object-key <key> --wallet-address <addr> [--object-id <id>] [--storage-price <n>]`

### Operation status

- `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud op-status --operation-id <id>`
- cancel: `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud op-status --operation-id <id> --cancel`

## Execution guidance

1. Validate required args before execution.
2. For cleaner demos, prefer non-async commands first.
3. Use `--async` only when runtime length justifies it.
4. Use `--orchestrator subagent` only when explicit subagent tracking or cancel support matters.
5. `--timeout-seconds <n>` is only valid with `--async --orchestrator subagent`.
6. After successful upload, ask whether the user wants to store or upload additional files.

## Source of truth

Primary state:

- `~/.openclaw/mnemospark/state.db`

Unified event log:

- `~/.openclaw/mnemospark/events.jsonl`

Important rule:

- Do not use host `sqlite3` to inspect Mnemospark SQLite; Mnemospark uses Node’s built-in SQLite.

Correlate on:

- `operation_id`
- `trace_id`
- `quote_id`
- `object_id`
- `object_key`

## Known failure pattern: clipped output

OpenClaw tool output may clip `op-status` or `price-storage` results.

When that happens:

1. Treat `events.jsonl` as the source of truth.
2. For backup flows, inspect `backup.completed` to recover:
   - `object_id`
   - `details.object_id_hash`
   - `details.object_size_gb`
3. Retry `price-storage` or `upload` with explicit metadata instead of relying on truncated output.

## Known failure pattern: SQLite lookup miss after backup

If `price-storage` fails with something like:

- `Cannot resolve object-id-hash: no object found in local SQLite for this object-id`

Then:

1. Do not assume backup failed.
2. Read `~/.openclaw/mnemospark/events.jsonl`.
3. Find the matching `backup.completed` event.
4. Recover the exact `object_id_hash` from `details.object_id_hash`.
5. Re-run `price-storage` with explicit `--object-id-hash`.

## Dedicated agent recommendation

For stable OpenClaw execution, use a dedicated agent with:

- `deny: ["subagents"]`
- `exec.ask: "off"`
- `/usr/bin/node` explicitly allowlisted in `~/.openclaw/exec-approvals.json`

Keep a separate `mnemospark-renewal` agent for renewal cron work and a general `mnemospark` agent for interactive/manual workflows.

## References to load when needed

Read these only when needed:

- `references/commands.md` for exact command shapes and required flags
- `references/openclaw-routing.md` for dedicated-agent invocation and OpenClaw routing behavior
- `references/state-and-logs.md` for observability/state details and metadata recovery
- `references/troubleshooting.md` for async, approval, clipping, and SQLite lookup debugging
