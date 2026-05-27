import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getOpenClawConfigPath, parseOpenClawConfigFileStdout } from "./openclaw-cli.js";

const PRODUCTION_WARNING_BOX_STDOUT = `│
◇  Config warnings ────────────────────────────────────────────────────────────╮
│                                                                              │
│  - plugins.entries.clawrouter: plugin clawrouter: duplicate plugin id        │
│    detected; global plugin will be overridden by global plugin               │
│    (/home/ubuntu/.openclaw/npm/node_modules/@blockrun/clawrouter/dist/index  │
│  .js)                                                                        │
│  - plugins.entries.memory-wiki: plugin disabled (disabled in config)         │
│    but config is present                                                     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────╯
~/.openclaw/openclaw.json
`;

afterEach(() => {
  delete process.env.OPENCLAW_STATE_DIR;
});

describe("getOpenClawConfigPath", () => {
  it("defaults to ~/.openclaw/openclaw.json", () => {
    expect(getOpenClawConfigPath("/home/ubuntu")).toBe("/home/ubuntu/.openclaw/openclaw.json");
  });

  it("honors OPENCLAW_STATE_DIR override", () => {
    process.env.OPENCLAW_STATE_DIR = "/var/lib/openclaw";
    expect(getOpenClawConfigPath("/home/ubuntu")).toBe("/var/lib/openclaw/openclaw.json");
  });
});

describe("parseOpenClawConfigFileStdout", () => {
  it("parses a plain tilde path", () => {
    expect(parseOpenClawConfigFileStdout("~/.openclaw/openclaw.json\n", "/home/ubuntu")).toBe(
      "/home/ubuntu/.openclaw/openclaw.json",
    );
  });

  it("parses warning box output with path on the last line", () => {
    expect(parseOpenClawConfigFileStdout(PRODUCTION_WARNING_BOX_STDOUT, "/home/ubuntu")).toBe(
      "/home/ubuntu/.openclaw/openclaw.json",
    );
  });

  it("parses an absolute path", () => {
    expect(
      parseOpenClawConfigFileStdout("/home/ubuntu/.openclaw/openclaw.json\n", "/home/ubuntu"),
    ).toBe("/home/ubuntu/.openclaw/openclaw.json");
  });

  it("returns null when stdout has no config path", () => {
    expect(
      parseOpenClawConfigFileStdout("Config warnings only\nno path here\n", "/home/ubuntu"),
    ).toBe(null);
  });

  it("prefers the last path-like line when multiple are present", () => {
    const stdout = [
      "/tmp/not-the-config.json",
      "some log line",
      join("/custom", "state", "openclaw.json"),
    ].join("\n");
    expect(parseOpenClawConfigFileStdout(stdout, "/home/ubuntu")).toBe(
      join("/custom", "state", "openclaw.json"),
    );
  });
});
