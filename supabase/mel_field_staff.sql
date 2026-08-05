-- ============================================================================
-- CANONICAL FIELD-STAFF / CF-NAME REGISTRY  (Task E — 3-layer identity model)
--
-- LAYER 1  Identity      : field_staff        (official HR list, from CSV upload)
-- LAYER 2  Alias / merge  : mel_person + mel_person_alias
--                           mel_person       = one row per CANONICAL human
--                           mel_person_alias = every name-key / username / refID
--                                              that resolves to that human
-- LAYER 3  Activity       : profiling + at_rows (unchanged) — joined THROUGH the
--                           alias layer so a CF's work rolls up to ONE identity
--                           even across duplicate accounts, and district is taken
--                           from the DATA (authoritative), not the stale registry.
--
-- Rationale (proven with live data):
--   * field_staff.username == mel_norm_key(at_rows.data_collector)  (exact)
--   * profiling stores SHORT names ("Abubakar","Titus") -> single-word names were
--     dropped by the old universe filter; short keys never matched training keys.
--   * A person may own MORE THAN ONE account (old login broke) -> must merge.
--   * Registry district can be stale (Titus: registry=Mayuge, data=Jinja) -> the
--     universe/report district is derived from activity data, not field_staff.
--
-- NOTE: roles anon/service_role do NOT exist on the Oracle VM — no GRANTs here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- LAYER 1: field_staff master table (official identities from the CSV export)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_staff (
  ref_id       text PRIMARY KEY,          -- FSS-000xxxxx  (canonical staff id)
  first_name   text,
  last_name    text,
  username     text,                       -- lowercase-nospace name concat
  partner_name text,
  email        text,
  user_type    text,                       -- Community Facilitator (+ subgrantee / A2F)
  lvl          text,                        -- Subcounty / District / Partner
  partner      text,
  district     text,                        -- registry district (may be stale)
  subcounty    text,
  enabled      boolean,
  date_created text,
  created_by   text,
  loaded_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_staff_username_idx ON public.field_staff(username);

-- Normalised username key (same transform as mel_norm_key so it joins at_rows).
CREATE OR REPLACE FUNCTION public.mel_fs_userkey(txt text)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT public.mel_norm_key(txt) $$;

-- ---------------------------------------------------------------------------
-- LAYER 2: canonical person + alias map
--   mel_person: one row per human. person_id is stable (we use the "primary"
--     ref_id). display_name is the official "First Last".
--   mel_person_alias: every key that resolves to a person, with a `kind`:
--     'username'  -> the username key (joins at_rows.data_collector)
--     'firstname' -> mel_norm_key(first_name)   (catches short profiler names)
--     'lastname'  -> mel_norm_key(last_name)
--     'fullname'  -> mel_norm_key(first||last) + reversed
--     'manual'    -> an override added in the admin tab (never auto-purged)
--     'refid'     -> a merged duplicate account's ref_id
--   is_manual = TRUE rows survive rebuilds (manual merges / added aliases).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mel_person (
  person_id    text PRIMARY KEY,           -- primary ref_id of the human
  display_name text,                        -- "First Last" (official)
  primary_ref  text,                        -- same as person_id (explicit)
  user_type    text,
  enabled      boolean,
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mel_person_alias (
  person_id  text NOT NULL,                 -- -> mel_person.person_id
  alias_key  text NOT NULL,                 -- normalised key (or ref_id for kind=refid)
  kind       text NOT NULL,                 -- username|firstname|lastname|fullname|manual|refid
  is_manual  boolean DEFAULT false,         -- protect from auto-rebuild TRUNCATE
  PRIMARY KEY (person_id, alias_key, kind)
);
CREATE INDEX IF NOT EXISTS mel_person_alias_key_idx ON public.mel_person_alias(alias_key);

-- Manual account-merge table: "these two ref_ids are the SAME human".
-- Winner = keep_ref (its person_id absorbs the loser's aliases & activity).
CREATE TABLE IF NOT EXISTS public.mel_person_merge (
  loser_ref  text PRIMARY KEY,              -- the duplicate account to fold in
  keep_ref   text NOT NULL,                 -- the surviving canonical ref_id
  note       text,
  created_at timestamptz DEFAULT now()
);

-- Manual SHG-owner override: force a group's profiler to a chosen person.
-- group_key = mel_norm_key(group_name); resolves ahead of data-derived owner.
CREATE TABLE IF NOT EXISTS public.mel_shg_owner_override (
  group_key  text PRIMARY KEY,
  person_id  text NOT NULL,
  note       text,
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- REBUILD the person + alias layer from field_staff, honouring manual merges.
--   * one mel_person per human (after applying mel_person_merge)
--   * auto aliases: username / firstname / lastname / fullname(+reversed)
--   * manual aliases (is_manual=TRUE) are preserved across rebuild
--   * a merged duplicate's ref_id is added as kind='refid' alias on the keeper
-- Returns the number of canonical persons.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_refresh_person_registry()
 RETURNS integer LANGUAGE plpgsql AS
$fn$
DECLARE n integer;
BEGIN
  -- Resolve every ref_id to its surviving (keeper) ref via the merge table.
  CREATE TEMP TABLE _resolve ON COMMIT DROP AS
  SELECT fs.ref_id,
         COALESCE(m.keep_ref, fs.ref_id) AS keep_ref
  FROM public.field_staff fs
  LEFT JOIN public.mel_person_merge m ON m.loser_ref = fs.ref_id;

  -- Canonical person = the keeper row's identity.
  CREATE TEMP TABLE _person ON COMMIT DROP AS
  SELECT k.keep_ref AS person_id,
         btrim(coalesce(fs.first_name,'')||' '||coalesce(fs.last_name,'')) AS display_name,
         fs.user_type,
         bool_or(coalesce(fs2.enabled,false)) AS enabled
  FROM (SELECT DISTINCT keep_ref FROM _resolve) k
  JOIN public.field_staff fs ON fs.ref_id = k.keep_ref
  -- enabled = TRUE if ANY of the merged accounts is enabled
  LEFT JOIN _resolve r ON r.keep_ref = k.keep_ref
  LEFT JOIN public.field_staff fs2 ON fs2.ref_id = r.ref_id
  GROUP BY k.keep_ref, fs.first_name, fs.last_name, fs.user_type;

  -- Auto aliases from EVERY member account of each person.
  CREATE TEMP TABLE _alias ON COMMIT DROP AS
  SELECT DISTINCT keep_ref AS person_id, alias_key, kind FROM (
    SELECT r.keep_ref,
           public.mel_norm_key(fs.username)                                   AS alias_key,
           'username'::text AS kind
    FROM _resolve r JOIN public.field_staff fs ON fs.ref_id = r.ref_id
    WHERE coalesce(fs.username,'') <> ''
    UNION ALL
    SELECT r.keep_ref, public.mel_norm_key(fs.first_name), 'firstname'
    FROM _resolve r JOIN public.field_staff fs ON fs.ref_id = r.ref_id
    WHERE length(public.mel_norm_key(fs.first_name)) >= 4
    UNION ALL
    SELECT r.keep_ref, public.mel_norm_key(fs.last_name), 'lastname'
    FROM _resolve r JOIN public.field_staff fs ON fs.ref_id = r.ref_id
    WHERE length(public.mel_norm_key(fs.last_name)) >= 4
    UNION ALL
    SELECT r.keep_ref, public.mel_norm_key(coalesce(fs.first_name,'')||coalesce(fs.last_name,'')), 'fullname'
    FROM _resolve r JOIN public.field_staff fs ON fs.ref_id = r.ref_id
    WHERE length(public.mel_norm_key(coalesce(fs.first_name,'')||coalesce(fs.last_name,''))) >= 5
    UNION ALL
    SELECT r.keep_ref, public.mel_norm_key(coalesce(fs.last_name,'')||coalesce(fs.first_name,'')), 'fullname'
    FROM _resolve r JOIN public.field_staff fs ON fs.ref_id = r.ref_id
    WHERE length(public.mel_norm_key(coalesce(fs.last_name,'')||coalesce(fs.first_name,''))) >= 5
    UNION ALL
    -- a merged duplicate account contributes its ref_id as a refid alias
    SELECT r.keep_ref, r.ref_id, 'refid'
    FROM _resolve r WHERE r.ref_id <> r.keep_ref
  ) a
  WHERE coalesce(alias_key,'') <> '';

  -- Rewrite mel_person.
  TRUNCATE public.mel_person;
  INSERT INTO public.mel_person(person_id, display_name, primary_ref, user_type, enabled, updated_at)
  SELECT person_id, display_name, person_id, user_type, enabled, now() FROM _person;

  -- Preserve manual aliases, then rewrite auto aliases.
  DELETE FROM public.mel_person_alias WHERE is_manual = false;
  INSERT INTO public.mel_person_alias(person_id, alias_key, kind, is_manual)
  SELECT person_id, alias_key, kind, false FROM _alias
  ON CONFLICT (person_id, alias_key, kind) DO NOTHING;

  SELECT count(*) INTO n FROM public.mel_person;
  RETURN n;
END;
$fn$;
