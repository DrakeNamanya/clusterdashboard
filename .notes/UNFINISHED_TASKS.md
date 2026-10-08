# Unfinished Tasks (deferred, to finish later)

## 1. Central Cluster (Mukono, Buikwe, Kayunga) — production SHG/profiler gap
- SYMPTOM: /production shows 0 unique SHGs for central; CF payment report A6
  (youth in production) = 0 for central cluster.
- ROOT CAUSE: source-data gap, NOT a code bug. Central production records have
  shg_id 100% blank, profilers_name 100% blank. Participants (1,562) exist but
  have NO SHG linkage/profiler in ANY feed (production form carries no
  shg_id/shg_name; not in participants/profiling feeds; not in dim_profile).
- FIX NEEDED (M&E side): profile central-cluster participants + register their
  SHGs in the MIS. Then production_rows refresh will populate shg_id/profiler
  automatically (refresh_production_rows joins participants->profiling by refID).
- No code change possible until source data exists.

## 2. VM cron — keep distribution participant feed fresh
- SYMPTOM: late-Sept/Oct poultry distribution was missing because the OData
  participant feed (distribution_form_v2.participants_shg_odata_view) was stale;
  events synced but participant children did not, so distribution_rows produced
  no rows for them.
- ONE-TIME FIX DONE this session: re-synced participant tail + rebuild.
- DURABLE FIX NEEDED: ensure the VM cron calls, each cycle:
    /api/distribution-odata/sync?feed=events
    /api/distribution-odata/sync?feed=participants (paginated to end)
    /api/distribution-odata/sync?feed=shg
    /api/distribution-odata/sync?feed=rebuild
  Confirm the cron's skip pagination reaches the CURRENT feed total (it grows).
- Also recurring: isla_form double-sync (mis:+odata:) — de-dup fix applied in
  refresh_isla_final_rows; consider stopping the mis: isla sync on the VM.
