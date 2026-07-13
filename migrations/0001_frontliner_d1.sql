-- ============================================================================
-- D1 (SQLite) schema for the Frontliner cluster (all_trainees_view).
-- This cluster was moved off Supabase/Postgres to D1 (5GB, no RAM ceiling,
-- no cold-start) because all_trainees_view (~728k rows) exhausted Supabase's
-- 0.5GB RAM tier and crashed it repeatedly.
--
-- Design: instead of storing raw JSONB + re-flattening in stored functions
-- (D1 has no PL/pgSQL), we flatten the relevant fields at INSERT time into a
-- single participant-grain table `at_rows`. All three dashboards
-- (Frontliners / Cluster Trainings / New Youth) aggregate over this one table
-- in the Worker (TypeScript), so there are no *_rows / *_summary refresh steps.
-- ============================================================================

-- Participant-grain flattened rows from all_trainees_view.
CREATE TABLE IF NOT EXISTS at_rows (
  dedup_key       TEXT PRIMARY KEY,   -- unique per source record (_id / docId)
  data_collector  TEXT,
  participant_id  TEXT,
  group_id        TEXT,
  group_name      TEXT,
  training_type   TEXT,
  district        TEXT,               -- UPPER-cased
  day             TEXT,               -- 'YYYY-MM-DD' or NULL
  sex             TEXT,               -- raw casing kept ('Female'/'Male'/...)
  is_pwd          INTEGER,            -- 1 when Disability_status = 'Yes' (case-insens)
  is_farming      INTEGER,            -- 1 when Do_for_living = 'Farming'
  has_date        INTEGER,            -- 1 when activity_date matches YYYY-MM-DD
  source_file     TEXT
);

CREATE INDEX IF NOT EXISTS at_rows_dc_idx       ON at_rows (data_collector);
CREATE INDEX IF NOT EXISTS at_rows_day_idx      ON at_rows (day);
CREATE INDEX IF NOT EXISTS at_rows_district_idx ON at_rows (district);
CREATE INDEX IF NOT EXISTS at_rows_pid_idx      ON at_rows (participant_id);

-- Per-district / per-month programme targets (from Targets.xlsx upload).
-- Feeds the New Youth "Target_Selected_Period" / "Monthly_Target" cards.
CREATE TABLE IF NOT EXISTS reach_targets (
  district       TEXT NOT NULL,
  month          TEXT NOT NULL,       -- 'YYYY-MM-01'
  target         REAL,
  target_shgs    REAL,
  target_yiw     REAL,
  target_female  REAL,
  target_pwds    REAL,
  PRIMARY KEY (district, month)
);
CREATE INDEX IF NOT EXISTS reach_targets_month_idx ON reach_targets (month);
