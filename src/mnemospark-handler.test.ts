import { describe, expect, it } from "vitest";

import { MNEMOSPARK_ROOT_HELP_TEXT } from "./mnemospark-handler.js";

describe("mnemospark root help", () => {
  it("omits Syntax paragraph and includes onboarding starter line", () => {
    expect(MNEMOSPARK_ROOT_HELP_TEXT).not.toContain("**Syntax:**");
    expect(MNEMOSPARK_ROOT_HELP_TEXT).toContain("Start here to securely upload");
    expect(MNEMOSPARK_ROOT_HELP_TEXT).toContain(
      "`/mnemospark cloud backup <file|directory> name:<friendly-name> async:true`",
    );
    expect(MNEMOSPARK_ROOT_HELP_TEXT).toContain("**Let your agent run mnemospark for you:**");
    expect(MNEMOSPARK_ROOT_HELP_TEXT).toContain("• `/mnemospark wallet create`");
    expect(MNEMOSPARK_ROOT_HELP_TEXT).toContain("~/.openclaw/extensions/mnemospark/");
    expect(MNEMOSPARK_ROOT_HELP_TEXT).toContain(
      "`~/.openclaw/extensions/mnemospark/skills/mnemospark/SKILL.md`",
    );
  });
});
