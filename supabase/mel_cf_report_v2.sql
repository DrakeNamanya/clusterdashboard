-- mel_cf_report v2: fix Youth into Production / Distribution(birds).
--  * Distribution to Participants(birds) = distinct youth who received BIRDS
--    (material_type='Livestock' AND livestock_type ILIKE '%poultry%' AND
--     unit ILIKE 'number'). Feeds/KGs/Grams are NOT birds.
--  * Youth into Production = Youth into Production(horticulture, from production_rows)
--    PLUS Distribution to Participants(birds).
CREATE OR REPLACE FUNCTION public.mel_cf_report(p_staff text, p_districts text[] DEFAULT NULL::text[], p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v jsonb;
  v_dl   text[];
  v_keys text[];
  v_nokeys text[];
  v_label text;
BEGIN
  SELECT array_agg(DISTINCT public.mel_norm_name(x))
    INTO v_keys
    FROM unnest(string_to_array(coalesce(p_staff,''), '|')) x
   WHERE public.mel_norm_name(x) <> '';
  IF v_keys IS NULL OR array_length(v_keys,1) IS NULL THEN v_keys := ARRAY['']; END IF;
  SELECT array_agg(DISTINCT public.mel_norm_key(x)) INTO v_nokeys
    FROM unnest(v_keys) x WHERE public.mel_norm_key(x) <> '';
  IF v_nokeys IS NULL THEN v_nokeys := ARRAY['']; END IF;
  v_label := initcap(v_keys[1]);
  IF array_length(v_keys,1) > 1 THEN
    v_label := v_label || ' (+' || (array_length(v_keys,1)-1)::text || ' merged)';
  END IF;
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN v_dl := NULL;
  ELSE SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  WITH
  sexmap AS (
    SELECT DISTINCT participant_id, sex FROM at_rows WHERE participant_id IS NOT NULL
  ),
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
           COALESCE(SUM(pwd),0)::int AS pwd,
           COUNT(*) FILTER (WHERE COALESCE(total,0) < 25)::int  AS shgs_below_25,
           COUNT(*) FILTER (WHERE COALESCE(total,0) >= 25)::int AS shgs_25_plus
    FROM prof
  ),
  tr AS (
    SELECT shg_id, shg_name, participants_trained,
           NULLIF(btrim(trainings),'') AS trainings
    FROM prof
  ),
  tr_topics AS (
    SELECT DISTINCT btrim(lower(t)) AS topic
    FROM tr, LATERAL regexp_split_to_table(coalesce(tr.trainings,''), '\s*,\s*') AS t
    WHERE btrim(t) <> ''
  ),
  tr_t AS (
    SELECT
      COALESCE(SUM(participants_trained),0)::int AS youth_trained,
      (SELECT COUNT(*) FROM tr_topics)::int AS training_areas,
      COUNT(*) FILTER (
        WHERE trainings IS NOT NULL OR COALESCE(participants_trained,0) > 0
      )::int AS groups_trained
    FROM tr ),
  -- ---------- DISTRIBUTION (all lines, for the "items handed out" text) ----------
  dist AS (
    SELECT * FROM distribution_rows
    WHERE EXISTS (SELECT 1 FROM unnest(v_nokeys) k
                  WHERE public.mel_norm_key(submitted_by) = k
                     OR (length(k) >= 8 AND public.mel_norm_key(submitted_by) LIKE k || '%'))
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR dist_date >= p_date_from)
      AND (p_date_to   IS NULL OR dist_date <= p_date_to)
  ),
  -- ---------- BIRDS (poultry livestock, counted by Number only) ----------
  -- This is the corrected "Distribution to Participants(birds)": youth who
  -- actually received BIRDS (not feeds/KGs). Poultry livestock, unit = Number.
  birds AS (
    SELECT participant_id, shg_name FROM dist
    WHERE material_type = 'Livestock'
      AND livestock_type ILIKE '%poultry%'
      AND lower(coalesce(unit,'')) = 'number'
  ),
  dist_t AS (
    SELECT COUNT(*)::int AS dist_lines,
           (SELECT COUNT(DISTINCT participant_id)::int FROM birds WHERE participant_id IS NOT NULL) AS dist_participants,
           (SELECT COUNT(DISTINCT participant_id)::int FROM birds WHERE participant_id IS NOT NULL) AS dist_birds
    FROM dist ),
  dist_items AS (
    SELECT string_agg(mt || ' (' || c || ')', ', ' ORDER BY c DESC) AS items
    FROM (
      SELECT initcap(coalesce(nullif(btrim(material_type),''),'Unspecified')) AS mt,
             COUNT(*) AS c
      FROM dist GROUP BY 1
    ) q
  ),
  -- ---------- PRODUCTION ----------
  -- Youth into Production(horticulture) = youth in the horticulture production form.
  prod AS (
    SELECT * FROM production_rows
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys) AND lower(pdn_level)='production'
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  -- Horticulture-only youth (distinct).
  prod_hort AS (
    SELECT DISTINCT shg_participant_id AS pid FROM prod WHERE shg_participant_id IS NOT NULL
  ),
  -- Youth into Production = horticulture youth + bird recipients (distinct union).
  prod_youth_all AS (
    SELECT shg_participant_id AS pid,
           MAX(CASE WHEN lower(disability_status)='yes' THEN 1 ELSE 0 END) AS is_pwd
    FROM prod WHERE shg_participant_id IS NOT NULL GROUP BY shg_participant_id
    UNION
    SELECT participant_id AS pid, 0 AS is_pwd
    FROM birds WHERE participant_id IS NOT NULL
      AND participant_id NOT IN (SELECT shg_participant_id FROM prod WHERE shg_participant_id IS NOT NULL)
  ),
  prod_shg_all AS (
    SELECT shg_id::text AS sid FROM prod WHERE shg_id IS NOT NULL
    UNION
    SELECT shg_name     AS sid FROM birds WHERE shg_name IS NOT NULL
  ),
  prod_t AS (
    SELECT (SELECT COUNT(DISTINCT pid) FROM prod_youth_all)::int AS prod_youth,
           (SELECT COUNT(DISTINCT pid) FROM prod_hort)::int      AS prod_youth_hort,
           (SELECT dist_birds FROM dist_t)::int                  AS prod_youth_birds,
           (SELECT COUNT(*) FROM prod_shg_all)::int AS prod_shgs,
           (SELECT COUNT(DISTINCT p.pid) FROM prod_youth_all p
              LEFT JOIN sexmap sm ON sm.participant_id = p.pid
              WHERE lower(sm.sex)='female')::int AS female,
           (SELECT COUNT(DISTINCT pid) FROM prod_youth_all WHERE is_pwd=1)::int AS pwd
  ),
  hs AS (
    SELECT * FROM sales_rows
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys)
      AND lower(coalesce(value_chain,'')) IN ('horticulture','oil seeds','oilseeds')
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  hs_t AS (
    SELECT COUNT(DISTINCT s.shg_participant_id)::int AS hs_youth,
           COUNT(DISTINCT CASE WHEN lower(sm.sex)='female' THEN s.shg_participant_id END)::int AS female,
           COUNT(DISTINCT CASE WHEN lower(s.disability_status)='yes' THEN s.shg_participant_id END)::int AS pwd,
           COALESCE(SUM(s.total_planting_value),0)::numeric AS hs_value
    FROM hs s LEFT JOIN sexmap sm ON sm.participant_id = s.shg_participant_id ),
  ps AS (
    SELECT * FROM poultry_sales_rows
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys)
      AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  ps_t AS (
    SELECT COALESCE(SUM(p.poultry_sold),0)::numeric AS birds_sold,
           COUNT(DISTINCT p.shg_participant_id)::int AS ps_youth,
           COUNT(DISTINCT CASE WHEN lower(sm.sex)='female' THEN p.shg_participant_id END)::int AS female,
           COUNT(DISTINCT CASE WHEN lower(p.disability_status)='yes' THEN p.shg_participant_id END)::int AS pwd,
           COALESCE(SUM(p.total_poultry_value),0)::numeric AS ps_value
    FROM ps p LEFT JOIN sexmap sm ON sm.participant_id = p.shg_participant_id ),
  isla AS (
    SELECT * FROM isla_final_rows
    WHERE public.mel_norm_name(profilers_name) = ANY(v_keys)
      AND (v_dl IS NULL OR upper(district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  isla_t AS ( SELECT COUNT(DISTINCT shg_id)::int AS isla_shgs,
                     COALESCE(SUM(savings_value),0)::numeric AS savings,
                     COALESCE(SUM(youth_loans_value_given),0)::numeric AS loans_value,
                     COALESCE(SUM(CASE WHEN youth_group_saving > 35 THEN 30 ELSE youth_group_saving END),0)::int AS youth_savers,
                     COALESCE(SUM(CASE WHEN loans > 35 THEN 30 ELSE loans END),0)::int AS youth_loans FROM isla ),
  lev AS (
    SELECT * FROM local_leverage_rows
    WHERE public.mel_norm_name(submitter_name) = ANY(v_keys)
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR date_created >= p_date_from)
      AND (p_date_to   IS NULL OR date_created <= p_date_to)
  ),
  lev_t AS ( SELECT COUNT(*)::int AS lev_count,
                    COALESCE(SUM(contribution_amount),0)::numeric AS lev_amount FROM lev ),
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
    'distribution', (SELECT to_jsonb(dist_t) || jsonb_build_object('items', (SELECT items FROM dist_items)) FROM dist_t),
    'production', (SELECT to_jsonb(prod_t) FROM prod_t),
    'hort_sales', (SELECT to_jsonb(hs_t)   FROM hs_t),
    'poultry',    (SELECT to_jsonb(ps_t)   FROM ps_t),
    'isla',       (SELECT to_jsonb(isla_t) FROM isla_t),
    'leverage',   (SELECT to_jsonb(lev_t)  FROM lev_t),
    'targets', jsonb_build_object(
      'shgs_profiled',  16,
      'youth',          400,
      'female_pct',     70,
      'pwd_pct',        3,
      'shgs_saving',    16,
      'youth_production',400,
      'groups_trained', 16
    )
  ) INTO v;
  RETURN v;
END;
$function$;
