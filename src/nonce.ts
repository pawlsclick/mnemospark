/**
 * Generates a cryptographically random 32-byte value as a 0x-prefixed hex string.
 * Used for request signing nonces and payment transfer nonces.
 */
export function createNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}
