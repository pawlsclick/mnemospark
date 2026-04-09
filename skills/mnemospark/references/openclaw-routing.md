# OpenClaw Routing for Mnemospark

This is the OpenClaw-specific behavior that matters for Mnemospark automation.

## Core rule

Defining a dedicated `mnemospark` agent in OpenClaw config is not enough by itself.
To actually use the dedicated agent policy, route work through OpenClaw with:

```bash
openclaw agent --agent mnemospark --message "<instruction>"
```

## Known-good pattern

```bash
openclaw agent --agent mnemospark --message "Run this exact command and report the result clearly: /usr/bin/node /home/ubuntu/.openclaw/extensions/mnemospark/dist/cli.js cloud backup /home/ubuntu/my-notes --name my-notes-2026-04-09"
```

## Why this matters

The main chat session does not automatically execute as the `mnemospark` agent.

Without explicit routing:

- you may still be executing from `main`
- `main` may hit brittle exec allowlist misses
- the command may fail before an approval card is even created

With explicit routing:

- the dedicated `mnemospark` agent policy applies
- its `exec.ask: "off"` setting can take effect
- its `/usr/bin/node` allowlist can take effect

## Recommended dedicated-agent setup

In `openclaw.json`, define a separate agent such as:

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

In `exec-approvals.json`, add `/usr/bin/node` for that agent.

## Separation of roles

Use two dedicated agents:

- `mnemospark-renewal` for cron renewal automation
- `mnemospark` for interactive/manual wallet and cloud workflows

Do not assume the renewal setup automatically covers interactive Mnemospark usage.
