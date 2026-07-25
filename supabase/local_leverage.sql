-- ============================================================================
-- LOCAL LEVERAGE dashboard
--
--   Source master : local_leverage_fund_contribution_form (OData feed
--                   local_leverage_fund_contribution_form_odata_view), ingested
--                   into public.records like every other master.
--
--   The free-text column `contribution_kind` describes what each SHG/youth
--   contributed toward a local leverage fund (mostly venue/seating items, but
--   also land, poultry equipment, agri-inputs, refreshments, fees, labour ...).
--   We map every word/phrase into a small set of NLP-derived categories
--   (public.leverage_category(text)) so the dashboard can group + slice by
--   category. Reference buckets supplied by the user:
--       Animal Structures and Equipment, Others, Commitment Fee,
--       Land Hire and Cultivation, Venue and Seats, Chemicals and Fertilizers,
--       Refreshments.
--   We extend those with Labour and Transport (a real cluster in the data).
--
-- Materialized as `local_leverage_rows` (one row per contribution record).
-- Filters: Category, District, Type of Entity.
-- ============================================================================

-- ---- NLP category mapper ---------------------------------------------------
-- Priority-ordered keyword matching on the lower-cased contribution_kind text.
-- Venue/seating dominates (~70% of rows) so it is checked broadly; more
-- specific buckets (animal/agri/chem) are checked first where they are
-- unambiguous, then generic seating, then the small buckets.
create or replace function public.leverage_category(p_kind text)
returns text
language sql
immutable
as $$
  with t as (select lower(coalesce(p_kind,'')) as k)
  select case
    -- blanks / explicit N/A --------------------------------------------------
    when (select btrim(k) from t) in ('', 'na', 'n/a', 'none', 'nil', 'nothing', 'inkind', 'in kind', 'in-kind')
      then 'Others'

    -- Commitment / registration / savings fees -------------------------------
    when (select k from t) ~ '(commit+ement|commitment|registration|membership|subscription|savings?|saving\s|contribution fee|joining|welfare fund|share fund)'
      then 'Commitment Fee'

    -- Chemicals & Fertilizers ------------------------------------------------
    when (select k from t) ~ '(fertili[sz]er|pesticide|herbicide|insecticide|fungicide|agro.?chemical|chemical|spray|acaricide|dewormer|vaccine|vaccination|drug|medicine|treatment)'
      then 'Chemicals and Fertilizers'

    -- Animal / Poultry structures & equipment --------------------------------
    when (select k from t) ~ '(poultry|chick|bird|hen|layer|broiler|cockerel|drinker|feeder|waterer|brooder|pen\b|poultry house|chicken house|coop|feeds?\b|husk|maize bran|goat|pig|piggery|swine|cattle|cow shed|kraal|shelter|structure|housing|hutch|manure)'
      then 'Animal Structures and Equipment'

    -- Land hire & cultivation ------------------------------------------------
    when (select k from t) ~ '(land|plough|plow|garden|weed|cultivat|digging|ploughing|hoe|tractor|planting|slashing|clearing|acre|opening|seedling|\bseeds?\b|g\.?nut|soya?bean|mulch)'
      then 'Land Hire and Cultivation'

    -- Refreshments -----------------------------------------------------------
    when (select k from t) ~ '(refreshment|soda|water\b|drinking water|tea\b|coffee|food|lunch|snack|sugar|bread|juice|meals?|eats\b|charcoal|firewood|cooking|catering)'
      then 'Refreshments'

    -- Labour & transport -----------------------------------------------------
    when (select k from t) ~ '(labour|labor|casual|porter|worker|transport|fuel|motor|boda|fare|cleaning|carrying|loading|offloading)'
      then 'Labour and Transport'

    -- Venue & seats (broad catch for the dominant seating cluster) -----------
    when (select k from t) ~ '(venue|vennue|vanue|hall|space|place|room|compound|ground|seat|sit\b|sits|chair|bench|mat\b|mats|table|desk|stool|furniture|shade|tent|canopy|shelter for meeting|sitting|meeting place)'
      then 'Venue and Seats'

    -- Cash / money (uncategorised monetary) ----------------------------------
    when (select k from t) ~ '(cash|money|funds?|shillings|ugx|amount)'
      then 'Commitment Fee'

    else 'Others'
  end;
$$;
grant execute on function public.leverage_category(text) to anon, service_role;

