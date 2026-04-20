#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Kill stale listeners that make dev URLs unpredictable.
for port in 3000 3001 8080; do
  pids="$(lsof -ti tcp:"$port" || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping stale process(es) on port $port: $pids"
    kill $pids || true
  fi
done

rm -rf .d2/shell

echo "Starting app with fixed host and predictable ports..."
exec npx d2-app-scripts start --proxy https://play.im.dhis2.org/dev --host 0.0.0.0 --port 3001 --force
