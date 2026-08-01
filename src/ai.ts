// ---------------------------------------------------------------------------
// AI features for the SHG dashboard, powered by Cloudflare Workers AI.
//
//   1. askData()      — natural-language question -> generated read-only SQL
//                       against the Oracle VM (public.* fact tables) -> answer.
//   2. narrate()      — turn a report's KPI JSON into a short prose summary.
//   3. anomalies()    — compute week-over-week / expectation deltas across the
//                       core tables and have the model flag notable movements
//                       (the "AI Observation" tab).
//
// All model calls go through env.AI.run (no external key). SQL is strictly
// guarded: the model may only emit ONE read-only SELECT; we additionally
// re-validate and force a LIMIT before executing via neonQuery.
// ---------------------------------------------------------------------------

import type { Env } from './store';
import { neonQuery } from './store';

// Default model. Llama 3.3 70B (fast, instruction-following) on Workers AI.
// gpt-oss-120b is a strong alternative but 70B keeps neuron cost lower.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// --- schema catalog: the ground truth we give the model for NL->SQL ---------
// Only these tables/columns may be referenced. Kept deliberately compact and
// annotated so the model picks the right column without guessing.
export const SCHEMA_DOC = `You write PostgreSQL for a youth-development M&E database (SAYE Uganda / Heifer).
Only these tables and columns exist (all in schema public). Districts are stored
UPPERCASE (e.g. 'MAYUGE','IGANGA','JINJA','LUUKA'). Compare districts case-insensitively.

-- trainings (one row per trainee-training session; the real training sheet)
at_rows(data_collector text, participant_id text, group_id text, group_name text,
  training_type text, district text, day text /* YYYY-MM-DD as text */, sex text,
  is_pwd bigint 0/1, is_farming bigint 0/1, has_date bigint 0/1 /* 1 = an actual
  training happened; SUM(has_date) = youth trained */)

-- SHG profiling (one row per profiled group)
shg_profiling_rows(shg_id text, shg_name text, district text, subcounty text,
  male int, female int, pwd int, participants_trained int, total int /* youth in group */,
  trainings text, profiler_name text /* the CF */, group_status text, created_date date)

-- distribution of materials to participants
distribution_rows(participant_id text, participant_name text, shg_name text, district text,
  material_type text /* Livestock/Crop/Agri Resources/... */, livestock_type text,
  crop_type text, unit text, qty_received numeric, submitted_by text /* the CF */,
  is_pwd boolean, dist_date date)

-- horticulture / oil-seed sales
sales_rows(shg_participant_id text, participant_name text, activity_date date,
  district_name text, value_chain text, horticulture text, qty_harvested numeric,
  qty_harvested_measure text, total_planting_value numeric /* UGX sold */,
  profilers_name text /* the CF */, disability_status text)

-- poultry sales
poultry_sales_rows(shg_participant_id text, activity_date date, district_name text,
  poultry_sold numeric /* birds */, avg_bird_price numeric,
  total_poultry_value numeric /* UGX */, profilers_name text, disability_status text)

-- ISLA savings groups
isla_final_rows(shg_id text, shg_name text, shg_total int, group_saving int,
  youth_group_saving int, savings_value int /* UGX */, loans int,
  youth_loans_value_given int /* UGX */, activity_date date, profilers_name text,
  district_shg text)

-- production (horticulture/oil seeds/poultry)
production_rows(shg_participant_id text, activity_date date, district_name text,
  value_chain text, horticulture text, oil_seeds text, acres numeric,
  profilers_name text, shg_id text)

-- local leverage / co-financing contributions
local_leverage_rows(district text, subcounty text, type_of_contribution text,
  contribution_amount numeric /* UGX */, submitter_name text, partner text, date_created date)

-- items distributed that were not yet sold
items_not_sold_rows(participant_name text, district text, material_type text,
  crop_type text, value_chain text, qty_received numeric, has_sold text /* 'Yes'/'No' */,
  distribution_date date, submitted_by text)

-- youth job tracking / youth-in-work
job_tracking_rows(participant_id text, participant_name text, district text,
  interviewer text /* the CF */, status_before text, status_after text
  /* 'Employed' when in work */, employment_status text, value_chain text,
  total_income numeric, submission_date date)

RULES:
- The CF (Community Facilitator / frontliner) is profiler_name (profiling),
  profilers_name (sales/poultry/isla/production), submitted_by (distribution/items),
  interviewer (job tracking), data_collector (at_rows). Match names case-insensitively
  with ILIKE '%name%'.
- "youth trained" = SUM(has_date) or COUNT(*) FILTER (WHERE has_date=1) on at_rows.
- For "who trained the most youth" use at_rows GROUP BY data_collector; for a
  district filter use at_rows.district (upper()); do NOT join other tables for this.
- Always use ILIKE and lower()/upper() for text matching. Dates: at_rows.day is text
  'YYYY-MM-DD' (cast with ::date only when day <> '' ). For "last month" use
  day::date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'.
- Money columns are UGX. Keep queries simple and fast: prefer a single table,
  GROUP BY + ORDER BY + LIMIT; avoid CTEs and multi-table joins unless required.`;

