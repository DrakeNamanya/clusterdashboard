-- ===========================================================================
-- Youth NOT job-tracked  (follow-up list)
--   Set difference: participants who appear in trainees_v2 (trained) but whose
--   participant_id never appears in job_tracking_rows (job-tracked).
--   One row per distinct trained participant, enriched with the best non-empty
--   name / sex / district / subcounty / village found across all their training
--   rows, plus SHG group name + SHG ID (from youth_profiling.refID), attendance
--   count and last-training date.
--
--   Optional filter: p_districts text[] (UPPERCASE district names). NULL/empty
--   = all districts. Matches the Youth-in-Work district slicer.
--
--   Returns a JSON array (each element = one youth) ready for the client-side
--   Excel/CSV export. Ordered district, name.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.youth_not_job_tracked(
  p_districts text[] DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
AS $function$
  WITH jt AS MATERIALIZED (
    SELECT DISTINCT participant_id AS pid
    FROM public.job_tracking_rows
    WHERE participant_id IS NOT NULL AND participant_id <> ''
  ),
  v_dl AS (
    SELECT CASE
      WHEN p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN NULL
      ELSE (SELECT array_agg(upper(trim(d))) FROM unnest(p_districts) AS d WHERE nullif(trim(d),'') IS NOT NULL)
    END AS dl
  ),
  tr AS MATERIALIZED (
    SELECT
      t.participant_id,
      max(nullif(trim(t.participant_name),''))                            AS participant_name,
      max(nullif(trim(t.sex),''))                                         AS sex,
      max(t.is_pwd)                                                       AS is_pwd,
      upper(max(nullif(trim(t.district),'')))                             AS district,
      max(nullif(trim(t.subcounty),''))                                   AS subcounty,
      max(nullif(trim(t.village),''))                                     AS village,
      count(*)                                                            AS training_attendances,
      count(DISTINCT nullif(trim(t.training_type),''))                    AS training_types,
      max(CASE WHEN left(t.activity_date,10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
               THEN left(t.activity_date,10)::date END)                   AS last_training_date
    FROM public.trainees_v2 t
    WHERE t.participant_id IS NOT NULL AND t.participant_id <> ''
    GROUP BY t.participant_id
  ),
  -- SHG membership from the profiling roster. youth_profiling.refID matches the
  -- trainees_v2/job_tracking participant_id (e.g. HEI-jin-00211091). Case-folded
  -- join key. Covers ~99% of the not-tracked youth.
  prof AS MATERIALIZED (
    SELECT lower(nullif(trim(r.data->>'refID'),'')) AS rid,
           max(nullif(trim(r.data->>'shg_id'),''))   AS shg_id,
           max(nullif(trim(r.data->>'shg_name'),'')) AS shg_name
    FROM public.records r
    WHERE r.template = 'youth_profiling'
      AND nullif(trim(r.data->>'refID'),'') IS NOT NULL
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'district', row->>'participant_name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'participant_id',        tr.participant_id,
             'participant_name',      tr.participant_name,
             'sex',                   tr.sex,
             'pwd',                   CASE WHEN tr.is_pwd = 1 THEN 'Yes' ELSE 'No' END,
             'shg_name',              p.shg_name,
             'shg_id',                p.shg_id,
             'district',              tr.district,
             'subcounty',             tr.subcounty,
             'village',               tr.village,
             'training_attendances',  tr.training_attendances,
             'training_types',        tr.training_types,
             'last_training_date',    to_char(tr.last_training_date, 'YYYY-MM-DD')
           ) AS row
    FROM tr
    CROSS JOIN v_dl
    LEFT JOIN prof p ON p.rid = lower(tr.participant_id)
    WHERE NOT EXISTS (SELECT 1 FROM jt WHERE jt.pid = tr.participant_id)
      AND (v_dl.dl IS NULL OR tr.district = ANY(v_dl.dl))
  ) s;
$function$;

ALTER FUNCTION public.youth_not_job_tracked(text[]) SET statement_timeout = '120000';

GRANT EXECUTE ON FUNCTION public.youth_not_job_tracked(text[]) TO service_role;

-- Lightweight KPI helper: just the count, for the button label / preview.
CREATE OR REPLACE FUNCTION public.youth_not_job_tracked_count(
  p_districts text[] DEFAULT NULL
)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
AS $function$
  WITH jt AS MATERIALIZED (
    SELECT DISTINCT participant_id AS pid
    FROM public.job_tracking_rows
    WHERE participant_id IS NOT NULL AND participant_id <> ''
  ),
  v_dl AS (
    SELECT CASE
      WHEN p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN NULL
      ELSE (SELECT array_agg(upper(trim(d))) FROM unnest(p_districts) AS d WHERE nullif(trim(d),'') IS NOT NULL)
    END AS dl
  ),
  tr AS MATERIALIZED (
    SELECT t.participant_id, upper(max(nullif(trim(t.district),''))) AS district
    FROM public.trainees_v2 t
    WHERE t.participant_id IS NOT NULL AND t.participant_id <> ''
    GROUP BY t.participant_id
  )
  SELECT count(*)
  FROM tr, v_dl
  WHERE NOT EXISTS (SELECT 1 FROM jt WHERE jt.pid = tr.participant_id)
    AND (v_dl.dl IS NULL OR tr.district = ANY(v_dl.dl));
$function$;

ALTER FUNCTION public.youth_not_job_tracked_count(text[]) SET statement_timeout = '120000';

GRANT EXECUTE ON FUNCTION public.youth_not_job_tracked_count(text[]) TO service_role;
