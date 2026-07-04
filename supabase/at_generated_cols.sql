-- ============================================================================
-- Speed up Cluster Trainings aggregation: generated columns + indexes on the
-- all_trainees fields inside records.data (JSONB). Generated columns are stored,
-- so the dashboard query becomes an indexed scan instead of a JSONB+regex scan.
-- ============================================================================

alter table public.records
  add column if not exists at_training_type text
    generated always as (nullif(trim(data->>'training_type'), '')) stored,
  add column if not exists at_district text
    generated always as (upper(nullif(trim(data->>'district'), ''))) stored,
  add column if not exists at_sex text
    generated always as (lower(nullif(trim(data->>'sex'), ''))) stored,
  add column if not exists at_disability text
    generated always as (lower(nullif(trim(data->>'Disability_status'), ''))) stored,
  add column if not exists at_group_id text
    generated always as (nullif(trim(data->>'group_id'), '')) stored,
  add column if not exists at_activity_day text
    generated always as (
      case when (data->>'activity_date') ~ '^\d{4}-\d{2}-\d{2}'
           then left(data->>'activity_date',10) else null end
    ) stored;

create index if not exists records_at_template_district_idx
  on public.records (template, at_district) where template = 'all_trainees_view';
create index if not exists records_at_template_date_idx
  on public.records (template, at_activity_day) where template = 'all_trainees_view';
create index if not exists records_at_template_tt_idx
  on public.records (template, at_training_type) where template = 'all_trainees_view';
