#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
One-step mnemospark operation debugger

Usage:
  debug-operation.sh [operation-id] [--home <home-dir>] [--tail <lines>]

Examples:
  ./skills/mnemospark/scripts/debug-operation.sh 1f7b2f0d-....
  ./skills/mnemospark/scripts/debug-operation.sh --tail 300

Behavior:
  - If operation-id is omitted, the latest operation in SQLite is used.
  - Correlates operation context across:
      state.db (operations/objects/payments)
      events.jsonl
      proxy-events.jsonl
      manifest.jsonl
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 2
  fi
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

HOME_DIR="${HOME}"
TAIL_LINES="200"
OPERATION_ID=""

while (($#)); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --home)
      HOME_DIR="${2:-}"
      shift 2
      ;;
    --tail)
      TAIL_LINES="${2:-}"
      shift 2
      ;;
    --*)
      echo "Unknown flag: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -z "${OPERATION_ID}" ]]; then
        OPERATION_ID="$1"
      else
        echo "Unexpected extra argument: $1" >&2
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

if ! [[ "${TAIL_LINES}" =~ ^[0-9]+$ ]]; then
  echo "--tail must be a positive integer" >&2
  exit 1
fi

require_cmd sqlite3
require_cmd jq
require_cmd tail

STATE_DIR="${HOME_DIR}/.openclaw/mnemospark"
DB_PATH="${STATE_DIR}/state.db"
EVENTS_PATH="${STATE_DIR}/events.jsonl"
PROXY_PATH="${STATE_DIR}/proxy-events.jsonl"
MANIFEST_PATH="${STATE_DIR}/manifest.jsonl"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "SQLite state not found: ${DB_PATH}" >&2
  exit 1
fi

if [[ -z "${OPERATION_ID}" ]]; then
  OPERATION_ID="$(sqlite3 "${DB_PATH}" "SELECT operation_id FROM operations ORDER BY updated_at DESC LIMIT 1;")"
  if [[ -z "${OPERATION_ID}" ]]; then
    echo "No operations found in ${DB_PATH}" >&2
    exit 1
  fi
fi

ESCAPED_OP_ID="$(sql_escape "${OPERATION_ID}")"
OP_JSON="$(sqlite3 -json "${DB_PATH}" "SELECT operation_id,type,status,error_code,error_message,started_at,finished_at,updated_at,object_id,quote_id FROM operations WHERE operation_id='${ESCAPED_OP_ID}' LIMIT 1;")"

if [[ "${OP_JSON}" == "[]" ]]; then
  echo "Operation not found in SQLite: ${OPERATION_ID}" >&2
  exit 1
fi

OBJECT_ID="$(printf "%s" "${OP_JSON}" | jq -r '.[0].object_id // empty')"
QUOTE_ID="$(printf "%s" "${OP_JSON}" | jq -r '.[0].quote_id // empty')"

OBJECT_JSON="[]"
OBJECT_KEY=""
WALLET_ADDRESS=""
if [[ -n "${OBJECT_ID}" ]]; then
  ESCAPED_OBJECT_ID="$(sql_escape "${OBJECT_ID}")"
  OBJECT_JSON="$(sqlite3 -json "${DB_PATH}" "SELECT object_id,object_key,wallet_address,quote_id,status,updated_at FROM objects WHERE object_id='${ESCAPED_OBJECT_ID}' ORDER BY updated_at DESC LIMIT 1;")"
  OBJECT_KEY="$(printf "%s" "${OBJECT_JSON}" | jq -r '.[0].object_key // empty')"
  WALLET_ADDRESS="$(printf "%s" "${OBJECT_JSON}" | jq -r '.[0].wallet_address // empty')"
  if [[ -z "${QUOTE_ID}" ]]; then
    QUOTE_ID="$(printf "%s" "${OBJECT_JSON}" | jq -r '.[0].quote_id // empty')"
  fi
fi

PAYMENT_JSON="[]"
if [[ -n "${QUOTE_ID}" ]]; then
  ESCAPED_QUOTE_ID="$(sql_escape "${QUOTE_ID}")"
  PAYMENT_JSON="$(sqlite3 -json "${DB_PATH}" "SELECT quote_id,wallet_address,trans_id,amount,status,settled_at,updated_at FROM payments WHERE quote_id='${ESCAPED_QUOTE_ID}' LIMIT 1;")"
fi

echo "=== mnemospark one-step operation debug ==="
echo "home: ${HOME_DIR}"
echo "state: ${STATE_DIR}"
echo "operation-id: ${OPERATION_ID}"
echo

echo "---- operations row ----"
printf "%s\n" "${OP_JSON}" | jq .
echo

if [[ "${OBJECT_JSON}" != "[]" ]]; then
  echo "---- related object row ----"
  printf "%s\n" "${OBJECT_JSON}" | jq .
  echo
fi

if [[ "${PAYMENT_JSON}" != "[]" ]]; then
  echo "---- related payment row ----"
  printf "%s\n" "${PAYMENT_JSON}" | jq .
  echo
fi

print_stream_matches() {
  local file_path="$1"
  if [[ ! -f "${file_path}" ]]; then
    return
  fi
  local file_name
  file_name="$(basename "${file_path}")"
  echo "---- ${file_name} matches (tail ${TAIL_LINES}) ----"
  tail -n "${TAIL_LINES}" "${file_path}" | jq -cR \
    --arg op "${OPERATION_ID}" \
    --arg quote "${QUOTE_ID}" \
    --arg object "${OBJECT_ID}" \
    --arg key "${OBJECT_KEY}" \
    --arg wallet "${WALLET_ADDRESS}" '
      fromjson? as $j
      | select($j != null)
      | select(
          (($j.operation_id // "") == $op)
          or ($quote != "" and ($j.quote_id // "") == $quote)
          or ($object != "" and ($j.object_id // "") == $object)
          or ($key != "" and ($j.object_key // "") == $key)
          or ($wallet != "" and ($j.wallet_address // "") == $wallet)
        )
      | $j
    '
  echo
}

print_stream_matches "${EVENTS_PATH}"
print_stream_matches "${PROXY_PATH}"
print_stream_matches "${MANIFEST_PATH}"

echo "Done."
