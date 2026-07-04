-- ============================================================================
-- Cluster Trainings dashboard aggregation.
-- One RPC that returns KPIs + bar-chart data for all_trainees_view,
-- filtered by optional district list and activity_date range.
-- Callable via PostgREST:  POST /rest/v1/rpc/cluster_trainings
-- ============================================================================

create or replace function public.cluster_trainings(
  p_districts text[]  default null,   -- null/empty => all districts
  p_from      date    default null,   -- null => no lower bound
  p_to        date    default null    -- null => no upper bound
)
returns jsonb
language sql
stable
as $$
  with base as (
    select
      nullif(trim(data->>'training_type'), '')       as training_type,
      upper(nullif(trim(data->>'district'), ''))      as district,
      lower(nullif(trim(data->>'sex'), ''))           as sex,
      lower(nullif(trim(data->>'Disability_status'), '')) as disability,
      nullif(trim(data->>'group_id'), '')             as group_id,
      case
        when (data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
          then (left(data->>'activity_date',10))::date
        else null
      end                                              as activity_date
    from public.records
    where template = 'all_trainees_view'
  ),
  filtered as (
    select * from base
    where (p_districts is null or array_length(p_districts,1) is null
           or district = any(select upper(x) from unnest(p_districts) x))
      and (p_from is null or activity_date >= p_from)
      and (p_to   is null or activity_date <= p_to)
  ),
  is_pwd as (
    -- Any disability value that is not blank/no/none counts as PWD.
    select *, (disability is not null
               and disability not in ('no','none','n/a','na','false','0')) as pwd
    from filtered
  ),
  bars as (
    select coalesce(training_type,'(blank)') as training_type, count(*)::bigint as value
    from is_pwd
    group by 1
    order by value desc
  )
  select jsonb_build_object(
    'total_trained',        (select count(*) from is_pwd),
    'training_types',       (select count(distinct training_type) from is_pwd where training_type is not null),
    'groups_reached',       (select count(distinct group_id) from is_pwd where group_id is not null),
    'female_reached',       (select count(*) from is_pwd where sex = 'female'),
    'pwds_trained',         (select count(*) from is_pwd where pwd),
    'female_pwds',          (select count(*) from is_pwd where pwd and sex = 'female'),
    'by_training_type',     (select coalesce(jsonb_agg(jsonb_build_object('label', training_type, 'value', value)), '[]'::jsonb) from bars),
    'districts',            (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                            from base where district is not null)
  );
$$;

-- Allow the anon & service roles to call it via PostgREST.
grant execute on function public.cluster_trainings(text[], date, date) to anon, service_role;
