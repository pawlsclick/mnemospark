import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const BASE_DIR = join(homedir(), ".openclaw", "mnemospark");
/** Higher ceiling now that proxy + command share events.jsonl. */
const MAX_BYTES = 15 * 1024 * 1024;
const KEEP_ROTATED = 12;

function resolvePath(fileName: string, homeDir?: string): string {
  const baseDir = homeDir ? join(homeDir, ".openclaw", "mnemospark") : BASE_DIR;
  return join(baseDir, fileName);
}

async function rotateIfNeeded(path: string): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    return;
  }
  if (fileStat.size < MAX_BYTES) return;

  const rotated = `${path}.${Date.now()}.1`;
  await rename(path, rotated);

  const gzPath = `${rotated}.gz`;
  await pipeline(createReadStream(rotated), createGzip(), createWriteStream(gzPath));
  await unlink(rotated).catch(() => undefined);

  const dir = dirname(path);
  const base = basename(path) || "events.jsonl";
  const all = (await readdir(dir))
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".gz"))
    .sort()
    .reverse();

  const stale = all.slice(KEEP_ROTATED);
  await Promise.all(stale.map((name) => unlink(join(dir, name)).catch(() => undefined)));
}

export async function appendJsonlEvent(
  fileName: string,
  event: Record<string, unknown>,
  homeDir?: string,
): Promise<void> {
  const filePath = resolvePath(fileName, homeDir);
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf-8");
  await rotateIfNeeded(filePath);
}
