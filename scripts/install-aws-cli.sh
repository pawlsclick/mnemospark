#!/usr/bin/env bash
# Install AWS CLI v2 on Ubuntu (x86_64). Idempotent: if aws --version already shows v2.x, exit 0.
# Credentials are out of scope (IAM role or aws configure per environment).
set -e

AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
TMP_DIR="${TMPDIR:-/tmp}/awscliv2-$$"

if command -v aws >/dev/null 2>&1; then
  ver=$(aws --version 2>&1 || true)
  if [[ "$ver" =~ aws-cli/2\. ]]; then
    echo "AWS CLI v2 already installed: $ver"
    exit 0
  fi
fi

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT
mkdir -p "$TMP_DIR"
cd "$TMP_DIR"

echo "Downloading AWS CLI v2..."
curl -sSfL "$AWS_URL" -o awscliv2.zip
unzip -q awscliv2.zip
sudo ./aws/install -i /usr/local/aws-cli -b /usr/local/bin

echo "AWS CLI v2 installed: $(aws --version)"
exit 0
