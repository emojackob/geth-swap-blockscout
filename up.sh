#!/usr/bin/env bash
# One command: copy .env if needed, then build and start the lab.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Engine and the compose plugin, then run ./up.sh again."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

python3 - <<'PY'
from pathlib import Path
import secrets
path = Path(".env")
text = path.read_text()
text = text.replace("generate-session-secret", secrets.token_hex(32))
text = text.replace("generate-secret-key-base", secrets.token_hex(64))
path.write_text(text)
PY

docker compose up -d --build "$@"
echo
echo "BSC Lab is starting."
echo "  RPC        http://localhost:${RPC_PORT:-8545}   chain id ${CHAIN_ID:-56056}"
echo "  WebSocket  ws://localhost:${WS_PORT:-8546}"
echo "  Blockscout http://localhost:${BLOCKSCOUT_PORT:-4000}"
echo "  Admin      http://localhost:${ADMIN_PORT:-8080}"
echo "  Faucet     http://localhost:${ADMIN_PORT:-8080}/faucet"
echo
echo "Deployed addresses land in the lab-data volume at /data/deployments.json"
echo "and on GET http://localhost:${ADMIN_PORT:-8080}/api/deployments"
echo "Stop with ./down.sh"
