# mnemospark

## When to use

Use this skill for mnemospark cloud backup/storage workflows, async operation tracking, and troubleshooting using SQLite + JSONL observability. When an **agent runs commands in a shell** (not only OpenClaw slash commands), follow **Agent shell execution** below.

## Agent shell execution (OpenClaw plugin)

1. **Invocation:** Agents **must** run mnemospark via Node using an **absolute** path to the built CLI:

   `node <ABSOLUTE_PATH_TO_EXTENSION>/dist/cli.js cloud <subcommand> [arguments…]`

   Do **not** rely on the current working directory. Resolve `<ABSOLUTE_PATH_TO_EXTENSION>` to the real install path (for example expand `~` / `$HOME`). The mnemospark OpenClaw extension lives under **`.openclaw/extensions/mnemospark/`** (e.g. `~/.openclaw/extensions/mnemospark`).

2. **Example (typical Linux agent home):**

   `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud …`

3. **Flag style:** Use **`--key value`** for all arguments (and bare flags like `--async`, `--latest`, `--renewal`, `--cancel` where applicable). Do **not** build shell commands with slash prefixes (`/mnemospark …`) or `name:value` forms—those are for **in-chat** slash UX. The chat handler accepts multiple spellings; **shell automation must use `--key value`**.

4. **Discovery:** `node <ABSOLUTE_PATH_TO_EXTENSION>/dist/cli.js cloud help` shows the same help as `/mnemospark cloud help`.

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
6. Poll with `node <ABSOLUTE_PATH_TO_EXTENSION>/dist/cli.js cloud op-status --operation-id <id>` until terminal status (slash equivalent: `/mnemospark cloud op-status --operation-id <id>`); on **succeeded**, the status message includes the same full user-visible output as a synchronous run (e.g. backup `price-storage` line, upload confirmation, download path).
7. Use `node <ABSOLUTE_PATH_TO_EXTENSION>/dist/cli.js cloud op-status --operation-id <id> --cancel` for subagent cancellation (slash: `/mnemospark cloud op-status … --cancel`).
8. Use SQLite (`state.db`) as source of truth; use JSONL streams for correlation and audit context.
9. On ambiguity with `--name`, require `--latest` or `--at`.
10. On SQLite unavailability, report graceful fallback and continue with JSONL + legacy logs.

## Command catalog (CLI, `--key value`)

Let `CLI` = `node <ABSOLUTE_PATH_TO_EXTENSION>/dist/cli.js cloud`. Replace `<ABSOLUTE_PATH_TO_EXTENSION>` with the absolute path to the extension directory (e.g. `~/.openclaw/extensions/mnemospark` expanded on the user’s machine).

**Primary subcommands**

- `CLI backup <file|directory> --name <friendly-name> [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]` — **`--name` is required.**
- `CLI price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider <provider> --region <region>` — **`--provider` and `--region` are required** (defaults often `aws` / `us-east-1`; override as needed).
- `CLI upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `CLI ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`
- `CLI download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async] [--orchestrator <inline|subagent>] [--timeout-seconds <n>]`
- `CLI delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

**Also available**

- `CLI payment-settle --quote-id <quote-id> --wallet-address <addr> [--object-id <id>] [--object-key <key>] [--storage-price <n>]` (quote path)
- `CLI payment-settle --renewal --object-key <key> --wallet-address <addr> [--object-id <id>] [--storage-price <n>]` (monthly renewal)
- `CLI op-status --operation-id <id> [--cancel]`

**Slash equivalents (OpenClaw chat only):** the same arguments work after `/mnemospark cloud …` (e.g. `/mnemospark cloud backup …`). Do not paste slash forms into a shell.

Details and edge cases: see `references/commands.md`.

## User-visible feedback (agent behavior)

- After each run, return **stdout** and **stderr** to the user (verbatim or summarized; do not drop errors).
- Treat **non-zero exit code** as failure and say so; include useful **stderr** lines when helpful.
- On success, state success clearly and include relevant stdout (paths, confirmations).
- Whenever you show a **runnable shell command** to the user, put the **entire command in one pair of inline backticks** so it can be copied in one selection.

## Post-upload prompt

After a **successful** `upload` (exit code 0 and no fatal error in output), **ask** whether the user wants to **store or upload additional files** before continuing.

## End-to-end test plan

Repeatable **integrity** check (with user consent). Use the same `CLI` + **`--key value`** rules as above.

1. **Choose file:** Ask which local path to use as the **test file** (or confirm a path the user provides).
2. **Baseline hash:** Before any cloud steps, compute a cryptographic hash of that file (e.g. SHA-256) and **record** it.
3. **Pipeline (order):** **backup** → **price-storage** → **upload** → **ls** → **download**, passing **wallet address**, **quote-id**, **object-id**, **object-id-hash**, and **friendly name** / selectors from each step’s output. Use **`op-status`** if using `--async`. Stop and report on first failure.
4. **Verify:** Hash the **downloaded** file the same way as step 2. **Compare** to the baseline hash.
5. **Prove match:** If hashes match, state clearly that the **original and downloaded files are identical**. If they differ, report failure.
6. **Optional cleanup:** Ask whether to **delete** the test object from the cloud. If **yes**, run **delete** with **`--wallet-address`** and **`--object-key`** or **`--name`** (and **`--latest`** / **`--at`** if needed). If **no**, skip delete and confirm.

Optional: use `--async` and **`op-status`** for long-running steps per **Execution rules**.

## Async quick examples (CLI)

- `…/dist/cli.js cloud upload … --async --orchestrator subagent`
- `…/dist/cli.js cloud download … --async --orchestrator subagent --timeout-seconds 900`
- `…/dist/cli.js cloud op-status --operation-id <id>`
- `…/dist/cli.js cloud op-status --operation-id <id> --cancel`

## References

- `references/commands.md`
- `references/state-and-logs.md`
- `references/troubleshooting.md`
- `scripts/debug-operation.sh` (one-step operation correlation debugger)
