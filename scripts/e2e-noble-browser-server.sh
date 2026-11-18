#!/usr/bin/env bash
# Runs the Playwright browser server from the Ubuntu 24.04 (Noble) image that matches the
# lockfile pin, so screenshot goldens render with the same system fonts as Quality CI.
#
#   scripts/e2e-noble-browser-server.sh start   # prints the WebSocket endpoint
#   PW_TEST_CONNECT_WS_ENDPOINT="$(scripts/e2e-noble-browser-server.sh endpoint)" \
#     npm run test:e2e -- e2e/library-visual.spec.ts --project=chromium --project=webkit
#   scripts/e2e-noble-browser-server.sh stop
#
# The container shares the host network so its browsers reach the preview server and the
# emulators on loopback; the server itself listens on 127.0.0.1 only. The project is mounted
# read-only at the same path, and the browsers use the repository's fontconfig file.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
port="${SONFLASH_PW_SERVER_PORT:-3911}"
name="sonflash-pw-noble-${port}"
version="$(node -p "require('${root}/package-lock.json').packages['node_modules/@playwright/test'].version")"
image="mcr.microsoft.com/playwright:v${version}-noble"
endpoint="ws://127.0.0.1:${port}/"

case "${1:-}" in
  start)
    if docker ps --format '{{.Names}}' | grep -qx "$name"; then
      echo "$endpoint"
      exit 0
    fi
    docker run -d --rm --init --name "$name" --network host \
      -v "${root}:${root}:ro" -w "$root" \
      -e FONTCONFIG_FILE="${root}/e2e/fixtures/playwright-linux-fonts.conf" \
      "$image" \
      sh -c "mkdir -p /tmp/sonflash-playwright-fontconfig-cache && exec node ${root}/node_modules/@playwright/test/cli.js run-server --port ${port} --host 127.0.0.1" \
      >/dev/null
    for _ in $(seq 1 60); do
      if docker logs "$name" 2>&1 | grep -q 'Listening on'; then
        echo "$endpoint"
        exit 0
      fi
      sleep 1
    done
    docker logs "$name" >&2 || true
    docker stop "$name" >/dev/null 2>&1 || true
    echo "Playwright browser server did not start" >&2
    exit 1
    ;;
  stop)
    docker stop "$name" >/dev/null 2>&1 || true
    ;;
  endpoint)
    echo "$endpoint"
    ;;
  *)
    echo "usage: $0 start|stop|endpoint" >&2
    exit 2
    ;;
esac
