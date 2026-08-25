-- ============================================================================
-- Canonical district normalization
--
-- Source data has the SAME district under many spellings/cases, e.g.
--   MAYUGE | Mayuge | mayuge          (case)
--   KAMULI | 'KAMULI ' | Kamuli       (trailing space)
--   JINJA CITY | jinja_city           (separator)
-- so any report that GROUPs BY or lists the raw district value splits one
-- district into several rows / slicer options, and filters can miss rows.
--
-- These two functions give ONE canonical form everywhere:
--   mel_canon_district(text)      -> canonical UPPER key  (for filtering / grouping)
--   mel_canon_district_disp(text) -> canonical Title Case (for display)
--
-- The UPPER key matches the existing filter contract (src/clusters.ts passes
-- UPPERCASE district arrays; report fns compare upper(district)=ANY(...)),
-- so existing filters keep working and now also collapse case/space/underscore
-- variants onto a single bucket.
-- ============================================================================

create or replace function public.mel_canon_district(p text)
returns text
language sql
immutable
as $$
  -- upper, trim, underscores -> space, collapse repeated spaces
  select nullif(
    regexp_replace(
      regexp_replace(upper(trim(coalesce(p,''))), '[_]+', ' ', 'g'),
      '\s+', ' ', 'g'
    ), '');
$$;

create or replace function public.mel_canon_district_disp(p text)
returns text
language sql
immutable
as $$
  -- Title-case the canonical key for display (Mayuge, Jinja City, ...).
  select initcap(public.mel_canon_district(p));
$$;

grant execute on function public.mel_canon_district(text)      to anon, service_role;
grant execute on function public.mel_canon_district_disp(text) to anon, service_role;
