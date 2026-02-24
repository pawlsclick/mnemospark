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
