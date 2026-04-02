import { describe, expect, it } from "vitest";

import {
  backupFlagsSchema,
  downloadSchema,
  opStatusSchema,
  paymentSettleSchema,
  priceStorageSchema,
  uploadSchema,
} from "../arg-schemas.js";
import { parseCommandArgs } from "./parser.js";
import type { CommandArgSchema } from "./types.js";

const FREEFORM_SCHEMA: CommandArgSchema = {
  args: [{ name: "name" }, { name: "object-key" }],
};

const MIXED_BOOLEAN_SCHEMA: CommandArgSchema = {
  args: [{ name: "latest", bareBoolean: true }, { name: "name" }, { name: "wallet-address" }],
};

const WALLET = "0x24bB8B93fbC0B87e4b0303aA1F71C51941726424";
const OID = "1774816919700-d7bb86a8fab10e34";
const HASH = "9fec74112e2fc5cf0f569b14276c11c62036f4ca57fb5b01c551336876bdd299";
const GB = "0.035035805";

const validPriceStorageLine = `wallet:${WALLET} object:${OID} hash:${HASH} gb:${GB} provider:aws region:us-east-1`;

describe("parseCommandArgs", () => {
  describe("price-storage schema", () => {
    it("accepts homogeneous key:value (no space after colon)", () => {
      const r = parseCommandArgs(validPriceStorageLine, priceStorageSchema);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.values["wallet-address"]).toBe(WALLET);
      expect(r.values["object-id"]).toBe(OID);
      expect(r.values["object-id-hash"]).toBe(HASH);
      expect(r.values.gb).toBe(GB);
      expect(r.values.provider).toBe("aws");
      expect(r.values.region).toBe("us-east-1");
    });

    it("allows omitting object-id-hash (resolved by mnemospark from local SQLite)", () => {
      const line = `wallet:${WALLET} object:${OID} gb:${GB} provider:aws region:us-east-1`;
      const r = parseCommandArgs(line, priceStorageSchema);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.values["object-id-hash"]).toBeUndefined();
    });

    it("accepts mixed --key value and key:value / aliases", () => {
      const line = `--wallet-address ${WALLET} object:${OID} hash:${HASH} gb:${GB} provider:aws region:us-east-1`;
      const r = parseCommandArgs(line, priceStorageSchema);
      expect(r.ok).toBe(true);
    });

    it("accepts key=value encoding", () => {
      const line = `wallet=${WALLET} object=${OID} hash=${HASH} gb=${GB} provider=aws region=us-east-1`;
      const r = parseCommandArgs(line, priceStorageSchema);
      expect(r.ok).toBe(true);
    });

    it("rejects a space after the colon in key:value (splits value into a stray token)", () => {
      const line = `wallet-address:${WALLET} object-id: ${OID} object-id-hash:${HASH} gb:${GB} provider:aws region:us-east-1`;
      const r = parseCommandArgs(line, priceStorageSchema);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors).toEqual(
        expect.arrayContaining([
          'Empty value for argument "object-id".',
          `Unexpected token "${OID}". Use key:value, key=value, or --key value.`,
          'Missing required argument "object-id".',
        ]),
      );
    });

    it("rejects newline between key: and value (same as stray token)", () => {
      const line = `wallet:${WALLET} object-id:\n${OID} object-id-hash:${HASH} gb:${GB} provider:aws region:us-east-1`;
      const r = parseCommandArgs(line, priceStorageSchema);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.includes("Unexpected token"))).toBe(true);
    });

    it("rejects duplicate keys", () => {
      const r = parseCommandArgs(
        `wallet:0x111 wallet:0x222 object:o hash:h gb:1 provider:aws region:r`,
        priceStorageSchema,
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors).toContain('Duplicate argument "wallet-address".');
    });

    it("rejects unknown keys with a suggestion when close to a valid name", () => {
      const r = parseCommandArgs(
        `wallet:${WALLET} object-id:${OID} object-id-hashh:${HASH} gb:${GB} provider:aws region:us-east-1`,
        priceStorageSchema,
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.includes('Unknown argument "object-id-hashh"'))).toBe(true);
    });

    it("allows values with colons when passed as a quoted token with --key", () => {
      const line = `--wallet-address "${WALLET}:suffix" --object-id ${OID} --object-id-hash ${HASH} --gb ${GB} --provider aws --region us-east-1`;
      const r = parseCommandArgs(line, priceStorageSchema);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.values["wallet-address"]).toBe(`${WALLET}:suffix`);
    });

    it("rejects ASCII key=value when space splits the value from =", () => {
      const r = parseCommandArgs("object-id= 17748", priceStorageSchema);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors).toEqual(expect.arrayContaining(['Empty value for argument "object-id".']));
    });

    it("rejects fullwidth colon (U+FF1A) in key:value — use ASCII ':'", () => {
      const line = `wallet${"："}${WALLET} object:${OID} hash:${HASH} gb:${GB} provider:aws region:us-east-1`;
      const r = parseCommandArgs(line, priceStorageSchema);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.some((e) => e.includes("Unexpected token"))).toBe(true);
    });
  });

  describe("upload schema", () => {
    it("parses mixed quote / long / alias forms", () => {
      const line = `quote:q1 --wallet-address ${WALLET} object:${OID} hash:${HASH} --name 20mb.txt`;
      const r = parseCommandArgs(line, uploadSchema);
      expect(r.ok).toBe(true);
    });
  });

  describe("backup flags schema", () => {
    it("parses name and orchestrator (async pairing is enforced in parseCloudArgs, not here)", () => {
      const r = parseCommandArgs("name:file.txt --orchestrator inline", backupFlagsSchema);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.values.name).toBe("file.txt");
      expect(r.values.orchestrator).toBe("inline");
      expect(r.values.async).toBeUndefined();
    });
  });

  describe("payment-settle schema", () => {
    it("parses renewal path tokens", () => {
      const r = parseCommandArgs(
        `--renewal --object-key mykey --wallet-address ${WALLET}`,
        paymentSettleSchema,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.values.renewal).toBe("true");
      expect(r.values["object-key"]).toBe("mykey");
    });
  });

  describe("download schema", () => {
    it("parses --location with a path", () => {
      const r = parseCommandArgs(
        `--wallet-address ${WALLET} --object-key k --location /tmp/out.bin`,
        downloadSchema,
      );
      expect(r.ok).toBe(true);
    });
  });

  describe("op-status schema", () => {
    it("parses operation-id:key:value style key", () => {
      const r = parseCommandArgs("operation-id:abc-123 --cancel", opStatusSchema);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.values["operation-id"]).toBe("abc-123");
      expect(r.values.cancel).toBe("true");
    });
  });

  describe("generic schemas", () => {
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
});
