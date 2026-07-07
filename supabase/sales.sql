-- ============================================================================
-- SALES IN HORTICULTURE/OILSEEDS dashboard
--
--   Marketing_Table = production_and_marketing_tool filtered pdn_level='marketing'
--   Join : marketing[shg_participant_id] -> participants[refID]
--            -> shg_id, shg_name, Disability_status
--          participants[shg_id] -> shg_profiling_form[refID] -> Profilers_name
--   district_name comes from the marketing feed itself.
--
-- Materialized as `sales_rows` (one row per marketing activity record).
--
-- Dashboard (per the two report screenshots):
--   Title : SALES IN HORTICULTURE/OILSEEDS
--   KPIs  : Unique Participants (Sales) = DISTINCTCOUNT(shg_participant_id)
--           New Participants (Sales)    = DISTINCTCOUNT(shg_participant_id)
--             where EOMONTH(activity_date)=EOMONTH(first marketing date per participant)
--           Unique SHGs (Sales)         = DISTINCTCOUNT(shg_id)
--   Date range: activity_date (from / to)
--   Table (grouped by shg_name):
--     shg_name, First horticulture, Sum of qty_harvested,
--     First qty_harvested_measure, Sum of total_planting_value,
--     Sum of net_planting, First district_name, First profilers_name
--   Slicers : district_name + value_chain
-- ============================================================================

-- ---- sales_rows: denormalized fact (marketing) -----------------------------
drop table if exists public.sales_rows cascade;
create table public.sales_rows (
  ref_id                 text,
  shg_participant_id     text,
  participant_name       text,
  activity_date          date,
  district_name          text,
  value_chain            text,
  pdn_level              text,
  horticulture           text,
  qty_harvested          numeric,
  qty_harvested_measure  text,
  total_planting_value   numeric,
  net_planting           numeric,
  -- from participant join
  shg_id                 text,
  shg_name               text,
  disability_status      text,
  -- from profiling join
  profilers_name         text,
  -- per-participant first marketing month (for New Participants measure)
  first_mkt_month        date
);
create index sales_rows_shgid_idx  on public.sales_rows (shg_id);
create index sales_rows_dist_idx   on public.sales_rows (district_name);
create index sales_rows_vc_idx     on public.sales_rows (value_chain);
create index sales_rows_date_idx   on public.sales_rows (activity_date);
grant select on public.sales_rows to anon, service_role;

