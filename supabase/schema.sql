-- ============================================================================
-- SHG Data Cleaner — Supabase schema (records table + per-template views)
-- Run this ONCE in Supabase → SQL Editor.
-- ============================================================================

create table if not exists public.records (
  id          bigint generated always as identity primary key,
  template    text not null,
  dedup_key   text not null,
  seq         integer,
  source_file text,
  ingested_at timestamptz not null default now(),
  data        jsonb not null,
  unique (template, dedup_key)
);

create index if not exists records_template_idx on public.records (template);
create index if not exists records_template_seq_idx on public.records (template, seq);

alter table public.records enable row level security;

-- View: shg_groups_view
create or replace view public.shg_groups_view as
select
  (data->>'No') as "No",
  (data->>'_id') as "_id",
  (data->>'dateCreated') as "dateCreated",
  (data->>'SHG Name') as "SHG Name",
  (data->>'SHG ID') as "SHG ID",
  (data->>'district') as "district",
  (data->>'subcounty') as "subcounty",
  (data->>'contactperson') as "contactperson",
  (data->>'contact_phone_number') as "contact_phone_number",
  (data->>'group_status') as "group_status",
  (data->>'Total') as "Total",
  (data->>'Female') as "Female",
  (data->>'Male') as "Male",
  (data->>'PWD') as "PWD",
  (data->>'trainings') as "trainings",
  (data->>'no_trainings') as "no_trainings",
  (data->>'Participants Trained') as "Participants Trained",
  (data->>'value_chain') as "value_chain"
from public.records
where template = 'shg_groups_view';

-- View: all_trainees_view
create or replace view public.all_trainees_view as
select
  (data->>'_id') as "_id",
  (data->>'participant_name') as "participant_name",
  (data->>'participant_id') as "participant_id",
  (data->>'group_id') as "group_id",
  (data->>'training_type') as "training_type",
  (data->>'activity_date') as "activity_date",
  (data->>'data_collector') as "data_collector",
  (data->>'group_name') as "group_name",
  (data->>'sex') as "sex",
  (data->>'district') as "district",
  (data->>'subcounty') as "subcounty",
  (data->>'Parish') as "Parish",
  (data->>'Village') as "Village",
  (data->>'Disability_status') as "Disability_status",
  (data->>'Employment_status') as "Employment_status",
  (data->>'Employment_sector') as "Employment_sector",
  (data->>'Do_for_living') as "Do_for_living"
from public.records
where template = 'all_trainees_view';

-- View: agrihubs
create or replace view public.agrihubs as
select
  (data->>'_id') as "_id",
  (data->>'agrihub') as "agrihub",
  (data->>'agrihub_id') as "agrihub_id",
  (data->>'agrihub_unit_received') as "agrihub_unit_received",
  (data->>'agrihub_qty_received') as "agrihub_qty_received",
  (data->>'__Submissions-id') as "__Submissions-id",
  (data->>'dateCreated') as "dateCreated",
  (data->>'lastUpdated') as "lastUpdated",
  (data->>'createdBy') as "createdBy",
  (data->>'district') as "district",
  (data->>'subcounty') as "subcounty",
  (data->>'partner') as "partner",
  (data->>'district_name') as "district_name",
  (data->>'material_type') as "material_type",
  (data->>'unit') as "unit",
  (data->>'distribution_date') as "distribution_date",
  (data->>'participant_type') as "participant_type",
  (data->>'supplier') as "supplier",
  (data->>'submitterName') as "submitterName",
  (data->>'submissionDate') as "submissionDate",
  (data->>'docId') as "docId"
from public.records
where template = 'agrihubs';

