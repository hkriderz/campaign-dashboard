# Campaign Operations Dashboard

A unified Next.js dashboard for phone banking analytics, canvassing tracking, and PDI sync tools — all backed by Google BigQuery (Scale to Win data).

> **Refactored clone** (`campaign-dashboard-refactor`): modular API helpers, unified GCP credential bootstrap for Docker/VPS, `output: "standalone"` for Dokploy. See [DEPLOY.md](./DEPLOY.md) for production setup and [.env.example](./.env.example) for secrets-safe configuration.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| Data | Google BigQuery (`@google-cloud/bigquery`) |
| Runtime | Node.js (server-side BQ queries via API routes) |

---

## Features (Phase 1 — Phone Banking)

- **Candidate overview** — All campaigns grouped by candidate tag, with total dials, call hours, and unique callers
- **Phone bank list** — All STW campaigns matching a candidate's name, sorted by date
- **All campaigns** — Same 2‑month / lifecycle rules as tag lists, but **no name filter**; flat table on `/phonebanking` and detail at `/phonebanking/c/[campaignId]`
- **Phone bank detail** — Full per-phonebanker breakdown with session-merged hours (same logic as `phonebanker_daily_hours.py`)
- **Bar chart** — Dials and call hours per phonebanker, filterable by day
- **Day filter** — Click any date to narrow the chart and table to that session

**Canvassing** is still a placeholder. **PDI Tools** are integrated under `/pdi` (overview, mapper, syncer).

### PDI Tools

| Route | Purpose |
|-------|---------|
| `/pdi` | Links to mapper and syncer |
| `/pdi/mapper` | **Magic Mapper** — STW ↔ PDI question/answer mapping; exports `stw_pdi_mapping_*.json` (schema v2) |
| `/pdi/syncer` | Runs `../pdiv3/stw_to_pdi.py` with `--non-interactive`; shows stdout/stderr (dry-run by default) |

**Cached NDJSON:** Mapper “cached” loads use `pdi_questions.ndjson` + `stw_surveys.ndjson`. Resolution order: `PDI_TOOLS_DATA_DIR` (if both files exist), then `campaign-dashboard/pdi-data`, then `../pdiv3`, then `../MoonDough`.

**Credentials folder:** On `/pdi`, use **Credentials** to upload or rely on auto-detected files under `campaign-dashboard/credentials/` (`gcp-service-account.json`, `pdi-credentials.json`, optional `pdi.env`). These values are merged for server routes: Mapper live refresh (BigQuery + PDI API) and Syncer (`stw_to_pdi.py` child process). Values in `credentials/` override `.env.local` for those keys when present.

**Live refresh:** Header **⟳ Refresh** in the Mapper calls BigQuery and the PDI Questions API. Configure GCP + PDI via the credentials folder or `GOOGLE_APPLICATION_CREDENTIALS` + `PDI_*` in `.env.local`.

**Syncer:** Requires a local Python environment where `stw_to_pdi.py` runs (Parsons, `dotenv`, GCP + PDI credentials). Optional env: `PDI_STW_TO_PDI_SCRIPT` (absolute path to script), `PDI_STW_WORKING_DIR` (usually your `pdiv3` folder with mapping JSON + `.env`), `PYTHON_EXECUTABLE`. The dashboard injects the same resolved GCP/PDI env vars as the mapper APIs. Place the latest `stw_pdi_mapping_*.json` in that working directory before a real sync.

---

## Setup

### 1. Copy credentials

```powershell
cd "c:\Users\Hari-ASUS\Documents\Cursor Project\pdi\campaign-dashboard"
```

Copy your GCP service account JSON into this folder:

```powershell
copy "..\pdiv3\starlit-link-475400-s5-9b1224eed9dd.json" "."
```

### 2. Create `.env.local`

```powershell
copy .env.local.example .env.local
```

The defaults in `.env.local.example` already match your project. The file should look like:

```env
GOOGLE_APPLICATION_CREDENTIALS=starlit-link-475400-s5-9b1224eed9dd.json
GCP_PROJECT_ID=starlit-link-475400-s5
BQ_DATASET=l11_stw
```

### 3. Install dependencies

```powershell
npm install
```

### 4. Run the dev server

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Adding or Editing Campaign Tags

All candidates and their name-matching rules live in one file:

```
lib/campaign-tags.ts
```

To add a new candidate:

```typescript
{
  id: "newcandidate",          // used in URLs: /phonebanking/newcandidate
  label: "New Candidate Name", // shown in the UI
  searchTerms: ["newcandidate", "othertag"], // matched against campaigns.name in BQ
  color: "#0ea5e9",
  textColor: "#ffffff",
  mode: "both",                // "phonebanking" | "canvassing" | "both"
},
```

