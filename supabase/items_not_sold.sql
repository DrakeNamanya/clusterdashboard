-- ============================================================================
-- ITEMS NOT SOLD dashboard
--
--   Report_Not_Sold = FILTER(Distribution_Marketing_Matrix, [Has_Sold]="No")
--
--   Distribution_Marketing_Matrix = every distribution line (one row per item a
--   participant received) enriched with Has_Sold / Total_Qty_Sold pulled from
--   the marketing form. A participant "did NOT sell" an item when they have NO
--   marketing record (pdn_level='marketing') with a positive sold quantity
--   *in that item's value chain*.
--
--   Base join : participants_shg[__Submissions-id] = distribution_form_v2[_id]
--               (mirrors distribution.sql / PARTICIPANTS_DISTRIBUTION_TABLE).
--   ValueChain is DERIVED from the distributed item:
--       Poultry      <- livestock_type ILIKE 'Poultry%'
--       Oil seeds    <- crop_type ILIKE '%g.nut%' OR '%soy%'
--       Horticulture <- crop_type in the vegetable/fruit set
--       (else NULL — feeds, ISLA kits, chemicals, etc.)
--   Marketing sold-per-participant-per-valuechain is computed from
--   production_and_marketing_tool (pdn_level='marketing'), summing the sold
--   columns qty_sold + poultry_sold + meat_sold + milk_sold + sale.
--
-- Materialized as `items_not_sold_rows` (only Has_Sold='No' rows are stored).
-- Filters: ValueChain, District, Days_Since_Distribution.
-- ============================================================================

drop table if exists public.items_not_sold_rows cascade;
create table public.items_not_sold_rows (
  participant_name         text,
  participant_id           text,
  gender                   text,
  shg_group_name           text,
  district                 text,
  subcounty                text,
  unit_received            text,
  qty_received             numeric,
  other_unit_received      text,
  plot_size                text,
  parish                   text,
  village                  text,
  material_type            text,
  other_material_type      text,
  livestock_type           text,
  other_livestock_type     text,
  crop_type                text,
  other_crop_type          text,
  agri_resources_type      text,
  other_agri_resources_type text,
  isla_kits                text,
  other_isla_kits          text,
  qty_kgs                  numeric,
  qty_grams                numeric,
  qty_liters               numeric,
  qty_seedlings            numeric,
  qty_packets              numeric,
  qty_tins                 numeric,
  qty_pieces               numeric,
  qty_dozens               numeric,
  qty_sackets              numeric,
  qty_boxes                numeric,
  qty_number               numeric,
  qty_meters               numeric,
  qty_kit                  numeric,
  qty_hectare              numeric,
  qty_acre                 numeric,
  qty_foot                 numeric,
  qty_other                numeric,
  distribution_date        date,
  partner                  text,
  supplier                 text,
  other_supplier           text,
  distributor              text,
  distributor_title        text,
  submitted_by             text,
  distribution_id          text,
  submission_date          date,
  has_sold                 text,
  has_produced             text,
  total_qty_sold           numeric,
  days_since_distribution  int,
  value_chain              text,
  shg_id                   text
);
create index items_not_sold_vc_idx   on public.items_not_sold_rows (value_chain);
create index items_not_sold_dist_idx  on public.items_not_sold_rows (district);
create index items_not_sold_days_idx  on public.items_not_sold_rows (days_since_distribution);
create index items_not_sold_pid_idx   on public.items_not_sold_rows (participant_id);
grant select on public.items_not_sold_rows to anon, service_role;

