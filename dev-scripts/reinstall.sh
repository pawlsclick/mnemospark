#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "mnemospark reinstall"
echo ""

# 1. Remove mnemospark plugin files only
echo "→ Removing plugin files..."
rm -rf ~/.openclaw/extensions/mnemospark

# 2. Clean only mnemospark config entries (do not touch blockrun/openclaw)
echo "→ Cleaning config entries (mnemospark only)..."
node -e "
const f = require('os').homedir() + '/.openclaw/openclaw.json';
const fs = require('fs');
if (!fs.existsSync(f)) {
  console.log('  No openclaw.json found, skipping');
  process.exit(0);
}

let c;
try {
  c = JSON.parse(fs.readFileSync(f, 'utf8'));
} catch (err) {
  const backupPath = f + '.corrupt.' + Date.now();
  console.error('  ERROR: Invalid JSON in openclaw.json');
  console.error('  ' + err.message);
  try {
    fs.copyFileSync(f, backupPath);
    console.log('  Backed up to: ' + backupPath);
  } catch {}
  console.log('  Skipping config cleanup...');
  process.exit(0);
}

if (c.plugins?.entries?.mnemospark) delete c.plugins.entries.mnemospark;
if (c.plugins?.installs?.mnemospark) delete c.plugins.installs.mnemospark;
if (Array.isArray(c.plugins?.allow)) {
  c.plugins.allow = c.plugins.allow.filter(p => p !== 'mnemospark');
}
fs.writeFileSync(f, JSON.stringify(c, null, 2));
console.log('  Config cleaned');
"

# 3. Kill mnemospark proxy (port 7120)
echo "→ Stopping old proxy..."
lsof -ti :7120 | xargs kill -9 2>/dev/null || true

# 4. Remove stale models cache so it gets regenerated
echo "→ Cleaning models cache..."
rm -f ~/.openclaw/agents/main/agent/models.json 2>/dev/null || true

# 5. Install mnemospark plugin
echo "→ Installing mnemospark..."
openclaw plugins install mnemospark

# 6. Verify installation
echo "→ Verifying installation..."
DIST_PATH="$HOME/.openclaw/extensions/mnemospark/dist/index.js"
if [ ! -f "$DIST_PATH" ]; then
  echo "  ⚠️  dist/ files missing, clearing npm cache and retrying..."
  npm cache clean --force 2>/dev/null || true
  rm -rf ~/.openclaw/extensions/mnemospark
  openclaw plugins install mnemospark

  if [ ! -f "$DIST_PATH" ]; then
    echo "  ❌ Installation failed - dist/index.js still missing"
    exit 1
  fi
fi
echo "  ✓ dist/index.js verified"

# 7. Ensure mnemospark is in plugins.allow
echo "→ Adding to plugins allow list..."
node -e "
const os = require('os');
const fs = require('fs');
const path = require('path');
const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.plugins) config.plugins = {};
    if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
    if (!config.plugins.allow.includes('mnemospark')) {
      config.plugins.allow.push('mnemospark');
      console.log('  Added mnemospark to plugins.allow');
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.log('  Could not update config:', e.message);
  }
}
"

echo ""
echo "✓ Done. Run: openclaw gateway restart"
echo ""
echo "To uninstall: from repo run ./dev-scripts/uninstall.sh (installed copy may omit this file)"
