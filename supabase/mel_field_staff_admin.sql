-- ============================================================================
-- FIELD STAFF ADMIN RPCs (Task E — backend "Field Staff (CF Registry)" tab)
--
-- Read + write helpers powering the admin page where the M&E team can:
--   * SEE every canonical person, how many accounts they own, what activity
--     resolves to them, and any orphan (unresolved) profiler names.
--   * MERGE a duplicate account / orphan name into the right person.
--   * TRANSFER an SHG's owner to another person.
--   * RENAME a person's display name.
-- All writes touch only the Layer-2 override tables (mel_person_merge,
-- mel_person_alias[is_manual], mel_shg_owner_override) and then re-run the
-- Task-E refresh chain so the reports pick the change up immediately.
--
-- NOTE: roles anon/service_role do NOT exist on the Oracle VM — no GRANTs here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- LIST: canonical persons with account count, district(s) and activity totals.
-- Optional case-insensitive name search + district filter. Returns jsonb array.
-- Reads from the pre-computed caches (mel_person, mel_cf_universe,
-- mel_person_district, mel_activity_person) so it is sub-second.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_admin_person_list(
  p_search   text DEFAULT NULL,
  p_district text DEFAULT NULL,
  p_limit    int  DEFAULT 500)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS
$fn$
DECLARE v jsonb; v_s text; v_d text;
BEGIN
  v_s := nullif(btrim(lower(coalesce(p_search,''))),'');
  v_d := nullif(upper(btrim(coalesce(p_district,''))),'');
  WITH acct AS (            -- how many field_staff accounts fold into each person
    SELECT COALESCE(m.keep_ref, fs.ref_id) AS person_id, count(*)::int AS accounts
    FROM public.field_staff fs
    LEFT JOIN public.mel_person_merge m ON m.loser_ref = fs.ref_id
    GROUP BY 1
  ),
  dist AS (                 -- data-derived districts per person
    SELECT person_id, array_agg(DISTINCT district ORDER BY district) AS districts
    FROM public.mel_person_district WHERE district IS NOT NULL GROUP BY person_id
  ),
  act AS (                  -- distinct activity sources + rows resolved to person
    SELECT person_id, count(DISTINCT src)::int AS sources, count(*)::int AS act_rows
    FROM public.mel_activity_person WHERE person_id IS NOT NULL GROUP BY person_id
  ),
  base AS (
    SELECT p.person_id, p.display_name, p.user_type, p.enabled,
           COALESCE(a.accounts,1) AS accounts,
           COALESCE(d.districts, ARRAY[]::text[]) AS districts,
           COALESCE(ac.sources,0)  AS sources,
           COALESCE(ac.act_rows,0) AS act_rows
    FROM public.mel_person p
    LEFT JOIN acct a  ON a.person_id  = p.person_id
    LEFT JOIN dist d  ON d.person_id  = p.person_id
    LEFT JOIN act  ac ON ac.person_id = p.person_id
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.display_name), '[]'::jsonb) INTO v
  FROM (
    SELECT person_id, display_name, user_type, enabled, accounts,
           districts, sources, act_rows
    FROM base
    WHERE (v_s IS NULL OR lower(display_name) LIKE '%'||v_s||'%')
      AND (v_d IS NULL OR v_d = ANY(districts))
    ORDER BY display_name
    LIMIT GREATEST(1, LEAST(coalesce(p_limit,500), 5000))
  ) t;
  RETURN coalesce(v,'[]'::jsonb);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- ORPHANS: activity profiler names that resolved to NO person (person_id NULL).
