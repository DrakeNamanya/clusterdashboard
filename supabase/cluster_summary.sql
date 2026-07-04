-- ============================================================================
-- Cluster Trainings: compact summary table (disk-friendly on free tier).
-- One row per (district, training_type, sex, is_pwd, day). A few thousand rows.
-- Rebuilt from records by refresh_cluster_summary(). The dashboard RPC reads
-- from this tiny table so it is instant and never hits statement timeouts.
-- ============================================================================

create table if not exists public.cluster_summary (
  district      text,
  training_type text,
  sex           text,      -- 'female' / 'male' / null
  is_pwd        boolean,
  day           date,
  group_id      text,
  n             bigint not null
);
create index if not exists cluster_summary_day_idx on public.cluster_summary (day);
create index if not exists cluster_summary_district_idx on public.cluster_summary (district);

-- Rebuild the summary from records (all_trainees_view).
create or replace function public.refresh_cluster_summary()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.cluster_summary;
  insert into public.cluster_summary (district, training_type, sex, is_pwd, day, group_id, n)
  select
    upper(nullif(trim(data->>'district'), ''))                       as district,
    nullif(trim(data->>'training_type'), '')                        as training_type,
    lower(nullif(trim(data->>'sex'), ''))                           as sex,
    (lower(nullif(trim(data->>'Disability_status'), '')) is not null
       and lower(trim(data->>'Disability_status'))
           not in ('no','none','n/a','na','false','0'))             as is_pwd,
    case when (data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(data->>'activity_date',10))::date else null end as day,
    nullif(trim(data->>'group_id'), '')                             as group_id,
    count(*)                                                        as n
  from public.records
  where template = 'all_trainees_view'
  group by 1,2,3,4,5,6;
  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;

-- Dashboard aggregate over the compact summary (fast).
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
    select * from public.cluster_summary
    where (p_districts is null or array_length(p_districts,1) is null
           or district = any(select upper(x) from unnest(p_districts) x))
      and (p_from is null or day >= p_from)
      and (p_to   is null or day <= p_to)
  ),
  bars as (
    select coalesce(training_type,'(blank)') as label, sum(n)::bigint as value
    from f group by 1 order by value desc
  )
  select jsonb_build_object(
    'total_trained',    (select coalesce(sum(n),0) from f),
    'training_types',   (select count(distinct training_type) from f where training_type is not null),
    'groups_reached',   (select count(distinct group_id) from f where group_id is not null),
    'female_reached',   (select coalesce(sum(n),0) from f where sex='female'),
    'pwds_trained',     (select coalesce(sum(n),0) from f where is_pwd),
    'female_pwds',      (select coalesce(sum(n),0) from f where is_pwd and sex='female'),
    'by_training_type', (select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',value)), '[]'::jsonb) from bars),
    'districts',        (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                         from public.cluster_summary where district is not null)
  );
$$;

grant execute on function public.cluster_trainings(text[], date, date) to anon, service_role;
grant execute on function public.refresh_cluster_summary() to service_role;
