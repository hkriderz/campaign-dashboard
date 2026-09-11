# Campaign Operations Dashboard

A unified Next.js dashboard for phone banking analytics, texting support tags, canvassing tracking, and PDI sync tools — all backed by Google BigQuery (Scale to Win data).

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

### Texting (STW Text)

- **Candidate overview** — `/texting` lists the same sidebar candidates as phone banking (plus **Nithya Raman**), with campaign counts, contacts, and Complete/Pending send status
- **Campaign table** — `/texting/[tag]` shows Name, Pending/Complete (`INITIAL_SEND_COMPLETE` = Complete), and contact counts
- **Contact tags** — Support answers (Strong Support / Undecided / Neither / Strong Oppose) and a separate **Moved** block, formatted like phonebank survey rollups

Text data is read from **`l11_stw_txt`** (override with `BQ_TEXT_DATASET`). It is never mixed into phonebank snapshots or `phonebanking-csv-*.json`.

**Canvassing** is still a placeholder. **PDI Tools** are integrated under `/pdi` (overview, mapper, syncer).

### District Classifier

The district classifier is available at `/district-classifier`. It is the first app-integrated wrapper around
`geomodule/sort-signups.py` and is intentionally small for Dokploy:

- uploads CSV files through the Next.js app
- stores job metadata and files under `data/district-classifier/`
- starts the existing Python GIS sorter in the background
- tracks queued, processing, completed, and failed jobs
- exposes generated CSV outputs as downloads

This first pass preserves the existing Python behavior. Confidence scoring, historical duplicate suppression,
review queues, and richer exact-address persistence are planned as incremental layers on top of this job flow.

Runtime requirements:

- `PYTHON_EXECUTABLE` may be set when Python is not available as `python3`/`python`.
- `DISTRICT_SORT_SIGNUPS_SCRIPT` may be set when the sorter does not live at `geomodule/sort-signups.py`.
- Local Python installs should include the packages in `geomodule/requirements.txt`.
- Dokploy builds install Python, `requests`, and `shapely` in the production image.
- District GeoJSON files must be available under `geodata/`:
  - `geodata/la-city-council.geojson` from LA City Boundaries, Council Districts layer.
  - `geodata/ca-state-assembly.geojson` from California Districts, State Assembly layer.
- Generated ZIP lookup caches live under `data/district-sort-cache/` and should be treated as runtime cache data.

### PDI Tools

| Route | Purpose |
|-------|---------|
| `/pdi` | Links to mapper and both syncers |
| `/pdi/mapper` | **Magic Mapper** — Dialer / Text toggle. Dialer lists phone surveys. Text lists every Nithya campaign (including untagged lists). **All lists** writes the shared `Nithya (STW Text)` mapping; **This list only** writes that campaign’s name. **Save mapping** stores a reusable Q&A template; opening the next list with the same questions and a similar campaign name auto-applies it. Exports `stw_pdi_mapping_*.json` or `stw_text_pdi_mapping_*.json` |
| `/pdi/syncer` | Dialer TypeScript sync (dry-run by default). Optional `PDI_SYNC_ENGINE=python` for `stw_to_pdi.py` |
| `/pdi/text-syncer` | Text-tag TypeScript sync. Same dry-run, incremental/range, stale lock, rollback, and reports as Dialer; own `state_key` / `lock_key` (`text`) |

**Cached NDJSON:** Mapper “cached” loads use `pdi_questions.ndjson` + `stw_surveys.ndjson`. Resolution order: `PDI_TOOLS_DATA_DIR` (if both files exist), then `campaign-dashboard/pdi-data`, then `../pdiv3`, then `../MoonDough`.

**Credentials folder:** On `/pdi`, use **Credentials** to upload or rely on auto-detected files under `campaign-dashboard/credentials/` (`gcp-service-account.json`, `pdi-credentials.json`, optional `pdi.env`). These values are merged for server routes: Mapper live refresh (BigQuery + PDI API) and Syncer (`stw_to_pdi.py` child process). Values in `credentials/` override `.env.local` for those keys when present.

