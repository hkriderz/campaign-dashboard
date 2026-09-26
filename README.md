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
- **All campaigns** — Same 2‑month / lifecycle rules as tag lists, but **no name filter**; flat table on `/phonebanking` and detail at `/phonebanking/c/[campaignId]`. A selected date loads Daily Aggregate from **primary** candidate tags only (not derived `qc-*` slugs — those lists are already in the candidate snapshot). Candidate pages hide QC-named lists from Daily Aggregate, All Phone Banks, and By Phone Bank. QC Calls pages keep only QC lists. All Campaigns includes both. Header strip shows generic Strong support / Undecided / Strong oppose, counted **per phone bank** (Final Result when that list has it, otherwise the ID/polling question).
- **Phone bank detail** — Full per-phonebanker breakdown with session-merged hours (same logic as `phonebanker_daily_hours.py`)
- **Bar chart** — Dials and call hours per phonebanker, filterable by day
- **Day filter** — Click any date to narrow the chart and table to that session

### Texting (STW Text)

- **Candidate overview** — `/texting` lists the same sidebar candidates as phone banking (plus **Nithya Raman**), with campaign counts, contacts, and Complete/Pending send status
- **Campaign table** — `/texting/[tag]` shows Name, Pending/Complete (`INITIAL_SEND_COMPLETE` = Complete), and contact counts
- **Contact tags** — Support answers (Strong Support / Undecided / Neither / Strong Oppose) and a separate **Moved** block, formatted like phonebank survey rollups

Text data is read from **`l11_stw_txt`** (override with `BQ_TEXT_DATASET`). It is never mixed into phonebank snapshots or `phonebanking-csv-*.json`.

**Canvassing** includes Unique ID Overview (phone + text + knocks), Knock Analysis, Doorknocks and Results, and Non-Contact Patterns. **PDI Tools** are integrated under `/pdi` (overview, mapper, syncer).

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

**Text Syncer:** Mapper Text mode lists every text campaign in `l11_stw_txt` that has at least one tag. There is no candidate-name filter and no created-date cutoff. Nithya Mayor and Moved tags still classify to Support and Moved. Any other tag is listed under Other so the campaign can be opened. Tags are classified to **support statuses** (`Strong Support`, `Undecided`, `Neither`, `Strong Oppose`) and **Moved** (`Recently moved`) — the same labels phonebank maps onto a PDI Support ID. **All lists** writes those statuses on the shared survey `Nithya (STW Text)`. **This list only** stores the same keys on that campaign’s name. Auto-match maps `Strong Support` → `SS`, `Undecided` → `U`, `Neither` → `U`, `Strong Oppose` → `SO`, and `Recently moved` → `Moved`. **Save mapping** on a question stores a template (display campaign name + PDI flags). Opening another list auto-applies that template only when the question name matches, the question is still unmapped, and the campaign titles are similar (`Nithya PAC` ↔ `Nithya HWLRA`; not `School Board GOTV`). **Delete saved mapping** removes the template only. `/pdi/text-syncer` reads `l11_stw_txt` (`campaign_contact_tags` + `campaign_contacts.data` PDI ids: `v1_pdiid` / `pdi_id` / `primary_id` when it is `CA` plus digits), includes every text campaign in the sync window, skips empty PDI ids, and posts mapped tags — Support, Moved, and Other. It posts the same `/flags` payload as Dialer except `acquisitionTypeId` is PDI **Text Bank** (Dialer uses **ScaletoWin Phone Bank**). After classification it keeps **one Support and one Moved status per person per campaign** (latest tag wins) and keeps distinct Other tags. Flag lookup is campaign first, then `Nithya (STW Text)`; for each row it tries the classified status, then the raw STW tag (`NithyaMayorYES`, …), then any mapped tag with the same status (`NithyaMayor_YES` reuses a `NithyaMayorYES` → `SS` mapping). Incremental cursor is `sync_state.state_key = 'text'`. Advisory lock is `lock_key = 'text'`. People-level dedupe is shared (`pdi_id|flag_code|flag_date`). Python parity is Dialer-only.

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

Candidates and their name-matching rules are edited in the shared **Campaign tags** page at `/phonebanking/campaign-tags`. The same menu is linked from the phone banking and texting sidebars (and from the texting landing page). Saving writes `data/campaign-tags.json` (or `CAMPAIGN_TAGS_CONFIG_PATH`). When that file is missing or empty, built-in defaults in `lib/campaign-tags.ts` are used.

Membership is chosen in the **Mode** dropdown (QC stays a separate checkbox, and only applies when phone banking is included):

