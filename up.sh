#!/usr/bin/env bash
# One command. No env file. Defaults are in the compose file and the admin service.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine and the compose plugin, then run ./up.sh again."
  exit 1
fi

docker compose up -d --build "$@"
echo
echo "BSC Lab is starting."
echo "  RPC        http://localhost:8545   chain id 56056"
echo "  WebSocket  ws://localhost:8546"
echo "  Blockscout http://localhost:4000"
echo "  Admin      http://localhost:18080"
echo "  Faucet     http://localhost:18080/faucet"
echo
echo "Deployed addresses: GET http://localhost:18080/api/deployments"
echo "Allowlist and faucet limits: Admin, Settings."
echo "Stop with ./down.sh"
