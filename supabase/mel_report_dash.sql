-- ============================================================================
-- MEL Report Dashboard  —  Targets vs Achieved (Production, Reach, Mobilization)
-- Single unified RPC. Filters: district list (cluster) + date range.
-- Targets live in mel_reach_targets (per district per month) and
-- mel_production_targets (per district per season).
-- Achieved is computed live from at_rows / production_rows / distribution_rows /
-- shg_profiling_rows.
-- ----------------------------------------------------------------------------
--  Definitions (per client):
--   * Reach achieved      = NEW YOUTH REACHED = distinct participant, counted at
--                           first training date (MIN day), district = MAX(district)
--                           over first-date rows; filtered by first_date in range.
--   * Reach target        = SUM(mel_reach_targets.monthly_target) over months in range.
--   * Mobilization achiev = SUM(shg_profiling_rows.total), created_date in range.
--   * Mobilization target = SUM(monthly_shgs) * 25  over months in range.
--   * Production achieved = distinct youth in production (Horticulture + Oil seeds,
--                           pdn_level=Production)  +  distribution to participants
--                           (material_type=Livestock AND unit=Number) distinct
--                           participants; activity/dist date in range.
--   * Production target    = SUM(mel_production_targets.y3_target) over the district
--                           set, taken once per district (Y3 annual target), with a
--                           season/expected-jobs breakdown available.
-- ============================================================================

DROP FUNCTION IF EXISTS public.mel_report_dash(text[], date, date);

