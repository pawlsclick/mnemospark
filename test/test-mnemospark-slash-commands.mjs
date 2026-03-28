/**
 * Validate mnemospark slash command registration and handler behaviour.
 *
 * This script loads the compiled plugin entry point (dist/index.js),
 * simulates the OpenClaw plugin API, and verifies that every expected
 * slash command is registered, has the correct shape, and returns
 * sensible responses for representative inputs.
 *
 * Run after building:
 *   npm run build && node test/test-mnemospark-slash-commands.mjs
 *
 * Exit code 0 = all checks pass, non-zero = at least one failure.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "..", "dist", "index.js");
const distUrl = pathToFileURL(distPath).href;

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

let failures = 0;
let passes = 0;

function pass(msg) {
  passes++;
  console.log(`${GREEN}[PASS]${NC} ${msg}`);
}

function fail(msg) {
  failures++;
  console.error(`${RED}[FAIL]${NC} ${msg}`);
}

function info(msg) {
  console.log(`${YELLOW}[INFO]${NC} ${msg}`);
}

function makeContext(args) {
  return {
    senderId: "test-user",
    channel: "test-channel",
    isAuthorizedSender: true,
    args,
    commandBody: args ?? "",
    config: {},
  };
}

// ---------------------------------------------------------------------------
// 1. Load the plugin
// ---------------------------------------------------------------------------
info("Loading plugin from " + distPath);
const mod = await import(distUrl);
const plugin = mod.default;

if (!plugin || typeof plugin.register !== "function") {
  fail("Plugin default export missing or has no register() function");
  process.exit(1);
}
pass("Plugin default export has register()");

// ---------------------------------------------------------------------------
// 2. Simulate OpenClaw plugin API and call register()
// ---------------------------------------------------------------------------
const registeredCommands = [];
const registeredServices = [];

const mockApi = {
  id: "mnemospark",
  name: "mnemospark",
  version: "test",
  description: "test",
  source: "test",
  config: {},
  pluginConfig: {},
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  registerProvider: () => {},
  registerTool: () => {},
  registerHook: () => {},
  registerHttpRoute: () => {},
  registerService: (svc) => registeredServices.push(svc),
  registerCommand: (cmd) => registeredCommands.push(cmd),
  resolvePath: (p) => p,
  on: () => {},
};

info("Calling plugin.register(mockApi)");
await plugin.register(mockApi);

// ---------------------------------------------------------------------------
// 3. Verify command registrations
// ---------------------------------------------------------------------------
info("=== Command Registration ===");

const commandsByName = Object.fromEntries(registeredCommands.map((c) => [c.name, c]));
const mnemosparkCmd = commandsByName["mnemospark"];

if (!mnemosparkCmd) {
  fail("/mnemospark — not registered");
} else {
  pass("/mnemospark — registered");
}

if (registeredCommands.length !== 1) {
  fail(`Expected exactly one registered command, got ${registeredCommands.length}`);
} else {
  pass("Exactly one slash command registered");
}

if (mnemosparkCmd) {
  if (typeof mnemosparkCmd.handler !== "function") {
    fail("/mnemospark — handler is not a function");
  } else {
    pass("/mnemospark — handler is a function");
  }

  if (mnemosparkCmd.acceptsArgs !== true) {
    fail("/mnemospark — acceptsArgs should be true");
  } else {
    pass("/mnemospark — acceptsArgs is true");
  }

  const desc = (mnemosparkCmd.description || "").toLowerCase();
  if (!desc.includes("wallet") || !desc.includes("cloud")) {
    fail("/mnemospark — description should mention wallet and cloud");
  } else {
    pass("/mnemospark — description mentions wallet and cloud");
  }
}

// ---------------------------------------------------------------------------
// 4. Verify mnemospark-proxy service is registered
// ---------------------------------------------------------------------------
info("=== Service Registration ===");

const proxyService = registeredServices.find((s) => s.id === "mnemospark-proxy");
if (!proxyService) {
  fail("mnemospark-proxy service not registered");
} else {
  pass("mnemospark-proxy service registered");
  if (typeof proxyService.stop !== "function") {
    fail("mnemospark-proxy service missing stop()");
  } else {
    pass("mnemospark-proxy service has stop()");
  }
}

// ---------------------------------------------------------------------------
// 5. Exercise unified /mnemospark handler — root + cloud
// ---------------------------------------------------------------------------
info("=== /mnemospark handler tests ===");

if (mnemosparkCmd) {
  // 5a. root help (empty args)
  {
    const result = await mnemosparkCmd.handler(makeContext(""));
    if (!result.text || !result.text.includes("mnemospark")) {
      fail("/mnemospark (no args) — did not return root help text");
    } else {
      pass("/mnemospark (no args) — returns root help text");
    }
    if (result.isError) {
      fail("/mnemospark (no args) — isError should be falsy");
    } else {
      pass("/mnemospark (no args) — isError is falsy");
    }
  }

  // 5b. cloud help
  {
    const result = await mnemosparkCmd.handler(makeContext("cloud help"));
    if (!result.text || !result.text.includes("Cloud Commands")) {
      fail("/mnemospark cloud help — did not return cloud help text");
    } else {
      pass("/mnemospark cloud help — returns cloud help text");
    }
  }

  // 5c. Verify cloud help lists subcommands
  {
    const result = await mnemosparkCmd.handler(makeContext("cloud"));
    const helpText = result.text || "";
    const subcommands = ["backup", "price-storage", "upload", "ls", "download", "delete"];
    for (const sub of subcommands) {
      if (helpText.includes(sub)) {
        pass(`/mnemospark cloud — lists "${sub}"`);
      } else {
        fail(`/mnemospark cloud — missing "${sub}"`);
      }
    }
  }

  // Ensure a local wallet exists before backup (resolveWalletKey in cloud backup path).
  {
    await mnemosparkCmd.handler(makeContext("wallet help"));
    pass("/mnemospark wallet help — bootstrap wallet for backup test");
  }

  // 5d. cloud backup with a real temp file
  {
    const tmpFile = join(tmpdir(), `mnemospark-slash-test-${Date.now()}.txt`);
    writeFileSync(tmpFile, "slash command test content");
    const result = await mnemosparkCmd.handler(
      makeContext(`cloud backup ${tmpFile} --name slash-integration-test`),
    );
    if (result.isError) {
      fail("/mnemospark cloud backup <file> — returned isError");
    } else if (!result.text || !result.text.includes("object-id")) {
      fail("/mnemospark cloud backup <file> — response missing object-id");
    } else {
      pass("/mnemospark cloud backup <file> — succeeds and returns object-id");
    }
  }

  // 5e. cloud price-storage with missing args
  {
    const result = await mnemosparkCmd.handler(makeContext("cloud price-storage"));
    if (!result.isError) {
      fail("/mnemospark cloud price-storage (no args) — should be an error");
    } else {
      pass("/mnemospark cloud price-storage (no args) — returns validation error");
    }
  }

  // 5f. cloud upload with missing args
  {
    const result = await mnemosparkCmd.handler(makeContext("cloud upload"));
    if (!result.isError) {
      fail("/mnemospark cloud upload (no args) — should be an error");
    } else {
      pass("/mnemospark cloud upload (no args) — returns validation error");
    }
  }

  // 5g. cloud ls with missing args
  {
    const result = await mnemosparkCmd.handler(makeContext("cloud ls"));
    if (!result.isError) {
      fail("/mnemospark cloud ls (no args) — should be an error");
    } else {
      pass("/mnemospark cloud ls (no args) — returns validation error");
    }
  }

  // 5h. cloud download with missing args
  {
    const result = await mnemosparkCmd.handler(makeContext("cloud download"));
    if (!result.isError) {
      fail("/mnemospark cloud download (no args) — should be an error");
    } else {
      pass("/mnemospark cloud download (no args) — returns validation error");
    }
  }

  // 5i. cloud delete with missing args
  {
    const result = await mnemosparkCmd.handler(makeContext("cloud delete"));
    if (!result.isError) {
      fail("/mnemospark cloud delete (no args) — should be an error");
    } else {
      pass("/mnemospark cloud delete (no args) — returns validation error");
    }
  }

  // 5j. unknown top-level token
  {
    const result = await mnemosparkCmd.handler(makeContext("nonexistent-subcommand"));
    if (!result.isError) {
      fail("/mnemospark <unknown> — should set isError");
    } else {
      pass("/mnemospark <unknown> — returns error");
    }
  }
} else {
  fail("Skipping /mnemospark handler tests — command not registered");
}

// ---------------------------------------------------------------------------
// 6. Exercise /mnemospark wallet handler
// ---------------------------------------------------------------------------
info("=== /mnemospark wallet handler tests ===");

if (mnemosparkCmd) {
  // 6a. wallet status (default)
  {
    const result = await mnemosparkCmd.handler(makeContext("wallet"));
    if (!result.text) {
      fail("/mnemospark wallet — returned no text");
    } else if (result.text.includes("No mnemospark wallet found")) {
      info("/mnemospark wallet — no wallet file present (expected in clean environments)");
      pass("/mnemospark wallet — returns a coherent response");
    } else if (result.text.includes("Wallet") || result.text.includes("wallet")) {
      pass("/mnemospark wallet — returns wallet status");
    } else {
      fail("/mnemospark wallet — unexpected response: " + result.text.slice(0, 120));
    }
  }

  // 6b. wallet export
  {
    const result = await mnemosparkCmd.handler(makeContext("wallet export"));
    if (!result.text) {
      fail("/mnemospark wallet export — returned no text");
    } else if (result.text.includes("No mnemospark wallet found")) {
      info("/mnemospark wallet export — no wallet file (expected in clean environments)");
      pass("/mnemospark wallet export — returns coherent response");
    } else if (result.text.includes("Private Key") || result.text.includes("SECURITY WARNING")) {
      pass("/mnemospark wallet export — returns private key export");
    } else {
      fail("/mnemospark wallet export — unexpected response: " + result.text.slice(0, 120));
    }
  }

  // 6c. wallet help
  {
    const result = await mnemosparkCmd.handler(makeContext("wallet help"));
    if (!result.text || !result.text.includes("mnemospark Wallet")) {
      fail("/mnemospark wallet help — did not return wallet help");
    } else {
      pass("/mnemospark wallet help — returns wallet help");
    }
  }
} else {
  fail("Skipping /mnemospark wallet handler tests — command not registered");
}

// ---------------------------------------------------------------------------
// 7. Summary
// ---------------------------------------------------------------------------
console.log("");
info("=== Summary ===");
console.log(`  ${GREEN}Passed: ${passes}${NC}`);
if (failures > 0) {
  console.log(`  ${RED}Failed: ${failures}${NC}`);
  process.exit(1);
} else {
  console.log(`  Failed: 0`);
  pass("All mnemospark slash command checks passed");
}
