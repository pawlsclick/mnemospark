# Mnemospark Troubleshooting

## 1) Main-agent exec denied: allowlist miss

Symptom:

- `exec denied: allowlist miss`

Meaning:

- the command is still running under `main` instead of the dedicated `mnemospark` agent
- or the dedicated agent exists but is not being used via routing

Fix:

1. route through OpenClaw using `openclaw agent --agent mnemospark --message "..."`
2. verify `/usr/bin/node` is allowlisted for agent `mnemospark`
3. verify `exec.ask: "off"` is set for that agent

## 2) `price-storage` cannot resolve object-id-hash

Symptom:

- `Cannot resolve object-id-hash: no object found in local SQLite for this object-id`

Meaning:

- backup may have succeeded, but Mnemospark cannot resolve the hash from SQLite for the next step

Fix:

1. inspect `~/.openclaw/mnemospark/events.jsonl`
2. find the matching `backup.completed`
3. recover `details.object_id_hash`
4. re-run `price-storage` with explicit `--object-id-hash`

## 3) `op-status` or `price-storage` output is clipped

Symptom:

- the tool result shows partial output or clips the human-readable fields you want

Fix:

1. treat `events.jsonl` as source of truth
2. read `backup.completed` / `price-storage.completed` / `upload.completed`
3. continue with recovered metadata instead of trusting clipped stdout

## 4) Quote succeeded but price amount is not visible

Symptom:

- quote exists, but the visible result does not include the clean human-readable cost amount

Fix:

- report that pricing succeeded and preserve the quote metadata
- for demos, consider skipping price narration if the output layer is noisy
- continue with upload if the goal is workflow proof, not price display

## 5) Async flows make demos messy

Symptom:

- `op-status` adds extra clipping, polling, and noisy output

Fix:

- prefer non-async commands for demos
- use async only when runtime length justifies it
- if async is required, rely on `events.jsonl` for exact metadata

## 6) Name ambiguity

Symptom:

- `--name` selector is ambiguous

Fix:

- add `--latest` or `--at <timestamp>`
- or use `--object-key` directly

## 7) Renewal vs general-agent confusion

Symptom:

- renewal automation works, but interactive/manual Mnemospark usage does not

Meaning:

- `mnemospark-renewal` is not the same as a general `mnemospark` agent

Fix:

- keep `mnemospark-renewal` for cron renewals
- create and route through a separate `mnemospark` agent for interactive work

## One-step operation correlation

Run `./skills/mnemospark/scripts/debug-operation.sh <operation-id>` (or omit ID to use latest).
