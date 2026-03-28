import { normalizeInputForParsing } from "./normalize.js";
import type { ArgSpec, CommandArgSchema, ParseResult } from "./types.js";
import { suggestNearestKey } from "./suggest.js";

type Token = {
  raw: string;
  value: string;
};

function canonicalizeKey(rawKey: string): string {
  return rawKey
    .normalize("NFKC")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/_/g, "-")
    .toLowerCase()
    .trim();
}

export function buildAliasMap(schema: CommandArgSchema): Map<string, ArgSpec> {
  const map = new Map<string, ArgSpec>();

  for (const spec of schema.args) {
    map.set(canonicalizeKey(spec.name), spec);
    for (const alias of spec.aliases ?? []) {
      map.set(canonicalizeKey(alias), spec);
    }
  }

  return map;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;

    let raw = "";
    let value = "";

    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++]!;
      raw += quote;

      while (i < input.length) {
        const ch = input[i++]!;
        raw += ch;

        if (ch === "\\") {
          if (i < input.length) {
            const next = input[i++]!;
            raw += next;
            value += next;
          }
          continue;
        }

        if (ch === quote) {
          break;
        }

        value += ch;
      }

      tokens.push({ raw, value });
      continue;
    }

    while (i < input.length && !/\s/.test(input[i]!)) {
      const ch = input[i++]!;
      raw += ch;
      value += ch;
    }

    tokens.push({ raw, value });
  }

  return tokens;
}

function resolveKey(
  rawKey: string,
  aliasMap: Map<string, ArgSpec>,
  schema: CommandArgSchema,
  allCanonicalNames: string[],
): { key?: string; spec?: ArgSpec; error?: string } {
  const canonical = canonicalizeKey(rawKey);
  const spec = aliasMap.get(canonical);

  if (!spec) {
    if (schema.allowUnknown) return { key: canonical };
    const suggestion = suggestNearestKey(rawKey, allCanonicalNames);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
    return { error: `Unknown argument "${rawKey}".${hint}` };
  }

  return { key: spec.name, spec };
}

function addValue(
  out: Record<string, string | string[]>,
  key: string,
  value: string,
  spec?: ArgSpec,
): string | null {
  const existing = out[key];

  if (existing === undefined) {
    out[key] = spec?.repeatable ? [value] : value;
    return null;
  }

  if (!spec?.repeatable) {
    return `Duplicate argument "${key}".`;
  }

  if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    out[key] = [existing, value];
  }

  return null;
}

function collectCanonicalNames(schema: CommandArgSchema): string[] {
  const names = new Set<string>();
  for (const spec of schema.args) {
    names.add(spec.name);
    for (const a of spec.aliases ?? []) {
      names.add(a);
    }
  }
  return [...names];
}

function tryParseDelimitedToken(
  token: string,
  delimiter: ":" | "=",
  aliasMap: Map<string, ArgSpec>,
  schema: CommandArgSchema,
  allCanonicalNames: string[],
  out: Record<string, string | string[]>,
): { handled: boolean; error?: string } {
  const idx = token.indexOf(delimiter);
  if (idx <= 0) return { handled: false };

  const keyPart = token.slice(0, idx);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(keyPart)) return { handled: false };

  const rawKey = keyPart;
  const rawValue = token.slice(idx + 1);
  if (rawValue === "") {
    return { handled: true, error: `Empty value for argument "${rawKey}".` };
  }

  const resolved = resolveKey(rawKey, aliasMap, schema, allCanonicalNames);
  if (resolved.error) {
    return { handled: true, error: resolved.error };
  }

  const dupErr = addValue(out, resolved.key!, rawValue, resolved.spec);
  if (dupErr) {
    return { handled: true, error: dupErr };
  }

  return { handled: true };
}

export function parseCommandArgs(input: string, schema: CommandArgSchema): ParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const norm = normalizeInputForParsing(input);
  const normalized = norm.text;
  warnings.push(...norm.warnings);

  const tokens = tokenize(normalized);
  const aliasMap = buildAliasMap(schema);
  const allCanonicalNames = collectCanonicalNames(schema);
  const values: Record<string, string | string[]> = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.value;

    {
      const parsed = tryParseDelimitedToken(
        token,
        ":",
        aliasMap,
        schema,
        allCanonicalNames,
        values,
      );
      if (parsed.handled) {
        if (parsed.error) errors.push(parsed.error);
        continue;
      }
    }

    {
      const parsed = tryParseDelimitedToken(
        token,
        "=",
        aliasMap,
        schema,
        allCanonicalNames,
        values,
      );
      if (parsed.handled) {
        if (parsed.error) errors.push(parsed.error);
        continue;
      }
    }

    if (token.startsWith("--")) {
      const rawKey = token.slice(2);
      if (!rawKey) {
        errors.push('Encountered "--" without an argument name.');
        continue;
      }

      const resolved = resolveKey(rawKey, aliasMap, schema, allCanonicalNames);
      if (resolved.error) {
        errors.push(resolved.error);
        continue;
      }

      const next = tokens[i + 1];
      if (!next) {
        if (resolved.spec?.bareBoolean) {
          const dupErr = addValue(values, resolved.key!, "true", resolved.spec);
          if (dupErr) errors.push(dupErr);
          continue;
        }
        errors.push(`Missing value for argument "${resolved.key}".`);
        continue;
      }

      if (next.value.startsWith("--")) {
        if (resolved.spec?.bareBoolean) {
          const dupErr = addValue(values, resolved.key!, "true", resolved.spec);
          if (dupErr) errors.push(dupErr);
          continue;
        }
        errors.push(`Missing value for argument "${resolved.key}".`);
        continue;
      }

      const dupErr = addValue(values, resolved.key!, next.value, resolved.spec);
      if (dupErr) errors.push(dupErr);

      i += 1;
      continue;
    }

    errors.push(`Unexpected token "${token}". Use key:value, key=value, or --key value.`);
  }

  for (const spec of schema.args) {
    if (spec.required && values[spec.name] === undefined) {
      errors.push(`Missing required argument "${spec.name}".`);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      normalizedInput: normalized,
      errors,
      warnings,
    };
  }

  return {
    ok: true,
    normalizedInput: normalized,
    values,
    warnings,
  };
}

export function valuesToStringRecord(
  values: Record<string, string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = Array.isArray(v) ? v[v.length - 1]! : v;
  }
  return out;
}
