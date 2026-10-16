-- ============================================================================
-- YOUTH LINKED TO BANKS  (FSDU service-linkage tracking)
--
--   Fact : fsdu_service_linkage_tracking_form (synced from the Heifer OData feed
--          fsdu_service_linkage_tracking_form_odata_view into public.records).
--          One row per youth linked to a financial institution (bank / MFI).
--
-- The feed carries THREE participant streams with parallel columns:
--     shg_participant       : participant_name / shg_participant_id / sex    / shg_disability
--     sme_participant (mse) : sme_participant  / sme_participant_id / gender / sme_disability
--     incubatee_participant : incubatee_participant / incubatee_participant_id
--                             / incubatee_gender / incubatee_disability
-- We COALESCE them into one participant_name / participant_id / gender / pwd.
--
-- Materialized as `bank_linkage_rows`, rebuilt by refresh_bank_linkage_rows().
-- Tracked fields (per the request): Financial institution, Data collector name,
-- Loan amount disbursed (UGX), and count of Participant type. Plus district,
-- participant name, gender, pwd, savings, financial service, linkage date.
-- NB: the data_collector_name on this feed is a REAL person (not "admin"), so
-- it is the attribution key for the CF payment report.
-- ============================================================================

drop table if exists public.bank_linkage_rows cascade;
create table public.bank_linkage_rows (
  doc_id            text,
  participant_type  text,       -- shg_participant | mse_participant | incubatee_participant | agrihub_participant
  financial_institution text,   -- pride_bank / centenary_bank / asa / visionfund / ... (or the 'other' free text)
  data_collector    text,       -- REAL submitter name (not admin)
  participant_name  text,
  participant_id    text,
  gender            text,
  is_female         int,
  pwd_status        text,
  is_pwd            int,
  district          text,       -- Title-Case display district
  district_key      text,       -- UPPER canonical key
  subcounty         text,
  financial_service text,       -- loan / savings / ...
  loan_amount       numeric,    -- loan amount disbursed (UGX)
  savings_amount    numeric,
  loan_purpose      text,
  repayment_status  text,
  linkage_date      date,
  created_date      date        -- submission date (dateCreated)
);
create index bank_linkage_rows_fi_idx    on public.bank_linkage_rows (financial_institution);
create index bank_linkage_rows_dc_idx    on public.bank_linkage_rows (data_collector);
create index bank_linkage_rows_dist_idx  on public.bank_linkage_rows (district_key);
create index bank_linkage_rows_date_idx  on public.bank_linkage_rows (linkage_date);
create index bank_linkage_rows_cdate_idx on public.bank_linkage_rows (created_date);

