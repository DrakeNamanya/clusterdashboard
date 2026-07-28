-- ===========================================================================
-- Youth in Work — Job Tracking fact table + refresh function.
-- Source: MIS view `combined_job_tracking_tool_view` (synced into
-- public.records with template='job_tracking'). This flattens the JSONB into a
-- fast, indexed fact table `job_tracking_rows` for the Youth in Work dashboard.
--
-- Grain: one row per job-tracking submission (MIS _id). The unique youth key is
-- participant_id. "Youth in work / employed" = distinct participant_id whose
-- most-recent status_after = 'Employed'.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.job_tracking_rows (
  doc_id              text,
  participant_id      text,
  participant_name    text,
  district            text,           -- normalized UPPERCASE
  subcounty           text,
  participant_type    text,
  ip_name             text,
  interviewer         text,
  interviewer_title   text,
  shg_name            text,
  shg_id              text,
  status_before       text,           -- Employed / Unemployed (Title Case)
  status_after        text,           -- Employed / Unemployed (Title Case)
  employed_change     text,           -- New job / Improved job / Sustained job
  employment_status   text,           -- Self employed / Wage employed
  employment_nature   text,
  value_chain         text,           -- Oil seeds / Poultry / Horticulture / Beef / Dairy
  total_income        numeric,
  employ_youth        text,           -- Yes / No
  jobs_female         integer,        -- youth employed BY this participant (female)
  jobs_male           integer,
  jobs_pwd            integer,
  submission_date     date
);

CREATE INDEX IF NOT EXISTS job_tracking_rows_district_idx    ON public.job_tracking_rows (district);
CREATE INDEX IF NOT EXISTS job_tracking_rows_participant_idx ON public.job_tracking_rows (participant_id);
CREATE INDEX IF NOT EXISTS job_tracking_rows_date_idx        ON public.job_tracking_rows (submission_date);
CREATE INDEX IF NOT EXISTS job_tracking_rows_after_idx       ON public.job_tracking_rows (status_after);

CREATE OR REPLACE FUNCTION public.refresh_job_tracking_rows()
  RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
declare rows_out bigint;
begin
  delete from public.job_tracking_rows;

  insert into public.job_tracking_rows
  select
    nullif(trim(r.data->>'docId'),'')                          as doc_id,
    nullif(trim(r.data->>'participant_id'),'')                 as participant_id,
    nullif(trim(r.data->>'participant_name'),'')               as participant_name,
    upper(nullif(trim(r.data->>'district_name'),''))           as district,
    nullif(trim(r.data->>'Subcounty_name'),'')                 as subcounty,
    nullif(trim(r.data->>'participant_type'),'')               as participant_type,
    nullif(trim(r.data->>'ip_name'),'')                        as ip_name,
    nullif(trim(r.data->>'interviewer'),'')                    as interviewer,
    nullif(trim(r.data->>'interviewer_title'),'')              as interviewer_title,
    nullif(trim(r.data->>'shg_name'),'')                       as shg_name,
    nullif(trim(r.data->>'shg_id'),'')                         as shg_id,
    -- normalize Employed/Unemployed to Title Case
    initcap(lower(nullif(trim(r.data->>'status_before'),'')))  as status_before,
    initcap(lower(nullif(trim(r.data->>'status_after'),'')))   as status_after,
    nullif(trim(r.data->>'employed'),'')                       as employed_change,
    nullif(trim(r.data->>'employment_status'),'')              as employment_status,
    nullif(trim(r.data->>'employment_nature'),'')              as employment_nature,
    initcap(lower(nullif(trim(r.data->>'value_chain_engaged'),''))) as value_chain,
    coalesce(nullif(regexp_replace(r.data->>'total_income','[^0-9.\-]','','g'),'')::numeric, 0) as total_income,
    nullif(trim(r.data->>'employ_youth'),'')                   as employ_youth,
    coalesce(nullif(regexp_replace(r.data->>'female','[^0-9\-]','','g'),'')::int, 0) as jobs_female,
    coalesce(nullif(regexp_replace(r.data->>'male','[^0-9\-]','','g'),'')::int, 0)   as jobs_male,
    coalesce(nullif(regexp_replace(r.data->>'pwds','[^0-9\-]','','g'),'')::int, 0)   as jobs_pwd,
    case when (r.data->>'submission_date') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(r.data->>'submission_date',10))::date else null end as submission_date
  from public.records r
  where r.template='job_tracking';

  return (select count(*) from public.job_tracking_rows);
end;
$function$;
