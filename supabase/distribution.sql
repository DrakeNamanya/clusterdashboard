-- ============================================================================
-- Distribution to Participants — participants_shg ⋈ distribution_form_v2
-- Join key: participants_shg[__Submissions-id] = distribution_form_v2[_id]
-- (mirrors the PARTICIPANTS_DISTRIBUTION_TABLE DAX GENERATE/FILTER).
--
-- Power BI table (matrix) grouped by SHG_Name with an expandable hierarchy
-- SHG_Name -> Participant_Name. Columns (all "First X" = min per group):
--   Sum of Qty_Received, First Unit_Received, First Other_Unit_Received,
--   First Livestock_Type, First Other_Livestock_Type, First Crop_Type,
--   First Other_Crop_Type, First Agri_Resources_Type,
--   First Other_Agri_Resources_Type, First ISLA_Kits, First Other_ISLA_Kits,
--   Sum of Qty_<unit> (one per unit: Seedlings, Grams, Liters, Meters, Other,
--     Foot, Kit, Packets, Tins, Sackets, ... derived from qty where unit=X),
--   First Submitted_By, First Supplier, First Other_Supplier,
--   Count of Participant_Name, First Subcounty, PWDs_Distributees.
-- KPI cards:
--   Unique Distributees = DISTINCTCOUNT(participant_id)
--   New Distributees    = distinct participants on their FIRST-EVER distribution date
--   SHGs distributees   = DISTINCTCOUNT(shg_name)
-- Slicers: District, Material_Type, Unit, Submitted_By, Other_Supplier, date.
-- ============================================================================

