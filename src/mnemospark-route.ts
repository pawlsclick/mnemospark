/**
 * Top-level /mnemospark argument routing (after the slash command name).
 */

export type MnemosparkRoute =
  | { kind: "root-help" }
  | { kind: "cloud"; rest: string }
  | { kind: "wallet"; rest: string }
  | { kind: "error"; message: string };

/**
 * Parse first token optional `name:true` form. Rejects non-true values after colon.
 */
export function parseVerboseToken(token: string): { name: string; ok: boolean } {
  const t = token.trim();
  const idx = t.indexOf(":");
  if (idx < 0) {
    return { name: t.toLowerCase(), ok: true };
  }
  const key = t.slice(0, idx).trim();
  const val = t
    .slice(idx + 1)
    .trim()
    .toLowerCase();
  if (!key) return { name: "", ok: false };
  if (val === "true") return { name: key.toLowerCase(), ok: true };
  return { name: key.toLowerCase(), ok: false };
}

export function firstTokenAndRest(input: string): { first: string; rest: string } {
  const t = input.trim();
  if (!t) return { first: "", rest: "" };
  const spaceIdx = t.search(/\s/);
  if (spaceIdx === -1) return { first: t, rest: "" };
  return { first: t.slice(0, spaceIdx), rest: t.slice(spaceIdx + 1).trim() };
}

/**
 * Routes `ctx.args` for `/mnemospark` (everything after the command name).
 */
export function routeMnemosparkArgs(args: string | undefined): MnemosparkRoute {
  const trimmed = args?.trim() ?? "";
  if (!trimmed) {
    return { kind: "root-help" };
  }

  const { first, rest } = firstTokenAndRest(trimmed);
  const parsed = parseVerboseToken(first);
  if (!parsed.ok) {
    return {
      kind: "error",
      message: `Invalid token "${first}". Use name:true only with value true, or a bare name (e.g. cloud, wallet, help).`,
    };
  }

  const head = parsed.name;

  if (head === "help") {
    return { kind: "root-help" };
  }

  if (head === "cloud") {
    return { kind: "cloud", rest };
  }

  if (head === "wallet") {
    return { kind: "wallet", rest };
  }

  return {
    kind: "error",
    message: [
      `Unknown command "${first}".`,
      "",
      "Try:",
      "• `/mnemospark help` — overview",
      "• `/mnemospark cloud help` — cloud commands",
      "• `/mnemospark wallet` — wallet status",
      "• `/mnemospark wallet help` — wallet commands",
    ].join("\n"),
  };
}
