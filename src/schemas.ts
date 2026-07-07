// ---------------------------------------------------------------------------
// Target schema definitions for the 6 known sheet templates.
// These drive detection, cleaning, storage (D1) and the OData feed.
// ---------------------------------------------------------------------------

export type ColType = 'text' | 'int' | 'number' | 'date' | 'phone' | 'seq';

export interface ColumnDef {
  /** Exact target output column name (as required by the spec). */
  name: string;
  /** How the value should be standardized. */
  type: ColType;
  /**
   * Optional: if this column's own source value is empty/missing, fill it from
   * another source column (by header name). Used e.g. for `docId` which must be
   * populated from `__Submissions-id` (or `unique_id`) when it arrives blank.
   */
  fillFrom?: string;
}

export interface SheetSchema {
  /** Logical key used internally and as the D1 table name / OData entity set. */
  key: string;
  /** Human friendly template name (matches the spec sheet name). */
  label: string;
  /** File-name fingerprints that hint at this template. */
  filenameHints: string[];
  /** The unique identifier column used for append-only de-duplication. */
  dedupKey: string;
  /**
   * Optional: columns that TOGETHER define a duplicate. When set, two rows are
   * duplicates iff ALL these columns match (a composite key), regardless of
   * `dedupKey`. Use this when a single id is NOT the uniqueness rule.
   * e.g. all_trainees_view: a participant may appear many times (many
   * trainings); a row is a duplicate only when every real field matches, so we
   * dedup on all 16 data columns EXCLUDING the system-generated `_id`.
   */
  dedupCols?: string[];
  /** Ordered list of target columns (order MUST be preserved on output). */
  columns: ColumnDef[];
}

// Helper to build a column list from a comma spec + a type map.
// `fill` maps a target column -> a source column to pull from when the target's
// own value is empty (e.g. docId <- __Submissions-id).
function cols(
  spec: string,
  types: Record<string, ColType> = {},
  fill: Record<string, string> = {}
): ColumnDef[] {
  return spec.split(',').map((raw) => {
    const name = raw.trim();
    const def: ColumnDef = { name, type: types[name] ?? 'text' };
    if (fill[name]) def.fillFrom = fill[name];
    return def;
  });
}

