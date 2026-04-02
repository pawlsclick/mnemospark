import { spawn } from "node:child_process";
import { join } from "node:path";

export type OpenClawCliResult = { stdout: string; stderr: string };

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

/**
 * Resolve `openclaw config file` output to an absolute path (CLI may print `~/.openclaw/...`).
 */
export async function resolveOpenClawConfigFilePath(homeDir: string): Promise<string> {
  const { stdout } = await runOpenClawCli(["config", "file"], homeDir);
  const trimmed = stdout.trim();
  if (trimmed.startsWith("~/")) {
    return join(homeDir, trimmed.slice(2));
  }
  if (trimmed.startsWith("~\\")) {
    return join(homeDir, trimmed.slice(2));
  }
  return trimmed;
}
