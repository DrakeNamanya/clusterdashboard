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

  insert into public.items_not_sold_rows
  with dist as (
    -- one row per received item (participant detail from participants_shg,
    -- material/qty breakdown from distribution_form_v2).
    select
      nullif(trim(p.data->>'participant_name'),'')       as participant_name,
      nullif(trim(p.data->>'shg_participant_id'),'')      as participant_id,
      nullif(trim(p.data->>'sex'),'')                     as gender,
      nullif(trim(p.data->>'shg_name'),'')                as shg_group_name,
      upper(nullif(trim(coalesce(d.data->>'district_name', p.data->>'district')),'')) as district,
      nullif(trim(coalesce(d.data->>'Subcounty_name', p.data->>'subcounty')),'') as subcounty,
      nullif(trim(p.data->>'shg_unit_received'),'')       as unit_received,
      nnum(p.data->>'shg_qty_received')                   as qty_received,
      nullif(trim(p.data->>'other_shg_unit_received'),'') as other_unit_received,
      nullif(trim(p.data->>'shg_plot_size'),'')           as plot_size,
      nullif(trim(d.data->>'parish'),'')                  as parish,
      nullif(trim(d.data->>'village'),'')                 as village,
      nullif(trim(d.data->>'material_type'),'')           as material_type,
      nullif(trim(d.data->>'other_material_type'),'')     as other_material_type,
      nullif(trim(d.data->>'livestock_type'),'')          as livestock_type,
      nullif(trim(d.data->>'other_livestock_type'),'')    as other_livestock_type,
      nullif(trim(d.data->>'crop_type'),'')               as crop_type,
      nullif(trim(d.data->>'other_crop_type'),'')         as other_crop_type,
      nullif(trim(d.data->>'agri_resources_type'),'')     as agri_resources_type,
      nullif(trim(d.data->>'other_agri_resources_type'),'') as other_agri_resources_type,
      nullif(trim(d.data->>'isla_kits'),'')               as isla_kits,
      nullif(trim(d.data->>'other_isla_kits'),'')         as other_isla_kits,
      nnum(d.data->>'qty_distributed_kgs')                as qty_kgs,
      nnum(d.data->>'qty_distributed_grams')              as qty_grams,
      nnum(d.data->>'qty_distributed_liters')             as qty_liters,
      nnum(d.data->>'qty_distributed_seedlings')          as qty_seedlings,
      nnum(d.data->>'qty_distributed_packets')            as qty_packets,
      nnum(d.data->>'qty_distributed_tins')               as qty_tins,
      nnum(d.data->>'qty_distributed_pieces')             as qty_pieces,
      nnum(d.data->>'qty_distributed_dozens')             as qty_dozens,
      nnum(d.data->>'qty_distributed_sackets')            as qty_sackets,
      nnum(d.data->>'qty_distributed_boxes')              as qty_boxes,
      nnum(d.data->>'qty_distributed_number')             as qty_number,
      nnum(d.data->>'qty_distributed_meters')             as qty_meters,
      nnum(d.data->>'qty_distributed_kit')                as qty_kit,
      nnum(d.data->>'qty_distributed_hectare')            as qty_hectare,
      nnum(d.data->>'qty_distributed_acre')               as qty_acre,
      nnum(d.data->>'qty_distributed_foot')               as qty_foot,
      nnum(d.data->>'qty_distributed_other')              as qty_other,
      case when (d.data->>'distribution_date') ~ '^\d{4}-\d{2}-\d{2}'
           then (left(d.data->>'distribution_date',10))::date else null end as distribution_date,
      nullif(trim(d.data->>'partner'),'')                 as partner,
      nullif(trim(d.data->>'supplier'),'')                as supplier,
      nullif(trim(d.data->>'other_supplier'),'')          as other_supplier,
      nullif(trim(d.data->>'distributor'),'')             as distributor,
      nullif(trim(d.data->>'distributor_title'),'')       as distributor_title,
      nullif(trim(d.data->>'submitterName'),'')           as submitted_by,
      nullif(trim(d.data->>'unique_id'),'')               as distribution_id,
      case when (d.data->>'submissionDate') ~ '^\d{4}-\d{2}-\d{2}'
           then (left(d.data->>'submissionDate',10))::date else null end as submission_date,
      -- derived value chain from the distributed item
      case
        when d.data->>'livestock_type' ilike 'Poultry%' then 'Poultry'
        when d.data->>'crop_type' ilike '%g.nut%'
          or d.data->>'crop_type' ilike '%soy%'          then 'Oil seeds'
        when d.data->>'crop_type' ilike '%tomato%'
          or d.data->>'crop_type' ilike '%watermelon%'
          or d.data->>'crop_type' ilike '%vegetable%'
          or d.data->>'crop_type' ilike '%passion%'
          or d.data->>'crop_type' ilike '%onion%'
          or d.data->>'crop_type' ilike '%pumpkin%'      then 'Horticulture'
        else null
      end as value_chain
    from public.records p
    join public.records d
      on d.template='distribution_form_v2'
     and (p.data->>'__Submissions-id') = (d.data->>'_id')
    where p.template='participants_shg'
      and nullif(trim(p.data->>'__Submissions-id'),'') is not null
  ),
  -- shg_id for each participant (from participants master), for reference.
  shgmap as (
    select
      nullif(trim(data->>'refID'),'')   as ref_id,
      max(nullif(trim(data->>'shg_id'),'')) as shg_id
    from public.records
    where template='participants' and nullif(trim(data->>'refID'),'') is not null
    group by nullif(trim(data->>'refID'),'')
  ),
  -- marketing sold quantities per participant per value chain.
  mkt as (
    select
      nullif(trim(data->>'shg_participant_id'),'')  as participant_id,
      nullif(trim(data->>'value_chain'),'')          as value_chain,
      sum(
        coalesce(nnum(data->>'qty_sold'),0)
        + coalesce(nnum(data->>'poultry_sold'),0)
        + coalesce(nnum(data->>'meat_sold'),0)
        + coalesce(nnum(data->>'milk_sold'),0)
        + coalesce(nnum(data->>'sale'),0)
      ) as qty_sold
    from public.records
    where template='production_and_marketing_tool'
      and lower(data->>'pdn_level')='marketing'
      and nullif(trim(data->>'shg_participant_id'),'') is not null
    group by 1,2
  ),
  -- has this participant sold ANYTHING (any value chain)? used as fallback for
  -- items whose value chain we cannot derive.
  mktany as (
    select participant_id, sum(qty_sold) as qty_sold_any
    from mkt group by participant_id
  ),
  matrix as (
    select
      dist.*,
      sm.shg_id                                          as shg_id_real,
      -- per-value-chain sold qty when we know the chain, else any-chain total
      case when dist.value_chain is not null
           then coalesce(mvc.qty_sold, 0)
           else coalesce(ma.qty_sold_any, 0) end          as total_qty_sold,
      case
        when dist.value_chain is not null then
          case when coalesce(mvc.qty_sold,0) > 0 then 'Yes' else 'No' end
        else
          case when coalesce(ma.qty_sold_any,0) > 0 then 'Yes' else 'No' end
      end                                                 as has_sold,
      case when dist.distribution_date is not null
           then (current_date - dist.distribution_date)::int else null end as days_since
    from dist
    left join shgmap sm  on sm.ref_id = dist.participant_id
    left join mkt mvc    on mvc.participant_id = dist.participant_id
                        and mvc.value_chain    = dist.value_chain
    left join mktany ma  on ma.participant_id = dist.participant_id
  )
  select
    participant_name, participant_id, gender, shg_group_name, district, subcounty,
    unit_received, qty_received, other_unit_received, plot_size, parish, village,
    material_type, other_material_type, livestock_type, other_livestock_type,
    crop_type, other_crop_type, agri_resources_type, other_agri_resources_type,
    isla_kits, other_isla_kits,
    qty_kgs, qty_grams, qty_liters, qty_seedlings, qty_packets, qty_tins,
    qty_pieces, qty_dozens, qty_sackets, qty_boxes, qty_number, qty_meters,
    qty_kit, qty_hectare, qty_acre, qty_foot, qty_other,
    distribution_date, partner, supplier, other_supplier, distributor,
    distributor_title, submitted_by, distribution_id, submission_date,
    has_sold,
    'No'::text as has_produced,
    nullif(total_qty_sold,0)  as total_qty_sold,
    days_since as days_since_distribution,
    value_chain,
    shg_id_real as shg_id
  from matrix
  where has_sold = 'No';

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
      case when p_districts   is null or array_length(p_districts,1)   is null then null else p_districts   end as dl
  ),
  f as (
    select r.* from public.items_not_sold_rows r, sel
    where (sel.vl is null or coalesce(r.value_chain,'(Blank)') = any(sel.vl))
      and (sel.dl is null or coalesce(r.district,'(Blank)')    = any(sel.dl))
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
                  from (select distinct coalesce(nullif(trim(district),''),'(Blank)') as d
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
                  from (select distinct coalesce(nullif(trim(district),''),'(Blank)') as d
                        from public.items_not_sold_rows) x),
    'days_bounds', (select jsonb_build_object(
                      'min', coalesce(min(days_since_distribution),0),
                      'max', coalesce(max(days_since_distribution),0))
                    from public.items_not_sold_rows)
  );
$$;
alter function public.items_not_sold_options() set statement_timeout='20000';
grant execute on function public.items_not_sold_options() to anon, service_role;