drop table if exists public.distribution_rows cascade;
create table public.distribution_rows (
  participant_id            text,
  participant_name          text,
  shg_name                  text,
  district                  text,
  subcounty                 text,
  material_type             text,
  other_material_type       text,
  unit                      text,   -- shg_unit_received (Unit_Received)
  other_unit                text,   -- other_shg_unit_received
  qty_received              numeric,
  livestock_type            text,
  other_livestock_type      text,
  crop_type                 text,
  other_crop_type           text,
  agri_resources_type       text,
  other_agri_resources_type text,
  isla_kits                 text,
  other_isla_kits           text,
  submitted_by              text,
  supplier                  text,
  other_supplier            text,
  is_pwd                    boolean,
  dist_date                 date,
  first_date                date       -- participant's first-ever distribution date
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
      nullif(trim(p.data->>'other_shg_unit_received'),'') as other_unit,
      nullif(regexp_replace(p.data->>'shg_qty_received','[^0-9.\-]','','g'),'')::numeric as qty_received,
      nullif(trim(d.data->>'livestock_type'),'')            as livestock_type,
      nullif(trim(d.data->>'other_livestock_type'),'')      as other_livestock_type,
      nullif(trim(d.data->>'crop_type'),'')                 as crop_type,
      nullif(trim(d.data->>'other_crop_type'),'')           as other_crop_type,
      nullif(trim(d.data->>'agri_resources_type'),'')       as agri_resources_type,
      nullif(trim(d.data->>'other_agri_resources_type'),'') as other_agri_resources_type,
      nullif(trim(d.data->>'isla_kits'),'')                 as isla_kits,
      nullif(trim(d.data->>'other_isla_kits'),'')           as other_isla_kits,
      nullif(trim(d.data->>'submitterName'),'')             as submitted_by,
      nullif(trim(d.data->>'supplier'),'')                  as supplier,
      nullif(trim(d.data->>'other_supplier'),'')            as other_supplier,
      (lower(trim(coalesce(p.data->>'disability_status', p.data->>'Disability_status'))) = 'yes') as is_pwd,
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
         j.material_type, j.other_material_type, j.unit, j.other_unit, j.qty_received,
         j.livestock_type, j.other_livestock_type, j.crop_type, j.other_crop_type,
         j.agri_resources_type, j.other_agri_resources_type, j.isla_kits, j.other_isla_kits,
         j.submitted_by, j.supplier, j.other_supplier, j.is_pwd,
         j.dist_date, f.first_date
  from j left join firsts f on f.participant_id = j.participant_id;
  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_distribution_rows() set statement_timeout='120000';
grant execute on function public.refresh_distribution_rows() to service_role;

-- Dashboard aggregate: KPIs + grouped hierarchy table + slicer option lists.
-- p_expand: SHG_Name to expand into per-participant detail rows (or null).
create or replace function public.distribution_dash(
  p_districts text[] default null,
  p_from      date   default null,
  p_to        date   default null,
  p_materials text[] default null,
  p_units     text[] default null,
  p_submitters text[] default null,
  p_suppliers text[] default null,
  p_limit     int    default 2000
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
           else p_units end as ul,
      case when p_submitters is null or array_length(p_submitters,1) is null then null
           else p_submitters end as sbl,
      case when p_suppliers is null or array_length(p_suppliers,1) is null then null
           else p_suppliers end as spl
  ),
  f as (
    select dr.* from public.distribution_rows dr, sel
    where (sel.dl  is null or dr.district = any(sel.dl))
      and (sel.ml  is null or dr.material_type = any(sel.ml))
      and (sel.ul  is null or dr.unit = any(sel.ul))
      and (sel.sbl is null or dr.submitted_by = any(sel.sbl))
      and (sel.spl is null or dr.other_supplier = any(sel.spl))
      and (p_from is null or dr.dist_date >= p_from)
      and (p_to   is null or dr.dist_date <= p_to)
  ),
  -- Group (parent) rows, one per SHG_Name.
  grp as (
    select
      shg_name,
      min(district)                  as first_district,
      min(subcounty)                 as first_subcounty,
      min(material_type)             as first_material_type,
      min(other_material_type)       as first_other_material_type,
      min(unit)                      as first_unit,
      min(other_unit)                as first_other_unit,
      sum(qty_received)              as qty_received,
      min(livestock_type)            as first_livestock_type,
      min(other_livestock_type)      as first_other_livestock_type,
      min(crop_type)                 as first_crop_type,
      min(other_crop_type)           as first_other_crop_type,
      min(agri_resources_type)       as first_agri_resources_type,
      min(other_agri_resources_type) as first_other_agri_resources_type,
      min(isla_kits)                 as first_isla_kits,
      min(other_isla_kits)           as first_other_isla_kits,
      min(submitted_by)              as first_submitted_by,
      min(supplier)                  as first_supplier,
      min(other_supplier)            as first_other_supplier,
      count(participant_name)        as count_participants,
      count(*) filter (where is_pwd) as pwds_distributees,
      -- Per-unit quantity sums
      sum(qty_received) filter (where unit='Seedlings') as qty_seedlings,
      sum(qty_received) filter (where unit='Grams')     as qty_grams,
      sum(qty_received) filter (where unit='liters' or unit='Liters') as qty_liters,
      sum(qty_received) filter (where unit='Meters')    as qty_meters,
      sum(qty_received) filter (where unit='Other')     as qty_other,
      sum(qty_received) filter (where unit='Foot')      as qty_foot,
      sum(qty_received) filter (where unit='Set/Kit' or unit='Kit') as qty_kit,
      sum(qty_received) filter (where unit='Packets')   as qty_packets,
      sum(qty_received) filter (where unit='Tins')      as qty_tins,
      sum(qty_received) filter (where unit='Sackets')   as qty_sackets,
      sum(qty_received) filter (where unit='KGs')       as qty_kgs,
      sum(qty_received) filter (where unit='Number')    as qty_number,
      sum(qty_received) filter (where unit='Acre')      as qty_acre,
      sum(qty_received) filter (where unit='Dozens')    as qty_dozens,
      sum(qty_received) filter (where unit='Boxes')     as qty_boxes,
      sum(qty_received) filter (where unit='Pieces')    as qty_pieces,
      sum(qty_received) filter (where unit='Hectare')   as qty_hectare
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
    -- Grouped (parent) rows
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'shg_name', shg_name,
        'first_district', first_district,
        'first_subcounty', first_subcounty,
        'first_material_type', first_material_type,
        'first_other_material_type', first_other_material_type,
        'first_unit', first_unit,
        'first_other_unit', first_other_unit,
        'qty_received', round(qty_received,2),
        'first_livestock_type', first_livestock_type,
        'first_other_livestock_type', first_other_livestock_type,
        'first_crop_type', first_crop_type,
        'first_other_crop_type', first_other_crop_type,
        'first_agri_resources_type', first_agri_resources_type,
        'first_other_agri_resources_type', first_other_agri_resources_type,
        'first_isla_kits', first_isla_kits,
        'first_other_isla_kits', first_other_isla_kits,
        'first_submitted_by', first_submitted_by,
        'first_supplier', first_supplier,
        'first_other_supplier', first_other_supplier,
        'count_participants', count_participants,
        'pwds_distributees', pwds_distributees,
        'first_subcounty2', first_subcounty,
        'qty_seedlings', round(qty_seedlings,2),
        'qty_grams', round(qty_grams,2),
        'qty_liters', round(qty_liters,2),
        'qty_meters', round(qty_meters,2),
        'qty_other', round(qty_other,2),
        'qty_foot', round(qty_foot,2),
        'qty_kit', round(qty_kit,2),
        'qty_packets', round(qty_packets,2),
        'qty_tins', round(qty_tins,2),
        'qty_sackets', round(qty_sackets,2),
        'qty_kgs', round(qty_kgs,2),
        'qty_number', round(qty_number,2),
        'qty_acre', round(qty_acre,2),
        'qty_dozens', round(qty_dozens,2),
        'qty_boxes', round(qty_boxes,2),
        'qty_pieces', round(qty_pieces,2),
        'qty_hectare', round(qty_hectare,2)
      ) order by shg_name), '[]'::jsonb) from grp),
    -- Grand-total row (over all filtered rows, not just the limited groups)
    'total', (select jsonb_build_object(
        'qty_received', coalesce(round(sum(qty_received),2),0),
        'first_unit', min(unit),
        'first_livestock_type', min(livestock_type),
        'first_submitted_by', min(submitted_by),
        'first_supplier', min(supplier),
        'first_other_supplier', min(other_supplier),
        'count_participants', count(participant_name),
        'pwds_distributees', count(*) filter (where is_pwd),
        'first_subcounty', min(subcounty),
        'qty_seedlings', round(sum(qty_received) filter (where unit='Seedlings'),2),
        'qty_grams', round(sum(qty_received) filter (where unit='Grams'),2),
        'qty_liters', round(sum(qty_received) filter (where unit='liters' or unit='Liters'),2),
        'qty_meters', round(sum(qty_received) filter (where unit='Meters'),2),
        'qty_other', round(sum(qty_received) filter (where unit='Other'),2),
        'qty_foot', round(sum(qty_received) filter (where unit='Foot'),2),
        'qty_kit', round(sum(qty_received) filter (where unit='Set/Kit' or unit='Kit'),2),
        'qty_packets', round(sum(qty_received) filter (where unit='Packets'),2),
        'qty_tins', round(sum(qty_received) filter (where unit='Tins'),2),
        'qty_sackets', round(sum(qty_received) filter (where unit='Sackets'),2),
        'qty_kgs', round(sum(qty_received) filter (where unit='KGs'),2),
        'qty_number', round(sum(qty_received) filter (where unit='Number'),2),
        'qty_acre', round(sum(qty_received) filter (where unit='Acre'),2),
        'qty_dozens', round(sum(qty_received) filter (where unit='Dozens'),2),
        'qty_boxes', round(sum(qty_received) filter (where unit='Boxes'),2),
        'qty_pieces', round(sum(qty_received) filter (where unit='Pieces'),2),
        'qty_hectare', round(sum(qty_received) filter (where unit='Hectare'),2)
      ) from f),
    -- Slicer option lists
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from public.distribution_rows where district is not null),
    'materials', (select coalesce(jsonb_agg(distinct material_type order by material_type), '[]'::jsonb)
                  from public.distribution_rows where material_type is not null),
    'units', (select coalesce(jsonb_agg(distinct unit order by unit), '[]'::jsonb)
                  from public.distribution_rows where unit is not null),
    'submitters', (select coalesce(jsonb_agg(distinct submitted_by order by submitted_by), '[]'::jsonb)
                  from public.distribution_rows where submitted_by is not null),
    'suppliers', (select coalesce(jsonb_agg(distinct other_supplier order by other_supplier), '[]'::jsonb)
                  from public.distribution_rows where other_supplier is not null)
  );
