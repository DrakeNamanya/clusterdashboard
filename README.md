# SHG Data Cleaner & Consolidator (Power BI OData Feed)

## Project Overview
- **Name**: SHG Data Cleaner & Consolidator
- **Goal**: Accept uploaded Excel/CSV sheets, auto-detect their template, clean &
  standardize every column to a fixed target schema, append the cleaned records
  to a master table **without duplicating** previously saved rows, and publish
  the master data through an **OData v4 feed** so Power BI can connect and refresh
  automatically.
- **Tech Stack**: Hono + TypeScript on Cloudflare Pages/Workers, **Supabase
  (Postgres) via PostgREST** for storage, SheetJS for in-browser parsing,
  Tailwind CSS UI.

## Storage Architecture (Supabase)
Storage was migrated from Cloudflare D1 to **Supabase Postgres** to eliminate the
per-request statement/parameter limits that were causing `HTTP 503` on large
uploads (Postgres has no such limits, so bulk inserts go through in one request).

- **One table `public.records`**: `(id, template, dedup_key, seq, source_file,
  ingested_at, data JSONB)` with `UNIQUE (template, dedup_key)`.
- **Append-only de-dup**: inserts use PostgREST upsert with
  `Prefer: resolution=ignore-duplicates` — re-uploading the same rows never
  duplicates; the response body returns only actually-inserted rows for an exact
  count.
- **6 flattened views** (`shg_groups_view`, `all_trainees_view`, `agrihubs`,
  `distribution_form_v2`, `participants_shg`, `shg_group`) expose the JSONB as
  clean, exact-named typed columns for Power BI / OData / CSV export.
- **Credentials** are stored as Cloudflare Pages secrets `SUPABASE_URL` and
  `SUPABASE_SERVICE_KEY` (never in code). Local dev uses `.dev.vars` (gitignored).

### One-time setup
Run `supabase/schema.sql` once in **Supabase → SQL Editor** to create the
`records` table + indexes + the 6 views. This is the only manual step; DDL
cannot be run from the sandbox (the Supabase DB password is separate from the
service key and the direct DB host is IPv6-only).

## Supported Templates (6)
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

## Functional URIs
### Web / API
- `GET  /` — web dashboard
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
