-- ============================================================================
-- SHG PROFILING AND GROUP STATISTICS dashboard   [LIVE VIEW EDITION]
--
--   Fact  : shg_groups_view (Shg_group statistics) — one row per SHG group
--   Lookup: Dim_SHG = FIRST profiler per group, from the SHG PROFILING FORM
--           (shg_profiling_form). The profiler (CF) who profiled a group is
--           matched by:
--                shg_groups_view[_id] == shg_profiling_form[refID]
--           In this data shg_groups_view[_id] == shg_groups_view[SHG ID] for
--           every row, so keying on SHG ID is equivalent to keying on _id.
--   Roster: youth_profiling members (name_ip = 'HEIFER') — authoritative
--           headcount used only where the aggregated view figure lags (=0).
--
-- WHY A VIEW (not a refreshed table):
--   shg_profiling_rows used to be a materialized snapshot rebuilt by a manual
--   "Refresh" click (refresh_shg_profiling_rows). That snapshot kept drifting
--   out of date and dragged every dependent report (weekly report, CF report /
--   payment / premier league, workplan, report dash, programme pace) with it.
--
--   The source tables (shg_groups_view, shg_profiling_form, youth_profiling)
--   are already synced daily into public.records and are always current. The
--   full derivation runs in <1s, so we expose shg_profiling_rows as a LIVE
--   VIEW over those sources. Every dependent report now always reflects the
--   latest synced data with ZERO manual refresh and ZERO drift.
--
--   The view exposes the EXACT same 15 columns the old table had, so every
--   consumer (shg_profiling_dash, shg_profiling_options, mel_weekly_report,
--   mel_cf_report[_v2], mel_cf_premier_league, mel_cf_payment_report,
--   mel_cf_workplan, mel_person_resolve, mel_report_dash, programme.ts, ai.ts)
--   keeps working unchanged.
-- ============================================================================

-- Drop the old snapshot table OR a prior version of the view (and anything
-- depending on it) then recreate as a view with identical column names/types.
-- Use a DO block so it works whether shg_profiling_rows is currently a table
-- (first migration) or already a view (re-apply) — a plain DROP TABLE on a
-- view (or DROP VIEW on a table) errors with "is not a table/view".
do $$
begin
  if exists (select 1 from information_schema.views
             where table_schema='public' and table_name='shg_profiling_rows') then
    execute 'drop view if exists public.shg_profiling_rows cascade';
  else
    execute 'drop table if exists public.shg_profiling_rows cascade';
  end if;
end $$;

