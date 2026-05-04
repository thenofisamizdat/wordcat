# WordCat — server deploy

Single-process production deploy: the FastAPI backend listens on **port 8100**
and serves the built React frontend itself. No nginx required.

## Prerequisites on the server

- A recent Linux (Ubuntu 22.04+/Debian 12+/etc) with **systemd**
- Python 3.10+
- Node.js 18+ and npm
- `git`, `curl`

Install them (Debian/Ubuntu):
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git curl
# Node.js (NodeSource setup)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## First-time install

```bash
git clone <your-repo-url> ~/wordcat
cd ~/wordcat
bash deploy/deploy.sh
```

The script:
- creates a Python venv under `backend/.venv`
- installs backend deps
- downloads the dictionary (~3 MB) on first run
- generates per-category wordlists if missing
- runs `npm install` + `npm run build` for the frontend
- writes a `.env` with a freshly-generated JWT secret
- installs and starts a **systemd user service** named `wordcat`
- runs a health-check against `http://127.0.0.1:8100/api/health`

When it's done, browse to `http://<server-ip>:8100/`.

## Keep it running across logouts

systemd user services normally stop when the user logs out. To make WordCat
keep running, enable lingering once (requires sudo):

```bash
sudo loginctl enable-linger $USER
```

## Open the port on the firewall

If you use UFW:
```bash
sudo ufw allow 8100/tcp
```

If your cloud provider has a security-group / firewall, allow **TCP 8100**
inbound from `0.0.0.0/0` (or just your office IP for a private deploy).

## Day-to-day commands

```bash
# Status / logs
systemctl --user status  wordcat
journalctl  --user -u wordcat -f

# Restart / stop
systemctl --user restart wordcat
systemctl --user stop    wordcat
```

## Updating to a new version

```bash
cd ~/wordcat
git pull
bash deploy/deploy.sh   # rebuilds frontend, reinstalls deps, restarts service
```

The script is idempotent — running it on an existing install just refreshes
everything in place. The SQLite DB at `backend/tilegame.db` is left untouched
(player accounts + leaderboards survive).

## Customizing

You can override defaults with env vars before running deploy.sh:

| Var | Default | What it does |
|---|---|---|
| `INSTALL_DIR` | `$HOME/wordcat` | Where the app lives |
| `PORT`        | `8100` | Backend listen port |
| `BIND_HOST`   | `0.0.0.0` | Bind address (use `127.0.0.1` if running behind nginx) |
| `JWT_SECRET`  | random  | JWT signing secret (only used on first run, then `.env` wins) |
| `SERVICE_NAME`| `wordcat` | systemd unit name |
| `NO_SERVICE=1`| —        | Skip systemd setup; run via `deploy/run-foreground.sh` instead |

The `.env` file at `$INSTALL_DIR/.env` is the source of truth at runtime.
Edit it and `systemctl --user restart wordcat` to apply changes.

## Without systemd (Docker, Alpine, your laptop)

```bash
NO_SERVICE=1 bash deploy/deploy.sh
bash deploy/run-foreground.sh
# or in the background with nohup:
nohup bash deploy/run-foreground.sh > wordcat.log 2>&1 &
```

## Troubleshooting

- **"permission denied" on the systemd user dir** — make sure you ran
  `deploy.sh` as your normal user (NOT as root / via sudo).
- **Service exits immediately** — check `journalctl --user -u wordcat -n 100`
  for stack traces. Usually a missing dep or a stale `.env`.
- **`npm install` fails with EACCES** — your global npm prefix is somewhere
  the user can't write. Switch to a user prefix:
  `mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global`.
- **Frontend shows but `/api/*` 404s** — confirm `frontend/dist/index.html`
  exists and the service is the new build (`systemctl --user restart wordcat`).
- **Daily challenge keeps the same shuffle** — that's by design. The seed is
  derived from the calendar date so every player on a given day sees the same
  game.
