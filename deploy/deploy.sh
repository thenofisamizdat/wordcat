#!/usr/bin/env bash
#
# WordCat one-shot deploy / update script.
#
# Target: a Linux server (Ubuntu/Debian/etc) with systemd, your normal user.
# Installs into $HOME/wordcat by default. Backend listens on PORT (default 8100)
# and serves the built React frontend itself — single process, single port.
#
# Usage on the server:
#   1. Clone the repo into ~/wordcat (or set INSTALL_DIR=...)
#   2. Run:  bash deploy/deploy.sh
#
# Subsequent updates:
#   cd ~/wordcat && git pull && bash deploy/deploy.sh
#
# Environment overrides:
#   INSTALL_DIR   — where the app lives          (default: $HOME/wordcat)
#   PORT          — backend listen port          (default: 8100)
#   BIND_HOST     — backend bind address         (default: 0.0.0.0)
#   JWT_SECRET    — JWT signing secret           (default: random on first run)
#   SERVICE_NAME  — systemd user service name    (default: wordcat)
#   PYTHON        — python interpreter to use    (default: python3)
#   NO_SERVICE=1  — skip systemd setup (foreground run instead)

set -euo pipefail

# ---------- defaults ----------
INSTALL_DIR="${INSTALL_DIR:-$HOME/wordcat}"
PORT="${PORT:-8100}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
SERVICE_NAME="${SERVICE_NAME:-wordcat}"
PYTHON="${PYTHON:-python3}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC}   $*"; }
die()  { echo -e "${RED}xx${NC} $*" >&2; exit 1; }

# ---------- preflight ----------
log "Deploying WordCat to ${INSTALL_DIR} on port ${PORT}"

[ -d "$INSTALL_DIR/backend/app" ] || die "INSTALL_DIR=$INSTALL_DIR does not look like a WordCat checkout (missing backend/app). Clone the repo there first."

command -v "$PYTHON" >/dev/null 2>&1 || die "$PYTHON not found on PATH"
command -v node     >/dev/null 2>&1 || die "node not found on PATH (need Node.js for the frontend build)"
command -v npm      >/dev/null 2>&1 || die "npm not found on PATH"

cd "$INSTALL_DIR"

# ---------- backend: venv + deps ----------
log "Setting up Python venv"
if [ ! -d backend/.venv ]; then
  "$PYTHON" -m venv backend/.venv
fi
# shellcheck disable=SC1091
source backend/.venv/bin/activate

log "Installing backend dependencies"
pip install --upgrade pip --quiet
pip install --quiet -e ./backend

# ---------- backend: data ----------
DICTIONARY="backend/app/data/dictionary.txt"
if [ ! -s "$DICTIONARY" ]; then
  log "Downloading English wordlist (one-time, ~3 MB)"
  curl -fsSL -o "$DICTIONARY" \
    https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt
fi

CAT_WORDS_DIR="backend/app/data/category_words"
if [ ! -d "$CAT_WORDS_DIR" ] || [ -z "$(ls -A "$CAT_WORDS_DIR" 2>/dev/null)" ]; then
  log "Generating per-category wordlists from curated seeds"
  "$PYTHON" scripts/seed_categories.py
fi

# ---------- frontend: build ----------
log "Installing frontend dependencies"
( cd frontend && npm install --no-fund --no-audit --silent )

log "Building frontend (vite production build)"
( cd frontend && npm run build --silent )

[ -f frontend/dist/index.html ] || die "frontend/dist/index.html missing after build — check vite output above"

# ---------- env file ----------
ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Creating $ENV_FILE with a fresh JWT secret"
  RANDOM_SECRET="$(LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 48)"
  cat > "$ENV_FILE" <<EOF
TILEGAME_JWT_SECRET=${JWT_SECRET:-$RANDOM_SECRET}
TILEGAME_SQLITE_PATH=$INSTALL_DIR/backend/tilegame.db
EOF
  chmod 600 "$ENV_FILE"
fi

# ---------- systemd user service ----------
if [ "${NO_SERVICE:-0}" != "1" ]; then
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not found; skipping service install. Run 'bash deploy/run-foreground.sh' to start manually."
  else
    SERVICE_PATH="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
    log "Installing systemd user service at ${SERVICE_PATH}"
    mkdir -p "$(dirname "$SERVICE_PATH")"

    # Render the template into the user's systemd directory with this user's paths.
    sed \
      -e "s|@INSTALL_DIR@|$INSTALL_DIR|g" \
      -e "s|@PORT@|$PORT|g" \
      -e "s|@BIND_HOST@|$BIND_HOST|g" \
      "$INSTALL_DIR/deploy/wordcat.service" > "$SERVICE_PATH"

    systemctl --user daemon-reload
    systemctl --user enable "${SERVICE_NAME}.service" >/dev/null

    # If user-lingering isn't enabled, the service stops on logout. Warn — this
    # requires sudo so we can't fix it here.
    if command -v loginctl >/dev/null 2>&1; then
      if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
        warn "User-lingering not enabled. Run as root once:"
        warn "    sudo loginctl enable-linger $USER"
        warn "Otherwise the service stops when you log out."
      fi
    fi

    log "Restarting ${SERVICE_NAME} service"
    systemctl --user restart "${SERVICE_NAME}.service"
    sleep 1

    if systemctl --user is-active --quiet "${SERVICE_NAME}.service"; then
      log "Service is running"
    else
      warn "Service did not start cleanly. Recent logs:"
      journalctl --user -u "${SERVICE_NAME}.service" -n 30 --no-pager || true
      die "Deploy failed"
    fi
  fi
fi

# ---------- smoke test ----------
log "Health check"
sleep 1
if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  log "Health endpoint OK"
else
  warn "Health endpoint did not respond on 127.0.0.1:${PORT}. Check logs:"
  warn "    journalctl --user -u ${SERVICE_NAME} -f"
fi

# ---------- done ----------
PUB_IP="$(curl -fsS --max-time 2 https://api.ipify.org 2>/dev/null || echo '<server-ip>')"
log "Deploy complete"
echo
echo "  Local:    http://127.0.0.1:${PORT}/"
echo "  Public:   http://${PUB_IP}:${PORT}/"
echo
echo "Useful commands:"
echo "  systemctl --user status  ${SERVICE_NAME}"
echo "  systemctl --user restart ${SERVICE_NAME}"
echo "  systemctl --user stop    ${SERVICE_NAME}"
echo "  journalctl  --user -u ${SERVICE_NAME} -f"
echo
echo "Update flow next time:"
echo "  cd ${INSTALL_DIR} && git pull && bash deploy/deploy.sh"
