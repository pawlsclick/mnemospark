import { spawn } from "node:child_process";
import { randomBytes as randomBytesNode, createHash } from "node:crypto";
import { createReadStream, existsSync, statfsSync } from "node:fs";
import { appendFile, lstat, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { OpenClawPluginCommandDefinition } from "./types.js";

const SUPPORTED_BACKUP_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "linux"]);
const DEFAULT_TMP_DIR = "/tmp";
const OBJECT_LOG_SUBPATH = join(".openclaw", "mnemospark", "object.log");
const TAR_OVERHEAD_BYTES = 10 * 1024 * 1024; // Conservative headroom for tar metadata.

const CLOUD_HELP_TEXT = [
  "☁️ **mnemospark Cloud Commands**",
  "",
  "• `/cloud` or `/cloud help`",
  "• `/cloud backup <file>`",
  "• `/cloud backup <directory>`",
  "",
  "Backup creates a tar+gzip object in /tmp and appends object metadata to ~/.openclaw/mnemospark/object.log.",
].join("\n");

type BackupObjectOptions = {
  platform?: NodeJS.Platform;
  tmpDir?: string;
  homeDir?: string;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  availableDiskBytes?: number;
};

type BackupObjectResult = {
  objectId: string;
  objectIdHash: string;
  objectSizeGb: string;
  archivePath: string;
  objectLogPath: string;
};

type CreateCloudCommandOptions = {
  backupOptions?: BackupObjectOptions;
  buildBackupObjectFn?: (
    targetPath: string,
    options?: BackupObjectOptions,
  ) => Promise<BackupObjectResult>;
};

class UnsupportedBackupPlatformError extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`Unsupported platform for backup: ${platform}`);
    this.name = "UnsupportedBackupPlatformError";
  }
}

function toGbString(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  const fixed = gb.toFixed(9).replace(/\.?0+$/, "");
  if (!fixed) return "0";
  return fixed.includes(".") ? fixed : `${fixed}.0`;
}

function stripWrappingQuotes(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length < 2) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseCloudArgs(args?: string): {
  mode: "help" | "backup" | "unknown";
  backupTarget?: string;
} {
  const trimmed = args?.trim() ?? "";
  if (!trimmed) {
    return { mode: "help" };
  }

  const spaceIdx = trimmed.indexOf(" ");
  const subcommand = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  if (subcommand === "help") {
    return { mode: "help" };
  }

  if (subcommand === "backup") {
    const backupTarget = stripWrappingQuotes(rest);
    if (!backupTarget) {
      return { mode: "unknown" };
    }
    return { mode: "backup", backupTarget };
  }

  return { mode: "unknown" };
}

async function calculateInputSizeBytes(targetPath: string): Promise<number> {
  const targetStats = await lstat(targetPath);
  if (targetStats.isFile() || targetStats.isSymbolicLink()) {
    return targetStats.size;
  }

  if (!targetStats.isDirectory()) {
    throw new Error("Backup target must be a file or directory");
  }

  let total = 0;
  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    total += await calculateInputSizeBytes(join(targetPath, entry.name));
  }
  return total;
}

function getAvailableDiskBytes(tmpDir: string, options: BackupObjectOptions): number {
  if (typeof options.availableDiskBytes === "number") {
    return options.availableDiskBytes;
  }
  const stats = statfsSync(tmpDir);
  return stats.bavail * stats.bsize;
}

async function runTarGzip(archivePath: string, sourcePath: string): Promise<void> {
  const sourceDir = dirname(sourcePath);
  const sourceName = basename(sourcePath);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let stderr = "";
    const child = spawn("tar", ["-czf", archivePath, "-C", sourceDir, sourceName], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(stderr.trim() || `tar exited with code ${code ?? "unknown"}`));
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise());
  });
  return hash.digest("hex");
}

function createObjectId(options: BackupObjectOptions): string {
  const nowFn = options.now ?? Date.now;
  const randomFn = options.randomBytes ?? randomBytesNode;
  return `${nowFn()}-${randomFn(8).toString("hex")}`;
}

export async function buildBackupObject(
  targetPathArg: string,
  options: BackupObjectOptions = {},
): Promise<BackupObjectResult> {
  const platform = options.platform ?? process.platform;
  if (!SUPPORTED_BACKUP_PLATFORMS.has(platform)) {
    throw new UnsupportedBackupPlatformError(platform);
  }

  const targetPath = resolve(targetPathArg);
  const targetStats = await lstat(targetPath);
  if (!targetStats.isFile() && !targetStats.isDirectory()) {
    throw new Error("Backup target must be a file or directory");
  }

  const tmpDir = options.tmpDir ?? DEFAULT_TMP_DIR;
  if (!existsSync(tmpDir)) {
    throw new Error("Temporary directory does not exist");
  }
  const tmpStats = await stat(tmpDir);
  if (!tmpStats.isDirectory()) {
    throw new Error("Temporary path is not a directory");
  }

  const inputSizeBytes = await calculateInputSizeBytes(targetPath);
  const availableDiskBytes = getAvailableDiskBytes(tmpDir, options);
  const requiredDiskBytes = inputSizeBytes + TAR_OVERHEAD_BYTES;
  if (availableDiskBytes < requiredDiskBytes) {
    throw new Error("Insufficient /tmp disk space for backup object");
  }

  const objectId = createObjectId(options);
  const archivePath = join(tmpDir, objectId);
  await runTarGzip(archivePath, targetPath);

  const archiveStats = await stat(archivePath);
  const objectIdHash = await sha256File(archivePath);
  const objectSizeGb = toGbString(archiveStats.size);

  const homeDir = options.homeDir ?? homedir();
  const objectLogPath = join(homeDir, OBJECT_LOG_SUBPATH);
  await mkdir(dirname(objectLogPath), { recursive: true });
  await appendFile(objectLogPath, `${objectId},${objectIdHash},${objectSizeGb}\n`, "utf-8");

  return {
    objectId,
    objectIdHash,
    objectSizeGb,
    archivePath,
    objectLogPath,
  };
}

export function createCloudCommand(
  options: CreateCloudCommandOptions = {},
): OpenClawPluginCommandDefinition {
  const backupBuilder = options.buildBackupObjectFn ?? buildBackupObject;

  return {
    name: "cloud",
    description: "Manage mnemospark cloud storage workflow commands",
    acceptsArgs: true,
    requireAuth: false,
    handler: async (ctx) => {
      const parsed = parseCloudArgs(ctx.args);
      if (parsed.mode === "help" || parsed.mode === "unknown") {
        return {
          text: CLOUD_HELP_TEXT,
          isError: parsed.mode === "unknown",
        };
      }

      try {
        const result = await backupBuilder(parsed.backupTarget!, options.backupOptions);
        return {
          text: `Your object-id is ${result.objectId} your object-id-hash is ${result.objectIdHash} and your object-size is ${result.objectSizeGb}`,
        };
      } catch (err) {
        if (err instanceof UnsupportedBackupPlatformError) {
          return {
            text: "Cloud backup is only supported on macOS and Linux.",
            isError: true,
          };
        }
        return {
          text: "Cannot build storage object",
          isError: true,
        };
      }
    },
  };
}

export { BackupObjectOptions, BackupObjectResult, CreateCloudCommandOptions };