CREATE OR REPLACE FUNCTION public.mel_report_dash(
  p_districts text[] DEFAULT NULL,
  p_date_from date   DEFAULT NULL,
  p_date_to   date   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
  v_dl text[];
BEGIN
  -- Normalise district filter to UPPER; NULL/empty means "all".
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN
    v_dl := NULL;
  ELSE
    SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x;
  END IF;

  WITH
  -- ---------- REACH ACHIEVED (new youth reached) ----------
  dated AS (
    SELECT participant_id AS pid, (day)::date AS day, district,
           (sex='Female') AS f, (is_pwd=1) AS p, (is_farming=1) AS w
    FROM at_rows
    WHERE participant_id IS NOT NULL AND has_date=1 AND day IS NOT NULL
      AND day ~ '^\d{4}-\d{2}-\d{2}'
  ),
  firsts AS (SELECT pid, MIN(day) AS first_date FROM dated GROUP BY pid),
  ft AS (
    SELECT d.pid, f.first_date, MAX(d.district) AS district,
           bool_or(d.f) AS is_female, bool_or(d.p) AS is_pwd, bool_or(d.w) AS is_work
    FROM dated d JOIN firsts f ON f.pid=d.pid AND d.day=f.first_date
    GROUP BY d.pid, f.first_date
  ),
  reach_sel AS (
    SELECT * FROM ft
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR first_date >= p_date_from)
      AND (p_date_to   IS NULL OR first_date <= p_date_to)
  ),
  reach_by_district AS (
    SELECT upper(district) AS district,
           COUNT(*)::int AS achieved,
           COUNT(*) FILTER (WHERE is_female)::int AS female,
           COUNT(*) FILTER (WHERE is_pwd)::int AS pwd
    FROM reach_sel GROUP BY 1
  ),

  -- ---------- REACH / MOBILIZATION TARGETS ----------
  rt AS (
    SELECT upper(district) AS district,
           SUM(monthly_target) AS reach_target,
           SUM(monthly_shgs)*25 AS mob_target,
           SUM(monthly_female) AS female_target,
           SUM(monthly_pwds) AS pwd_target
    FROM mel_reach_targets
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR month >= date_trunc('month',p_date_from)::date)
      AND (p_date_to   IS NULL OR month <= p_date_to)
    GROUP BY 1
  ),

  -- ---------- MOBILIZATION ACHIEVED (SHG profiling total) ----------
  mob_ach AS (
    SELECT upper(district) AS district, SUM(total)::int AS achieved,
           COUNT(*)::int AS shgs
    FROM shg_profiling_rows
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
    GROUP BY 1
  ),

  -- ---------- PRODUCTION ACHIEVED ----------
  prod_hort AS (   -- youth in production (Horticulture + Oil seeds)
    SELECT upper(district_name) AS district,
           COUNT(DISTINCT shg_participant_id)::int AS n
    FROM production_rows
    WHERE lower(value_chain) IN ('horticulture','oil seeds','oil_seeds')
      AND lower(pdn_level)='production'
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  prod_live AS (   -- livestock distribution (unit=Number)
    SELECT upper(district) AS district,
           COUNT(DISTINCT participant_id)::int AS n
    FROM distribution_rows
    WHERE lower(material_type) LIKE '%livestock%' AND lower(unit)='number'
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR dist_date <= p_date_to)
    GROUP BY 1
  ),
  -- production Y3 target: one row per district (annual), + season breakdown
  ptgt AS (
    SELECT upper(district) AS district, MAX(y3_target) AS y3_target
    FROM mel_production_targets
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
    GROUP BY 1
  ),
  -- union of every district that appears anywhere, so table rows are complete
  all_d AS (
    SELECT district FROM reach_by_district
    UNION SELECT district FROM rt
    UNION SELECT district FROM mob_ach
    UNION SELECT district FROM prod_hort
    UNION SELECT district FROM prod_live
    UNION SELECT district FROM ptgt
  ),
  reach_tbl AS (
    SELECT a.district,
           COALESCE(rt.reach_target,0)::numeric      AS target,
           COALESCE(rb.achieved,0)::int              AS achieved,
           COALESCE(rt.reach_target,0)::numeric - COALESCE(rb.achieved,0) AS balance
    FROM all_d a
    LEFT JOIN rt ON rt.district=a.district
    LEFT JOIN reach_by_district rb ON rb.district=a.district
    WHERE COALESCE(rt.reach_target,0)<>0 OR COALESCE(rb.achieved,0)<>0
  ),
  mob_tbl AS (
    SELECT a.district,
           COALESCE(rt.mob_target,0)::numeric        AS target,
           COALESCE(ma.achieved,0)::int              AS achieved
    FROM all_d a
    LEFT JOIN rt ON rt.district=a.district
    LEFT JOIN mob_ach ma ON ma.district=a.district
    WHERE COALESCE(rt.mob_target,0)<>0 OR COALESCE(ma.achieved,0)<>0
  ),
  prod_tbl AS (
    SELECT a.district,
           COALESCE(pt.y3_target,0)::numeric         AS target,
           COALESCE(ph.n,0) + COALESCE(pl.n,0)       AS achieved,
           COALESCE(ph.n,0)                          AS youth_in_prod,
           COALESCE(pl.n,0)                          AS livestock_dist
    FROM all_d a
    LEFT JOIN ptgt pt ON pt.district=a.district
    LEFT JOIN prod_hort ph ON ph.district=a.district
    LEFT JOIN prod_live pl ON pl.district=a.district
    WHERE COALESCE(pt.y3_target,0)<>0 OR COALESCE(ph.n,0)<>0 OR COALESCE(pl.n,0)<>0
  ),
  -- season breakdown for production targets (per district per season)
  season_tbl AS (
    SELECT upper(district) AS district, season,
           y3_target, expected_jobs, poultry, goats, horticulture, dairy, total_achieved
    FROM mel_production_targets
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
    ORDER BY district, season
  )
  SELECT jsonb_build_object(
    'reach', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'district',district,'target',round(target),'achieved',achieved,
                 'balance',round(balance),
                 'pct', CASE WHEN target>0 THEN round(100.0*achieved/target,1) ELSE NULL END
               ) ORDER BY target DESC), '[]'::jsonb) FROM reach_tbl),
    'mobilization', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'district',district,'target',round(target),'achieved',achieved,
                 'pct', CASE WHEN target>0 THEN round(100.0*achieved/target,1) ELSE NULL END
               ) ORDER BY target DESC), '[]'::jsonb) FROM mob_tbl),
    'production', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'district',district,'target',round(target),'achieved',achieved,
                 'youth_in_prod',youth_in_prod,'livestock_dist',livestock_dist,
                 'pct', CASE WHEN target>0 THEN round(100.0*achieved/target,1) ELSE NULL END
               ) ORDER BY target DESC), '[]'::jsonb) FROM prod_tbl),
    'production_seasons', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'district',district,'season',season,'y3_target',y3_target,
                 'expected_jobs',expected_jobs,'poultry',poultry,'goats',goats,
                 'horticulture',horticulture,'dairy',dairy,'total_achieved',total_achieved
               )), '[]'::jsonb) FROM season_tbl),
    'totals', jsonb_build_object(
        'reach_target',      (SELECT COALESCE(SUM(target),0) FROM reach_tbl),
        'reach_achieved',    (SELECT COALESCE(SUM(achieved),0) FROM reach_tbl),
        'mob_target',        (SELECT COALESCE(SUM(target),0) FROM mob_tbl),
        'mob_achieved',      (SELECT COALESCE(SUM(achieved),0) FROM mob_tbl),
        'prod_target',       (SELECT COALESCE(SUM(target),0) FROM prod_tbl),
        'prod_achieved',     (SELECT COALESCE(SUM(achieved),0) FROM prod_tbl)
    ),
    'date_bounds', jsonb_build_object(
        'min',(SELECT MIN(first_date) FROM ft),
        'max',(SELECT MAX(first_date) FROM ft))
  ) INTO v_result;

  RETURN v_result;
END;
$$;