-- ---- Rebuild items_not_sold_rows -------------------------------------------
create or replace function public.refresh_items_not_sold_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.items_not_sold_rows;

  -- ==========================================================================
  -- ITEMS NOT SOLD (redefined 2026-10, participant-ID anti-join).
  -- A participant appears here when they HAVE an item (produced OR received)
  -- but have NO marketing record for that item's value chain. Tracked by
  -- participant_id, in TWO streams:
  --
  --   STREAM 1 — CROPS (Horticulture / Oil seeds):
  --     IN  production_rows (pdn_level='production', value_chain hort/oilseed)
  --     NOT IN sales_rows  (marketing, same value_chain)   [by shg_participant_id]
  --     -> captures growers who never sold, incl. the whole Central cluster
  --        whose activity is production-only.
  --
  --   STREAM 2 — LIVESTOCK (Poultry / Goats / etc.):
  --     IN  distribution_rows (material_type='livestock', unit='Number')
  --     NOT IN poultry marketing (sales_rows value_chain='Poultry')  [by participant_id]
  --     -> captures bird/animal recipients who never sold, incl. recent
  --        distributions.
  --
  -- Marketing "sold" sets use the SAME definitions as the sales dashboards.
  -- ==========================================================================

  -- Marketing sellers per value chain (from pdn_level='marketing'); a seller is
  -- anyone with a POSITIVE sold quantity in that chain.
  insert into public.items_not_sold_rows
  with mkt_hort as (
    select distinct shg_participant_id as pid
    from public.sales_rows
    where lower(coalesce(value_chain,'')) in ('horticulture')
      and coalesce(total_planting_value,0) > 0
  ),
  mkt_oil as (
    select distinct shg_participant_id as pid
    from public.sales_rows
    where lower(coalesce(value_chain,'')) in ('oil seeds','oilseeds','oil_seeds')
      and coalesce(total_planting_value,0) > 0
  ),
  mkt_poultry as (
    select distinct shg_participant_id as pid
    from public.poultry_sales_rows
    where coalesce(total_poultry_value,0) > 0 or coalesce(poultry_sold,0) > 0
  ),
  -- ---- STREAM 1: crop producers who did NOT market the crop ----------------
  stream_crops as (
    select
      pr.participant_name                         as participant_name,
      pr.shg_participant_id                       as participant_id,
      pr.disability_status                        as gender,  -- production has no sex; keep disability flag slot
      pr.shg_name                                 as shg_group_name,
      public.mel_canon_district(pr.district_name) as district,
      null::text                                  as subcounty,
      pr.qty_seed_measure                         as unit_received,
      pr.acres                                    as qty_received,
      null::text                                  as other_unit_received,
      null::text                                  as plot_size,
      null::text as parish, null::text as village,
      'Crop production'::text                     as material_type,
      null::text as other_material_type,
      null::text as livestock_type, null::text as other_livestock_type,
      coalesce(nullif(pr.horticulture,''), nullif(pr.oil_seeds,''), pr.value_chain) as crop_type,
      null::text as other_crop_type,
      null::text as agri_resources_type, null::text as other_agri_resources_type,
      null::text as isla_kits, null::text as other_isla_kits,
      null::numeric as qty_kgs, null::numeric as qty_grams, null::numeric as qty_liters,
      null::numeric as qty_seedlings, null::numeric as qty_packets, null::numeric as qty_tins,
      null::numeric as qty_pieces, null::numeric as qty_dozens, null::numeric as qty_sackets,
      null::numeric as qty_boxes, null::numeric as qty_number, null::numeric as qty_meters,
      null::numeric as qty_kit, null::numeric as qty_hectare,
      pr.acres as qty_acre, null::numeric as qty_foot, pr.qty_seed as qty_other,
      pr.activity_date                            as distribution_date,
      null::text as partner, null::text as supplier, null::text as other_supplier,
      pr.profilers_name                           as distributor,
      null::text as distributor_title,
      pr.profilers_name                           as submitted_by,
      pr.ref_id                                   as distribution_id,
      pr.activity_date                            as submission_date,
      'No'::text                                  as has_sold,
      'Yes'::text                                 as has_produced,
      null::numeric                               as total_qty_sold,
      case when pr.activity_date is not null
           then (current_date - pr.activity_date)::int else null end as days_since_distribution,
      initcap(pr.value_chain)                     as value_chain,
      pr.shg_id                                   as shg_id
    from public.production_rows pr
    where lower(pr.pdn_level)='production'
      and pr.shg_participant_id is not null
      and (
        (lower(pr.value_chain)='horticulture'
             and pr.shg_participant_id not in (select pid from mkt_hort where pid is not null))
        or
        (lower(pr.value_chain) in ('oil seeds','oilseeds','oil_seeds')
             and pr.shg_participant_id not in (select pid from mkt_oil where pid is not null))
      )
  ),
  -- ---- STREAM 2: livestock recipients who did NOT market poultry ----------
  stream_livestock as (
    select
      d.participant_name                          as participant_name,
      d.participant_id                            as participant_id,
      null::text                                  as gender,
      d.shg_name                                  as shg_group_name,
      public.mel_canon_district(d.district)       as district,
      d.subcounty                                 as subcounty,
      d.unit                                      as unit_received,
      d.qty_received                              as qty_received,
      null::text                                  as other_unit_received,
      null::text                                  as plot_size,
      null::text as parish, null::text as village,
      d.material_type                             as material_type,
      null::text as other_material_type,
      d.livestock_type                            as livestock_type,
      null::text as other_livestock_type,
      d.crop_type                                 as crop_type,
      null::text as other_crop_type,
      d.agri_resources_type                       as agri_resources_type,
      null::text as other_agri_resources_type,
      d.isla_kits                                 as isla_kits,
      null::text as other_isla_kits,
      null::numeric as qty_kgs, null::numeric as qty_grams, null::numeric as qty_liters,
      null::numeric as qty_seedlings, null::numeric as qty_packets, null::numeric as qty_tins,
      null::numeric as qty_pieces, null::numeric as qty_dozens, null::numeric as qty_sackets,
      null::numeric as qty_boxes, d.qty_received as qty_number, null::numeric as qty_meters,
      null::numeric as qty_kit, null::numeric as qty_hectare,
      null::numeric as qty_acre, null::numeric as qty_foot, null::numeric as qty_other,
      d.dist_date                                 as distribution_date,
      null::text                                  as partner,
      d.supplier                                  as supplier,
      null::text as other_supplier,
      d.submitted_by                              as distributor,
      null::text as distributor_title,
      d.submitted_by                              as submitted_by,
      null::text                                  as distribution_id,
      d.dist_date                                 as submission_date,
      'No'::text                                  as has_sold,
      'No'::text                                  as has_produced,
      null::numeric                               as total_qty_sold,
      case when d.dist_date is not null
           then (current_date - d.dist_date)::int else null end as days_since_distribution,
      coalesce(initcap(nullif(d.livestock_type,'')), 'Livestock') as value_chain,
      null::text                                  as shg_id
    from public.distribution_rows d
    where lower(coalesce(d.material_type,''))='livestock'
      and lower(coalesce(d.unit,''))='number'
      and d.participant_id is not null
      and d.participant_id not in (select pid from mkt_poultry where pid is not null)
  )
  select participant_name, participant_id, gender, shg_group_name, district, subcounty,
         unit_received, qty_received, other_unit_received, plot_size, parish, village,
         material_type, other_material_type, livestock_type, other_livestock_type,
         crop_type, other_crop_type, agri_resources_type, other_agri_resources_type,
         isla_kits, other_isla_kits,
         qty_kgs, qty_grams, qty_liters, qty_seedlings, qty_packets, qty_tins,
         qty_pieces, qty_dozens, qty_sackets, qty_boxes, qty_number, qty_meters,
         qty_kit, qty_hectare, qty_acre, qty_foot, qty_other,
         distribution_date, partner, supplier, other_supplier, distributor,
         distributor_title, submitted_by, distribution_id, submission_date,
         has_sold, has_produced, total_qty_sold, days_since_distribution,
         value_chain, shg_id
  from (
    select * from stream_crops
    union all
    select * from stream_livestock
  ) u;

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_items_not_sold_rows() set statement_timeout='120000';
grant execute on function public.refresh_items_not_sold_rows() to service_role;