-- These are the rows the admin folds into a real person via add_alias / merge.
-- Grouped by the normalised key so each distinct name appears once with counts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_admin_orphan_list(
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 300)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS
$fn$
DECLARE v jsonb; v_s text;
BEGIN
  v_s := nullif(btrim(lower(coalesce(p_search,''))),'');
  SELECT COALESCE(jsonb_agg(t ORDER BY t.act_rows DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT ap.name_key,
           array_agg(DISTINCT ap.src) AS sources,
           array_agg(DISTINCT ap.district) FILTER (WHERE ap.district IS NOT NULL) AS districts,
           count(*)::int AS act_rows
    FROM public.mel_activity_person ap
    WHERE ap.person_id IS NULL
      AND coalesce(ap.name_key,'') <> ''
      AND (v_s IS NULL OR ap.name_key LIKE '%'||v_s||'%')
    GROUP BY ap.name_key
    ORDER BY count(*) DESC
    LIMIT GREATEST(1, LEAST(coalesce(p_limit,300), 3000))
  ) t;
  RETURN coalesce(v,'[]'::jsonb);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- DETAIL: one person — their accounts, aliases, districts and activity by src.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_admin_person_detail(p_person_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS
$fn$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'person', (SELECT to_jsonb(p) FROM public.mel_person p WHERE p.person_id = p_person_id),
    'accounts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'ref_id', fs.ref_id, 'first_name', fs.first_name, 'last_name', fs.last_name,
               'username', fs.username, 'district', fs.district, 'user_type', fs.user_type,
               'enabled', fs.enabled,
               'is_primary', (fs.ref_id = p_person_id))), '[]'::jsonb)
      FROM public.field_staff fs
      LEFT JOIN public.mel_person_merge m ON m.loser_ref = fs.ref_id
      WHERE COALESCE(m.keep_ref, fs.ref_id) = p_person_id
    ),
    'aliases', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'alias_key', a.alias_key, 'kind', a.kind, 'is_manual', a.is_manual)
               ORDER BY a.kind, a.alias_key), '[]'::jsonb)
      FROM public.mel_person_alias a WHERE a.person_id = p_person_id
    ),
    'districts', (
      SELECT COALESCE(jsonb_agg(DISTINCT district ORDER BY district), '[]'::jsonb)
      FROM public.mel_person_district WHERE person_id = p_person_id AND district IS NOT NULL
    ),
    'activity', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('src', src, 'rows', c)
               ORDER BY src), '[]'::jsonb)
      FROM (SELECT src, count(*)::int AS c FROM public.mel_activity_person
            WHERE person_id = p_person_id GROUP BY src) q
    )
  ) INTO v;
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- MERGE an orphan activity name (by its normalised key) into a person as a
-- MANUAL alias. Use this when the duplicate is a profiler-name variant (e.g.
-- "titushillarysebaiga") rather than a whole field_staff account. Re-runs the
-- Task-E chain. Returns the refreshed universe rowcount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_admin_add_alias(
  p_person_id text, p_alias_key text, p_note text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE k text; n integer;
BEGIN
  k := public.mel_norm_key(p_alias_key);
  IF k = '' OR p_person_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty alias or person');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mel_person WHERE person_id = p_person_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown person_id');
  END IF;
  INSERT INTO public.mel_person_alias(person_id, alias_key, kind, is_manual)
  VALUES (p_person_id, k, 'manual', true)
  ON CONFLICT (person_id, alias_key, kind) DO NOTHING;
  n := public.mel_refresh_cf_all();
  RETURN jsonb_build_object('ok', true, 'alias_key', k, 'universe', n);
END;
$fn$;

-- Remove a MANUAL alias (undo an add_alias). Auto aliases cannot be removed.
CREATE OR REPLACE FUNCTION public.mel_admin_del_alias(
  p_person_id text, p_alias_key text)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE k text; n integer; d int;
BEGIN
  k := public.mel_norm_key(p_alias_key);
  DELETE FROM public.mel_person_alias
   WHERE person_id = p_person_id AND alias_key = k AND kind = 'manual' AND is_manual = true;
  GET DIAGNOSTICS d = ROW_COUNT;
  n := public.mel_refresh_cf_all();
  RETURN jsonb_build_object('ok', d > 0, 'removed', d, 'universe', n);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- MERGE ACCOUNTS: fold a duplicate field_staff account (loser_ref) into the
