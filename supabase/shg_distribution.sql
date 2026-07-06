-- ============================================================================
-- Distribution to SHGs — shg_group ⋈ distribution_form_v2
-- Join key: shg_group[__Submissions-id] = distribution_form_v2[_id]
-- (mirrors the SHG_GROUP_DISTRIBUTION_TABLE DAX GENERATE/FILTER).
--
-- Power BI table grouped by SHG_Group_Name with an expandable hierarchy
-- SHG_Group_Name -> individual distribution records. Columns:
--   SHG INFORMATION: shg_id, district, subcounty, unit_received (First),
--     qty_received (Sum), other_unit_received (First)
--   MATERIAL DETAILS (First): material_type, other_material_type,
--     livestock_type, other_livestock_type, crop_type, other_crop_type,
--     agri_resources_type, other_agri_resources_type, isla_kits, other_isla_kits
--   QUANTITIES (Sum, from distribution_form_v2[qty_distributed_*]):
--     kgs, grams, liters, seedlings, packets, tins, pieces, dozens, sackets,
--     boxes, number, meters, kit, hectare, acre, foot, other
--   METADATA (First): partner, supplier, other_supplier, distributor,
--     distributor_title, submitted_by
-- KPI cards:
--   SHGs Reached      = DISTINCTCOUNT(shg_group_name)
--   Distribution Recs = COUNT(*) (distribution rows)
--   Total Qty         = SUM of the group-level shg_group_qty_received
-- Slicers: District, Material_Type, Unit_Received, Submitted_By,
--   Other_Supplier, date.
-- ============================================================================

drop table if exists public.shg_distribution_rows cascade;
create table public.shg_distribution_rows (
  distribution_id           text,   -- distribution_form_v2._id (row identity)
  shg_group_name            text,
  shg_group_id              text,
  district                  text,
  subcounty                 text,
  unit_received             text,   -- shg_group_unit_received
  other_unit_received       text,   -- other_shg_group_unit_received
  qty_received              numeric,-- shg_group_qty_received
  material_type             text,
  other_material_type       text,
  livestock_type            text,
  other_livestock_type      text,
  crop_type                 text,
  other_crop_type           text,
  agri_resources_type       text,
  other_agri_resources_type text,
  isla_kits                 text,
  other_isla_kits           text,
  qty_kgs                   numeric,
  qty_grams                 numeric,
  qty_liters                numeric,
  qty_seedlings             numeric,
  qty_packets               numeric,
  qty_tins                  numeric,
  qty_pieces                numeric,
  qty_dozens                numeric,
  qty_sackets               numeric,
  qty_boxes                 numeric,
  qty_number                numeric,
  qty_meters                numeric,
  qty_kit                   numeric,
  qty_hectare               numeric,
  qty_acre                  numeric,
  qty_foot                  numeric,
  qty_other                 numeric,
  partner                   text,
  supplier                  text,
  other_supplier            text,
  distributor               text,
  distributor_title         text,
  submitted_by              text,
  dist_date                 date
);
create index shg_distribution_rows_district_idx on public.shg_distribution_rows (district);
create index shg_distribution_rows_date_idx     on public.shg_distribution_rows (dist_date);
create index shg_distribution_rows_mat_idx      on public.shg_distribution_rows (material_type);
create index shg_distribution_rows_unit_idx     on public.shg_distribution_rows (unit_received);
create index shg_distribution_rows_grp_idx      on public.shg_distribution_rows (shg_group_name);
grant select on public.shg_distribution_rows to anon, service_role;

