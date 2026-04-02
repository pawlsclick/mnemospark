import { describe, expect, it } from "vitest";

import {
  mergeExecApprovalsAllowlist,
  mergeRenewalAgentIntoAgentsList,
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
});