| Mode option | Stored `mode` | `includeInTexting` | Appears in |
|---|---|---|---|
| Phone banking, canvassing & texting | `both` | `true` | Phone bank, canvassing, texting |
| Phone banking & canvassing | `both` | `false` | Phone bank, canvassing |
| Phone banking & texting | `phonebanking` | `true` | Phone bank, texting |
| Canvassing & texting | `canvassing` | `true` | Canvassing, texting |
| Phone banking only | `phonebanking` | `false` | Phone bank |
| Canvassing only | `canvassing` | `false` | Canvassing |
| Texting only | `texting` | `true` | Texting |

When `includeInTexting` is omitted from an older config row, it defaults to `true` for `phonebanking` / `both` / `texting` and `false` for `canvassing`. Derived QC buckets (`qc-*`) stay phone-banking only.

Built-in default shape (used only when no config file exists):

```typescript
{
  id: "newcandidate",          // used in URLs: /phonebanking/newcandidate and /texting/newcandidate
  label: "New Candidate Name", // shown in the UI
  searchTerms: ["newcandidate", "othertag"], // matched against campaigns.name in BQ
  color: "#0ea5e9",
  textColor: "#ffffff",
  mode: "both",                // "phonebanking" | "canvassing" | "both" | "texting"
  includeInTexting: true,      // set by Mode when the selection includes texting
},
```

The `searchTerms` are matched case-insensitively using `LIKE '%term%'` against the `campaigns.name` column in BigQuery. This is the same pattern used in `qc_phonebank_analysis.py` for `%QC%`.

---

## Unique ID Overview and knock index

`/canvassing/overview` counts **unique PDI / PRIMARY IDs** labeled Strong support, Undecided, or Strong oppose for a candidate. Sidebar **Unique IDs** is the first Canvassing tools link. Knock Analysis, Doorknocks and Results, and Non-Contact Patterns stay as they are.

**Sources (combined per candidate):**

| Channel | Identity | Outcome | Storage |
|---|---|---|---|
| Phone | `callees.data` PDI (`v1_pdiID`, then `pdi_id`) | Final Result, else ID / polling (`extractCallSurveyLabels`) | `data/bq-snapshots/{tag}/unique-id-phone.json` |
| Text | `campaign_contacts.data` PDI | Latest support tag (`Neither` → Undecided; Moved ignored) | `data/bq-snapshots/{tag}/unique-id-text.json` |
| Canvass | Knock `PRIMARYID` | Final Result or ID question (`pickSupportOutcome`) | `data/canvassing-reports/knock-index.json` |

IDs are normalized the same way as QC recontact (`trim`, strip spaces, uppercase). Rows without an ID are dropped. QC-named phone/text lists are excluded (`campaignNameLooksLikeQc`). Soft support folds into Strong support; soft oppose folds into Strong oppose. Labels stay generic — never a candidate name.

**Latest label wins** across channels (timestamp, then canvass > phone > text). Combined counts put each ID in one bucket. **Channel breakout** uses the latest label *on that channel*, so the same person can be Strong support on the phone and Undecided on a text. **Change** is first vs last family **inside the selected date range**.

**All candidates** is a comparison table only — IDs are not merged across races. Select a candidate for the paginated ID list (search, label/channel filters) and CSV export.

**Refresh:** **Refresh phone & text** rebuilds that candidate’s unique-ID snapshots from BigQuery (`POST /api/canvassing/overview/refresh`). First GET for a selected candidate builds a missing snapshot once. All-candidates does not auto-build every tag. The phone dashboard tag refresh (`rebuildTagBqSnapshotsFromBigQuery`) also rebuilds unique-ID phone/text snapshots for non-QC candidates, so scheduled / local snapshot refresh keeps Unique IDs current.

**Changed IDs:** on a selected candidate, click a change-table count to list the PDIs, then click a PDI for the labeled contact timeline in the date range. Changed IDs in the main table are also clickable.

**Knock index:** `data/canvassing-reports/knock-index.json` stores compact rows (`PRIMARYID`, canvasser, assignment, time, question, response). Dedup key is `primaryId + occurredAt + question + response`. **Run Report** on Knock Analysis (Lunch or Final) appends those knock rows to Unique IDs immediately. Save still writes the gap report and also appends; re-runs of the same file add 0 rows. Unique ID Overview’s own upload still works. Gap reports still drop raw knocks and are not the source of truth.

**Import the campaign files** already in `canvassref/`:

```
npm run seed:knock-index
```

Defaults:

- `canvassref/Canvasser Details - (Beginning to 9_6_2026).csv`
- `canvassref/Canvasser Details - (9_7 to_9_12_2026).csv`

Or upload the same CSV/XLSX on Unique ID Overview. Re-uploads skip duplicate rows.

**Filters:** contact date in `America/Los_Angeles` (clear = all days) and candidate chips from `getCoreCampaignTags()`. Knocks match assignment / filename with `campaignNameMatchesTag`. Donate, volunteer, vote plan, and Prop 40 pledge rows stay in the knock index but never overwrite the ID result.