// --- low-level model call ---------------------------------------------------
export async function callAI(
  env: Env,
  system: string,
  user: string,
  opts?: { max_tokens?: number; temperature?: number }
): Promise<string> {
  if (!env.AI) throw new Error('AI binding not available in this environment');
  const res: any = await env.AI.run(MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: opts?.max_tokens ?? 700,
    temperature: opts?.temperature ?? 0.2,
  });
  // Workers AI returns { response: "..." } for chat models.
  const out = (res && (res.response ?? res.result?.response ?? res.output)) || '';
  return String(out).trim();
}

// --- SQL safety guard -------------------------------------------------------
// Strip markdown fences, keep a single statement, forbid anything that writes
// or reads outside the whitelisted tables, and force a LIMIT.
const ALLOWED_TABLES = [
  'at_rows', 'shg_profiling_rows', 'distribution_rows', 'sales_rows',
  'poultry_sales_rows', 'isla_final_rows', 'production_rows',
  'local_leverage_rows', 'items_not_sold_rows', 'job_tracking_rows',
];
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do|vacuum|analyze|comment|reindex|refresh|pg_|information_schema|current_setting|set\s|;\s*\S)/i;

export function sanitizeSql(raw: string): { sql: string } | { error: string } {
  let s = String(raw || '').trim();
  // pull SQL out of a ```sql ... ``` fence if present
  const fence = s.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // if the model prepended prose, grab from the first SELECT/WITH
  const m = s.match(/\b(with|select)\b[\s\S]*/i);
  if (m) s = m[0].trim();
  s = s.replace(/;+\s*$/, '').trim(); // drop trailing semicolons
  if (!/^\s*(select|with)\b/i.test(s)) return { error: 'Only SELECT queries are allowed.' };
  if (/;/.test(s)) return { error: 'Only a single statement is allowed.' };
  if (FORBIDDEN.test(s)) return { error: 'Query contains a forbidden keyword.' };
  // must reference at least one allowed table and no obviously foreign ones
  const lower = s.toLowerCase();
  if (!ALLOWED_TABLES.some((t) => lower.includes(t))) {
    return { error: 'Query does not reference a known table.' };
  }
  // force a LIMIT so a runaway query can't blow the Worker budget
  if (!/\blimit\s+\d+/i.test(s)) s += ' LIMIT 200';
  else s = s.replace(/\blimit\s+(\d+)/i, (_m, n) => 'LIMIT ' + Math.min(Number(n) || 200, 1000));
  return { sql: s };
}

// --- 1. Ask your data -------------------------------------------------------
export interface AskResult {
  question: string;
  sql: string;
  rows: any[];
  answer: string;
  error?: string;
}

