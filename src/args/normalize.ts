export function normalizeSmartQuotes(input: string): string {
  return input.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

/**
 * Converts en/em dash at token start to `--` for flag-like tokens (after whitespace or start).
 */
export function normalizeFlagPositionDashes(input: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const pattern = /(^|\s)[\u2013\u2014](?=[A-Za-z_][A-Za-z0-9_-]*)/g;

  let changed = false;
  const text = input.replace(pattern, (m, prefix: string) => {
    changed = true;
    return `${prefix}--`;
  });

  if (changed) {
    warnings.push("Normalized en/em dash in flag position to ASCII double hyphen.");
  }

  return { text, warnings };
}

export type NormalizedInput = {
  text: string;
  warnings: string[];
};

/**
 * Full normalization pipeline before tokenization (smart quotes, flag-position dashes).
 */
export function normalizeInputForParsing(input: string): NormalizedInput {
  const warnings: string[] = [];
  let text = normalizeSmartQuotes(input);
  const dashNorm = normalizeFlagPositionDashes(text);
  text = dashNorm.text;
  warnings.push(...dashNorm.warnings);
  return { text, warnings };
}
