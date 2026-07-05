-- ============================================================================
-- Distribution to Participants — participants_shg ⋈ distribution_form_v2
-- Join key: participants_shg[__Submissions-id] = distribution_form_v2[_id]
-- (mirrors the PARTICIPANTS_DISTRIBUTION_TABLE DAX GENERATE/FILTER).
--
-- Table view (grouped by SHG_Name):
--   First District_Name, First Material_Type, First Other_Material_Type,
--   Sum of Qty_Received, First Unit
-- KPI cards:
--   Unique Distributees = DISTINCTCOUNT(participant_id)
--   New Distributees    = distinct participants on their FIRST-EVER distribution date
--   SHGs distributees   = DISTINCTCOUNT(shg_name)
-- Slicers: District, Material_Type, Unit, date range (distribution_date).
-- ============================================================================

drop table if exists public.distribution_rows cascade;
create table public.distribution_rows (
  participant_id       text,
  participant_name     text,
  shg_name             text,
  district             text,
  subcounty            text,
  material_type        text,
  other_material_type  text,
  unit                 text,
  qty_received         numeric,
  dist_date            date,
  first_date           date       -- participant's first-ever distribution date
);
create index distribution_rows_district_idx on public.distribution_rows (district);
create index distribution_rows_date_idx     on public.distribution_rows (dist_date);
create index distribution_rows_mat_idx      on public.distribution_rows (material_type);
create index distribution_rows_unit_idx     on public.distribution_rows (unit);
grant select on public.distribution_rows to anon, service_role;

-- Rebuild from records (join is ~44k rows, fast).
create or replace function public.refresh_distribution_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.distribution_rows;
  insert into public.distribution_rows
  with j as (
    select
      nullif(trim(p.data->>'shg_participant_id'),'')  as participant_id,
      nullif(trim(p.data->>'participant_name'),'')     as participant_name,
      nullif(trim(p.data->>'shg_name'),'')             as shg_name,
      upper(nullif(trim(p.data->>'district'),''))      as district,
      nullif(trim(p.data->>'subcounty'),'')            as subcounty,
      nullif(trim(d.data->>'material_type'),'')        as material_type,
      nullif(trim(d.data->>'other_material_type'),'')  as other_material_type,
      nullif(trim(p.data->>'shg_unit_received'),'')    as unit,
      nullif(regexp_replace(p.data->>'shg_qty_received','[^0-9.\-]','','g'),'')::numeric as qty_received,
      case when (d.data->>'distribution_date') ~ '^\d{4}-\d{2}-\d{2}'
           then (left(d.data->>'distribution_date',10))::date else null end as dist_date
    from public.records p
    join public.records d
      on d.template='distribution_form_v2'
     and (p.data->>'__Submissions-id') = (d.data->>'_id')
    where p.template='participants_shg'
      and nullif(trim(p.data->>'__Submissions-id'),'') is not null
  ),
  firsts as (
    select participant_id, min(dist_date) as first_date
    from j where participant_id is not null group by participant_id
  )
  select j.participant_id, j.participant_name, j.shg_name, j.district, j.subcounty,
         j.material_type, j.other_material_type, j.unit, j.qty_received, j.dist_date,
         f.first_date
  from j left join firsts f on f.participant_id = j.participant_id;
  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_distribution_rows() set statement_timeout='120000';
grant execute on function public.refresh_distribution_rows() to service_role;

-- Dashboard aggregate: KPIs + grouped table + slicer option lists.
create or replace function public.distribution_dash(
  p_districts text[] default null,
  p_from      date   default null,
  p_to        date   default null,
  p_materials text[] default null,
  p_units     text[] default null,
  p_limit     int    default 1000
)
returns jsonb
language sql
stable
as $$
  with sel as (
    select
      case when p_districts is null or array_length(p_districts,1) is null then null
           else (select array_agg(upper(x)) from unnest(p_districts) x) end as dl,
      case when p_materials is null or array_length(p_materials,1) is null then null
           else p_materials end as ml,
      case when p_units is null or array_length(p_units,1) is null then null
           else p_units end as ul
  ),
  f as (
    select dr.* from public.distribution_rows dr, sel
    where (sel.dl is null or dr.district = any(sel.dl))
      and (sel.ml is null or dr.material_type = any(sel.ml))
      and (sel.ul is null or dr.unit = any(sel.ul))
      and (p_from is null or dr.dist_date >= p_from)
      and (p_to   is null or dr.dist_date <= p_to)
  ),
  grp as (
    select
      shg_name,
      min(district)            as first_district,
      min(material_type)       as first_material_type,
      min(other_material_type) as first_other_material_type,
      sum(qty_received)        as qty_received,
      min(unit)                as first_unit,
      count(*)                 as n
    from f where shg_name is not null
    group by shg_name
    order by shg_name
    limit p_limit
  )
  select jsonb_build_object(
    -- KPI cards
    'unique_distributees', (select count(distinct participant_id) from f where participant_id is not null),
    'new_distributees',    (select count(distinct participant_id) from f
                             where participant_id is not null
                               and (p_from is null or first_date >= p_from)
                               and (p_to   is null or first_date <= p_to)),
    'shgs_distributees',   (select count(distinct shg_name) from f where shg_name is not null),
    'total_qty',           (select coalesce(round(sum(qty_received),2),0) from f),
    -- Grouped table
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'shg_name', shg_name,
        'first_district', first_district,
        'first_material_type', first_material_type,
        'first_other_material_type', first_other_material_type,
        'qty_received', round(qty_received,2),
        'first_unit', first_unit
      ) order by shg_name), '[]'::jsonb) from grp),
    -- Slicer option lists (districts scoped to nothing; materials/units global)
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from public.distribution_rows where district is not null),
    'materials', (select coalesce(jsonb_agg(distinct material_type order by material_type), '[]'::jsonb)
                  from public.distribution_rows where material_type is not null),
    'units', (select coalesce(jsonb_agg(distinct unit order by unit), '[]'::jsonb)
                  from public.distribution_rows where unit is not null)
  );
$$;
alter function public.distribution_dash(text[],date,date,text[],text[],int) set statement_timeout='40000';
grant execute on function public.distribution_dash(text[],date,date,text[],text[],int) to anon, service_role;