$$;
alter function public.distribution_dash(text[],date,date,text[],text[],text[],text[],int) set statement_timeout='40000';
grant execute on function public.distribution_dash(text[],date,date,text[],text[],text[],text[],int) to anon, service_role;

-- Per-participant detail rows for one SHG (for the expandable hierarchy).
create or replace function public.distribution_detail(
  p_shg       text,
  p_districts text[] default null,
  p_from      date   default null,
  p_to        date   default null,
  p_materials text[] default null,
  p_units     text[] default null,
  p_submitters text[] default null,
  p_suppliers text[] default null
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
           else p_units end as ul,
      case when p_submitters is null or array_length(p_submitters,1) is null then null
           else p_submitters end as sbl,
      case when p_suppliers is null or array_length(p_suppliers,1) is null then null
           else p_suppliers end as spl
  ),
  f as (
    select dr.* from public.distribution_rows dr, sel
    where dr.shg_name = p_shg
      and (sel.dl  is null or dr.district = any(sel.dl))
      and (sel.ml  is null or dr.material_type = any(sel.ml))
      and (sel.ul  is null or dr.unit = any(sel.ul))
      and (sel.sbl is null or dr.submitted_by = any(sel.sbl))
      and (sel.spl is null or dr.other_supplier = any(sel.spl))
      and (p_from is null or dr.dist_date >= p_from)
      and (p_to   is null or dr.dist_date <= p_to)
  ),
  d as (
    select
      participant_name,
      min(district) as first_district, min(subcounty) as first_subcounty,
      min(unit) as first_unit, min(other_unit) as first_other_unit,
      sum(qty_received) as qty_received,
      min(livestock_type) as first_livestock_type,
      min(other_livestock_type) as first_other_livestock_type,
      min(crop_type) as first_crop_type, min(other_crop_type) as first_other_crop_type,
      min(agri_resources_type) as first_agri_resources_type,
      min(other_agri_resources_type) as first_other_agri_resources_type,
      min(isla_kits) as first_isla_kits, min(other_isla_kits) as first_other_isla_kits,
      min(submitted_by) as first_submitted_by, min(supplier) as first_supplier,
      min(other_supplier) as first_other_supplier,
      count(participant_name) as count_participants,
      count(*) filter (where is_pwd) as pwds_distributees,
      sum(qty_received) filter (where unit='Seedlings') as qty_seedlings,
      sum(qty_received) filter (where unit='Grams') as qty_grams,
      sum(qty_received) filter (where unit='liters' or unit='Liters') as qty_liters,
      sum(qty_received) filter (where unit='Meters') as qty_meters,
      sum(qty_received) filter (where unit='Other') as qty_other,
      sum(qty_received) filter (where unit='Foot') as qty_foot,
      sum(qty_received) filter (where unit='Set/Kit' or unit='Kit') as qty_kit,
      sum(qty_received) filter (where unit='Packets') as qty_packets,
      sum(qty_received) filter (where unit='Tins') as qty_tins,
      sum(qty_received) filter (where unit='Sackets') as qty_sackets,
      sum(qty_received) filter (where unit='KGs') as qty_kgs,
      sum(qty_received) filter (where unit='Number') as qty_number,
      sum(qty_received) filter (where unit='Acre') as qty_acre,
      sum(qty_received) filter (where unit='Dozens') as qty_dozens,
      sum(qty_received) filter (where unit='Boxes') as qty_boxes,
      sum(qty_received) filter (where unit='Pieces') as qty_pieces,
      sum(qty_received) filter (where unit='Hectare') as qty_hectare
    from f where participant_name is not null
    group by participant_name
    order by participant_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'participant_name', participant_name,
      'first_district', first_district,
      'first_subcounty', first_subcounty,
      'first_unit', first_unit,
      'first_other_unit', first_other_unit,
      'qty_received', round(qty_received,2),
      'first_livestock_type', first_livestock_type,
      'first_other_livestock_type', first_other_livestock_type,
      'first_crop_type', first_crop_type,
      'first_other_crop_type', first_other_crop_type,
      'first_agri_resources_type', first_agri_resources_type,
      'first_other_agri_resources_type', first_other_agri_resources_type,
      'first_isla_kits', first_isla_kits,
      'first_other_isla_kits', first_other_isla_kits,
      'first_submitted_by', first_submitted_by,
      'first_supplier', first_supplier,
      'first_other_supplier', first_other_supplier,
      'count_participants', count_participants,
      'pwds_distributees', pwds_distributees,
      'qty_seedlings', round(qty_seedlings,2),
      'qty_grams', round(qty_grams,2),
      'qty_liters', round(qty_liters,2),
      'qty_meters', round(qty_meters,2),
      'qty_other', round(qty_other,2),
      'qty_foot', round(qty_foot,2),
      'qty_kit', round(qty_kit,2),
      'qty_packets', round(qty_packets,2),
      'qty_tins', round(qty_tins,2),
      'qty_sackets', round(qty_sackets,2),
      'qty_kgs', round(qty_kgs,2),
      'qty_number', round(qty_number,2),
      'qty_acre', round(qty_acre,2),
      'qty_dozens', round(qty_dozens,2),
      'qty_boxes', round(qty_boxes,2),
      'qty_pieces', round(qty_pieces,2),
      'qty_hectare', round(qty_hectare,2)
    ) order by participant_name), '[]'::jsonb)
  from d;
$$;
alter function public.distribution_detail(text,text[],date,date,text[],text[],text[],text[]) set statement_timeout='40000';
grant execute on function public.distribution_detail(text,text[],date,date,text[],text[],text[],text[]) to anon, service_role;
