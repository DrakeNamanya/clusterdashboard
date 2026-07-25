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

## Storage Architecture (Oracle-hosted Postgres — single backend, via Cloudflare Hyperdrive)
**All data now lives on a self-hosted PostgreSQL 16 server** on the Oracle VM
`51.170.135.225` / `defaultdb`. CockroachDB Serverless (previous backend), Neon
(512 MB, filled up) and Cloudflare D1 (Frontliner cluster) have all been
**retired / are being decommissioned**. The per-template router in
`src/store.ts` (`usesNeon()` = Cluster-2, `frontlinerOnCrdb()` = Frontliner)
now resolves to the Oracle Postgres server when `ORACLE_DATABASE_URL` (or the
Hyperdrive binding) is set — which it always is in production.

### Cloudflare Hyperdrive (production DB connectivity)
The Oracle Postgres server presents a **self-signed TLS certificate**
(`CN/SAN = 51.170.135.225`). Cloudflare's `workerd` runtime verifies the origin
cert against **public root CAs only** and rejects self-signed certs even when
the exact cert is passed as pg's `ssl.ca` (`tlsv1 alert unknown ca`). The fix is
**Cloudflare Hyperdrive** (`shg-oracle-pg`, id `158ed844…`), which terminates
TLS to the origin itself using an uploaded CA bundle (`oracle-postgres-ca`,
`sslmode=verify-ca`) and pools connections. The Worker connects to the local
Hyperdrive endpoint in **plaintext** (`ssl:false`); it never sees the
self-signed cert. `wrangler.jsonc` binds it as `HYPERDRIVE`, and `storeEnv()`
passes the binding through so `newClusterClient()` prefers it in production.
Local `node`/dev still connects directly using the pinned CA in `src/dbcert.ts`.

### MIS-direct sync (live data from Heifer SAYE MIS)
The master sheets are kept fresh by pulling **directly from the Heifer MIS
gateway** (`https://azure.saye-ug.heifer.org/gateway/api/v1`) instead of manual
uploads. Two sync paths:
- **`all_trainees_view`** → flattened into `public.at_rows` (13-col shape).
  Endpoint: `GET /api/mis-sync/run` (cursor in `mis_sync_state`).
- **5 mapped master views** → upserted into `public.records`, deduped on the
  MIS `_id` (stable `uuid:…`). Endpoints: `GET /api/mis-sync/view?key=<schema>`,
  `GET /api/mis-sync/all`, status `GET /api/mis-sync/view-status`
  (cursors in `mis_view_sync_state`). Mapped views:

  | app schema key | MIS view | rows |
  |---|---|---|
  | `shg_groups_view` | `shg_groups_view` | ~4,872 |
  | `isla_form` | `isla_form` | ~9,117 |
  | `youth_profiling` | `youth_profiling_form` | ~114,675 |
  | `shg_profiling_form` | `shg_profiling_form` | ~4,872 |
  | `production_and_marketing_tool` | `production_and_marketing_tool` | ~26,917 |

  Paging is 1-indexed and unstable across pages, so the sync is **idempotent by
  `_id` dedup** — re-fetching the same page never duplicates. `?replace=true`
  (with `startPage=1`) clears the template at the start of a fresh cycle so MIS
  becomes the single source of truth (used to repair duplicates left by the
  earlier manual uploads, which deduped on a different key).

### 5-minute freshness (VM cron) + dashboard rebuild
Cloudflare Pages has **no native cron**, so an external cron on the Oracle VM
(`/home/ubuntu/mis-cron.sh`, `*/5 * * * *`, `flock`-guarded) does two things
every 5 minutes:
1. **Sync** — hits `/api/mis-sync/run` + `/api/mis-sync/all`, advancing every
   cursor by one slice (idempotent; large views converge over several runs).
2. **Rebuild dashboards** — the dashboards read the materialized `*_rows` fact
   tables, **not `public.records` directly**, so a sync alone would leave them
   stale. The cron POSTs `/api/refresh-all?only=<cluster>` for the light
   clusters (`shgprofiling, isla, production, sales, shgdistribution,
   distribution`) every run, and for the heavy ones (`cluster, newyouth,
   frontliners`, 700k+ rows) once per hour (on the `:00`/`:05` tick) to spare
   the DB. Log: `/home/ubuntu/mis-cron.log`.

