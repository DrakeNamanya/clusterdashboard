-- ============================================================================
-- YOUTH IN PRODUCTION (Mainly Horticulture) dashboard
--
--   Fact : production_and_marketing_tool  filtered to pdn_level = 'production'
--            (Production_Table in the Power BI model)
--   Join : production[shg_participant_id] -> participants[refID]
--            -> shg_id, shg_name, Disability_status
--          participants[shg_id]           -> shg_profiling_form[refID]
--            -> Profilers_name  (First profilers_name)
--   district_name comes from the production feed itself (lowercase).
--
-- Materialized as `production_rows` (one row per production activity record).
--
-- Dashboard (per the three report screenshots):
--   Title : YOUTH IN PRODUCTION(Mainly Horticulture)
--   KPIs  : Unique SHGs               = DISTINCTCOUNT(shg_id)
--           Unique Participants       = DISTINCTCOUNT(shg_participant_id)
--           New Participants in production = COUNT of production activity records
--   Date range: activity_date (from / to)
--   Table (grouped by shg_name):
--     shg_name,
--     First horticulture, Sum of acres, First other_horticulture,
--     First oil_seeds, First other_oil_seeds, Sum of qty_seed,
--     First qty_seed_measure, First poultry, First other_poultry,
--     First district_name, First profilers_name,
--     Count of shg_id (distinct SHGs), Count of shg_participant_id,
--     PWDs_in_Production (participants w/ Disability_status='Yes')
--   Slicers : district_name (lowercase list) + value_chain (horticulture/oil_seeds/poultry)
-- ============================================================================

-- ---- helper: parse an int/number out of a jsonb text value -----------------
create or replace function public.nnum(txt text)
returns numeric
language sql
immutable
as $$
  select coalesce(nullif(regexp_replace(coalesce(txt,''),'[^0-9.\-]','','g'),'')::numeric, 0);
$$;

-- ---- production_rows: denormalized fact ------------------------------------
drop table if exists public.production_rows cascade;
create table public.production_rows (
  ref_id               text,   -- production[refID]
  shg_participant_id   text,   -- production[shg_participant_id]
  participant_name     text,
  activity_date        date,
  district_name        text,   -- production[district_name] (lowercase)
  value_chain          text,
  pdn_level            text,
  poultry              text,
  other_poultry        text,
  horticulture         text,
  other_horticulture   text,
  oil_seeds            text,
  other_oil_seeds      text,
  acres                numeric,
  qty_seed             numeric,
  qty_seed_measure     text,
  -- from participant join
  shg_id               text,
  shg_name             text,
  disability_status    text,
  -- from profiling join
  profilers_name       text
);
create index production_rows_shgid_idx  on public.production_rows (shg_id);
create index production_rows_dist_idx   on public.production_rows (district_name);
create index production_rows_vc_idx     on public.production_rows (value_chain);
create index production_rows_date_idx   on public.production_rows (activity_date);
grant select on public.production_rows to anon, service_role;

-- ---- Rebuild production_rows -----------------------------------------------
create or replace function public.refresh_production_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.production_rows;

  with part as (
    -- participants lookup: one row per participant refID.
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
    -- shg profiling lookup: one row per profiling refID (= shg_id).
    select
      nullif(trim(p.data->>'refID'),'')                as ref_id,
      max(nullif(trim(p.data->>'Profilers_name'),''))  as profilers_name
    from public.records p
    where p.template='shg_profiling_form'
      and nullif(trim(p.data->>'refID'),'') is not null
    group by nullif(trim(p.data->>'refID'),'')
  )
  insert into public.production_rows
  select
    nullif(trim(f.data->>'refID'),''),
    nullif(trim(f.data->>'shg_participant_id'),''),
    nullif(trim(f.data->>'participant_name'),''),
    case when (f.data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(f.data->>'activity_date',10))::date else null end,
    nullif(trim(f.data->>'district_name'),''),
    nullif(trim(f.data->>'value_chain'),''),
    nullif(trim(f.data->>'pdn_level'),''),
    nullif(trim(f.data->>'poultry'),''),
    nullif(trim(f.data->>'other_poultry'),''),
    nullif(trim(f.data->>'horticulture'),''),
    nullif(trim(f.data->>'other_horticulture'),''),
    nullif(trim(f.data->>'oil_seeds'),''),
    nullif(trim(f.data->>'other_oil_seeds'),''),
    nnum(f.data->>'acres'),
    nnum(f.data->>'qty_seed'),
    nullif(trim(f.data->>'qty_seed_measure'),''),
    pa.shg_id,
    pa.shg_name,
    pa.disability_status,
    pr.profilers_name
  from public.records f
  left join part pa on pa.ref_id = nullif(trim(f.data->>'shg_participant_id'),'')
  left join prof pr on pr.ref_id = pa.shg_id
  where f.template='production_and_marketing_tool'
    and lower(nullif(trim(f.data->>'pdn_level'),'')) = 'production';

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_production_rows() set statement_timeout='120000';
grant execute on function public.refresh_production_rows() to service_role;

