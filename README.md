# SHG Data Cleaner & Consolidator (Power BI OData Feed)

> **Fix 2026-09-01: Production dashboard district case-sensitivity.** The MIS
> stores `District` with inconsistent casing (`JINJA`, `Jinja`, `jinja`,
> `JINJA CITY`). The production dashboard filtered/faceted districts with an
> exact case-sensitive match, so picking "Jinja" missed the `JINJA` uppercase
> rows — Jinja+Jinja City (Aug 1–Sep 1) showed **278** instead of the MIS's
> **~445**. Fixed `production_dash`/`production_detail`/`production_options`
> (in `supabase/production.sql`) to canonicalize the district filter via
> `mel_canon_district()` and dedupe the facet list via
> `mel_canon_district_disp()`. Now returns **447** for that slice, matching the
> MIS. The report dashboard (`mel_report_dash`) and CF premier league already
> canonicalized districts, so no change was needed there.

> **Fix 2026-09-01: Dashboards now refresh every 15 min (was ~45 min).** The
> cron driver only re-derived each dashboard once per 3-slot rotation, so fixes
> and new MIS data took up to ~45 min to appear. The derived-table refreshes are
> cheap SQL (~5s for all of them combined, no gateway cost), so they now run on
> **every 15-min tick**. The heavy MIS *raw pulls* stay rotated across slots to
> respect the Worker CPU limit. The driver is also now **self-updating** (each
> run re-fetches `/api/cron-script` and re-execs if it changed) so future logic
> fixes reach the VM automatically. **One-time action:** re-install the driver on
> the VM once so it picks up the self-update header:
> `curl -s -o /home/ubuntu/mis-cron.sh https://shg-data-cleaner.pages.dev/api/cron-script && chmod +x /home/ubuntu/mis-cron.sh`

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

### Feature 2026-08-26: Merge CF Names tool (`/cf-merge`)
Admin page (padlocked) that folds duplicate spellings of the same Community
Facilitator into ONE canonical name so their numbers add up on every report
(CF Report Card, Premier League, Production League, Payment Report).
- **UI:** search the full CF list, multi-select the spellings that are the same
  person (checkboxes), pick which spelling to keep (radio / dropdown), click
  **Merge selected**. Existing merges are listed with an **Undo** button.
- **API:** `GET /api/cf-merge/candidates?q=`, `GET /api/cf-merge/list`,
  `POST /api/cf-merge/apply {canon, names[]}`, `POST /api/cf-merge/undo {name}`.
- **Engine:** `public.mel_cf_merge(alias_key, canon_key, canon_name)` +
  `mel_cf_merge_apply / _unmerge / _list` (supabase/mel_cf_merge.sql).
  `mel_refresh_activity_person()` canonicalises every activity name-key through
  `mel_merge_canon()` BEFORE resolving, so the merge applies uniformly across
  training / profiling / production / sales / isla / leverage; the universe then
  shows one row (its `nm` = the chosen canonical name, via `mel_merge_name()`).
  Durable — survives every sync + refresh (it lives in a table, not the data).
- Note: the automatic resolver already unifies many cases (e.g. *Praise* +
  *Praise Joan* both resolve to one registered person → Premier League shows a
  single "Praise Joan" with 17 groups). The tool is for the cases it can't
  safely auto-merge (e.g. *Lunkusejoanitah* vs *Joannelunkuse*).

### Fix 2026-08-26: MIS edits now propagate (Task M membership + Task P profiler rename)
Two related bugs, both rooted in the sync/derivation layer never reflecting
**edits made in place in the MIS** (same record `_id`, a changed field):

- **Task M — membership undercount.** `/shg-profiling` total membership did not
  match the MIS youth profiling form (e.g. *Katente poultry farmers - Mukono*:
  MIS ~30, dashboard 9). Cause: `shg_profiling.sql` trusted the pre-aggregated
  `shg_groups_view.Total` whenever it was `> 0`, even though that view **lags**
  the actual youth-profiling roster. Fix: membership is now
  `GREATEST(view figure, youth roster count)` per field (male/female/pwd/total),
  so the more-complete source wins. Katente now shows 31 (matching the MIS),
  and the fix corrected ~1,325 groups whose view Total was stale-low without
  regressing the minority whose roster was mid-sync.
- **Task P — profiler rename not propagating.** Renaming a profiler in the SHG
  profiling form (e.g. *kaudah catheline / lunkuse → simawo david*) never
  reached `production_rows` / `distribution_rows` / the CF universe, so
  `cf-production-league` kept showing the old name. Cause: the MIS view sync was
  **insert-only** (`ON CONFLICT (template, dedup_key) DO NOTHING`), so an edited
  record (same `_id`) was silently skipped and the old `data` kept forever. Fix:
  MIS view syncs now **upsert** — `DO UPDATE SET data = excluded.data …
  WHERE records.data IS DISTINCT FROM excluded.data`. Only genuinely-changed
  rows are rewritten (no thrashing of static rows), and the downstream refreshes
  (`refresh_production_rows`, `refresh_distribution_rows`, `mel_refresh_cf_all`)
  then carry the new name through on their existing cron rotation. This also
  fixes ANY edited field (membership corrections, district fixes, etc.), not
  just profiler names.

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

### at_rows dedup key — stored-columns-only (contamination fix, 2026-08-02)
`public.at_rows` stores only 13 columns; its `dedup_key` **must** be derived
only from columns that are physically stored. Historically the key hashed 16
fields, 8 of which are NOT stored (`participant_name, subcounty, Parish,
Village, Disability_status, Employment_status, Employment_sector,
Do_for_living`). Those text fields are formatted differently by the MIS gateway
vs. the client's Excel export, so the SAME real training event produced a
DIFFERENT `dedup_key` per source → `ON CONFLICT` never fired → duplicate rows.
A full-Excel bulk load on top of gateway rows inflated `at_rows` from ~768k to
1,102,649 (~319k duplicates) and pushed "Youth Trained" from 99,050 → 99,119
on contaminated data.

**Fix:** `dedupKeyFor()` in `src/store.ts` now special-cases `all_trainees_view`
via `traineeStoredKey()`, keying only on the STORED business identity
(`participant_id, training_type, day[YYYY-MM-DD], data_collector, group_id`,
prefix `a:`). Gateway and Excel rows now dedup consistently → no recontamination.

**Recovery performed:** safety copy `at_rows_bak_20260802` (1,102,649 rows) →
`TRUNCATE at_rows` → clean rebuild from the authoritative Excel export
(`all_trainees_view.xlsx`, 813,999 rows) via `scripts/ingest_xlsx.py`. Result:
**789,275 distinct events, 98,752 distinct participants (= Youth Trained)** —
matching the file ground-truth (~98,687 participants). The gateway freshness
pass now only adds genuinely-new latest rows going forward.

### trainees_v2 — TRUE trainees table from the attendance OData feeds (NEW)
The legacy `all_trainees_view` is a *derived* view. The real source is the
**attendance registration** forms, exposed as 4 OData feeds (parent header ⋈
child participants, for two form versions):

| feed | rows | role |
|---|---|---|
| `attendance_registration_form_v2_odata_view` | 54,296 | v2 event header (83 cols) |
| `attendance_registration_form_v2.shg_participants_odata_view` | 751,258 | v2 participants (12 cols) |
| `attendance_registration_form_odata_view` | 3,708 | v1 event header (53 cols) |
| `attendance_registration_form.shg_participants_odata_view` | 53,854 | v1 participants (12 cols) |

- **Join:** `child."__Submissions-id" = parent.docId`. **Union:** v1 + v2.
- **Grain:** one row per participant-attendance → `public.trainees_v2`.
- **Why it's better:** the parent header carries the per-training detail the
  derived view lacks — **cornerstone_training, psrp, vbhcd, isla, crop_mgt,
  incubation_services, agrihub_training, sacco_training, tot_training,
  gender_safeguarding** — plus location to village level.
- **Counting rules:** *Cluster attendances* = `COUNT(*)` (a participant may
  attend many trainings in a week). *Youth Trained* = `DISTINCT participant_id`.
  *Monthly New Youth* = participant counted once, in the month of their FIRST
  `activity_day` (first-touch).
- **Idempotent key:** `row_key = 'tv2:'+fnv1a(submission_doc_id|participant_id|training_type|activity_day|child_doc_id)` — stored-column-only, cannot recontaminate.
- **Dashboard tab:** `/trainees-v2` (data `GET /api/trainees-v2?districts=&from=&to=&training_type=`).
- **Ingest:** `scripts/ingest_trainees_v2.py` (loads parents into a dict, streams
  children, joins in-sandbox, POSTs to `POST /api/trainees-v2/ingest?token=…`).
  The fetcher retries a flapping gateway forever with capped backoff, and
  enforces a **hard wall-clock deadline per page** (watchdog thread) so a
  trickling/hung socket can't wedge the run; `--skip-start N` resumes a child
  stream. Table DDL: `migrations/0002_trainees_v2.sql`.
- **Status (2026-08-03):** ✅ **FULLY LOADED** — `public.trainees_v2` holds
  **805,109 attendances** (v1_child 53,854 + v2_child 751,255) across
  **99,509 distinct youth**, 12 districts, 30 active months. Parallel/candidate
  source; once user-verified it will replace `all_trainees_view` as the trainees
  source of truth.

