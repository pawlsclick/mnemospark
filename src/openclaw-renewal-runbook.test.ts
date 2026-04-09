import { describe, expect, it } from "vitest";

import {
  mergeExecApprovalsAllowlist,
  mergeRenewalAgentIntoAgentsList,
  runbookDedicatedAgentEntry,
  runbookRenewalAgentEntry,
} from "./openclaw-renewal-runbook.js";

describe("openclaw-renewal-runbook", () => {
  it("merges renewal agent into an empty agents.list", () => {
    const desired = runbookRenewalAgentEntry("mnemospark-renewal");
    const { list, changed } = mergeRenewalAgentIntoAgentsList(undefined, desired);
    expect(changed).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(desired);
  });

  it("is idempotent when the renewal agent already matches the runbook", () => {
    const desired = runbookRenewalAgentEntry("mnemospark-renewal");
    const first = mergeRenewalAgentIntoAgentsList(undefined, desired);
    const second = mergeRenewalAgentIntoAgentsList(first.list, desired);
    expect(second.changed).toBe(false);
    expect(second.list).toEqual(first.list);
  });

  it("adds /usr/bin/node allowlist entry once", () => {
    const { doc, changed } = mergeExecApprovalsAllowlist({}, "mnemospark-renewal", "/usr/bin/node");
    expect(changed).toBe(true);
    expect(doc.agents?.["mnemospark-renewal"]?.allowlist?.[0]?.pattern).toBe("/usr/bin/node");
    const again = mergeExecApprovalsAllowlist(doc, "mnemospark-renewal", "/usr/bin/node");
    expect(again.changed).toBe(false);
  });

  it("merges renewal then interactive agent into one list", () => {
    const renewal = runbookRenewalAgentEntry("mnemospark-renewal");
    const interactive = runbookDedicatedAgentEntry("mnemospark");
    const first = mergeRenewalAgentIntoAgentsList(undefined, renewal);
    const second = mergeRenewalAgentIntoAgentsList(first.list, interactive);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(true);
    expect(second.list).toHaveLength(2);
    expect(second.list.map((e) => e.id).sort()).toEqual(["mnemospark", "mnemospark-renewal"]);
  });

  it("is idempotent when both dedicated agents already match the runbook", () => {
    const renewal = runbookRenewalAgentEntry("mnemospark-renewal");
    const interactive = runbookDedicatedAgentEntry("mnemospark");
    const once = mergeRenewalAgentIntoAgentsList(undefined, renewal);
    const twice = mergeRenewalAgentIntoAgentsList(once.list, interactive);
    const againRenewal = mergeRenewalAgentIntoAgentsList(twice.list, renewal);
    const againInteractive = mergeRenewalAgentIntoAgentsList(againRenewal.list, interactive);
    expect(againInteractive.changed).toBe(false);
    expect(againInteractive.list).toEqual(twice.list);
  });

  it("allowlists node for both renewal and mnemospark agents without duplicate patterns per agent", () => {
    const doc = {};
    const r1 = mergeExecApprovalsAllowlist(doc, "mnemospark-renewal", "/usr/bin/node");
    expect(r1.changed).toBe(true);
    const r2 = mergeExecApprovalsAllowlist(r1.doc, "mnemospark", "/usr/bin/node");
    expect(r2.changed).toBe(true);
    expect(r2.doc.agents?.["mnemospark-renewal"]?.allowlist).toHaveLength(1);
    expect(r2.doc.agents?.mnemospark?.allowlist).toHaveLength(1);
    const r3 = mergeExecApprovalsAllowlist(r2.doc, "mnemospark-renewal", "/usr/bin/node");
    const r4 = mergeExecApprovalsAllowlist(r3.doc, "mnemospark", "/usr/bin/node");
    expect(r3.changed).toBe(false);
    expect(r4.changed).toBe(false);
  });
});
