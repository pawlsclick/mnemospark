#!/usr/bin/env bash
# Seed mnemospark-backend with examples and .company docs required by backend feature specs (01-10, 15-17).
# Usage: from mnemospark repo root: ./scripts/seed-mnemospark-backend.sh /path/to/mnemospark-backend
# Idempotent: safe to run again; overwrites existing files.

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 /path/to/mnemospark-backend" >&2
  exit 1
fi

DEST="$1"
# Resolve repo root: script lives in mnemospark/scripts/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$ROOT/.company" ] || [ ! -d "$ROOT/examples" ]; then
  echo "Error: must run from mnemospark repo (missing .company or examples). Root: $ROOT" >&2
  exit 1
fi

mkdir -p "$DEST"
echo "Seeding mnemospark-backend at $DEST from $ROOT"

# --- Examples (exclude .aws-sam build output) ---
copy_example_dir() {
  local src="$1"
  local name="$2"
  shift 2
  local files=("$@")
  mkdir -p "$DEST/examples/$name"
  for f in "${files[@]}"; do
    if [ -f "$ROOT/$src/$f" ]; then
      cp "$ROOT/$src/$f" "$DEST/examples/$name/"
    fi
  done
}

copy_example_dir "examples/s3-cost-estimate-api" "s3-cost-estimate-api" \
  app.py template.yaml requirements.txt README.md samconfig.toml

copy_example_dir "examples/data-transfer-cost-estimate-api" "data-transfer-cost-estimate-api" \
  app.py template.yaml requirements.txt README.md samconfig.toml

mkdir -p "$DEST/examples"
if [ -f "$ROOT/examples/object_storage_management_aws.py" ]; then
  cp "$ROOT/examples/object_storage_management_aws.py" "$DEST/examples/"
fi

copy_example_dir "examples/object-storage-management-api" "object-storage-management-api" \
  app.py template.yaml requirements.txt storage_core.py README.md

# --- .company ---
mkdir -p "$DEST/.company"
mkdir -p "$DEST/.company/infrastructure_design"
mkdir -p "$DEST/.company/features_cursor_dev"

for f in \
  mnemospark_backend_api_spec.md \
  mnemospark_full_workflow.md \
  mnemospark_PRD.md \
  clawrouter_wallet_gen_payment_eip712.md \
; do
  if [ -f "$ROOT/.company/$f" ]; then
    cp "$ROOT/.company/$f" "$DEST/.company/"
  fi
done

if [ -f "$ROOT/.company/infrastructure_design/internet_facing_API.md" ]; then
  cp "$ROOT/.company/infrastructure_design/internet_facing_API.md" "$DEST/.company/infrastructure_design/"
fi

for f in \
  AWS_DOCS_REFERENCES.md \
  README.md \
  cursor-dev-01-lambda-estimate-storage.md \
  cursor-dev-02-lambda-estimate-transfer.md \
  cursor-dev-03-lambda-price-storage.md \
  cursor-dev-04-lambda-storage-upload.md \
  cursor-dev-05-lambda-storage-ls.md \
  cursor-dev-06-lambda-storage-download.md \
  cursor-dev-07-lambda-storage-delete.md \
  cursor-dev-08-api-gateway-auth.md \
  cursor-dev-09-dynamodb-tables.md \
  cursor-dev-10-housekeeping-32day.md \
  cursor-dev-15-cfn-waf.md \
  cursor-dev-16-cfn-observability.md \
  cursor-dev-17-cfn-cloudfront.md \
; do
  if [ -f "$ROOT/.company/features_cursor_dev/$f" ]; then
    cp "$ROOT/.company/features_cursor_dev/$f" "$DEST/.company/features_cursor_dev/"
  fi
done

echo "Done. Backend repo seeded at $DEST"