### Training Deep-Dive tab + PSRP in the Programme Report (2026-08-03)
Beyond the top-level `training_type`, the attendance form records specific
curricula in **detail columns** (`psrp`, `cornerstone_training`,
`financial_literacy`, `biz_dev_services`). These are space-separated topic lists,
non-empty when the topic was covered — e.g. `psrp = "reflection_planning voting"`,
`cornerstone_training = "_12_cornerstones leadership_training group_dynamics"`.
- **New API:** `GET /api/trainees-v2/details?districts=&from=&to=` →
  `store.ts:traineesV2DetailBreakdown()`. Returns, per **deep type**
  (predicate over the detail columns), unique youth / attendances / female / PWD,
  plus per-district and per-month breakdowns. Deep types (`TV2_DEEP_TYPES`):
  PSRP, Cornerstone (12 cornerstones), Leadership, Attitude & behaviour, Group
  dynamics, Visioning/action planning, Financial literacy, Business development
  services.
- **New tab:** `/trainees-v2/details` (`src/training_details.tsx`, nav key
  `trainingdetails`) — KPI card per deep type, "unique youth by deep type" bars,
  a month-trend line (metric picker), and a by-district × deep-type table. Filters:
  district (multi) + date range.
- **Headline all-time figures:** PSRP 33,680 youth · Cornerstone 64,377 ·
  Leadership 42,951 · Group dynamics 33,380 · Financial literacy 23,706 · BDS 17,280.
- **PSRP now fills the Programme Report** (`programme.ts:psrpByDistrict`, tokens in
  `programmedoc.ts`, table in `programmepage.tsx`) — was a blank "we shall add
  later" placeholder; now sourced from `trainees_v2` per district (youth / female /
  attendances, month + quarter windows).
- **Monthly New Youth v2:** the trainees-v2 tab's month chart *is* the first-touch
  "Monthly New Youth" computed from `trainees_v2` (each participant counted once in
  the month of their first `activity_day`); links to the legacy `/monthly-new-youth`
  chart for side-by-side comparison. All-time first-touch total ≈ 99,506.

### Fixes 2026-08-03 (later): PSRP token wiring + trainees-v2 KPI framing
- **PSRP empty in the report — fixed (preview).** The report page has **two**
  token builders: server-side `programmedoc.ts:buildTokens` (for the .docx) and a
  **client-side `buildTokens()` in `programmepage.tsx`** (for the on-screen preview
  tables). PSRP was added to the server one but not the client one, so the preview
  PSRP table stayed blank. Added the `psrp.{m,q}.{district}.{youth,female,attendances}`
  block to the client builder → preview now fills (Month total ≈ 7,402 youth for the
  Iganga cluster FY window).
  **NOTE:** the Word **template** (`public/static/programme_template.docx`) currently
  has **no `{{psrp…}}` placeholders**, so the *downloaded .docx* cannot show PSRP until
  a PSRP table with those tokens is added to the template.
- **trainees-v2 KPI framing.** Distinct youth (99,509) already matched the legacy
  reported figure (98,757); the confusion was the prominent raw **attendances
  (805,109)** card. Reframed: **“New Youth Reached (counted once)”** is now the
  highlighted headline KPI (first-touch: each participant counted once, in the month
  of their first-ever training, all rows since inception); raw attendances demoted to
  a grey **“Total attendances (sessions, not youth)”** card; info banner added.

### Fix 2026-08-03 (Round D.1): Monthly New Youth — GLOBAL first-touch (Power BI DAX parity)
**Bug:** per-district Monthly New Youth in `/trainees-v2` was inflated (Jinja/Luuka/
Iganga showed **>2,000** new monthly youth; the field expectation — and Power BI —
is **<1,000 for every Iganga-cluster district except Mayuge**). Root cause: in
`store.ts:traineesV2Summary`, `byMonthSql` / `byDistrictSql` / the youth KPIs
computed each participant's first-touch month with `MIN(activity_month)` **within
the filtered slice**. When a district (or date) filter was applied, first-touch was
recomputed **locally**, so a youth first trained in district A then re-trained in
district B was wrongly counted as "new" in B too.

**Fix:** compute first-touch **globally**, matching the user's Power BI measure
`New_Total_Reach` (`DISTINCTCOUNT(participant_id)` filtered to rows where
`activity_date = MIN(activity_date)` under `ALLEXCEPT(all, participant_id)` — i.e.
the participant's earliest date over the **entire** table). Implemented as a
`first_touch` CTE (`ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY
activity_day, child_doc_id)`, `rn=1`) built with **no slice filter**; district /
date / training_type filters are then applied to the first-touch record (`ft.*`).
New KPIs exposed: `new_youth`, `new_female`, `new_pwd` (global first-touch).
`youth_trained` / `female_unique` / `pwd_unique` remain "ever appeared in slice"
and are shown as small sub-lines on the KPI cards. **Verified against live DB:**
IGANGA max-monthly **928**, JINJA **896**, LUUKA **972**, MAYUGE **1,337** — matches
Power BI exactly. All-time first-touch total = **99,506** (≈ 99,509 distinct).

### Fix 2026-08-03 (Round D.2): docx now injects cluster coordinator + AI narrative
**Problem:** the downloaded `SAYE_Programme_Report_*.docx` "came the same way we
uploaded it" for the coordinator, and the narrative was canned. Diagnosis: token
replacement *was* working (0 unfilled `{{tokens}}`), and the numbers *were* landing —
but (a) the **Cluster Coordinator** cell was **hard-coded literal text** in the
template (*Charles Ochom / 0772063030*) with no token, so it never changed with the
selected cluster; and (b) the "narrative" was pre-written template prose with numbers
slotted in, not AI-written.

**Fix:**
- **Coordinator tokens.** Edited `public/static/programme_template.docx`: replaced the
  three literal runs with `{{coord.name}}` / `{{coord.phone}}` / `{{coord.email}}`
  (the revision-author "Charles Ochom" attribute was left untouched). `programmedoc.ts`
  now has a `COORDINATORS` map (iganga→Francis Arinaitwe, bugiri→Ojok Ronald,
  kamuli→Ruth Nabbanja) and fills those tokens from the **selected cluster**. Verified:
  Iganga→Francis, Bugiri→Ojok, Kamuli→Ruth.
- **AI narrative injected into the .docx.** Added a `{{narr.ai_summary}}` paragraph to
  the template's Executive Summary. The `/api/programme-report/docx` route now calls
  `narrate()` (Cloudflare Workers AI, Llama 3.3 70B) **server-side** with the live KPIs,
  and writes the returned prose into that token — so the *downloaded* file contains real
  AI prose, starting from *"Cluster: <X>. Cluster Coordinator: <name>."* as requested.
  Falls back to a deterministic one-liner if the AI call fails (download never breaks).
- Template re-zipped preserving all 44 members / compression; output validated
  (well-formed `document.xml`, `testzip` clean, 0 unfilled tokens).

### Fix 2026-08-03 (Round D.2b): trainees-v2 cards no longer "flicker"
Selecting a district + date fired several `change` events whose `fetch`es resolved
out of order, so the KPI cards were repainted 3–5 times with stale results. Added a
**request-sequence guard** (`_reqSeq`: only the newest request paints), a 180 ms
**debounce** (`scheduleLoad`), `cache:'no-store'`, and an *"updating…"* spinner
(`#tv2Busy`) that dims the cards while a fetch is in flight. The last value shown is
now always the correct one for the current filters.

### Fix 2026-08-04 (Round E): sync data-path errors that froze the dashboard
The VM cron was firing every cycle (service up, `*/5` schedule) but the **freshness
timestamp stopped advancing** because specific scheduled steps failed, so `last_run`
went stale (`live:false`, `age_minutes:210`) and every live-SQL dashboard read old
numbers. Root causes fixed:

- **`refresh shgdistribution` — `column "dist_date" is of type date but expression
  is of type numeric` (E.2, the real code bug).** The live `shg_distribution_rows`
  table's physical column order (qty_* block *after* `dist_date`) differs from the
  `refresh_shg_distribution_rows()` SELECT's expression order (qty_* block *before*
  `partner`/`dist_date`). The function did a **positional** `insert … select` with no
  column list, so numeric qty values shifted onto text/date columns and a numeric
  landed in the `date` column. **Fix:** added an **explicit column list** to the
  INSERT so it maps by NAME regardless of physical order (`supabase/shg_distribution.sql`).
  Re-applied the corrected function to the live DB via `/api/_ddl`. Now rebuilds 938 rows.
- **`invalid input syntax for type bigint: "VBHCD Model"` (E.1).** Same *class* of
  positional-INSERT / column-shift bug. After the shgdistribution fix, no live insert
  path reproduces it: the `run`/`run backfill` at_rows INSERT and the view-sync
  `records` INSERT both use explicit column lists with only 0/1 (bigint) or jsonb
  values — a training-type string can no longer land in a numeric column. Verified by
  hammering `/api/mis-sync/run` and every `/api/refresh-all?only=` job → all `ok:true`.
- **`error code: 1102` (Cloudflare Worker CPU limit) on `run backfill` and the view
  syncs (E.3/E.4).** The slices were too heavy per request. **Shortened** them: the
  cron backfill is now `maxPages=1&pageSize=1000` (was 2×2000), every `view` call is
  `maxPages=1&pageSize=1000`, and `misSyncView`'s defaults dropped to 1000×2 (was
  2000×3). All slot-0/1 view syncs + backfill now return `ok:true`.
