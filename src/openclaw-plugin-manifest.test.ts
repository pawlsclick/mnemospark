import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("openclaw.plugin.json", () => {
  it("declares onStartup so the gateway loads mnemospark and starts the proxy service", () => {
    const raw = readFileSync(join(process.cwd(), "openclaw.plugin.json"), "utf8");
    const manifest = JSON.parse(raw) as { activation?: { onStartup?: boolean } };
    expect(manifest.activation?.onStartup).toBe(true);
  });
});