**Live refresh:** Header **⟳ Refresh** in the Mapper calls BigQuery and the PDI Questions API. Configure GCP + PDI via the credentials folder or `GOOGLE_APPLICATION_CREDENTIALS` + `PDI_*` in `.env.local`.

**Syncer (Dialer):** TypeScript engine by default. Optional Python escape hatch: `PDI_STW_TO_PDI_SCRIPT`, `PDI_STW_WORKING_DIR`, `PYTHON_EXECUTABLE`, `PDI_SYNC_ENGINE=python`. Place the latest `stw_pdi_mapping_*.json` in `pdi-mappings/` before a real sync.

**Text Syncer:** Mapper Text mode lists each Nithya text campaign in the sidebar, using the same Dec 1, 2025 window as `/texting/nithya`. Campaigns with no Support/Moved tags stay visible as **No tags yet** and cannot be opened until Refresh finds mappable tags. **All lists** maps raw STW tag names (`NithyaMayorYES`, …) on the shared survey `Nithya (STW Text)`. **This list only** stores the same keys on that campaign’s name. **Save mapping** on a question stores a template (display campaign name + PDI flags). Opening another list auto-applies that template only when the question name matches, the question is still unmapped, and the campaign titles are similar (`Nithya PAC` ↔ `Nithya HWLRA`; not `School Board GOTV`). **Delete saved mapping** removes the template only. Sync looks up the campaign first, then falls back to `Nithya (STW Text)`. `/pdi/text-syncer` reads `l11_stw_txt` (`campaign_contact_tags` + `campaign_contacts.data` PDI ids: `v1_pdiid` / `pdi_id` / `PDI ID`), skips empty PDI ids and non-Support/Moved tags, and posts the same `/flags` payload as Dialer except `acquisitionTypeId` is PDI **Text Bank** (Dialer uses **ScaletoWin Phone Bank**). Incremental cursor is `sync_state.state_key = 'text'`. Advisory lock is `lock_key = 'text'`. People-level dedupe is shared (`pdi_id|flag_code|flag_date`). Python parity is Dialer-only.

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
# optional — defaults to l11_stw_txt
# BQ_TEXT_DATASET=l11_stw_txt
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
│   ├── texting/
│   │   ├── layout.tsx                   # Same sidebar candidates as phone banking
│   │   ├── page.tsx                     # Candidate overview for STW Text
│   │   └── [tag]/page.tsx               # Campaign table + contact-tag rollups
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
│   ├── texting/
│   │   ├── TextCandidateGrid.tsx
│   │   ├── TextCampaignTable.tsx
│   │   └── TextTagRollup.tsx
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
        ├── phonebanking.ts             # Dialer BQ queries
        └── texting.ts                  # STW Text BQ queries
```

---

## Data Sources

Phone banking data comes from the Dialer dataset (`BQ_DATASET`, default `l11_stw`):

| Table | Used for |
|---|---|
| `l11_stw.campaigns` | Campaign names, IDs, creation dates |
| `l11_stw.calls` | Dials, duration, caller/callee joins |
| `l11_stw.callers` | Phonebanker sessions (login/logout times) |

Texting data comes from the STW Text dataset (`BQ_TEXT_DATASET`, default `l11_stw_txt`):

| Table | Used for |
|---|---|
| `l11_stw_txt.campaigns` | Text campaign name, send status, contact count |
| `l11_stw_txt.campaign_contacts` | Contact-count fallback |
| `l11_stw_txt.campaign_contact_tags` + `tags` | Support / moved tag rollups; PDI Text Syncer flag source |
| `l11_stw_txt.campaign_contacts.data` | PDI person ids for Text Syncer (`v1_pdiid` / `pdi_id` / `PDI ID`) |

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
