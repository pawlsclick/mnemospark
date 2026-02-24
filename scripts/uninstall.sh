#!/bin/bash
set -e

echo "mnemospark uninstall"
echo ""

# 1. Stop mnemospark proxy (port 7120)
echo "→ Stopping proxy..."
lsof -ti :7120 | xargs kill -9 2>/dev/null || true

# 2. Remove mnemospark plugin files only
echo "→ Removing plugin files..."
rm -rf ~/.openclaw/extensions/mnemospark

# 3. Clean only mnemospark entries from openclaw.json (do not touch blockrun/openclaw)
echo "→ Cleaning openclaw.json (mnemospark only)..."
node -e "
const os = require('os');
const fs = require('fs');
const path = require('path');
const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

if (!fs.existsSync(configPath)) {
  console.log('  No openclaw.json found, skipping');
  process.exit(0);
}

try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let changed = false;

  // Remove only mnemospark plugin entries
  if (config.plugins?.entries?.mnemospark) {
    delete config.plugins.entries.mnemospark;
    changed = true;
  }
  if (config.plugins?.installs?.mnemospark) {
    delete config.plugins.installs.mnemospark;
    changed = true;
  }

  // Remove only mnemospark from plugins.allow
  if (Array.isArray(config.plugins?.allow)) {
    const before = config.plugins.allow.length;
    config.plugins.allow = config.plugins.allow.filter(p => p !== 'mnemospark');
    if (config.plugins.allow.length !== before) {
      console.log('  Removed mnemospark from plugins.allow');
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('  Config cleaned');
  } else {
    console.log('  No mnemospark entries found');
  }
} catch (err) {
  console.error('  Error:', err.message);
}
"

echo ""
echo "✓ mnemospark uninstalled"
echo ""
echo "Restart OpenClaw to apply changes:"
echo "  openclaw gateway restart"
