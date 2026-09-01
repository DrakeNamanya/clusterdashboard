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
  ELSE SELECT array_agg(public.mel_canon_district(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  WITH
  -- Universe of CFs — read from the pre-computed cache (public.mel_cf_universe,
  -- rebuilt by public.mel_refresh_cf_universe()). This replaces a ~20s inline
  -- scan of 6 source tables (which tripped the edge/Hyperdrive statement ceiling
  -- and returned 503) with a sub-second lookup. District filter is applied
  -- against the cached districts[] array so cluster/district slicing is intact.
  cfs AS (
    SELECT nm, sortkey, akeys
    FROM public.mel_cf_universe
    WHERE (v_dl IS NULL OR districts && v_dl)
  ),
  -- Task E: exact key -> canonical nm map, expanded from the universe akeys.
  -- Every activity CTE resolves its normalised key against THIS (exact match on
  -- ANY of the person's activity keys), so reversed names ("kisira abubakar" vs
  -- "abubakarkisira"), short profiler names ("titus"/"abubakar") and merged
  -- duplicate accounts all roll up to ONE canonical CF row.
  keymap AS (
    SELECT DISTINCT ak AS k, c.nm
    FROM cfs c, unnest(c.akeys) AS ak
    WHERE coalesce(ak,'') <> ''
  ),
  -- ---- PROFILING: SHGs profiled + youth mobilized (for ratio & YiW target) ----
  prof AS (
    SELECT km.nm,
           COUNT(*)::int AS shgs_profiled,
           COALESCE(SUM(total),0)::int AS youth_mobilized
    FROM shg_profiling_rows r
    JOIN keymap km ON km.k = public.mel_norm_key(r.profiler_name)
    WHERE r.profiler_name IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(r.district)=ANY(v_dl))
      AND (p_date_from IS NULL OR r.created_date >= p_date_from)
      AND (p_date_to   IS NULL OR r.created_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- SHGs SAVING (ISLA distinct SHGs) ----
  isla AS (
    SELECT km.nm,
           COUNT(DISTINCT r.shg_id)::int AS shgs_saving
    FROM isla_final_rows r
    JOIN keymap km ON km.k = public.mel_norm_key(r.profilers_name)
    WHERE r.profilers_name IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(r.district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR r.activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR r.activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- GROUPS TRAINED (from the Frontliners attendance master, at_rows) ----
  -- Single source of truth for trainings across ALL CF reports: the "Trainings
  -- by Frontliners" dashboard. groups_trained = distinct groups attended;
  -- youth_trained = attendance rows with a date (has_date=1).
  -- PERF: at_rows has ~820k rows, so we FIRST collapse it to one row per
  -- data_collector using the indexed district/day columns (fast), THEN run the
  -- fuzzy name-key match on that tiny set. Matching the raw table would force a
  -- ~820k × Ncf nested loop with function calls (10s+ -> 503 timeouts).
  at_dc AS (
    SELECT public.mel_norm_key(data_collector) AS k,
           COUNT(DISTINCT group_id) FILTER (WHERE group_id IS NOT NULL)::int AS groups_trained,
           SUM(CASE WHEN has_date = 1 THEN 1 ELSE 0 END)::int                AS youth_trained
    FROM at_rows
    WHERE data_collector IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR day >= p_date_from::text)
      AND (p_date_to   IS NULL OR day <= p_date_to::text)
    GROUP BY 1
  ),
  trained AS (
    SELECT km.nm,
           SUM(a.groups_trained)::int AS groups_trained,
           SUM(a.youth_trained)::int  AS youth_trained
    FROM at_dc a
    JOIN keymap km ON km.k = a.k
    GROUP BY km.nm
  ),
  -- ---- YOUTH INTO PRODUCTION (per M&E, 2026-09-01) ----
  -- DISTINCT participant_id (e.g. HEI-JIN-00122891) credited to this CF from
  -- EITHER (a) the Production & Marketing tool, pdn_level=Production, ALL value
  -- chains (Horticulture, Poultry, Beef, Oil seeds, Dairy — NOT Marketing), OR
  -- (b) livestock distribution with unit=Number (ANY livestock type). A youth in
  -- both is counted once (prod_youth UNIONs then COUNT(DISTINCT pid)).
  prod_hort_pairs AS (   -- (a) all production value chains
    SELECT DISTINCT km.nm, r.shg_participant_id AS pid
    FROM production_rows r
    JOIN keymap km ON km.k = public.mel_norm_key(r.profilers_name)
    WHERE r.profilers_name IS NOT NULL AND lower(r.pdn_level)='production'
      AND r.shg_participant_id IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(r.district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR r.activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR r.activity_date <= p_date_to)
  ),
  dist_matched AS (      -- (b) livestock distributed, unit=Number (all types)
    SELECT km.nm, d.participant_id
    FROM distribution_rows d
    JOIN keymap km ON km.k = public.mel_norm_key(d.submitted_by)
    WHERE lower(coalesce(d.material_type,'')) LIKE '%livestock%'
      AND lower(coalesce(d.unit,'')) = 'number'
      AND d.participant_id IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(d.district)=ANY(v_dl))
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
    SELECT km.nm,
           COALESCE(SUM(r.poultry_sold),0)::numeric AS birds_sold
    FROM poultry_sales_rows r
    JOIN keymap km ON km.k = public.mel_norm_key(r.profilers_name)
    WHERE r.profilers_name IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(r.district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR r.activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR r.activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- SALES (HORTICULTURE / OILSEEDS): pass/fail — any planting value ----
  hsales AS (
    SELECT km.nm,
           COALESCE(SUM(r.total_planting_value),0)::numeric AS hs_value
    FROM sales_rows r
    JOIN keymap km ON km.k = public.mel_norm_key(r.profilers_name)
    WHERE r.profilers_name IS NOT NULL
      AND lower(coalesce(r.value_chain,'')) IN ('horticulture','oil seeds','oilseeds')
      AND (v_dl IS NULL OR public.mel_canon_district(r.district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR r.activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR r.activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- LOCAL LEVERAGE: pass/fail — any contribution ----
  lev AS (
    SELECT km.nm,
           COUNT(*)::int AS lev_count
    FROM local_leverage_rows r
    JOIN keymap km ON km.k = public.mel_norm_key(r.submitter_name)
    WHERE r.submitter_name IS NOT NULL
      AND (v_dl IS NULL OR public.mel_canon_district(r.district)=ANY(v_dl))
      AND (p_date_from IS NULL OR r.date_created >= p_date_from)
      AND (p_date_to   IS NULL OR r.date_created <= p_date_to)
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
      AND (v_dl IS NULL OR public.mel_canon_district(district)=ANY(v_dl))
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
      COALESCE(t.youth_trained,0)     AS youth_trained,
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
        'youth_trained',    youth_trained,
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