The `searchTerms` are matched case-insensitively using `LIKE '%term%'` against the `campaigns.name` column in BigQuery. This is the same pattern used in `qc_phonebank_analysis.py` for `%QC%`.

---

## Project Structure

```
campaign-dashboard/
├── app/
│   ├── page.tsx                         # Landing / mode selector
│   ├── layout.tsx                       # Root layout
│   ├── globals.css
│   ├── phonebanking/
│   │   ├── layout.tsx                   # TopNav + Sidebar wrapper
│   │   ├── page.tsx                     # Candidate overview grid
│   │   └── [tag]/
│   │       ├── page.tsx                 # Phone bank list for one candidate
│   │       └── [campaignId]/
│   │           └── page.tsx             # Phone bank detail (chart + table)
│   ├── canvassing/                      # Placeholder (Phase 2)
│   ├── pdi/                             # Placeholder (Phase 3)
│   └── api/
│       ├── phonebanking/
│       │   ├── campaigns/route.ts       # All candidates aggregate stats
│       │   ├── [tag]/route.ts           # Phone banks for one tag
│       │   └── [tag]/[campaignId]/route.ts  # Single phone bank detail
│       └── phonebankers/route.ts        # Per-phonebanker stats (filterable)
├── components/
│   ├── layout/
│   │   ├── TopNav.tsx                   # Mode switcher nav bar
│   │   └── Sidebar.tsx                  # Candidate list sidebar
│   ├── phonebanking/
│   │   ├── CandidateGrid.tsx            # Candidate card grid
│   │   ├── PhoneBankTable.tsx           # Phone bank list table
│   │   ├── PhoneBankStats.tsx           # Summary stat cards
│   │   ├── PhoneBankDetailClient.tsx    # Interactive detail (client)
│   │   ├── PhonebankerBarChart.tsx      # Recharts bar chart
│   │   ├── PhonebankerTable.tsx         # Daily breakdown table
│   │   └── DayFilterBar.tsx             # Date pill filter
│   └── shared/
│       ├── StatCard.tsx
│       ├── LoadingSpinner.tsx
│       ├── EmptyState.tsx
│       └── ErrorBanner.tsx
└── lib/
    ├── bigquery.ts                      # Singleton BQ client
    ├── campaign-tags.ts                 # Tag config + SQL helpers
    ├── types.ts                         # All TypeScript types
    └── queries/
        └── phonebanking.ts             # BQ queries (TS port of Python scripts)
```

---

## Data Sources

All phone banking data comes from BigQuery:

| Table | Used for |
|---|---|
| `l11_stw.campaigns` | Campaign names, IDs, creation dates |
| `l11_stw.calls` | Dials, duration, caller/callee joins |
| `l11_stw.callers` | Phonebanker sessions (login/logout times) |

The queries are TypeScript ports of:
- `pdiv3/campaign_hours_dials.py` → campaign-level stats
- `pdiv3/phonebanker_daily_hours.py` → per-phonebanker session-merged daily stats

---

## BigQuery snapshot cache (tag dashboards)

Heavy tag queries (`fetchTagDailyCallerStats`, `fetchTagPhonebankerQuestionStats`, `fetchTagCallSurveyRowsForFinalFill`) can **merge disk snapshots** with a **narrow live BigQuery window**:

- **Live window:** the last **three** calendar days in `America/Los_Angeles` (today, yesterday, and the day before) — enough to bridge day rollovers cleanly.
- **Stable:** rows with `call_date` **strictly before yesterday** in LA are stored under `data/bq-snapshots/<tag>/` after each successful load.
- **Disable:** set `BQ_SNAPSHOTS_DISABLED=1` to always run full BigQuery (debug).

**Manual historical rebuild** (e.g. after STW backfills older dates):

1. Set `CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET` in `.env.local`.
2. On the candidate tag page, use **Rebuild history** (or `POST /api/phonebanking/bq-snapshot-refresh` with header `x-snapshot-secret` and JSON `{ "tagId": "faizah", "clear": true }`).

**Scheduled refresh (e.g. 9pm Pacific):** call the same HTTPS endpoint from Cloud Scheduler / cron with the secret; use timezone `America/Los_Angeles` when defining the schedule.

**Dev server:** snapshot files are excluded from webpack’s file watcher (`next.config.ts`) so saving them does not trigger a compile loop. If you change `next.config.ts`, restart `npm run dev`.

---

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| 1 | Phone banking dashboard | ✅ Done |
| 2 | Canvassing — Google Sheets integration | 🔜 Next |
| 2 | Canvassing — CSV file upload | 🔜 Next |
| 3 | Google Drive folder auto-ingest | 🔜 Planned |
| 4 | PDI Mapper (embedded in dashboard) | 🔜 Planned |
| 4 | PDI Syncer with live log stream | 🔜 Planned |
