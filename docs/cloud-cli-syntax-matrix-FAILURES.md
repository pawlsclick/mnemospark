# Live cloud CLI syntax matrix — run log (2026-03-29)

Execution host: `ssh openclaw-tailscale '…'`  
CLI (remote): `node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud …`

## Runnable checklist (IDs)

| ID          | Remote args after `cloud`                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| H1          | _(empty)_                                                                                                                      |
| H2          | `help`                                                                                                                         |
| H3          | `help:true`                                                                                                                    |
| H5          | `price-storage:true`                                                                                                           |
| B1          | `backup /home/ubuntu/20mb.txt --name 20mb.txt`                                                                                 |
| B2          | `backup /home/ubuntu/20mb.txt name:20mb.txt`                                                                                   |
| B3          | `backup /home/ubuntu/20mb.txt name=20mb.txt`                                                                                   |
| B4          | `backup /home/ubuntu/20mb.txt --name 20mb.txt --async`                                                                         |
| B5          | `backup /home/ubuntu/20mb.txt --name 20mb.txt --async --orchestrator inline`                                                   |
| B6          | `backup /home/ubuntu/20mb.txt --name 20mb.txt --orchestrator subagent` _(expect validation failure)_                           |
| P1/E1–P8/E3 | `price-storage` with alias row P1–P8 and encoding E1–E3 (see plan matrix)                                                      |
| U-baseline  | `upload` with full `--` flags (E1)                                                                                             |
| LS-a        | `ls --wallet-address $WALLET`                                                                                                  |
| LS-b        | `ls wallet:$WALLET`                                                                                                            |
| LS-c        | `ls --wallet-address $WALLET name:20mb.txt` _(may require `--latest` if ambiguous)_                                            |
| DL-E1–E3    | `download` with `--wallet-address`, `--object-key`, `--location <path>`                                                        |
| OPS-1       | `op-status --operation-id dummy-test-id`                                                                                       |
| OPS-2       | `op-status operation-id:dummy-test-id`                                                                                         |
| PS-neg      | `payment-settle --renewal --quote-id <id> --wallet-address … --object-key fake` _(expect invalid combination / generic error)_ |

**SSH one-liner template**

```bash
ssh openclaw-tailscale 'node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud <args>'
```

Between backup runs that reuse friendly name `20mb.txt`:

```bash
ssh openclaw-tailscale 'rm -f .openclaw/mnemospark/backup/20mb.txt'
```

## Captured values (last sync backup before price-storage matrix)

Used for P1–P8 / E1–E3:

| Variable           | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| WALLET             | `0x24bB8B93fbC0B87e4b0303aA1F71C51941726424`                       |
| object-id          | `1774815842321-f7cf561c8663bb38`                                   |
| object-id-hash     | `735d1d4d6ca746733c43095f43775cd1dd6701f036a122ecba5a6feaee0274b2` |
| gb                 | `0.017517719`                                                      |
| quote-id (example) | `6343a203-4f6e-4e78-8ec9-f124561e20cd`                             |

## Results summary

| Phase        | Outcome                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| H1–H3        | Pass (exit 0, cloud help text).                                                                                                |
| H5           | Pass (exit 1, missing required fields for `price-storage`).                                                                    |
| B1–B3        | Pass after `rm` between runs.                                                                                                  |
| B4–B5        | Pass (async backup).                                                                                                           |
| B6           | Pass (exit 1, `--orchestrator` without `--async`).                                                                             |
| P1/E1–P8/E3  | **24/24 pass** (live quote API).                                                                                               |
| U-baseline   | **Fail** — see failures table.                                                                                                 |
| LS-a, LS-b   | Pass (bucket listing).                                                                                                         |
| LS-c         | Exit 1: multiple objects match `name:20mb.txt` (expected; use `--latest` / `--at`).                                            |
| DL-E1–E3     | **Fail** at handler — see failures table (parse succeeded).                                                                    |
| OPS-1, OPS-2 | Exit 1: `Operation not found` (expected for dummy id).                                                                         |
| PS-neg       | Exit 1: generic payment-settle error message (invalid renewal + quote combination maps to `payment-settle-invalid` in source). |

**Deferred (not run):** full 16-row upload alias matrix (cost/state); `delete` (destructive); `payment-settle` Path A/B success paths (paid); Phase 6b renewal with real `object-key`.

## Failures (for follow-up)

| Command id | Exact remote invocation (abbrev.)                                                                                               | Exit | Stderr / message (truncated) | Classifier                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------- | ---------------------------------------------------------- |
| U-baseline | `cloud upload --quote-id 6343a203-… --wallet-address 0x24b… --object-id 1774815842321-… --object-id-hash 735d… --name 20mb.txt` | 1    | `spawn openclaw ENOENT`      | **runtime** (OpenClaw binary/path on host; not arg-parse)  |
| DL-E1      | `cloud download --wallet-address … --object-key 1774815842321-… --location /tmp/dl-e1-test.bin`                                 | 1    | `Cannot download file`       | **backend** (S3/proxy/object state; parse reached handler) |
| DL-E2      | `cloud download wallet:… object-key:… location:/tmp/dl-e2-test.bin`                                                             | 1    | `Cannot download file`       | **backend**                                                |
| DL-E3      | `cloud download wallet=… object-key=… location=/tmp/dl-e3-test.bin`                                                             | 1    | `Cannot download file`       | **backend**                                                |

**Operator note:** `download` does not accept `-o`; use `--location` / `location:` / `location=` per schema.

**False starts (test harness, not product bugs):** Initial download attempts used `-o /tmp/...`, which correctly failed at **parse** with “Unexpected token `-o`”.

## Conclusion

- **Argument parsing and alias × encoding matrix (price-storage)** behaved correctly against the live extension build on `openclaw-tailscale`.
- No **parse**-class failures were observed for the executed matrix; follow-up work for the upload/download failures above is **environment/runtime** (upload) and **remote storage / object readiness** (download), not the `key:value` / `key=` / `--key` parser unless investigation shows otherwise.
