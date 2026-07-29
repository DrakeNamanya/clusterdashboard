-- mel_cf_premier_league(districts[], from, to) -> jsonb
-- Ranks every Community Facilitator in the selected cluster/districts by their
-- OVERALL performance grade, computed as the average of the SAME 7 metrics that
-- are graded on the CF Report Card (period-filtered), #1 (best) → last:
--
--   1. SHGs Saving / SHGs Profiled          (% ratio; option B)
--   2. Youth into Production                (achieved / 400)
--   3. Trainings (first trainings)=Groups Trained (achieved / 16)
--   4. Youth in Work                        (employed youth / (0.70 × mobilized))
--   5. Sales (Poultry)                      (PASS/FAIL: 100 if any, else 0)
--   6. Sales (Horticulture)                 (PASS/FAIL: 100 if any value, else 0)
--   7. Local Leverage                       (PASS/FAIL: 100 if any, else 0)
--
-- Overall % = average of those 7 (each capped at 100). Ties out to the CF card.
-- SET-BASED single pass (fast: ~6-8 s for 176 CFs, not a per-CF loop).
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
  -- Universe of CFs (same discovery rules as mel_cf_report_staff).
  cfs AS (
    SELECT nm,
           -- sorted-token key (word order independent) for job_tracking match
           (SELECT string_agg(w, ' ' ORDER BY w)
              FROM unnest(regexp_split_to_array(nm,' ')) w WHERE w <> '') AS sortkey
    FROM (
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
    ) u
  ),
  -- ---- PROFILING: SHGs profiled + youth mobilized (for ratio & YiW target) ----
  prof AS (
    SELECT public.mel_norm_name(profiler_name) AS nm,
           COUNT(*)::int AS shgs_profiled,
           COALESCE(SUM(total),0)::int AS youth_mobilized
    FROM shg_profiling_rows
    WHERE profiler_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- SHGs SAVING (ISLA distinct SHGs) ----
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
  -- ---- YOUTH INTO PRODUCTION = horticulture youth + bird recipients ----
  prod_hort_pairs AS (
    SELECT DISTINCT public.mel_norm_name(profilers_name) AS nm, shg_participant_id AS pid
    FROM production_rows
    WHERE profilers_name IS NOT NULL AND lower(pdn_level)='production'
      AND shg_participant_id IS NOT NULL
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
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
  prod_youth AS (
    SELECT nm, COUNT(DISTINCT pid)::int AS youth_production
    FROM (
      SELECT nm, pid FROM prod_hort_pairs
      UNION
      SELECT nm, participant_id AS pid FROM dist_matched
    ) u
    GROUP BY nm
  ),
  -- ---- SALES (POULTRY): pass/fail — any birds sold ----
  poultry AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COALESCE(SUM(poultry_sold),0)::numeric AS birds_sold
    FROM poultry_sales_rows
    WHERE profilers_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- SALES (HORTICULTURE / OILSEEDS): pass/fail — any planting value ----
  hsales AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COALESCE(SUM(total_planting_value),0)::numeric AS hs_value
    FROM sales_rows
    WHERE profilers_name IS NOT NULL
      AND lower(coalesce(value_chain,'')) IN ('horticulture','oil seeds','oilseeds')
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- LOCAL LEVERAGE: pass/fail — any contribution ----
  lev AS (
    SELECT public.mel_norm_name(submitter_name) AS nm,
           COUNT(*)::int AS lev_count
    FROM local_leverage_rows
    WHERE submitter_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR date_created >= p_date_from)
      AND (p_date_to   IS NULL OR date_created <= p_date_to)
    GROUP BY 1
  ),
  -- ---- YOUTH IN WORK: employed youth, matched by interviewer sorted-token ----
  jt AS (
    SELECT DISTINCT ON (participant_id)
           participant_id, status_after,
           (SELECT string_agg(w, ' ' ORDER BY w)
              FROM unnest(regexp_split_to_array(
                     trim(regexp_replace(regexp_replace(lower(coalesce(interviewer,'')),'[^a-z ]',' ','g'),'\s+',' ','g')),' ')) w
              WHERE w <> '') AS ikey,
           submission_date
    FROM job_tracking_rows
    WHERE participant_id IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR submission_date >= p_date_from)
      AND (p_date_to   IS NULL OR submission_date <= p_date_to)
    ORDER BY participant_id, submission_date DESC NULLS LAST
  ),
  yiw AS (
    SELECT c.nm, COUNT(*) FILTER (WHERE j.status_after='Employed')::int AS employed_youth
    FROM cfs c JOIN jt j ON j.ikey = c.sortkey
    GROUP BY c.nm
  ),
  -- ---- Assemble per-CF metrics ----
  metrics AS (
    SELECT
      c.nm,
      COALESCE(p.shgs_profiled,0)     AS shgs_profiled,
      COALESCE(p.youth_mobilized,0)   AS youth_mobilized,
      COALESCE(i.shgs_saving,0)       AS shgs_saving,
      COALESCE(t.groups_trained,0)    AS groups_trained,
      COALESCE(py.youth_production,0) AS youth_production,
      COALESCE(po.birds_sold,0)       AS birds_sold,
      COALESCE(hs.hs_value,0)         AS hs_value,
      COALESCE(lv.lev_count,0)        AS lev_count,
      COALESCE(yw.employed_youth,0)   AS employed_youth
    FROM cfs c
    LEFT JOIN prof p        ON p.nm  = c.nm
    LEFT JOIN isla i        ON i.nm  = c.nm
    LEFT JOIN trained t     ON t.nm  = c.nm
    LEFT JOIN prod_youth py ON py.nm = c.nm
    LEFT JOIN poultry po    ON po.nm = c.nm
    LEFT JOIN hsales hs     ON hs.nm = c.nm
    LEFT JOIN lev lv        ON lv.nm = c.nm
    LEFT JOIN yiw yw        ON yw.nm = c.nm
  ),
  scored AS (
    SELECT m.*,
      -- 1. SHGs Saving / SHGs Profiled (%)  (option B)
      CASE WHEN shgs_profiled>0 THEN round(100.0*shgs_saving/shgs_profiled) ELSE 0 END AS m_saving_ratio,
      -- 4. Youth in Work % = employed / (0.70 × mobilized)
      CASE WHEN youth_mobilized>0 THEN round(100.0*employed_youth/(0.70*youth_mobilized)) ELSE 0 END AS m_yiw_pct
    FROM metrics m
  ),
  pct AS (
    SELECT s.*,
      least(100, m_saving_ratio)                            AS p1_saving,
      least(100, round(100.0*youth_production/400))         AS p2_production,
      least(100, round(100.0*groups_trained/16))            AS p3_trained,
      least(100, m_yiw_pct)                                 AS p4_yiw,
      CASE WHEN birds_sold > 0 THEN 100 ELSE 0 END          AS p5_poultry,
      CASE WHEN hs_value   > 0 THEN 100 ELSE 0 END          AS p6_hortsales,
      CASE WHEN lev_count  > 0 THEN 100 ELSE 0 END          AS p7_leverage
    FROM scored s
  ),
  ranked AS (
    SELECT p.*,
      round((p1_saving+p2_production+p3_trained+p4_yiw+p5_poultry+p6_hortsales+p7_leverage)/7.0)::int AS overall
    FROM pct p
  )
  SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'key',              nm,
        'name',             initcap(nm),
        'overall',          overall,
        -- raw achieved values
        'shgs_profiled',    shgs_profiled,
        'shgs_saving',      shgs_saving,
        'saving_ratio',     m_saving_ratio,
        'youth_production', youth_production,
        'groups_trained',   groups_trained,
        'youth_mobilized',  youth_mobilized,
        'employed_youth',   employed_youth,
        'yiw_pct',          m_yiw_pct,
        'birds_sold',       birds_sold,
        'hs_value',         hs_value,
        'lev_count',        lev_count,
        -- per-metric % (capped) for the league columns
        'p1_saving',        p1_saving,
        'p2_production',    p2_production,
        'p3_trained',       p3_trained,
        'p4_yiw',           p4_yiw,
        'p5_poultry',       p5_poultry,
        'p6_hortsales',     p6_hortsales,
        'p7_leverage',      p7_leverage
      ) ORDER BY overall DESC, initcap(nm)
    ), '[]'::jsonb)
    INTO v
  FROM ranked
  WHERE overall > 0
     OR shgs_profiled > 0 OR youth_production > 0 OR groups_trained > 0
     OR employed_youth > 0 OR birds_sold > 0 OR hs_value > 0 OR lev_count > 0;

  RETURN coalesce(v, '[]'::jsonb);
END;
$function$;
