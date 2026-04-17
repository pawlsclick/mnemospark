import type { CommandArgSchema } from "./args/types.js";

export const priceStorageSchema: CommandArgSchema = {
  args: [
    { name: "wallet-address", aliases: ["wallet"], required: true },
    { name: "object-id", aliases: ["object"], required: true },
    // Optional: omit when the object exists in local SQLite after backup; CLI resolves sha256 from state.db.
    { name: "object-id-hash", aliases: ["hash"] },
    { name: "gb", required: true },
    { name: "provider", required: true },
    { name: "region", required: true },
  ],
};

export const uploadSchema: CommandArgSchema = {
  args: [
    { name: "quote-id", aliases: ["quote"], required: true },
    { name: "wallet-address", aliases: ["wallet"], required: true },
    { name: "object-id", aliases: ["object"], required: true },
    { name: "object-id-hash", aliases: ["hash"], required: true },
    { name: "name" },
    { name: "async", bareBoolean: true },
    { name: "orchestrator" },
    { name: "timeout-seconds" },
  ],
};

export const backupFlagsSchema: CommandArgSchema = {
  args: [
    { name: "name" },
    { name: "async", bareBoolean: true },
    { name: "orchestrator" },
    { name: "timeout-seconds" },
  ],
};

export const paymentSettleSchema: CommandArgSchema = {
  args: [
    { name: "quote-id", aliases: ["quote"] },
    { name: "wallet-address", aliases: ["wallet"], required: true },
    { name: "object-id", aliases: ["object"] },
    { name: "object-key" },
    { name: "storage-price" },
    { name: "renewal", bareBoolean: true },
  ],
};

export const lsSchema: CommandArgSchema = {
  args: [
    { name: "wallet-address", aliases: ["wallet"], required: true },
    { name: "object-key" },
    { name: "name" },
    { name: "latest", bareBoolean: true },
    { name: "at" },
    { name: "location" },
    { name: "region" },
  ],
};

export const lsWebSchema: CommandArgSchema = {
  args: [
    { name: "wallet-address", aliases: ["wallet"], required: true },
    { name: "location" },
    { name: "region" },
  ],
};

export const downloadSchema: CommandArgSchema = {
  args: [
    { name: "wallet-address", aliases: ["wallet"], required: true },
    { name: "object-key" },
    { name: "name" },
    { name: "latest", bareBoolean: true },
    { name: "at" },
    { name: "location" },
    { name: "region" },
    { name: "async", bareBoolean: true },
    { name: "orchestrator" },
    { name: "timeout-seconds" },
  ],
};

export const deleteSchema: CommandArgSchema = {
  args: [
    { name: "wallet-address", aliases: ["wallet"], required: true },
    { name: "object-key" },
    { name: "name" },
    { name: "latest", bareBoolean: true },
    { name: "at" },
    { name: "location" },
    { name: "region" },
  ],
};

export const opStatusSchema: CommandArgSchema = {
  args: [
    { name: "operation-id", required: true },
    { name: "cancel", bareBoolean: true },
  ],
};