-- ---- Rebuild sales_rows ----------------------------------------------------
create or replace function public.refresh_sales_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.sales_rows;

  with part as (
    select
      nullif(trim(pt.data->>'refID'),'')             as ref_id,
      max(nullif(trim(pt.data->>'shg_id'),''))       as shg_id,
      max(nullif(trim(pt.data->>'shg_name'),''))     as shg_name,
      max(nullif(trim(pt.data->>'Disability_status'),'')) as disability_status
    from public.records pt
    where pt.template='participants'
      and nullif(trim(pt.data->>'refID'),'') is not null
    group by nullif(trim(pt.data->>'refID'),'')
  ),
  prof as (
    select
      nullif(trim(p.data->>'refID'),'')                as ref_id,
      max(nullif(trim(p.data->>'Profilers_name'),''))  as profilers_name
    from public.records p
    where p.template='shg_profiling_form'
      and nullif(trim(p.data->>'refID'),'') is not null
    group by nullif(trim(p.data->>'refID'),'')
  ),
  base as (
    select
      nullif(trim(f.data->>'refID'),'')               as ref_id,
      nullif(trim(f.data->>'shg_participant_id'),'')  as shg_participant_id,
      nullif(trim(f.data->>'participant_name'),'')    as participant_name,
      case when (f.data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
           then (left(f.data->>'activity_date',10))::date else null end as activity_date,
      nullif(trim(f.data->>'district_name'),'')       as district_name,
      nullif(trim(f.data->>'value_chain'),'')         as value_chain,
      nullif(trim(f.data->>'pdn_level'),'')           as pdn_level,
      nullif(trim(f.data->>'horticulture'),'')        as horticulture,
      nnum(f.data->>'qty_harvested')                  as qty_harvested,
      nullif(trim(f.data->>'qty_harvested_measure'),'') as qty_harvested_measure,
      nnum(f.data->>'total_planting_value')           as total_planting_value,
      nnum(f.data->>'net_planting')                   as net_planting
    from public.records f
    where f.template='production_and_marketing_tool'
      and nullif(trim(f.data->>'pdn_level'),'') = 'marketing'
  ),
  firstmkt as (
    -- First Marketing Date per participant (as month start)
    select shg_participant_id,
           date_trunc('month', min(activity_date))::date as first_mkt_month
    from base
    where shg_participant_id is not null and activity_date is not null
    group by shg_participant_id
  )
  insert into public.sales_rows
  select
    b.ref_id, b.shg_participant_id, b.participant_name, b.activity_date,
    b.district_name, b.value_chain, b.pdn_level, b.horticulture,
    b.qty_harvested, b.qty_harvested_measure, b.total_planting_value, b.net_planting,
    pa.shg_id, pa.shg_name, pa.disability_status,
    pr.profilers_name,
    fm.first_mkt_month
  from base b
  left join part pa on pa.ref_id = b.shg_participant_id
  left join prof pr on pr.ref_id = pa.shg_id
  left join firstmkt fm on fm.shg_participant_id = b.shg_participant_id;

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_sales_rows() set statement_timeout='120000';
grant execute on function public.refresh_sales_rows() to service_role;

-- ---- Dashboard aggregate: KPIs + table (grouped by shg_name) + slicers -----
create or replace function public.sales_dash(
  p_districts    text[] default null,
  p_valuechains  text[] default null,
  p_from         date   default null,
  p_to           date   default null,
  p_limit        int    default 5000
)
returns jsonb
language sql
stable
as $$
  with sel as (
    select
      case when p_districts is null or array_length(p_districts,1) is null then null
           else p_districts end as dl,
      case when p_valuechains is null or array_length(p_valuechains,1) is null then null
           else p_valuechains end as vl
  ),
  f as (
    select r.* from public.sales_rows r, sel
    where (sel.dl is null or coalesce(r.district_name,'(Blank)') = any(sel.dl))
      and (sel.vl is null or coalesce(r.value_chain,'(Blank)')  = any(sel.vl))
      and (p_from is null or r.activity_date >= p_from)
      and (p_to   is null or r.activity_date <= p_to)
  ),
  g as (
    select
      shg_name,
      min(horticulture)          as horticulture,
      sum(qty_harvested)         as qty_harvested,
      min(qty_harvested_measure) as qty_harvested_measure,
      sum(total_planting_value)  as total_planting_value,
      sum(net_planting)          as net_planting,
      min(district_name)         as district_name,
      min(profilers_name)        as profilers_name
    from f
    where shg_name is not null
    group by shg_name
  )
  select jsonb_build_object(
    'unique_participants', (select count(distinct shg_participant_id) from f where shg_participant_id is not null),
    'new_participants',    (select count(distinct shg_participant_id) from f
                            where shg_participant_id is not null
                              and activity_date is not null
                              and first_mkt_month is not null
                              and date_trunc('month', activity_date)::date = first_mkt_month),
    'unique_shgs',         (select count(distinct shg_id) from f where shg_id is not null),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'shg_name', shg_name,
        'horticulture', horticulture,
        'qty_harvested', qty_harvested,
        'qty_harvested_measure', qty_harvested_measure,
        'total_planting_value', total_planting_value,
        'net_planting', net_planting,
        'district_name', district_name,
        'profilers_name', profilers_name
      ) order by shg_name), '[]'::jsonb)
      from (select * from g order by shg_name limit p_limit) t),
    'total', (select jsonb_build_object(
        'qty_harvested', coalesce(sum(qty_harvested),0),
        'total_planting_value', coalesce(sum(total_planting_value),0),
        'net_planting', coalesce(sum(net_planting),0)
      ) from g),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_name),''),'(Blank)') as d
                        from public.sales_rows) x),
    'valuechains', (select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(value_chain),''),'(Blank)') as v
                        from public.sales_rows) x)
  );
$$;
alter function public.sales_dash(text[],text[],date,date,int) set statement_timeout='40000';
grant execute on function public.sales_dash(text[],text[],date,date,int) to anon, service_role;

-- ---- Lightweight slicer option lists only ----------------------------------
create or replace function public.sales_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_name),''),'(Blank)') as d
                        from public.sales_rows) x),
    'valuechains', (select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(value_chain),''),'(Blank)') as v
                        from public.sales_rows) x)
  );
$$;
alter function public.sales_options() set statement_timeout='20000';
grant execute on function public.sales_options() to anon, service_role;