export async function askData(env: Env, question: string): Promise<AskResult> {
  const q = String(question || '').trim();
  if (!q) return { question: q, sql: '', rows: [], answer: '', error: 'Empty question.' };

  // Step 1: NL -> SQL
  const sqlRaw = await callAI(
    env,
    SCHEMA_DOC +
      '\n\nReturn ONLY one PostgreSQL SELECT query answering the user question. ' +
      'No explanation, no markdown. Always add a sensible LIMIT (<=1000). ' +
      'Prefer aggregates (COUNT/SUM) and GROUP BY over raw dumps.',
    q,
    { max_tokens: 400, temperature: 0.1 }
  );
  const guard = sanitizeSql(sqlRaw);
  if ('error' in guard) {
    return { question: q, sql: sqlRaw, rows: [], answer: '', error: guard.error };
  }

  // Step 2: execute
  let rows: any[] = [];
  try {
    rows = await neonQuery(env, guard.sql);
  } catch (e: any) {
    return { question: q, sql: guard.sql, rows: [], answer: '', error: 'Query failed: ' + String(e?.message || e) };
  }

  // Step 3: SQL result -> plain-English answer
  const sample = JSON.stringify(rows.slice(0, 40));
  const answer = await callAI(
    env,
    'You are a data analyst for a youth-development programme. Given a question and ' +
      'the SQL result rows (JSON), answer in 1-3 concise sentences with the key ' +
      'numbers. Do not invent data; use only the rows. If rows are empty, say no ' +
      'matching data was found.',
    `Question: ${q}\nResult rows: ${sample}`,
    { max_tokens: 220, temperature: 0.3 }
  );

  return { question: q, sql: guard.sql, rows, answer };
}

// --- 2. Report narrative ----------------------------------------------------
export async function narrate(env: Env, reportName: string, kpis: any): Promise<string> {
  const body = JSON.stringify(kpis).slice(0, 6000);
  return callAI(
    env,
    'You are the M&E lead for SAYE Uganda (a youth livelihoods programme by Heifer). ' +
      'Write a short, professional executive summary (2 short paragraphs, no bullet ' +
      'lists, no headers) of the ' + reportName + ' below. Reference concrete figures ' +
      'from the data, note where the programme is strong and where attention is needed. ' +
      'Do not invent numbers that are not present.',
    'Report data (JSON):\n' + body,
    { max_tokens: 500, temperature: 0.4 }
  );
}

// --- 3. Anomaly detection (AI Observation) ----------------------------------
// We compute deterministic week-over-week deltas per metric in SQL, then ask
// the model to interpret and prioritise them into a readable digest. This keeps
// the numbers trustworthy (computed, not hallucinated) while the AI adds the
// narrative + severity.

export interface AnomalySignal {
  metric: string;
  scope: string;         // district / CF / overall
  current: number;
  previous: number;
  delta_pct: number | null;
  note?: string;
}