export const SCHEMAS: SheetSchema[] = [
  {
    key: 'shg_groups_view',
    label: 'Shg_group review',
    filenameHints: ['shg_groups_view', 'shg_group_review', 'shg group review'],
    dedupKey: '_id',
    columns: cols(
      'No,_id,dateCreated,SHG Name,SHG ID,district,subcounty,contactperson,contact_phone_number,group_status,Total,Female,Male,PWD,trainings,no_trainings,Participants Trained,value_chain',
      {
        No: 'seq',
        dateCreated: 'date',
        contact_phone_number: 'phone',
        Total: 'int',
        Female: 'int',
        Male: 'int',
        PWD: 'int',
        no_trainings: 'int',
        'Participants Trained': 'int',
      }
    ),
  },
  {
    key: 'all_trainees_view',
    label: 'All_trainees_view',
    filenameHints: ['all_trainees_view', 'all trainees', 'trainees_view'],
    dedupKey: '_id',
    // A participant can be trained many times; a duplicate is when EVERY real
    // field matches. `_id` is a system-generated submission id, so it is
    // EXCLUDED from the duplicate check (confirmed: Option A).
    dedupCols: [
      'participant_name', 'participant_id', 'group_id', 'training_type',
      'activity_date', 'data_collector', 'group_name', 'sex', 'district',
      'subcounty', 'Parish', 'Village', 'Disability_status',
      'Employment_status', 'Employment_sector', 'Do_for_living',
    ],
    columns: cols(
      '_id,participant_name,participant_id,group_id,training_type,activity_date,data_collector,group_name,sex,district,subcounty,Parish,Village,Disability_status,Employment_status,Employment_sector,Do_for_living',
      { activity_date: 'date' }
    ),
  },
  {
    key: 'agrihubs',
    label: 'agrihubs',
    filenameHints: ['agrihubs', 'agrihub'],
    dedupKey: '_id',
    columns: cols(
      '_id,agrihub,agrihub_id,agrihub_unit_received,agrihub_qty_received,__Submissions-id,dateCreated,lastUpdated,createdBy,district,subcounty,partner,district_name,material_type,unit,distribution_date,participant_type,supplier,submitterName,submissionDate,docId',
      {
        agrihub_qty_received: 'number',
        dateCreated: 'date',
        lastUpdated: 'date',
        distribution_date: 'date',
        submissionDate: 'date',
      },
      { docId: '__Submissions-id' }
    ),
  },
  {
    key: 'distribution_form_v2',
    label: 'distribution_form_v2',
    filenameHints: ['distribution_form_v2', 'distribution_form', 'distribution form'],
    dedupKey: '_id',
    columns: cols(
      '_id,partner,district_name,Subcounty_name,parish,village,material_type,other_material_type,livestock_type,other_livestock_type,crop_type,other_crop_type,agri_resources_type,other_agri_resources_type,isla_kits,other_isla_kits,unit,qty_distributed_other,qty_distributed_kgs,qty_distributed_grams,qty_distributed_seedlings,qty_distributed_liters,qty_distributed_packets,qty_distributed_dozens,qty_distributed_sackets,qty_distributed_tins,qty_distributed_boxes,qty_distributed_pieces,qty_distributed_number,qty_distributed_kit,qty_distributed_meters,qty_distributed_hectare,qty_distributed_acre,qty_distributed_foot,distribution_date,participant_type,other_participant_type,supplier,other_supplier,distributor,distributor_title,unique_id,participants_shg@odata_navigationLink,submitterName,submissionDate,updatedAt,dateCreated,lastUpdated,createdBy,shg_group@odata_navigationLink,docId,agrihubs@odata_navigationLink,participants_sme@odata_navigationLink,participants_incubatee@odata_navigationLink,subcounties_view__id,mse_group@odata_navigationLink,unit_1,unit_2,unit_3,unit_4,unit_5',
      {
        qty_distributed_other: 'number',
        qty_distributed_kgs: 'number',
        qty_distributed_grams: 'number',
        qty_distributed_seedlings: 'number',
        qty_distributed_liters: 'number',
        qty_distributed_packets: 'number',
        qty_distributed_dozens: 'number',
        qty_distributed_sackets: 'number',
        qty_distributed_tins: 'number',
        qty_distributed_boxes: 'number',
        qty_distributed_pieces: 'number',
        qty_distributed_number: 'number',
        qty_distributed_kit: 'number',
        qty_distributed_meters: 'number',
        qty_distributed_hectare: 'number',
        qty_distributed_acre: 'number',
        qty_distributed_foot: 'number',
        distribution_date: 'date',
        submissionDate: 'date',
        updatedAt: 'date',
        dateCreated: 'date',
        lastUpdated: 'date',
      },
      { docId: 'unique_id' }
    ),
  },
  {
    key: 'participants_shg',
    label: 'participant_shg',
    filenameHints: ['participants_shg', 'participant_shg', 'participants shg'],
    dedupKey: '_id',
    columns: cols(
      '_id,participant_name,shg_participant_id,sex,shg_unit_received,shg_qty_received,shg_plot_size,__Submissions-id,shg_name,district,subcounty,dateCreated,lastUpdated,createdBy,shg_youth_profiles_view_shg_participant_id,phone_number,docId,partner,district_name,material_type,unit,distribution_date,participant_type,supplier,submitterName,submissionDate,other_shg_unit_received,shg_members_view_id,shg_members_view__id,parentId,subcounties_view__id,participants_shg_participant_id',
      {
        shg_qty_received: 'number',
        dateCreated: 'date',
        lastUpdated: 'date',
        distribution_date: 'date',
        submissionDate: 'date',
        phone_number: 'phone',
      },
      { docId: '__Submissions-id' }
    ),
  },
  {
    key: 'shg_group',
    label: 'shg_group',
    filenameHints: ['shg_group.csv', 'shg_group', 'shg group'],
    dedupKey: '_id',
    columns: cols(
      '_id,shg_name,shg_id,shg_group_unit_received,shg_group_qty_received,__Submissions-id,district,subcounty,dateCreated,lastUpdated,createdBy,shgs_view_shg_id,partner,district_name,material_type,unit,distribution_date,participant_type,supplier,submitterName,submissionDate,docId,other_shg_group_unit_received,shg_profiling_form_shg_id',
      {
        shg_group_qty_received: 'number',
        dateCreated: 'date',
        lastUpdated: 'date',
        distribution_date: 'date',
        submissionDate: 'date',
      },
      { docId: '__Submissions-id' }
    ),
  },
  {
    key: 'shg_profiling_form',
    label: 'shg_profiling_form',
    filenameHints: ['shg_profiling_form', 'shg profiling', 'profiling_form', 'profiling'],
    dedupKey: 'docId',
    columns: cols(
      'instructions,Participation_interview,shg_name,subcounty,subcounties_view_refID,subcounties_view__id,subcounty_refID,district,district_refID,Parish_name,Village_name,Assessment_date,contactperson,primay_contact,secondary_contact,Group_type,Grouptype_other,Group_registration,Registration_date,registration_level,group_owned_items,Meeting_frqy,Offered_services,offered_services_others,Group_enterprises,group_enterprise_other,Level_experience,sell_type,group_sells,group_sells_others,localseed_business,Major_owned_resources,Block_farming_potential,Org_support,NGO_Name,Needed_support,Profilers_name,Profilers_title,partner,profiling_date,Cluster_name,Corhort,agrihub,agrihub_registration_form_refID,agrihub_registration_form__id,createdBy,docId,refID,dateCreated,lastUpdated',
      {
        Assessment_date: 'date',
        Registration_date: 'date',
        profiling_date: 'date',
        dateCreated: 'date',
        lastUpdated: 'date',
        primay_contact: 'phone',
        secondary_contact: 'phone',
      }
    ),
  },
];

export const SCHEMA_BY_KEY: Record<string, SheetSchema> = Object.fromEntries(
  SCHEMAS.map((s) => [s.key, s])
);

/** Normalize a header token for fuzzy comparison. */
export function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/@odata_navigationlink/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}
