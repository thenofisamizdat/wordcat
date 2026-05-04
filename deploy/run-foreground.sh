#!/usr/bin/env bash
# Run WordCat in the foreground (no systemd). Useful for containers, ad-hoc
# testing, or when you just want to tail the logs in your terminal.
#
# Reads PORT/BIND_HOST/INSTALL_DIR from env or defaults below.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-8100}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"

[ -d "$INSTALL_DIR/backend/.venv" ] || { echo "venv not found — run deploy/deploy.sh first"; exit 1; }

if [ -f "$INSTALL_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$INSTALL_DIR/.env"
  set +a
fi

cd "$INSTALL_DIR/backend"
exec .venv/bin/uvicorn app.main:app --host "$BIND_HOST" --port "$PORT"
