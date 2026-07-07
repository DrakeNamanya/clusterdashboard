-- ============================================================================
-- Dim_Profile — participant dimension used alongside the profiling data.
--
--   Dim_Profile = SUMMARIZE(
--     profile,                       -- participants (name_ip='HEIFER', distinct)
--     profile[participant_id],       -- = participants[refID]
--     "shg_id",           MAX(shg_id),
--     "full_name",        MAX(First_name) & " " & MAX(surname),
--     "district_name",    MAX(district_name),
--     "subcounty_name",   MAX(Subcounty_name),
--     "parish_name",      MAX(Parish_name),
--     "village_name",     MAX(Village_name),
--     "disability_status",MAX(Disability_status),
--     "sex",              MAX(Sex),
--     "shg_name",         MAX(shg_name)
--   )
--
-- Source Power Query for `profile`: participants_odata_view filtered to
--   name_ip = "HEIFER", distinct rows, refID renamed participant_id.
-- We apply the name_ip='HEIFER' filter here so Dim_Profile matches the report.
-- ============================================================================

drop table if exists public.dim_profile cascade;
create table public.dim_profile (
  participant_id     text primary key,
  shg_id             text,
  full_name          text,
  first_name         text,
  surname            text,
  district_name      text,
  subcounty_name     text,
  parish_name        text,
  village_name       text,
  disability_status  text,
  sex                text,
  shg_name           text,
  cohort             text
);
create index dim_profile_shgid_idx on public.dim_profile (shg_id);
create index dim_profile_dist_idx  on public.dim_profile (district_name);
grant select on public.dim_profile to anon, service_role;

create or replace function public.refresh_dim_profile()
returns bigint
language plpgsql
security definer
as $$
declare rows_out bigint;
begin
  truncate public.dim_profile;

  insert into public.dim_profile
  select
    participant_id,
    max(shg_id)                                       as shg_id,
    trim(coalesce(max(first_name),'') || ' ' || coalesce(max(surname),'')) as full_name,
    max(first_name)                                   as first_name,
    max(surname)                                      as surname,
    max(district_name)                                as district_name,
    max(subcounty_name)                               as subcounty_name,
    max(parish_name)                                  as parish_name,
    max(village_name)                                 as village_name,
    max(disability_status)                            as disability_status,
    max(sex)                                          as sex,
    max(shg_name)                                     as shg_name,
    max(cohort)                                       as cohort
  from (
    select
      nullif(trim(p.data->>'refID'),'')            as participant_id,
      nullif(trim(p.data->>'shg_id'),'')           as shg_id,
      nullif(trim(p.data->>'First_name'),'')       as first_name,
      nullif(trim(p.data->>'Surname'),'')          as surname,
      nullif(trim(p.data->>'district_name'),'')    as district_name,
      nullif(trim(p.data->>'Subcounty_name'),'')   as subcounty_name,
      nullif(trim(p.data->>'Parish_name'),'')      as parish_name,
      nullif(trim(p.data->>'Village_name'),'')     as village_name,
      nullif(trim(p.data->>'Disability_status'),'') as disability_status,
      nullif(trim(p.data->>'Sex'),'')              as sex,
      nullif(trim(p.data->>'shg_name'),'')         as shg_name,
      nullif(trim(p.data->>'Cohort'),'')           as cohort
    from public.records p
    where p.template='participants'
      and upper(coalesce(trim(p.data->>'name_ip'),'')) = 'HEIFER'   -- SelectRows: name_ip = "HEIFER"
      and nullif(trim(p.data->>'refID'),'') is not null
  ) s
  group by participant_id;

  get diagnostics rows_out = row_count;
  return rows_out;
end;
$$;
alter function public.refresh_dim_profile() set statement_timeout='120000';
grant execute on function public.refresh_dim_profile() to service_role;
