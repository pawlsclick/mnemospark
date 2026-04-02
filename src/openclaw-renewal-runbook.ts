import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { resolveOpenClawConfigFilePath, runOpenClawCli } from "./openclaw-cli.js";

/** Default OpenClaw agent id for storage renewal cron (override with MNEMOSPARK_CRON_AGENT_ID). */
export const DEFAULT_RENEWAL_AGENT_ID = "mnemospark-renewal";

/** Stable allowlist entry id for /usr/bin/node (Mnemospark Renewal Agent Runbook). */
export const RENEWAL_NODE_ALLOWLIST_ID = "node-usr-bin-node";

export function getRenewalAgentId(): string {
  const fromEnv = process.env.MNEMOSPARK_CRON_AGENT_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_RENEWAL_AGENT_ID;
}

/** Absolute path to node for renewal exec (override with MNEMOSPARK_CRON_NODE_BIN). */
export function getRenewalNodeBinary(): string {
  const fromEnv = process.env.MNEMOSPARK_CRON_NODE_BIN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "/usr/bin/node";
}

export type RenewalAgentListEntry = {
  id: string;
  tools: {
    deny: string[];
    exec: { ask: "off" | "on" | "always" };
  };
};

/**
 * Exact agent policy from the Mnemospark Renewal Agent Runbook (OpenClaw 2026.4.x).
 */
export function runbookRenewalAgentEntry(
  agentId: string = getRenewalAgentId(),
): RenewalAgentListEntry {
  return {
    id: agentId,
    tools: {
      deny: ["subagents"],
      exec: { ask: "off" },
    },
  };
}

type ExecApprovalsDoc = {
  agents?: Record<
    string,
    {
      allowlist?: Array<{
        id?: string;
        pattern?: string;
        source?: string;
        lastUsedAt?: number;
      }>;
    }
  >;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renewalAgentEntrySatisfied(existing: unknown, desired: RenewalAgentListEntry): boolean {
  if (!isRecord(existing)) {
    return false;
  }
  if (existing.id !== desired.id) {
    return false;
  }
  const tools = existing.tools;
  if (!isRecord(tools)) {
    return false;
  }
  const deny = tools.deny;
  if (!Array.isArray(deny) || !deny.includes("subagents")) {
    return false;
  }
  const exec = tools.exec;
  if (!isRecord(exec) || exec.ask !== "off") {
    return false;
  }
  return true;
}

/**
 * Ensure `agents.list` contains the renewal agent with runbook tools policy.
 * Returns whether the list was modified.
 */
export function mergeRenewalAgentIntoAgentsList(
  list: unknown,
  desired: RenewalAgentListEntry,
): { list: RenewalAgentListEntry[]; changed: boolean } {
  const arr = Array.isArray(list) ? [...list] : [];
  const idx = arr.findIndex((e) => isRecord(e) && typeof e.id === "string" && e.id === desired.id);
  if (idx === -1) {
    return { list: [...arr, desired] as RenewalAgentListEntry[], changed: true };
  }
  if (renewalAgentEntrySatisfied(arr[idx], desired)) {
    return { list: arr as RenewalAgentListEntry[], changed: false };
  }
  const next = [...arr];
  next[idx] = desired;
  return { list: next as RenewalAgentListEntry[], changed: true };
}

/** Exported for unit tests (runbook exec-approvals merge). */
export function mergeExecApprovalsAllowlist(
  doc: ExecApprovalsDoc,
  agentId: string,
  nodeBinary: string,
): { doc: ExecApprovalsDoc; changed: boolean } {
  const prevAgents = doc.agents && isRecord(doc.agents) ? doc.agents : {};
  const block = prevAgents[agentId];
  const allowlist = Array.isArray(block?.allowlist) ? [...block.allowlist] : [];
  const hasPattern = allowlist.some((e) => e?.pattern === nodeBinary);
  if (hasPattern) {
    return { doc, changed: false };
  }
  allowlist.push({
    id: RENEWAL_NODE_ALLOWLIST_ID,
    pattern: nodeBinary,
    source: "manual",
    lastUsedAt: Date.now(),
  });
  const nextAgents = {
    ...prevAgents,
    [agentId]: {
      ...(block && isRecord(block) ? block : {}),
      allowlist,
    },
  };
  return { doc: { ...doc, agents: nextAgents }, changed: true };
}

async function readJsonFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as unknown;
}

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.tmp-${randomUUID()}`);
  await writeFile(tmp, contents, "utf-8");
  await rename(tmp, path);
}

export type EnsureOpenClawRenewalPrerequisitesOptions = {
  homeDir?: string;
  /** Skip all OpenClaw mutations (tests). */
  disabled?: boolean;
};

/**
 * Apply the Mnemospark Renewal Agent Runbook (install/update / plugin load):
 * - `agents.list` entry via `openclaw config set` + `openclaw config validate`
 * - `~/.openclaw/exec-approvals.json` merge for the node binary
 *
 * Gateway restart is not performed here; OpenClaw restarts the gateway when a plugin is installed or updated.
 */
export async function ensureOpenClawRenewalPrerequisites(
  options: EnsureOpenClawRenewalPrerequisitesOptions = {},
): Promise<void> {
  if (options.disabled ?? process.env.MNEMOSPARK_DISABLE_OPENCLAW_PREREQ === "1") {
    return;
  }

  const homeDir = options.homeDir ?? homedir();
  const agentId = getRenewalAgentId();
  const desired = runbookRenewalAgentEntry(agentId);
  const nodeBinary = getRenewalNodeBinary();

  const configPath = await resolveOpenClawConfigFilePath(homeDir);
  let configRaw = "{}";
  try {
    configRaw = await readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(configRaw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `openclaw.json at ${configPath} is not valid JSON; fix or remove it before applying renewal prerequisites.`,
    );
  }

  const agents = (isRecord(parsed.agents) ? parsed.agents : {}) as Record<string, unknown>;
  const { list: mergedList, changed: agentChanged } = mergeRenewalAgentIntoAgentsList(
    agents.list,
    desired,
  );

  if (agentChanged) {
    const listJson = JSON.stringify(mergedList);
    await runOpenClawCli(["config", "set", "agents.list", listJson, "--strict-json"], homeDir);
    await runOpenClawCli(["config", "validate"], homeDir);
  }

  const execPath = join(homeDir, ".openclaw", "exec-approvals.json");
  let execDoc: ExecApprovalsDoc = {};
  try {
    const raw = await readJsonFile(execPath);
    execDoc = isRecord(raw) ? (raw as ExecApprovalsDoc) : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  const { doc: mergedExec, changed: execChanged } = mergeExecApprovalsAllowlist(
    execDoc,
    agentId,
    nodeBinary,
  );
  if (execChanged) {
    await writeFileAtomic(execPath, `${JSON.stringify(mergedExec, null, 2)}\n`);
  }
}
