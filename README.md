# SHG Data Cleaner & Consolidator (Power BI OData Feed)

## Project Overview
- **Name**: SHG Data Cleaner & Consolidator
- **Goal**: Accept uploaded Excel/CSV sheets, auto-detect their template, clean &
  standardize every column to a fixed target schema, append the cleaned records
  to a master table **without duplicating** previously saved rows, and publish
  the master data through an **OData v4 feed** so Power BI can connect and refresh
  automatically.
- **Tech Stack**: Hono + TypeScript on Cloudflare Pages/Workers, a **three-backend
  storage split** (Neon Postgres + Cloudflare D1 + Supabase), SheetJS for
  in-browser parsing, Tailwind CSS UI.

## Storage Architecture (CockroachDB — single backend)
**All data now lives on CockroachDB Serverless** (`riled-colugo-29765` /
`defaultdb`). Neon (512 MB, filled up) and Cloudflare D1 (used for the Frontliner
cluster, then lost API authorization) have both been **retired**. A per-template
router in `src/store.ts` (`usesNeon()` = Cluster-2, `frontlinerOnCrdb()` =
Frontliner) still exists but every branch resolves to CockroachDB when
`COCKROACH_DATABASE_URL` is set (which it always is in production).

### 1. Cluster-2 dashboards (join-heavy)
**Production, Sales, ISLA, SHG Profiling, Distribution to Participants,
Distribution to SHGs**. Templates: `participants`,
`production_and_marketing_tool`, `shg_profiling_form`, `isla_form`,
`isla_participants`, `youth_profiling`, `shg_groups_view`, `shg_group`,
`participants_shg`, `distribution_form_v2`, `agrihubs`. Stored as JSONB in
`public.records`; 23 PL/pgSQL functions build materialized `*_rows` fact tables
that the dashboards read.
- Accessed via the `pg` (node-postgres) driver over `cloudflare:sockets`.
- `neonQuery()` wraps queries with retry/backoff to survive free-tier cold starts.

### 2. Frontliner cluster
**Frontliners, Cluster Trainings, New Youth** dashboards, sourced from
`all_trainees_view` + `reach_targets`. Records are **flattened at INSERT time**
into `public.at_rows` (participant-grain); the three dashboards aggregate over
that one table in TypeScript (`clusterTrainings`, `frontlinerDash`,
`newYouthDash`). The `crdbAsD1()` adapter in `store.ts` runs the original
D1/SQLite `at_rows` queries against CockroachDB unchanged (rewrites `?`→`$n`).
- `appendFrontlinerCrdb` / `appendTargetsCrdb` do chunked multi-row `INSERT …
  ON CONFLICT`, so `all_trainees_view` (hundreds of thousands of rows) uploads
  without the old D1 HTTP-503.

### 3. Supabase (Postgres) — overflow / spare
Still configured (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) as a fallback for any
template not routed to CockroachDB; not used by the live dashboards.

### Common storage pattern
- `public.records` `(template, dedup_key, seq, source_file, data JSONB,
  created_at)`, `UNIQUE (template, dedup_key)`, upsert with ignore-duplicates.
- `public.at_rows` + `public.reach_targets`, `ON CONFLICT DO NOTHING` on the
  `dedup_key` primary key.
- Re-uploading the same rows never duplicates.

### Refresh model (important)
Uploading to a master sheet does **not** auto-update the dashboards — the
materialized `*_rows` fact tables must be rebuilt. After an upload the web UI
calls `/api/refresh-all?only=<cluster>` **once per cluster** (CockroachDB's slow
free tier means one refresh per request keeps each call within the Worker time
limit). You can also click **Rebuild dashboards** on the home page any time.

### CockroachDB free-tier limit
CockroachDB Serverless free tier = **50M Request Units/month**. Heavy migrations
+ frequent refreshes can exhaust it, after which the cluster is disabled until
the cycle resets or a spend limit is raised in the CockroachDB Cloud console.

## Supported Templates (11)
Detection is automatic (by column fingerprint + filename hint). Each maps to a
fixed output schema and a master table.

