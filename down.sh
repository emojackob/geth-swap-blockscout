#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose down "$@"
echo "Stack stopped. Volumes are kept. ./down.sh -v also deletes chain data, the explorer database, and deployments."
