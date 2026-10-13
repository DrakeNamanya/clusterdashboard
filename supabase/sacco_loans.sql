-- ============================================================================
-- SACCO LOAN TRACKING
--
--   Fact : loan_portfolio_monitoring_tool (synced from the Heifer OData feed
--          loan_portfolio_monitoring_tool_odata_view into public.records).
--          One row per loan a SAYE youth received through a SACCO.
--
-- The feed carries THREE participant streams with parallel columns:
--     shg       : participant_name / shg_participant_id / sex    / shg_disability    / shg_district
--     sme (mse) : sme_participant  / sme_participant_id / gender / sme_disability    / sme_district
--     incubatee : incubatee_participant / incubatee_participant_id / incubatee_gender
--                 / incubatee_disability / incubatee_district
-- We COALESCE them into one tidy participant_name / participant_id / gender /
-- pwd_status / district per row (driven by participant_type, with a safe
-- fallback to whichever stream is populated).
--
-- Materialized as `sacco_loan_rows`, rebuilt by refresh_sacco_loan_rows().
-- Tracked fields (per the request): SACCO name, participant name, gender, PWD
-- status, district, line of business, loan amount, loan purpose, interest rate,
-- submitter name, date of loan disbursement.
-- ============================================================================

drop table if exists public.sacco_loan_rows cascade;
create table public.sacco_loan_rows (
  doc_id            text,       -- submission docId (dedup / uniqueness)
  ip_name           text,
  participant_type  text,       -- shg | sme/mse | incubatee
  sacco_name        text,       -- the SACCO the youth is getting a loan through
  sacco_id          text,
  participant_name  text,       -- coalesced across the three streams
  participant_id    text,       -- coalesced
  gender            text,       -- coalesced (Male/Female)
  is_female         int,        -- 1 when gender = Female
  pwd_status        text,       -- Yes/No (coalesced disability flag)
  is_pwd            int,        -- 1 when pwd_status = Yes
  district          text,       -- Title-Case display district (canonicalised)
  district_key      text,       -- UPPER canonical key for filtering
  line_of_business  text,       -- biz_line (oil_seeds / poultry / horticulture / beef / dairy)
  loan_amount       numeric,
  loan_purpose      text,
  interest_rate     numeric,    -- annual % as entered
  submitter_name    text,       -- createdBy
  disbursement_date date,       -- date of loan disbursement
  created_date      date        -- submission date (dateCreated)
);
create index sacco_loan_rows_sacco_idx  on public.sacco_loan_rows (sacco_name);
create index sacco_loan_rows_dist_idx   on public.sacco_loan_rows (district_key);
create index sacco_loan_rows_biz_idx    on public.sacco_loan_rows (line_of_business);
create index sacco_loan_rows_disb_idx   on public.sacco_loan_rows (disbursement_date);
create index sacco_loan_rows_cdate_idx  on public.sacco_loan_rows (created_date);