-- Rebuild from records (join is ~926 rows, fast).
create or replace function public.refresh_shg_distribution_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.shg_distribution_rows;
  insert into public.shg_distribution_rows
  select
    nullif(trim(d.data->>'_id'),'')                       as distribution_id,
    nullif(trim(g.data->>'shg_name'),'')                  as shg_group_name,
    nullif(trim(g.data->>'shg_id'),'')                    as shg_group_id,
    upper(nullif(trim(g.data->>'district'),''))           as district,
    nullif(trim(g.data->>'subcounty'),'')                 as subcounty,
    nullif(trim(g.data->>'shg_group_unit_received'),'')   as unit_received,
    nullif(trim(g.data->>'other_shg_group_unit_received'),'') as other_unit_received,
    nullif(regexp_replace(g.data->>'shg_group_qty_received','[^0-9.\-]','','g'),'')::numeric as qty_received,
    nullif(trim(d.data->>'material_type'),'')             as material_type,
    nullif(trim(d.data->>'other_material_type'),'')       as other_material_type,
    nullif(trim(d.data->>'livestock_type'),'')            as livestock_type,
    nullif(trim(d.data->>'other_livestock_type'),'')      as other_livestock_type,
    nullif(trim(d.data->>'crop_type'),'')                 as crop_type,
    nullif(trim(d.data->>'other_crop_type'),'')           as other_crop_type,
    nullif(trim(d.data->>'agri_resources_type'),'')       as agri_resources_type,
    nullif(trim(d.data->>'other_agri_resources_type'),'') as other_agri_resources_type,
    nullif(trim(d.data->>'isla_kits'),'')                 as isla_kits,
    nullif(trim(d.data->>'other_isla_kits'),'')           as other_isla_kits,
    nullif(regexp_replace(d.data->>'qty_distributed_kgs','[^0-9.\-]','','g'),'')::numeric      as qty_kgs,
    nullif(regexp_replace(d.data->>'qty_distributed_grams','[^0-9.\-]','','g'),'')::numeric    as qty_grams,
    nullif(regexp_replace(d.data->>'qty_distributed_liters','[^0-9.\-]','','g'),'')::numeric   as qty_liters,
    nullif(regexp_replace(d.data->>'qty_distributed_seedlings','[^0-9.\-]','','g'),'')::numeric as qty_seedlings,
    nullif(regexp_replace(d.data->>'qty_distributed_packets','[^0-9.\-]','','g'),'')::numeric  as qty_packets,
    nullif(regexp_replace(d.data->>'qty_distributed_tins','[^0-9.\-]','','g'),'')::numeric     as qty_tins,
    nullif(regexp_replace(d.data->>'qty_distributed_pieces','[^0-9.\-]','','g'),'')::numeric   as qty_pieces,
    nullif(regexp_replace(d.data->>'qty_distributed_dozens','[^0-9.\-]','','g'),'')::numeric   as qty_dozens,
    nullif(regexp_replace(d.data->>'qty_distributed_sackets','[^0-9.\-]','','g'),'')::numeric  as qty_sackets,
    nullif(regexp_replace(d.data->>'qty_distributed_boxes','[^0-9.\-]','','g'),'')::numeric    as qty_boxes,
    nullif(regexp_replace(d.data->>'qty_distributed_number','[^0-9.\-]','','g'),'')::numeric   as qty_number,
    nullif(regexp_replace(d.data->>'qty_distributed_meters','[^0-9.\-]','','g'),'')::numeric   as qty_meters,
    nullif(regexp_replace(d.data->>'qty_distributed_kit','[^0-9.\-]','','g'),'')::numeric      as qty_kit,
    nullif(regexp_replace(d.data->>'qty_distributed_hectare','[^0-9.\-]','','g'),'')::numeric  as qty_hectare,
    nullif(regexp_replace(d.data->>'qty_distributed_acre','[^0-9.\-]','','g'),'')::numeric     as qty_acre,
    nullif(regexp_replace(d.data->>'qty_distributed_foot','[^0-9.\-]','','g'),'')::numeric     as qty_foot,
    nullif(regexp_replace(d.data->>'qty_distributed_other','[^0-9.\-]','','g'),'')::numeric    as qty_other,
    nullif(trim(d.data->>'partner'),'')                   as partner,
    nullif(trim(d.data->>'supplier'),'')                  as supplier,
    nullif(trim(d.data->>'other_supplier'),'')            as other_supplier,
    nullif(trim(d.data->>'distributor'),'')               as distributor,
    nullif(trim(d.data->>'distributor_title'),'')         as distributor_title,
    nullif(trim(d.data->>'submitterName'),'')             as submitted_by,
    case when (d.data->>'distribution_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(d.data->>'distribution_date',10))::date else null end as dist_date
  from public.records g
  join public.records d
    on d.template='distribution_form_v2'
   and (g.data->>'__Submissions-id') = (d.data->>'_id')
  where g.template='shg_group'
    and nullif(trim(g.data->>'__Submissions-id'),'') is not null;
  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_shg_distribution_rows() set statement_timeout='120000';
grant execute on function public.refresh_shg_distribution_rows() to service_role;

-- Dashboard aggregate: KPIs + grouped hierarchy table + slicer option lists.
create or replace function public.shg_distribution_dash(
  p_districts text[] default null,
  p_from      date   default null,
  p_to        date   default null,
  p_materials text[] default null,
  p_units     text[] default null,
  p_submitters text[] default null,
  p_suppliers text[] default null,
  p_limit     int    default 5000
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
    select dr.* from public.shg_distribution_rows dr, sel
    where (sel.dl  is null or dr.district = any(sel.dl))
      and (sel.ml  is null or dr.material_type = any(sel.ml))
      and (sel.ul  is null or dr.unit_received = any(sel.ul))
      and (sel.sbl is null or dr.submitted_by = any(sel.sbl))
      and (sel.spl is null or dr.other_supplier = any(sel.spl))
      and (p_from is null or dr.dist_date >= p_from)
      and (p_to   is null or dr.dist_date <= p_to)
  ),
  grp as (
    select
      shg_group_name,
      min(shg_group_id)              as first_shg_group_id,
      min(district)                  as first_district,
      min(subcounty)                 as first_subcounty,
      min(unit_received)             as first_unit,
      min(other_unit_received)       as first_other_unit,
      sum(qty_received)              as qty_received,
      min(material_type)             as first_material_type,
      min(other_material_type)       as first_other_material_type,
      min(livestock_type)            as first_livestock_type,
      min(other_livestock_type)      as first_other_livestock_type,
      min(crop_type)                 as first_crop_type,
      min(other_crop_type)           as first_other_crop_type,
      min(agri_resources_type)       as first_agri_resources_type,
      min(other_agri_resources_type) as first_other_agri_resources_type,
      min(isla_kits)                 as first_isla_kits,
      min(other_isla_kits)           as first_other_isla_kits,
      min(partner)                   as first_partner,
      min(supplier)                  as first_supplier,
      min(other_supplier)            as first_other_supplier,
      min(distributor)               as first_distributor,
      min(distributor_title)         as first_distributor_title,
      min(submitted_by)              as first_submitted_by,
      count(*)                       as records_count,
      sum(qty_kgs)       as qty_kgs,
      sum(qty_grams)     as qty_grams,
      sum(qty_liters)    as qty_liters,
      sum(qty_seedlings) as qty_seedlings,
      sum(qty_packets)   as qty_packets,
      sum(qty_tins)      as qty_tins,
      sum(qty_pieces)    as qty_pieces,
      sum(qty_dozens)    as qty_dozens,
      sum(qty_sackets)   as qty_sackets,
      sum(qty_boxes)     as qty_boxes,
      sum(qty_number)    as qty_number,
      sum(qty_meters)    as qty_meters,
      sum(qty_kit)       as qty_kit,
      sum(qty_hectare)   as qty_hectare,
      sum(qty_acre)      as qty_acre,
      sum(qty_foot)      as qty_foot,
      sum(qty_other)     as qty_other
    from f where shg_group_name is not null
    group by shg_group_name
    order by shg_group_name
    limit p_limit
  )
  select jsonb_build_object(
    -- KPI cards
    'shgs_reached',    (select count(distinct shg_group_name) from f where shg_group_name is not null),
    'records_count',   (select count(*) from f),
    'total_qty',       (select coalesce(round(sum(qty_received),2),0) from f),
    -- Grouped (parent) rows
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'shg_group_name', shg_group_name,
        'first_shg_group_id', first_shg_group_id,
        'first_district', first_district,
        'first_subcounty', first_subcounty,
        'first_unit', first_unit,
        'first_other_unit', first_other_unit,
        'qty_received', round(qty_received,2),
        'first_material_type', first_material_type,
        'first_other_material_type', first_other_material_type,
        'first_livestock_type', first_livestock_type,
        'first_other_livestock_type', first_other_livestock_type,
        'first_crop_type', first_crop_type,
        'first_other_crop_type', first_other_crop_type,
        'first_agri_resources_type', first_agri_resources_type,
        'first_other_agri_resources_type', first_other_agri_resources_type,
        'first_isla_kits', first_isla_kits,
        'first_other_isla_kits', first_other_isla_kits,
        'first_partner', first_partner,
        'first_supplier', first_supplier,
        'first_other_supplier', first_other_supplier,
        'first_distributor', first_distributor,
        'first_distributor_title', first_distributor_title,
        'first_submitted_by', first_submitted_by,
        'records_count', records_count,
        'qty_kgs', round(qty_kgs,2),
        'qty_grams', round(qty_grams,2),
        'qty_liters', round(qty_liters,2),
        'qty_seedlings', round(qty_seedlings,2),
        'qty_packets', round(qty_packets,2),
        'qty_tins', round(qty_tins,2),
        'qty_pieces', round(qty_pieces,2),
        'qty_dozens', round(qty_dozens,2),
        'qty_sackets', round(qty_sackets,2),
        'qty_boxes', round(qty_boxes,2),
        'qty_number', round(qty_number,2),
        'qty_meters', round(qty_meters,2),
        'qty_kit', round(qty_kit,2),
        'qty_hectare', round(qty_hectare,2),
        'qty_acre', round(qty_acre,2),
        'qty_foot', round(qty_foot,2),
        'qty_other', round(qty_other,2)
      ) order by shg_group_name), '[]'::jsonb) from grp),
    -- Grand-total row (over all filtered rows, not just the limited groups)
    'total', (select jsonb_build_object(
        'qty_received', coalesce(round(sum(qty_received),2),0),
        'first_unit', min(unit_received),
        'first_material_type', min(material_type),
        'first_livestock_type', min(livestock_type),
        'first_submitted_by', min(submitted_by),
        'first_supplier', min(supplier),
        'first_other_supplier', min(other_supplier),
        'records_count', count(*),
        'first_subcounty', min(subcounty),
        'qty_kgs', round(sum(qty_kgs),2),
        'qty_grams', round(sum(qty_grams),2),
        'qty_liters', round(sum(qty_liters),2),
        'qty_seedlings', round(sum(qty_seedlings),2),
        'qty_packets', round(sum(qty_packets),2),
        'qty_tins', round(sum(qty_tins),2),
        'qty_pieces', round(sum(qty_pieces),2),
        'qty_dozens', round(sum(qty_dozens),2),
        'qty_sackets', round(sum(qty_sackets),2),
        'qty_boxes', round(sum(qty_boxes),2),
        'qty_number', round(sum(qty_number),2),
        'qty_meters', round(sum(qty_meters),2),
        'qty_kit', round(sum(qty_kit),2),
        'qty_hectare', round(sum(qty_hectare),2),
        'qty_acre', round(sum(qty_acre),2),
        'qty_foot', round(sum(qty_foot),2),
        'qty_other', round(sum(qty_other),2)
      ) from f),
    -- Slicer option lists (global)
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from public.shg_distribution_rows where district is not null),
    'materials', (select coalesce(jsonb_agg(distinct material_type order by material_type), '[]'::jsonb)
                  from public.shg_distribution_rows where material_type is not null),
    'units', (select coalesce(jsonb_agg(distinct unit_received order by unit_received), '[]'::jsonb)
                  from public.shg_distribution_rows where unit_received is not null),
    'submitters', (select coalesce(jsonb_agg(distinct submitted_by order by submitted_by), '[]'::jsonb)
                  from public.shg_distribution_rows where submitted_by is not null),
    'suppliers', (select coalesce(jsonb_agg(distinct other_supplier order by other_supplier), '[]'::jsonb)
                  from public.shg_distribution_rows where other_supplier is not null)
  );
