// ---------------------------------------------------------------------------
// Programme Report data builder.
//
// Produces every auto-fillable figure for the SAYE Monthly/Quarterly Progress
// Report (Heifer Programme Report.docx template). The template's data tables all
// share the same shape: District rows (Iganga / Jinja / Mayuge / Luuka + Overall
// total) with a MONTH block and a QUARTER block.
//
// programmeReport() runs the district-breakdown queries for TWO windows:
//   - the month window (from / to)
//   - the quarter window (qFrom / qTo)
// and returns a structured object the /programme-report page turns into a Word doc.
//
// All district matching is case-insensitive (rows are stored in mixed casing:
// at_rows UPPERCASE, shg_profiling_rows Title Case, isla district_shg Title Case).
// ---------------------------------------------------------------------------
import { neonQuery, type Env } from './store';

export interface ProgFilters {
  districts?: string[]; // e.g. ['IGANGA','JINJA','MAYUGE','LUUKA']
  from?: string;        // month start  YYYY-MM-DD
  to?: string;          // month end
  qFrom?: string;       // quarter start
  qTo?: string;         // quarter end
}

// Canonical training_type strings in at_rows (see data audit).
export const TT = {
  vbhcd: ['VBHCD', 'VBHCD Model', 'MSE Group dynamics and mindset change'],
  gender: ['Gender and safeguarding'],
  nutrition: ['Nutrition training'],
  social: ['Social perception change training'],
  life: ['Life skill training'],
  mental: ['Mental Health and Wellness training'],
  srh: ['Sexual Reproductive Health and Rights (SRHR) training'],
  isla: ['informal Saving and Lending Association'],
  animal: ['Animal management'],
  crop: ['Crop management'],
} as const;

type Row = Record<string, any>;
const num = (v: any) => Number(v || 0);

// --- generic per-district breakdown of at_rows for a training-type set --------
async function trainingByDistrict(
  env: Env,
  types: string[],
  districts: string[],
  from?: string,
  to?: string
): Promise<Row[]> {
  const params: any[] = [types.map((t) => t.toUpperCase())];
  let where = `WHERE upper(training_type) = ANY($1::text[])`;
  if (districts.length) {
    params.push(districts.map((d) => d.toUpperCase()));
    where += ` AND upper(trim(district)) = ANY($${params.length}::text[])`;
  }
  if (from) { params.push(from); where += ` AND day >= $${params.length}`; }
  if (to)   { params.push(to);   where += ` AND day <= $${params.length}`; }
  const sql = `
    SELECT upper(trim(district)) AS district,
           COUNT(DISTINCT participant_id)                                             AS youth,
           COUNT(DISTINCT CASE WHEN sex='Female' THEN participant_id END)             AS female,
           COUNT(DISTINCT CASE WHEN is_pwd=1 THEN participant_id END)                 AS pwd
    FROM at_rows
    ${where} AND participant_id IS NOT NULL
    GROUP BY 1`;
  return neonQuery(env, sql, params);
}

// --- profiling / group formation (shg_profiling_rows) -------------------------
async function profilingByDistrict(
  env: Env, districts: string[], from?: string, to?: string
): Promise<Row[]> {
  const params: any[] = [];
  let where = 'WHERE 1=1';
  if (districts.length) {
    params.push(districts.map((d) => d.toUpperCase()));
    where += ` AND upper(trim(district)) = ANY($${params.length}::text[])`;
  }
  if (from) { params.push(from); where += ` AND created_date >= $${params.length}::date`; }
  if (to)   { params.push(to);   where += ` AND created_date <= $${params.length}::date`; }
  const sql = `
    SELECT upper(trim(district)) AS district,
           COUNT(DISTINCT shg_id) AS shgs,
           COALESCE(SUM(total),0) AS youth,
           COALESCE(SUM(female),0) AS female,
           COALESCE(SUM(pwd),0)   AS pwd
    FROM shg_profiling_rows
    ${where}
    GROUP BY 1`;
  return neonQuery(env, sql, params);
}

