#!/bin/bash
# Single-validator Parlia node for the local lab.
# The validator key is the public BSC dev key from bsc-genesis-contract
# (init_holders.js: "only use in dev"). It is not a secret.
set -euo pipefail

GETH="${GETH_BIN:-/usr/local/bin/geth}"
DATADIR="${DATADIR:-/data}"
GENESIS="${GENESIS:-/lab/genesis.json}"
PASSWORD="${PASSWORD_FILE:-/lab/password.txt}"
KEYFILE="${VALIDATOR_KEY_FILE:-/lab/validator.key}"
VALIDATOR="${VALIDATOR_ADDRESS:-0x9fB29AAc15b9A4B7F17c3385939b007540f4d791}"
CHAIN_ID="${CHAIN_ID:-56056}"
CACHE="${GETH_CACHE:-512}"
LOG="${GETH_LOG:-/logs/geth.log}"

mkdir -p "$DATADIR" "$(dirname "$LOG")"
touch "$LOG"

if [ ! -d "$DATADIR/geth/chaindata" ]; then
  echo "initialising genesis"
  "$GETH" --datadir "$DATADIR" init "$GENESIS"
fi

if ! "$GETH" account list --datadir "$DATADIR" | grep -qi "${VALIDATOR#0x}"; then
  echo "importing validator key"
  "$GETH" account import --datadir "$DATADIR" --password "$PASSWORD" "$KEYFILE"
fi

# 0.0.0.0 is rewritten to an IPv6-only [::] socket, which other containers
# cannot dial. Bind this container's IPv4 address. Callers inside compose
# use the published host port (host.docker.internal), not the service DNS name.
BIND_IP="$(hostname -i 2>/dev/null | awk '{print $1}')"
if [ -z "${BIND_IP}" ]; then
  BIND_IP=0.0.0.0
fi
exec "$GETH" \
  --datadir "$DATADIR" \
  --networkid "$CHAIN_ID" \
  --port 30303 \
  --http --http.addr "$BIND_IP" --http.port 8545 \
  --http.api eth,net,web3,txpool,debug \
  --http.vhosts '*' --http.corsdomain '*' \
  --ws --ws.addr "$BIND_IP" --ws.port 8546 \
  --ws.api eth,net,web3 --ws.origins '*' \
  --nodiscover --maxpeers 0 \
  --mine \
  --miner.etherbase "$VALIDATOR" \
  --unlock "$VALIDATOR" \
  --password "$PASSWORD" \
  --allow-insecure-unlock \
  --rpc.allow-unprotected-txs \
  --gcmode archive \
  --syncmode full \
  --cache "$CACHE" \
  --miner.gasprice 1000000000 \
  --history.transactions 0 \
  --verbosity 3 \
  2>&1 | tee -a "$LOG"
