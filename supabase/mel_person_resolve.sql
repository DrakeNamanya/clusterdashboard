-- ============================================================================
-- PERSON RESOLUTION  (Task E, layer-2 join helpers)
--
-- Two resolvers, tiered by key strength (collision analysis on live data):
--   * username / fullname keys  -> SAFE globally (only genuine dup accounts share)
--   * firstname / lastname keys -> AMBIGUOUS (~115 keys shared across people),
--                                  so only usable when SCOPED to a district.
--
--   mel_activity_person : materialised map of every activity name-key we see in
--     the data  ->  the canonical person_id  ->  the DATA-derived district set.
--     Built by mel_refresh_activity_person(). This is what the reports read.
--
-- Columns:
--   src        'training' | 'profiling' | 'production' | 'poultry' | 'sales'
--              | 'isla' | 'leverage'
--   name_key   normalised activity key (mel_norm_key of the submitted name)
--   person_id  resolved canonical person (NULL if unresolved -> still shown as
--              a "raw" CF so nobody's work disappears)
--   district   UPPER district from the activity row
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mel_activity_person (
  src        text,
  name_key   text,
  person_id  text,
  district   text
);
CREATE INDEX IF NOT EXISTS mel_activity_person_pid_idx  ON public.mel_activity_person(person_id);
CREATE INDEX IF NOT EXISTS mel_activity_person_key_idx  ON public.mel_activity_person(name_key);

-- Data-derived districts per person: the UPPER districts where a person's
-- STRONG-key (username/fullname) activity appears, PLUS the registry district.
-- Used to disambiguate weak (firstname/lastname) name matches, because the
-- registry district can be stale (e.g. Titus: registry=Mayuge, data=Jinja).
CREATE TABLE IF NOT EXISTS public.mel_person_district (
  person_id text,
  district  text,
  PRIMARY KEY (person_id, district)
);
CREATE INDEX IF NOT EXISTS mel_person_district_pid_idx ON public.mel_person_district(person_id);

-- Resolve one activity (name_key, district) to a person_id.
--   1. strong keys (username|fullname): exact, then >=8-char prefix either way
--   2. weak keys (firstname|lastname): exact match BUT only if the candidate
--      person also has activity/registry in the SAME district (disambiguation)
--   3. manual aliases always win (kind='manual')
-- Returns NULL when nothing safe resolves.
CREATE OR REPLACE FUNCTION public.mel_resolve_person(p_key text, p_district text)
 RETURNS text LANGUAGE plpgsql STABLE AS
$fn$
DECLARE v_pid text; v_d text := upper(coalesce(p_district,''));
BEGIN
  IF coalesce(p_key,'') = '' THEN RETURN NULL; END IF;

  -- (0) manual override alias wins outright
  SELECT person_id INTO v_pid FROM public.mel_person_alias
   WHERE alias_key = p_key AND kind = 'manual' LIMIT 1;
  IF v_pid IS NOT NULL THEN RETURN v_pid; END IF;

  -- (1) strong exact (username/fullname) — unique in practice
  SELECT person_id INTO v_pid FROM (
    SELECT person_id FROM public.mel_person_alias
     WHERE alias_key = p_key AND kind IN ('username','fullname')
     GROUP BY person_id
  ) s LIMIT 1;
  IF v_pid IS NOT NULL THEN RETURN v_pid; END IF;

  -- (1b) strong prefix either direction (>=8 chars) for username/fullname
  SELECT person_id INTO v_pid FROM (
    SELECT a.person_id FROM public.mel_person_alias a
     WHERE a.kind IN ('username','fullname')
       AND ( (length(a.alias_key) >= 8 AND p_key LIKE a.alias_key || '%')
          OR (length(p_key) >= 8 AND a.alias_key LIKE p_key || '%') )
     GROUP BY a.person_id
  ) s LIMIT 1;
  IF v_pid IS NOT NULL THEN
     -- only accept a prefix hit if it's unambiguous
     IF (SELECT count(*) FROM (
           SELECT DISTINCT a.person_id FROM public.mel_person_alias a
            WHERE a.kind IN ('username','fullname')
              AND ( (length(a.alias_key) >= 8 AND p_key LIKE a.alias_key || '%')
                 OR (length(p_key) >= 8 AND a.alias_key LIKE p_key || '%') )
         ) t) = 1
     THEN RETURN v_pid; END IF;
  END IF;

  -- (2) weak keys (firstname/lastname) scoped by DATA-DERIVED district.
  --     A candidate person qualifies only if they have activity/registry in
  --     this district (mel_person_district). If exactly ONE person qualifies,
  --     accept it. This resolves short profiler names like "Titus" -> the CF
  --     whose real (data) district is Jinja, even when the registry says else.
  IF v_d <> '' THEN
    SELECT person_id INTO v_pid FROM (
      SELECT DISTINCT p.person_id FROM public.mel_person_alias a
        JOIN public.mel_person p ON p.person_id = a.person_id
       WHERE a.alias_key = p_key AND a.kind IN ('firstname','lastname')
         AND EXISTS (SELECT 1 FROM public.mel_person_district pd
                      WHERE pd.person_id = p.person_id AND pd.district = v_d)
    ) cand LIMIT 1;
    IF v_pid IS NOT NULL AND
       (SELECT count(*) FROM (
          SELECT DISTINCT p2.person_id FROM public.mel_person_alias a2
            JOIN public.mel_person p2 ON p2.person_id = a2.person_id
           WHERE a2.alias_key = p_key AND a2.kind IN ('firstname','lastname')
             AND EXISTS (SELECT 1 FROM public.mel_person_district pd2
                          WHERE pd2.person_id = p2.person_id AND pd2.district = v_d)
        ) t) = 1
    THEN RETURN v_pid; END IF;
  END IF;

  RETURN NULL;
END;
$fn$;

-- Rebuild mel_activity_person from all activity tables. TWO-PASS:
--   pass 1: collect all (name_key, district) activity combos
--   pass 2a: build mel_person_district from STRONG-key hits + registry district
--   pass 2b: resolve every combo (now weak keys can use data-derived districts)
CREATE OR REPLACE FUNCTION public.mel_refresh_activity_person()
 RETURNS integer LANGUAGE plpgsql AS
$fn$
DECLARE n integer;
BEGIN
  -- Each raw activity name_key is canonicalised through public.mel_merge_canon()
  -- so any USER-MERGED spellings ("Praise" -> "Praise Joan",
  -- "Joannelunkuse" -> "Lunkusejoanitah") collapse to ONE key here, BEFORE
  -- resolution + universe build. That makes the merge apply uniformly across
  -- training / profiling / production / sales / isla / leverage so every
  -- report adds the numbers up under the single canonical name.
  CREATE TEMP TABLE _ap ON COMMIT DROP AS
  SELECT DISTINCT src, public.mel_merge_canon(name_key) AS name_key, district
  FROM (
    SELECT 'training'::text src, public.mel_norm_key(data_collector) name_key, upper(coalesce(district,'')) AS district FROM at_rows WHERE data_collector IS NOT NULL
    UNION ALL SELECT 'profiling', public.mel_norm_key(profiler_name),  upper(coalesce(district,''))      FROM shg_profiling_rows WHERE profiler_name  IS NOT NULL
    UNION ALL SELECT 'production',public.mel_norm_key(profilers_name), upper(coalesce(district_name,'')) FROM production_rows    WHERE profilers_name IS NOT NULL
    UNION ALL SELECT 'poultry',   public.mel_norm_key(profilers_name), upper(coalesce(district_name,'')) FROM poultry_sales_rows WHERE profilers_name IS NOT NULL
    UNION ALL SELECT 'sales',     public.mel_norm_key(profilers_name), upper(coalesce(district_name,'')) FROM sales_rows         WHERE profilers_name IS NOT NULL
    UNION ALL SELECT 'isla',      public.mel_norm_key(profilers_name), upper(coalesce(district_shg,''))  FROM isla_final_rows     WHERE profilers_name IS NOT NULL
    UNION ALL SELECT 'leverage',  public.mel_norm_key(submitter_name), upper(coalesce(district,''))      FROM local_leverage_rows WHERE submitter_name IS NOT NULL
  ) s
  WHERE coalesce(name_key,'') <> '';

  -- pass 2a: data-derived person districts.
  --   (i) strong-key activity: resolve each STRONG (username/fullname) combo,
  --       then record the district it appeared in.
  --   (ii) registry district as a baseline anchor.
  TRUNCATE public.mel_person_district;
  INSERT INTO public.mel_person_district(person_id, district)
  SELECT DISTINCT person_id, district FROM (
    -- (i) districts from strong-key activity hits
    SELECT ap.district,
           (SELECT a.person_id FROM public.mel_person_alias a
             WHERE a.kind IN ('username','fullname') AND a.alias_key = ap.name_key
             GROUP BY a.person_id LIMIT 1) AS person_id
    FROM _ap ap
    WHERE ap.district <> ''
      AND EXISTS (SELECT 1 FROM public.mel_person_alias a
                   WHERE a.kind IN ('username','fullname') AND a.alias_key = ap.name_key)
    UNION ALL
    -- (ii) registry district baseline
    SELECT upper(fs.district), fs.ref_id
    FROM public.field_staff fs WHERE coalesce(fs.district,'') <> ''
  ) d
  WHERE person_id IS NOT NULL AND district <> ''
  ON CONFLICT DO NOTHING;

  -- pass 2b: resolve everything.
  TRUNCATE public.mel_activity_person;
  INSERT INTO public.mel_activity_person(src, name_key, person_id, district)
  SELECT src, name_key, public.mel_resolve_person(name_key, district), district FROM _ap;

  SELECT count(*) INTO n FROM public.mel_activity_person;
  RETURN n;
END;
$fn$;
