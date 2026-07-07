# Deployment

Deploys the app to a single Ubuntu/Debian server:

- **Backend** (FastAPI) runs under **systemd** as `household-ledger-api`, listening on
  `127.0.0.1:8000`.
- **Frontend** is built to a static site (`frontend/dist`, Expo web export) and served
  by **nginx**, which also reverse-proxies `/api/` to the backend.
- Both are served from a single domain, so the browser calls `https://DOMAIN/api/...`.

```
Browser ──▶ nginx :443 ──┬──▶  /            frontend/dist   (static web app)
                         └──▶  /api/   ──▶  127.0.0.1:8000  (uvicorn/FastAPI)
```

## Server prerequisites (install once)

- Ubuntu/Debian with `sudo`
- **PostgreSQL** (local or managed) — have a DB + credentials ready
- **Node.js 20+** and **npm** (to build the web app)
- **uv** (`curl -LsSf https://astral.sh/uv/install.sh | sh`) — note its path with `which uv`
- A DNS `A` record pointing `DOMAIN` at the server

## First-time deploy

```bash
# 1. Clone the repo to the path you'll use as APP_DIR
sudo git clone <repo-url> /opt/household-ledger
cd /opt/household-ledger

# 2. Configure deployment
cp deploy/config.example.env deploy/config.env
$EDITOR deploy/config.env            # set DOMAIN, APP_DIR, SERVICE_USER, UV_BIN, ...

# 3. Configure backend secrets
cp backend/.env.example backend/.env
$EDITOR backend/.env                 # DATABASE_URL / SYNC_DATABASE_URL / JWT_SECRET
                                     # (set ANTHROPIC_API_KEY too if you want AI features)

# 4. Install nginx + systemd unit and wire them up
sudo ./deploy/setup.sh

# 5. Build + start the app
./deploy/deploy.sh

# 6. (Recommended) HTTPS
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <DOMAIN>
```

Verify:

```bash
curl -fsS https://<DOMAIN>/api/health && echo   # -> {"status":"ok"}
```

Then open `https://<DOMAIN>/` in a browser.

## Subsequent deploys

After pushing new commits to `BRANCH`, just re-run on the server:

```bash
cd /opt/household-ledger
./deploy/deploy.sh
```

This pulls, runs `alembic upgrade head`, rebuilds the web app, restarts the API, and
reloads nginx.

### Deploy from your laptop (optional)

```bash
ssh deploy@<server> 'cd /opt/household-ledger && ./deploy/deploy.sh'
```

## Operations

```bash
systemctl status household-ledger-api      # is the API up?
journalctl -u household-ledger-api -f      # tail API logs
sudo nginx -t && sudo systemctl reload nginx
```

## Notes / trade-offs

- **`config.env` is git-ignored** — it's server-specific and never committed.
  `config.example.env` is the template.
- **Secrets** live in `backend/.env` on the server (loaded by pydantic-settings). They
  are never baked into the web bundle. The only build-time value the frontend sees is
  `API_PUBLIC_URL` (→ `EXPO_PUBLIC_API_URL`), which is just your public URL.
- **CORS**: since the web app is same-origin with the API, you don't strictly need
  `CORS_ORIGINS`. Set it in `backend/.env` only if you also call the API from other
  origins (e.g. a native build in development).
- This is a **single-box** setup. For zero-downtime or multi-node you'd add a process
  manager with rolling restarts and a shared DB — out of scope here.
