#!/usr/bin/env bash
# Local checks. This script is not wired to GitHub Actions.
set -euo pipefail
cd "$(dirname "$0")"

if [ -d .github/workflows ]; then
  echo "This repository must not contain GitHub Actions workflows."
  exit 1
fi

echo "== cargo test"
cargo test -p lab-api

echo "== console typecheck and build"
(
  cd console
  if [ ! -d node_modules ]; then
    npm ci --no-audit --no-fund
  fi
  npx tsc --noEmit --pretty false
  npx vite build
)

echo "local checks passed"
