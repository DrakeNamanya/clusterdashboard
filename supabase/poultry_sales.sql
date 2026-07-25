-- ============================================================================
-- POULTRY SALES dashboard
--
--   Marketing_Table = production_and_marketing_tool filtered pdn_level='marketing'
--                     AND value_chain='Poultry'  (poultry-only slice of Sales)
--   Join : marketing[shg_participant_id] -> participants[refID]
--            -> shg_id, shg_name, Disability_status
--          participants[shg_id] -> shg_profiling_form[refID] -> Profilers_name
--   district_name comes from the marketing feed itself.
--
-- Materialized as `poultry_sales_rows` (one row per poultry marketing record).
--
-- Dashboard (per the two POULTRY SALES report screenshots):
--   Title : POULTRY SALES
--   KPIs  : Unique Participants = DISTINCTCOUNT(shg_participant_id)
--           New Participants    = DISTINCTCOUNT(shg_participant_id)
--             where EOMONTH(activity_date)=EOMONTH(first marketing date per participant)
--           Unique SHGs         = DISTINCTCOUNT(shg_id)
--   Date range: activity_date (from / to)
--   Table (grouped by shg_name):
--     shg_name, Sum of qty_produced, Sum of poultry_sold, Sum of avg_bird_price,
--     Sum of total_poultry_value, Sum of net_poultry, First district_name,
--     First other_poultry, First profilers_name
--   Slicers : district_name + poultry (poultry type) + profilers_name
-- ============================================================================

-- ---- poultry_sales_rows: denormalized fact (poultry marketing) -------------
drop table if exists public.poultry_sales_rows cascade;
create table public.poultry_sales_rows (
  ref_id                        text,
  shg_participant_id            text,
  participant_name              text,
  activity_date                 date,
  district_name                 text,
  value_chain                   text,
  pdn_level                     text,
  poultry                       text,   -- poultry type (e.g. Broilers, Kulioleros ...)
  other_poultry                 text,
  qty_produced                  numeric,
  poultry_sold                  numeric,
  avg_bird_price                numeric,
  total_poultry_production_cost numeric,
  total_poultry_value           numeric,
  net_poultry                   numeric,
  -- from participant join
  shg_id                        text,
  shg_name                      text,
  disability_status             text,
  -- from profiling join
  profilers_name                text,
  -- per-participant first marketing month (for New Participants measure)
  first_mkt_month               date
);
create index poultry_sales_rows_shgid_idx on public.poultry_sales_rows (shg_id);
create index poultry_sales_rows_dist_idx  on public.poultry_sales_rows (district_name);
create index poultry_sales_rows_type_idx  on public.poultry_sales_rows (poultry);
create index poultry_sales_rows_date_idx  on public.poultry_sales_rows (activity_date);
create index poultry_sales_rows_prof_idx  on public.poultry_sales_rows (profilers_name);
grant select on public.poultry_sales_rows to anon, service_role;

-- ---- Rebuild poultry_sales_rows --------------------------------------------
create or replace function public.refresh_poultry_sales_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.poultry_sales_rows;

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
      nullif(trim(f.data->>'poultry'),'')             as poultry,
      nullif(trim(f.data->>'other_poultry'),'')       as other_poultry,
      nnum(f.data->>'qty_produced')                   as qty_produced,
      nnum(f.data->>'poultry_sold')                   as poultry_sold,
      nnum(f.data->>'avg_bird_price')                 as avg_bird_price,
      nnum(f.data->>'total_poultry_production_cost')  as total_poultry_production_cost,
      nnum(f.data->>'total_poultry_value')            as total_poultry_value,
      nnum(f.data->>'net_poultry')                    as net_poultry
    from public.records f
    where f.template='production_and_marketing_tool'
      and lower(nullif(trim(f.data->>'pdn_level'),'')) = 'marketing'
      and lower(nullif(trim(f.data->>'value_chain'),'')) = 'poultry'
  ),
  firstmkt as (
    -- First (poultry) Marketing Date per participant (as month start)
    select shg_participant_id,
           date_trunc('month', min(activity_date))::date as first_mkt_month
    from base
    where shg_participant_id is not null and activity_date is not null
    group by shg_participant_id
  )
  insert into public.poultry_sales_rows
  select
    b.ref_id, b.shg_participant_id, b.participant_name, b.activity_date,
    b.district_name, b.value_chain, b.pdn_level, b.poultry, b.other_poultry,
    b.qty_produced, b.poultry_sold, b.avg_bird_price,
    b.total_poultry_production_cost, b.total_poultry_value, b.net_poultry,
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
alter function public.refresh_poultry_sales_rows() set statement_timeout='120000';
grant execute on function public.refresh_poultry_sales_rows() to service_role;