- **`/api/frontliners: 503` in warm-cache (E.5).** Transient cold-cache CPU spike on
  the live 814k-row aggregate; with the lighter sync load the warm-cache core now
  returns `200` for both frontliner variants. Self-recovers via `cachedJson`.

**Net effect:** every cron step (`run`, `refresh cluster/newyouth`, `warm-cache(core)`,
plus all slot 0/1/2 heavy work) now succeeds, so `last_run` keeps advancing and
`/api/freshness` stays `live:true` (age ~1–3 min, gap 0).

> **VM action required:** the cron-script text changed (smaller backfill/view slices),
> so on the VM re-download it:
> `curl -s -o /home/ubuntu/mis-cron.sh https://shg-data-cleaner.pages.dev/api/cron-script`

### Programme Report — livestock distribution / re-booking filter fix (2026-08-03)
The Programme Report's **Poultry distribution**, **Goat distribution** and
**Poultry re-booking** tables were rendering empty. Root cause: `distribution_rows`
stores `livestock_type` **lowercase with sub-type suffixes** (`poultry_meat`,
`poultry_local`, `poultry_eggs`, `goat_doe`, `goat_buck`, …), but the queries in
`src/programme.ts` filtered with `LIKE 'Poultry%'` / `LIKE 'Goat%'` (capitalised,
no underscore) → **0 rows matched**. Fixed to case-insensitive
`lower(trim(livestock_type)) LIKE 'poultry%'` / `'goat%'`. Poultry distribution now
reports ~497k birds across the cluster; re-booking (repeat recipients) populates
per district for windowed reports.

### MIS-direct sync (live data from Heifer SAYE MIS)
The master sheets are kept fresh by pulling **directly from the Heifer MIS
gateway** (`https://azure.saye-ug.heifer.org/gateway/api/v1`) instead of manual
uploads. Two sync paths:
- **`all_trainees_view`** → flattened into `public.at_rows` (13-col shape).
  Endpoint: `GET /api/mis-sync/run` (cursor in `mis_sync_state`).
  Bulk backfill from a full Excel export: `scripts/ingest_xlsx.py` →
  `POST /api/mis-sync/ingest?token=…` (streams the sheet, browser UA required —
  Cloudflare edge blocks the default urllib UA).
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

## Supported Templates (12)
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
| `job_tracking`         | combined_job_tracking_tool_view (33 cols) | `_id` | **Youth in Work** master; **MIS view sync**; fact = `job_tracking_rows` |

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
- **Home** (`GET /`): a redesigned **SAYE-style landing dashboard** with its own left
  dark-green sidebar (SAYE Uganda branding, MENU + QUICK ACTIONS, MEL-officer user card),
  a greeting header, and:
  - a **dark hero KPI strip** — 4 tiles (Youth Trained, Female Reached, PWDs Trained,
    Monthly Target) each with a sparkline, plus a circular **Monthly-Pace gauge**. The
    gauge shows this (partial) month's new reach ÷ the previous full month's reach
    (a month-over-month pace indicator, capped at 100%) — a meaningful figure since the
    raw `monthly_target` field is a far-smaller sub-target that cannot be compared to
    actual monthly reach.
  - **8 colour-themed summary cards** (Cluster Trainings, Monthly New Youth, Frontliners,
    Distribution to Participants, Distribution to SHGs, SHG Profiling, ISLA Savings,
    Production) — each with a headline figure + 3 sub-metrics, linking to the full dashboard.
  - **Working filters (Cluster + date):** a **Cluster** dropdown (All / Iganga / Kamuli /
    Bugiri / Central — mapped to district lists), a **Month** quick-picker (pick e.g. "Jul 2026"
    in one click), and **From / To** date inputs. Every filter **applies immediately** — changing
    the cluster, the month, or a date reloads all cards at once (no separate Apply click is
    required; an **Apply** button is still there for convenience). "Reporting year" sets
    Oct 1 2025 – Sep 30 2026; "All time" clears everything. The filters build a shared
    `?districts=&from=&to=` querystring (cache-bypassed with `no-store`) that **every** home-card
    API honours server-side, so picking *Iganga* shows only Iganga-cluster figures and picking
    *July* shows only July figures. A stamp under the KPIs shows the active cluster + range.
    - **No more blank cards on filter:** after all card loaders settle, a failsafe sweep
      converts any value cell still showing the loading skeleton (`…`) — i.e. a loader that
      errored, timed out, or genuinely had no data for the selection — into a real **`0`**
      (or `UGX 0`), so a cluster+date filter never "brings empty cards".
  - a **bottom row**: the **District Race — Participant Target Achievement** panel
    (the old "Performance by District" table and "Trends Overview" line chart are now
    merged into ONE horse-race visualization). **Each district now runs in its OWN lane**
    (a separate horizontal row, ~64 px apart) so the horses are spread out vertically and
    never squeeze on top of each other when their % are close (they used to all sit on one
    shared ground line and pile up). A horse's **horizontal** position still encodes its %
    of the new-youth reach target (0% at the start gate, 100% at the FINISH box), and each
    carries its own **"District · NN%" label** just above it. The data is the **exact same table as the Report dashboard's
    "Reach: Targets vs Achieved"** — the race fetches `/api/report` (`reach` array) and
    **pins the reporting-year window Oct 1 2025 – Sep 30 2026** (the home page's global
    date filter defaults to all-time, which would over-count reach against the Year-3
    target and inflate the %), so the race and that table always agree exactly (e.g.
    Iganga 53% · Jinja 60% · Luuka 72% · Mayuge 80%). Districts with no reach target
    don't race and appear in the legend only. Rendered as an inline SVG via `renderDistrictRace()`. A legend below
    lists exact achieved/target figures and %. Next to it is a **Value Chain Total Sales**
    panel (UGX sold per chain with proportional bars + youth-seller counts; `GET /api/value-chain-sales?districts=&from=&to=`).
  Each panel fetches that dashboard's own API in the browser, so the figures always match
  the source dashboard. Charts use Chart.js. The SAYE sidebar/hero greens were lightened
  (~10%) for readability. *(Production-target and reach-target tables are planned —
  placeholders only for now.)*
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

### AI (Cloudflare Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- `GET  /ai-observation` — **AI Observation** page: anomaly-flag digest + "Ask your data" console
- `POST /api/ai/ask` (JSON `{question}`) — natural-language → guarded read-only SQL → `{question, sql, rows, answer}`. SQL is sanitised (SELECT/WITH only, whitelisted tables, forced `LIMIT ≤ 1000`) before execution against the VM
- `GET  /api/ai/observation` — week-over-week anomaly signals (deterministic SQL) + AI narrative digest; edge-cached 10 min. `{generated_at, window, signals[], digest}`
- `POST /api/ai/narrate` (JSON `{report, kpis}`) — 2-paragraph executive summary; powers the "AI summary" buttons on the Weekly Field Report and Programme Report previews

