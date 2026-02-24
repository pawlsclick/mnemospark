# Cursor Dev: Client /cloud backup

**ID:** cursor-dev-11  
**Repo:** mnemospark  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). Client features (11–14) are in this repo (plugin/client). Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Implement the **mnemospark-client** command `/cloud backup <file>` or `/cloud backup <directory>` per [mnemospark_full_workflow.md](../mnemospark_full_workflow.md): Mac/Linux only; tar+gzip to /tmp (filename = `<object-id>`); compute SHA-256 hash (`<object-id-hash>`); compute size in GB (`<object-size-gb>`); write to object lifecycle log at `~/.openclaw/mnemospark/object.log`; print user message with object-id, object-id-hash, object-size-gb; on error print "Cannot build storage object". Check /tmp exists and available disk space before writing.

## References

- [mnemospark_full_workflow.md](../mnemospark_full_workflow.md) — backup command (args, steps, object.log, file locations)
- [mnemospark_PRD.md](../mnemospark_PRD.md) R8 (object.log at ~/.openclaw/mnemospark/object.log)

## Cloud Agent

- **Install (idempotent):** `npm install` (or project’s install for the plugin).
- **Start (if needed):** None.
- **Secrets:** None for this feature.
- **Acceptance criteria (checkboxes):**
  - [ ] Command `/cloud backup <file>` and `/cloud backup <directory>` accepted; Mac/Linux only (or graceful message on other OS).
  - [ ] Tar+gzip to /tmp; filename used as `<object-id>`; check disk space and /tmp before writing.
  - [ ] SHA-256 of the archive = `<object-id-hash>`; size in GB = `<object-size-gb>`.
  - [ ] Append or write to `~/.openclaw/mnemospark/object.log` with object-id, object-id-hash, object-size-gb (format per workflow).
  - [ ] Print: "Your object-id is `<object-id>` your object-id-hash is `<object-id-hash>` and your object-size is `<object-size-gb>`"; on error "Cannot build storage object".
  - [ ] Unit or script test for backup flow (e.g. temp file/dir, then verify log and output).

## Task string (optional)

Work only in this repo; do not use BlockRun/ClawRouter or any other repo. Implement mnemospark-client /cloud backup &lt;file&gt; or &lt;directory&gt;: tar.gz to /tmp, hash, size, write to ~/.openclaw/mnemospark/object.log, print object-id/hash/size. Mac/Linux only; check /tmp and disk space. Ref: mnemospark_full_workflow.md backup command. Acceptance: [ ] backup command; [ ] object.log; [ ] user message; [ ] error message; [ ] test.
