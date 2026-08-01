-- refresh_shg_profiling_rows()
-- Rebuilds public.shg_profiling_rows (one row per SHG from shg_groups_view).
--
-- CHANGE (2026-08): member counts (male/female/pwd/total) now come from the
-- ACTUAL participant roster (records.template='participants', joined by shg_id)
-- — this is what the Heifer MIS counts. Previously we summed the manually-typed
-- "Total"/"Male"/"Female" figures on the group-review sheet, which lag (many
-- freshly-registered groups still have 0 typed in), so the dashboard reported
-- ~4,029 for July vs MIS's ~5,476. Roster count = 5,483 ≈ MIS.
--
-- Falls back to the group-sheet manual figure when a group has no roster rows
-- yet, so a number can never go backwards.
--
-- Apply with:  psql "$ORACLE_DATABASE_URL" -f sql/refresh_shg_profiling_rows.sql
-- then:        SELECT public.refresh_shg_profiling_rows();

CREATE OR REPLACE FUNCTION public.refresh_shg_profiling_rows()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare rows_out bigint;
begin
  delete from public.shg_profiling_rows;

  with dim_shg as (
    -- profiler name + profile shg name from the profiling form
    select
      nullif(trim(p.data->>'refID'),'')            as ref_id,
      max(nullif(trim(p.data->>'shg_name'),''))    as shg_name,
      max(nullif(trim(p.data->>'Profilers_name'),'')) as profilers_name
    from public.records p
    where p.template='shg_profiling_form'
      and nullif(trim(p.data->>'refID'),'') is not null
    group by nullif(trim(p.data->>'refID'),'')
  ),
  roster as (
    -- ACTUAL profiled participants per SHG (this is what the MIS counts):
    -- distinct participants in the roster, keyed by shg_id.
    select
      trim(pp.data->>'shg_id')                                   as shg_id,
      count(distinct pp.data->>'refID')                          as r_total,
      count(distinct pp.data->>'refID') filter (where pp.data->>'Sex'='Male')   as r_male,
      count(distinct pp.data->>'refID') filter (where pp.data->>'Sex'='Female') as r_female,
      count(distinct pp.data->>'refID') filter (where pp.data->>'Disability_status' ilike 'yes%') as r_pwd
    from public.records pp
    where pp.template='participants'
      and nullif(trim(pp.data->>'shg_id'),'') is not null
    group by trim(pp.data->>'shg_id')
  )
  insert into public.shg_profiling_rows
  select
    nullif(trim(g.data->>'SHG ID'),'')                    as shg_id,
    nullif(trim(g.data->>'SHG Name'),'')                  as shg_name,
    nullif(trim(g.data->>'district'),'')                  as district,
    nullif(trim(g.data->>'subcounty'),'')                 as subcounty,
    coalesce(rs.r_male,   nullif(regexp_replace(g.data->>'Male','[^0-9\-]','','g'),'')::int, 0)   as male,
    coalesce(rs.r_female, nullif(regexp_replace(g.data->>'Female','[^0-9\-]','','g'),'')::int, 0) as female,
    coalesce(rs.r_pwd,    nullif(regexp_replace(g.data->>'PWD','[^0-9\-]','','g'),'')::int, 0)    as pwd,
    coalesce(nullif(regexp_replace(g.data->>'Participants Trained','[^0-9\-]','','g'),'')::int, 0) as participants_trained,
    coalesce(rs.r_total,  nullif(regexp_replace(g.data->>'Total','[^0-9\-]','','g'),'')::int, 0)  as total,
    nullif(trim(g.data->>'trainings'),'')                 as trainings,
    nullif(regexp_replace(g.data->>'no_trainings','[^0-9\-]','','g'),'')::int as no_trainings,
    nullif(trim(g.data->>'group_status'),'')              as group_status,
    d.profilers_name                                      as profiler_name,
    d.shg_name                                            as profile_shg_name,
    case when (g.data->>'dateCreated') ~ '^\d{4}-\d{2}-\d{2}'
         then (left(g.data->>'dateCreated',10))::date else null end as created_date
  from public.records g
  left join dim_shg d on d.ref_id = nullif(trim(g.data->>'SHG ID'),'')
  left join roster  rs on rs.shg_id = nullif(trim(g.data->>'SHG ID'),'')
  where g.template='shg_groups_view';

  return (select count(*) from public.shg_profiling_rows);
end;
$function$;
