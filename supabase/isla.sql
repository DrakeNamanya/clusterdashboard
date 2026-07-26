-- ============================================================================
-- SHGs SAVING IN A CLUSTER (ISLA) dashboard
--
--   Fact  : isla_form (ISLA_DATA)          — one row per ISLA activity record
--             filtered to shg_id <> ''  (per the Power Query step)
--   Lookup: Dim_SHG_ISLA = shg_profiling_form summarized by refID with
--             MAX(Profilers_name), MAX(district)   (SHG_ISLA side)
--   Join  : isla_form[shg_id] = shg_profiling_form[refID]   (LeftOuter)
--             -> Profilers_name, District_SHG  (= RELATED profiling cols)
--
-- ISLA FINAL (calculated table) is materialized as `isla_final_rows`.
--
-- Dashboard (per the two report screenshots):
--   Title    : SHGs SAVING IN A CLUSTER(ISLA)
--   KPI card : SHG_Saving = DISTINCTCOUNT(isla_final[shg_id]) over the filtered
--              rows (distinct SHGs that saved in the window).
--   Date range: activity_date (from / to).
--   Table (grouped by shg_name):
--     shg_name,
--     Sum of savings_value, Sum of youth_group_saving,
--     Sum of youth_loans_value_given, Sum of total_fund, Sum of loans,
--     First Profilers_name, First District_SHG
--   Slicers  : District_SHG (checkbox list, incl. (Blank)), Profilers_name.
-- ============================================================================

-- ---- ISLA FINAL: denormalized fact, one row per ISLA activity record -------
drop table if exists public.isla_final_rows cascade;
create table public.isla_final_rows (
  ref_id                   text,   -- isla_form[refID]
  shg_id                   text,   -- isla_form[shg_id]  (= Dim_SHG_ISLA.refID)
  shg_name                 text,   -- isla_form[shg_name]
  shg_total                int,
  shg_total_females        int,
  shg_total_males          int,
  shg_total_pwds           int,
  group_saving             int,
  youth_group_saving       int,
  savings_value            int,
  youth_savings_value      int,
  total_fund               int,
  loans                    int,
  loans_value_given        int,
  youth_loans_value_given  int,
  loans_value_repaid       int,
  loans_value_outstanding  int,
  social_fund              int,
  other_funds              int,
  balance                  int,
  activity_date            date,   -- isla_form[activity_date]  (cast to date)
  profilers_name           text,   -- RELATED shg_profiling_form[Profilers_name]
  district_shg             text,   -- RELATED shg_profiling_form[district] -> District_SHG
  subcounty_shg            text,
  parish_shg               text,
  village_shg              text
);
create index isla_final_rows_shgid_idx  on public.isla_final_rows (shg_id);
create index isla_final_rows_dist_idx   on public.isla_final_rows (district_shg);
create index isla_final_rows_prof_idx   on public.isla_final_rows (profilers_name);
create index isla_final_rows_date_idx   on public.isla_final_rows (activity_date);
grant select on public.isla_final_rows to anon, service_role;

-- ---- Rebuild ISLA FINAL ----------------------------------------------------
create or replace function public.refresh_isla_final_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.isla_final_rows;

  with dim_shg_isla as (
    -- SHG_ISLA lookup: one row per profiling refID.
    select
      nullif(trim(p.data->>'refID'),'')                as ref_id,
      max(nullif(trim(p.data->>'Profilers_name'),''))  as profilers_name,
      max(nullif(trim(p.data->>'district'),''))        as district_shg,
      max(nullif(trim(p.data->>'subcounty'),''))       as subcounty_shg,
      max(nullif(trim(p.data->>'Parish_name'),''))     as parish_shg,
      max(nullif(trim(p.data->>'Village_name'),''))    as village_shg
    from public.records p
    where p.template='shg_profiling_form'
      and nullif(trim(p.data->>'refID'),'') is not null
    group by nullif(trim(p.data->>'refID'),'')
  )
  insert into public.isla_final_rows
  select
    nullif(trim(i.data->>'refID'),'')    as ref_id,
    nullif(trim(i.data->>'shg_id'),'')   as shg_id,
    nullif(trim(i.data->>'shg_name'),'') as shg_name,
    n(i.data->>'shg_total'),
    n(i.data->>'shg_total_females'),
    n(i.data->>'shg_total_males'),
    n(i.data->>'shg_total_pwds'),
    n(i.data->>'group_saving'),
    n(i.data->>'youth_group_saving'),
    n(i.data->>'savings_value'),
    n(i.data->>'youth_savings_value'),
    n(i.data->>'total_fund'),
    n(i.data->>'loans'),
    n(i.data->>'loans_value_given'),
    n(i.data->>'youth_loans_value_given'),
    n(i.data->>'loans_value_repaid'),
    n(i.data->>'loans_value_outstanding'),
    n(i.data->>'social_fund'),
    n(i.data->>'other_funds'),
    n(i.data->>'balance'),
    case when (i.data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(i.data->>'activity_date',10))::date else null end as activity_date,
    d.profilers_name,
    d.district_shg,
    d.subcounty_shg,
    d.parish_shg,
    d.village_shg
  from public.records i
  left join dim_shg_isla d
    on d.ref_id = nullif(trim(i.data->>'shg_id'),'')
  where i.template='isla_form'
    and nullif(trim(i.data->>'shg_id'),'') is not null;   -- SelectRows: shg_id <> ''

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_isla_final_rows() set statement_timeout='120000';
grant execute on function public.refresh_isla_final_rows() to service_role;

