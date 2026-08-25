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
  districts text[],
  person_id text,      -- canonical person (NULL for unresolved orphan names)
  akeys     text[]     -- ALL activity keys that resolve to this person (exact-match set)
);
CREATE INDEX IF NOT EXISTS mel_cf_universe_nm_idx  ON public.mel_cf_universe(nm);
CREATE INDEX IF NOT EXISTS mel_cf_universe_pid_idx ON public.mel_cf_universe(person_id);
-- Add columns if the table pre-existed without them (idempotent).
ALTER TABLE public.mel_cf_universe ADD COLUMN IF NOT EXISTS person_id text;
ALTER TABLE public.mel_cf_universe ADD COLUMN IF NOT EXISTS akeys text[];

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
  -- Person rows: one per canonical human. akeys = every alias key + every
  -- activity name_key that resolved to them (so reports can exact-match ANY of
  -- them, handling reversed names / short names / merged accounts uniformly).
  CREATE TEMP TABLE _person_u ON COMMIT DROP AS
  SELECT p.person_id,
         public.mel_norm_name(p.display_name) AS nm,
         (SELECT array_agg(DISTINCT pd.district)
            FROM public.mel_person_district pd WHERE pd.person_id = p.person_id) AS districts,
         (SELECT array_agg(DISTINCT k) FROM (
             SELECT alias_key AS k FROM public.mel_person_alias a
               WHERE a.person_id = p.person_id AND a.kind <> 'refid'
             UNION
             SELECT ap.name_key FROM public.mel_activity_person ap
               WHERE ap.person_id = p.person_id
          ) allk WHERE coalesce(k,'') <> '') AS akeys
  FROM public.mel_person p
  WHERE coalesce(p.display_name,'') <> ''
    -- Task D: drop test accounts that were registered as field staff (they came
    -- through the official staff upload, so they reach the person registry, not
    -- the orphan set). Same junk patterns as the orphan filter below.
    AND public.mel_norm_name(p.display_name) NOT IN (
      'data','test','testprofile','testcfc','tdifs','commitmentfee','na','nan',
      'mug','drakenamanya'
    )
    AND public.mel_norm_name(p.display_name) !~ 'entrant';

  -- Orphan rows: unresolved activity names (kept visible so no work disappears).
  -- Task D: also drop obvious MIS test/junk entries so they never appear as a
  -- selectable CF. Two guards:
  --   (1) an explicit blocklist of known test/system tokens;
  --   (2) the '<name>entrant' concatenated test artifacts (e.g. "arnoldentrant",
  --       "euniceentrant") which the token cleaner can't split safely.
  -- Real facilitators are unaffected (their names never match these patterns).
  CREATE TEMP TABLE _orphan_u ON COMMIT DROP AS
  SELECT NULL::text AS person_id,
         ap.name_key AS nm,
         array_agg(DISTINCT ap.district) AS districts,
         ARRAY[ap.name_key] AS akeys
  FROM public.mel_activity_person ap
  WHERE ap.person_id IS NULL
    AND ap.district <> ''
    AND ap.name_key ~ '[a-z]'
    AND ap.name_key !~ '(group|association|farmers|provision|selfhelp|shg|village|cluster|community)'
    AND ap.name_key NOT IN (
      'data','test','testprofile','testcfc','tdifs','commitmentfee','na','nan',
      'mug','drakenamanya'
    )
    AND ap.name_key !~ 'entrant'   -- '<name>entrant' test artifacts
  GROUP BY ap.name_key;

  -- Combine person + orphan rows into a flat (nm, person_id, district, akey) set
  -- so we can dedupe by nm (the table PK) with plain array_agg(DISTINCT ...).
  -- Two distinct persons can share a normalised display name; we merge their
  -- districts/akeys and keep the min person_id => one row per name.
  CREATE TEMP TABLE _flat ON COMMIT DROP AS
  SELECT r.nm, r.person_id, d.district, k.akey
  FROM (
    SELECT person_id, nm, districts, akeys FROM _person_u
    UNION ALL
    SELECT person_id, nm, districts, akeys FROM _orphan_u
  ) r
  LEFT JOIN LATERAL unnest(r.districts) AS d(district) ON true
  LEFT JOIN LATERAL unnest(r.akeys)     AS k(akey)     ON true
  WHERE coalesce(r.nm,'') <> '';

  CREATE TEMP TABLE _u ON COMMIT DROP AS
  SELECT nm,
         public.mel_norm_key(nm) AS ck,
         (SELECT string_agg(w, ' ' ORDER BY w)
            FROM unnest(regexp_split_to_array(nm,' ')) w WHERE w <> '') AS sortkey,
         COALESCE(array_agg(DISTINCT district) FILTER (WHERE coalesce(district,'')<>''),
                  ARRAY[]::text[]) AS districts,
         min(person_id) AS person_id,
         COALESCE(array_agg(DISTINCT akey) FILTER (WHERE coalesce(akey,'')<>''),
                  ARRAY[]::text[]) AS akeys
  FROM _flat
  GROUP BY nm;

  TRUNCATE public.mel_cf_universe;
  INSERT INTO public.mel_cf_universe(nm, ck, sortkey, districts, person_id, akeys)
  SELECT nm, ck, sortkey, districts, person_id, akeys FROM _u;
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
