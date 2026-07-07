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
  // -------------------------------------------------------------------------
  // ISLA (SHGs SAVING IN A CLUSTER) master sheets. Imported from OData feeds.
  // -------------------------------------------------------------------------
  {
    // ISLA_DATA: the ISLA savings fact table.
    key: 'isla_form',
    label: 'isla_form',
    filenameHints: ['isla_form', 'isla form', 'isla_data', 'isla'],
    dedupKey: 'refID',
    columns: cols(
      'instructions,shg_name,registered_shgs_view_refID,registered_shgs_view__id,shg_id,shg_total,shg_total_females,shg_total_males,shg_total_pwds,group_saving,youth_group_saving,savings_value,youth_savings_value,total_fund,loans,loans_value_given,youth_loans_value_given,loans_value_repaid,outstanding_loan,loans_value_outstanding,social_fund,other_funds,balance,prepared,prepared_sign,certified,Certified_sign,reviewed,reviewed_sign,activity_date,createdBy,docId,refID,dateCreated,lastUpdated',
      {
        shg_total: 'int',
        shg_total_females: 'int',
        shg_total_males: 'int',
        shg_total_pwds: 'int',
        group_saving: 'int',
        youth_group_saving: 'int',
        savings_value: 'int',
        youth_savings_value: 'int',
        total_fund: 'int',
        loans: 'int',
        loans_value_given: 'int',
        youth_loans_value_given: 'int',
        loans_value_repaid: 'int',
        loans_value_outstanding: 'int',
        social_fund: 'int',
        other_funds: 'int',
        balance: 'int',
        activity_date: 'date',
        dateCreated: 'date',
        lastUpdated: 'date',
      }
    ),
  },
  {
    // ISLA_PARTICIPANTS: shg participants captured under the ISLA form.
    key: 'isla_participants',
    label: 'isla_form.shg_participants',
    filenameHints: ['isla_participants', 'isla_form.shg_participants', 'shg_participants'],
    dedupKey: 'refID',
    columns: cols(
      'participant_name,shg_members_view_refID,shg_members_view__id,shg_participant_id,sex,shg_disability,__Submissions-id,createdBy,docId,refID,dateCreated,lastUpdated',
      {
        dateCreated: 'date',
        lastUpdated: 'date',
      },
      { docId: '__Submissions-id' }
    ),
  },
  {
    // Profile: individual participant profiles (used for Dim_Profile).
    key: 'participants',
    label: 'participants',
    filenameHints: ['participants_odata', 'participant_profile', 'participants profile'],
    dedupKey: 'refID',
    columns: cols(
      'refID,First_name,Surname,district_name,Subcounty_name,Parish_name,Village_name,Disability_status,Cohort,Sex,tel_contact,name_ip,DOB,sme_name,mse_group_profiling_tool_refID,mse_group_profiling_tool__id,sme_id,shg_name,shg_profiling_form_refID,shg_profiling_form__id,shg_id,incubation_center,incubation_centers_refID,incubation_centers__id,incubation_center_id,createdBy,docId,deactivation_reason,dateCreated,lastUpdated',
      {
        DOB: 'date',
        dateCreated: 'date',
        lastUpdated: 'date',
        tel_contact: 'phone',
      }
    ),
  },
  {
    // youth profiling: youth profiling form (raw import, no transforms).
    key: 'youth_profiling',
    label: 'youth_profiling_form',
    filenameHints: ['youth_profiling', 'youth profiling', 'youth_profiling_form'],
    dedupKey: 'refID',
    columns: cols(
      'Informed_Consent,Youthwillingness_participate,profiles,name_ip,participant_type,district_name,Subcounty_name,shg_name,shg_id,group_does_following,sme_name,sme_id,incubation_center,incubation_center_id,datacollectors_Name,Title_datacollector,Date_profiliing,Student_status,active_students,Date_start,First_name,Middle_name,Surname,Preferred_name,Parish_name,Village_name,tel_contact,tel_contact2,Email,Sex,DOB,document,nin_no,Photo,Refugee_status,IDP_status,Youth_maritalstatus,Religion,hh_head,hh_head_Sex,hh_head_tel_contact,hh_head_DOB,Relationship_head_HH,No_female_HHmembers,No_male_HHmembers,Disability_status,Impairments,level_education,Participation_YAWs,Other_Participation_YAWs,Do_for_living,other_specify,Employment_status,Employment_type,Employment_sector,Land_ownership,Land_ownership_type,Agri_Enterprise_choices,others-specify,Business_idea,Businessidea_details,Products_idea,Operation_ideas,Resources_invest,Other_resources,Non_Agri_enterprise_choices,monthly_incomeestimate,saving,mode_saving,others_specify,consent_form_no,recommendation,reason,Cohort,createdBy,docId,refID,dateCreated,lastUpdated',
      {
        Date_profiliing: 'date',
        Date_start: 'date',
        DOB: 'date',
        hh_head_DOB: 'date',
        dateCreated: 'date',
        lastUpdated: 'date',
        tel_contact: 'phone',
        tel_contact2: 'phone',
        hh_head_tel_contact: 'phone',
      }
    ),
  },
  {
    // production_and_marketing_tool: master feed for the production &
    // marketing dashboards (Horticulture / Oil seeds / Poultry).
    key: 'production_and_marketing_tool',
    label: 'production_and_marketing_tool',
    filenameHints: ['production_and_marketing_tool', 'production and marketing', 'production_marketing'],
    dedupKey: 'refID',
    columns: cols(
      'instructions,ip_name,title_datacollector,other_title_datacollector,participant_type,participant_name,shg_participant_id,sme_participant,sme_participant_id,incubatee_participant,incubatee_participant_id,activity_date,district_name,subcounty_name,parish,village,value_chain,poultry,other_poultry,horticulture,other_horticulture,dairy,other_dairy,beef,other_beef,oil_seeds,other_oil_seeds,pdn_level,year,season,livestock_received,date_livestock_received,livestock_received_pic,livestock_received_gps,planting_status,acres,qty_seed,qty_seed_measure,date_received,qty_planted,qty_planted_measure,planting_date,germination_rate,estimate_yield,estimate_yield_measure,harvest_date,garden_gps,garden_pic,input_cost,other_input,land_hire,ploughing,seed,planting,fertilizers,weeding,harvest,agro_chemicals,other_input_cost,total_planting_production_cost,qty_harvested,qty_harvested_measure,qty_consumed,qty_wasted,qty_sold,sale,avg_price,total_planting_value,net_planting,cycle,qty_produced,poultry_sold,poultry_inputs,other_poultry_inputs,poultry_house,chicks,poultry_feeds,vaccination,disease_treatment,other,total_poultry_production_cost,poultry_consumed,poultry_wasted,avg_bird_price,total_poultry_value,net_poultry,milking_cows,milk_produced,milk_consumed,milk_wasted,milk_sold,dairy_inputs,other_dairy_inputs,cow_shelter,dairy_feeds,dairy_vaccinations,dairy_disease_treatment,dairy_other,total_dairy_production_cost,avg_dairy_price,total_dairy_value,net_dairy,animals_received,date_animals_received,animals_kept,meat_produced,meat_consumed,meat_wasted,meat_sold,beef_inputs,other_beef_inputs,beef_cow_shelter,beef_feeds,beef_vaccinations,beef_disease_treatment,beef_other,total_beef_production_cost,avg_beef_price,total_beef_value,net_beef,createdBy,docId,refID,dateCreated,lastUpdated',
      {
        activity_date: 'date',
        year: 'date',
        planting_date: 'date',
        harvest_date: 'date',
        dateCreated: 'date',
        lastUpdated: 'date',
        acres: 'number',
        qty_seed: 'int',
        qty_planted: 'int',
        total_planting_production_cost: 'int',
        qty_harvested: 'int',
        qty_consumed: 'int',
        qty_wasted: 'int',
        qty_sold: 'int',
        avg_price: 'int',
        total_planting_value: 'int',
        net_planting: 'int',
        qty_produced: 'int',
        poultry_sold: 'int',
        total_poultry_production_cost: 'int',
        poultry_consumed: 'int',
        poultry_wasted: 'int',
        avg_bird_price: 'int',
        total_poultry_value: 'int',
        net_poultry: 'int',
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