// Build the raw signals with SQL. Compares the last 7 days vs the prior 7 days.
async function computeSignals(env: Env): Promise<AnomalySignal[]> {
  const signals: AnomalySignal[] = [];
  const pct = (cur: number, prev: number): number | null =>
    prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 1000) / 10;

  // Helper to run one "current 7d vs previous 7d" total for a table/date/value.
  const wow = async (
    label: string,
    table: string,
    dateExpr: string,
    valueExpr: string
  ): Promise<void> => {
    const sql = `
      SELECT
        COALESCE(SUM(CASE WHEN ${dateExpr} >= CURRENT_DATE - INTERVAL '7 days' THEN ${valueExpr} ELSE 0 END),0)::numeric AS cur,
        COALESCE(SUM(CASE WHEN ${dateExpr} >= CURRENT_DATE - INTERVAL '14 days'
                       AND ${dateExpr} <  CURRENT_DATE - INTERVAL '7 days' THEN ${valueExpr} ELSE 0 END),0)::numeric AS prev
      FROM ${table}`;
    try {
      const r = (await neonQuery(env, sql))[0] || {};
      const cur = Number(r.cur) || 0, prev = Number(r.prev) || 0;
      if (cur === 0 && prev === 0) return; // nothing happening either week
      signals.push({ metric: label, scope: 'overall', current: cur, previous: prev, delta_pct: pct(cur, prev) });
    } catch { /* table may lag; skip */ }
  };

  await wow('Youth trained', 'at_rows', "NULLIF(day,'')::date", 'has_date');
  await wow('SHGs profiled', 'shg_profiling_rows', 'created_date', '1');
  await wow('Distribution lines', 'distribution_rows', 'dist_date', '1');
  await wow('Horticulture sales (UGX)', 'sales_rows', 'activity_date', 'total_planting_value');
  await wow('Poultry sales (UGX)', 'poultry_sales_rows', 'activity_date', 'total_poultry_value');
  await wow('Local leverage (UGX)', 'local_leverage_rows', 'date_created', 'contribution_amount');
  await wow('ISLA savings (UGX)', 'isla_final_rows', 'activity_date', 'savings_value');
  await wow('Youth employed (job tracking)', 'job_tracking_rows', 'submission_date',
    "CASE WHEN status_after='Employed' THEN 1 ELSE 0 END");

  // Per-district training drops (the most actionable signal for field teams).
  try {
    const dsql = `
      WITH cur AS (
        SELECT upper(district) d, SUM(has_date)::numeric v FROM at_rows
        WHERE NULLIF(day,'') IS NOT NULL AND day::date >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY 1),
      prev AS (
        SELECT upper(district) d, SUM(has_date)::numeric v FROM at_rows
        WHERE NULLIF(day,'') IS NOT NULL AND day::date >= CURRENT_DATE - INTERVAL '14 days'
          AND day::date < CURRENT_DATE - INTERVAL '7 days'
        GROUP BY 1)
      SELECT COALESCE(cur.d,prev.d) d, COALESCE(cur.v,0) cur, COALESCE(prev.v,0) prev
      FROM cur FULL OUTER JOIN prev ON cur.d=prev.d
      WHERE COALESCE(cur.v,0)+COALESCE(prev.v,0) > 0
      ORDER BY (COALESCE(prev.v,0)-COALESCE(cur.v,0)) DESC LIMIT 6`;
    const rows = await neonQuery(env, dsql);
    for (const r of rows) {
      const cur = Number(r.cur) || 0, prev = Number(r.prev) || 0;
      signals.push({ metric: 'Youth trained', scope: String(r.d || '—'), current: cur, previous: prev, delta_pct: pct(cur, prev) });
    }
  } catch { /* skip */ }

  return signals;
}

export interface ObservationResult {
  generated_at: string;
  window: string;
  signals: AnomalySignal[];
  digest: string;
  error?: string;
}

export async function anomalies(env: Env): Promise<ObservationResult> {
  const generated_at = new Date().toISOString();
  const window = 'Last 7 days vs previous 7 days';
  let signals: AnomalySignal[] = [];
  try {
    signals = await computeSignals(env);
  } catch (e: any) {
    return { generated_at, window, signals: [], digest: '', error: String(e?.message || e) };
  }
  if (!signals.length) {
    return { generated_at, window, signals, digest: 'No activity recorded in either week — nothing to flag.' };
  }
  let digest = '';
  try {
    digest = await callAI(
      env,
      'You are the M&E analyst for SAYE Uganda. Below are computed week-over-week ' +
        'changes (already accurate — do not change the numbers). Write a brief ' +
        'observation digest: list the 3-6 most important movements as short bullet ' +
        'lines, each starting with an arrow (up/down) word, the metric, the scope, and ' +
        'the % change, then one clause of likely implication or action. Flag large ' +
        'drops (worse) and large rises (good) distinctly. Keep it under 180 words. ' +
        'A null % means the previous period was zero (new activity).',
      'Signals (JSON):\n' + JSON.stringify(signals),
      { max_tokens: 500, temperature: 0.35 }
    );
  } catch (e: any) {
    digest = '(AI digest unavailable: ' + String(e?.message || e) + ')';
  }
  return { generated_at, window, signals, digest };
}