### Dashboards (Power BI parity)
- `GET  /cluster-trainings` — Cluster Trainings dashboard
- `GET  /monthly-new-youth` — Monthly New Youth dashboard
- `GET  /frontliners` — Trainings by Frontliners dashboard
- `GET  /distribution` — **Distribution to Participants** (per-participant OData feed ⋈ distribution event, grouped by participant, expandable to that participant's allocation lines)
  - `GET  /api/distribution` — KPIs + grouped table + slicer lists (filters: `districts,materials,units,submitters,suppliers,from,to`)
  - `GET  /api/distribution/detail?shg=` — allocation lines for one participant
- `GET  /shg-distribution` — **Distribution to SHGs** (per-SHG OData feed ⋈ distribution event, grouped by SHG_Group_Name, expandable to individual distribution records)

**Distribution data source — DIRECT FROM MIS OData (Aug 2026).** The distribution
dashboards no longer depend on an Excel upload / `/data/filter` sync (which had
gone stale and returned empty). They now pull straight from four MIS OData feeds
(HTTP Basic auth, `/gateway/api/v1/odata-feed/view/<view>/<view>`):
`distribution_form_v2_odata_view` (events), `…shg_group_odata_view` (per-SHG),
`…participants_shg_odata_view` (per-youth), `…agrihubs_odata_view` (empty today).
Join key: master event `docId` (`uuid:…`) == child `__Submissions-id`.
**Data-model note:** a distribution submission is EITHER an SHG-group distribution
OR a per-participant distribution (the two feeds are disjoint on submission_id, so
the participant feed has no SHG-group name); the participants dashboard therefore
groups by the participant, the SHG dashboard by the SHG group.
- Landing tables: `odata_dist_events/shg/participants/agrihubs`.
- Dashboard join tables (unchanged RPC contract): `distribution_rows`,
  `shg_distribution_rows`, `agrihub_distribution_rows`.
- `GET/POST /api/distribution-odata/sync?feed=events|shg|participants|agrihubs|rebuild`
  — one feed per call (participants sliced via `&skip=&limit=`), ending with
  `rebuild`. Driven by the VM cron (step 2b). Latest sync: events 15,461 /
  SHG 1,896 / participants 67,216 / agrihubs 0 → 24,203 participant groups,
  777 SHGs.
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
- `GET  /local-leverage` — **LOCAL LEVERAGE (Leverage Contributions by Category)** — from the `local_leverage_fund_contribution_form` OData feed (~18,900 rows). The free-text `contribution_kind` column is **NLP-categorised in SQL** (`public.leverage_category(text)`, priority-ordered keyword matching using POSIX `\y` word boundaries) into 8 buckets: **Venue and Seats · Commitment Fee · Land Hire and Cultivation · Animal Structures and Equipment · Chemicals and Fertilizers · Labour and Transport · Refreshments · Others** (Others tuned down to ~3.75% — remaining are genuinely unmappable: NA/in-kind, person names, pure numbers, health commodities). Central **wooden-balance infographic** (thin dark-grey outline SVG: horizontal balance beam, crossing diagonal beams, two outward support legs, 6 coloured circular joints with white centres; bold central *Overview of Leverage Contributions* + UGX total) with the 8 categories arranged around it (outline icons + client colour mapping), a filter-aware **District Ranking** bar chart (highest→lowest), and a detail table. Materialized as `local_leverage_rows`. RPCs `refresh_local_leverage_rows()`, `local_leverage_dash()`, `local_leverage_options()`.
  - Slicers (filters, per client request): **District** (`districts`), **Date range** on `date_created` (`dateFrom`,`dateTo`). Both the balance and the District Ranking chart re-render with the filters.
  - `GET  /api/local-leverage` — KPIs (total_amount, total_contributions, categories_count, districts_count) + `by_category` + `by_district` (ranked desc by amount) + detail rows + slicer lists
  - `GET  /api/local-leverage/options` — lightweight slicer option lists + date bounds
  - `POST /api/local-leverage/refresh` — rebuild `local_leverage_rows`
- `GET  /youth-in-work` — **YOUTH IN WORK** — from `combined_job_tracking_tool_view` (MIS view, `job_tracking` template → `job_tracking_rows`, ~79,272 rows). Tracks job-tracked youth by district, employment status **before vs after**, employment status (self-/wage-employed), **Value Chain Engaged**, and **total income**. A youth is counted once at their **latest** record (`DISTINCT ON (participant_id) … ORDER BY submission_date DESC`); *employed* = latest `status_after = 'Employed'`.
  - **Targets** (per user's exact formula): **YiW target = 70% of the district reach target** (`SUM(mel_reach_targets.monthly_target)` per district); **female YiW target = 70% of YiW**; **PWD YiW target = 3% of YiW**. Compared vs **unique employed youth**. Example: Iganga reach target 8705 → YiW target = 0.70×8705 = **6094** (female 4265, PWD 183).
  - Page: KPI strip (youth job-tracked, in-work/YiW, YiW target, self-employed, wage-employed, total income), **target-vs-achieved-by-district** table (reach target, YiW/female/PWD targets, youth tracked, employed, income, **monthly income = income ÷ employed**, % of YiW target), **status before→after** (Chart.js bar **with data labels**), **Value Chain Engaged** (pie **with data labels**, categorised into the 5 chains **Horticulture / Oil seeds / Poultry / Beef / Dairy**), employment-status & nature-of-change tables, district slicer + date range.
  - `GET  /api/youth-in-work?districts=&from=&to=&staff=` → `youthInWorkDash()` (`{kpi, byDistrict (incl. monthlyIncome), statusFlow, employmentStatus, valueChain (5 categories), employedChange, districts}`). Optional **`staff=`** (pipe-joined normalized CF name keys) filters to rows whose `interviewer` matches a CF, using an order-independent sorted-token match — used by the CF Report to show per-CF Youth in Work.
  - `POST /api/youth-in-work/refresh` — rebuild `job_tracking_rows` (`refresh_job_tracking_rows()`).
- **Dim_Profile** — `SUMMARIZE(participants filtered to name_ip='HEIFER', participant_id, MAX(...))`; materialized as `dim_profile` (RPC `refresh_dim_profile()`). Participant dimension (full_name, district, sex, disability, shg_name) for profiling analysis.
- `POST /api/refresh-all` — rebuild every dashboard summary (optional `?only=cluster,newyouth,distribution,shgdistribution,shgprofiling,isla,production,sales,poultrysales,itemsnotsold,localleverage,jobtracking,frontliners`)

### Automated Reports (Targets vs Achieved · Weekly · CF Report Card)
Three automated report deliverables driven by **cluster + date** filters. Cluster
→ district mapping (single source of truth in `src/clusters.ts`):
**Iganga** = Iganga, Jinja, Jinja City, Mayuge, Luuka · **Kamuli** = Kamuli,
Kaliro, Buyende · **Bugiri** = Bugiri, Namutumba, Namayingo, Bugweri ·
**Central** = Mukono, Buikwe, Kayunga. Targets are currently loaded for the
**Iganga cluster only** (from `Targets.xlsx` + `Y3_Season_production.xlsx`);
other clusters show achieved figures with blank targets until their targets are
added.

- `GET  /report` — **Report Dashboard — Targets vs Achieved** (SAYE green theme).
  Compares **Production**, **Reach** and **Mobilization** targets vs achieved,
  per district + a totals row, with progress bars and % achievement pills.
  - **Production achieved** = Youth in Production (`production_rows`, value chains
    Horticulture + Oil seeds) + Livestock Distribution (`distribution_rows`,
    livestock, unit = Number), distinct youth. **Target** = Year-3 production
    target (`mel_production_targets`), with a Season A/B expected-jobs breakdown.
  - **Reach achieved** = New Youth Reached (distinct participant at first training
    date in `at_rows`). **Target** = Year-3 cumulative reach target
    (`mel_reach_targets`, Oct 2025 – Sep 2026); total 30,290.
  - **Mobilization achieved** = SHG Profiling (sum of `total`). **Target** =
    Monthly_SHGs × 25 participants × 12 months.
  - **Default date range = 01 Oct 2025 – 30 Sep 2026** (the reporting year), so
    achieved figures are counted within that window and tie out exactly to the
    source dashboards (`/monthly-new-youth` reach, `/shg-profiling` mobilization).
    Leaving the dates blank previously produced all-time totals that did not match
    the date-filtered dashboards.
  - `GET /api/report?districts=&from=&to=` → `mel_report_dash` RPC (jsonb:
    `reach[]`, `mobilization[]`, `production[]`, `production_seasons[]`, `totals`,
    `date_bounds`).
- `GET  /weekly-report` — **Weekly Report** (Mon → Sun narrative, shared each
  Sunday). Summarises **all indicators per cluster** as "Weekly Highlights":
  Profiling & SHG Formation, Training by Frontliners (broken down by
  `training_type`), Distribution, Production & Marketing, Poultry Sales, Access
  to Finance (ISLA), Leverage Contributions. Defaults to the current Mon–Sun
  week; **This week** / **All time** shortcuts.
  - **Print / colored PDF** button (browser Print → Save as PDF; `@media print`
    preserves colours via `-webkit-print-color-adjust:exact`) and an **M&E
    verification stamp** (circular red "SAYE UGANDA · M & E VERIFIED · date")
    plus sign-off lines at the foot of the report.
  - `GET /api/weekly?districts=&from=&to=` → `mel_weekly_report` RPC.
  - **Youth in Work** section (fetched in parallel from `/api/youth-in-work`):
    youth job-tracked, youth in work (employed), self-/wage-employed, total income,
    and **% of the Youth-in-Work target** (70% of the cluster reach target).
- `GET  /cf-report` — **Community Facilitator (CF) Report Card**. Cluster +
  **field-staff (CF)** + date filters. Report card matching the SAYE design:
  branded header, identity row (Cluster / CF / Report Period / Days), KPI tiles
  (activity areas, youth reached, SHGs reached, value mobilized, overall %),
  an 8-row activity-area table (Trainings, Distribution, SHG Profiling, ISLA,
  Production, Sales Horticulture, Sales Poultry, Local Leverage) with achieved
  figures + performance grade, Key Highlights, and an Overall Performance Grade
  gauge (A–E). CF identity keys on the **real human names** in `profiler_name`
  (profiling) / `profilers_name` (production/poultry/sales/isla) / `submitter_name`
  (leverage). Names are **auto-cleaned (Level-1)** via `mel_norm_name()`:
  lowercase → strip punctuation → collapse whitespace, plus obvious non-person
  entries (`… group`, `… association`, single-word junk) are dropped. This merged
  the Iganga-cluster facilitator list from **312 → 246**.
  - **Trainings & Distribution (squashed-username matching)**: `at_rows.data_collector`
    and `distribution_rows.submitted_by` store **system usernames with no spaces**
    (and occasional `aegy`/`flep` suffixes, e.g. `achamirenejosephine`,
    `akunyobeatricaegy`), so name-based matching used to return **0** for both rows.
    Fixed with `mel_norm_key(txt)` = lowercase → strip non-`a-z` → strip trailing
    `(aegy|flep)`; the CF human name is de-spaced the same way and matched by
    **exact de-spaced key OR (key length ≥ 8 AND collector LIKE key||'%')** to avoid
    short-name false positives. Both rows now populate (e.g. *Rehema Fina Kenzo* →
    316 youth trained / 12 groups / 16 distribution lines).
  - **Per-CF Targets vs Achieved**: each field staff (CF) is graded against fixed
    targets — **16 SHGs profiled**, **min 400 youth** (**70% female**, **3% PWD**),
    **16 SHGs saving**, **400 youth into production**, **all 16 groups trained**.
    The `targets` JSON block is returned by `mel_cf_report`; the card renders a
    **Targets vs Achieved** section (7 rows with progress bars + A–E grades) above
    the **Activity Detail** section, and an **Overall %** = average of the capped
    target percentages. `groups_trained` = `COUNT(DISTINCT group_id)` among the CF's
    matched training rows.
  - **Print / colored PDF** button + `@media print` (preserves colours) and an
    **M&E verification stamp** (circular red "SAYE UGANDA · M & E VERIFIED · date")
    with Field Staff / Supervisor sign-off lines at the foot of the card.
  - **Multi-select merge**: the facilitator picker is a searchable checkbox list —
    tick **several** spelling variants of the same person to merge them into one
    report card. The chosen keys are pipe-joined (`staff=a|b|c`) and `mel_cf_report`
    matches on `mel_norm_name(col) = ANY(keys)` (and `mel_norm_key` for trainings/
    distribution). The card title shows `Name (+N merged)`.
  - `GET /api/cf-report/staff?districts=` → `mel_cf_report_staff` (cleaned
    facilitator list for the cluster, with activity counts).
  - `GET /api/cf-report?staff=&districts=&from=&to=` → `mel_cf_report` RPC
    (`staff` may be a single key or pipe-joined keys for merging).
  - **Youth in Work** is added as a 9th activity row + a target row: *"of the youth
    mobilised, how many are youth in work"* — relates **employed youth**
    (from `/api/youth-in-work`, fetched in parallel and merged into the card) to
    **youth mobilized** (`youth_profiled`), with a % share and grading against the
    Youth-in-Work target.
  - **Distribution & Youth-into-Production fix (2026-07-30)**: the *Distribution to
    Participants* row is now **Distribution to Participants(birds)** = distinct youth
    who received **real birds** (`distribution_rows` where `material_type='Livestock'`
    AND `livestock_type ILIKE '%poultry%'` AND `unit='Number'`) — poultry *feeds*
    (KGs/Grams, stored as `material_type='Other'`) are **not** birds. **Youth into
    Production** = **Youth into Production(horticulture)** (`production_rows`) **+
    Distribution to Participants(birds)**, distinct union, with the breakdown
    (`prod_youth_hort` + `prod_youth_birds`) shown on the card. RPC returns
    `distribution.dist_birds` and `production.prod_youth/prod_youth_hort/prod_youth_birds`.

- `GET  /cf-premier-league` — **CF Premier League** (sidebar `fa-ranking-star`).
  A live league table ranking **every CF in a cluster from #1 (best) to last** by
  an **overall grade = average of 7 CF-report metrics** (all period-filtered, each
  capped at 100), the same metrics graded on the CF Report Card:
  1. **SHGs Saving / SHGs Profiled** (% ratio),
  2. **Youth into Production** (achieved / 400),
  3. **Trainings (first trainings)** = Groups Trained (achieved / 16),
  4. **Youth in Work** (employed youth / (0.70 × mobilized youth)),
  5. **Sales (Poultry)** — **pass/fail** (100 if any birds sold, else 0),
  6. **Sales (Horticulture)** — **pass/fail** (100 if any planting value, else 0),
  7. **Local Leverage** — **pass/fail** (100 if any contribution, else 0).
  Filters: **Cluster + date range**. Gold/silver/bronze medals for the top 3, an
  A–E grade + progress bar per CF, and each of the 7 metrics shown as its graded
  % (or PASS/—) with the raw achieved value below. **Download PDF** = browser
  Print → Save as PDF for the monthly table. Updates live on any filter change.
  - `GET /api/cf-premier-league?cluster=&districts=&from=&to=` → `mel_cf_premier_league`
    RPC (a single **set-based** pass — ~6-8 s for 170+ CFs, vs ~4 min if it called
    the per-CF report in a loop). Each metric ties out exactly to that CF's Report
    Card. Youth-in-Work is matched to the CF via the job-tracking `interviewer`
    field using the same order-independent sorted-token key as the CF card.

- `GET  /programme-report` — **Programme Report (Word generator)**. Sidebar page
  (`fa-file-word`) that produces the Heifer SAYE Monthly/Quarterly Progress Report
  as an **editable Word (.docx)**. Filters: **Cluster** + **Reporting Month** (from/to)
  + **Reporting Quarter** (qFrom/qTo). The template `/static/programme_template.docx`
  carries **581 `{{tokens}}`** (521 data-table cells + 26 `{{narr.*}}` narrative values +
  `{{meta.month|monthname|quarter}}`). Tables with **no clean data source** (PSRP, SACCO)
  and any unmatched value are left blank and **highlighted yellow** for manual entry.
  - **Download is generated SERVER-SIDE** via `GET /api/programme-report/docx` (Worker,
    src/programmedoc.ts + fflate). The Worker loads the template through the `ASSETS`
    binding, replaces **every** token in `word/document.xml` (data tables + KPI summary +
    narrative paragraphs), and re-zips copying all media entries **STORED** (no
    recompression) so only the document XML changes. This replaced the old in-browser
    JSZip path, which stalled re-zipping the 4 MB template so the tables never filled.
    Narrative prose is auto-rewritten to match the tables (e.g. *"ISLA activity in June
    reached 880 savers … UGX 2,314,816 … UGX 1,260,500"*). Monetary `narr.*` values are
    plain numbers because the prose already prints "UGX".
  - **Preview Report** button — opens an on-screen modal that renders every auto-filled
    table as HTML **before** download, using the exact same values written into the
    .docx, so what you read is what you get. Includes a Summary-of-Outreach-Actuals
    block (derived per the guiding document: Female %, PWD %, Rural = reached,
    Refugees = 0), the cluster coordinator contact, and yellow cells for manual entry.
  - **Guiding document** (`docs/programme_report_guiding_document.docx`) supplied by
    the programme team drives the data-source rules. Notably it defines the previously
    blank **poultry re-booking** table = youth who received birds **more than once**
    (received before the window AND again inside it: *unique distributees − new
    distributees*), now computed by `poultryRebookByDistrict()`; and confirms **goat
    distribution** is reported for **Luuka & Kamuli** only.
  - `GET /api/programme-report?districts=&from=&to=&qFrom=&qTo=` → `programmeReport()`
    (src/programme.ts). Runs the district-breakdown queries for BOTH the month and the
    quarter window and returns `{districts, window, profiling{month,quarter},
    training{vbhcd,gender,nutrition,social,life,mental,srh,animal,crop,isla},
    horticulture, poultryDist, goatDist, poultrySales, rebooking, isla, leverage,
    youthInWork{month,quarter}}`. All district matching is case-insensitive. The
    **Youth in Work indicator** (`youthInWork`) carries per-window totals — YiW target
    (70% of reach), youth in work (employed), female YiW target (70% of YiW), PWD YiW
    target (3% of YiW), self-/wage-employed, total income — rendered as a table in the
    on-screen **Preview** and exposed as `{{kpi.yiw_*}}` docx tokens (surface only if the
    template carries the matching placeholders). ISLA **savers** apply the MEL outlier cap
    (per-row `youth_group_saving > 35 → 30`, since a group has 1–35 youth) so a stray
    data-entry outlier can no longer inflate a district (e.g. Luuka June went 16,150 → 79,
    Jinja July 26,515 → 1,241). `savings_value`/`loans_value_given` are monetary and left
    uncapped. Verified vs the printed doc (Gender Iganga 270/148/18, Profiling Iganga
    32 SHGs/465 youth).
  - Data sources per table: training tables ← `at_rows` (by `training_type`);
    profiling ← `shg_profiling_rows`; horticulture (Tomatoes KGs / Watermelon Pieces /
    Sales) ← `sales_rows`; poultry & goat distribution ← `distribution_rows`
    (`livestock_type LIKE 'Poultry%' / 'Goat%'`); poultry sales ← `poultry_sales_rows`;
    ISLA savings ← `isla_final_rows`; leverage ← `local_leverage_rows`.

**ISLA loan/savings rules** (applied in `isla_dash`, `mel_weekly_report`,
`mel_cf_report`): *amount saved* = `SUM(savings_value)`; *loans given (value)* =
`SUM(youth_loans_value_given)`; *youth who got loans* = `SUM(loans)` with each row
capped (>35 → 30 outlier rule); *youth saving* = `SUM(youth_group_saving)` with the
same per-row cap. The outlier cap is applied on the raw activity rows before summing.

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

## Task E — Canonical field-staff / CF-name registry (2026-08-05)
Fixes CF names appearing incompletely (or not at all) on the CF reports — e.g.
*Abubakar (Luuka)* was missing from the CF report, and *Titus (Jinja)* showed
with 0 groups. Root causes: profiling stores SHORT names ("Abubakar","Titus")
that never matched training keys; a CF can own MORE THAN ONE account; and the
registry district can be stale (Titus: registry=Mayuge, data=Jinja).

**3-layer identity model** (all pre-computed caches, sub-second at read time):
- **Layer 1 — Identity**: `field_staff` (878 CFs, from the uploaded HR CSV).
  Authoritative for who-is-who; NOT for district (can be stale).
- **Layer 2 — Alias / merge**: `mel_person` (one row per canonical human) +
  `mel_person_alias` (username/firstname/lastname/fullname/manual/refid keys) +
  `mel_person_merge` (fold duplicate accounts) + `mel_shg_owner_override`
  (transfer an SHG's owner). `mel_refresh_person_registry()` rebuilds it (878).
- **Layer 3 — Activity**: profiling / at_rows / production / sales / poultry /
  isla / leverage, joined THROUGH the alias layer. `mel_resolve_person()` is
  tiered — strong keys (username/fullname) match globally, weak keys
  (firstname/lastname) only within the person's **data-derived** district
  (`mel_person_district`). `mel_refresh_activity_person()` is two-pass (3154).

`mel_cf_universe` now carries `person_id` + `akeys` (every activity key that
rolls up to a person). The reports join a `keymap` CTE (`akeys → canonical nm`)
by **exact** `mel_norm_key`, so reversed names, short names and merged accounts
all roll up to one CF. `mel_refresh_cf_all()` runs the whole chain
(registry → activity resolve → universe) and is what the 15-min VM cron and the
"Refresh identities" button call.

**Verified live**: *Kisira Abubakar* (Luuka) 17 groups / 21 profiled; *Titus
Sebayiga* (Jinja) 4 groups / 146 youth trained / 11 profiled — on the CF Report
Card, CF Premier League and CF Payment Report.

### Field Staff (CF Registry) admin tab — `/field-staff`
Backend control panel for the M&E team to keep the registry correct:
- **People** tab — search every canonical person (account count, data-derived
  districts, activity totals); open a person to **rename**, **merge in** a
  duplicate account, **unlink** an account, add/remove a manual **name key**, or
  **transfer an SHG** to them.
- **Unmatched names** tab — profiler names that resolved to NO person; **fold**
  each into the right CF (fixes the "Abubakar doesn't appear" class of bug).
- **Refresh identities** — runs `mel_refresh_cf_all()`.
Every write re-runs the Task-E chain so the reports update immediately.

JSON API (all under `/api/field-staff/`): `GET people?q=&district=`,
`GET orphans?q=`, `GET person?id=`, `POST add-alias`, `POST del-alias`,
`POST merge`, `POST unmerge`, `POST rename`, `POST transfer-shg`,
`POST untransfer-shg`. SQL lives in `supabase/mel_field_staff.sql`,
`supabase/mel_person_resolve.sql`, `supabase/mel_field_staff_admin.sql`.

## Deployment
- **Platform**: Cloudflare Pages (project `shg-data-cleaner`, branch `main`, BYOK to drnamanya@gmail.com)
- **Production URL**: https://shg-data-cleaner.pages.dev
- **OData service (Power BI)**: https://shg-data-cleaner.pages.dev/odata/
- **OData metadata**: https://shg-data-cleaner.pages.dev/odata/$metadata
- **Primary DB**: Oracle VM Postgres 16 `51.170.135.225` / `defaultdb`, reached via **Cloudflare Hyperdrive** `shg-oracle-pg` (id `158ed844…`, CA `oracle-postgres-ca`, `verify-ca`)
- **Frontliner D1**: Cloudflare D1 `shg-data-cleaner-production` (id `7c5c130e-c9fb-4f06-ac16-e41ffd0ea290`) — being retired in favour of `at_rows` on Oracle
- **MIS source**: Heifer SAYE gateway `https://azure.saye-ug.heifer.org/gateway/api/v1`; **15-min** VM cron keeps master sheets fresh (was 5-min; see batch L)
- **Status**: ✅ Active
- **Last Updated**: 2026-08-02
  - **Overload fix + trainee-gap drain (Phase-3 batch L)**:
    - **Root cause of the "dashboard switching off" (request limit exceeded) AND the frozen "Youth Trained = 99,050":** the same thing — the **MIS gateway is slow and unstable** (a 2000-row page takes 13-19s / ~3MB and, after a few rapid heavy calls, degrades to fast HTTP 500s or >40s hangs). The old **5-minute** VM cron fired the *entire* workload every tick (heavy multi-page trainee pulls + 6 view syncs + 6 distribution OData feeds + ~10 dashboard rebuilds + a full 28-endpoint warm-cache). That request volume tripped Cloudflare's limits (dashboard offline), and because each Worker trainee fetch only had a 25s timeout it usually 500'd/timed-out → `fetched:0, upserted:0` → the KPI froze while **32,556 MIS rows stayed pending** (`at_rows` 767,239 vs MIS 799,773).
    - **Phase 2 — sync hardening (`src/store.ts`):** `misFetchPage` now **retries 3× with backoff on 5xx/timeout** and uses a **40s** timeout (was single-shot / 25s); `misSyncSlice` **paces page fetches** (1.5s between pages) so a slice can't hammer the gateway into its degraded state; added a **cursor-ceiling guard** so the deep-backfill cursor wraps back to page 1 instead of marching forever into unreachable deep pages (a subtle "frozen" cause).
    - **Phase 3 — permanent overload fix (`/api/cron-script` + edge cache):** the cron driver was rewritten to **run every 15 min** and **rotate its heavy work across 3 cycle slots** — every tick does only the cheap must-stay-fresh work (trainee freshness pass + light `cluster`/`newyouth` rebuild + warm just the 2 heaviest caches via the new `/api/warm-cache?only=…` filter), while views, distribution OData, the full rebuild set and the full warm are each assigned to one slot. Net: ~⅓ the requests per tick and roughly 1⁄9 the heavy load, with every dataset still fully refreshed about every 45 min. Edge freshness TTL raised **300→900s** to match the 15-min rotation (fewer stale-triggered background recomputes against the slow VM). **Re-install the cron on `*/15 * * * *`** (note baked into `/api/cron-script`).
    - **Phase 1 — closing the 32k gap (sandbox→ingest drain):** because the sandbox reaches the gateway reliably but the Worker doesn't, a one-time drain (`scripts/drain_trainees.sh`) **fetches each trainee page in the sandbox and POSTs the raw rows** to a new token-gated Worker route **`POST /api/mis-sync/ingest?token=…`** (backed by `ingestTraineeRows` in `store.ts`, which only does the cheap idempotent `at_rows` upsert — no gateway call). ⚠️ **Blocked at time of writing:** the MIS gateway is in a sustained outage (login returns HTTP 000 / TCP won't connect); the drain infrastructure is built + deployed and runs the moment the gateway is reachable again. `scripts/mis_probe.sh` is a quick login health-check.
  - **Home page royal-blue redesign (Phase-2 batch K)**:
    - Restyled the Home dashboard (`src/home.tsx`) to the **"royal-blue-oasis"** Lovable design the client supplied, replacing the previous green brand theme. The palette was ported from the design's oklch tokens to hex and applied through the existing CSS-variable system so every surface re-themes in one place: **primary `#1225a3`**, **primary-deep `#07116b`**, **primary-glow `#3567de`**, soft **accent `#d9e8ff`**, blue-tinted neutrals (bg `#f7f8fc`, ink `#0f1932`, borders `#d7deec`).
    - **Hero KPI band** now uses the design's royal-blue diagonal gradient (`linear-gradient(135deg,#07116b,#1837bd)`) with a soft drop shadow; the four stat icons became translucent-white circles and the sparklines/gauge shifted to light-blue tones for contrast on the dark band.
    - **Summary cards** adopt the design's look — a unified **soft-accent icon tile with a primary-blue glyph**, primary-blue sub-stat figures over a divider, a subtle blue shadow, and a gentle hover-lift.
    - **District Race** horses now cycle the design's blue chart palette (finish/leader marked in primary blue; below-target amber/red status kept for meaning), and **Value Chain Total Sales** rows use accent tiles + primary-blue progress bars. All data wiring (`/api/*` fetches, filters, `data-f` bindings, the horse-race SVG, freshness poll) is unchanged — only the visual layer was re-themed. Verified live on production with real figures (98,639 youth trained) and no console errors.
  - **AI features — Ask your data · report summaries · anomaly digest (Phase-2 batch J)**:
    - **Cloudflare Workers AI wired in** (`"ai": { "binding": "AI" }` in wrangler.jsonc; `env.AI` in `Env`/`storeEnv`). No external API key — the model (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) runs on Cloudflare's edge, 10k neurons/day free. All AI logic lives in `src/ai.ts`.
    - **"Ask your data"** (`POST /api/ai/ask`): a plain-English question → the model writes **one read-only SQL SELECT** grounded in a compact schema catalog of the 10 fact tables (`SCHEMA_DOC`) → the SQL is strictly sanitized (SELECT/WITH only, single statement, forbidden-keyword block, whitelisted tables, forced `LIMIT ≤ 1000`) → executed on the Oracle VM via `neonQuery` → the model answers in prose. Verified live: *"How many SHGs profiled in Jinja?"* → `452`; *"Top 5 CFs by horticulture sales"* → ERIASA SAFI 72.6M … ; *"Which data collector trained the most youth in Mayuge?"* → kisakyefaith 3,979. The console shows the answer plus a collapsible SQL + result table for trust.
    - **AI report narratives** (`POST /api/ai/narrate`): the Weekly Report and the Programme Report preview each gained an **"AI Executive Summary"** button that posts the already-fetched KPI JSON and renders a 2-paragraph professional summary (the client sends the data, so no recompute; the model is told not to invent numbers).
    - **AI Observation tab** (`/ai-observation`, `GET /api/ai/observation`): a new sidebar tab. Week-over-week movements (last 7 days vs prior 7) are **computed deterministically in SQL** across 8 metrics + per-district training drops (so the numbers are trustworthy, never hallucinated), then the model writes a prioritized **anomaly digest** flagging big rises/drops. The page also embeds the "Ask your data" console. Verified live: 14 signals (e.g. Youth trained −77%, Local leverage +266%) + coherent digest. Cached 10 min (`cachedJson` TTL) since it runs several SQL sweeps + a model call.
    - **Latency/safety notes**: the answer step is token-capped and the schema doc steers the model to single-table `GROUP BY/ORDER BY/LIMIT` queries (avoids slow multi-table CTEs) so Ask-your-data returns in ~2s for typical questions. SQL sanitizer in `sanitizeSql()` is the hard guardrail regardless of what the model emits.
  - **Sidebar grouping · CF Premier League A4 fit · AI provider evaluation (Phase-2 batch I)**:
    - **Sidebar tabs grouped into collapsible categories** (`src/nav.ts`): the long flat menu now nests **Distribution** (Distribution to Participants · Distribution to SHGs) and **Sales** (Sales Horticulture/Oilseeds · Poultry Sales · Items Not Sold) under two collapsible category headers, so tabs that used to be pushed off-screen on shorter displays are reachable. A `NavGroup`/`group` model was added: grouped items render indented under a chevron header at the position of the group's first member, every other tab stays independent. A group auto-opens when it holds the active page, the user can toggle any group, and per-group open/closed state is remembered in `localStorage` (`shgNavGrp:*`).
    - **CF Premier League table now fits A4** (`src/cfleague.tsx`): the standings table overflowed the right edge (Sales Horticulture / Local Leverage columns clipped) because 11 columns with verbose auto-width text (e.g. "UGX 37,701,441", "225 in work") exceeded 210mm. Fixed by switching the table to **`table-layout:fixed` with an explicit `<colgroup>` whose widths sum to exactly 100%** (so the table can never exceed the sheet), rendering each metric as a **compact two-line stack** (bold figure + small unit label) instead of a long inline string, right-aligning/no-wrapping the metric columns, abbreviating money (**UGX 38M** instead of UGX 37,701,441), and trimming header/cell font + padding. Verified live: colgroup sums 100%, champion's horticulture sales now render "UGX 38M".
    - **AI provider recommendation** (for the planned in-dashboard AI): evaluated the free-LLM list the user shared. **Recommended primary: Cloudflare Workers AI** (native to this stack — a `AI` binding on the same Worker, no external key to leak, 10,000 neurons/day free, models incl. Llama 3.3 70B, gpt-oss-120b, Qwen) with **Google AI Studio Gemini 2.5/3 Flash-Lite** (500 req/day) or **Groq** (fast Llama 3.3 70B) as fallbacks. Rationale + integration sketch documented in the chat; not yet wired in (pending user go-ahead on which feature to build).
  - **CF trainings bridge · Items-not-sold re-source · Leverage VM-routing · auto-update hardening (Phase-2 batch H)**:
    - **CF "first trainings" now match /frontliners exactly** (was showing 0 youth for staff who had clearly trained hundreds). Root cause: the CF Report Card, CF Premier League and CF staff list all derived trainings from `shg_profiling_rows.participants_trained` and never touched the real training sheet `at_rows`; matching CFs to `at_rows.data_collector` by name failed badly because that column holds squashed single-token usernames (722 distinct, e.g. `christineowono`) that can't bridge spelling variants (`owono` ≠ `offwono`). **New structural bridge (not name-based):** each `at_rows` row is tied to its CF via `at_rows.group_id → shg_profiling_rows.shg_id → profiler_name` (covers 98.2% of groups / 99.76% of trained rows). Every collector is assigned to its **dominant profiler** (`distinct on (data_collector) … order by trained-count desc`, computed globally/unfiltered so the CF identity is stable across report filters). Then per-CF **youth_trained = COUNT of that collector's own `at_rows` rows with `has_date=1`**, exactly matching the /frontliners numbers (e.g. Christine Offwono = **509**, was 0/185).
    - **Word-order name variants merged everywhere** ("Christine Offwono" ⋈ "Offwono Christine"): a **sorted-token canonical key** collapses variants to a single canonical CF (MIN name) so each CF appears **once**. Applied across all three surfaces — `mel_cf_report` (report card), `mel_cf_premier_league` (adds a `canon` CTE + `youth_trained` output; Christine now ONE row, youth 509 / 11 groups, 0 dupes across 751 rows), and `mel_cf_report_staff` (staff picker shows *"Christine Offwono (+1 merged)"* with a `|`-joined key so selecting it auto-merges). This satisfies *"let us fix it on all"*.
    - **Items Not Sold dashboard was empty (0 rows)**: `refresh_items_not_sold_rows` still read the retired Excel `records`/`distribution_form_v2` join (killed when distribution moved to the direct MIS OData pull). Rewrote its `dist` CTE to source from **`public.distribution_rows`** (OData-shaped): splits `qty_received` into per-unit `qty_*` via `CASE` on `unit`, derives `value_chain` (poultry / oil seeds via `seed_g_dot_nut`/`soy`/`gnut`; horticulture via tomato/watermelon/vegetable/passion/onion/pumpkin), still joins marketing `records` for `has_sold`. Now **33,094 rows** (`/api/items-not-sold` `total_items=33,094`).
    - **Local leverage 31st-Friday gap (07-31 contributions missing)**: root cause was **template routing**, not the feed — `local_leverage_fund_contribution_form` was **not** in `NEON_TEMPLATES`, so `appendRecords` wrote leverage records to **Supabase** (which the VM `refresh_local_leverage_rows` never reads) instead of the Oracle VM `public.records`. Added the template to `NEON_TEMPLATES` so leverage now routes to the VM. Also dropped the huge `photo_of_evidence` base64/URL blob from the leverage schema (it blew the Worker request budget → "Network connection lost") and gave leverage a dedicated small-page fresh sweep (`pageSize=500`). 07-31 now shows **UGX 14,633,000** (57 rows); `local_leverage_rows`=19,632; `/api/local-leverage` `total_amount` ≈ 7.01B.
    - **Auto-update wired for every dependent dashboard** (*"All dashboards connected to distribution, shg profiling, leverage, trainings should be updated whenever these main tables get updated"*): the 5-min VM cron (`/api/cron-script`, auto-refreshed each cycle) now (1) syncs `at_rows` fresh + a **deep-cursor backfill slice** (`fresh=0&maxPages=5`, so the 32k older MIS rows finally converge instead of the freshness sweep spinning on page 1), (2) runs a dedicated **leverage** fresh sweep, (2b) rebuilds distribution, (3) refreshes profiling/CF/new-youth (CF report/league compute **live** so they're always current), (3b) **refreshes items-not-sold** after the distribution rebuild, and (4) warms all cached dashboards. Backfill tested: cursor advanced page 1 → 6.
    - **Ops diagnostic routes secured**: `/api/_fn` (dump a function def), `/api/_q` (single-statement read-only SELECT) and `/api/_ddl` (POST raw DDL — the only path to run migrations on the sandbox-unreachable VM) are now all **token-gated** (`?token=…`); without the token they return `403 forbidden`.
  - **Youth in Work refinements (Phase-2 batch G2)**:
    - **Charts now carry data labels** (chartjs-plugin-datalabels): the **status before→after** bar chart prints the youth count on top of each bar; the **Value Chain Engaged** pie prints count + % on each slice.
    - **Value Chain categorised** into the 5 programme chains — **Horticulture · Oil seeds · Poultry · Beef · Dairy**. The raw `value_chain` is a comma-separated multi-select, so a youth is counted toward **each** chain their latest record mentions (via `ILIKE` category patterns); "Other Source Of Income" and blanks are excluded.
    - **Monthly income column** added to the target-vs-achieved-by-district table = **Total income ÷ Employed (YiW)** (per-youth average; e.g. Iganga 965.8M ÷ 2,942 = **UGX 328,289**). Included in the totals row (Σ income ÷ Σ employed).
    - **CF Report – Youth in Work is now per-CF**: `/api/youth-in-work` accepts a `staff=` filter (pipe-joined normalized name keys). The CF card requests YiW filtered to rows whose `interviewer` matches the selected CF — using an **order-independent sorted-token** match (so profiling name "Christine Biribawa" matches interviewer "Biribawa Christine"). The card compares **youth job-tracked/in-work by that CF** against the **youth mobilised by that CF** in SHG profiling, and the per-CF YiW target = **70% of that CF's mobilised youth**.
  - **Youth in Work feature (Phase-2 batch G)**:
    - **New master + dashboard tab**: ingested `combined_job_tracking_tool_view` (81,815 raw → 79,272 after `_id` dedup) via the **MIS view-sync** path (`job_tracking` template → `job_tracking_rows` fact table + `refresh_job_tracking_rows()` SECURITY DEFINER). New sidebar page **`/youth-in-work`** (`fa-briefcase`): KPI strip, target-vs-achieved-by-district table, status before→after chart, Value Chain Engaged doughnut, employment-status & nature-of-change tables, district + date slicers. A youth is counted once at their **latest** record; *employed* = latest `status_after='Employed'`.
    - **Targets** (user's exact formula): **YiW target = 70% of the district reach target**, **female YiW = 70% of YiW**, **PWD YiW = 3% of YiW**, compared vs unique employed youth. Verified Iganga 8705 → YiW **6094** / female 4265 / PWD 183.
    - **Woven into the three reports**: **Weekly Report** gained a Youth in Work section (youth tracked, in-work, self-/wage-employed, income, % of YiW target); **CF Report Card** gained a Youth-in-Work activity + target row answering *"of the youth mobilised, how many are youth in work"* (employed youth vs `youth_profiled`); **Programme Report** gained a `youthInWork{month,quarter}` indicator rendered in the Preview and exposed as `{{kpi.yiw_*}}` docx tokens. All three fetch `/api/youth-in-work` in parallel.
  - **Gender/PWD disaggregation, produce sold, value-chain sales, SHG-size split, professional report redesign (Phase-2 batch F)**:
    - **Female + PWD breakdown across all 3 reports**: Weekly Report, CF Report Card, **and** the Report Dashboard now break every people-count into **female** and **persons-with-disability (PWD)**. Gender is sourced from the participant register (`at_rows.sex`, joined on `shg_participant_id`) since the sales/production/poultry fact rows carry only `disability_status`; SHG-profiling and ISLA rows use their own native `female`/`pwd` columns. Report Dashboard adds Female/PWD columns to the Reach & Mobilization tables plus KPI-card gender chips (e.g. Iganga cluster reach 19,931 → **11,632 female · 825 PWD**; mobilization 23,526 → **13,783 female · 1,007 PWD**).
    - **Weekly – Produce sold in kg/pieces**: Production & Marketing now names the actual horticulture produce moved, e.g. *"Tomatoes: 301,681 kg; Watermelon: 31,079 pieces; Onions: 3,198 kg; …"* (`mel_weekly_report.hs_items` groups by crop + `qty_harvested_measure`).
    - **Weekly – Youth savers surfaced** in Access to Finance (ISLA) — the count of youth saving (`isla.savers`) was already computed but not shown; it now reads *"… from N youth savers"*.
    - **Home – "Value Chain Total Sales"** panel replaces the old Recent Activity feed: UGX sold per value chain with a proportional bar and youth-seller count (Oil seeds 4.45B · Poultry 3.20B · Tomatoes 399M · Watermelon 350M · Onions · Passion Fruit · …). Backed by new `valueChainSales()` (`/api/value-chain-sales`) which sums `sales_rows.total_planting_value` per chain (oil seeds as one chain; horticulture split by first crop name) + `poultry_sales_rows.total_poultry_value`.
    - **CF Report – SHGs profiled split by group size**: SHG Profiling now reports how many profiled SHGs have **<25 members** vs **≥25 members** (`shgs_below_25` / `shgs_25_plus`, updates live as profiling grows). Shown in the activity row and the key-highlights bullet.
    - **Professional redesign (less "AI-generated")**: all three reports now open with a **formal institutional masthead** (SAYE Uganda logo + "Monitoring, Evaluation & Learning" tagline, document-type label, title, and a meta block of cluster / period / generated-date) and close with a **document footer** (prepared-by + data-source attribution). The weekly report's gradient "hero" banner was replaced with a restrained period band; the Report Dashboard gained numbered section headers with rules; the CF card header now carries the SAYE brand block. Print/PDF layouts updated to keep masthead & footer.
  - **Filter responsiveness, weekly distribution, CF SHGs, ISLA loans (Phase-2 batch E)**:
    - **Home filters now visibly refresh on every change**: `loadAll()` used to re-blank only elements still carrying the `.skel` class, but the value loaders strip `.skel` after the first load — so on the 2nd+ Apply/cluster change nothing was re-shown as "loading…" and the dashboard *looked* frozen even though the APIs were re-querying correctly. It now resets **every** `[data-f]` value (and the Performance-by-District table to a "Loading…" row) at the start of each `loadAll()`, so a filter change is always visible. The APIs already filtered server-side (All 96,286 vs Iganga 33,031 vs Kamuli 26,932 new-youth).
    - **Monthly Target no longer shows a bogus 726 for target-less clusters**: when a cluster/district with **no** `mel_reach_targets` rows is selected (Kamuli / Bugiri / Central), the new-youth Monthly Target now returns **0** instead of falling back to the generic single-district default (726) — which had made the card look static. Iganga cluster still shows its real 2,524 (sum of Iganga+Jinja+Luuka+Mayuge monthly targets).
    - **Weekly Report – Distribution to Participants** now names **what was distributed** (material types + counts, e.g. *"Crop (27750), Livestock (9688), Other (7574), Agri Resources (345), Training Materials (45), Isla Kits (6) were distributed to 20,230 participants across 1,707 SHGs"*) instead of the opaque "N distribution lines". (`mel_weekly_report` distribution now carries an `items` string, mirroring the CF report card.)
    - **CF Report Card "SHGs Reached" now equals Groups Trained**: the top KPI tile previously summed profiled + production + ISLA SHGs (e.g. 27 for *Justine Zipporah*); it now reflects the groups the CF actually trained (`training.groups_trained` = 15), matching how the client reads "SHGs reached".
    - **Home "Loans (UGX)" fixed** — it was showing **UGX 16.8k**, which was actually the *count of borrowers* (16,849) mislabelled as money. `isla_dash` now exposes `loans_value` (= Σ `youth_loans_value_given` = **UGX 933.7M**) and the home ISLA card renders that value; the borrower count remains available as `loans`.
  - **CF report accuracy + home district performance (Phase-2 batch D)**:
    - **Trainings now sourced from SHG profiling (first trainings)**: CF "Groups Trained" and "Youth under Trainings" previously read the frontliner `at_rows` sheet, whose `data_collector` is a squashed system username that often failed to match the CF — so many staff showed 0 even when their profiling clearly recorded trainings (e.g. *Nabora Justine Zipporah*). They now derive from the SAME `shg_profiling_rows` the /shg-profiling page uses (matched on the real `profiler_name`): `groups_trained` = SHGs whose `trainings` topic list is non-empty **or** `participants_trained > 0` (so it can never exceed groups profiled), `youth_trained` = SUM(`participants_trained`), `training_areas` = distinct topics. Verified: Justine Zipporah = 15 groups / 387 youth / 10 areas (was 0/0).
    - **Sales (Horticulture) youth sellers** = distinct youth in the marketing sheet whose `value_chain` is **Horticulture or Oil seeds** (Poultry sales belong to the separate Sales (Poultry) block and are now excluded).
    - **Distribution card** now names **what was distributed** (material types with line counts, e.g. `Livestock (18)`) instead of an opaque "N lines".
    - **Home "Performance by District"** now shows the **accumulative new-youth reach** per district (first-touch, from /monthly-new-youth), joined to the **reach targets** (`mel_reach_targets`) with an **Achieved %** column. Iganga cluster verified: MAYUGE 9366/8097 (116%), JINJA 8537/8054 (106%), IGANGA 8116/8705 (93%), LUUKA 6557/5434 (121%). Districts without a target row show "—" (only the 4 Iganga-cluster districts have reach targets so far).
    - **Home filters made reliably responsive**: `fetch(..., {cache:'no-store'})` so a repeated cluster/date selection always re-queries fresh data (was appearing not to respond to the Iganga selection). The new-youth top-line **Monthly Target** is now sourced from `mel_reach_targets` (real per-district monthly targets) instead of the empty legacy `reach_targets` table.
  - **Home dashboard + unified sidebar + print alignment (Phase-2 batch C)**:
    - **Cluster + date filters** on the home dashboard (`#fCluster` All/Iganga/Kamuli/Bugiri/Central, `#fFrom`/`#fTo` date range, Apply / Reporting-year / All-time buttons). Every indicator now responds to the filter selection — the 8 loaders append `?districts=&from=&to=` via `filterQS()`/`api()`; a stamp shows `<cluster> · <range> · updated <time>`.
    - **Monthly Pace** (home gauge): latest month's new reach ÷ previous month's new reach × 100 (a month-over-month momentum indicator, **not** tied to a fixed target). Explained via a UI tooltip on the label.
    - **Monthly Target** (home hero tile): `Monthly_SHGs × 25` participants from the reach-target table (a sub-target, not directly comparable to monthly actuals). Explained via a UI tooltip on the label.
    - **Performance by District** now shows **ALL districts** (removed the top-6 cap).
    - **Unified navy "HEIFER SHG" sidebar** (`src/nav.ts` → `navSidebar(key)`, fixed-right, 264px, `--shg-navy:#0B3C5D`): replaced the home page's green sidebar and added the same sidebar to the Report / Weekly / CF reports so every page runs inside one frame with the sidebar aside.
    - **PDF print alignment fixed**: each report's `@media print` now sets `body.shg-has-nav{ padding-right:0 !important }`, hides `.shg-nav`, and forces `.wrap{ max-width:100% !important; margin:0 !important; padding:0 4mm !important }` (4mm safe padding) so printed reports are no longer shifted left / clipped.
    - **Youth in Production fix** (CF report): now = youth in the **horticulture production form** PLUS youth who **received livestock/birds** in distribution (`distribution_rows.material_type='Livestock'`, de-spaced `submitted_by` match, distinct participant). Example verified: *Mutaisa Karim* = 1 horticulture + 18 livestock recipients = **19 youth** (was showing 1).
  - **CF Report Card (Phase-2 batch B)**: fixed Trainings/Distribution showing 0 (squashed-username `mel_norm_key` de-spaced matching); added per-CF **Targets vs Achieved** (16 SHGs, 400 youth @70% female/3% PWD, 16 saving, 400 into production, 16 groups trained) with A–E grades; added **Print/colored-PDF** button and **M&E verification stamp**. Weekly Report also gained the Print/PDF button and M&E stamp.
  - **Dashboard fixes (Phase-2 batch A)**: lightened home greens; fixed Performance-by-District (`district_stats`) and Trends Overview chart (fixed-height wrapper); defaulted the Report to the reporting year (01 Oct 2025 – 30 Sep 2026) so Reach/Mobilization tie out to the source dashboards; applied ISLA outlier caps (loans / youth_group_saving >35 → 30); cleaned the CF facilitator list 312 → 246 with multi-select merge.
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
