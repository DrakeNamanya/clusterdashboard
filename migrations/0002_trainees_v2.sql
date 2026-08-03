-- trainees_v2: the TRUE trainees table, rebuilt from the 4 attendance OData
-- feeds (v1 + v2, each parent header ⋈ child participants) instead of the
-- derived all_trainees_view. One row per participant-attendance (the "cluster
-- trainings" grain). Monthly New Youth = first activity_date per participant.
--
-- Join: child."__Submissions-id" = parent.docId.  Union of v1 + v2.
-- Business key (stored, dedup-safe): submission_doc_id + participant_id +
--   training_type + activity_day  -> hashed into row_key.
CREATE TABLE IF NOT EXISTS public.trainees_v2 (
  row_key            TEXT PRIMARY KEY,        -- fnv1a business key (idempotent)
  form_version       TEXT,                    -- 'v1' | 'v2'
  submission_doc_id  TEXT,                    -- parent.docId  (= child.__Submissions-id)
  child_doc_id       TEXT,                    -- child.docId (per participant row)
  participant_name   TEXT,
  participant_id     TEXT,                    -- shg_participant_id (e.g. HEI-Iga-000...)
  sex                TEXT,
  is_pwd             SMALLINT DEFAULT 0,      -- shg_disability = 'Yes'
  -- location (from parent)
  district           TEXT,
  subcounty          TEXT,
  parish             TEXT,
  village            TEXT,
  venue              TEXT,
  -- event (from parent)
  activity_date      TEXT,                    -- raw ISO/string
  activity_day       TEXT,                    -- normalised YYYY-MM-DD (or NULL)
  activity_month     TEXT,                    -- YYYY-MM (for monthly first-touch)
  training_type      TEXT,
  other_training_type TEXT,
  no_days            TEXT,
  hours              TEXT,
  target_group       TEXT,
  -- training-detail flags (the Cornerstone / PRSP / VBHCD / ISLA etc. you need)
  financial_literacy TEXT,
  biz_dev_services   TEXT,
  isla               TEXT,
  animal_mgt         TEXT,
  crop_mgt           TEXT,
  gender_safeguarding TEXT,
  vbhcd              TEXT,
  cornerstone_training TEXT,
  psrp               TEXT,
  incubation_services TEXT,
  agrihub_training   TEXT,
  sacco_training     TEXT,
  tot_training       TEXT,
  life_skills_modules TEXT,
  mental_health_topics TEXT,
  srhr_topics        TEXT,
  nutrition_training_topics TEXT,
  -- audit
  date_created       TEXT,
  source_feed        TEXT                     -- which of the 4 feeds
);

CREATE INDEX IF NOT EXISTS idx_tv2_participant ON public.trainees_v2(participant_id);
CREATE INDEX IF NOT EXISTS idx_tv2_district    ON public.trainees_v2(district);
CREATE INDEX IF NOT EXISTS idx_tv2_ttype        ON public.trainees_v2(training_type);
CREATE INDEX IF NOT EXISTS idx_tv2_month        ON public.trainees_v2(activity_month);
CREATE INDEX IF NOT EXISTS idx_tv2_day          ON public.trainees_v2(activity_day);

-- Sync cursor for the 4 feeds (per-feed skip offset).
CREATE TABLE IF NOT EXISTS public.trainees_v2_sync_state (
  feed         TEXT PRIMARY KEY,   -- 'v1_parent' | 'v1_child' | 'v2_parent' | 'v2_child'
  next_skip    INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  last_run     TIMESTAMPTZ,
  last_upserted INTEGER DEFAULT 0
);
