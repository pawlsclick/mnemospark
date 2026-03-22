export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePaymentRequired(headers: Headers): string | undefined {
  return headers.get("PAYMENT-REQUIRED") ?? headers.get("x-payment-required") ?? undefined;
}

export function normalizePaymentResponse(headers: Headers): string | undefined {
  return headers.get("PAYMENT-RESPONSE") ?? headers.get("x-payment-response") ?? undefined;
}

const BYTE_SI_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTE_SI_BASE = 1000;

/**
 * Human-readable size using decimal (SI) prefixes: 1 KB = 1_000 B.
 * At most one fractional digit for KB+; prefer integers when within 1% of a whole unit.
 */
export function formatBytesForDisplay(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 0 || !Number.isFinite(bytes)) {
    throw new Error("formatBytesForDisplay expects a non-negative integer");
  }
  if (bytes === 0) {
    return "0 B";
  }
  let value = bytes;
  let unitIndex = 0;
  while (value >= BYTE_SI_BASE && unitIndex < BYTE_SI_UNITS.length - 1) {
    value /= BYTE_SI_BASE;
    unitIndex += 1;
  }
  if (unitIndex === 0) {
    return `${bytes} B`;
  }
  const nearestInt = Math.round(value);
  const pickInt = nearestInt > 0 && Math.abs(value - nearestInt) / Math.max(value, 1e-9) <= 0.01;
  let rounded = pickInt ? nearestInt : Math.round(value * 10) / 10;
  if (rounded >= BYTE_SI_BASE && unitIndex < BYTE_SI_UNITS.length - 1) {
    rounded = Math.round((rounded / BYTE_SI_BASE) * 10) / 10;
    unitIndex += 1;
  }
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/\.0$/, "");
  return `${text} ${BYTE_SI_UNITS[unitIndex]}`;
}
