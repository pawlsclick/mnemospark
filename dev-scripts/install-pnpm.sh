#!/usr/bin/env bash
# Install and enable pnpm on Ubuntu dev instance via Node corepack.
# Idempotent: if pnpm already works, exit 0.
# Prerequisite: Node.js v20+ (engines in package.json).
set -e

if command -v pnpm >/dev/null 2>&1; then
  pnpm -v >/dev/null 2>&1 && { echo "pnpm already installed: $(pnpm -v)"; exit 0; }
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required. Install Node.js v20+ first." >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@latest --activate

echo "pnpm installed: $(pnpm -v)"
exit 0
