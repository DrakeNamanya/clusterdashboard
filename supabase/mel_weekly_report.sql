-- ============================================================================
-- WEEKLY REPORT  —  Mon→Sun summary of ALL indicators, per cluster.
--   mel_weekly_report(districts text[], from date, to date)
--   Returns a jsonb bundle used to render the weekly highlights narrative.
-- ============================================================================
DROP FUNCTION IF EXISTS public.mel_weekly_report(text[], date, date);

CREATE OR REPLACE FUNCTION public.mel_weekly_report(
  p_districts text[] DEFAULT NULL,
  p_date_from date   DEFAULT NULL,
  p_date_to   date   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v jsonb;
  v_dl text[];
BEGIN
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN v_dl := NULL;
  ELSE SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  WITH
  -- ---------- PROFILING & SHG FORMATION (shg_profiling_rows) ----------
  prof AS (
    SELECT * FROM shg_profiling_rows
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
  ),
  prof_tot AS (
    SELECT COUNT(*)::int AS shgs_formed,
           COALESCE(SUM(total),0)::int  AS youth_profiled,
           COALESCE(SUM(female),0)::int AS female_profiled,
           COALESCE(SUM(male),0)::int   AS male_profiled
    FROM prof
  ),
  -- ---------- TRAINING (at_rows) by training_type ----------
  tr AS (
    SELECT participant_id, training_type, (day)::date AS d, district
    FROM at_rows
    WHERE has_date=1 AND day ~ '^\d{4}-\d{2}-\d{2}'
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR (day)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (day)::date <= p_date_to)
  ),
  tr_tot AS ( SELECT COUNT(DISTINCT participant_id)::int AS trained FROM tr ),
  tr_by AS (
    SELECT training_type, COUNT(DISTINCT participant_id)::int AS n
    FROM tr GROUP BY 1 ORDER BY 2 DESC
  ),
  -- ---------- DISTRIBUTION ----------
  dist AS (
    SELECT * FROM distribution_rows
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR dist_date <= p_date_to)
  ),
  dist_tot AS (
    SELECT COUNT(*)::int AS lines,
           COUNT(DISTINCT participant_id)::int AS participants,
           COUNT(DISTINCT shg_name)::int AS shgs
    FROM dist
  ),
  -- ---------- PRODUCTION (Horticulture + Oil seeds) ----------
  prod AS (
    SELECT * FROM production_rows
    WHERE lower(pdn_level)='production'
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  prod_tot AS (
    SELECT COUNT(DISTINCT shg_participant_id)::int AS youth,
           COUNT(DISTINCT shg_id)::int AS shgs,
           COUNT(DISTINCT upper(district_name))::int AS districts,
           string_agg(DISTINCT initcap(lower(district_name)), ', ') AS district_list
    FROM prod
  ),
  -- ---------- POULTRY SALES ----------
  ps AS (
    SELECT * FROM poultry_sales_rows
    WHERE (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  ps_tot AS (
    SELECT COALESCE(SUM(poultry_sold),0)::numeric AS birds_sold,
           COUNT(DISTINCT shg_participant_id)::int AS youth,
           COUNT(DISTINCT shg_id)::int AS shgs,
           COALESCE(SUM(total_poultry_value),0)::numeric AS value,
           string_agg(DISTINCT initcap(lower(district_name)), ', ') AS district_list
    FROM ps
  ),
  -- ---------- HORTICULTURE / OILSEED SALES ----------
  hs AS (
    SELECT * FROM sales_rows
    WHERE (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  hs_tot AS (
    SELECT COUNT(DISTINCT shg_participant_id)::int AS youth,
           COALESCE(SUM(total_planting_value),0)::numeric AS value
    FROM hs
  ),
  -- ---------- ISLA (savings & loans) ----------
  isla AS (
    SELECT * FROM isla_final_rows
    WHERE (v_dl IS NULL OR upper(district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  isla_tot AS (
    -- MEL rules (per client):
    --   amount saved       = SUM(savings_value)
    --   youth saving       = SUM(youth_group_saving), each row capped: >35 -> 30 (outlier)
    --   loans given (value)= SUM(youth_loans_value_given)
    --   youth who got loans= SUM(loans), each row capped: >35 -> 30 (outlier)
    SELECT COUNT(DISTINCT shg_id)::int AS shgs,
           COALESCE(SUM(savings_value),0)::numeric AS savings,
           COALESCE(SUM(CASE WHEN youth_group_saving > 35 THEN 30 ELSE youth_group_saving END),0)::int AS savers,
           COALESCE(SUM(youth_loans_value_given),0)::numeric AS loans_value,
           COALESCE(SUM(CASE WHEN loans > 35 THEN 30 ELSE loans END),0)::int AS loans_count
    FROM isla
  ),
  -- ---------- LEVERAGE ----------
  lev AS (
    SELECT * FROM local_leverage_rows
    WHERE (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR date_created >= p_date_from)
      AND (p_date_to   IS NULL OR date_created <= p_date_to)
  ),
  lev_tot AS ( SELECT COALESCE(SUM(contribution_amount),0)::numeric AS amount FROM lev )
  SELECT jsonb_build_object(
    'profiling', (SELECT to_jsonb(prof_tot) FROM prof_tot),
    'training_total', (SELECT trained FROM tr_tot),
    'training_by', (SELECT coalesce(jsonb_agg(jsonb_build_object('type',training_type,'n',n)),'[]'::jsonb) FROM tr_by),
    'distribution', (SELECT to_jsonb(dist_tot) FROM dist_tot),
    'production', (SELECT to_jsonb(prod_tot) FROM prod_tot),
    'poultry', (SELECT to_jsonb(ps_tot) FROM ps_tot),
    'hort_sales', (SELECT to_jsonb(hs_tot) FROM hs_tot),
    'isla', (SELECT to_jsonb(isla_tot) FROM isla_tot),
    'leverage', (SELECT to_jsonb(lev_tot) FROM lev_tot)
  ) INTO v;
  RETURN v;
END;
$$;
