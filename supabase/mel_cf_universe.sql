-- ============================================================================
-- CF UNIVERSE CACHE
--   mel_cf_universe          : materialised list of every Community Facilitator
--   mel_refresh_cf_universe(): rebuilds it from the 6 source tables
--
-- Why: discovering the CF universe (mel_norm_name over ~60k source rows + regex
-- filters) costs ~20s, which trips the Cloudflare edge / Hyperdrive ~20s
-- statement ceiling and returns 503 on the CF Report / Premier League / Payment
-- Report APIs. We pre-compute the universe ONCE into this table and have the
-- RPCs read it (a ~800-row lookup, sub-second), so those reports load fast.
--
-- Refresh: call SELECT public.mel_refresh_cf_universe(); whenever new profiling /
-- production / sales / isla / leverage data is fetched (it's cheap and safe to
-- re-run). Columns:
--   nm       normalised full name (spaces kept)           = public.mel_norm_name(...)
--   ck       normalised no-space key                      = public.mel_norm_key(nm)
--   sortkey  word-order-independent token key (for YiW job_tracking match)
--   districts array of UPPER districts the CF appears in
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mel_cf_universe (
  nm        text,
  ck        text,
  sortkey   text,
  districts text[]
);
CREATE INDEX IF NOT EXISTS mel_cf_universe_nm_idx ON public.mel_cf_universe(nm);

CREATE OR REPLACE FUNCTION public.mel_refresh_cf_universe()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE n integer;
BEGIN
  -- Task E: the universe is now REGISTRY-DRIVEN. It is the union of
  --   (1) every canonical person (mel_person) -> so field-staff like Abubakar
  --       appear even when their form name is a single word, and their district
  --       comes from mel_person_district (data-derived, so Titus shows in Jinja);
  --   (2) any UNRESOLVED activity name-key not covered by a person -> so nobody's
  --       work silently disappears while the registry is being cleaned.
  -- nm for persons is the official "first last" (normalised); its mel_norm_key
  -- equals the username key, which the reports' bidirectional-prefix joins use.
  --
  -- Prereq: mel_refresh_person_registry() and mel_refresh_activity_person()
  -- must have run first (the wrapper mel_refresh_cf_all() does all three).
  CREATE TEMP TABLE _u ON COMMIT DROP AS
  WITH person_rows AS (
    SELECT public.mel_norm_name(p.display_name) AS nm,
           upper(pd.district) AS d
    FROM public.mel_person p
    JOIN public.mel_person_district pd ON pd.person_id = p.person_id
    WHERE coalesce(p.display_name,'') <> ''
  ),
  -- unresolved activity names (person_id IS NULL) that still carry a real name
  orphan_rows AS (
    SELECT ap.name_key AS nm, ap.district AS d
    FROM public.mel_activity_person ap
    WHERE ap.person_id IS NULL
      AND ap.district <> ''
      AND ap.name_key ~ '[a-z]'
      AND ap.name_key !~ '(group|association|farmers|provision|selfhelp|shg|village|cluster|community)'
  ),
  allnames AS (
    SELECT nm, d FROM person_rows
    UNION ALL
    SELECT nm, d FROM orphan_rows
  )
  SELECT nm,
         public.mel_norm_key(nm) AS ck,
         (SELECT string_agg(w, ' ' ORDER BY w)
            FROM unnest(regexp_split_to_array(nm,' ')) w WHERE w <> '') AS sortkey,
         array_agg(DISTINCT d) AS districts
  FROM allnames
  WHERE coalesce(nm,'') <> ''
  GROUP BY nm;

  TRUNCATE public.mel_cf_universe;
  INSERT INTO public.mel_cf_universe SELECT * FROM _u;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- ONE-SHOT wrapper: rebuild the whole identity->activity->universe chain in the
-- correct order. Called by the API / cron so a single call keeps everything in
-- sync after new data (or a field_staff re-upload).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_refresh_cf_all()
 RETURNS integer LANGUAGE plpgsql AS
$fn$
DECLARE v_universe integer;
BEGIN
  PERFORM public.mel_refresh_person_registry();
  PERFORM public.mel_refresh_activity_person();
  v_universe := public.mel_refresh_cf_universe();
  RETURN v_universe;
END;
$fn$;
