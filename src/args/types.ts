export type ArgSpec = {
  name: string;
  aliases?: string[];
  required?: boolean;
  repeatable?: boolean;
  /** When true, `--name` may appear without a value (same as `name:true`). */
  bareBoolean?: boolean;
};

export type CommandArgSchema = {
  args: ArgSpec[];
  allowUnknown?: boolean;
};

export type ParseSuccess = {
  ok: true;
  normalizedInput: string;
  values: Record<string, string | string[]>;
  warnings: string[];
};

export type ParseFailure = {
  ok: false;
  normalizedInput: string;
  errors: string[];
  warnings: string[];
};

export type ParseResult = ParseSuccess | ParseFailure;