| Template key           | Spec sheet name        | Dedup key | Notes |
|------------------------|------------------------|-----------|-------|
| `shg_groups_view`      | Sheet 1: Shg_group review   | `_id` | adds computed `No` sequence column |
| `all_trainees_view`    | Sheet 2: All_trainees_view  | `_id` | |
| `agrihubs`             | Sheet 3: agrihubs           | `_id` | |
| `distribution_form_v2` | Sheet 4: distribution_form_v2 (61 cols) | `_id` | |
| `participants_shg`     | Sheet 5: participant_shg    | `_id` | repairs Excel scientific-notation phones |
| `shg_group`            | Sheet 6: shg_group          | `_id` | |
| `shg_profiling_form`   | shg_profiling_form (50 cols) | `docId` | pulled from an **external OData feed** (not uploaded) |
| `isla_form`            | ISLA_DATA (isla_form_odata_view) | `refID` | ISLA savings fact; **external OData feed** |
| `isla_participants`    | isla_form.shg_participants_odata_view | `refID` | **external OData feed** |
| `participants`         | Profile (participants_odata_view) | `refID` | source for `Dim_Profile`; **external OData feed** |
| `youth_profiling`      | youth_profiling_form_odata_view (79 cols) | `refID` | **external OData feed** |

## Importing from an external OData feed (`shg_profiling_form`)
`shg_profiling_form` is populated by **pulling** from an external OData v4 feed
(Heifer SAYE gateway) rather than by file upload:

- **Feed**: `https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view/shg_profiling_form_odata_view`
  (nested data entity set `.../shg_profiling_form_odata_view`).
- **Auth**: HTTP Basic. Credentials are stored as Cloudflare Pages secrets
  `ODATA_PROFILING_USER` / `ODATA_PROFILING_PASS` (never in code; local dev uses
  `.dev.vars`, gitignored).
- **How**: click **Import shg_profiling_form** on the home page. The browser
  drives a **paginated loop** — it calls `POST /api/import-odata/shg_profiling_form`
  one page at a time (`$top`/`$skip`, 500 rows/page), each page is cleaned and
  appended (append-only dedup on `docId`), and progress is shown live. Re-running
  is safe: existing rows are skipped as duplicates.
- **Source registry**: `src/odataimport.ts` maps a schema key → feed URL + which
  env vars hold its credentials. Additional OData sources can be added there.
- The imported table appears automatically in `/api/stats`, the served OData feed
  (`/odata/shg_profiling_form`) and CSV export, exactly like the upload templates.

## Cleaning Rules Applied
- **Column mapping**: source headers are matched to the target schema (case /
  punctuation-insensitive), reordered to the exact required order, extra columns
  dropped, missing optional columns filled blank.
- **Dates** (`dateCreated`, `activity_date`, `distribution_date`, `submissionDate`,
  `lastUpdated`, `updatedAt`): standardized to ISO `YYYY-MM-DD`
  (e.g. `"Wednesday, 24 June 2026"` → `2026-06-24`).
- **Phone numbers**: repaired from Excel scientific notation (`2.56774E+11` →
  digits), stripped of spaces/dashes, Ugandan `256…` normalized to local `0…`.
- **Integers / numbers**: parsed, thousands separators removed, invalid → blank
  (decimals preserved for quantity fields).
- **Text**: trimmed, internal whitespace collapsed (meaning preserved, casing kept).
- **`No` column** (Sheet 1 only): auto-incrementing sequence, continued across
  appends.
- **Append-only de-duplication**: rows whose dedup key already exists are
  skipped (enforced by the D1 PRIMARY KEY + `INSERT OR IGNORE`, O(1) per row).
  - Most templates dedup on `_id`.
  - **`all_trainees_view` is special**: a participant can be trained many times,
    so a row is a duplicate only when **all real fields match** (participant,
    training_type, activity_date, group, location, etc.). The system-generated
    `_id` is **excluded** from the duplicate check; dedup uses a hash of the 16
    data columns. Identical person+training+date rows collapse to one; genuine
    multi-training rows are kept.

## How to Use (Web UI)
1. Open the app.
2. Drag & drop (or browse) a CSV/XLSX file.
3. The app parses it **in the browser**, detects the template, shows a cleaned
   preview, matched/missing/dropped columns and a confidence score.
4. Click **Clean & Append to Master**. Large files are streamed in batches with a
   progress bar. Duplicates are reported and skipped.
5. Master tables show live record counts; each has **OData**, **Preview**, **CSV
   download**, and **Reset** actions.

## Connecting Power BI
Power BI Desktop → **Get Data → OData feed** → paste the **Service URL**:
```
<your-app-url>/odata/
```
All six master tables appear as selectable entity sets and refresh automatically.

## Navigation & Home overview
- **Right-side sidebar** (Heifer-style): a fixed, collapsible navigation panel on the
  right edge of every page. Each menu item is a normal link, so clicking it opens that
  dashboard **in the same window**. The active dashboard is highlighted (navy edge bar +
  tint). Toggle it with the hamburger; the open/closed state is remembered per browser.