-- ---- Dashboard aggregate: KPIs + table (grouped by shg_name) + slicers -----
create or replace function public.production_dash(
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
    select r.* from public.production_rows r, sel
    where (sel.dl is null or coalesce(r.district_name,'(Blank)') = any(sel.dl))
      and (sel.vl is null or coalesce(r.value_chain,'(Blank)')  = any(sel.vl))
      and (p_from is null or r.activity_date >= p_from)
      and (p_to   is null or r.activity_date <= p_to)
  ),
  -- Group by shg_name: First(...) via min(), Sum(...) via sum(), counts.
  g as (
    select
      shg_name,
      min(horticulture)        as horticulture,
      sum(acres)               as acres,
      min(other_horticulture)  as other_horticulture,
      min(oil_seeds)           as oil_seeds,
      min(other_oil_seeds)     as other_oil_seeds,
      sum(qty_seed)            as qty_seed,
      min(qty_seed_measure)    as qty_seed_measure,
      min(poultry)             as poultry,
      min(other_poultry)       as other_poultry,
      min(district_name)       as district_name,
      min(profilers_name)      as profilers_name,
      count(distinct shg_id)                                    as shg_count,
      count(distinct shg_participant_id)                        as participant_count,
      count(distinct case when lower(coalesce(disability_status,''))='yes'
                          then shg_participant_id end)          as pwds
    from f
    where shg_name is not null
    group by shg_name
  )
  select jsonb_build_object(
    'unique_shgs',         (select count(distinct shg_id) from f where shg_id is not null),
    'unique_participants', (select count(distinct shg_participant_id) from f where shg_participant_id is not null),
    'new_participants',    (select count(*) from f),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'shg_name', shg_name,
        'horticulture', horticulture,
        'acres', acres,
        'other_horticulture', other_horticulture,
        'oil_seeds', oil_seeds,
        'other_oil_seeds', other_oil_seeds,
        'qty_seed', qty_seed,
        'qty_seed_measure', qty_seed_measure,
        'poultry', poultry,
        'other_poultry', other_poultry,
        'district_name', district_name,
        'profilers_name', profilers_name,
        'shg_count', shg_count,
        'participant_count', participant_count,
        'pwds', pwds
      ) order by shg_name), '[]'::jsonb)
      from (select * from g order by shg_name limit p_limit) t),
    'total', (select jsonb_build_object(
        'acres', coalesce(sum(acres),0),
        'qty_seed', coalesce(sum(qty_seed),0),
        'shg_count', (select count(distinct shg_id) from f where shg_id is not null),
        'participant_count', (select count(distinct shg_participant_id) from f where shg_participant_id is not null),
        'pwds', (select count(distinct shg_participant_id) from f where lower(coalesce(disability_status,''))='yes')
      ) from g),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_name),''),'(Blank)') as d
                        from public.production_rows) x),
    'valuechains', (select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(value_chain),''),'(Blank)') as v
                        from public.production_rows) x)
  );
$$;
alter function public.production_dash(text[],text[],date,date,int) set statement_timeout='40000';
grant execute on function public.production_dash(text[],text[],date,date,int) to anon, service_role;

-- ---- Lightweight slicer option lists only ----------------------------------
create or replace function public.production_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district_name),''),'(Blank)') as d
                        from public.production_rows) x),
    'valuechains', (select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(value_chain),''),'(Blank)') as v
                        from public.production_rows) x)
  );
$$;
alter function public.production_options() set statement_timeout='20000';
grant execute on function public.production_options() to anon, service_role;