**Gotcha fixed (Monthly New Youth HTTP 503):** `newYouthDash` streamed every
`at_rows` row (~780k) into the Worker and reduced in TS, which intermittently
blew the Worker CPU/memory budget once the backfill passed ~600k rows. Added a
Postgres-native fast path (`newYouthDashPg`, used on Hyperdrive) that computes
the first-touch model in SQL (CTEs) and returns only aggregated KPIs + by-date
series. Response dropped ~6.5s → ~0.1s and the 503s are gone; numbers unchanged.
`clusterTrainings` was already SQL-aggregated — its numbers simply track the
`at_rows` backfill and finalise as it completes.

**Gotcha fixed (case sensitivity):** MIS returns `pdn_level` as
`'Production'`/`'Marketing'` (capitalized) whereas the old manual uploads used
lowercase. `refresh_production_rows` / `refresh_sales_rows` filtered on the
lowercase literal, so after the MIS sync the Production dashboard rebuilt to 1
row and Sales to 0. Both functions (live on the VM and in
`supabase/production.sql` / `supabase/sales.sql`) now use
`lower(pdn_level) = 'production' | 'marketing'` and rebuild to ~13,153 / ~13,764
rows respectively.

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
- `GET  /api/stats` — record counts + feed links per table (counts all `public.records` templates in ONE `GROUP BY` query to stay within the Worker CPU budget)
- `GET  /api/mis-sync/run?pageSize=&maxPages=` — advance `all_trainees_view` sync one slice (MIS → `at_rows`)
- `GET  /api/mis-sync/status` — `all_trainees_view` sync cursor/progress
- `GET  /api/mis-sync/view?key=<schema>&pageSize=&maxPages=&startPage=&replace=` — advance ONE mapped master view (MIS → `public.records`); `replace=true`+`startPage=1` rebuilds from scratch
- `GET  /api/mis-sync/all?pageSize=&maxPages=&replace=` — advance ALL 5 mapped views one slice each
- `GET  /api/mis-sync/view-status` — per-view sync cursors/progress
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
- `GET  /production` — **Production (Horticulture)** and `GET /sales` — **Sales in Horticulture/Oilseeds**. Both from `production_and_marketing_tool`: production filters `pdn_level='production'`, sales filters `pdn_level='marketing'`, joined to participants + `shg_profiling_form`. Materialized as `production_rows` / `sales_rows`.
  - `GET /api/production` / `GET /api/sales` — KPIs + table grouped by `shg_name` + slicer lists (filters: `districts,valuechains,from,to`); `/options`; `POST .../refresh`.
- `GET  /poultry-sales` — **POULTRY SALES** (`production_and_marketing_tool` filtered `pdn_level='marketing'` **AND** `value_chain='poultry'`, joined to participants + `shg_profiling_form`). Materialized as `poultry_sales_rows` (2,911 rows). RPCs `refresh_poultry_sales_rows()`, `poultry_sales_dash()`, `poultry_sales_options()`.
  - DAX parity: `Marketing_Table = FILTER(production_and_marketing_tool, [pdn_level]="marketing")` restricted to the poultry value chain.
  - KPIs: **Unique Participants** = `DISTINCTCOUNT(shg_participant_id)`, **New Participants** = distinct participants whose `activity_date` month equals their first poultry-marketing month, **Unique SHGs** = `DISTINCTCOUNT(shg_id)`.
  - Table columns (grouped by `shg_name`): Sum of qty_produced, Sum of poultry_sold, Sum of avg_bird_price, Sum of total_poultry_value, Sum of net_poultry, First district_name, First other_poultry, First profilers_name (+ grand-total row).
  - Slicers (filters): **Date range** (`activity_date`), **district** (`districts`), **poultry type** (`poultry`), **profile_name** (`profilers`).
  - `GET  /api/poultry-sales` — KPIs + grouped table + slicer lists (filters: `districts,poultry,profilers,from,to`)
  - `GET  /api/poultry-sales/options` — lightweight slicer option lists
  - `POST /api/poultry-sales/refresh` — rebuild `poultry_sales_rows`
- `GET  /items-not-sold` — **ITEMS NOT SOLD** — participants who **received** an item (distribution) but never reported selling it in the marketing form. `Report_Not_Sold = FILTER(Distribution_Marketing_Matrix, [Has_Sold]="No")`. Base join `participants_shg[__Submissions-id] = distribution_form_v2[_id]`; **ValueChain derived** from the distributed item (Poultry←`livestock_type`, Oil seeds/Horticulture←`crop_type`). Materialized as `items_not_sold_rows` (**22,820 rows / 12,049 participants / 1,414 SHGs**). RPCs `refresh_items_not_sold_rows()`, `items_not_sold_dash()`, `items_not_sold_options()`.
  - Slicers (filters): **Value chain** (`valuechains`), **District** (`districts`), **Days since distribution** (`daysMin`,`daysMax`).
  - `GET  /api/items-not-sold` — KPIs (unique_participants, unique_shgs, total_items) + wide detail table + slicer lists
  - `GET  /api/items-not-sold/options` — lightweight slicer option lists + days bounds
  - `POST /api/items-not-sold/refresh` — rebuild `items_not_sold_rows`