**QC matching:** refreshing a QC tag (`qc-*`, including local one-click) rebuilds Recontacts against this index. Canvass priors use `PRIMARYID` = callee PDI. Text priors are fetched live from `l11_stw_txt` on the same refresh (not from `/texting` tag rollups).

---

## QC Recontacts (QC Calls Overview)

On sidebar **QC Calls** tags (`/phonebanking/qc-<candidate>` only), Overview adds a **Recontacts** section above All Phone Banks, plus a **Matched** header card. Regular `/phonebanking/<candidate>` pages are unchanged.

Each QC call is paired to prior contacts for the same callee PDI (from `callees.data`, preferring `v1_pdiID`, then `pdi_id` / `PDI ID`). Phone-bank priors come from regular (non-QC) banks. Canvass priors come from the saved knock index (`PRIMARYID` = PDI, assignment name via `campaignNameMatchesTag`). Text priors come from STW Text (`l11_stw_txt`: PDI on `campaign_contacts.data`, campaign name, texter from outbound `messages.created_by_user_id` → `users.full_name`, support tags). Channels stay separate; **change** uses the latest prior that has a classifiable result (an untagged newer text does not wipe a phone or canvass outcome). A canvass-only or text-only match is still `matched`. Click a row for side-by-side phone answers and the text conversation (modal only). Refresh the QC tag to rebuild `data/bq-snapshots/qc-<candidate>/recontact-pairs.json` against the current knock index and live text contacts.

The table includes a QC call only when the canvass result is **Talking to Correct Person** and final result or polling is **Strong support**, **Undecided**, or **Strong oppose**. Were you contacted alone does not keep the row. Priors with no support answer are hidden, and change is recomputed from the latest prior that still has one. A PDI match alone does not keep the row, and talking to the correct person with a blank survey is dropped. Older snapshots that left canvass, polling, or Were you contacted empty are hydrated from `call-survey-fill.json` on load; a QC tag refresh persists those labels and drops empty calls from `recontact-pairs.json`. Filters are independent groups: **Channel** (Phone / Canvass / Text), **Outcome** (Held / Strengthened / Softened / Flipped / No Reply), **Match** (Unmatched / No PDI), and a **Canvasser** dropdown (canvass-prior actor; empty = all). Empty group = no constraint; chips in a group are OR, groups combine with AND. **No Reply** is a text prior with no inbound voter message — refresh the QC tag so `hasInboundReply` is stored on the pair (older snapshots omit the flag and do not match). The PDI cell shows the voter name and address under the id. Name and address come from the QC callee record (`callees.data`), including split residence fields such as `Contact RES_ADDRESS1` and `Contact RES_ADDRESS2` plus `RES_CITY` / `RES_STATE` / `RES_ZIP`. When the phone name is empty, the matched knock sheet `VOTER` name is used and address stays blank until a QC refresh. Re-uploading knock details backfills `voterName` on existing index rows. Result and polling cells (table, modal, CSV) use generic **Strong support / Undecided / Strong oppose** — never a candidate name. **Were you contacted** shows the recorded Yes / No (or other) answer. **Copy CSV** / **Download CSV** export the visible filter: one row per QC call × prior, with PDI, voter name, address, Were you contacted, change, both sides’ lists/results, and `Used for change` for the latest prior that has a result. Conversation bodies stay in the modal, not the CSV. Refresh the QC tag before name, address, and Were you contacted appear on snapshots saved without those fields.

---

## Project Structure

