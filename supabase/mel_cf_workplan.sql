-- ===========================================================================
-- CF Workplan & Advance-Payment Request
--   * mel_cf_groups(p_staff, p_districts, p_from, p_to)
--       Returns per-GROUP status for a CF (named groups) so the workplan can
--       list the actual group names that need action:
--         - profiled?  member_count (total)  below_25?
--         - trained this program?  saving/ISLA this period?  in production?
--       Uses the SAME v_akeys resolution as mel_cf_report so merged/duplicate
--       accounts and short/reversed names all roll up to the one CF.
--   * cf_workplan table  — one saved submission per CF per month.
--   * mel_cf_workplan_save / mel_cf_workplan_list / mel_cf_workplan_get RPCs.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Per-group status for a CF (named groups). Everything the workplan needs to
-- name the specific groups that are behind on each target.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_cf_groups(
  p_staff text,
  p_districts text[] DEFAULT NULL::text[],
  p_date_from date DEFAULT NULL::date,
  p_date_to   date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS
$function$
DECLARE
  v jsonb;
  v_dl text[];
  v_keys text[];
  v_nokeys text[];
  v_akeys text[];
BEGIN
  -- resolve the selected CF -> canonical akeys (mirrors mel_cf_report)
  SELECT array_agg(DISTINCT public.mel_norm_name(x)) INTO v_keys
    FROM unnest(string_to_array(coalesce(p_staff,''), '|')) x
   WHERE public.mel_norm_name(x) <> '';
  IF v_keys IS NULL OR array_length(v_keys,1) IS NULL THEN v_keys := ARRAY['']; END IF;
  SELECT array_agg(DISTINCT public.mel_norm_key(x)) INTO v_nokeys
    FROM unnest(v_keys) x WHERE public.mel_norm_key(x) <> '';
  IF v_nokeys IS NULL THEN v_nokeys := ARRAY['']; END IF;
  IF p_districts IS NULL OR array_length(p_districts,1) IS NULL THEN v_dl := NULL;
  ELSE SELECT array_agg(upper(x)) INTO v_dl FROM unnest(p_districts) x; END IF;

  SELECT array_agg(DISTINCT ak) INTO v_akeys
    FROM public.mel_cf_universe u, unnest(u.akeys) ak
   WHERE EXISTS (SELECT 1 FROM unnest(v_nokeys) nk
                 WHERE nk = ANY(u.akeys) OR public.mel_norm_key(u.nm) = nk)
     AND coalesce(ak,'') <> '';
  v_akeys := (SELECT array_agg(DISTINCT k)
                FROM unnest(coalesce(v_akeys, ARRAY[]::text[]) || v_nokeys) k
               WHERE coalesce(k,'') <> '');
  IF v_akeys IS NULL OR array_length(v_akeys,1) IS NULL THEN v_akeys := v_nokeys; END IF;

  WITH
  -- Groups this CF has PROFILED (the master list of "their" groups). One row per
  -- shg, keeping the latest member total seen.
  prof AS (
    SELECT shg_id::text AS sid,
           NULLIF(btrim(coalesce(shg_name, profile_shg_name)),'') AS gname,
           COALESCE(total,0)::int AS members,
           upper(coalesce(district,'')) AS district,
           NULLIF(btrim(subcounty),'') AS subcounty
    FROM public.shg_profiling_rows
    WHERE public.mel_norm_key(profiler_name) = ANY(v_akeys)
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
      AND (p_date_from IS NULL OR created_date >= p_date_from)
      AND (p_date_to   IS NULL OR created_date <= p_date_to)
  ),
  prof1 AS (   -- collapse to one row per group (latest / max members)
    SELECT sid,
           max(gname)  AS gname,
           max(members) AS members,
           max(district) AS district,
           max(subcounty) AS subcounty
    FROM prof
    WHERE gname IS NOT NULL
    GROUP BY sid
  ),
  -- Groups this CF has TRAINED (any time — training is a program-life target,
  -- not a monthly one). Keyed by group_id + group_name from the attendance master.
  -- PERF: at_rows has ~820k rows, so we FIRST collapse to one row per
  -- (collector-key, group) using an indexed district filter, THEN match the
  -- collapsed set against the CF's akeys. Matching per-raw-row caused >20s
  -- timeouts on the edge/Hyperdrive statement ceiling.
  -- PERF: at_g / trained / saving / produced are MATERIALIZED so the 820k-row
  -- at_rows scan runs ONCE. Without MATERIALIZED, Postgres 12+ inlines the CTE
  -- and re-scans at_rows inside each correlated EXISTS (one scan per prof1 row)
  -- => 503 timeout on the ~20s edge/Hyperdrive ceiling. We also precompute the
  -- name-key (gk) inside each set so mel_norm_key runs once per row, not per
  -- EXISTS comparison.
  at_g AS MATERIALIZED (
    SELECT public.mel_norm_key(data_collector) AS k,
           group_id::text AS gid,
           NULLIF(btrim(group_name),'') AS gname
    FROM public.at_rows
    WHERE data_collector IS NOT NULL
      AND (v_dl IS NULL OR upper(district)=ANY(v_dl))
    GROUP BY 1,2,3
  ),
  trained AS MATERIALIZED (
    SELECT DISTINCT gid, public.mel_norm_key(gname) AS gk
    FROM at_g
    WHERE k = ANY(v_akeys)
  ),
  -- Groups SAVING (ISLA) within the selected period.
  saving AS MATERIALIZED (
    SELECT DISTINCT shg_id::text AS sid,
                    public.mel_norm_key(shg_name) AS gk
    FROM public.isla_final_rows
    WHERE public.mel_norm_key(profilers_name) = ANY(v_akeys)
      AND (v_dl IS NULL OR upper(district_shg)=ANY(v_dl))
      AND (p_date_from IS NULL OR activity_date >= p_date_from)
      AND (p_date_to   IS NULL OR activity_date <= p_date_to)
  ),
  -- Groups with youth IN PRODUCTION, WITH the value chains they received
  -- (Horticulture / Poultry / Oil seeds / Beef-livestock/goats). We normalise
  -- value_chain to a canonical tag so the workplan can name which chain(s) a
  -- group is still MISSING.
  produced AS MATERIALIZED (
    SELECT shg_id::text AS sid,
           public.mel_norm_key(shg_name) AS gk,
           array_agg(DISTINCT vc) FILTER (WHERE vc <> '') AS vchains
    FROM (
      SELECT shg_id, shg_name,
             CASE
               WHEN lower(coalesce(value_chain,'')) LIKE 'hort%' THEN 'horticulture'
               WHEN lower(coalesce(value_chain,'')) LIKE 'poult%' THEN 'poultry'
               WHEN lower(coalesce(value_chain,'')) LIKE 'oil%' THEN 'oil seeds'
               WHEN lower(coalesce(value_chain,'')) LIKE 'beef%'
                 OR lower(coalesce(value_chain,'')) LIKE '%goat%'
                 OR lower(coalesce(value_chain,'')) LIKE '%livestock%' THEN 'livestock'
               ELSE lower(btrim(coalesce(value_chain,'')))
             END AS vc
      FROM public.production_rows
      WHERE public.mel_norm_key(profilers_name) = ANY(v_akeys)
        AND lower(coalesce(pdn_level,''))='production'
        AND (v_dl IS NULL OR upper(district_name)=ANY(v_dl))
        AND (p_date_from IS NULL OR activity_date >= p_date_from)
        AND (p_date_to   IS NULL OR activity_date <= p_date_to)
    ) s
    GROUP BY shg_id::text, public.mel_norm_key(shg_name)
  ),
  merged AS (
    SELECT p.sid, p.gname, p.members, p.district, p.subcounty,
           public.mel_norm_key(p.gname) AS gk,
           (p.members < 25) AS below_25
    FROM prof1 p
  ),
  flagged AS (
    SELECT m.sid, m.gname, m.members, m.district, m.subcounty, m.below_25,
           EXISTS (SELECT 1 FROM trained t WHERE t.gid = m.sid OR t.gk = m.gk) AS trained,
           EXISTS (SELECT 1 FROM saving  s WHERE s.sid = m.sid OR s.gk = m.gk) AS saving,
           COALESCE((SELECT array_agg(DISTINCT c) FROM (
                       SELECT unnest(pr.vchains) AS c FROM produced pr
                        WHERE pr.sid = m.sid OR pr.gk = m.gk) z
                     WHERE c IS NOT NULL), ARRAY[]::text[]) AS vchains
    FROM merged m
  ),
  flagged2 AS (
    SELECT f.*,
           (array_length(f.vchains,1) IS NOT NULL) AS in_production
    FROM flagged f
  )
  SELECT jsonb_build_object(
    'groups', COALESCE(jsonb_agg(jsonb_build_object(
                 'shg_id', sid, 'name', gname, 'members', members,
                 'district', district, 'subcounty', subcounty,
                 'below_25', below_25, 'trained', trained,
                 'saving', saving, 'in_production', in_production,
                 'vchains', to_jsonb(vchains)
               ) ORDER BY gname), '[]'::jsonb),
    'summary', jsonb_build_object(
                 'groups_profiled', COUNT(*),
                 'groups_below_25', COUNT(*) FILTER (WHERE below_25),
                 'groups_trained',  COUNT(*) FILTER (WHERE trained),
                 'groups_untrained',COUNT(*) FILTER (WHERE NOT trained),
                 'groups_saving',   COUNT(*) FILTER (WHERE saving),
                 'groups_not_saving',COUNT(*) FILTER (WHERE NOT saving),
                 'groups_in_production', COUNT(*) FILTER (WHERE in_production),
                 'groups_not_in_production', COUNT(*) FILTER (WHERE NOT in_production),
                 'groups_no_horticulture', COUNT(*) FILTER (WHERE NOT ('horticulture' = ANY(vchains))),
                 'groups_no_poultry',      COUNT(*) FILTER (WHERE NOT ('poultry' = ANY(vchains))),
                 'groups_no_oilseeds',     COUNT(*) FILTER (WHERE NOT ('oil seeds' = ANY(vchains))),
                 'groups_no_livestock',    COUNT(*) FILTER (WHERE NOT ('livestock' = ANY(vchains)))
               )
  ) INTO v FROM flagged2;

  RETURN COALESCE(v, jsonb_build_object('groups','[]'::jsonb,'summary','{}'::jsonb));
END;
$function$;

-- ---------------------------------------------------------------------------
-- Storage: one saved workplan+request per CF per month.
-- payload holds the full editable document (letter fields + activity rows) as
-- JSON so the exact submitted document can be re-opened / reprinted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cf_workplan (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id    text,                       -- canonical CF person (nullable)
  cf_name      text NOT NULL,
  plan_month   text NOT NULL,              -- 'YYYY-MM' the plan is FOR
  district     text,
  subcounty    text,
  amount       numeric,                    -- advance requested (UGX)
  mm_number    text,                       -- mobile money number
  payload      jsonb NOT NULL,             -- full document (letter + rows)
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (cf_name, plan_month)
);
CREATE INDEX IF NOT EXISTS idx_cf_workplan_month ON public.cf_workplan(plan_month);
CREATE INDEX IF NOT EXISTS idx_cf_workplan_person ON public.cf_workplan(person_id);

-- Save (upsert by cf_name + plan_month).
CREATE OR REPLACE FUNCTION public.mel_cf_workplan_save(p jsonb)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE v_id bigint; v_cf text; v_month text;
BEGIN
  v_cf    := btrim(coalesce(p->>'cf_name',''));
  v_month := btrim(coalesce(p->>'plan_month',''));
  IF v_cf = '' OR v_month = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cf_name and plan_month are required');
  END IF;
  INSERT INTO public.cf_workplan
    (person_id, cf_name, plan_month, district, subcounty, amount, mm_number, payload, created_by)
  VALUES
    (NULLIF(p->>'person_id',''), v_cf, v_month, NULLIF(p->>'district',''),
     NULLIF(p->>'subcounty',''), NULLIF(p->>'amount','')::numeric,
     NULLIF(p->>'mm_number',''), coalesce(p->'payload','{}'::jsonb),
     NULLIF(p->>'created_by',''))
  ON CONFLICT (cf_name, plan_month) DO UPDATE SET
     person_id = EXCLUDED.person_id,
     district  = EXCLUDED.district,
     subcounty = EXCLUDED.subcounty,
     amount    = EXCLUDED.amount,
     mm_number = EXCLUDED.mm_number,
     payload   = EXCLUDED.payload,
     updated_at= now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$fn$;

-- List saved submissions (most recent first), optional month / search filter.
CREATE OR REPLACE FUNCTION public.mel_cf_workplan_list(
  p_month text DEFAULT NULL, p_search text DEFAULT NULL, p_limit int DEFAULT 500)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS
$fn$
DECLARE v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'cf_name', cf_name, 'plan_month', plan_month,
           'district', district, 'subcounty', subcounty, 'amount', amount,
           'updated_at', updated_at
         ) ORDER BY plan_month DESC, cf_name), '[]'::jsonb)
  INTO v
  FROM public.cf_workplan
  WHERE (p_month IS NULL OR p_month='' OR plan_month = p_month)
    AND (p_search IS NULL OR p_search='' OR cf_name ILIKE '%'||p_search||'%')
  LIMIT greatest(1, p_limit);
  RETURN v;
END;
$fn$;

-- Fetch one saved submission (full payload) by id, or by cf_name+month.
CREATE OR REPLACE FUNCTION public.mel_cf_workplan_get(
  p_id bigint DEFAULT NULL, p_cf text DEFAULT NULL, p_month text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS
$fn$
DECLARE v jsonb;
BEGIN
  SELECT to_jsonb(w) INTO v FROM public.cf_workplan w
   WHERE (p_id IS NOT NULL AND w.id = p_id)
      OR (p_id IS NULL AND w.cf_name = p_cf AND w.plan_month = p_month)
   LIMIT 1;
  RETURN COALESCE(v, 'null'::jsonb);
END;
$fn$;
