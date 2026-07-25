-- ============================================================================
-- COMMUNITY FACILITATOR (CF) REPORT CARD
--   Per field-staff activity extract across:
--     trainings (frontliners), distribution, shg profiling, isla savings,
--     production, sales horticulture, sales poultry, local leverage.
--
--   Staff identity: real human names live in profiler_name (profiling) and
--   profilers_name (production/poultry/sales/isla). Leverage uses
--   submitter_name. We normalise (trim+lower) for matching and expose an
--   initcap display name. Trainings (at_rows.data_collector) and distribution
--   (submitted_by) are SYSTEM usernames — NOT matchable to CF names — so those
--   two blocks are matched on the normalised CF name ONLY when it happens to
--   appear there; otherwise they simply return zero for that staff.
--
--   mel_cf_report_staff(districts text[])          -> jsonb array of staff
--   mel_cf_report(staff text, districts, from, to) -> jsonb card bundle
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STAFF LIST  (distinct normalised CF names, optionally filtered by district)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mel_cf_report_staff(text[]);
CREATE OR REPLACE FUNCTION public.mel_cf_report_staff(
  p_districts text[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE v jsonb; v_dl text[];
BEGIN
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN v_dl := NULL;
  ELSE SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  WITH allnames AS (
    SELECT trim(lower(profiler_name))  AS nm, upper(district)      AS d FROM shg_profiling_rows WHERE profiler_name  IS NOT NULL
    UNION ALL SELECT trim(lower(profilers_name)), upper(district_name) FROM production_rows      WHERE profilers_name IS NOT NULL
    UNION ALL SELECT trim(lower(profilers_name)), upper(district_name) FROM poultry_sales_rows   WHERE profilers_name IS NOT NULL
    UNION ALL SELECT trim(lower(profilers_name)), upper(district_name) FROM sales_rows           WHERE profilers_name IS NOT NULL
    UNION ALL SELECT trim(lower(profilers_name)), upper(district_shg)  FROM isla_final_rows       WHERE profilers_name IS NOT NULL
    UNION ALL SELECT trim(lower(submitter_name)), upper(district)      FROM local_leverage_rows   WHERE submitter_name IS NOT NULL
  ),
  filtered AS (
    SELECT nm, count(*) c FROM allnames
    WHERE nm <> '' AND nm ~ '[a-z]'          -- must contain a letter (drop phone-only)
      AND (v_dl IS NULL OR d = ANY(v_dl))
    GROUP BY nm
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', nm, 'name', initcap(nm), 'activities', c) ORDER BY initcap(nm)), '[]'::jsonb)
  INTO v FROM filtered;
  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------------
-- CF REPORT CARD
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mel_cf_report(text, text[], date, date);
CREATE OR REPLACE FUNCTION public.mel_cf_report(
  p_staff     text,
  p_districts text[] DEFAULT NULL,
  p_date_from date   DEFAULT NULL,
  p_date_to   date   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v jsonb;
  v_dl  text[];
  v_key text;
BEGIN
  v_key := trim(lower(p_staff));
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN v_dl := NULL;
  ELSE SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  WITH
  -- ---------- SHG PROFILING ----------
  prof AS (
    SELECT * FROM shg_profiling_rows
    WHERE trim(lower(profiler_name)) = v_key
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
  ),
  prof_t AS (
    SELECT COUNT(*)::int AS shgs_profiled,
           COALESCE(SUM(total),0)::int AS youth_profiled,
           COALESCE(SUM(female),0)::int AS female,
           COALESCE(SUM(male),0)::int AS male,
           COALESCE(SUM(pwd),0)::int AS pwd
    FROM prof
  ),
  -- ---------- TRAININGS BY FRONTLINER (at_rows keyed on data_collector) ----------
  tr AS (
    SELECT participant_id, training_type FROM at_rows
    WHERE trim(lower(data_collector)) = v_key
      AND has_date=1 AND day ~ '^\d{4}-\d{2}-\d{2}'
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR (day)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (day)::date <= p_date_to)
  ),
  tr_t AS ( SELECT COUNT(DISTINCT participant_id)::int AS youth_trained,
                   COUNT(DISTINCT training_type)::int AS training_areas FROM tr ),
  -- ---------- DISTRIBUTION (submitted_by = system username; matched if present) ----------
  dist AS (
    SELECT * FROM distribution_rows
    WHERE trim(lower(submitted_by)) = v_key
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR dist_date <= p_date_to)
  ),
  dist_t AS ( SELECT COUNT(*)::int AS dist_lines,
                     COUNT(DISTINCT participant_id)::int AS dist_participants FROM dist ),
  -- ---------- PRODUCTION ----------
  prod AS (
    SELECT * FROM production_rows
    WHERE trim(lower(profilers_name)) = v_key AND lower(pdn_level)='production'
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  prod_t AS ( SELECT COUNT(DISTINCT shg_participant_id)::int AS prod_youth,
                     COUNT(DISTINCT shg_id)::int AS prod_shgs FROM prod ),
  -- ---------- SALES HORTICULTURE ----------
  hs AS (
    SELECT * FROM sales_rows
    WHERE trim(lower(profilers_name)) = v_key
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  hs_t AS ( SELECT COUNT(DISTINCT shg_participant_id)::int AS hs_youth,
                   COALESCE(SUM(total_planting_value),0)::numeric AS hs_value FROM hs ),
  -- ---------- SALES POULTRY ----------
  ps AS (
    SELECT * FROM poultry_sales_rows
    WHERE trim(lower(profilers_name)) = v_key
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  ps_t AS ( SELECT COALESCE(SUM(poultry_sold),0)::numeric AS birds_sold,
                   COUNT(DISTINCT shg_participant_id)::int AS ps_youth,
                   COALESCE(SUM(total_poultry_value),0)::numeric AS ps_value FROM ps ),
  -- ---------- ISLA SAVINGS ----------
  isla AS (
    SELECT * FROM isla_final_rows
    WHERE trim(lower(profilers_name)) = v_key
      AND (v_dl IS NULL OR upper(district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  isla_t AS ( SELECT COUNT(DISTINCT shg_id)::int AS isla_shgs,
                     COALESCE(SUM(youth_savings_value),0)::numeric AS savings,
                     COALESCE(SUM(loans_value_given),0)::numeric AS loans_value FROM isla ),
  -- ---------- LOCAL LEVERAGE ----------
  lev AS (
    SELECT * FROM local_leverage_rows
    WHERE trim(lower(submitter_name)) = v_key
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR date_created >= p_date_from)
      AND (p_date_to   IS NULL OR date_created <= p_date_to)
  ),
  lev_t AS ( SELECT COUNT(*)::int AS lev_count,
                    COALESCE(SUM(contribution_amount),0)::numeric AS lev_amount FROM lev ),
  -- ---------- DISTRICTS worked in ----------
  ctx AS (
    SELECT string_agg(DISTINCT d, ', ') AS districts FROM (
      SELECT upper(district) d FROM prof
      UNION SELECT upper(district_name) FROM prod
      UNION SELECT upper(district_name) FROM hs
      UNION SELECT upper(district_name) FROM ps
      UNION SELECT upper(district_shg) FROM isla
      UNION SELECT upper(district) FROM lev
    ) q WHERE d IS NOT NULL
  )
  SELECT jsonb_build_object(
    'staff_name', initcap(v_key),
    'districts',  (SELECT initcap(lower(districts)) FROM ctx),
    'profiling',  (SELECT to_jsonb(prof_t) FROM prof_t),
    'training',   (SELECT to_jsonb(tr_t)   FROM tr_t),
    'distribution', (SELECT to_jsonb(dist_t) FROM dist_t),
    'production', (SELECT to_jsonb(prod_t) FROM prod_t),
    'hort_sales', (SELECT to_jsonb(hs_t)   FROM hs_t),
    'poultry',    (SELECT to_jsonb(ps_t)   FROM ps_t),
    'isla',       (SELECT to_jsonb(isla_t) FROM isla_t),
    'leverage',   (SELECT to_jsonb(lev_t)  FROM lev_t)
  ) INTO v;
  RETURN v;
END;
$$;