```
campaign-dashboard/
├── app/
│   ├── page.tsx                         # Landing / mode selector
│   ├── layout.tsx                       # Root layout
│   ├── globals.css
│   ├── texting/
│   │   ├── layout.tsx                   # Sidebar candidates from getTextingTags()
│   │   ├── page.tsx                     # Candidate overview for STW Text
│   │   └── [tag]/page.tsx               # Campaign table + contact-tag rollups
│   ├── phonebanking/
│   │   ├── layout.tsx                   # TopNav + Sidebar wrapper
│   │   ├── campaign-tags/               # Shared add/remove candidate editor
│   │   ├── page.tsx                     # Candidate overview grid
│   │   └── [tag]/
│   │       ├── page.tsx                 # Phone bank list for one candidate
│   │       └── [campaignId]/
│   │           └── page.tsx             # Phone bank detail (chart + table)
│   ├── canvassing/
│   │   ├── overview/                    # Unique ID Overview (phone + text + knocks)
│   │   ├── doorknocks-results/          # Doors / contact / support workbook
│   │   └── non-contact-patterns/        # Rapid non-contact flags
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
    ├── unique-ids/                      # Unique ID Overview collect / tally
    ├── qc-recontact/                    # QC vs phone-bank / canvass PDI pair builder
    ├── types.ts                         # All TypeScript types
    └── queries/
        ├── phonebanking.ts             # Dialer BQ queries
        ├── qc-recontact.ts             # QC recontact BQ + snapshot load
        ├── unique-id-contacts.ts       # Phone/text unique-ID snapshots
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
| `l11_stw_txt.campaign_contacts` | Contact-count fallback; Recontacts text priors |
| `l11_stw_txt.campaign_contact_tags` + `tags` | Support / moved tag rollups; PDI Text Syncer flag source; Recontacts text outcomes |
| `l11_stw_txt.campaign_contacts.data` | PDI person ids for Text Syncer and Recontacts (`v1_pdiid` / `pdi_id` / `PDI ID`) |
| `l11_stw_txt.messages` | Recontacts conversation thread (modal), “was texted” / texter identity, and inbound count for No Reply |
| `l11_stw_txt.users` | Texter `full_name` on outbound messages |

The queries are TypeScript ports of:
- `pdiv3/campaign_hours_dials.py` → campaign-level stats
- `pdiv3/phonebanker_daily_hours.py` → per-phonebanker session-merged daily stats

---

## BigQuery snapshot cache (tag dashboards)

Heavy tag queries (`fetchTagDailyCallerStats`, `fetchTagPhonebankerQuestionStats`, `fetchTagCallSurveyRowsForFinalFill`) can **merge disk snapshots** with a **narrow live BigQuery window**:

- **Live window:** the last **three** calendar days in `America/Los_Angeles` (today, yesterday, and the day before) — enough to bridge day rollovers cleanly.
- **Stable:** rows with `call_date` **strictly before yesterday** in LA are stored under `data/bq-snapshots/<tag>/` after each successful load.
- **Disable:** set `BQ_SNAPSHOTS_DISABLED=1` to always run full BigQuery (debug).

QC tags (`qc-<candidate>`) also write `recontact-pairs.json` on refresh. That file is the Overview **Recontacts** table: each QC call is paired to the latest prior regular phone bank, canvass knock, and/or STW Text contact for the same callee PDI. Compact text metadata is stored on the pair (`campaignContactId`); the conversation is loaded live in the modal. Regular candidate pages do not load or show this file.

Unique ID Overview stores compact SS / U / SO events at `data/bq-snapshots/<tag>/unique-id-phone.json` and `unique-id-text.json`. Rebuild them from `/canvassing/overview` (**Refresh phone & text**) or from a candidate / all-tag phone dashboard snapshot refresh.

**Manual historical rebuild** (e.g. after STW backfills older dates):

1. Set `CAMPAIGN_DASHBOARD_SNAPSHOT_SECRET` in `.env.local` (required in production).
2. On the candidate tag page, use **Rebuild history** (or `POST /api/phonebanking/bq-snapshot-refresh` with header `x-snapshot-secret` and JSON `{ "tagId": "faizah", "clear": true }`).

On `next dev` only, **Refresh this tag (local)** / **Refresh all tags (local)** skip the secret so you can rebuild snapshots without typing a password. Production still requires `x-snapshot-secret`.

**Scheduled refresh (e.g. 9pm Pacific):** call the same HTTPS endpoint from Cloud Scheduler / cron with the secret; use timezone `America/Los_Angeles` when defining the schedule.

**Dev server:** snapshot files are excluded from webpack’s file watcher (`next.config.ts`) so saving them does not trigger a compile loop. If you change `next.config.ts`, restart `npm run dev`.

---

## Section access password (Canvassing + District Classifier)

Phonebanking, texting, and PDI mapper/syncer keep the existing GCP/PDI credential upload. Canvassing and District Classifier can be locked with a shared staff password:

- Set `CAMPAIGN_DASHBOARD_ACCESS_PASSWORD` on the VPS (long random string, 20+ characters). Leave it unset locally so `next dev` stays open.
- Entering the password once unlocks **both** sections for that browser session (HttpOnly `cd_access` cookie bound to `cd_session`).
- Canvassing and district API routes return `401` until the session is unlocked.
- Failed unlocks: **10 tries per 15 minutes** per session and IP, then “Too many attempts. Try again later.”
- Changing the env password invalidates every existing unlock. Use HTTPS in production and set `CAMPAIGN_DASHBOARD_SESSION_COOKIE_SECURE=1`.

This is a staff door code, not per-user login. Do not commit the password.

---

## Roadmap

| Phase | Feature | Status |
|---|---|---|
| 1 | Phone banking dashboard | ✅ Done |
| 2 | Unique ID Overview + knock index | ✅ Done |
| 2 | Canvassing — Knock Analysis / Doorknocks CSV upload | ✅ Done |
| 3 | Google Drive folder auto-ingest | 🔜 Planned |
| 4 | PDI Mapper (embedded in dashboard) | 🔜 Planned |
| 4 | PDI Syncer with live log stream | 🔜 Planned |