create or replace view public.shg_profiling_rows as
with prof_first as (
  -- FIRST profiler per SHG group, taken from the YOUTH PROFILING FORM
  -- (youth_profiling_form_odata_view). The profiler shown in the MIS SHG
  -- group statistics is the "submitterName" of the group's FIRST youth
  -- profiling submission. In our synced records that submitter is
  -- datacollectors_Name (Title_datacollector = "Community Facilitator" etc).
  -- We pick the EARLIEST submission (by dateCreated) per shg_id — mirroring
  -- the MIS FIRST(submitterName). Filtered to Implementing Partner = HEIFER.
  select distinct on (nullif(trim(y.data->>'shg_id'),''))
    nullif(trim(y.data->>'shg_id'),'')                as sid,
    nullif(trim(y.data->>'datacollectors_Name'),'')  as profilers_name
  from public.records y
  where y.template='youth_profiling'
    and upper(trim(y.data->>'name_ip')) = 'HEIFER'
    and nullif(trim(y.data->>'shg_id'),'') is not null
    and nullif(trim(y.data->>'datacollectors_Name'),'') is not null
  order by
    nullif(trim(y.data->>'shg_id'),''),
    case when (y.data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(y.data->>'dateCreated',10))::date else null end
         asc nulls last,
    nullif(trim(y.data->>'_id'),'') asc
),
dim_shg as (
  -- SHG name (profiling side) still comes from the SHG PROFILING FORM;
  -- the profiler is joined in from prof_first (youth-form submitter) above.
  -- FALLBACK profiler: the SHG PROFILING FORM records who profiled the group
  -- in its own "Profilers_name" field (joined by SHG ID = refID). When the
  -- youth-form submitter is missing for a group (no youth submissions synced
  -- yet, or submitter blank), we use this form-recorded profiler instead.
  select distinct on (nullif(trim(p.data->>'refID'),''))
    nullif(trim(p.data->>'refID'),'')               as ref_id,
    nullif(trim(p.data->>'shg_name'),'')            as shg_name,
    pf.profilers_name                               as profilers_name,
    nullif(trim(p.data->>'Profilers_name'),'')      as form_profilers_name
  from public.records p
  left join prof_first pf on pf.sid = nullif(trim(p.data->>'refID'),'')
  where p.template='shg_profiling_form'
    and nullif(trim(p.data->>'refID'),'') is not null
  order by
    nullif(trim(p.data->>'refID'),''),
    case when (p.data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(p.data->>'dateCreated',10))::date else null end
         asc nulls last,
    nullif(trim(p.data->>'_id'),'') asc
),
-- Actual member roster from youth_profiling (one row per profiled member),
-- keyed by shg_id, filtered to Implementing Partner = HEIFER (name_ip).
-- This is the authoritative headcount source: the pre-aggregated
-- shg_groups_view Male/Female/Total lags for freshly-profiled groups
-- (shows 0 while the members are already captured here).
roster as (
  select
    nullif(trim(y.data->>'shg_id'),'')                                       as sid,
    count(*)                                                                 as r_total,
    count(*) filter (where lower(y.data->>'Sex') like 'm%')                  as r_male,
    count(*) filter (where lower(y.data->>'Sex') like 'f%')                  as r_female,
    count(*) filter (where lower(trim(y.data->>'Disability_status'))='yes')  as r_pwd
  from public.records y
  where y.template='youth_profiling'
    and upper(trim(y.data->>'name_ip')) = 'HEIFER'   -- IP filter = HEIFER
    and nullif(trim(y.data->>'shg_id'),'') is not null
  group by nullif(trim(y.data->>'shg_id'),'')
)
select
  nullif(trim(g.data->>'SHG ID'),'')                    as shg_id,
  nullif(trim(g.data->>'SHG Name'),'')                  as shg_name,
  nullif(trim(g.data->>'district'),'')                  as district,
  nullif(trim(g.data->>'subcounty'),'')                 as subcounty,
  -- shg_groups_view Total/Female/Male are AUTHORITATIVE (what the Heifer
  -- portal shows). Use them verbatim; only when the view figure is 0/blank
  -- (freshly-profiled group whose members exist in youth_profiling but the
  -- aggregated view hasn't caught up) do we substitute the roster count.
  case when coalesce(nullif(regexp_replace(g.data->>'Total','[^0-9\-]','','g'),'')::int, 0) > 0
       then coalesce(nullif(regexp_replace(g.data->>'Male','[^0-9\-]','','g'),'')::int, 0)
       else coalesce(rm.r_male,0) end   as male,
  case when coalesce(nullif(regexp_replace(g.data->>'Total','[^0-9\-]','','g'),'')::int, 0) > 0
       then coalesce(nullif(regexp_replace(g.data->>'Female','[^0-9\-]','','g'),'')::int, 0)
       else coalesce(rm.r_female,0) end as female,
  case when coalesce(nullif(regexp_replace(g.data->>'Total','[^0-9\-]','','g'),'')::int, 0) > 0
       then coalesce(nullif(regexp_replace(g.data->>'PWD','[^0-9\-]','','g'),'')::int, 0)
       else coalesce(rm.r_pwd,0) end    as pwd,
  coalesce(nullif(regexp_replace(g.data->>'Participants Trained','[^0-9\-]','','g'),'')::int, 0) as participants_trained,
  case when coalesce(nullif(regexp_replace(g.data->>'Total','[^0-9\-]','','g'),'')::int, 0) > 0
       then coalesce(nullif(regexp_replace(g.data->>'Total','[^0-9\-]','','g'),'')::int, 0)
       else coalesce(rm.r_total,0) end  as total,
  nullif(trim(g.data->>'trainings'),'')                 as trainings,
  nullif(regexp_replace(g.data->>'no_trainings','[^0-9\-]','','g'),'')::int as no_trainings,
  nullif(trim(g.data->>'group_status'),'')              as group_status,
  -- Profiler resolution order:
  --   1. FIRST youth-form submitter matched directly on SHG ID (prof_first pfg)
  --   2. same value carried through dim_shg (d.profilers_name)
  --   3. FALLBACK: the SHG PROFILING FORM's own "Profilers_name" field
  --      (d.form_profilers_name) — recovers groups with no youth-form submitter
  --      by relating SHG ID across both forms, as requested.
  coalesce(pfg.profilers_name, d.profilers_name, d.form_profilers_name) as profiler_name,
  d.shg_name                                            as profile_shg_name,
  case when (g.data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
       then (left(g.data->>'dateCreated',10))::date else null end as created_date
from public.records g
left join dim_shg d
  on d.ref_id = nullif(trim(g.data->>'SHG ID'),'')
left join prof_first pfg
  on pfg.sid = nullif(trim(g.data->>'SHG ID'),'')
left join roster rm
  on rm.sid = nullif(trim(g.data->>'SHG ID'),'')
where g.template='shg_groups_view';

grant select on public.shg_profiling_rows to anon, service_role;

-- ---- Refresh function kept as a NO-OP stub --------------------------------
-- shg_profiling_rows is now a live view, so there is nothing to refresh.
-- The existing "Refresh" button and store.ts still call this; we keep it so
-- those callers do not error, and return the current live row count.
create or replace function public.refresh_shg_profiling_rows()
returns bigint
language sql
security definer
as $$
  select count(*)::bigint from public.shg_profiling_rows;
$$;
alter function public.refresh_shg_profiling_rows() set statement_timeout='120000';
grant execute on function public.refresh_shg_profiling_rows() to service_role;

-- ---- Dashboard aggregate: KPIs + table rows + slicer lists -----------------
create or replace function public.shg_profiling_dash(
  p_districts text[] default null,
  p_profilers text[] default null,
  p_from      date   default null,
  p_to        date   default null,
  p_total_min int    default null,
  p_total_max int    default null,
  p_monthly_target int default 29,
  p_limit     int    default 5000
)
returns jsonb
language sql
stable
as $$
  with sel as (
    select
      case when p_districts is null or array_length(p_districts,1) is null then null
           else p_districts end as dl,
      case when p_profilers is null or array_length(p_profilers,1) is null then null
           else p_profilers end as pl
  ),
  -- Snapshot the live view ONCE per call (materialized) so the underlying
  -- derivation over records is not recomputed for every sub-select below.
  base as materialized (
    select * from public.shg_profiling_rows
  ),
  f as (
    select r.* from base r, sel
    where (sel.dl is null or upper(trim(r.district)) = any(select upper(trim(x)) from unnest(sel.dl) x))
      and (sel.pl is null or r.profiler_name = any(sel.pl))
      and (p_from is null or r.created_date >= p_from)
      and (p_to   is null or r.created_date <= p_to)
      and (p_total_min is null or r.total >= p_total_min)
      and (p_total_max is null or r.total <= p_total_max)
  )
  select jsonb_build_object(
    'new_shgs_profiles',(select count(distinct shg_id) from f where shg_id is not null),
    'monthly_shgs',     coalesce(p_monthly_target, 29),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'shg_name', shg_name,
        'shg_id', shg_id,
        'district', district,
        'subcounty', subcounty,
        'male', male,
        'female', female,
        'pwd', pwd,
        'participants_trained', participants_trained,
        'total', total,
        'profiler_name', profiler_name,
        'trainings', trainings,
        'no_trainings', no_trainings,
        'created_date', created_date
      ) order by shg_name), '[]'::jsonb)
      from (select * from f where shg_name is not null order by shg_name limit p_limit) t),
    'total', (select jsonb_build_object(
        'count', count(*),
        'male', coalesce(sum(male),0),
        'female', coalesce(sum(female),0),
        'pwd', coalesce(sum(pwd),0),
        'participants_trained', coalesce(sum(participants_trained),0),
        'total', coalesce(sum(total),0)
      ) from f),
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from base where district is not null),
    'profilers', (select coalesce(jsonb_agg(distinct profiler_name order by profiler_name), '[]'::jsonb)
                  from base where profiler_name is not null),
    'total_min', (select coalesce(min(total),0) from base),
    'total_max', (select coalesce(max(total),0) from base)
  );
$$;
alter function public.shg_profiling_dash(text[],text[],date,date,int,int,int,int) set statement_timeout='40000';
grant execute on function public.shg_profiling_dash(text[],text[],date,date,int,int,int,int) to anon, service_role;

-- ---- Lightweight slicer option lists only ----------------------------------
create or replace function public.shg_profiling_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from public.shg_profiling_rows where district is not null),
    'profilers', (select coalesce(jsonb_agg(distinct profiler_name order by profiler_name), '[]'::jsonb)
                  from public.shg_profiling_rows where profiler_name is not null),
    'total_min', (select coalesce(min(total),0) from public.shg_profiling_rows),
    'total_max', (select coalesce(max(total),0) from public.shg_profiling_rows)
  );
$$;
alter function public.shg_profiling_options() set statement_timeout='20000';
grant execute on function public.shg_profiling_options() to anon, service_role;
