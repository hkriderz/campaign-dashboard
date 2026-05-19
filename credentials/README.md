# Local credentials (PDI Tools)

Place files here so **Mapper** (live BigQuery + PDI API refresh) and **Syncer** use the same credentials without editing `.env.local`. Mapping JSON is saved under `pdi-mappings/`; sync CSV reports go to `pdi-sync-exports/`.

When `CAMPAIGN_DASHBOARD_SESSION_CREDENTIALS=1`, each browser uploads into `credentials/sessions/<uuid>/` instead of this global folder.

| File | Purpose |
|------|---------|
| `gcp-service-account.json` | GCP service account (BigQuery). Must include `project_id`, `private_key`, `client_email`. |
| `pdi-credentials.json` | PDI login. Use keys `PDI_USERNAME`, `PDI_PASSWORD`, `PDI_API_TOKEN` (or `username` / `password` / `apiToken`). |
| `pdi.env` | Optional alternative: `KEY=value` lines for the same three variables. |
| `sessions/` | Per-browser credential folders when session mode is enabled (auto-pruned after idle TTL). |

Uploaded files from the dashboard are written to these names. JSON key files are gitignored by the repo’s `*.json` rule — do not commit secrets.
