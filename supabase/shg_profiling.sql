-- ============================================================================
-- SHG PROFILING AND GROUP STATISTICS dashboard
--   Fact  : shg_groups_view (Shg_group review)  — one row per SHG group
--   Lookup: Dim_SHG  = SUMMARIZE(shg_profiling_form, refID, shg_name,
--                                 "profilers_name", MAX(Profilers_name))
--   Join  : shg_groups_view[SHG ID] = Dim_SHG[refID]   (a.k.a. _shg_id)
--   profiler in the table = RELATED(Dim_SHG[profilers_name])
--
-- Table columns (per image):
--   SHG Name, First district, Sum of Male, Sum of Female, Sum of PWD,
--   Sum of Participants Trained, Sum of Total, First profiler (profilers_name),
--   First trainings
-- KPI cards (VS comparison, both honour the same slicers + date range):
--   NewSHGs_Profiles = # profiling records (Dim_SHG) profiled in the window
--   Monthly_SHGs     = # SHG groups (shg_groups_view) created in the window
-- Slicers: District (list), profiler_name (list), Date range (dateCreated),
--   numeric range on Sum of Total (1..N).
-- ============================================================================

-- ---- Denormalized fact: one row per SHG group, enriched with profiler -------
drop table if exists public.shg_profiling_rows cascade;
create table public.shg_profiling_rows (
  shg_id              text,   -- shg_groups_view[SHG ID]  (= Dim_SHG.refID)
  shg_name            text,   -- shg_groups_view[SHG Name]
  district            text,   -- First district
  subcounty           text,
  male                int,
  female              int,
  pwd                 int,
  participants_trained int,
  total               int,
  trainings           text,   -- First trainings
  no_trainings        int,
  group_status        text,
  profiler_name       text,   -- RELATED(Dim_SHG[profilers_name])
  profile_shg_name    text,   -- Dim_SHG[shg_name] (profiling side name)
  created_date        date    -- shg_groups_view[dateCreated]
);
create index shg_profiling_rows_district_idx on public.shg_profiling_rows (district);
create index shg_profiling_rows_prof_idx     on public.shg_profiling_rows (profiler_name);
create index shg_profiling_rows_date_idx     on public.shg_profiling_rows (created_date);
create index shg_profiling_rows_total_idx    on public.shg_profiling_rows (total);
grant select on public.shg_profiling_rows to anon, service_role;

-- ---- Rebuild ---------------------------------------------------------------
-- Dim_SHG is materialized inline via a grouped CTE over shg_profiling_form.
create or replace function public.refresh_shg_profiling_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.shg_profiling_rows;

  with dim_shg as (
    -- SUMMARIZE(shg_profiling_form, refID, shg_name, MAX(Profilers_name))
    select
      nullif(trim(p.data->>'refID'),'')            as ref_id,
      max(nullif(trim(p.data->>'shg_name'),''))    as shg_name,
      max(nullif(trim(p.data->>'Profilers_name'),'')) as profilers_name
    from public.records p
    where p.template='shg_profiling_form'
      and nullif(trim(p.data->>'refID'),'') is not null
    group by nullif(trim(p.data->>'refID'),'')
  )
  insert into public.shg_profiling_rows
  select
    nullif(trim(g.data->>'SHG ID'),'')                    as shg_id,
    nullif(trim(g.data->>'SHG Name'),'')                  as shg_name,
    nullif(trim(g.data->>'district'),'')                  as district,
    nullif(trim(g.data->>'subcounty'),'')                 as subcounty,
    coalesce(nullif(regexp_replace(g.data->>'Male','[^0-9\-]','','g'),'')::int, 0)   as male,
    coalesce(nullif(regexp_replace(g.data->>'Female','[^0-9\-]','','g'),'')::int, 0) as female,
    coalesce(nullif(regexp_replace(g.data->>'PWD','[^0-9\-]','','g'),'')::int, 0)    as pwd,
    coalesce(nullif(regexp_replace(g.data->>'Participants Trained','[^0-9\-]','','g'),'')::int, 0) as participants_trained,
    coalesce(nullif(regexp_replace(g.data->>'Total','[^0-9\-]','','g'),'')::int, 0)  as total,
    nullif(trim(g.data->>'trainings'),'')                 as trainings,
    nullif(regexp_replace(g.data->>'no_trainings','[^0-9\-]','','g'),'')::int as no_trainings,
    nullif(trim(g.data->>'group_status'),'')              as group_status,
    d.profilers_name                                      as profiler_name,
    d.shg_name                                            as profile_shg_name,
    case when (g.data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(g.data->>'dateCreated',10))::date else null end as created_date
  from public.records g
  left join dim_shg d
    on d.ref_id = nullif(trim(g.data->>'SHG ID'),'')
  where g.template='shg_groups_view';

  get diagnostics rows_out = row_count;
  return rows_out;
end;
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
  f as (
    select r.* from public.shg_profiling_rows r, sel
    where (sel.dl is null or r.district = any(sel.dl))
      and (sel.pl is null or r.profiler_name = any(sel.pl))
      and (p_from is null or r.created_date >= p_from)
      and (p_to   is null or r.created_date <= p_to)
      and (p_total_min is null or r.total >= p_total_min)
      and (p_total_max is null or r.total <= p_total_max)
  )
  select jsonb_build_object(
    -- KPI cards (VS)
    'monthly_shgs',     (select count(*) from f),                                  -- SHG groups in window
    'new_shgs_profiles',(select count(*) from f where profiler_name is not null),  -- profiled groups in window
    -- Table rows (one per SHG group)
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
    -- Grand-total row (all filtered rows)
    'total', (select jsonb_build_object(
        'count', count(*),
        'male', coalesce(sum(male),0),
        'female', coalesce(sum(female),0),
        'pwd', coalesce(sum(pwd),0),
        'participants_trained', coalesce(sum(participants_trained),0),
        'total', coalesce(sum(total),0)
      ) from f),
    -- Slicer lists (global) + numeric range bounds
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from public.shg_profiling_rows where district is not null),
    'profilers', (select coalesce(jsonb_agg(distinct profiler_name order by profiler_name), '[]'::jsonb)
                  from public.shg_profiling_rows where profiler_name is not null),
    'total_min', (select coalesce(min(total),0) from public.shg_profiling_rows),
    'total_max', (select coalesce(max(total),0) from public.shg_profiling_rows)
  );
$$;
alter function public.shg_profiling_dash(text[],text[],date,date,int,int,int) set statement_timeout='40000';
grant execute on function public.shg_profiling_dash(text[],text[],date,date,int,int,int) to anon, service_role;

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