// --- horticulture harvest & sales (sales_rows) --------------------------------
async function horticultureByDistrict(
  env: Env, districts: string[], from?: string, to?: string
): Promise<Row[]> {
  const params: any[] = [];
  let where = `WHERE lower(coalesce(value_chain,''))='horticulture'`;
  if (districts.length) {
    params.push(districts.map((d) => d.toUpperCase()));
    where += ` AND upper(trim(district_name)) = ANY($${params.length}::text[])`;
  }
  if (from) { params.push(from); where += ` AND activity_date >= $${params.length}::date`; }
  if (to)   { params.push(to);   where += ` AND activity_date <= $${params.length}::date`; }
  const sql = `
    SELECT upper(trim(district_name)) AS district,
           COALESCE(SUM(CASE WHEN lower(horticulture) LIKE '%tomato%'     AND qty_harvested_measure='KGs'    THEN qty_harvested END),0) AS tomatoes_kg,
           COALESCE(SUM(CASE WHEN lower(horticulture) LIKE '%watermelon%' AND qty_harvested_measure='Pieces' THEN qty_harvested END),0) AS watermelon_pcs,
           COALESCE(SUM(total_planting_value),0) AS sales
    FROM sales_rows
    ${where}
    GROUP BY 1`;
  return neonQuery(env, sql, params);
}

// --- poultry / goat distribution (distribution_rows) --------------------------
async function livestockDistByDistrict(
  env: Env, kind: 'poultry' | 'goat', districts: string[], from?: string, to?: string
): Promise<Row[]> {
  const like = kind === 'poultry' ? 'Poultry%' : 'Goat%';
  const params: any[] = [like];
  let where = `WHERE livestock_type LIKE $1`;
  if (districts.length) {
    params.push(districts.map((d) => d.toUpperCase()));
    where += ` AND upper(trim(district)) = ANY($${params.length}::text[])`;
  }
  if (from) { params.push(from); where += ` AND dist_date >= $${params.length}::date`; }
  if (to)   { params.push(to);   where += ` AND dist_date <= $${params.length}::date`; }
  const sql = `
    SELECT upper(trim(district)) AS district,
           COALESCE(SUM(qty_received),0) AS animals,
           COUNT(DISTINCT shg_name)      AS shgs,
           COUNT(DISTINCT participant_id) AS youth
    FROM distribution_rows
    ${where}
    GROUP BY 1`;
  return neonQuery(env, sql, params);
}

// --- poultry sales (poultry_sales_rows) ---------------------------------------
async function poultrySalesByDistrict(
  env: Env, districts: string[], from?: string, to?: string
): Promise<Row[]> {
  const params: any[] = [];
  let where = `WHERE 1=1`;
  if (districts.length) {
    params.push(districts.map((d) => d.toUpperCase()));
    where += ` AND upper(trim(district_name)) = ANY($${params.length}::text[])`;
  }
  if (from) { params.push(from); where += ` AND activity_date >= $${params.length}::date`; }
  if (to)   { params.push(to);   where += ` AND activity_date <= $${params.length}::date`; }
  const sql = `
    SELECT upper(trim(district_name)) AS district,
           COUNT(DISTINCT shg_name)          AS shgs,
           COUNT(DISTINCT shg_participant_id) AS youth,
           COALESCE(SUM(poultry_sold),0)      AS birds,
           COALESCE(SUM(total_poultry_value),0) AS amount
    FROM poultry_sales_rows
    ${where}
    GROUP BY 1`;
  return neonQuery(env, sql, params);
}

// --- ISLA savings (isla_final_rows) -------------------------------------------
async function islaByDistrict(
  env: Env, districts: string[], from?: string, to?: string
): Promise<Row[]> {
  const params: any[] = [];
  let where = `WHERE 1=1`;
  if (districts.length) {
    params.push(districts.map((d) => d.toUpperCase()));
    where += ` AND upper(trim(district_shg)) = ANY($${params.length}::text[])`;
  }
  if (from) { params.push(from); where += ` AND activity_date >= $${params.length}::date`; }
  if (to)   { params.push(to);   where += ` AND activity_date <= $${params.length}::date`; }
  const sql = `
    SELECT upper(trim(district_shg)) AS district,
           COALESCE(SUM(youth_group_saving),0) AS savers,
           COALESCE(SUM(savings_value),0)      AS saved,
           COALESCE(SUM(loans_value_given),0)  AS loans
    FROM isla_final_rows
    ${where}
    GROUP BY 1`;
  return neonQuery(env, sql, params);
}

