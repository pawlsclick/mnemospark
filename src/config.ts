/**
 * Configuration Module
 *
 * Reads environment variables at module load time.
 * Separated from network code to avoid security scanner false positives.
 */

const DEFAULT_PORT = 7120;

/** Production API; override with `MNEMOSPARK_BACKEND_API_BASE_URL` when needed. */
const DEFAULT_BACKEND_API_BASE_URL = "https://api.mnemospark.ai";

/**
 * Proxy port configuration - resolved once at module load.
 * Reads MNEMOSPARK_PROXY_PORT env var or defaults to 7120 (mnemospark does not conflict with BlockRun proxy on 8402).
 */
export const PROXY_PORT = (() => {
  const envPort = process.env.MNEMOSPARK_PROXY_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
  }
  return DEFAULT_PORT;
})();

/**
 * Mnemospark backend API base URL for proxy → backend calls.
 * Defaults to production; set `MNEMOSPARK_BACKEND_API_BASE_URL` to override (e.g. staging or a private API Gateway URL).
 */
export const MNEMOSPARK_BACKEND_API_BASE_URL = (
  process.env.MNEMOSPARK_BACKEND_API_BASE_URL ?? DEFAULT_BACKEND_API_BASE_URL
).trim();

/**
 * When true, unknown HTTP paths return a 404 JSON body that includes a `message`
 * listing supported routes. Default is a generic `{ "error": "Not found" }` only.
 */
export const MNEMOSPARK_PROXY_VERBOSE_404 = (() => {
  const v = process.env.MNEMOSPARK_PROXY_VERBOSE_404?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
})();