- **Home** (`GET /`): a KPI **overview dashboard** that summarises the headline numbers
  from every dashboard in one screen (Cluster Trainings, Monthly New Youth, Frontliners,
  Distribution to Participants, Distribution to SHGs, SHG Profiling, ISLA, Production,
  Sales). Each panel fetches that dashboard's own API in the browser, so the figures always
  match the source dashboard, and every panel links through to the full dashboard.
- **Data Tools & OData** (`GET /tools`, alias `/upload`): the sheet-upload, OData-import,
  Fill-docId, Rebuild-dashboards and Power BI feed tools (formerly the site root).

## Functional URIs
### Web / API
- `GET  /` — **Home** KPI overview dashboard (all dashboards summarised)
- `GET  /tools` (alias `GET /upload`) — Data Tools: upload / OData import / rebuild / feed
- `GET  /health` — health check
- `GET  /api/schemas` — schema definitions (drives client detection)
- `POST /api/detect` (multipart `file`) — detect template + cleaned preview (no save)
- `POST /api/upload` (multipart `file`, optional `schemaKey`) — single-request clean+append (≤ 3000 rows)
- `POST /api/append` (JSON `{schemaKey, headers, rows[], sourceFile, startSeq}`) — chunked clean+append (used for large files)
- `GET  /api/maxseq/:key` — current max `No` sequence (to continue numbering)
- `GET  /api/stats` — record counts + feed links per table
- `GET  /api/data/:key?top=&skip=` — browse cleaned master rows (JSON)
- `GET  /api/export/:key.csv` — download a master table as CSV
- `POST /api/reset/:key` — clear a master table

### Dashboards (Power BI parity)
- `GET  /cluster-trainings` — Cluster Trainings dashboard
- `GET  /monthly-new-youth` — Monthly New Youth dashboard
- `GET  /frontliners` — Trainings by Frontliners dashboard
- `GET  /distribution` — **Distribution to Participants** (participants_shg ⋈ distribution_form_v2, grouped by SHG_Name, expandable to participants)
- `GET  /shg-distribution` — **Distribution to SHGs** (shg_group ⋈ distribution_form_v2, grouped by SHG_Group_Name, expandable to individual distribution records)
  - `GET  /api/shg-distribution` — KPIs + grouped table + slicer lists (filters: `districts,materials,units,submitters,suppliers,from,to`)
  - `GET  /api/shg-distribution/options` — lightweight slicer option lists
  - `GET  /api/shg-distribution/detail?shg=` — per-record detail rows for one SHG group
  - `POST /api/shg-distribution/refresh` — rebuild `shg_distribution_rows`
- `GET  /shg-profiling` — **SHG Profiling and Group Statistics** (shg_groups_view ⋈ Dim_SHG). One flat row per SHG group, enriched with the profiler pulled from `shg_profiling_form`. VS KPI cards (NewSHGs_Profiles vs Monthly_SHGs).
  - `Dim_SHG` = SUMMARIZE(shg_profiling_form, refID, shg_name, MAX(Profilers_name)); join `shg_groups_view[SHG ID] = Dim_SHG[refID]`; `First profiler = RELATED(Dim_SHG[profilers_name])`.
  - Table columns: SHG Name, First district, Sum of Male, Sum of Female, Sum of PWD, Sum of Participants Trained, Sum of Total, First profiler, First trainings.
  - Slicers: **District** (list), **profiler_name** (list), Date range (dateCreated), numeric range on Sum of Total.
  - `GET  /api/shg-profiling` — KPIs + table + slicer lists (filters: `districts,profilers,from,to,totalMin,totalMax`)
  - `GET  /api/shg-profiling/options` — lightweight slicer option lists + total range bounds
  - `POST /api/shg-profiling/refresh` — rebuild `shg_profiling_rows`
- `GET  /isla` — **SHGs SAVING IN A CLUSTER (ISLA)** (isla_form ⋈ SHG_ISLA). Table grouped by `shg_name`, enriched with profiler + district from `shg_profiling_form`.
  - **ISLA FINAL** = `isla_form` LEFT JOIN `shg_profiling_form` on `isla_form[shg_id] = shg_profiling_form[refID]` (filtered to `shg_id <> ''`); `Profilers_name`/`District_SHG` = RELATED profiling columns. Materialized as `isla_final_rows`.
  - KPI: **SHG_Saving** = `DISTINCTCOUNT(isla_final[shg_id])` over the filtered rows.
  - Table columns: shg_name, Sum of savings_value, Sum of youth_group_saving, Sum of youth_loans_value_given, Sum of total_fund, Sum of loans, First Profilers_name, First District_SHG (+ grand-total row).
  - Slicers: **District_SHG** (list, incl. `(Blank)`), **Profilers_name** (list); Date range on `activity_date`.
  - `GET  /api/isla` — KPI + grouped table + slicer lists (filters: `districts,profilers,from,to`)
  - `GET  /api/isla/options` — lightweight slicer option lists
  - `POST /api/isla/refresh` — rebuild `isla_final_rows`
