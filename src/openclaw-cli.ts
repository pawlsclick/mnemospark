import { spawn } from "node:child_process";
import { join } from "node:path";

export type OpenClawCliResult = { stdout: string; stderr: string };

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const BOX_DRAWING_RE = /[\u2500-\u257F]/g;

/**
 * Run the `openclaw` CLI with optional HOME override (used for tests and multi-user paths).
 */
export async function runOpenClawCli(args: string[], homeDir?: string): Promise<OpenClawCliResult> {
  return await new Promise<OpenClawCliResult>((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("openclaw", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: homeDir ?? process.env.HOME,
      },
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `openclaw ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

export function parseOpenClawCliJson<T>(stdout: string, commandLabel: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`openclaw ${commandLabel} returned empty JSON output`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`openclaw ${commandLabel} returned invalid JSON output`);
  }
}

function stripCliDecorations(line: string): string {
  return line.replace(ANSI_ESCAPE_RE, "").replace(BOX_DRAWING_RE, "").trim();
}

function expandHomePath(homeDir: string, line: string): string {
  if (line.startsWith("~/")) {
    return join(homeDir, line.slice(2));
  }
  if (line.startsWith("~\\")) {
    return join(homeDir, line.slice(2));
  }
  return line;
}

function looksLikeOpenClawConfigPath(line: string): boolean {
  if (!line || line.includes("\n")) {
    return false;
  }
  if (line.endsWith("openclaw.json")) {
    return true;
  }
  if (line.startsWith("~/") || line.startsWith("~\\")) {
    return true;
  }
  if (line.startsWith("/")) {
    return true;
  }
  return /^[A-Za-z]:\\/.test(line);
}

/**
 * Parse `openclaw config file` stdout, ignoring warning boxes and other CLI decoration.
 * Returns null when no plausible config path is found.
 */
export function parseOpenClawConfigFileStdout(stdout: string, homeDir: string): string | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripCliDecorations(lines[i] ?? "");
    if (!line || !looksLikeOpenClawConfigPath(line)) {
      continue;
    }
    return expandHomePath(homeDir, line);
  }
  return null;
}

/**
 * Deterministic OpenClaw config path (matches cli.ts / OpenClaw state dir conventions).
 */
export function getOpenClawConfigPath(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const stateDir = env.OPENCLAW_STATE_DIR ?? join(homeDir, ".openclaw");
  return join(stateDir, "openclaw.json");
}

/**
 * Resolve the OpenClaw config file to an absolute path.
 * Prefers deterministic state-dir resolution; uses `openclaw config file` only when it
 * returns a parseable path (ignoring warning boxes and other decorated stdout).
 */
export async function resolveOpenClawConfigFilePath(homeDir: string): Promise<string> {
  const fallback = getOpenClawConfigPath(homeDir);
  try {
    const { stdout } = await runOpenClawCli(["config", "file"], homeDir);
    const parsed = parseOpenClawConfigFileStdout(stdout, homeDir);
    if (parsed) {
      return parsed;
    }
  } catch {
    // openclaw missing or config file command failed — use deterministic fallback
  }
  return fallback;
}
