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
    SELECT array_agg(public.mel_canon_district(x)) INTO v_dl FROM unnest(p_districts) x;
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
    WHERE (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR first_date >= p_date_from)
      AND (p_date_to   IS NULL OR first_date <= p_date_to)
  ),
  reach_by_district AS (
    SELECT public.mel_canon_district(district) AS district,
           COUNT(*)::int AS achieved,
           COUNT(*) FILTER (WHERE is_female)::int AS female,
           COUNT(*) FILTER (WHERE is_pwd)::int AS pwd
    FROM reach_sel GROUP BY 1
  ),

  -- ---------- REACH / MOBILIZATION TARGETS ----------
  rt AS (
    SELECT public.mel_canon_district(district) AS district,
           SUM(monthly_target) AS reach_target,
           SUM(monthly_shgs)*25 AS mob_target,
           SUM(monthly_female) AS female_target,
           SUM(monthly_pwds) AS pwd_target
    FROM mel_reach_targets
    WHERE (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR month >= date_trunc('month',p_date_from)::date)
      AND (p_date_to   IS NULL OR month <= p_date_to)
    GROUP BY 1
  ),

  -- ---------- MOBILIZATION ACHIEVED (youth profiling form) ----------
  -- DEFINITION (per M&E, 2026-09-01): Mobilization achieved = the number of
  -- YOUTHS PROFILED, i.e. COUNT(DISTINCT _id) of youth_profiling submissions in
  -- the selected district(s) and date range — exactly what the MIS
  -- `youth_profiling_form_odata_view` returns when you count unique records for
  -- "Aug 1 to date". It was previously SUM(shg_profiling_rows.total) — the number
  -- of members in SHG *groups* whose GROUP profiling record was created in the
  -- range (dated by group-creation, not by youth-profiling date), which
  -- under-counted (Mayuge showed 461 vs the MIS's ~769).
  --
  -- Date field: `dateCreated` is the submission timestamp and is 100% populated,
  -- so it is the reliable "date profiled" the MIS filter uses. Female/PWD are
  -- read from the youth record's own Sex / Disability_status fields.
  yp AS (
    SELECT DISTINCT ON (data->>'_id')
           public.mel_canon_district(data->>'district_name') AS district,
           data->>'_id'                                       AS uid,
           lower(trim(data->>'Sex'))                          AS sex,
           lower(trim(data->>'Disability_status'))            AS disability,
           left(coalesce(nullif(data->>'dateCreated',''),
                         data->>'Date_start'), 10)::date       AS prof_date
    FROM records
    WHERE template='youth_profiling'
      AND coalesce(data->>'_id','') <> ''
  ),
  mob_ach AS (
    SELECT district,
           COUNT(*)::int                                          AS achieved,
           COUNT(*) FILTER (WHERE sex='female')::int              AS female,
           COUNT(*) FILTER (WHERE disability='yes')::int          AS pwd,
           0::int                                                 AS shgs
    FROM yp
    WHERE district IS NOT NULL
      AND (v_dl IS NULL OR district = ANY(v_dl))
      AND (p_date_from IS NULL OR prof_date >= p_date_from)
      AND (p_date_to   IS NULL OR prof_date <= p_date_to)
    GROUP BY 1
  ),

  -- ---------- PRODUCTION ACHIEVED ----------
  -- DEFINITION (per M&E, 2026-09-01): a youth is "in production" if their
  -- participant_id (e.g. HEI-JIN-00122891) appears in EITHER
  --   (a) the Production & Marketing tool with pdn_level=Production (ALL value
  --       chains — Horticulture, Poultry, Beef, Oil seeds, Dairy; NOT Marketing), OR
  --   (b) livestock distribution with unit=Number.
  -- Achieved = COUNT(DISTINCT participant_id) across the UNION of (a) and (b), so
  -- a youth who is in both is counted ONCE (no double count).
  --
  -- prod_pids / live_pids collect the DISTINCT participant ids per district for
  -- each source; prod_hort / prod_live keep the per-source headline counts for
  -- the "youth_in_prod" and "livestock_dist" breakdown columns.
  prod_pids AS (   -- (a) all production value chains, one row per (district,pid)
    SELECT DISTINCT public.mel_canon_district(district_name) AS district,
           shg_participant_id AS pid
    FROM production_rows
    WHERE lower(pdn_level)='production'
      AND shg_participant_id IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  live_pids AS (   -- (b) livestock distribution (unit=Number)
    SELECT DISTINCT public.mel_canon_district(district) AS district,
           participant_id AS pid
    FROM distribution_rows
    WHERE lower(material_type) LIKE '%livestock%' AND lower(unit)='number'
      AND participant_id IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR dist_date <= p_date_to)
  ),
  prod_hort AS (   -- headline: youth in production (ALL value chains)
    SELECT district, COUNT(*)::int AS n FROM prod_pids GROUP BY district
  ),
  prod_live AS (   -- headline: youth who received distributed livestock (Number)
    SELECT district, COUNT(*)::int AS n FROM live_pids GROUP BY district
  ),
  prod_union AS ( -- DISTINCT participants across BOTH sources = "achieved"
    SELECT district, COUNT(*)::int AS n FROM (
      SELECT district, pid FROM prod_pids
      UNION
      SELECT district, pid FROM live_pids
    ) u GROUP BY district
  ),
  -- production Y3 target: one row per district (annual), + season breakdown
  ptgt AS (
    SELECT public.mel_canon_district(district) AS district, MAX(y3_target) AS y3_target
    FROM mel_production_targets
    WHERE (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
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
           COALESCE(rb.female,0)::int                AS female,
           COALESCE(rb.pwd,0)::int                   AS pwd,
           COALESCE(rt.reach_target,0)::numeric - COALESCE(rb.achieved,0) AS balance
    FROM all_d a
    LEFT JOIN rt ON rt.district=a.district
    LEFT JOIN reach_by_district rb ON rb.district=a.district
    WHERE COALESCE(rt.reach_target,0)<>0 OR COALESCE(rb.achieved,0)<>0
  ),
  mob_tbl AS (
    SELECT a.district,
           COALESCE(rt.mob_target,0)::numeric        AS target,
           COALESCE(ma.achieved,0)::int              AS achieved,
           COALESCE(ma.female,0)::int                AS female,
           COALESCE(ma.pwd,0)::int                   AS pwd
    FROM all_d a
    LEFT JOIN rt ON rt.district=a.district
    LEFT JOIN mob_ach ma ON ma.district=a.district
    WHERE COALESCE(rt.mob_target,0)<>0 OR COALESCE(ma.achieved,0)<>0
  ),
  prod_tbl AS (
    SELECT a.district,
           COALESCE(pt.y3_target,0)::numeric         AS target,
           COALESCE(pu.n,0)                          AS achieved,      -- DISTINCT union
           COALESCE(ph.n,0)                          AS youth_in_prod, -- (a) all chains
           COALESCE(pl.n,0)                          AS livestock_dist -- (b) livestock=Number
    FROM all_d a
    LEFT JOIN ptgt pt ON pt.district=a.district
    LEFT JOIN prod_hort ph ON ph.district=a.district
    LEFT JOIN prod_live pl ON pl.district=a.district
    LEFT JOIN prod_union pu ON pu.district=a.district
    WHERE COALESCE(pt.y3_target,0)<>0 OR COALESCE(ph.n,0)<>0 OR COALESCE(pl.n,0)<>0
  ),
  -- season breakdown for production targets (per district per season)
  season_tbl AS (
    SELECT public.mel_canon_district(district) AS district, season,
           y3_target, expected_jobs, poultry, goats, horticulture, dairy, total_achieved
    FROM mel_production_targets
    WHERE (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
    ORDER BY district, season
  ),
  -- ---------- PRODUCTION MONTHLY CURVE ----------
  -- One point per calendar month = COUNT(DISTINCT participant_id) who entered
  -- production that month, using the SAME definition as the Production card
  -- (production form pdn_level=Production, ALL value chains  UNION  livestock
  -- distribution unit=Number). Respects the district filter but spans the WHOLE
  -- timeline (independent of the date range) so the trend line is always full.
  pm_prod AS (
    SELECT date_trunc('month', activity_date)::date AS mon,
           shg_participant_id AS pid
    FROM production_rows
    WHERE lower(pdn_level)='production'
      AND shg_participant_id IS NOT NULL
      AND activity_date IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(district_name)=ANY(v_dl))
  ),
  pm_live AS (
    SELECT date_trunc('month', dist_date)::date AS mon,
           participant_id AS pid
    FROM distribution_rows
    WHERE lower(material_type) LIKE '%livestock%' AND lower(unit)='number'
      AND participant_id IS NOT NULL
      AND dist_date IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
  ),
  prod_monthly AS (
    SELECT mon, COUNT(DISTINCT pid)::int AS n
    FROM ( SELECT mon, pid FROM pm_prod
           UNION ALL
           SELECT mon, pid FROM pm_live ) u
    GROUP BY mon
    ORDER BY mon
  )
  SELECT jsonb_build_object(
    'reach', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'district',district,'target',round(target),'achieved',achieved,
                 'female',female,'pwd',pwd,
                 'balance',round(balance),
                 'pct', CASE WHEN target>0 THEN round(100.0*achieved/target,1) ELSE NULL END
               ) ORDER BY target DESC), '[]'::jsonb) FROM reach_tbl),
    'mobilization', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'district',district,'target',round(target),'achieved',achieved,
                 'female',female,'pwd',pwd,
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
    'production_monthly', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'month', to_char(mon,'YYYY-MM'), 'n', n
               ) ORDER BY mon), '[]'::jsonb) FROM prod_monthly),
    'totals', jsonb_build_object(
        'reach_target',      (SELECT COALESCE(SUM(target),0) FROM reach_tbl),
        'reach_achieved',    (SELECT COALESCE(SUM(achieved),0) FROM reach_tbl),
        'reach_female',      (SELECT COALESCE(SUM(female),0) FROM reach_tbl),
        'reach_pwd',         (SELECT COALESCE(SUM(pwd),0) FROM reach_tbl),
        'mob_target',        (SELECT COALESCE(SUM(target),0) FROM mob_tbl),
        'mob_achieved',      (SELECT COALESCE(SUM(achieved),0) FROM mob_tbl),
        'mob_female',        (SELECT COALESCE(SUM(female),0) FROM mob_tbl),
        'mob_pwd',           (SELECT COALESCE(SUM(pwd),0) FROM mob_tbl),
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