- `GET  /local-leverage` — **LOCAL LEVERAGE (Leverage Contributions by Category)** — from the `local_leverage_fund_contribution_form` OData feed (18,888 rows). The free-text `contribution_kind` column is **NLP-categorised in SQL** (`public.leverage_category(text)`, priority-ordered keyword matching) into 8 buckets: **Venue and Seats · Land Hire and Cultivation · Commitment Fee · Animal Structures and Equipment · Chemicals and Fertilizers · Refreshments · Labour and Transport · Others**. Napkin-style **arch infographic** (central total hub + colour-coded category nodes with icon + UGX amount) plus a detail table. Materialized as `local_leverage_rows`. RPCs `refresh_local_leverage_rows()`, `local_leverage_dash()`, `local_leverage_options()`.
  - Slicers (filters, per client request): **District** (`districts`), **Date range** on `date_created` (`dateFrom`,`dateTo`).
  - `GET  /api/local-leverage` — KPIs (total_amount, total_contributions, categories_count, districts_count) + `by_category` breakdown + detail rows + slicer lists
  - `GET  /api/local-leverage/options` — lightweight slicer option lists + date bounds
  - `POST /api/local-leverage/refresh` — rebuild `local_leverage_rows`
- **Dim_Profile** — `SUMMARIZE(participants filtered to name_ip='HEIFER', participant_id, MAX(...))`; materialized as `dim_profile` (RPC `refresh_dim_profile()`). Participant dimension (full_name, district, sex, disability, shg_name) for profiling analysis.
- `POST /api/refresh-all` — rebuild every dashboard summary (optional `?only=cluster,newyouth,distribution,shgdistribution,shgprofiling,isla,production,sales,poultrysales,itemsnotsold,localleverage,frontliners`)

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
- **Platform**: Cloudflare Pages (project `shg-data-cleaner`, branch `main`, BYOK to drnamanya@gmail.com)
- **Production URL**: https://shg-data-cleaner.pages.dev
- **OData service (Power BI)**: https://shg-data-cleaner.pages.dev/odata/
- **OData metadata**: https://shg-data-cleaner.pages.dev/odata/$metadata
- **Primary DB**: Oracle VM Postgres 16 `51.170.135.225` / `defaultdb`, reached via **Cloudflare Hyperdrive** `shg-oracle-pg` (id `158ed844…`, CA `oracle-postgres-ca`, `verify-ca`)
- **Frontliner D1**: Cloudflare D1 `shg-data-cleaner-production` (id `7c5c130e-c9fb-4f06-ac16-e41ffd0ea290`) — being retired in favour of `at_rows` on Oracle
- **MIS source**: Heifer SAYE gateway `https://azure.saye-ug.heifer.org/gateway/api/v1`; 5-min VM cron keeps master sheets fresh
- **Status**: ✅ Active
- **Last Updated**: 2026-07-24
  - Migrated production DB from CockroachDB to Oracle-hosted Postgres via Hyperdrive (workerd rejects self-signed cert → Hyperdrive terminates TLS).
  - Built MIS-direct multi-view sync (5 master views + all_trainees) with idempotent `_id` dedup and `replace` mode.
  - Fixed duplicate rows (isla_form 17,736→9,117; production_and_marketing_tool 34,648→26,917) and refreshed youth_profiling (35,500→114,675) via replace-mode sync.
  - Batched `/api/stats` counts into one `GROUP BY` query (fixed Cloudflare error 1102).
  - Installed 5-min VM cron for continuous freshness.

### Pending / next steps
- Complete `all_trainees_view` backfill (781,818 MIS rows; VM cron advancing it, currently ~181k in `at_rows`).
- Obtain the Power BI **DAX** from the user to verify dashboard calculations match Power BI exactly (not yet re-shared — do not assume parity).
- Upload `reach_targets`.
- After full validation that all data is on Oracle, **delete the CockroachDB (cockroachlabs.cloud) database** (the overriding migration goal).
