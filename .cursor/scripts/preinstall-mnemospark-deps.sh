#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOCKFILE_PATH="${REPO_ROOT}/package-lock.json"
CACHE_DIR="${REPO_ROOT}/.cursor/.cache"
LOCK_HASH_FILE="${CACHE_DIR}/npm-package-lock.sha256"

if [[ ! -f "${LOCKFILE_PATH}" ]]; then
  echo "[cloud-agent] package-lock.json not found; skipping npm preinstall."
  exit 0
fi

mkdir -p "${CACHE_DIR}"

CURRENT_LOCK_HASH="$(sha256sum "${LOCKFILE_PATH}" | awk '{print $1}')"
PREVIOUS_LOCK_HASH=""
if [[ -f "${LOCK_HASH_FILE}" ]]; then
  PREVIOUS_LOCK_HASH="$(<"${LOCK_HASH_FILE}")"
fi

if [[ -d "${REPO_ROOT}/node_modules" && "${CURRENT_LOCK_HASH}" == "${PREVIOUS_LOCK_HASH}" ]]; then
  echo "[cloud-agent] npm dependencies already match package-lock.json; skipping install."
  exit 0
fi

echo "[cloud-agent] Installing mnemospark dependencies from package-lock.json (npm ci)..."
cd "${REPO_ROOT}"
npm ci --no-audit --no-fund
printf "%s\n" "${CURRENT_LOCK_HASH}" > "${LOCK_HASH_FILE}"
echo "[cloud-agent] npm dependency preinstall complete."
