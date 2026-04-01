#!/usr/bin/env bash
# Verify required development tools for mnemospark. Exit 0 only if all checks pass.
# Run from repo root. AWS credentials and gh auth must be configured for full pass.
# Optional: set SKIP_PNPM_BUILD=1 to skip pnpm install/build/test (e.g. when no AWS creds).
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "  FAIL: $1" >&2; exit 1; }

echo "Checking aws..."
command -v aws >/dev/null 2>&1 || fail "aws not found. Run dev-scripts/install-aws-cli.sh"
aws --version >/dev/null 2>&1 || fail "aws --version failed"
echo "  ok"

echo "Checking aws sts get-caller-identity..."
aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials not configured (aws sts get-caller-identity failed). Use IAM role or aws configure."
echo "  ok"

echo "Checking node..."
command -v node >/dev/null 2>&1 || fail "node not found. Install Node.js v20+."
node -v >/dev/null 2>&1 || fail "node -v failed"
echo "  ok"

echo "Checking pnpm..."
command -v pnpm >/dev/null 2>&1 || fail "pnpm not found. Run dev-scripts/install-pnpm.sh"
pnpm -v >/dev/null 2>&1 || fail "pnpm -v failed"
echo "  ok"

echo "Checking git..."
command -v git >/dev/null 2>&1 || fail "git not found"
git --version >/dev/null 2>&1 || fail "git --version failed"
echo "  ok"

echo "Checking gh auth status..."
command -v gh >/dev/null 2>&1 || fail "gh (GitHub CLI) not found"
# Use --json so exit code is 0 when logged in (avoids exit 1 from "plain text" warning)
gh auth status --json hosts >/dev/null 2>&1 || fail "gh auth status failed. Run gh auth login."
echo "  ok"

if [[ "${SKIP_PNPM_BUILD}" == "1" ]]; then
  echo "Skipping pnpm install/build/test (SKIP_PNPM_BUILD=1)"
else
  echo "Running pnpm install..."
  pnpm install || fail "pnpm install failed"
  echo "  ok"
  echo "Running pnpm build..."
  pnpm build || fail "pnpm build failed"
  echo "  ok"
  echo "Running pnpm test..."
  pnpm test || fail "pnpm test failed"
  echo "  ok"
fi

echo "All required dev tools verified."
