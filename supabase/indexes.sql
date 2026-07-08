-- ============================================================================
-- records table indexes — cut refresh/import CPU & RAM on small compute tiers.
--
-- The whole app stores every master sheet in ONE table:
--     records(id, template text, data jsonb, ...)
-- Every refresh_*() and import dedup scans this table filtered by `template`
-- and by JSONB keys (refID, shg_participant_id, pdn_level, shg_id). Without
-- indexes each of those is a full sequential scan of ~1.5M JSONB rows, which
-- is what exhausts a t4g.nano. These indexes make the scans targeted.
--
-- Uses IF NOT EXISTS so it is safe to re-run. (Plain CREATE INDEX, not
-- CONCURRENTLY, so it can run inside the RPC/DDL session; it takes a brief
-- lock but the tables are not under write load during a maintenance apply.)
-- ============================================================================

-- 1) Filter by template (used by EVERY query/refresh/import).
create index if not exists records_template_idx
  on public.records (template);

-- 2) Dedup + join key: refID per template (participants, profiling, isla, etc.)
create index if not exists records_template_refid_idx
  on public.records (template, (data->>'refID'));

-- 3) Production/Sales join key: shg_participant_id (only where present).
create index if not exists records_prodmkt_partid_idx
  on public.records ((data->>'shg_participant_id'))
  where template = 'production_and_marketing_tool';

-- 4) Production/Sales split filter: pdn_level (production vs marketing).
create index if not exists records_prodmkt_pdnlevel_idx
  on public.records ((data->>'pdn_level'))
  where template = 'production_and_marketing_tool';

-- 5) participants shg_id -> profiling refID join.
create index if not exists records_participants_shgid_idx
  on public.records ((data->>'shg_id'))
  where template = 'participants';

-- 6) dedup key for the trainees/agrihub style tables that dedup on _id / docId.
create index if not exists records_template_docid_idx
  on public.records (template, (data->>'docId'));

-- Let the planner see the new indexes immediately.
analyze public.records;