-- ---- Fact table ------------------------------------------------------------
drop table if exists public.local_leverage_rows cascade;
create table public.local_leverage_rows (
  contribution_kind    text,
  category             text,
  district             text,
  subcounty            text,
  type_of_entity       text,
  type_of_contribution text,
  other_details        text,
  contribution_amount  numeric,
  submitter_name       text,
  submitter_position   text,
  partner              text,
  doc_id               text,
  date_created         date
);
create index local_leverage_cat_idx    on public.local_leverage_rows (category);
create index local_leverage_dist_idx   on public.local_leverage_rows (district);
create index local_leverage_entity_idx on public.local_leverage_rows (type_of_entity);
grant select on public.local_leverage_rows to anon, service_role;

-- ---- Rebuild local_leverage_rows -------------------------------------------
create or replace function public.refresh_local_leverage_rows()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.local_leverage_rows;

  insert into public.local_leverage_rows
  select
    nullif(trim(data->>'contribution_kind'),'')                     as contribution_kind,
    public.leverage_category(data->>'contribution_kind')            as category,
    upper(nullif(trim(data->>'district_name'),''))                  as district,
    initcap(nullif(trim(data->>'subcounty_name'),''))               as subcounty,
    nullif(trim(data->>'type_of_entity'),'')                        as type_of_entity,
    nullif(trim(data->>'type_of_contribution'),'')                  as type_of_contribution,
    nullif(trim(data->>'other_contribution_details'),'')            as other_details,
    nnum(data->>'contribution_amount')                              as contribution_amount,
    nullif(trim(data->>'submitter_name'),'')                        as submitter_name,
    nullif(trim(data->>'submitter_position'),'')                    as submitter_position,
    nullif(trim(data->>'partner'),'')                               as partner,
    nullif(trim(data->>'docId'),'')                                 as doc_id,
    case when (data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(data->>'dateCreated',10))::date else null end   as date_created
  from public.records
  where template='local_leverage_fund_contribution_form';

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_local_leverage_rows() set statement_timeout='120000';
grant execute on function public.refresh_local_leverage_rows() to service_role;

-- ---- Dashboard aggregate: KPIs + category breakdown + detail rows ----------
-- Slicers (per user request): District + Date range (date_created).
-- Category is the VISUAL grouping (the arch/napkin cards), not a slicer.
create or replace function public.local_leverage_dash(
  p_districts  text[] default null,
  p_date_from  date   default null,
  p_date_to    date   default null,
  p_limit      int    default 5000
)
returns jsonb
language sql
stable
as $$
  with sel as (
    select
      case when p_districts is null or array_length(p_districts,1) is null then null else p_districts end as dl
  ),
  f as (
    select r.* from public.local_leverage_rows r, sel
    where (sel.dl is null or coalesce(r.district,'(Blank)') = any(sel.dl))
      and (p_date_from is null or r.date_created >= p_date_from)
      and (p_date_to   is null or r.date_created <= p_date_to)
  )
  select jsonb_build_object(
    'total_contributions', (select count(*) from f),
    'total_amount',        (select coalesce(sum(contribution_amount),0) from f),
    'categories_count',    (select count(distinct category) from f where category is not null),
    'districts_count',     (select count(distinct district) from f where district is not null),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object(
                        'category', category, 'contributions', cnt, 'amount', amt) order by amt desc), '[]'::jsonb)
                    from (select coalesce(category,'Others') as category,
                                 count(*) as cnt, coalesce(sum(contribution_amount),0) as amt
                          from f group by 1) c),
    'rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.date_created desc nulls last), '[]'::jsonb)
             from (select * from f order by date_created desc nulls last limit p_limit) t),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district),''),'(Blank)') as d
                        from public.local_leverage_rows) x),
    'date_bounds', (select jsonb_build_object(
                      'min', to_char(min(date_created),'YYYY-MM-DD'),
                      'max', to_char(max(date_created),'YYYY-MM-DD'))
                    from public.local_leverage_rows)
  );
$$;
alter function public.local_leverage_dash(text[],date,date,int) set statement_timeout='40000';
grant execute on function public.local_leverage_dash(text[],date,date,int) to anon, service_role;

-- ---- Lightweight slicer option lists only ----------------------------------
create or replace function public.local_leverage_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(nullif(trim(district),''),'(Blank)') as d
                        from public.local_leverage_rows) x),
    'date_bounds', (select jsonb_build_object(
                      'min', to_char(min(date_created),'YYYY-MM-DD'),
                      'max', to_char(max(date_created),'YYYY-MM-DD'))
                    from public.local_leverage_rows)
  );
$$;
alter function public.local_leverage_options() set statement_timeout='20000';
grant execute on function public.local_leverage_options() to anon, service_role;