-- View: distribution_form_v2
create or replace view public.distribution_form_v2 as
select
  (data->>'_id') as "_id",
  (data->>'partner') as "partner",
  (data->>'district_name') as "district_name",
  (data->>'Subcounty_name') as "Subcounty_name",
  (data->>'parish') as "parish",
  (data->>'village') as "village",
  (data->>'material_type') as "material_type",
  (data->>'other_material_type') as "other_material_type",
  (data->>'livestock_type') as "livestock_type",
  (data->>'other_livestock_type') as "other_livestock_type",
  (data->>'crop_type') as "crop_type",
  (data->>'other_crop_type') as "other_crop_type",
  (data->>'agri_resources_type') as "agri_resources_type",
  (data->>'other_agri_resources_type') as "other_agri_resources_type",
  (data->>'isla_kits') as "isla_kits",
  (data->>'other_isla_kits') as "other_isla_kits",
  (data->>'unit') as "unit",
  (data->>'qty_distributed_other') as "qty_distributed_other",
  (data->>'qty_distributed_kgs') as "qty_distributed_kgs",
  (data->>'qty_distributed_grams') as "qty_distributed_grams",
  (data->>'qty_distributed_seedlings') as "qty_distributed_seedlings",
  (data->>'qty_distributed_liters') as "qty_distributed_liters",
  (data->>'qty_distributed_packets') as "qty_distributed_packets",
  (data->>'qty_distributed_dozens') as "qty_distributed_dozens",
  (data->>'qty_distributed_sackets') as "qty_distributed_sackets",
  (data->>'qty_distributed_tins') as "qty_distributed_tins",
  (data->>'qty_distributed_boxes') as "qty_distributed_boxes",
  (data->>'qty_distributed_pieces') as "qty_distributed_pieces",
  (data->>'qty_distributed_number') as "qty_distributed_number",
  (data->>'qty_distributed_kit') as "qty_distributed_kit",
  (data->>'qty_distributed_meters') as "qty_distributed_meters",
  (data->>'qty_distributed_hectare') as "qty_distributed_hectare",
  (data->>'qty_distributed_acre') as "qty_distributed_acre",
  (data->>'qty_distributed_foot') as "qty_distributed_foot",
  (data->>'distribution_date') as "distribution_date",
  (data->>'participant_type') as "participant_type",
  (data->>'other_participant_type') as "other_participant_type",
  (data->>'supplier') as "supplier",
  (data->>'other_supplier') as "other_supplier",
  (data->>'distributor') as "distributor",
  (data->>'distributor_title') as "distributor_title",
  (data->>'unique_id') as "unique_id",
  (data->>'participants_shg@odata_navigationLink') as "participants_shg@odata_navigationLink",
  (data->>'submitterName') as "submitterName",
  (data->>'submissionDate') as "submissionDate",
  (data->>'updatedAt') as "updatedAt",
  (data->>'dateCreated') as "dateCreated",
  (data->>'lastUpdated') as "lastUpdated",
  (data->>'createdBy') as "createdBy",
  (data->>'shg_group@odata_navigationLink') as "shg_group@odata_navigationLink",
  (data->>'docId') as "docId",
  (data->>'agrihubs@odata_navigationLink') as "agrihubs@odata_navigationLink",
  (data->>'participants_sme@odata_navigationLink') as "participants_sme@odata_navigationLink",
  (data->>'participants_incubatee@odata_navigationLink') as "participants_incubatee@odata_navigationLink",
  (data->>'subcounties_view__id') as "subcounties_view__id",
  (data->>'mse_group@odata_navigationLink') as "mse_group@odata_navigationLink",
  (data->>'unit_1') as "unit_1",
  (data->>'unit_2') as "unit_2",
  (data->>'unit_3') as "unit_3",
  (data->>'unit_4') as "unit_4",
  (data->>'unit_5') as "unit_5"
from public.records
where template = 'distribution_form_v2';

-- View: participants_shg
create or replace view public.participants_shg as
select
  (data->>'_id') as "_id",
  (data->>'participant_name') as "participant_name",
  (data->>'shg_participant_id') as "shg_participant_id",
  (data->>'sex') as "sex",
  (data->>'shg_unit_received') as "shg_unit_received",
  (data->>'shg_qty_received') as "shg_qty_received",
  (data->>'shg_plot_size') as "shg_plot_size",
  (data->>'__Submissions-id') as "__Submissions-id",
  (data->>'shg_name') as "shg_name",
  (data->>'district') as "district",
  (data->>'subcounty') as "subcounty",
  (data->>'dateCreated') as "dateCreated",
  (data->>'lastUpdated') as "lastUpdated",
  (data->>'createdBy') as "createdBy",
  (data->>'shg_youth_profiles_view_shg_participant_id') as "shg_youth_profiles_view_shg_participant_id",
  (data->>'phone_number') as "phone_number",
  (data->>'docId') as "docId",
  (data->>'partner') as "partner",
  (data->>'district_name') as "district_name",
  (data->>'material_type') as "material_type",
  (data->>'unit') as "unit",
  (data->>'distribution_date') as "distribution_date",
  (data->>'participant_type') as "participant_type",
  (data->>'supplier') as "supplier",
  (data->>'submitterName') as "submitterName",
  (data->>'submissionDate') as "submissionDate",
  (data->>'other_shg_unit_received') as "other_shg_unit_received",
  (data->>'shg_members_view_id') as "shg_members_view_id",
  (data->>'shg_members_view__id') as "shg_members_view__id",
  (data->>'parentId') as "parentId",
  (data->>'subcounties_view__id') as "subcounties_view__id",
  (data->>'participants_shg_participant_id') as "participants_shg_participant_id"
from public.records
where template = 'participants_shg';

-- View: shg_group
create or replace view public.shg_group as
select
  (data->>'_id') as "_id",
  (data->>'shg_name') as "shg_name",
  (data->>'shg_id') as "shg_id",
  (data->>'shg_group_unit_received') as "shg_group_unit_received",
  (data->>'shg_group_qty_received') as "shg_group_qty_received",
  (data->>'__Submissions-id') as "__Submissions-id",
  (data->>'district') as "district",
  (data->>'subcounty') as "subcounty",
  (data->>'dateCreated') as "dateCreated",
  (data->>'lastUpdated') as "lastUpdated",
  (data->>'createdBy') as "createdBy",
  (data->>'shgs_view_shg_id') as "shgs_view_shg_id",
  (data->>'partner') as "partner",
  (data->>'district_name') as "district_name",
  (data->>'material_type') as "material_type",
  (data->>'unit') as "unit",
  (data->>'distribution_date') as "distribution_date",
  (data->>'participant_type') as "participant_type",
  (data->>'supplier') as "supplier",
  (data->>'submitterName') as "submitterName",
  (data->>'submissionDate') as "submissionDate",
  (data->>'docId') as "docId",
  (data->>'other_shg_group_unit_received') as "other_shg_group_unit_received",
  (data->>'shg_profiling_form_shg_id') as "shg_profiling_form_shg_id"
from public.records
where template = 'shg_group';
