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
-- NAME NORMALISER (Level-1 cleaning)
--   lowercase -> strip everything except a-z and space -> collapse runs of
--   whitespace to a single space -> trim.  This merges the common dirty-data
--   variants of the SAME person:
--     "Akunyo  Beatrice" / "akunyo   beatrice" / "Akunyo. Beatrice" -> "akunyo beatrice"
--     "Ajiambo Catherine Owino." -> "ajiambo catherine owino"
--   It deliberately does NOT do fuzzy/typo merging (that is handled by the
--   user-driven multi-select merge in the UI).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_norm_name(txt text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(
           regexp_replace(lower(coalesce(txt,'')), '[^a-z ]', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;
GRANT EXECUTE ON FUNCTION public.mel_norm_name(text) TO anon, service_role;

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
    SELECT public.mel_norm_name(profiler_name)  AS nm, upper(district)      AS d FROM shg_profiling_rows WHERE profiler_name  IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM production_rows      WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM poultry_sales_rows   WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM sales_rows           WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_shg)  FROM isla_final_rows       WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(submitter_name), upper(district)      FROM local_leverage_rows   WHERE submitter_name IS NOT NULL
  ),
  filtered AS (
    SELECT nm, count(*) c FROM allnames
    WHERE nm <> '' AND nm ~ '[a-z]'          -- must contain a letter (drop phone-only)
      AND nm ~ ' '                           -- must have at least 2 words (drop single-word junk like "a","aman")
      -- drop obvious non-person / group entries
      AND nm !~ '(group|association|farmers|youth farmers|provision of|self help|shg|village|cluster|community)'
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
  v_dl   text[];
  v_keys text[];
  v_label text;
BEGIN
  -- p_staff may be a single normalised key OR several joined by '|' (the UI
  -- multi-select merge sends the chosen keys pipe-joined).  Normalise each.
  SELECT array_agg(DISTINCT public.mel_norm_name(x))
    INTO v_keys
    FROM unnest(string_to_array(coalesce(p_staff,''), '|')) x
   WHERE public.mel_norm_name(x) <> '';
  IF v_keys IS NULL OR array_length(v_keys,1) IS NULL THEN v_keys := ARRAY['']; END IF;
  -- Display label: initcap of the first key (merged staff share one card).
  v_label := initcap(v_keys[1]);
  IF array_length(v_keys,1) > 1 THEN
    v_label := v_label || ' (+' || (array_length(v_keys,1)-1)::text || ' merged)';
  END IF;
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN v_dl := NULL;
  ELSE SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  WITH
  -- ---------- SHG PROFILING ----------
  prof AS (
    SELECT * FROM shg_profiling_rows
    WHERE public.mel_norm_name(profiler_name) = ANY(v_keys)
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
    WHERE public.mel_norm_name(data_collector) = ANY(v_keys)
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
    WHERE public.mel_norm_name(submitted_by) = ANY(v_keys)
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR dist_date <= p_date_to)
  ),
  dist_t AS ( SELECT COUNT(*)::int AS dist_lines,
                     COUNT(DISTINCT participant_id)::int AS dist_participants FROM dist ),
  -- ---------- PRODUCTION ----------
  prod AS (
    SELECT * FROM production_rows
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys) AND lower(pdn_level)='production'
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  prod_t AS ( SELECT COUNT(DISTINCT shg_participant_id)::int AS prod_youth,
                     COUNT(DISTINCT shg_id)::int AS prod_shgs FROM prod ),
  -- ---------- SALES HORTICULTURE ----------
  hs AS (
    SELECT * FROM sales_rows
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys)
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  hs_t AS ( SELECT COUNT(DISTINCT shg_participant_id)::int AS hs_youth,
                   COALESCE(SUM(total_planting_value),0)::numeric AS hs_value FROM hs ),
  -- ---------- SALES POULTRY ----------
  ps AS (
    SELECT * FROM poultry_sales_rows
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys)
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
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys)
      AND (v_dl IS NULL OR upper(district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  -- MEL rules (per client): amount saved = SUM(savings_value);
  -- loans given (value) = SUM(youth_loans_value_given);
  -- youth saving = SUM(youth_group_saving) capped per row (>35 -> 30);
  -- youth who got loans = SUM(loans) capped per row (>35 -> 30).
  isla_t AS ( SELECT COUNT(DISTINCT shg_id)::int AS isla_shgs,
                     COALESCE(SUM(savings_value),0)::numeric AS savings,
                     COALESCE(SUM(youth_loans_value_given),0)::numeric AS loans_value,
                     COALESCE(SUM(CASE WHEN youth_group_saving > 35 THEN 30 ELSE youth_group_saving END),0)::int AS youth_savers,
                     COALESCE(SUM(CASE WHEN loans > 35 THEN 30 ELSE loans END),0)::int AS youth_loans FROM isla ),
  -- ---------- LOCAL LEVERAGE ----------
  lev AS (
    SELECT * FROM local_leverage_rows
    WHERE public.mel_norm_name(submitter_name) = ANY(v_keys)
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
    'staff_name', v_label,
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