// --- local leverage total -----------------------------------------------------
async function leverageTotal(
  env: Env, districts: string[], from?: string, to?: string
): Promise<number> {
  const params: any[] = [];
  let where = `WHERE 1=1`;
  if (districts.length) {
    params.push(districts.map((d) => d.toUpperCase()));
    where += ` AND upper(trim(district)) = ANY($${params.length}::text[])`;
  }
  if (from) { params.push(from); where += ` AND date_created >= $${params.length}::date`; }
  if (to)   { params.push(to);   where += ` AND date_created <= $${params.length}::date`; }
  const rows = await neonQuery(env, `SELECT COALESCE(SUM(contribution_amount),0) AS amt FROM local_leverage_rows ${where}`, params);
  return num(rows[0]?.amt);
}

// index a district-breakdown result by uppercase district name
function indexByDistrict(rows: Row[]): Record<string, Row> {
  const m: Record<string, Row> = {};
  for (const r of rows) m[String(r.district || '').toUpperCase()] = r;
  return m;
}

// Build a month+quarter block for a training-type table.
async function trainingBlock(env: Env, types: string[], f: ProgFilters) {
  const [m, q] = await Promise.all([
    trainingByDistrict(env, types, f.districts || [], f.from, f.to),
    trainingByDistrict(env, types, f.districts || [], f.qFrom, f.qTo),
  ]);
  return { month: indexByDistrict(m), quarter: indexByDistrict(q) };
}

/**
 * Main entry: returns every auto-fill figure for the report, keyed by table.
 * Districts default to the Iganga cluster four (matching the template).
 */
export async function programmeReport(env: Env, f: ProgFilters): Promise<any> {
  const districts = (f.districts && f.districts.length)
    ? f.districts
    : ['IGANGA', 'JINJA', 'MAYUGE', 'LUUKA'];
  const opt = { ...f, districts };

  const [
    profM, profQ,
    vbhcd, gender, nutrition, social, life, mental, srh, animal, crop, islaTrain,
    hortM, hortQ,
    poultryDistM, poultryDistQ, goatDistM, goatDistQ,
    poultrySalesM, poultrySalesQ,
    islaM, islaQ,
    levM, levQ,
  ] = await Promise.all([
    profilingByDistrict(env, districts, f.from, f.to),
    profilingByDistrict(env, districts, f.qFrom, f.qTo),
    trainingBlock(env, [...TT.vbhcd], opt),
    trainingBlock(env, [...TT.gender], opt),
    trainingBlock(env, [...TT.nutrition], opt),
    trainingBlock(env, [...TT.social], opt),
    trainingBlock(env, [...TT.life], opt),
    trainingBlock(env, [...TT.mental], opt),
    trainingBlock(env, [...TT.srh], opt),
    trainingBlock(env, [...TT.animal], opt),
    trainingBlock(env, [...TT.crop], opt),
    trainingBlock(env, [...TT.isla], opt),
    horticultureByDistrict(env, districts, f.from, f.to),
    horticultureByDistrict(env, districts, f.qFrom, f.qTo),
    livestockDistByDistrict(env, 'poultry', districts, f.from, f.to),
    livestockDistByDistrict(env, 'poultry', districts, f.qFrom, f.qTo),
    livestockDistByDistrict(env, 'goat', districts, f.from, f.to),
    livestockDistByDistrict(env, 'goat', districts, f.qFrom, f.qTo),
    poultrySalesByDistrict(env, districts, f.from, f.to),
    poultrySalesByDistrict(env, districts, f.qFrom, f.qTo),
    islaByDistrict(env, districts, f.from, f.to),
    islaByDistrict(env, districts, f.qFrom, f.qTo),
    leverageTotal(env, districts, f.from, f.to),
    leverageTotal(env, districts, f.qFrom, f.qTo),
  ]);

  return {
    districts,
    window: { from: f.from, to: f.to, qFrom: f.qFrom, qTo: f.qTo },
    profiling: { month: indexByDistrict(profM), quarter: indexByDistrict(profQ) },
    training: { vbhcd, gender, nutrition, social, life, mental, srh, animal, crop, isla: islaTrain },
    horticulture: { month: indexByDistrict(hortM), quarter: indexByDistrict(hortQ) },
    poultryDist: { month: indexByDistrict(poultryDistM), quarter: indexByDistrict(poultryDistQ) },
    goatDist: { month: indexByDistrict(goatDistM), quarter: indexByDistrict(goatDistQ) },
    poultrySales: { month: indexByDistrict(poultrySalesM), quarter: indexByDistrict(poultrySalesQ) },
    isla: { month: indexByDistrict(islaM), quarter: indexByDistrict(islaQ) },
    leverage: { month: levM, quarter: levQ },
  };
}
