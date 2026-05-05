#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Kill stale listeners that make dev URLs unpredictable.
for port in 3000 3001 8080 9090 9091; do
  pids="$(lsof -ti tcp:"$port" || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping stale process(es) on port $port: $pids"
    kill $pids || true
  fi
done

rm -rf .d2/shell

if [[ ! -d "ollama-proxy/node_modules" ]]; then
  echo "Installing proxy dependencies..."
  npm --prefix ollama-proxy install
fi

echo "Starting local proxy on port 3000 (+ DHIS2 auth proxy on 9091)..."
(
  cd ollama-proxy
  PORT=3000 DHIS2_SERVER_URL="$DHIS2_DEV_PROXY" DHIS2_PROXY_PORT=9091 npm start > /tmp/dhis2-ai-proxy.log 2>&1
) &

DHIS2_DEV_PROXY="${DHIS2_DEV_PROXY:-https://play.im.dhis2.org/dev}"
AZURE_PROXY_BASE_URL="${REACT_APP_AZURE_PROXY_BASE_URL:-}"

if [[ -z "$AZURE_PROXY_BASE_URL" && -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  AZURE_PROXY_BASE_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

echo "Starting app with fixed host and predictable ports..."
echo "Dev proxy target: $DHIS2_DEV_PROXY (override with DHIS2_DEV_PROXY env var)"
if [[ -n "$AZURE_PROXY_BASE_URL" ]]; then
  echo "Azure proxy base URL: $AZURE_PROXY_BASE_URL"
fi
echo "Note: Select your actual DHIS2 server in the login screen after app loads."
echo "Using same-origin DHIS2 base URL '.' to avoid browser CORS/malformed host in Codespaces."
# App on port 8080 (user-facing), DHIS2 proxy on port 9090 (internal),
# Vite forwards /api/* to 9090 via DHIS2_LOCAL_PROXY_TARGET.
DHIS2_LOCAL_PROXY_TARGET=http://127.0.0.1:9091 \
  DHIS2_DEV_PROXY_TARGET="$DHIS2_DEV_PROXY" \
  REACT_APP_AZURE_PROXY_BASE_URL="$AZURE_PROXY_BASE_URL" \
  exec npx d2-app-scripts start --proxy "$DHIS2_DEV_PROXY" --proxyPort 9090 --host 0.0.0.0 --port 8080 --force
