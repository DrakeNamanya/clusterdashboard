-- ============================================================================
-- CF MANUAL MERGE  (Praise vs Praise Joan / Lunkusejoanitah vs Joannelunkuse …)
--
-- Problem: the same real Community Facilitator sometimes appears under several
-- spellings that the automatic identity resolver cannot safely collapse
-- ("Praise" vs "Praise Joan", "Lunkusejoanitah" vs "Joannelunkuse"). On the CF
-- Report / Premier League / Payment Report each spelling is its own row, so the
-- person's numbers are split across two (or more) cards.
--
-- Solution: a user-driven MANUAL merge. The user multi-selects the spellings
-- that are the same person and picks a canonical display name; every selected
-- spelling's activity is then attributed to ONE canonical key, so all the
-- numbers add up under a single name across EVERY report.
--
-- How it plugs in: mel_refresh_activity_person() canonicalises each activity
-- name_key through mel_merge_canon() BEFORE resolving/aggregating, so the merge
-- is applied uniformly to training / profiling / production / sales / isla /
-- leverage. mel_refresh_cf_universe() then naturally produces ONE row for the
-- merged group (its nm = the chosen canonical display name). The merge is
-- durable: it survives every sync + refresh because it lives in a table, not in
-- the data.
--
-- To UNDO a merge: delete the rows from mel_cf_merge (or use mel_cf_unmerge),
-- then re-run mel_refresh_cf_all().
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mel_cf_merge (
  alias_key   text PRIMARY KEY,   -- mel_norm_key of a spelling to fold away
  canon_key   text NOT NULL,      -- mel_norm_key of the canonical spelling
  canon_name  text NOT NULL,      -- friendly display name to show for the group
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mel_cf_merge_canon_idx ON public.mel_cf_merge(canon_key);

-- Canonicalise a single activity name-key: if the key was merged away, return
-- its canonical key; otherwise return the key unchanged. IMMUTABLE-ish (reads a
-- tiny table) so it is cheap to call per activity row.
CREATE OR REPLACE FUNCTION public.mel_merge_canon(p_key text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT m.canon_key FROM public.mel_cf_merge m WHERE m.alias_key = p_key LIMIT 1),
    p_key
  );
$$;

-- Friendly display name for a (canonical) key, if the key participates in a
-- merge as the canonical spelling. Returns NULL when the key is not a merge
-- canonical, so callers can fall back to their normal display logic.
CREATE OR REPLACE FUNCTION public.mel_merge_name(p_key text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT m.canon_name FROM public.mel_cf_merge m
   WHERE m.canon_key = p_key LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Apply a merge. Given the canonical display name + the full list of spellings
-- (display names) that are the same person, fold every OTHER spelling into the
-- canonical one. Keys are computed with mel_norm_key so the caller can pass raw
-- display names straight from the report. Idempotent (re-applying is safe).
--   p_canon_name : the display name to KEEP (e.g. 'Praise Joan')
--   p_names      : ALL spellings in the group, including the canonical one
-- Returns the number of alias rows written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_cf_merge_apply(p_canon_name text, p_names text[])
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE
  v_canon_key text := public.mel_norm_key(p_canon_name);
  v_n integer := 0;
BEGIN
  IF coalesce(v_canon_key,'') = '' THEN
    RAISE EXCEPTION 'canonical name resolves to empty key: %', p_canon_name;
  END IF;

  -- Fold every provided spelling (except the canonical key itself) into canon.
  -- Also rewrite any EXISTING merge whose canon was one of these spellings, so
  -- chained/again merges stay consistent.
  INSERT INTO public.mel_cf_merge(alias_key, canon_key, canon_name)
  SELECT DISTINCT k, v_canon_key, p_canon_name
  FROM (
    SELECT public.mel_norm_key(n) AS k FROM unnest(p_names) AS n
  ) s
  WHERE coalesce(k,'') <> '' AND k <> v_canon_key
  ON CONFLICT (alias_key) DO UPDATE
    SET canon_key = excluded.canon_key,
        canon_name = excluded.canon_name,
        created_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Re-point any merge that previously pointed at one of the now-folded keys so
  -- it points at the new canonical (keeps transitive merges collapsed).
  UPDATE public.mel_cf_merge m
     SET canon_key = v_canon_key, canon_name = p_canon_name
   WHERE m.canon_key IN (
           SELECT public.mel_norm_key(n) FROM unnest(p_names) AS n
         )
     AND m.canon_key <> v_canon_key;

  -- Never let the canonical key point at itself as an alias.
  DELETE FROM public.mel_cf_merge WHERE alias_key = canon_key;

  RETURN v_n;
END;
$fn$;

-- Undo: remove any merge that involves this display name (as alias OR canon).
CREATE OR REPLACE FUNCTION public.mel_cf_unmerge(p_name text)
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE v_key text := public.mel_norm_key(p_name); v_n integer := 0;
BEGIN
  DELETE FROM public.mel_cf_merge WHERE alias_key = v_key OR canon_key = v_key;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- List all current merges (for an admin view), grouped by canonical name.
CREATE OR REPLACE FUNCTION public.mel_cf_merge_list()
RETURNS TABLE(canon_name text, canon_key text, alias_keys text[]) LANGUAGE sql STABLE AS $$
  SELECT canon_name, canon_key, array_agg(alias_key ORDER BY alias_key)
  FROM public.mel_cf_merge
  GROUP BY canon_name, canon_key
  ORDER BY canon_name;
$$;
