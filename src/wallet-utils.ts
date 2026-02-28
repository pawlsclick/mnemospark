/**
 * Normalizes a wallet signature string: trims whitespace and returns undefined
 * for empty or whitespace-only values.
 */
export function normalizeWalletSignature(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