-- ---- Dashboard aggregate: KPIs + detail rows + slicers ---------------------
create or replace function public.items_not_sold_dash(
  p_valuechains text[] default null,
  p_districts   text[] default null,
  p_days_min    int    default null,
  p_days_max    int    default null,
  p_limit       int    default 5000
)
returns jsonb
language sql
stable
as $$
  with sel as (
    select
      case when p_valuechains is null or array_length(p_valuechains,1) is null then null else p_valuechains end as vl,
      -- Canonicalise district picks so one pick matches all spellings.
      case when p_districts   is null or array_length(p_districts,1)   is null then null
           else (select array_agg(public.mel_canon_district(x)) from unnest(p_districts) x) end as dl
  ),
  f as (
    select r.* from public.items_not_sold_rows r, sel
    where (sel.vl is null or coalesce(r.value_chain,'(Blank)') = any(sel.vl))
      and (sel.dl is null or public.mel_canon_district(coalesce(r.district,'(Blank)')) = any(sel.dl))
      and (p_days_min is null or coalesce(r.days_since_distribution,-1) >= p_days_min)
      and (p_days_max is null or coalesce(r.days_since_distribution, 2147483647) <= p_days_max)
  )
  select jsonb_build_object(
    'unique_participants', (select count(distinct participant_id) from f where participant_id is not null),
    'unique_shgs',         (select count(distinct shg_group_name) from f where shg_group_name is not null),
    'total_items',         (select count(*) from f),
    'rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.days_since_distribution desc nulls last), '[]'::jsonb)
             from (select * from f order by days_since_distribution desc nulls last limit p_limit) t),
    'value_chains', (select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
                     from (select distinct coalesce(nullif(trim(value_chain),''),'(Blank)') as v
                           from public.items_not_sold_rows) x),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(public.mel_canon_district_disp(district),'(Blank)') as d
                        from public.items_not_sold_rows) x),
    'days_bounds', (select jsonb_build_object(
                      'min', coalesce(min(days_since_distribution),0),
                      'max', coalesce(max(days_since_distribution),0))
                    from public.items_not_sold_rows)
  );
$$;
alter function public.items_not_sold_dash(text[],text[],int,int,int) set statement_timeout='40000';
grant execute on function public.items_not_sold_dash(text[],text[],int,int,int) to anon, service_role;

-- ---- Lightweight slicer option lists only ----------------------------------
create or replace function public.items_not_sold_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'value_chains', (select coalesce(jsonb_agg(v order by v), '[]'::jsonb)
                     from (select distinct coalesce(nullif(trim(value_chain),''),'(Blank)') as v
                           from public.items_not_sold_rows) x),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(public.mel_canon_district_disp(district),'(Blank)') as d
                        from public.items_not_sold_rows) x),
    'days_bounds', (select jsonb_build_object(
                      'min', coalesce(min(days_since_distribution),0),
                      'max', coalesce(max(days_since_distribution),0))
                    from public.items_not_sold_rows)
  );
$$;
alter function public.items_not_sold_options() set statement_timeout='20000';
grant execute on function public.items_not_sold_options() to anon, service_role;
