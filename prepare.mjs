/**
 * npm lifecycle: run sync + husky only in a dev git checkout.
 * Published tarballs omit `scripts/` and `.git`, so this is a no-op for consumers.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const syncScript = join(root, "scripts", "sync-plugin-version.js");

if (existsSync(syncScript)) {
  const syncResult = spawnSync(process.execPath, [syncScript], {
    cwd: root,
    stdio: "inherit",
  });
  if (syncResult.status !== 0 && syncResult.status !== null) {
    process.exit(syncResult.status);
  }
}

if (existsSync(join(root, ".git"))) {
  spawnSync("npx", ["husky"], { cwd: root, stdio: "inherit", shell: true });
}
