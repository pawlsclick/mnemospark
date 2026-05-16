import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MODULE_URL = import.meta.url;

export type ResolveMnemosparkCliPathOptions = {
  /** Module URL to resolve adjacent to (defaults to this module). */
  moduleUrl?: string;
  /** When true (default), throw if the resolved path is missing on disk. */
  requireExists?: boolean;
};

/**
 * Absolute path to `dist/cli.js` for the running mnemospark package.
 * Override with MNEMOSPARK_CLI_PATH (e.g. OpenClaw cron payloads on custom layouts).
 */
export function resolveMnemosparkCliPath(options: ResolveMnemosparkCliPathOptions = {}): string {
  const fromEnv = process.env.MNEMOSPARK_CLI_PATH?.trim();
  if (fromEnv) {
    assertCliExists(fromEnv, options.requireExists);
    return fromEnv;
  }

  const moduleDir = dirname(fileURLToPath(options.moduleUrl ?? DEFAULT_MODULE_URL));
  const candidates = [join(moduleDir, "cli.js"), join(moduleDir, "cli.ts")];
  const resolved = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  assertCliExists(resolved, options.requireExists);
  return resolved;
}

function assertCliExists(cliPath: string, requireExists: boolean | undefined): void {
  if (requireExists === false) {
    return;
  }
  if (existsSync(cliPath)) {
    return;
  }
  throw new Error(
    `mnemospark CLI not found at ${cliPath}. Install the plugin or set MNEMOSPARK_CLI_PATH to the installed dist/cli.js.`,
  );
}
