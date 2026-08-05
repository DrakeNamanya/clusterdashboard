-- mel_cf_payment_report(districts[], from, to) -> jsonb[]
-- ONE consolidated end-of-month payment report combining ALL Community
-- Facilitators (unlike the CF Report which prints one CF at a time).
-- Filtered by date + district. Each CF row carries the per-indicator figures
-- needed to render the 9 indicator sections (A1..A9) plus the OVERALL grade
-- (same 7-metric average as the CF Premier League / CF Report Card). The
-- dashboard turns `overall` into a GRADE letter (A..E) that REPLACES the old
-- manual "Status" column.
--
-- SET-BASED single pass (fast) — not a per-CF loop.
CREATE OR REPLACE FUNCTION public.mel_cf_payment_report(
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
  -- Universe of CFs — read from the pre-computed cache (public.mel_cf_universe,
  -- rebuilt by public.mel_refresh_cf_universe()). Replaces a ~20s inline scan of
  -- 6 source tables (which tripped the edge/Hyperdrive ceiling → 503) with a
  -- sub-second lookup. `district` is the alphabetical-max of the CF's districts
  -- within the selected filter (mirrors the old max(d) behaviour).
  cfs AS (
    SELECT nm,
           (SELECT max(x) FROM unnest(districts) x
             WHERE v_dl IS NULL OR x = ANY(v_dl)) AS district,
           sortkey
    FROM public.mel_cf_universe
    WHERE (v_dl IS NULL OR districts && v_dl)
  ),
  -- ---- A1 PROFILING: SHGs, youth, female/male, mobilized (for ratio & YiW) ----
  prof AS (
    SELECT public.mel_norm_name(profiler_name) AS nm,
           COUNT(*)::int AS shgs_profiled,
           COALESCE(SUM(total),0)::int  AS youth_profiled,
           COALESCE(SUM(female),0)::int AS prof_female,
           COALESCE(SUM(male),0)::int   AS prof_male
    FROM shg_profiling_rows
    WHERE profiler_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
    GROUP BY 1
  ),
  -- youth_mobilized comes from the SAME profiling feed (total), kept separate
  -- so the JOIN below reads cleanly. (Reuse youth_profiled as mobilized.)
  -- ---- A3 ISLA: SHGs saving, savers, savings, loans ----
  isla AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COUNT(DISTINCT shg_id)::int AS shgs_saving,
           COALESCE(SUM(CASE WHEN youth_group_saving > 35 THEN 30 ELSE youth_group_saving END),0)::int AS isla_savers,
           COALESCE(SUM(savings_value),0)::numeric AS isla_savings,
           COALESCE(SUM(CASE WHEN loans > 35 THEN 30 ELSE loans END),0)::int AS isla_loans,
           COALESCE(SUM(youth_loans_value_given),0)::numeric AS isla_loans_value
    FROM isla_final_rows
    WHERE profilers_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- A9 TRAININGS: sourced from the Frontliners dashboard (at_rows), the
  -- attendance-grain training data — NOT from profiling.
  -- youth_trained = attendance count (has_date); groups_trained = distinct groups.
  -- PERF: at_rows has ~820k rows, so we FIRST collapse to one row per
  -- data_collector via the indexed district/day columns, THEN fuzzy-match names
  -- on that tiny set (matching raw rows caused 503 timeouts).
  at_dc AS (
    SELECT public.mel_norm_key(data_collector) AS k,
           COUNT(DISTINCT group_id) FILTER (WHERE group_id IS NOT NULL)::int AS groups_trained,
           SUM(CASE WHEN has_date = 1 THEN 1 ELSE 0 END)::int                AS youth_trained
    FROM at_rows
    WHERE data_collector IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR day >= p_date_from::text)
      AND (p_date_to   IS NULL OR day <= p_date_to::text)
    GROUP BY 1
  ),
  trained AS (
    SELECT c.nm,
           SUM(a.groups_trained)::int AS groups_trained,
           SUM(a.youth_trained)::int  AS youth_trained
    FROM at_dc a
    JOIN cfs c ON (
      a.k = public.mel_norm_key(c.nm)
      OR (length(public.mel_norm_key(c.nm)) >= 8 AND a.k LIKE public.mel_norm_key(c.nm) || '%')
      OR (length(a.k) >= 8 AND public.mel_norm_key(c.nm) LIKE a.k || '%')
    )
    GROUP BY c.nm
  ),
  -- NOTE: trainings are now sourced ONLY from at_rows (the `trained` CTE above),
  -- which is the single source of truth shared by the CF Report Card and the CF
  -- Premier League. A9's display AND the p3_trained GRADE both use it, so all
  -- three reports stay in lock-step and auto-update as Frontliner data arrives.
  -- ---- A6 PRODUCTION: youth in horticulture production + SHGs ----
  prod AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COUNT(DISTINCT shg_participant_id)::int AS prod_youth_hort,
           COUNT(DISTINCT shg_id)::int             AS prod_shgs
    FROM production_rows
    WHERE profilers_name IS NOT NULL AND lower(pdn_level)='production'
      AND shg_participant_id IS NOT NULL
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- A7 DISTRIBUTION OF BIRDS: from the /distribution dashboard
  -- (distribution_rows), filter Livestock + unit = 'Number' (the bird count).
  -- We report the NUMBER OF BIRDS distributed (SUM of qty where unit=Number),
  -- the recipients, and the SHGs reached — mirroring the dashboard's slicers.
  dist_matched AS (
    SELECT c.nm, d.participant_id, d.shg_name, d.qty_received
    FROM distribution_rows d
    JOIN cfs c ON (
      public.mel_norm_key(d.submitted_by) = public.mel_norm_key(c.nm)
      OR (length(public.mel_norm_key(c.nm)) >= 8
          AND public.mel_norm_key(d.submitted_by) LIKE public.mel_norm_key(c.nm) || '%')
      OR (length(public.mel_norm_key(d.submitted_by)) >= 8
          AND public.mel_norm_key(c.nm) LIKE public.mel_norm_key(d.submitted_by) || '%')
    )
    WHERE lower(coalesce(d.material_type,'')) = 'livestock'
      AND d.livestock_type ILIKE '%poultry%'
      AND lower(coalesce(d.unit,'')) = 'number'
      AND (v_dl IS NULL OR upper(d.district)=ANY(v_dl))
      AND (p_date_from IS NULL OR d.dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR d.dist_date <= p_date_to)
  ),
  dist_birds AS (
    SELECT nm,
           COUNT(DISTINCT participant_id) FILTER (WHERE participant_id IS NOT NULL)::int AS dist_participants,
           COUNT(DISTINCT shg_name)::int       AS dist_shgs,
           COALESCE(SUM(qty_received),0)::int   AS dist_birds
    FROM dist_matched
    GROUP BY nm
  ),
  -- youth into production = horticulture youth + bird recipients (distinct union)
  prod_youth AS (
    SELECT nm, COUNT(DISTINCT pid)::int AS youth_production
    FROM (
      SELECT public.mel_norm_name(profilers_name) AS nm, shg_participant_id AS pid
        FROM production_rows
       WHERE profilers_name IS NOT NULL AND lower(pdn_level)='production' AND shg_participant_id IS NOT NULL
         AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
         AND (p_date_from IS NULL OR activity_date >= p_date_from)
         AND (p_date_to   IS NULL OR activity_date <= p_date_to)
      UNION
      SELECT nm, participant_id FROM dist_matched
    ) u
    GROUP BY nm
  ),
  -- ---- A8 DISTRIBUTION TO SHG: from the /shg-distribution dashboard
  -- (shg_distribution_rows) — inputs handed to whole groups, a DIFFERENT feed
  -- from A7's participant-level distribution_rows. Grouped by shg_group_name.
  dist_shg AS (
    SELECT c.nm,
           COUNT(DISTINCT d.shg_group_name)::int AS distshg_shgs,
           COUNT(*)::int                         AS distshg_lines
    FROM shg_distribution_rows d
    JOIN cfs c ON (
      public.mel_norm_key(d.submitted_by) = public.mel_norm_key(c.nm)
      OR (length(public.mel_norm_key(c.nm)) >= 8
          AND public.mel_norm_key(d.submitted_by) LIKE public.mel_norm_key(c.nm) || '%')
      OR (length(public.mel_norm_key(d.submitted_by)) >= 8
          AND public.mel_norm_key(c.nm) LIKE public.mel_norm_key(d.submitted_by) || '%')
    )
    WHERE d.submitted_by IS NOT NULL
      AND (v_dl IS NULL OR upper(d.district)=ANY(v_dl))
      AND (p_date_from IS NULL OR d.dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR d.dist_date <= p_date_to)
    GROUP BY c.nm
  ),
  -- ---- A4 POULTRY SALES ----
  poultry AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COALESCE(SUM(poultry_sold),0)::numeric AS birds_sold,
           COUNT(DISTINCT shg_participant_id)::int AS ps_sellers,
           COALESCE(SUM(total_poultry_value),0)::numeric AS ps_value
    FROM poultry_sales_rows
    WHERE profilers_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- A2 HORTICULTURE SALES ----
  hsales AS (
    SELECT public.mel_norm_name(profilers_name) AS nm,
           COALESCE(SUM(total_planting_value),0)::numeric AS hs_value,
           COALESCE(SUM(net_planting),0)::numeric         AS hs_net,
           COUNT(DISTINCT shg_participant_id)::int        AS hs_sellers
    FROM sales_rows
    WHERE profilers_name IS NOT NULL
      AND lower(coalesce(value_chain,'')) IN ('horticulture','oil seeds','oilseeds')
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    GROUP BY 1
  ),
  -- ---- A5 LOCAL LEVERAGE ----
  lev AS (
    SELECT public.mel_norm_name(submitter_name) AS nm,
           COUNT(*)::int AS lev_count,
           COALESCE(SUM(contribution_amount),0)::numeric AS lev_amount
    FROM local_leverage_rows
    WHERE submitter_name IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR date_created >= p_date_from)
      AND (p_date_to   IS NULL OR date_created <= p_date_to)
    GROUP BY 1
  ),
  -- ---- YOUTH IN WORK: employed youth (for grade) ----
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
      c.nm, c.district,
      COALESCE(p.shgs_profiled,0)      AS shgs_profiled,
      COALESCE(p.youth_profiled,0)     AS youth_profiled,
      COALESCE(p.prof_female,0)        AS prof_female,
      COALESCE(p.prof_male,0)          AS prof_male,
      COALESCE(p.youth_profiled,0)     AS youth_mobilized,
      COALESCE(i.shgs_saving,0)        AS shgs_saving,
      COALESCE(i.isla_savers,0)        AS isla_savers,
      COALESCE(i.isla_savings,0)       AS isla_savings,
      COALESCE(i.isla_loans,0)         AS isla_loans,
      COALESCE(i.isla_loans_value,0)   AS isla_loans_value,
      COALESCE(t.groups_trained,0)     AS groups_trained,
      COALESCE(t.youth_trained,0)      AS youth_trained,
      COALESCE(pr.prod_youth_hort,0)   AS prod_youth_hort,
      COALESCE(pr.prod_shgs,0)         AS prod_shgs,
      COALESCE(py.youth_production,0)  AS youth_production,
      COALESCE(db.dist_participants,0) AS dist_participants,
      COALESCE(db.dist_shgs,0)         AS dist_shgs,
      COALESCE(db.dist_birds,0)        AS dist_birds,
      COALESCE(ds.distshg_shgs,0)      AS distshg_shgs,
      COALESCE(ds.distshg_lines,0)     AS distshg_lines,
      COALESCE(po.birds_sold,0)        AS birds_sold,
      COALESCE(po.ps_sellers,0)        AS ps_sellers,
      COALESCE(po.ps_value,0)          AS ps_value,
      COALESCE(hs.hs_value,0)          AS hs_value,
      COALESCE(hs.hs_net,0)            AS hs_net,
      COALESCE(hs.hs_sellers,0)        AS hs_sellers,
      COALESCE(lv.lev_count,0)         AS lev_count,
      COALESCE(lv.lev_amount,0)        AS lev_amount,
      COALESCE(yw.employed_youth,0)    AS employed_youth
    FROM cfs c
    LEFT JOIN prof p        ON p.nm  = c.nm
    LEFT JOIN isla i        ON i.nm  = c.nm
    LEFT JOIN trained t       ON t.nm  = c.nm
    LEFT JOIN prod pr       ON pr.nm = c.nm
    LEFT JOIN prod_youth py ON py.nm = c.nm
    LEFT JOIN dist_birds db ON db.nm = c.nm
    LEFT JOIN dist_shg ds   ON ds.nm = c.nm
    LEFT JOIN poultry po    ON po.nm = c.nm
    LEFT JOIN hsales hs     ON hs.nm = c.nm
    LEFT JOIN lev lv        ON lv.nm = c.nm
    LEFT JOIN yiw yw        ON yw.nm = c.nm
  ),
  scored AS (
    SELECT m.*,
      CASE WHEN shgs_profiled>0  THEN round(100.0*shgs_saving/shgs_profiled) ELSE 0 END AS m_saving_ratio,
      CASE WHEN youth_mobilized>0 THEN round(100.0*employed_youth/(0.70*youth_mobilized)) ELSE 0 END AS m_yiw_pct
    FROM metrics m
  ),
  pct AS (
    SELECT s.*,
      least(100, m_saving_ratio)                    AS p1_saving,
      least(100, round(100.0*youth_production/400))  AS p2_production,
      least(100, round(100.0*groups_trained/16)) AS p3_trained,
      least(100, m_yiw_pct)                          AS p4_yiw,
      CASE WHEN birds_sold > 0 THEN 100 ELSE 0 END   AS p5_poultry,
      CASE WHEN hs_value   > 0 THEN 100 ELSE 0 END   AS p6_hortsales,
      CASE WHEN lev_count  > 0 THEN 100 ELSE 0 END   AS p7_leverage
    FROM scored s
  ),
  ranked AS (
    SELECT p.*,
      round((p1_saving+p2_production+p3_trained+p4_yiw+p5_poultry+p6_hortsales+p7_leverage)/7.0)::int AS overall
    FROM pct p
  )
  SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'name',              initcap(nm),
        'district',          initcap(lower(coalesce(district,''))),
        'overall',           overall,
        -- A1 profiling
        'shgs_profiled',     shgs_profiled,
        'youth_profiled',    youth_profiled,
        'prof_female',       prof_female,
        'prof_male',         prof_male,
        -- A2 horticulture sales
        'hs_sellers',        hs_sellers,
        'hs_value',          hs_value,
        'hs_net',            hs_net,
        -- A3 ISLA
        'shgs_saving',       shgs_saving,
        'isla_savers',       isla_savers,
        'isla_savings',      isla_savings,
        'isla_loans',        isla_loans,
        'isla_loans_value',  isla_loans_value,
        -- A4 poultry sales
        'ps_sellers',        ps_sellers,
        'birds_sold',        birds_sold,
        'ps_value',          ps_value,
        -- A5 leverage
        'lev_count',         lev_count,
        'lev_amount',        lev_amount,
        -- A6 production
        'prod_youth_hort',   prod_youth_hort,
        'prod_shgs',         prod_shgs,
        'youth_production',  youth_production,
        -- A7 distribution of birds
        'dist_participants', dist_participants,
        'dist_shgs',         dist_shgs,
        'dist_birds',        dist_birds,
        -- A8 distribution to SHG
        'distshg_shgs',      distshg_shgs,
        'distshg_lines',     distshg_lines,
        -- A9 trainings
        'groups_trained',    groups_trained,
        'youth_trained',     youth_trained
      ) ORDER BY initcap(lower(coalesce(district,''))), initcap(nm)
    ), '[]'::jsonb)
    INTO v
  FROM ranked
  WHERE overall > 0
     OR shgs_profiled > 0 OR youth_production > 0 OR groups_trained > 0
     OR birds_sold > 0 OR hs_value > 0 OR lev_count > 0
     OR dist_participants > 0 OR distshg_shgs > 0 OR shgs_saving > 0;

  RETURN coalesce(v, '[]'::jsonb);
END;
$function$;
