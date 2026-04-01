#!/usr/bin/env bash
# Optional: install jq on Ubuntu. Idempotent: if jq already works, exit 0.
# See development_tools_requirements_doc.md §2.7 — jq is optional.
set -e

if command -v jq >/dev/null 2>&1; then
  jq --version >/dev/null 2>&1 && { echo "jq already installed: $(jq --version)"; exit 0; }
fi

sudo apt-get update -qq
sudo apt-get install -y jq
echo "jq installed: $(jq --version)"
exit 0
