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
  CREATE TEMP TABLE _u ON COMMIT DROP AS
  SELECT nm,
         public.mel_norm_key(nm) AS ck,
         (SELECT string_agg(w, ' ' ORDER BY w)
            FROM unnest(regexp_split_to_array(nm,' ')) w WHERE w <> '') AS sortkey,
         array_agg(DISTINCT d) AS districts
  FROM (
    SELECT public.mel_norm_name(profiler_name)  AS nm, upper(district)      AS d FROM shg_profiling_rows WHERE profiler_name  IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM production_rows      WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM poultry_sales_rows   WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_name) FROM sales_rows           WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(profilers_name), upper(district_shg)  FROM isla_final_rows       WHERE profilers_name IS NOT NULL
    UNION ALL SELECT public.mel_norm_name(submitter_name), upper(district)      FROM local_leverage_rows   WHERE submitter_name IS NOT NULL
  ) allnames
  WHERE nm <> '' AND nm ~ '[a-z]' AND nm ~ ' '
    AND nm !~ '(group|association|farmers|youth farmers|provision of|self help|shg|village|cluster|community)'
  GROUP BY nm;

  TRUNCATE public.mel_cf_universe;
  INSERT INTO public.mel_cf_universe SELECT * FROM _u;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;
