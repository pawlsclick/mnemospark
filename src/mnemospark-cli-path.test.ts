import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveMnemosparkCliPath } from "./mnemospark-cli-path.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.MNEMOSPARK_CLI_PATH;
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("resolveMnemosparkCliPath", () => {
  it("prefers MNEMOSPARK_CLI_PATH when set", () => {
    const dir = join(tmpdir(), `mnemospark-cli-env-${Date.now()}`);
    tempDirs.push(dir);
    const custom = join(dir, "custom-cli.js");
    process.env.MNEMOSPARK_CLI_PATH = custom;

    expect(resolveMnemosparkCliPath({ requireExists: false })).toBe(custom);
  });

  it("resolves cli.js adjacent to the package module (npm plugin layout)", async () => {
    const npmRoot = await mkdtemp(join(tmpdir(), "openclaw-npm-mnemospark-"));
    tempDirs.push(npmRoot);
    const distDir = join(npmRoot, "dist");
    await mkdir(distDir, { recursive: true });
    const cliPath = join(distDir, "cli.js");
    await writeFile(cliPath, "#!/usr/bin/env node\n", "utf-8");

    const moduleUrl = pathToFileURL(join(distDir, "cloud-command.js")).href;
    expect(resolveMnemosparkCliPath({ moduleUrl, requireExists: true })).toBe(cliPath);
  });

  it("throws when cli is missing and requireExists is true", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "mnemospark-empty-pkg-"));
    tempDirs.push(emptyDir);
    const moduleUrl = pathToFileURL(join(emptyDir, "cloud-command.js")).href;

    expect(() => resolveMnemosparkCliPath({ moduleUrl, requireExists: true })).toThrow(
      /mnemospark CLI not found/,
    );
  });
});