- **Dim_Profile** — `SUMMARIZE(participants filtered to name_ip='HEIFER', participant_id, MAX(...))`; materialized as `dim_profile` (RPC `refresh_dim_profile()`). Participant dimension (full_name, district, sex, disability, shg_name) for profiling analysis.
- `POST /api/refresh-all` — rebuild every dashboard summary (optional `?only=cluster,newyouth,distribution,shgdistribution,shgprofiling,isla,frontliners`)

### OData v4 (for Power BI)
- `GET /odata/` — service document
- `GET /odata/$metadata` — CSDL metadata (XML)
- `GET /odata/<EntitySet>?$top=&$skip=&$orderby=&$count=true` — entity feed
  (entity sets: `shg_groups_view`, `all_trainees_view`, `agrihubs`,
  `distribution_form_v2`, `participants_shg`, `shg_group`)

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite). One physical table per template
  (`t_<key>`). Because target column names contain spaces / `@` / `-`, physical
  columns are stored as `c0..cN` with the exact target names reconstructed on
  output; the dedup key value is the table PRIMARY KEY (`_rowid`).
- **Meta columns**: `_ingested_at`, `_source_file` per row (not exported to OData
  entity properties except `_rowid`).
- **Append-only**: uploads never overwrite; only new dedup keys are inserted.

## Known Data-Quality Note
Some `participants_shg` phone numbers arrive already corrupted by Excel as
scientific notation (`2.56774E+11`) **before export**, so trailing digits are
permanently lost at source. The cleaner restores the correct *format* but cannot
recover digits that were never present in the uploaded file. Intact phone columns
(e.g. `shg_groups_view.contact_phone_number`) are cleaned losslessly.

## Large-file handling (no browser freeze)
The browser parses uploads inside a **Web Worker** (`public/static/parse-worker.js`)
and streams rows to the server in 400-row chunks *as they are parsed*. The main
thread never blocks, so very large files (e.g. the 755k-row / 75 MB
`all_trainees_view.xlsx`) upload without the "Page Unresponsive" dialog. CSV files
are streamed line-by-line; XLSX is parsed with SheetJS inside the worker.

## docId auto-fill
`docId` is never left blank when a source value is available:
- `shg_group.docId`, `participants_shg.docId`, `agrihubs.docId` ← `__Submissions-id`
- `distribution_form_v2.docId` ← `unique_id`

This is a fallback: an existing non-empty `docId` in the source is kept as-is;
only blank/missing `docId` values are filled from the mapped source column.

**Backfill for old data:** rows ingested before this rule can be repaired with
the **"Fill docId"** button on the dashboard, or `POST /api/backfill-docid`
(all schemas) / `POST /api/backfill-docid/:key` (one schema). It fills empty
docId cells from the mapped source column in place.

## Power BI / OData connection
Connect Power BI with **Get Data → OData feed** and use the **service root**:
`https://shg-data-cleaner.pages.dev/odata/` (trailing slash). Then pick the
tables you need. All OData responses send `OData-Version: 4.0` and
`Content-Type: application/json;odata.metadata=minimal`, which Power BI requires
to recognize the feed. Individual feeds: `…/odata/<table>` e.g.
`…/odata/all_trainees_view`.

## Upload reliability (no more HTTP 503)
Chunk size adapts to table width (wide tables like `distribution_form_v2` with
61 columns send fewer rows per request), the server retries transient D1 errors
with backoff, and the client retries HTTP 503/5xx per chunk — so large uploads
complete instead of failing mid-way.

## Deployment
- **Platform**: Cloudflare Pages
- **Production URL**: https://shg-data-cleaner.pages.dev
- **OData service (Power BI)**: https://shg-data-cleaner.pages.dev/odata/
- **OData metadata**: https://shg-data-cleaner.pages.dev/odata/$metadata
- **Database**: Cloudflare D1 `webapp-production` (id `f1220816-22fb-4f14-86f4-42413d60186c`)
- **Status**: ✅ Active
- **Last Updated**: 2026-07-03
