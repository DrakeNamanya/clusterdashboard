-- ============================================================================
-- Cluster Trainings summary — grain includes participant_id so the dashboard
-- can COUNT(DISTINCT participant_id) after filtering, matching the Power BI DAX:
--   Youth_TrainedY = DISTINCTCOUNT(participant_id) where activity_date not blank
--   Base_Trainees  = DISTINCTCOUNT(participant_id)
--   Female_Reached = Base_Trainees where sex="Female"
--   PWDs_Trained   = Base_Trainees where Disability_status="Yes"
--   Female_PWDs    = Base_Trainees where Disability_status="Yes" AND sex="Female"
-- ============================================================================

drop table if exists public.cluster_summary cascade;
create table public.cluster_summary (
  district       text,
  training_type  text,
  sex            text,          -- 'Female' / 'Male' / null (raw casing kept)
  is_pwd         boolean,       -- Disability_status = 'Yes'
  day            date,
  participant_id text,
  group_id       text,
  has_date       boolean
);
create index cluster_summary_day_idx on public.cluster_summary (day);
create index cluster_summary_district_idx on public.cluster_summary (district);
create index cluster_summary_pid_idx on public.cluster_summary (participant_id);

-- Rebuild from records (all_trainees_view). Rows are DISTINCT combinations so
-- the table stays compact while preserving participant_id for distinct counts.
create or replace function public.refresh_cluster_summary()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.cluster_summary;
  insert into public.cluster_summary
    (district, training_type, sex, is_pwd, day, participant_id, group_id, has_date)
  select distinct
    upper(nullif(trim(data->>'district'), ''))                     as district,
    nullif(trim(data->>'training_type'), '')                      as training_type,
    nullif(trim(data->>'sex'), '')                                as sex,
    (trim(data->>'Disability_status') = 'Yes')                    as is_pwd,
    case when (data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(data->>'activity_date',10))::date else null end as day,
    nullif(trim(data->>'participant_id'), '')                     as participant_id,
    nullif(trim(data->>'group_id'), '')                           as group_id,
    (nullif(trim(data->>'activity_date'), '') is not null)        as has_date
  from public.records
  where template = 'all_trainees_view';
  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;

-- Dashboard aggregate: all counts are DISTINCT participant_id (matching DAX).
-- Single-pass conditional aggregation so it stays under the statement timeout.
create or replace function public.cluster_trainings(
  p_districts text[] default null,
  p_from      date   default null,
  p_to        date   default null
)
returns jsonb
language sql
stable
as $$
  with f as (
    select participant_id, group_id, training_type, sex, is_pwd, has_date
    from public.cluster_summary
    where (p_districts is null or array_length(p_districts,1) is null
           or district = any(select upper(x) from unnest(p_districts) x))
      and (p_from is null or day >= p_from)
      and (p_to   is null or day <= p_to)
  ),
  kpi as (
    select
      count(distinct participant_id) filter (where has_date and participant_id is not null) as total_trained,
      count(distinct training_type)  filter (where training_type is not null)               as training_types,
      count(distinct group_id)       filter (where group_id is not null)                    as groups_reached,
      count(distinct participant_id) filter (where sex='Female' and participant_id is not null) as female_reached,
      count(distinct participant_id) filter (where is_pwd and participant_id is not null)    as pwds_trained,
      count(distinct participant_id) filter (where is_pwd and sex='Female' and participant_id is not null) as female_pwds
    from f
  ),
  bars as (
    select coalesce(training_type,'(blank)') as label,
           count(distinct participant_id)::bigint as value
    from f where participant_id is not null
    group by 1 order by value desc
  )
  select jsonb_build_object(
    'total_trained',    (select total_trained  from kpi),
    'training_types',   (select training_types from kpi),
    'groups_reached',   (select groups_reached from kpi),
    'female_reached',   (select female_reached from kpi),
    'pwds_trained',     (select pwds_trained   from kpi),
    'female_pwds',      (select female_pwds    from kpi),
    'by_training_type', (select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)), '[]'::jsonb) from bars),
    'districts',        (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                         from public.cluster_summary where district is not null)
  );
$$;

grant execute on function public.cluster_trainings(text[], date, date) to anon, service_role;
grant execute on function public.refresh_cluster_summary() to service_role;
