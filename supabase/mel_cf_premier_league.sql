-- mel_cf_premier_league(districts[], from, to) -> jsonb
-- Ranks every Community Facilitator in the selected cluster/districts by their
-- OVERALL performance grade — the same average-of-target-percent used on the CF
-- Report Card. Returns rows sorted best → worst so the frontend can render a
-- "premier league" table (#1 to last) that updates live as data is submitted.
--
-- SET-BASED: computes all CFs' 7 metrics in a single pass (no per-CF loop), so
-- it stays fast enough for the Cloudflare worker even with 150+ facilitators.
--
-- Overall % = average over 7 client targets (each capped at 100):
--   SHGs Profiled/16, Youth Mobilized/400, Female share/70%, PWD share/3%,
--   SHGs Saving(ISLA)/16, Youth into Production/400, Groups Trained/16.
CREATE OR REPLACE FUNCTION public.mel_cf_premier_league(
  p_districts text[] DEFAULT NULL::text[],
  p_date_from date DEFAULT NULL::date,
  p_date_to   date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v jsonb;
  v_dl text[];
BEGIN
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN v_dl := NULL;
  ELSE SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  WITH
  sexmap AS (
    SELECT DISTINCT participant_id, sex FROM at_rows WHERE participant_id IS NOT NULL
  ),
  -- Universe of CFs (same discovery rules as mel_cf_report_staff).
  cfs AS (
    SELECT nm FROM (
      SELECT public.mel_norm_name(profiler_name)  AS nm, upper(district)      AS d FROM shg_profiling_rows WHERE profiler_name  IS NOT NULL
      UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM production_rows      WHERE profilers_name IS NOT NULL
      UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM poultry_sales_rows   WHERE profilers_name IS NOT NULL
      UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM sales_rows           WHERE profilers_name IS NOT NULL
      UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_shg)  FROM isla_final_rows       WHERE profilers_name IS NOT NULL
      UNION ALL SELECT public.mel_norm_name(submitter_name), upper(district)      FROM local_leverage_rows   WHERE submitter_name IS NOT NULL
    ) allnames
    WHERE nm <> '' AND nm ~ '[a-z]' AND nm ~ ' '
      AND nm !~ '(group|association|farmers|youth farmers|provision of|self help|shg|village|cluster|community)'
      AND (v_dl IS NULL OR d = ANY(v_dl))
    GROUP BY nm
  ),
  -- ---- PROFILING (SHGs profiled, youth mobilized, female, pwd) ----
  prof AS (
    SELECT public.mel_norm_name(profiler_name) AS nm,
           COUNT(*)::int AS shgs_profiled,
           COALESCE(SUM(total),0)::int  AS youth,
           COALESCE(SUM(female),0)::int AS female,
           COALESCE(SUM(pwd),0)::int    AS pwd
    FROM shg_profiling_rows
    WHERE profiler_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- GROUPS TRAINED (from profiling: trainings present OR trained>0) ----
  trained AS (
    SELECT public.mel_norm_name(profiler_name) AS nm,
           COUNT(*) FILTER (WHERE NULLIF(btrim(trainings),'') IS NOT NULL
                               OR COALESCE(participants_trained,0) > 0)::int AS groups_trained
    FROM shg_profiling_rows
    WHERE profiler_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- ISLA (SHGs saving) ----
  isla AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COUNT(DISTINCT shg_id)::int AS shgs_saving
    FROM isla_final_rows
    WHERE profilers_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- PRODUCTION (horticulture youth, per CF) ----
  prod_hort AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COUNT(DISTINCT shg_participant_id)::int AS hort
    FROM production_rows
    WHERE profilers_name IS NOT NULL AND lower(pdn_level)='production'
      AND shg_participant_id IS NOT NULL
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- Set of horticulture (CF, participant) pairs, to de-dup against birds.
  prod_hort_pairs AS (
    SELECT DISTINCT public.mel_norm_name(profilers_name) AS nm, shg_participant_id AS pid
    FROM production_rows
    WHERE profilers_name IS NOT NULL AND lower(pdn_level)='production'
      AND shg_participant_id IS NOT NULL
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  -- ---- BIRDS (distribution of poultry livestock by Number) per CF ----
  -- distribution_rows are attributed to a CF via submitted_by key-prefix match.
  dist_matched AS (
    SELECT c.nm, d.participant_id
    FROM distribution_rows d
    JOIN cfs c ON (
      public.mel_norm_key(d.submitted_by) = public.mel_norm_key(c.nm)
      OR (length(public.mel_norm_key(c.nm)) >= 8
          AND public.mel_norm_key(d.submitted_by) LIKE public.mel_norm_key(c.nm) || '%')
    )
    WHERE d.material_type = 'Livestock'
      AND d.livestock_type ILIKE '%poultry%'
      AND lower(coalesce(d.unit,'')) = 'number'
      AND d.participant_id IS NOT NULL
      AND (v_dl IS NULL OR upper(d.district)=ANY(v_dl))
      AND (p_date_from IS NULL OR d.dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR d.dist_date <= p_date_to)
  ),
  birds AS (
    SELECT nm, COUNT(DISTINCT participant_id)::int AS bird_youth
    FROM dist_matched GROUP BY nm
  ),
  -- Youth into Production = distinct union of horticulture youth + bird youth.
  prod_youth AS (
    SELECT nm, COUNT(DISTINCT pid)::int AS youth_production
    FROM (
      SELECT nm, pid FROM prod_hort_pairs
      UNION
      SELECT nm, participant_id AS pid FROM dist_matched
    ) u
    GROUP BY nm
  ),
  -- ---- Assemble per-CF metric + overall score ----
  metrics AS (
    SELECT
      c.nm,
      COALESCE(p.shgs_profiled,0)   AS shgs_profiled,
      COALESCE(p.youth,0)           AS youth_mobilized,
      COALESCE(p.female,0)          AS female,
      COALESCE(p.pwd,0)             AS pwd,
      COALESCE(t.groups_trained,0)  AS groups_trained,
      COALESCE(i.shgs_saving,0)     AS shgs_saving,
      COALESCE(py.youth_production,0) AS youth_production,
      COALESCE(ph.hort,0)           AS youth_prod_hort,
      COALESCE(b.bird_youth,0)      AS youth_prod_birds
    FROM cfs c
    LEFT JOIN prof p        ON p.nm  = c.nm
    LEFT JOIN trained t     ON t.nm  = c.nm
    LEFT JOIN isla i        ON i.nm  = c.nm
    LEFT JOIN prod_youth py ON py.nm = c.nm
    LEFT JOIN prod_hort ph  ON ph.nm = c.nm
    LEFT JOIN birds b       ON b.nm  = c.nm
  ),
  scored AS (
    SELECT m.*,
      CASE WHEN youth_mobilized>0 THEN round(100.0*female/youth_mobilized) ELSE 0 END AS female_pct,
      CASE WHEN youth_mobilized>0 THEN round(100.0*pwd/youth_mobilized)    ELSE 0 END AS pwd_pct
    FROM metrics m
  ),
  ranked AS (
    SELECT s.*,
      round((
        least(100, 100.0*shgs_profiled/16) +
        least(100, 100.0*youth_mobilized/400) +
        least(100, 100.0*female_pct/70) +
        least(100, 100.0*pwd_pct/3) +
        least(100, 100.0*shgs_saving/16) +
        least(100, 100.0*youth_production/400) +
        least(100, 100.0*groups_trained/16)
      )/7.0)::int AS overall
    FROM scored s
  )
  SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'key',             nm,
        'name',            initcap(nm),
        'overall',         overall,
        'shgs_profiled',   shgs_profiled,
        'youth_mobilized', youth_mobilized,
        'female_pct',      female_pct,
        'pwd_pct',         pwd_pct,
        'shgs_saving',     shgs_saving,
        'youth_production',youth_production,
        'youth_prod_hort', youth_prod_hort,
        'youth_prod_birds',youth_prod_birds,
        'groups_trained',  groups_trained
      ) ORDER BY overall DESC, initcap(nm)
    ), '[]'::jsonb)
    INTO v
  FROM ranked
  WHERE overall > 0 OR shgs_profiled > 0 OR youth_mobilized > 0 OR youth_production > 0;

  RETURN coalesce(v, '[]'::jsonb);
END;
$function$;