-- ---- Dashboard aggregate: KPIs + table (grouped by shg_name) + slicers ------
create or replace function public.poultry_sales_dash(
  p_districts   text[] default null,
  p_poultry     text[] default null,
  p_profilers   text[] default null,
  p_from        date   default null,
  p_to          date   default null,
  p_limit       int    default 5000
)
returns jsonb
language sql
stable
as $$
  with sel as (
    select
      case when p_districts is null or array_length(p_districts,1) is null then null else p_districts end as dl,
      case when p_poultry   is null or array_length(p_poultry,1)   is null then null else p_poultry   end as pl,
      case when p_profilers is null or array_length(p_profilers,1) is null then null else p_profilers end as fl
  ),
  f as (
    select r.* from public.poultry_sales_rows r, sel
    where (sel.dl is null or coalesce(r.district_name,'(Blank)') = any(sel.dl))
      and (sel.pl is null or coalesce(r.poultry,'(Blank)')       = any(sel.pl))
      and (sel.fl is null or coalesce(r.profilers_name,'(Blank)')= any(sel.fl))
      and (p_from is null or r.activity_date >= p_from)
      and (p_to   is null or r.activity_date <= p_to)
  ),
  g as (
    select
      shg_name,
      sum(qty_produced)          as qty_produced,
      sum(poultry_sold)          as poultry_sold,
      sum(avg_bird_price)        as avg_bird_price,
      sum(total_poultry_value)   as total_poultry_value,
      sum(net_poultry)           as net_poultry,
      min(district_name)         as district_name,
      min(other_poultry)         as other_poultry,
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
        'qty_produced', qty_produced,
        'poultry_sold', poultry_sold,
        'avg_bird_price', avg_bird_price,
        'total_poultry_value', total_poultry_value,
        'net_poultry', net_poultry,
        'district_name', district_name,
        'other_poultry', other_poultry,
        'profilers_name', profilers_name
      ) order by shg_name), '[]'::jsonb)
      from (select * from g order by shg_name limit p_limit) t),
    'total', (select jsonb_build_object(
        'qty_produced', coalesce(sum(qty_produced),0),
        'poultry_sold', coalesce(sum(poultry_sold),0),
        'avg_bird_price', coalesce(sum(avg_bird_price),0),
        'total_poultry_value', coalesce(sum(total_poultry_value),0),
        'net_poultry', coalesce(sum(net_poultry),0)
      ) from g),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_name),''),'(Blank)') as d
                        from public.poultry_sales_rows) x),
    'poultry_types', (select coalesce(jsonb_agg(p order by p), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(poultry),''),'(Blank)') as p
                        from public.poultry_sales_rows) x),
    'profilers', (select coalesce(jsonb_agg(pr order by pr), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(profilers_name),''),'(Blank)') as pr
                        from public.poultry_sales_rows) x)
  );
$$;
alter function public.poultry_sales_dash(text[],text[],text[],date,date,int) set statement_timeout='40000';
grant execute on function public.poultry_sales_dash(text[],text[],text[],date,date,int) to anon, service_role;

-- ---- Lightweight slicer option lists only ----------------------------------
create or replace function public.poultry_sales_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_name),''),'(Blank)') as d
                        from public.poultry_sales_rows) x),
    'poultry_types', (select coalesce(jsonb_agg(p order by p), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(poultry),''),'(Blank)') as p
                        from public.poultry_sales_rows) x),
    'profilers', (select coalesce(jsonb_agg(pr order by pr), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(profilers_name),''),'(Blank)') as pr
                        from public.poultry_sales_rows) x)
  );
$$;
alter function public.poultry_sales_options() set statement_timeout='20000';
grant execute on function public.poultry_sales_options() to anon, service_role;