-- ---- Rebuild bank linkage rows ---------------------------------------------
create or replace function public.refresh_bank_linkage_rows()
returns bigint
language plpgsql
as $$
declare rows_out bigint;
begin
  truncate public.bank_linkage_rows;

  insert into public.bank_linkage_rows
  select
    nullif(trim(s.data->>'docId'),'')                       as doc_id,
    lower(nullif(trim(s.data->>'participant_type'),''))     as participant_type,
    -- Use the free-text 'other' institution when the coded one is 'other'/blank.
    coalesce(
      nullif(nullif(trim(s.data->>'financial_institution'),''),'other'),
      nullif(trim(s.data->>'financial_institution_other'),''),
      nullif(trim(s.data->>'financial_institution'),'')
    )                                                       as financial_institution,
    nullif(trim(s.data->>'data_collector_name'),'')         as data_collector,
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
    public.mel_canon_district_disp(nullif(trim(s.data->>'district'),'')) as district,
    public.mel_canon_district(nullif(trim(s.data->>'district'),''))      as district_key,
    nullif(trim(s.data->>'subcounty'),'')                   as subcounty,
    nullif(trim(s.data->>'financial_service'),'')           as financial_service,
    public.n(s.data->>'loan_amount_ugx')                    as loan_amount,
    public.n(s.data->>'savings_deposit_amount_ugx')         as savings_amount,
    coalesce(
      nullif(nullif(trim(s.data->>'loan_purpose'),''),'other'),
      nullif(trim(s.data->>'loan_purpose_other'),''),
      nullif(trim(s.data->>'loan_purpose'),'')
    )                                                       as loan_purpose,
    nullif(trim(s.data->>'repayment_status'),'')            as repayment_status,
    case when (s.data->>'linkage_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(s.data->>'linkage_date',10))::date else null end as linkage_date,
    case when (s.data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(s.data->>'dateCreated',10))::date else null end as created_date
  from (
    select distinct on (coalesce(nullif(trim(r.data->>'docId'),''), r.dedup_key))
           r.data
    from public.records r
    where r.template='fsdu_service_linkage_tracking_form'
    order by coalesce(nullif(trim(r.data->>'docId'),''), r.dedup_key),
             case when r.source_file like 'odata:%' then 0 else 1 end
  ) s;

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_bank_linkage_rows() set statement_timeout='120000';

-- ---- Dashboard aggregate (KPIs + by FI + by participant type + by district + rows) --
create or replace function public.bank_linkage_dash(
  p_districts  text[] default null,
  p_institutions text[] default null,
  p_types      text[] default null,
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
    select r.* from public.bank_linkage_rows r, sel
    where (sel.dl is null or r.district_key = any(sel.dl))
      and (p_institutions is null or array_length(p_institutions,1) is null or r.financial_institution = any(p_institutions))
      and (p_types is null or array_length(p_types,1) is null or r.participant_type = any(p_types))
      and (p_date_from is null or r.linkage_date >= p_date_from)
      and (p_date_to   is null or r.linkage_date <= p_date_to)
  )
  select jsonb_build_object(
    'total_linkages', (select count(*) from f),
    'total_loan',     (select coalesce(sum(loan_amount),0) from f),
    'total_savings',  (select coalesce(sum(savings_amount),0) from f),
    'institutions_count', (select count(distinct financial_institution) from f where financial_institution is not null),
    'districts_count',(select count(distinct district_key) from f where district_key is not null),
    'female_count',   (select coalesce(sum(is_female),0) from f),
    'pwd_count',      (select coalesce(sum(is_pwd),0) from f),
    'collectors_count',(select count(distinct data_collector) from f where data_collector is not null),
    'by_institution', (select coalesce(jsonb_agg(jsonb_build_object(
                          'institution', financial_institution, 'linkages', cnt, 'loan', amt) order by amt desc), '[]'::jsonb)
                       from (select coalesce(financial_institution,'(Unknown)') as financial_institution,
                                    count(*) cnt, coalesce(sum(loan_amount),0) amt
                             from f group by 1) i),
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object(
                    'type', participant_type, 'linkages', cnt, 'loan', amt) order by cnt desc), '[]'::jsonb)
                from (select coalesce(participant_type,'(Unspecified)') as participant_type,
                             count(*) cnt, coalesce(sum(loan_amount),0) amt
                      from f group by 1) t),
    'by_district', (select coalesce(jsonb_agg(jsonb_build_object(
                        'district', district, 'linkages', cnt, 'loan', amt) order by amt desc), '[]'::jsonb)
                    from (select coalesce(district,'(Blank)') as district,
                                 count(*) cnt, coalesce(sum(loan_amount),0) amt
                          from f group by 1) d),
    'by_collector', (select coalesce(jsonb_agg(jsonb_build_object(
                        'collector', data_collector, 'linkages', cnt, 'loan', amt) order by amt desc), '[]'::jsonb)
                     from (select coalesce(data_collector,'(Unknown)') as data_collector,
                                  count(*) cnt, coalesce(sum(loan_amount),0) amt
                           from f group by 1) c),
    'rows', (select coalesce(jsonb_agg(to_jsonb(t) order by t.linkage_date desc nulls last), '[]'::jsonb)
             from (select doc_id, financial_institution, data_collector, participant_type, participant_name,
                          participant_id, gender, pwd_status, district, financial_service, loan_amount,
                          savings_amount, loan_purpose, repayment_status, linkage_date
                   from f order by linkage_date desc nulls last limit p_limit) t),
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(district,'(Blank)') as d from public.bank_linkage_rows) x),
    'institutions', (select coalesce(jsonb_agg(i order by i), '[]'::jsonb)
                     from (select distinct coalesce(financial_institution,'(Unknown)') as i from public.bank_linkage_rows) x),
    'types', (select coalesce(jsonb_agg(t order by t), '[]'::jsonb)
              from (select distinct coalesce(participant_type,'(Unspecified)') as t from public.bank_linkage_rows) x),
    'date_bounds', (select jsonb_build_object(
                      'min', to_char(min(linkage_date),'YYYY-MM-DD'),
                      'max', to_char(max(linkage_date),'YYYY-MM-DD'))
                    from public.bank_linkage_rows)
  );
$$;

-- ---- Lightweight slicer option lists ---------------------------------------
create or replace function public.bank_linkage_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb)
                  from (select distinct coalesce(district,'(Blank)') as d from public.bank_linkage_rows) x),
    'institutions', (select coalesce(jsonb_agg(i order by i), '[]'::jsonb)
                     from (select distinct coalesce(financial_institution,'(Unknown)') as i from public.bank_linkage_rows) x),
    'types', (select coalesce(jsonb_agg(t order by t), '[]'::jsonb)
              from (select distinct coalesce(participant_type,'(Unspecified)') as t from public.bank_linkage_rows) x),
    'date_bounds', (select jsonb_build_object(
                      'min', to_char(min(linkage_date),'YYYY-MM-DD'),
                      'max', to_char(max(linkage_date),'YYYY-MM-DD'))
                    from public.bank_linkage_rows)
  );
$$;