$$;
alter function public.shg_distribution_dash(text[],date,date,text[],text[],text[],text[],int) set statement_timeout='40000';
grant execute on function public.shg_distribution_dash(text[],date,date,text[],text[],text[],text[],int) to anon, service_role;

-- Lightweight slicer option lists only.
create or replace function public.shg_distribution_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(distinct district order by district), '[]'::jsonb)
                  from public.shg_distribution_rows where district is not null),
    'materials', (select coalesce(jsonb_agg(distinct material_type order by material_type), '[]'::jsonb)
                  from public.shg_distribution_rows where material_type is not null),
    'units', (select coalesce(jsonb_agg(distinct unit_received order by unit_received), '[]'::jsonb)
                  from public.shg_distribution_rows where unit_received is not null),
    'submitters', (select coalesce(jsonb_agg(distinct submitted_by order by submitted_by), '[]'::jsonb)
                  from public.shg_distribution_rows where submitted_by is not null),
    'suppliers', (select coalesce(jsonb_agg(distinct other_supplier order by other_supplier), '[]'::jsonb)
                  from public.shg_distribution_rows where other_supplier is not null)
  );
$$;
alter function public.shg_distribution_options() set statement_timeout='20000';
grant execute on function public.shg_distribution_options() to anon, service_role;

