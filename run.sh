#!/usr/bin/env bash
# Run the Starsim Go backend (and its local MongoDB).
# Usage: ./run.sh
set -euo pipefail

# --- toolchain (user-local installs) ---
export PATH="$HOME/.local/go/bin:$PATH"
export GOPATH="${GOPATH:-$HOME/go}"

MONGO_BIN="$HOME/.local/mongodb-bin/mongod"
MONGO_DATA="$HOME/.local/mongodata"
MONGO_LOG="$HOME/.local/mongolog/mongod.log"

# --- start MongoDB if it isn't already running ---
if pgrep -f "mongod --dbpath $MONGO_DATA" >/dev/null 2>&1; then
  echo "[run] MongoDB already running on 127.0.0.1:27017"
else
  echo "[run] starting MongoDB..."
  mkdir -p "$MONGO_DATA" "$(dirname "$MONGO_LOG")"
  "$MONGO_BIN" --dbpath "$MONGO_DATA" --port 27017 --bind_ip 127.0.0.1 \
    --logpath "$MONGO_LOG" --fork
fi

# --- run the app (foreground; Ctrl+C to stop) ---
cd "$(dirname "$0")"
echo "[run] starting Starsim on http://localhost:5000 (Ctrl+C to stop)"
exec go run .
