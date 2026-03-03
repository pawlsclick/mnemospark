export function isValidWalletPrivateKey(value: string | undefined): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}