-- keeper. Records it in mel_person_merge and re-runs the chain. This is the
-- "CF has more than one account because the previous one didn't work" case.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_admin_merge_accounts(
  p_loser_ref text, p_keep_ref text, p_note text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE n integer;
BEGIN
  IF p_loser_ref IS NULL OR p_keep_ref IS NULL OR p_loser_ref = p_keep_ref THEN
    RETURN jsonb_build_object('ok', false, 'error', 'need two distinct ref_ids');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.field_staff WHERE ref_id = p_loser_ref)
     OR NOT EXISTS (SELECT 1 FROM public.field_staff WHERE ref_id = p_keep_ref) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown ref_id');
  END IF;
  INSERT INTO public.mel_person_merge(loser_ref, keep_ref, note)
  VALUES (p_loser_ref, p_keep_ref, p_note)
  ON CONFLICT (loser_ref) DO UPDATE SET keep_ref = EXCLUDED.keep_ref, note = EXCLUDED.note, created_at = now();
  n := public.mel_refresh_cf_all();
  RETURN jsonb_build_object('ok', true, 'universe', n);
END;
$fn$;

-- Undo an account merge.
CREATE OR REPLACE FUNCTION public.mel_admin_unmerge_account(p_loser_ref text)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE n integer; d int;
BEGIN
  DELETE FROM public.mel_person_merge WHERE loser_ref = p_loser_ref;
  GET DIAGNOSTICS d = ROW_COUNT;
  n := public.mel_refresh_cf_all();
  RETURN jsonb_build_object('ok', d > 0, 'removed', d, 'universe', n);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RENAME a person's display name (does not touch identity keys/joins).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_admin_rename_person(
  p_person_id text, p_display_name text)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE nm text; n integer; d int;
BEGIN
  nm := btrim(coalesce(p_display_name,''));
  IF nm = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'empty name'); END IF;
  UPDATE public.mel_person SET display_name = nm, updated_at = now()
   WHERE person_id = p_person_id;
  GET DIAGNOSTICS d = ROW_COUNT;
  -- rebuild the universe so the CF list shows the new name (registry rebuild
  -- would overwrite display_name from field_staff, so refresh universe ONLY).
  n := public.mel_refresh_cf_universe();
  RETURN jsonb_build_object('ok', d > 0, 'universe', n);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- TRANSFER an SHG's owner: force a group (by name) to a chosen person. Records
-- an override in mel_shg_owner_override. NOTE: the reports currently roll SHGs
-- up by the PROFILER name in the activity row; this override table is the
-- authoritative hook the resolver/universe can honour. Stored keyed by the
-- normalised group name. Returns ok + the stored key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mel_admin_transfer_shg(
  p_group_name text, p_person_id text, p_note text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE gk text;
BEGIN
  gk := public.mel_norm_key(p_group_name);
  IF gk = '' OR p_person_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'need group name + person');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mel_person WHERE person_id = p_person_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown person_id');
  END IF;
  INSERT INTO public.mel_shg_owner_override(group_key, person_id, note)
  VALUES (gk, p_person_id, p_note)
  ON CONFLICT (group_key) DO UPDATE SET person_id = EXCLUDED.person_id, note = EXCLUDED.note, created_at = now();
  RETURN jsonb_build_object('ok', true, 'group_key', gk);
END;
$fn$;

-- Remove an SHG owner override.
CREATE OR REPLACE FUNCTION public.mel_admin_untransfer_shg(p_group_name text)
 RETURNS jsonb LANGUAGE plpgsql AS
$fn$
DECLARE gk text; d int;
BEGIN
  gk := public.mel_norm_key(p_group_name);
  DELETE FROM public.mel_shg_owner_override WHERE group_key = gk;
  GET DIAGNOSTICS d = ROW_COUNT;
  RETURN jsonb_build_object('ok', d > 0, 'removed', d);
END;
$fn$;
