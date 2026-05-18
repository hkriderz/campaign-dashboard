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
| `NODE_ENV` | Auto | `production` in image |

### GCP JSON via env (no file mount)

Paste the service account JSON into Dokploy as `GCP_SERVICE_ACCOUNT_JSON` (single line), or base64-encode it:

```bash
base64 -w0 gcp-service-account.json
```

On startup, `instrumentation.ts` writes `credentials/gcp-service-account.json` and sets `GOOGLE_APPLICATION_CREDENTIALS`.

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
