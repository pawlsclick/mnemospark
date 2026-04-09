# Mnemospark Agent Runbook (interactive / plugin CLI)

Date: 2026-04-09

This is the one-shot, known-good setup for running Mnemospark **wallet and cloud** workflows through a dedicated OpenClaw agent (not the monthly renewal cron).

**Role split**

- **`mnemospark-renewal`** — isolated cron jobs for `payment-settle --renewal` only. See `mnemospark-renewal-runbook.md`.
- **`mnemospark`** (this runbook) — interactive and manual use: `wallet`, `cloud backup`, `upload`, `ls`, etc.

The mnemospark plugin applies both runbooks on install, update, and gateway load (unless `MNEMOSPARK_DISABLE_OPENCLAW_PREREQ=1`).

## 1) OpenClaw agent config

File:

- `/home/ubuntu/.openclaw/openclaw.json`

Ensure the dedicated agent exists like this:

```json
{
  "id": "mnemospark",
  "tools": {
    "deny": ["subagents"],
    "exec": {
      "ask": "off"
    }
  }
}
```

Notes:

- `deny: ["subagents"]` avoids delegating Mnemospark exec into subagent paths.
- `exec.ask: "off"` reduces prompts for repeated Node/CLI execution.

Override the default agent id with **`MNEMOSPARK_AGENT_ID`** if your config uses a different id (must match skill and routing).

## 2) Host exec approvals allowlist

File:

- `/home/ubuntu/.openclaw/exec-approvals.json`

Add `/usr/bin/node` to the allowlist for agent `mnemospark` (or your `MNEMOSPARK_AGENT_ID`).

Minimum required entry:

```json
{
  "agents": {
    "mnemospark": {
      "allowlist": [
        {
          "id": "node-usr-bin-node",
          "pattern": "/usr/bin/node",
          "source": "manual",
          "lastUsedAt": 1775143900000
        }
      ]
    }
  }
}
```

Notes:

- Allowlist is **per-agent**. The renewal agent has its own block; this agent needs its own.
- Match the Node path to your system or set **`MNEMOSPARK_CRON_NODE_BIN`** (used for both renewal and this agent’s allowlist merge in the plugin).

## 3) Routing: actually use the dedicated agent

Defining the agent in `openclaw.json` is not enough: the main chat session does not automatically run as `mnemospark`.

Route work explicitly, for example:

```bash
openclaw agent --agent mnemospark --message "Run this exact command and report the result clearly: /usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud backup /home/ubuntu/my-notes --name my-notes-2026-04-09"
```

See the bundled skill reference `skills/mnemospark/references/openclaw-routing.md` for details.

## 4) Reload OpenClaw

After changing `openclaw.json`, reload/restart the gateway so the new agent policy is live.

## 5) Command pattern

Use explicit Node plus the absolute Mnemospark CLI path (example host):

```bash
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js wallet
/usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud <subcommand> [flags…]
```

Use **`--key value`** flags in shell automation (not slash-command `name:value` forms).

## 6) Validation

Successful operations are visible in:

- `/home/ubuntu/.openclaw/mnemospark/events.jsonl`

## 7) Summary

Known-good recipe for interactive Mnemospark:

- dedicated agent **`mnemospark`** (or `MNEMOSPARK_AGENT_ID`)
- deny `subagents`, `exec.ask: "off"`
- allow `/usr/bin/node` for that agent in host exec approvals
- route with `openclaw agent --agent mnemospark …` when policy must apply
- keep **`mnemospark-renewal`** separate for renewal cron only
