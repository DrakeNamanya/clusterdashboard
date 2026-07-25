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
  -- NOTE: PostgreSQL POSIX regex uses \y (word boundary), \m (start-of-word)
  -- and \M (end-of-word). It does NOT understand \b — so never use \b here.
  with t as (select lower(coalesce(p_kind,'')) as k)
  select case
    -- blanks / explicit N/A / pure numbers / bare person-names go to Others.
    when (select btrim(k) from t) in ('', 'na', 'n/a', 'none', 'nil', 'nothing',
         'inkind', 'in kind', 'in-kind', 'kind', 'contribution in kind',
         'youth contribution in kind', 'you contribution', 'youth', 'contribution',
         'item', 'materials', 'plastic', 'bbbb', 'eb', 'cha', 'visla')
      then 'Others'
    when (select k from t) ~ '^\s*[0-9]+\s*$'   -- pure numeric amounts, no kind
      then 'Others'

    -- Commitment / registration / savings / payments / fees ------------------
    -- (per client: "payment, seed contribution ... commitment fee" — treat all
    --  monetary / co-funding / contribution-payment phrases as Commitment Fee.)
    when (select k from t) ~ '(commit+e?ment|registration|membership|subscription|\ysavings?\y|contribution fee|joining|welfare fund|share fund|\yfees?\y|upfront|advance[d]? *pay|advanced? payment|\ypayment|rebooking|\ycash\y|\ymoney\y|\ymomey\y|\yfunds?\y|shillings|\yugx\y|isla loan|\yloan|co.?fund|counterpart|top.?up|\ycontributed|deposit|\yrent\y|renting|\yhire\y)'
      then 'Commitment Fee'

    -- Chemicals & Fertilizers (incl. common Ugandan agro-input brand names) --
    when (select k from t) ~ '(fertili[sz]er|pesticide|herbicide|insecticide|fungicide|agro.?chemical|\ychemical|spray|acaricide|dewormer|vaccine|vaccination|\ydrug|medicine|\ydap\y|\yurea\y|npk|super *gro|next *gro|rapid *gro|green *gro|green *organic|vigamax|striker|caterpillar *force|fungo *force|fungal *cure|dudu *accel|nsanja|\ycopper\y|agro *input|agro-input|indofil|indoli|back *off|hariza|hwriza|multi *nkp|farm *input|farm *chemical|\ymancozeb|rocket)'
      then 'Chemicals and Fertilizers'

    -- Animal / Poultry structures & equipment (incl. building materials) -----
    when (select k from t) ~ '(poultry|chick|\ybird|\yhen\y|layer|broiler|cockerel|drinker|feeder|waterer|brooder|\ypen\y|poultry house|chicken house|\ycoop\y|\yfeeds?\y|\yhusk|maize bran|\ygoat|\ypig|piggery|swine|cattle|cow shed|kraal|\yshelter|structure|housing|\yhutch|manure|brooding|iron sheet|\ypole|thatch|\ybrick|building material|construction material|generator|roasting *stove|\ystove|\ypump\y)'
      then 'Animal Structures and Equipment'

    -- Land hire & cultivation (incl. seeds / agro planting inputs) -----------
    when (select k from t) ~ '(\yland\y|plough|\yplow|garden|\yweed|cultivat|digging|ploughing|\yhoes?\y|tractor|planting|slashing|clearing|\yacre|opening|seedling|\yseeds?\y|\yseed\y|seed contribution|g\.?nut|soya?bean|\ymulch|watermelon|passion fruit|tomato|onion|ridges|horticulture|\ypegs?\y|farm *inputs?|\yrake|panga|slasher|\ypanga|wheelbarrow|watering *can|spade|\yforked?\y|maize *seed|bean *seed)'
      then 'Land Hire and Cultivation'

    -- Refreshments -----------------------------------------------------------
    when (select k from t) ~ '(refreshment|\ysoda\y|\ywater\y|drinking water|\ytea\y|coffee|\yfood\y|\ylunch|snack|\ysugar|\ybread|juice|\ymeals?\y|drinkets?|\ycharcoal|firewood|cooking|catering|\ypots?\y|breakfast|\ymilk\y)'
      then 'Refreshments'

    -- Labour & transport -----------------------------------------------------
    when (select k from t) ~ '(labour|\ylabor|casual|porter|\yworker|transport|\yfuel|\ymotor|\yboda|\yfare\y|cleaning|carrying|loading|offloading)'
      then 'Labour and Transport'

    -- Venue & seats (broad catch for the dominant seating cluster; incl.
    --  named meeting places: churches, community halls, subcounty offices) ---
    when (select k from t) ~ '(venue|vennue|vanue|\yhall\y|\yspace\y|\yplace\y|\yroom\y|compound|ground|\yseat|\ysit\y|\ysits\y|chair|bench|\ymat\y|\ymats\y|\ytable|\ydesk|stool|furniture|\yshade\y|\ytent\y|canopy|sitting|meeting place|electricit|\ychurch\y|mosque|\ycommunity\y|sub.?county|\ycentre\y|\ycenter\y|\yoffice\y|premises)'
      then 'Venue and Seats'

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
    'by_district', (select coalesce(jsonb_agg(jsonb_build_object(
                        'district', district, 'contributions', cnt, 'amount', amt) order by amt desc), '[]'::jsonb)
                    from (select coalesce(district,'(Blank)') as district,
                                 count(*) as cnt, coalesce(sum(contribution_amount),0) as amt
                          from f group by 1) d),
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
