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
  with
  -- Heifer participant-id district prefix map (last-resort district source when
  -- the event has no district_name and the participant isn't profiled — same
  -- fallback used by the distribution_rows rebuild).
  pfxmap(pfx, dist) as (values
    ('IGA','IGANGA'),('JIN','JINJA'),('MAY','MAYUGE'),('LUU','LUUKA'),
    ('KAM','KAMULI'),('KAL','KALIRO'),('BUY','BUYENDE'),('BUG','BUGIRI'),
    ('NAM','NAMUTUMBA'),('BGW','BUGWERI'),('NMY','NAMAYINGO'),
    ('KAY','KAYUNGA'),('BUI','BUIKWE'),('MUK','MUKONO')
  ),
  dist as (
    -- one row per received item. SOURCE CHANGED (2026-10): the MIS-synced
    -- participants_shg records lost their __Submissions-id link key (now 100%
    -- blank), which silently froze this table (the join produced 0 rows on
    -- refresh, so the dashboard stopped getting recent districts/records). We
    -- now read the OData distribution pipeline (odata_dist_participants ⋈
    -- odata_dist_events on submission_id = doc_id) — the SAME working source as
    -- distribution_rows — so refreshes stay current. District is resolved via
    -- event -> participant profile -> HEI-id prefix so nothing lands blank.
    select
      nullif(trim(p.participant_name),'')                as participant_name,
      nullif(trim(p.shg_participant_id),'')              as participant_id,
      nullif(trim(p.sex),'')                             as gender,
      nullif(trim(dp.shg_name),'')                       as shg_group_name,
      public.mel_canon_district(coalesce(
        nullif(trim(dp.district_name),''),
        nullif(trim(e.district_name),''),
        (select m.dist from pfxmap m where m.pfx = upper(substring(p.shg_participant_id from '^[A-Za-z]+-([A-Za-z]+)-' ))),
        ''
      ))                                                  as district,
      nullif(trim(e.subcounty_name),'')                  as subcounty,
      nullif(trim(p.unit_received),'')                   as unit_received,
      coalesce(p.qty_received,0)                         as qty_received,
      null::text                                         as other_unit_received,
      nullif(trim(p.plot_size),'')                       as plot_size,
      nullif(trim(e.parish),'')                          as parish,
      nullif(trim(e.village),'')                         as village,
      nullif(trim(e.material_type),'')                   as material_type,
      null::text                                         as other_material_type,
      nullif(trim(e.livestock_type),'')                  as livestock_type,
      null::text                                         as other_livestock_type,
      nullif(trim(e.crop_type),'')                       as crop_type,
      null::text                                         as other_crop_type,
      nullif(trim(e.agri_resources_type),'')             as agri_resources_type,
      null::text                                         as other_agri_resources_type,
      nullif(trim(e.isla_kits),'')                       as isla_kits,
      null::text                                         as other_isla_kits,
      case when lower(e.unit)='kgs'       then coalesce(p.qty_received,0) end as qty_kgs,
      case when lower(e.unit)='grams'     then coalesce(p.qty_received,0) end as qty_grams,
      case when lower(e.unit)='liters'    then coalesce(p.qty_received,0) end as qty_liters,
      case when lower(e.unit)='seedlings' then coalesce(p.qty_received,0) end as qty_seedlings,
      case when lower(e.unit)='packets'   then coalesce(p.qty_received,0) end as qty_packets,
      case when lower(e.unit)='tins'      then coalesce(p.qty_received,0) end as qty_tins,
      case when lower(e.unit)='pieces'    then coalesce(p.qty_received,0) end as qty_pieces,
      case when lower(e.unit)='dozens'    then coalesce(p.qty_received,0) end as qty_dozens,
      case when lower(e.unit)='sackets'   then coalesce(p.qty_received,0) end as qty_sackets,
      case when lower(e.unit)='boxes'     then coalesce(p.qty_received,0) end as qty_boxes,
      case when lower(e.unit)='number'    then coalesce(p.qty_received,0) end as qty_number,
      case when lower(e.unit)='meters'    then coalesce(p.qty_received,0) end as qty_meters,
      case when lower(e.unit) in ('kit','set/kit','set_slash_kit') then coalesce(p.qty_received,0) end as qty_kit,
      case when lower(e.unit)='hectare'   then coalesce(p.qty_received,0) end as qty_hectare,
      case when lower(e.unit)='acre'      then coalesce(p.qty_received,0) end as qty_acre,
      case when lower(e.unit)='foot'      then coalesce(p.qty_received,0) end as qty_foot,
      case when lower(e.unit)='other'     then coalesce(p.qty_received,0) end as qty_other,
      case when e.distribution_date ~ '^\d{4}-\d{2}-\d{2}'
           then (left(e.distribution_date,10))::date else null end as distribution_date,
      nullif(trim(e.partner),'')                         as partner,
      nullif(trim(e.supplier),'')                        as supplier,
      null::text                                         as other_supplier,
      nullif(trim(e.distributor),'')                     as distributor,
      nullif(trim(e.distributor_title),'')               as distributor_title,
      nullif(trim(e.distributor),'')                     as submitted_by,
      e.doc_id                                           as distribution_id,
      case when e.date_created ~ '^\d{4}-\d{2}-\d{2}'
           then (left(e.date_created,10))::date else null end as submission_date,
      -- derived value chain from the distributed item
      case
        when e.livestock_type ilike 'Poultry%' then 'Poultry'
        when e.crop_type ilike '%g.nut%'
          or e.crop_type ilike '%soy%'          then 'Oil seeds'
        when e.crop_type ilike '%tomato%'
          or e.crop_type ilike '%watermelon%'
          or e.crop_type ilike '%vegetable%'
          or e.crop_type ilike '%passion%'
          or e.crop_type ilike '%onion%'
          or e.crop_type ilike '%pumpkin%'      then 'Horticulture'
        else null
      end as value_chain
    from public.odata_dist_participants p
    join public.odata_dist_events e on e.doc_id = p.submission_id
    left join public.dim_profile dp on dp.participant_id = p.shg_participant_id
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
