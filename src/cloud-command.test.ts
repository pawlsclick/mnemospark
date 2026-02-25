import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildBackupObject, createCloudCommand } from "./cloud-command.js";

const sandboxDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    sandboxDirs.map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
  sandboxDirs.length = 0;
});

async function createSandbox() {
  const root = await mkdtemp(join(tmpdir(), "mnemospark-cloud-backup-"));
  sandboxDirs.push(root);
  const homeDir = join(root, "home");
  const tmpBackupDir = join(root, "tmp");
  const sourceDir = join(root, "source");

  await mkdir(homeDir, { recursive: true });
  await mkdir(tmpBackupDir, { recursive: true });
  await mkdir(sourceDir, { recursive: true });

  return { root, homeDir, tmpBackupDir, sourceDir };
}

function randomBytesFixture(size: number): Buffer {
  return Buffer.from("0011223344556677".slice(0, size * 2), "hex");
}

describe("cloud backup command", () => {
  it("builds tar.gz object, computes hash/size, and appends object.log entry", async () => {
    const { homeDir, tmpBackupDir, sourceDir } = await createSandbox();
    await writeFile(join(sourceDir, "notes.txt"), "hello from mnemospark backup");

    const result = await buildBackupObject(sourceDir, {
      platform: "linux",
      homeDir,
      tmpDir: tmpBackupDir,
      now: () => 1700000000000,
      randomBytes: randomBytesFixture,
    });

    expect(result.objectId).toBe("1700000000000-0011223344556677");
    expect(result.objectIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number.parseFloat(result.objectSizeGb)).toBeGreaterThan(0);

    const archiveStats = await stat(result.archivePath);
    expect(archiveStats.size).toBeGreaterThan(0);

    const logContent = await readFile(result.objectLogPath, "utf-8");
    const lastLine = logContent.trim().split("\n").at(-1);
    expect(lastLine).toBe(`${result.objectId},${result.objectIdHash},${result.objectSizeGb}`);
  });

  it("returns expected user message for /cloud backup and supports quoted paths", async () => {
    const { homeDir, tmpBackupDir, root } = await createSandbox();
    const sourcePathWithSpaces = join(root, "source file.txt");
    await writeFile(sourcePathWithSpaces, "backup me");

    const command = createCloudCommand({
      backupOptions: {
        platform: "linux",
        homeDir,
        tmpDir: tmpBackupDir,
        now: () => 1700000001000,
        randomBytes: randomBytesFixture,
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: `backup "${sourcePathWithSpaces}"`,
      commandBody: `backup "${sourcePathWithSpaces}"`,
      config: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.text).toContain("Your object-id is");
    expect(result.text).toContain("your object-id-hash is");
    expect(result.text).toContain("and your object-size is");
  });

  it("returns graceful unsupported-platform message", async () => {
    const command = createCloudCommand({
      backupOptions: {
        platform: "win32",
      },
    });

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      args: "backup /tmp/something",
      commandBody: "backup /tmp/something",
      config: {},
    });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("Cloud backup is only supported on macOS and Linux.");
  });
});