-- ---- helper: parse an int out of a jsonb text value ------------------------
create or replace function public.n(txt text)
returns int
language sql
immutable
as $$
  select coalesce(nullif(regexp_replace(coalesce(txt,''),'[^0-9\-]','','g'),'')::int, 0);
$$;

-- ---- Dashboard aggregate: KPI + table (grouped by shg_name) + slicers ------
create or replace function public.isla_dash(
  p_districts text[] default null,
  p_profilers text[] default null,
  p_from      date   default null,
  p_to        date   default null,
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
    select r.* from public.isla_final_rows r, sel
    where (sel.dl is null or coalesce(r.district_shg,'(Blank)') = any(sel.dl))
      and (sel.pl is null or coalesce(r.profilers_name,'(Blank)') = any(sel.pl))
      and (p_from is null or r.activity_date >= p_from)
      and (p_to   is null or r.activity_date <= p_to)
  ),
  -- Group by shg_name: sums + First(profiler)/First(district).
  g as (
    select
      shg_name,
      sum(savings_value)           as savings_value,
      -- youth saving capped per activity row (>35 -> 30) per MEL outlier rule
      sum(case when youth_group_saving > 35 then 30 else youth_group_saving end) as youth_group_saving,
      sum(youth_loans_value_given) as youth_loans_value_given,
      sum(total_fund)              as total_fund,
      -- youth who got loans capped per activity row (>35 -> 30) per MEL outlier rule
      sum(case when loans > 35 then 30 else loans end) as loans,
      min(profilers_name)          as profilers_name,   -- First (alphabetical, like PBI First)
      min(district_shg)            as district_shg
    from f
    where shg_name is not null
    group by shg_name
  )
  select jsonb_build_object(
    -- KPI: SHG_Saving = DISTINCTCOUNT(isla_final[shg_id]) over the filtered rows.
    'shg_saving', (select count(distinct shg_id) from f where shg_id is not null),
    -- Table rows (one per shg_name)
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'shg_name', shg_name,
        'savings_value', savings_value,
        'youth_group_saving', youth_group_saving,
        'youth_loans_value_given', youth_loans_value_given,
        'total_fund', total_fund,
        'loans', loans,
        'profilers_name', profilers_name,
        'district_shg', district_shg
      ) order by shg_name), '[]'::jsonb)
      from (select * from g order by shg_name limit p_limit) t),
    -- Grand-total row (all filtered rows).
    -- MEL outlier rules (per client): per-row `loans` and `youth_group_saving`
    -- capped at >35 -> 30 before summing.  savings_value / total_fund /
    -- youth_loans_value_given are pure sums.  NOTE these grand totals are computed
    -- from the raw filtered rows `f` (not the shg_name-grouped `g`) so the row-level
    -- outlier cap is applied correctly.
    'total', (select jsonb_build_object(
        'shg_count', (select count(distinct shg_id) from f where shg_id is not null),
        'savings_value', coalesce(sum(savings_value),0),
        'youth_group_saving', coalesce(sum(case when youth_group_saving > 35 then 30 else youth_group_saving end),0),
        'youth_loans_value_given', coalesce(sum(youth_loans_value_given),0),
        -- Monetary VALUE of loans given (UGX). `loans` (below) is only a COUNT of
        -- borrowers, so the home "Loans (UGX)" card must read loans_value, not loans.
        'loans_value', coalesce(sum(youth_loans_value_given),0),
        'total_fund', coalesce(sum(total_fund),0),
        'loans', coalesce(sum(case when loans > 35 then 30 else loans end),0)
      ) from f),
    -- Slicer lists (global) — District_SHG (with (Blank)) + Profilers_name
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_shg),''),'(Blank)') as d
                        from public.isla_final_rows) x),
    'profilers', (select coalesce(jsonb_agg(p order by p), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(profilers_name),''),'(Blank)') as p
                        from public.isla_final_rows) x)
  );
$$;
alter function public.isla_dash(text[],text[],date,date,int) set statement_timeout='40000';
grant execute on function public.isla_dash(text[],text[],date,date,int) to anon, service_role;

-- ---- Lightweight slicer option lists only ----------------------------------
create or replace function public.isla_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_shg),''),'(Blank)') as d
                        from public.isla_final_rows) x),
    'profilers', (select coalesce(jsonb_agg(p order by p), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(profilers_name),''),'(Blank)') as p
                        from public.isla_final_rows) x)
  );
$$;
alter function public.isla_options() set statement_timeout='20000';
grant execute on function public.isla_options() to anon, service_role;
