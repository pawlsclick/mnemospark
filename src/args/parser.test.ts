import { describe, expect, it } from "vitest";

import { parseCommandArgs } from "./parser.js";
import type { CommandArgSchema } from "./types.js";

const FREEFORM_SCHEMA: CommandArgSchema = {
  args: [{ name: "name" }, { name: "object-key" }],
};

const MIXED_BOOLEAN_SCHEMA: CommandArgSchema = {
  args: [{ name: "latest", bareBoolean: true }, { name: "name" }, { name: "wallet-address" }],
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

  it("does not consume key:value token as value for bare booleans", () => {
    const result = parseCommandArgs(
      "--latest name:myfile --wallet-address 0x123",
      MIXED_BOOLEAN_SCHEMA,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`Expected parser success: ${result.errors.join("; ")}`);
    }
    expect(result.values.latest).toBe("true");
    expect(result.values.name).toBe("myfile");
    expect(result.values["wallet-address"]).toBe("0x123");
  });
});
