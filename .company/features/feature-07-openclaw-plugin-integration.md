# Feature: OpenClaw Plugin Integration

**Source:** mnemospark Product Spec v3 — Sections 4, 4.2, 8, 11, 12  
**PRD:** [mnemospark_PRD.md](../mnemospark_PRD.md) — R8 (OpenClaw integration), R13–R15 (agent-facing docs and logging)  
**Status:** Definable now

---

## Feature Name

OpenClaw Plugin Integration (install, config, wallet, commands, gateway lifecycle)

## Problem

mnemospark must install and run **inside OpenClaw** like the prior plugin (ClawRouter): users install via OpenClaw’s plugin system, fund a wallet, and use storage from the assistant (commands, tools, or agent-accessible API). Without a correct plugin surface and directory layout, installation and configuration would be inconsistent and the storage gateway might not start or stop with the OpenClaw gateway.

**User job:** “I install mnemospark from the OpenClaw plugin system, set my wallet (or create one), and use `/storage` or tools to store and retrieve data; the gateway runs when OpenClaw runs.”

## Solution

Implement **OpenClaw Plugin Integration** so that:

1. **Plugin surface:** Aligns with **OpenClaw plugin API**: commands, optional tools, service with `stop()` for gateway shutdown. No LLM provider or model list; replace with storage gateway lifecycle.
2. **Install:** Plugin lives under `~/.openclaw/extensions/mnemospark/` (or equivalent per OpenClaw spec). Install via OpenClaw’s plugin mechanism.
3. **Config:**
   - Under `openclaw.json` or `~/.openclaw/mnemospark/` (e.g. `config.json`): region list (2–3), markup, storage class, any BCM/GetCostForecast defaults.
   - Documented env vars for override (e.g. dev vs prod IAM).
4. **Wallet:** Path e.g. `~/.openclaw/mnemospark/wallet.key`; main OpenClaw agent establishes wallet if none exists (per spec). Reuse existing auth/balance from codebase.
5. **Commands:** At least `/wallet` (balance, fund instructions) and `/storage` (usage, how to use storage API, or shortcut to storage docs). Exact command set per OpenClaw plugin contract.
6. **Gateway lifecycle:** When OpenClaw gateway runs, plugin **starts** the storage gateway (HTTP REST on localhost or configured host/port). When OpenClaw stops or plugin is disabled, service `stop()` is called and gateway shuts down cleanly.
7. **Logs:** Under `~/.openclaw/mnemospark/logs/` (per Section 4.2). Optional activity log (if in scope) in same directory.
8. **Package:** `openclaw.plugin.json` updated: name, description, config schema for storage (region, markup, 2–3 regions). `package.json`: name/description, `openclaw` peer dependency, add `@aws-sdk/client-s3` (v3). Remove or repurpose LLM/router-specific entries (Section 12.5).

## Success Metrics

- Plugin installs and loads in OpenClaw without errors; config and wallet paths are respected.
- Storage gateway starts when OpenClaw gateway starts and stops on `stop()`.
- Commands `/wallet` and `/storage` are available and respond (balance, usage, or guidance).
- Agent-facing docs (or in-plugin help) explain how to fund wallet, call storage API, and interpret 402.

## Acceptance Criteria

1. Plugin is loadable by OpenClaw (correct `openclaw.plugin.json` and entry point).
2. Config is read from `openclaw.json` or `~/.openclaw/mnemospark/`; region list, markup, and storage class are configurable.
3. Wallet path is `~/.openclaw/mnemospark/wallet.key` (or documented equivalent); wallet creation/import follows existing auth module.
4. Commands: `/wallet`, `/storage` (and any others per OpenClaw API) are registered and functional.
5. On OpenClaw gateway start, plugin starts storage gateway (HTTP server); on `stop()`, gateway shuts down (no dangling listeners).
6. Logs written under `~/.openclaw/mnemospark/logs/`.
7. `package.json` and `openclaw.plugin.json` updated per Section 12.5; no LLM/router-specific exports or config in plugin surface.
8. Agent-facing docs: how to fund wallet, call storage API (with 402 and payment header), and understand activity vs storage fees (or link to central doc).

## Dependencies

- **x402 Storage Gateway** and **Agent-Facing Storage API** (gateway must exist to start).
- OpenClaw plugin API (contract for commands, tools, service, config).
- Existing: auth, balance, config, logger; wallet resolution.

## RICE Score

