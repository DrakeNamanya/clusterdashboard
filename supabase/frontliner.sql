-- ============================================================================
-- Trainings by Frontliners — per data_collector summary.
-- Mirrors the Power BI "TRAININGS" table:
--   PWDs_Trained     = DISTINCTCOUNT(participant_id) where Disability='Yes'
--   Female_Reached   = DISTINCTCOUNT(participant_id) where sex='Female'
--   Youth_Trained    = DISTINCTCOUNT(participant_id) (has activity_date)
--   Groups_Reached   = DISTINCTCOUNT(group_id)
--   Training_Types_ListY = distinct training_type, sorted, joined by ", "
--   Group_Names_ListY    = distinct group_name, sorted, joined, truncated to 100 chars + "..."
--   First district       = one district for the collector (deterministic min)
--
-- To keep it fast + disk-friendly we pre-aggregate to a participant-grain table
-- (frontliner_rows) which is scanned by a light RPC with district/date filters.
-- ============================================================================

-- Participant-grain: one row per (data_collector, participant_id, group_id, training_type, day, ...)
drop table if exists public.frontliner_rows cascade;
create table public.frontliner_rows (
  data_collector text,
  participant_id text,
  group_id       text,
  group_name     text,
  training_type  text,
  district       text,
  day            date,
  sex            text,
  is_pwd         boolean,
  has_date       boolean
);
create index frontliner_rows_dc_idx  on public.frontliner_rows (data_collector);
create index frontliner_rows_day_idx on public.frontliner_rows (day);
create index frontliner_rows_dist_idx on public.frontliner_rows (district);

grant select on public.frontliner_rows to anon, service_role;

-- Dashboard RPC: aggregate per data_collector, honouring district + date filters.
-- NOTE: KPIs use plain COUNT (row/attendance based), NOT DISTINCTCOUNT — a
-- participant can attend more than one training, so each attendance counts.
create or replace function public.frontliner_dash(
  p_districts  text[] default null,
  p_from       date   default null,
  p_to         date   default null,
  p_collectors text[] default null,   -- optional data_collector filter
  p_limit      int    default 1000
)
returns jsonb
language sql
stable
as $$
  with sel as (
    select
      case when p_districts is null or array_length(p_districts,1) is null
           then null
           else (select array_agg(upper(x)) from unnest(p_districts) x) end as dl,
      case when p_collectors is null or array_length(p_collectors,1) is null
           then null else p_collectors end as cl
  ),
  f as (
    select fr.* from public.frontliner_rows fr, sel
    where (sel.dl is null or fr.district = any(sel.dl))
      and (sel.cl is null or fr.data_collector = any(sel.cl))
      and (p_from is null or fr.day >= p_from)
      and (p_to   is null or fr.day <= p_to)
  ),
  agg as (
    select
      data_collector,
      count(*) filter (where has_date) as youth_trained,
      count(*) filter (where sex='Female') as female_reached,
      count(*) filter (where is_pwd) as pwds_trained,
      count(distinct group_id) filter (where group_id is not null) as groups_reached,
      string_agg(distinct training_type, ', ' order by training_type)
        filter (where training_type is not null) as training_types,
      string_agg(distinct group_name, ', ' order by group_name)
        filter (where group_name is not null) as group_names,
      min(district) as first_district
    from f
    where data_collector is not null
    group by data_collector
  ),
  ranked as (
    select *,
      case when length(group_names) > 100 then left(group_names,100) || '...' else group_names end as group_names_short
    from agg
    order by youth_trained desc nulls last
    limit p_limit
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
        'data_collector', data_collector,
        'pwds_trained', pwds_trained,
        'female_reached', female_reached,
        'youth_trained', youth_trained,
        'groups_reached', groups_reached,
        'training_types', training_types,
        'group_names', group_names_short,
        'first_district', first_district
      ) order by youth_trained desc nulls last), '[]'::jsonb),
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from public.frontliner_rows where district is not null),
    'collectors', (select coalesce(jsonb_agg(distinct data_collector order by data_collector), '[]'::jsonb)
                  from public.frontliner_rows where data_collector is not null)
  ) from ranked;
$$;

-- Drop the old 4-arg signature so PostgREST resolves the new 5-arg one cleanly.
drop function if exists public.frontliner_dash(text[],date,date,int);
alter function public.frontliner_dash(text[],date,date,text[],int) set statement_timeout = '55000';
grant execute on function public.frontliner_dash(text[],date,date,text[],int) to anon, service_role;

-- Rebuild frontliner_rows from records (heavy — may take ~2min on the full set).
create or replace function public.refresh_frontliner_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.frontliner_rows;
  insert into public.frontliner_rows
  select
    nullif(trim(data->>'data_collector'),''),
    nullif(trim(data->>'participant_id'),''),
    nullif(trim(data->>'group_id'),''),
    nullif(trim(data->>'group_name'),''),
    nullif(trim(data->>'training_type'),''),
    upper(nullif(trim(data->>'district'),'')),
    case when (data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}' then (left(data->>'activity_date',10))::date else null end,
    nullif(trim(data->>'sex'),''),
    (lower(trim(data->>'Disability_status'))='yes'),   -- case-insensitive (matches DAX LOWER(...)='yes')
    ((data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}')
  from public.records
  where template='all_trainees_view';
  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_frontliner_rows() set statement_timeout = '120000';
grant execute on function public.refresh_frontliner_rows() to service_role;
