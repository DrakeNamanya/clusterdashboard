-- ============================================================================
-- Monthly New Youth Reached — "first touch" model.
-- A participant is counted only on their FIRST-EVER activity_date (the DAX
-- MIN(activity_date) OVER ALLEXCEPT(participant_id)). Within the selected date
-- range we count DISTINCT participants whose first-ever date is in range, with
-- flags evaluated on their first-date row(s).
--
--   New_Total_Reach          = participants whose first_date in range
--   New_Female_Reach         = ... AND sex='Female' on a first-date row
--   New_PWDs_Reach           = ... AND Disability_status='Yes'
--   New_Female_PWDs_Reach    = ... AND Disability='Yes' AND sex='Female'
--   New_Youth_in_Work        = ... AND Do_for_living='Farming'
--   New_Female_Youth_in_Work = ... + sex='Female'
--   New_PWDs_in_Work         = ... + Disability='Yes'
--   New_Female_PWDs_in_Work  = ... + Disability='Yes' + sex='Female'
-- ============================================================================

drop table if exists public.new_youth cascade;
create table public.new_youth (
  participant_id text primary key,
  first_date     date,
  district       text,          -- district on a first-date row (for slicer)
  is_female      boolean,
  is_pwd         boolean,
  is_farming     boolean,
  female_pwd     boolean,
  farming_female boolean,
  farming_pwd    boolean,
  farming_fpwd   boolean
);
create index new_youth_first_date_idx on public.new_youth (first_date);
create index new_youth_district_idx on public.new_youth (district);

create or replace function public.refresh_new_youth()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.new_youth;

  insert into public.new_youth
  with parsed as (
    select
      nullif(trim(data->>'participant_id'), '')        as pid,
      case when (data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
           then (left(data->>'activity_date',10))::date else null end as adate,
      upper(nullif(trim(data->>'district'), ''))       as district,
      (trim(data->>'sex') = 'Female')                  as is_female,
      (trim(data->>'Disability_status') = 'Yes')       as is_pwd,
      (trim(data->>'Do_for_living') = 'Farming')       as is_farming
    from public.records
    where template = 'all_trainees_view'
      and nullif(trim(data->>'participant_id'), '') is not null
      and (data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
  ),
  firsts as (
    select pid, min(adate) as first_date from parsed group by pid
  ),
  -- rows that occur on the participant's first-ever date
  first_rows as (
    select p.*
    from parsed p
    join firsts f on f.pid = p.pid and f.first_date = p.adate
  )
  select
    pid,
    min(adate),   -- these rows are all on the participant's first-ever date
    -- any district value present on a first-date row (max = deterministic pick)
    max(district),
    bool_or(is_female),
    bool_or(is_pwd),
    bool_or(is_farming),
    bool_or(is_female and is_pwd),
    bool_or(is_farming and is_female),
    bool_or(is_farming and is_pwd),
    bool_or(is_farming and is_pwd and is_female)
  from first_rows
  group by pid;

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;

-- Dashboard aggregate for the New Youth page.
create or replace function public.new_youth_dash(
  p_districts text[]   default null,
  p_from      date     default null,
  p_to        date     default null,
  p_target    integer  default 726   -- monthly target (from the reference)
)
returns jsonb
language sql
stable
as $$
  with sel as (
    -- normalised selected districts (null/empty => all)
    select case when p_districts is null or array_length(p_districts,1) is null
                then null
                else (select array_agg(upper(x)) from unnest(p_districts) x) end as dl
  ),
  f as (
    select ny.* from public.new_youth ny, sel
    where (sel.dl is null or ny.district = any(sel.dl))
      and (p_from is null or ny.first_date >= p_from)
      and (p_to   is null or ny.first_date <= p_to)
  ),
  series as (
    select first_date as d, count(*)::bigint as v
    from f group by first_date order by first_date
  ),
  -- Target rows for selected districts whose month overlaps the selected range.
  -- A month (first day = rt.month) is "in range" when its month-window
  -- [month, month + 1 month) intersects [p_from, p_to].
  tsel as (
    select rt.district, rt.month, rt.target
    from public.reach_targets rt, sel
    where (sel.dl is null or rt.district = any(sel.dl))
      and (p_to   is null or rt.month <= p_to)
      and (p_from is null or (rt.month + interval '1 month' - interval '1 day') >= p_from)
  ),
  tgt as (
    select
      coalesce(sum(target),0)                            as period_total,
      count(distinct month)                              as n_months,
      count(distinct district)                           as n_districts
    from tsel
  )
  select jsonb_build_object(
    'new_total_reach',           (select count(*) from f),
    -- Target_Selected_Period = sum of monthly targets over selected districts+months
    'target_selected_period',    (select round(period_total)::int from tgt),
    -- Monthly_Target = per-month target (period total / months), falls back to
    -- the supplied p_target when no target rows match the selection.
    'monthly_target',            (select case when n_months > 0
                                              then round(period_total / n_months)::int
                                              else p_target end from tgt),
    'new_female_reach',          (select count(*) from f where is_female),
    'new_pwds_reach',            (select count(*) from f where is_pwd),
    'new_female_pwds_reach',     (select count(*) from f where female_pwd),
    'new_youth_in_work',         (select count(*) from f where is_farming),
    'new_female_youth_in_work',  (select count(*) from f where farming_female),
    'new_pwds_in_work',          (select count(*) from f where farming_pwd),
    'new_female_pwds_in_work',   (select count(*) from f where farming_fpwd),
    'by_date', (select coalesce(jsonb_agg(jsonb_build_object('date',to_char(d,'YYYY-MM-DD'),'value',v) order by d), '[]'::jsonb) from series),
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from (
                    select district from public.new_youth where district is not null
                    union
                    select district from public.reach_targets where district is not null
                  ) u)
  );
$$;

-- Allow heavier (unfiltered / all-district) queries to run past the default
-- PostgREST statement timeout, matching the cluster_trainings RPC.
alter function public.new_youth_dash(text[],date,date,integer) set statement_timeout = '30000';

grant execute on function public.new_youth_dash(text[],date,date,integer) to anon, service_role;
grant execute on function public.refresh_new_youth() to service_role;