| R                                | I   | C    | E              | Score |
| -------------------------------- | --- | ---- | -------------- | ----- |
| All OpenClaw users of mnemospark | 3   | 100% | 2 person-weeks | High  |

- **Reach:** Every user who installs mnemospark.
- **Impact:** 3 (enables install and use).
- **Confidence:** 100% (OpenClaw layout and plugin API referenced).
- **Effort:** M (~2 weeks).

## Timeline

**M** (2 weeks)

## Hand-off Questions

1. Exact OpenClaw plugin API version or doc link: entry point (e.g. `index.js` export), config schema location, and how to register commands and service.
2. Should the storage gateway listen only on localhost or be configurable (host/port) for remote agents?
3. Where should “agent-facing docs” live: in-repo markdown, in-plugin help text, or both?

---

## Antfarm hand-off

### Task string (copy-paste for `workflow run feature-dev`)

```
Build OpenClaw Plugin Integration for mnemospark: plugin loadable by OpenClaw with openclaw.plugin.json and entry point; config from openclaw.json or ~/.openclaw/mnemospark/ (region list, markup, storage class); wallet at ~/.openclaw/mnemospark/wallet.key; commands /wallet and /storage; on gateway start plugin starts storage gateway (HTTP REST), on stop() gateway shuts down; logs under ~/.openclaw/mnemospark/logs/. Update package.json and openclaw.plugin.json (storage config schema, @aws-sdk/client-s3, openclaw peer); remove LLM/router-specific exports. Agent-facing docs: fund wallet, call storage API (402 + payment header), activity vs storage fees. Constraints: align with OpenClaw plugin API (commands, service, config). Acceptance: [ ] plugin loadable (openclaw.plugin.json + entry); [ ] config from openclaw.json or ~/.openclaw/mnemospark/, region/markup/storage configurable; [ ] wallet path ~/.openclaw/mnemospark/wallet.key, creation/import per auth module; [ ] /wallet and /storage registered and functional; [ ] gateway starts on OpenClaw start, stops on stop(); [ ] logs under ~/.openclaw/mnemospark/logs/; [ ] package.json and openclaw.plugin.json updated, no LLM/router surface; [ ] agent-facing docs for wallet, API, 402, fees.
```

### Verifier acceptance checklist

- [ ] Plugin is loadable by OpenClaw (correct `openclaw.plugin.json` and entry point).
- [ ] Config is read from `openclaw.json` or `~/.openclaw/mnemospark/`; region list, markup, and storage class are configurable.
- [ ] Wallet path is `~/.openclaw/mnemospark/wallet.key` (or documented equivalent); wallet creation/import follows existing auth module.
- [ ] Commands: `/wallet`, `/storage` (and any others per OpenClaw API) are registered and functional.
- [ ] On OpenClaw gateway start, plugin starts storage gateway (HTTP server); on `stop()`, gateway shuts down (no dangling listeners).
- [ ] Logs written under `~/.openclaw/mnemospark/logs/`.
- [ ] `package.json` and `openclaw.plugin.json` updated; no LLM/router-specific exports or config in plugin surface.
- [ ] Agent-facing docs: how to fund wallet, call storage API (with 402 and payment header), and understand activity vs storage fees (or link to central doc).

---

## Customer Journey Map

User installs mnemospark → configures (or accepts defaults) → funds wallet via `/wallet` or external transfer → uses `/storage` or agent tools to upload/download → gateway runs transparently when OpenClaw runs.

## UX Flow

- **Install:** OpenClaw “add plugin” → mnemospark appears under extensions.
- **First use:** User runs `/wallet` → sees balance and fund instructions; runs `/storage` → sees usage or link to API.
- **Agent:** Agent calls storage API (e.g. from skill or tool); gateway returns 402 then 200 after payment.
- **Shutdown:** User stops OpenClaw → plugin `stop()` → gateway closes.

## Edge Cases and Error States

| Scenario                                | Handling                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------- |
| No wallet file                          | Create or prompt (per existing auth); document in agent-facing docs.        |
| Config missing or invalid               | Defaults for region list and markup; log warning; document required config. |
| Gateway port in use                     | Log error; fail start or use next port — document.                          |
| OpenClaw upgrade breaks plugin contract | Pin or document supported OpenClaw version; test matrix.                    |

## Data Requirements

- Config: region list, markup, storage class, host/port.
- Wallet: existing format.
- Logs: under `~/.openclaw/mnemospark/logs/`. Activity log (if in scope) per spec feedback.
