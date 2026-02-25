/**
 * Configuration Module
 *
 * Reads environment variables at module load time.
 * Separated from network code to avoid security scanner false positives.
 */

const DEFAULT_PORT = 7120;

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
 * Example: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
 */
export const MNEMOSPARK_BACKEND_API_BASE_URL = (
  process.env.MNEMOSPARK_BACKEND_API_BASE_URL ?? ""
).trim();

/**
 * Mnemospark backend API key for proxy → backend calls.
 * Supports a legacy fallback env name for compatibility.
 */
export const MNEMOSPARK_BACKEND_API_KEY = (
  process.env.MNEMOSPARK_BACKEND_API_KEY ??
  process.env.MNEMOSPARK_API_KEY ??
  ""
).trim();
