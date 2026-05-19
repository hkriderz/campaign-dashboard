# Deploying on Dokploy (Ubuntu VPS)

This guide targets the refactored **campaign-dashboard** image with Docker. Credentials never belong in git — use env vars or mounted volumes.

## 1. Push to GitHub

```bash
cd campaign-dashboard-refactor
git init
git add .
git commit -m "Campaign dashboard — refactored production build"
git remote add origin https://github.com/YOUR_USER/campaign-dashboard.git
git push -u origin main
```

Ensure these are **not** committed: `.env.local`, `credentials/*.json`, `starlit-link*.json`, large `data/bq-snapshots/**`.

## 2. Dokploy application

1. Create a **new Application** → source: your GitHub repo.
2. Build type: **Dockerfile** (path: `Dockerfile` at repo root).
3. Port: **3000**.
4. Add a **volume** (recommended):
   - Mount path: `/app/data` (BQ snapshots, uploads)
   - Optional: `/app/credentials` if you prefer file-based keys over env JSON
   - Optional: `/app/pdi-mappings`, `/app/pdi-sync-exports`

## 3. Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `GCP_PROJECT_ID` | Yes | BigQuery project |
| `BQ_DATASET` | Yes | e.g. `l11_stw` |
| `GCP_SERVICE_ACCOUNT_JSON` | Yes* | Full JSON or base64 JSON (*unless mounting `credentials/gcp-service-account.json`) |
| `PDI_USERNAME` / `PDI_PASSWORD` / `PDI_API_TOKEN` | For PDI | Or upload via `/pdi` UI into mounted `credentials/` |
| `CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET` | Optional | Enables snapshot rebuild API |
| `CAMPAIGN_DASHBOARD_DATA_DIR` | Optional | Set to `/app` if using volumes under `/app/data` |
| `CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS` | Multi-user | Set to `1` so each browser must upload its own GCP/PDI keys |
| `CAMPAIGN_DASHBOARD_ALLOW_GLOBAL_CREDENTIALS` | Optional | Default `1`; set `0` to disable env/global fallback for sessions |
| `CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS_TTL_HOURS` | Optional | Prune idle session credential folders (default `72`) |
| `NODE_ENV` | Auto | `production` in image |

### Multi-user session credentials (recommended for shared Dokploy URL)

When `CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS=1` (or `true` / `yes` / `on`):

1. Each visitor gets an anonymous browser session (httpOnly cookie).
2. They must upload GCP (+ PDI for mapper/syncer) credentials before seeing data.
3. Credentials are stored under `credentials/sessions/<uuid>/` — **not shared** with other visitors.

**One-file upload:** Users can upload a single JSON bundle with `gcp` and `pdi` objects (see `credentials/campaign-credentials.example.json`). The server splits it into `gcp-service-account.json` and `pdi-credentials.json` in the session folder.
4. **Remove** `GCP_SERVICE_ACCOUNT_JSON` and `PDI_*` from Dokploy env if you do not want a shared global fallback.
5. Keep `GCP_SERVICE_ACCOUNT_JSON` + `CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET` only for **cron** snapshot rebuilds (no session cookie → global creds apply).

Idle session folders are deleted automatically after `CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS_TTL_HOURS` (default 72h).

**HTTP (no TLS):** leave `CAMPAIGN_DASHBOARD_SESSION_COOKIE_SECURE` unset or set `0` so the `cd_session` cookie is stored. If it is missing, every refresh creates a new session and uploads appear to vanish.

**HTTPS:** set `CAMPAIGN_DASHBOARD_SESSION_COOKIE_SECURE=1`.

### GCP JSON via env (single-tenant / cron only)

Paste the service account JSON into Dokploy as `GCP_SERVICE_ACCOUNT_JSON` (single line), or base64-encode it:

```bash
base64 -w0 gcp-service-account.json
```

On first server request, the app writes `credentials/gcp-service-account.json` and sets `GOOGLE_APPLICATION_CREDENTIALS` (lazy bootstrap).

## 4. Domain & HTTPS

In Dokploy, attach your domain and enable TLS (Let’s Encrypt). The app listens on `0.0.0.0:3000`.

## 5. Post-deploy checks

1. Open `/` — landing page loads.
2. Open `/phonebanking` — candidate grid (requires working BQ credentials).
3. Open `/pdi` → **Credentials** — confirm GCP + PDI status.
4. Optional: `POST /api/phonebanking/bq-snapshot-refresh` with header `x-snapshot-secret` for cron rebuilds.

## 6. Scheduled snapshot refresh (cron)

On the VPS or Dokploy cron, nightly (America/Los_Angeles):

```bash
curl -sS -X POST "https://your-domain.com/api/phonebanking/bq-snapshot-refresh" \
  -H "Content-Type: application/json" \
  -H "x-snapshot-secret: YOUR_SECRET" \
  -d '{"refreshAll": true, "clear": false}'
```

## Local Docker test

```bash
docker build -t campaign-dashboard .
docker run --rm -p 3000:3000 \
  -e GCP_PROJECT_ID=your-project \
  -e BQ_DATASET=l11_stw \
  -e GCP_SERVICE_ACCOUNT_JSON="$(cat credentials/gcp-service-account.json)" \
  campaign-dashboard
```

Open http://localhost:3000