-- ---- Rebuild SACCO loan rows -----------------------------------------------
create or replace function public.refresh_sacco_loan_rows()
returns bigint
language plpgsql
as $$
declare rows_out bigint;
begin
  truncate public.sacco_loan_rows;

  insert into public.sacco_loan_rows
  select
    nullif(trim(s.data->>'docId'),'')                       as doc_id,
    nullif(trim(s.data->>'ip_name'),'')                     as ip_name,
    lower(nullif(trim(s.data->>'participant_type'),''))     as participant_type,
    nullif(trim(s.data->>'sacco'),'')                       as sacco_name,
    nullif(trim(s.data->>'sacco_id'),'')                    as sacco_id,
    coalesce(
      nullif(trim(s.data->>'participant_name'),''),
      nullif(trim(s.data->>'sme_participant'),''),
      nullif(trim(s.data->>'incubatee_participant'),'')
    )                                                       as participant_name,
    coalesce(
      nullif(trim(s.data->>'shg_participant_id'),''),
      nullif(trim(s.data->>'sme_participant_id'),''),
      nullif(trim(s.data->>'incubatee_participant_id'),'')
    )                                                       as participant_id,
    initcap(coalesce(
      nullif(trim(s.data->>'sex'),''),
      nullif(trim(s.data->>'gender'),''),
      nullif(trim(s.data->>'incubatee_gender'),'')
    ))                                                      as gender,
    case when lower(coalesce(
      nullif(trim(s.data->>'sex'),''),
      nullif(trim(s.data->>'gender'),''),
      nullif(trim(s.data->>'incubatee_gender'),'')
    )) = 'female' then 1 else 0 end                         as is_female,
    initcap(coalesce(
      nullif(trim(s.data->>'shg_disability'),''),
      nullif(trim(s.data->>'sme_disability'),''),
      nullif(trim(s.data->>'incubatee_disability'),'')
    ))                                                      as pwd_status,
    case when lower(coalesce(
      nullif(trim(s.data->>'shg_disability'),''),
      nullif(trim(s.data->>'sme_disability'),''),
      nullif(trim(s.data->>'incubatee_disability'),'')
    )) = 'yes' then 1 else 0 end                            as is_pwd,
    public.mel_canon_district_disp(coalesce(
      nullif(trim(s.data->>'shg_district'),''),
      nullif(trim(s.data->>'sme_district'),''),
      nullif(trim(s.data->>'incubatee_district'),'')
    ))                                                      as district,
    public.mel_canon_district(coalesce(
      nullif(trim(s.data->>'shg_district'),''),
      nullif(trim(s.data->>'sme_district'),''),
      nullif(trim(s.data->>'incubatee_district'),'')
    ))                                                      as district_key,
    nullif(trim(s.data->>'biz_line'),'')                    as line_of_business,
    public.n(s.data->>'loan_amount')                        as loan_amount,
    nullif(trim(s.data->>'purpose'),'')                     as loan_purpose,
    public.n(s.data->>'interest')                           as interest_rate,
    nullif(trim(s.data->>'createdBy'),'')                   as submitter_name,
    case when (s.data->>'disbursement_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(s.data->>'disbursement_date',10))::date else null end as disbursement_date,
    case when (s.data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(s.data->>'dateCreated',10))::date else null end as created_date
  from (
    -- DE-DUP by docId (the cron may sync the feed under more than one source
    -- label). Keep one row per submission, preferring the odata source.
    select distinct on (coalesce(nullif(trim(r.data->>'docId'),''), r.dedup_key))
           r.data
    from public.records r
    where r.template='loan_portfolio_monitoring_tool'
    order by coalesce(nullif(trim(r.data->>'docId'),''), r.dedup_key),
             case when r.source_file like 'odata:%' then 0 else 1 end
  ) s;

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_sacco_loan_rows() set statement_timeout='120000';

-- ---- Dashboard aggregate (KPIs + by SACCO + by district + by biz + rows) ----
create or replace function public.sacco_loan_dash(
  p_districts  text[] default null,
  p_saccos     text[] default null,
  p_biz        text[] default null,
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
      case when p_districts is null or array_length(p_districts,1) is null then null
           else (select array_agg(public.mel_canon_district(x)) from unnest(p_districts) x) end as dl
  ),
  f as (
    select r.* from public.sacco_loan_rows r, sel
    where (sel.dl is null or r.district_key = any(sel.dl))
      and (p_saccos is null or array_length(p_saccos,1) is null or r.sacco_name = any(p_saccos))
      and (p_biz    is null or array_length(p_biz,1)    is null or r.line_of_business = any(p_biz))
      and (p_date_from is null or r.disbursement_date >= p_date_from)
      and (p_date_to   is null or r.disbursement_date <= p_date_to)
  )
  select jsonb_build_object(
    'total_loans',   (select count(*) from f),
    'total_amount',  (select coalesce(sum(loan_amount),0) from f),
    'saccos_count',  (select count(distinct sacco_name) from f where sacco_name is not null),
    'districts_count',(select count(distinct district_key) from f where district_key is not null),
    'female_count',  (select coalesce(sum(is_female),0) from f),
    'pwd_count',     (select coalesce(sum(is_pwd),0) from f),
    'avg_interest',  (select round(avg(interest_rate)::numeric,1) from f where interest_rate is not null),
    'avg_loan',      (select round(avg(loan_amount)::numeric,0) from f where loan_amount is not null),
    'by_sacco', (select coalesce(jsonb_agg(jsonb_build_object(
                    'sacco', sacco_name, 'loans', cnt, 'amount', amt,
                    'female', fem, 'pwd', pwd) order by amt desc), '[]'::jsonb)
                from (select coalesce(sacco_name,'(Unknown)') as sacco_name,
                             count(*) cnt, coalesce(sum(loan_amount),0) amt,
                             coalesce(sum(is_female),0) fem, coalesce(sum(is_pwd),0) pwd
                      from f group by 1) s),
    'by_district', (select coalesce(jsonb_agg(jsonb_build_object(
                        'district', district, 'loans', cnt, 'amount', amt) order by amt desc), '[]'::jsonb)
                    from (select coalesce(district,'(Blank)') as district,
                                 count(*) cnt, coalesce(sum(loan_amount),0) amt
                          from f group by 1) d),
    'by_biz', (select coalesce(jsonb_agg(jsonb_build_object(
                   'biz', line_of_business, 'loans', cnt, 'amount', amt) order by amt desc), '[]'::jsonb)
               from (select coalesce(line_of_business,'(Unspecified)') as line_of_business,
                            count(*) cnt, coalesce(sum(loan_amount),0) amt
                     from f group by 1) b),
    'rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.disbursement_date desc nulls last), '[]'::jsonb)
             from (select doc_id, sacco_name, participant_name, participant_id, gender, pwd_status,
                          district, line_of_business, loan_amount, loan_purpose, interest_rate,
                          submitter_name, disbursement_date
                   from f order by disbursement_date desc nulls last limit p_limit) t),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(district,'(Blank)') as d
                        from public.sacco_loan_rows) x),
    'saccos', (select coalesce(jsonb_agg(s order by s), '[]'::jsonb)
               from (select distinct coalesce(sacco_name,'(Unknown)') as s
                     from public.sacco_loan_rows) x),
    'biz_lines', (select coalesce(jsonb_agg(b order by b), '[]'::jsonb)
                  from (select distinct coalesce(line_of_business,'(Unspecified)') as b
                        from public.sacco_loan_rows) x),
    'date_bounds', (select jsonb_build_object(
                      'min', to_char(min(disbursement_date),'YYYY-MM-DD'),
                      'max', to_char(max(disbursement_date),'YYYY-MM-DD'))
                    from public.sacco_loan_rows)
  );
$$;

-- ---- Lightweight slicer option lists ---------------------------------------
create or replace function public.sacco_loan_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(district,'(Blank)') as d from public.sacco_loan_rows) x),
    'saccos', (select coalesce(jsonb_agg(s order by s), '[]'::jsonb)
               from (select distinct coalesce(sacco_name,'(Unknown)') as s from public.sacco_loan_rows) x),
    'biz_lines', (select coalesce(jsonb_agg(b order by b), '[]'::jsonb)
                  from (select distinct coalesce(line_of_business,'(Unspecified)') as b from public.sacco_loan_rows) x),
    'date_bounds', (select jsonb_build_object(
                      'min', to_char(min(disbursement_date),'YYYY-MM-DD'),
                      'max', to_char(max(disbursement_date),'YYYY-MM-DD'))
                    from public.sacco_loan_rows)
  );
$$;