-- Per-record detail rows for one SHG group (expandable hierarchy).
create or replace function public.shg_distribution_detail(
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
    select dr.* from public.shg_distribution_rows dr, sel
    where dr.shg_group_name = p_shg
      and (sel.dl  is null or dr.district = any(sel.dl))
      and (sel.ml  is null or dr.material_type = any(sel.ml))
      and (sel.ul  is null or dr.unit_received = any(sel.ul))
      and (sel.sbl is null or dr.submitted_by = any(sel.sbl))
      and (sel.spl is null or dr.other_supplier = any(sel.spl))
      and (p_from is null or dr.dist_date >= p_from)
      and (p_to   is null or dr.dist_date <= p_to)
    order by dr.dist_date, dr.distribution_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'shg_group_name', shg_group_name,
      'first_shg_group_id', shg_group_id,
      'first_district', district,
      'first_subcounty', subcounty,
      'first_unit', unit_received,
      'first_other_unit', other_unit_received,
      'qty_received', round(qty_received,2),
      'first_material_type', material_type,
      'first_other_material_type', other_material_type,
      'first_livestock_type', livestock_type,
      'first_other_livestock_type', other_livestock_type,
      'first_crop_type', crop_type,
      'first_other_crop_type', other_crop_type,
      'first_agri_resources_type', agri_resources_type,
      'first_other_agri_resources_type', other_agri_resources_type,
      'first_isla_kits', isla_kits,
      'first_other_isla_kits', other_isla_kits,
      'first_partner', partner,
      'first_supplier', supplier,
      'first_other_supplier', other_supplier,
      'first_distributor', distributor,
      'first_distributor_title', distributor_title,
      'first_submitted_by', submitted_by,
      'records_count', 1,
      'qty_kgs', round(qty_kgs,2),
      'qty_grams', round(qty_grams,2),
      'qty_liters', round(qty_liters,2),
      'qty_seedlings', round(qty_seedlings,2),
      'qty_packets', round(qty_packets,2),
      'qty_tins', round(qty_tins,2),
      'qty_pieces', round(qty_pieces,2),
      'qty_dozens', round(qty_dozens,2),
      'qty_sackets', round(qty_sackets,2),
      'qty_boxes', round(qty_boxes,2),
      'qty_number', round(qty_number,2),
      'qty_meters', round(qty_meters,2),
      'qty_kit', round(qty_kit,2),
      'qty_hectare', round(qty_hectare,2),
      'qty_acre', round(qty_acre,2),
      'qty_foot', round(qty_foot,2),
      'qty_other', round(qty_other,2),
      'dist_date', dist_date
    )), '[]'::jsonb)
  from f;
$$;
alter function public.shg_distribution_detail(text,text[],date,date,text[],text[],text[],text[]) set statement_timeout='30000';
grant execute on function public.shg_distribution_detail(text,text[],date,date,text[],text[],text[],text[]) to anon, service_role;
