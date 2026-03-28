import { describe, expect, it } from "vitest";

import { parseCommandArgs } from "./parser.js";
import type { CommandArgSchema } from "./types.js";

const FREEFORM_SCHEMA: CommandArgSchema = {
  args: [{ name: "name" }, { name: "object-key" }],
};

describe("parseCommandArgs", () => {
  it("accepts colon-delimited values for --key value syntax", () => {
    const result = parseCommandArgs("--name project:v2", FREEFORM_SCHEMA);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected parser success: ${result.errors.join("; ")}`);
    }
    expect(result.values.name).toBe("project:v2");
  });

  it("accepts equals-delimited values for --key value syntax", () => {
    const result = parseCommandArgs(
      "--name project=v2 --object-key data:archive.tar.gz",
      FREEFORM_SCHEMA,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected parser success: ${result.errors.join("; ")}`);
    }
    expect(result.values.name).toBe("project=v2");
    expect(result.values["object-key"]).toBe("data:archive.tar.gz");
  });
});
