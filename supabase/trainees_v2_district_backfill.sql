-- ---------------------------------------------------------------------------
-- trainees_v2 district backfill
--
-- PROBLEM: recent attendance submissions (Aug 2026 onward — which include the
-- whole Central cluster: Mukono / Buikwe / Kayunga) arrive with a BLANK
-- district_name in the raw attendance_registration_form OData feed. The
-- trainees_v2 ingester copies that blank through, so those trainings fall out
-- of every district slicer and the Central cluster never appears on
-- /trainees-v2 — even though the data is physically present.
--
-- FIX: the authoritative MIS all_trainees_view (materialised in at_rows)
-- carries the correct district for each participant, and every participant maps
-- to EXACTLY ONE district there (verified: 113,657 participants, all with a
-- single district). So we can deterministically backfill the blank trainees_v2
-- rows from that single district — no ambiguity, no guessing.
--
-- This function is idempotent and only touches rows whose district is still
-- blank, so it is safe to run on every ingest / refresh / warm-cache tick. That
-- keeps Central (and any future blank-district submissions) self-healing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.backfill_trainees_v2_district()
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE n integer;
BEGIN
  UPDATE public.trainees_v2 t
  SET district = a.district
  FROM (
    SELECT DISTINCT participant_id, district
    FROM public.at_rows
    WHERE COALESCE(district,'') <> ''
  ) a
  WHERE COALESCE(t.district,'') = ''
    AND COALESCE(t.participant_id,'') <> ''
    AND a.participant_id = t.participant_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;
