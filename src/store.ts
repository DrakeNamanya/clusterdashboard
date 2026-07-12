// ---------------------------------------------------------------------------
// Supabase (Postgres/PostgREST) storage layer.
// Replaces the Cloudflare D1 backend. All cleaned records live in one table
// `public.records` (template, dedup_key, seq, source_file, data JSONB) with a
// UNIQUE (template, dedup_key) constraint. Appends upsert with
// `Prefer: resolution=ignore-duplicates` so re-uploads never duplicate.
//
// Postgres has no per-request statement/parameter limits like D1, so large
// bulk inserts go through in a single request — fixing the HTTP 503 problems.
// ---------------------------------------------------------------------------

import { SheetSchema } from './schemas';
import { neon } from '@neondatabase/serverless';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  // Neon (Postgres) — serves Cluster-2 dashboards (Production, Sales, ISLA,
  // SHG Profiling, Distribution, SHG Distribution). These tables JOIN together
  // and are disconnected from the Frontliners cluster (all_trainees_view), which
  // stays on Supabase. Splitting the heavy JOIN work off Supabase stops the
  // nano-instance crashes.
  NEON_DATABASE_URL?: string;
}

/** Fast, stable string hash (FNV-1a, 32-bit hex) for composite dedup keys. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

/** Compute the effective dedup key for a cleaned record (same rule as before). */
export function dedupKeyFor(schema: SheetSchema, rec: Record<string, string>): string {
  if (schema.dedupCols && schema.dedupCols.length) {
    const joined = schema.dedupCols.map((c) => (rec[c] ?? '').trim()).join('\u0001');
    return 'h:' + fnv1a(joined);
  }
  const key = (rec[schema.dedupKey] ?? '').trim();
  if (key) return key;
  const all = schema.columns.map((c) => (rec[c.name] ?? '').trim()).join('\u0001');
  return 'h:' + fnv1a(all);
}

// --- Low-level PostgREST helpers -------------------------------------------

function restBase(env: Env): string {
  return env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1';
}

function headers(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Neon (Postgres) layer — serves the Cluster-2 dashboards. The tables here
// (participants, production_and_marketing_tool, shg_profiling_form, isla_form,
// shg groups, participants_shg) JOIN together and are disconnected from the
// Frontliners cluster (all_trainees_view) which remains on Supabase. Neon has
// no PostgREST, so we talk to it with the serverless HTTP SQL driver (works on
// Cloudflare Workers). All PL/pgSQL functions applied to Neon are identical to
// the Supabase ones, so we just invoke them via `select fn(...)`.
// ---------------------------------------------------------------------------

/**
 * Templates whose records live in Neon (the Cluster-2 join graph). Everything
 * else (all_trainees_view = Frontliners/New Youth/Cluster) stays on Supabase.
 * If NEON_DATABASE_URL is unset, all templates fall back to Supabase.
 */
const NEON_TEMPLATES = new Set<string>([
  'participants',
  'production_and_marketing_tool',
  'shg_profiling_form',
  'isla_form',
  'shg_groups_view',
  'shg_group',
  'participants_shg',
  'distribution_form_v2',
]);

/** True when this template's records should be stored/queried on Neon. */
function usesNeon(env: Env, template: string): boolean {
  return !!env.NEON_DATABASE_URL && NEON_TEMPLATES.has(template);
}

/** Returns a tagged-template SQL runner bound to the Neon connection. */
function neonSql(env: Env) {
  if (!env.NEON_DATABASE_URL) {
    throw new Error('NEON_DATABASE_URL is not configured');
  }
  // fetchConnectionCache keeps the HTTP connection warm across queries in a
  // single request; fullResults=false returns plain row arrays from .query().
  return neon(env.NEON_DATABASE_URL);
}

/**
 * Run a Neon query with retry/backoff. Neon's free tier scales the compute to
 * zero when idle, so the first query after idle can fail or time out while the
 * instance wakes (~1-5s). Retrying with backoff turns those transient failures
 * into a successful (if slightly slow) response instead of an HTTP 503.
 */
async function neonQuery(
  env: Env,
  text: string,
  params: any[] = [],
  tries = 5
): Promise<any[]> {
  const sql = neonSql(env);
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return (await sql.query(text, params)) as any[];
    } catch (e) {
      last = e;
      // Backoff: 0.4s, 0.8s, 1.6s, 3.2s — enough for a cold Neon compute to wake.
      if (i < tries) {
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, i - 1)));
      }
    }
  }
  throw last instanceof Error ? last : new Error('Neon query failed');
}

/**
 * Call a jsonb-returning Postgres function on Neon and return the parsed value.
 * Mirrors the PostgREST `/rpc/<fn>` behaviour used for Supabase. Positional
 * params are passed via `neonQuery(text, params)` so array/date args bind
 * correctly (text[] via $n::text[]).
 */
async function neonRpcJson(
  env: Env,
  fn: string,
  argSql: string,
  params: any[]
): Promise<any> {
  const text = `select ${fn}(${argSql}) as result`;
  const rows = await neonQuery(env, text, params);
  const val = rows && rows.length ? rows[0].result : null;
  // Neon returns jsonb already parsed to JS objects.
  return val;
}

/** Call a scalar-returning Neon function (e.g. refresh_* returns integer). */
async function neonRpcScalar(
  env: Env,
  fn: string,
  argSql = '',
  params: any[] = []
): Promise<number> {
  const text = `select ${fn}(${argSql}) as result`;
  const rows = await neonQuery(env, text, params);
  return rows && rows.length ? Number(rows[0].result) : 0;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < tries) await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
  throw last;
}

export interface AppendResult {
  inserted: number;
  duplicatesSkipped: number;
  total: number;
}

/**
 * Append cleaned records with append-only de-duplication via
 * UNIQUE (template, dedup_key) + ignore-duplicates upsert.
 * Because we ignore duplicates, PostgREST returns only the rows actually
 * inserted (when we ask for representation), giving an exact inserted count.
 */
export async function appendRecords(
  env: Env,
  schema: SheetSchema,
  records: Record<string, string>[],
  sourceFile: string
): Promise<AppendResult> {
  if (!records.length) return { inserted: 0, duplicatesSkipped: 0, total: 0 };

  // Route Cluster-2 templates to Neon; Frontliners cluster stays on Supabase.
  if (usesNeon(env, schema.key)) {
    return appendRecordsNeon(env, schema, records, sourceFile);
  }

  const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
  const seqName = seqIdx >= 0 ? schema.columns[seqIdx].name : null;

  // De-duplicate within this batch (Postgres upsert also rejects intra-batch dup keys).
  const seen = new Set<string>();
  const rows: any[] = [];
  for (const rec of records) {
    const dk = dedupKeyFor(schema, rec);
    if (seen.has(dk)) continue;
    seen.add(dk);
    const seq = seqName ? Number(rec[seqName]) || null : null;
    rows.push({
      template: schema.key,
      dedup_key: dk,
      seq,
      source_file: sourceFile,
      data: rec,
    });
  }

  const url =
    restBase(env) +
    '/records?on_conflict=template,dedup_key';

  const res = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: headers(env, {
        // ignore-duplicates => existing (template,dedup_key) rows are skipped.
        Prefer: 'resolution=ignore-duplicates,return=representation,count=exact',
      }),
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Supabase insert failed (${r.status}): ${t.slice(0, 300)}`);
    }
    return r;
  });

  // Rows actually inserted are returned in the body (ignored duplicates omitted).
  let inserted = 0;
  try {
    const body = (await res.json()) as any[];
    inserted = Array.isArray(body) ? body.length : 0;
  } catch {
    inserted = 0;
  }
  const dup = records.length - inserted;
  return { inserted, duplicatesSkipped: dup < 0 ? 0 : dup, total: records.length };
}

/**
 * Neon variant of appendRecords: bulk upsert into the same `records` table on
 * Neon using `insert ... on conflict (template, dedup_key) do nothing`. Rows
 * are batched via a single parameterized multi-row insert per call. Returns the
 * exact inserted count from `RETURNING`.
 */
async function appendRecordsNeon(
  env: Env,
  schema: SheetSchema,
  records: Record<string, string>[],
  sourceFile: string
): Promise<AppendResult> {
  const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
  const seqName = seqIdx >= 0 ? schema.columns[seqIdx].name : null;

  // De-duplicate within this batch (unique index also rejects intra-batch dups).
  const seen = new Set<string>();
  const rows: { template: string; dedup_key: string; seq: number | null; source_file: string; data: string }[] = [];
  for (const rec of records) {
    const dk = dedupKeyFor(schema, rec);
    if (seen.has(dk)) continue;
    seen.add(dk);
    const seq = seqName ? Number(rec[seqName]) || null : null;
    rows.push({
      template: schema.key,
      dedup_key: dk,
      seq,
      source_file: sourceFile,
      data: JSON.stringify(rec),
    });
  }
  if (!rows.length) {
    return { inserted: 0, duplicatesSkipped: records.length, total: records.length };
  }

  const sql = neonSql(env);
  // Insert in chunks to stay under parameter limits (5 params/row).
  const CHUNK = 400;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: any[] = [];
    chunk.forEach((row, idx) => {
      const b = idx * 5;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb)`);
      params.push(row.template, row.dedup_key, row.seq, row.source_file, row.data);
    });
    const text =
      `insert into public.records (template, dedup_key, seq, source_file, data) values ` +
      values.join(', ') +
      ` on conflict (template, dedup_key) do nothing returning 1`;
    const res = (await sql.query(text, params)) as any[];
    inserted += Array.isArray(res) ? res.length : 0;
  }
  const dup = records.length - inserted;
  return { inserted, duplicatesSkipped: dup < 0 ? 0 : dup, total: records.length };
}

/** Max value of the seq (`No`) column so appends continue the sequence. */
export async function maxSeq(env: Env, schema: SheetSchema): Promise<number> {
  const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
  if (seqIdx < 0) return 0;

  // Route to Neon for Cluster-2 templates.
  if (usesNeon(env, schema.key)) {
    const sql = neonSql(env);
    const rows = (await sql.query(
      `select max(seq) as m from public.records where template = $1`,
      [schema.key]
    )) as any[];
    const m = rows && rows.length ? rows[0].m : null;
    return m ? Number(m) : 0;
  }

  const url =
    restBase(env) +
    `/records?template=eq.${encodeURIComponent(schema.key)}&select=seq&order=seq.desc.nullslast&limit=1`;
  const r = await fetch(url, { headers: headers(env) });
  if (!r.ok) return 0;
  const body = (await r.json()) as { seq: number | null }[];
  return body.length && body[0].seq ? body[0].seq : 0;
}

export interface QueryOpts {
  top?: number;
  skip?: number;
  orderBy?: string;
  desc?: boolean;
}

/** Query rows for a template, returning target-named records + total count. */
export async function queryRecords(
  env: Env,
  schema: SheetSchema,
  opts: QueryOpts = {}
): Promise<{ rows: Record<string, string>[]; count: number }> {
  const top = Math.min(Math.max(opts.top ?? 1000, 0), 50000);
  const skip = Math.max(opts.skip ?? 0, 0);

  // Order: by seq if the schema has one, else by id (ingest order).
  const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
  let order = seqIdx >= 0 ? 'seq' : 'id';
  let dir = opts.desc ? 'desc' : 'asc';

  // Route Cluster-2 templates to Neon.
  if (usesNeon(env, schema.key)) {
    const sql = neonSql(env);
    let orderExpr: string;
    if (opts.orderBy && schema.columns.some((c) => c.name === opts.orderBy)) {
      // orderBy is validated against schema column names above (no injection).
      orderExpr = `data->>'${opts.orderBy.replace(/'/g, "''")}'`;
    } else {
      orderExpr = order; // 'seq' or 'id'
    }
    const dirSql = dir === 'desc' ? 'desc nulls last' : 'asc';
    const dataRows = (await sql.query(
      `select data from public.records where template = $1 ` +
        `order by ${orderExpr} ${dirSql} limit $2 offset $3`,
      [schema.key, top, skip]
    )) as any[];
    const cntRows = (await sql.query(
      `select count(*)::int as c from public.records where template = $1`,
      [schema.key]
    )) as any[];
    const count = cntRows && cntRows.length ? Number(cntRows[0].c) : 0;
    const rows = (dataRows || []).map((b: any) => {
      const d = b.data || {};
      const out: Record<string, string> = {};
      for (const c of schema.columns) out[c.name] = d[c.name] ?? '';
      return out;
    });
    return { rows, count };
  }

  // Custom orderby by a data column -> order by data->>col
  let orderParam: string;
  if (opts.orderBy && schema.columns.some((c) => c.name === opts.orderBy)) {
    orderParam = `data->>${opts.orderBy}.${dir}`;
  } else {
    orderParam = `${order}.${dir}`;
  }

  const url =
    restBase(env) +
    `/records?template=eq.${encodeURIComponent(schema.key)}` +
    `&select=data&order=${encodeURIComponent(orderParam)}` +
    `&limit=${top}&offset=${skip}`;

  const r = await fetch(url, {
    headers: headers(env, { Prefer: 'count=exact' }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase query failed (${r.status}): ${t.slice(0, 200)}`);
  }
  const body = (await r.json()) as { data: Record<string, string> }[];

  // Total count from Content-Range: "0-99/12345"
  let count = 0;
  const cr = r.headers.get('content-range');
  if (cr) {
    const m = cr.match(/\/(\d+|\*)$/);
    if (m && m[1] !== '*') count = Number(m[1]);
  }

  // Reconstruct exact target column order.
  const rows = body.map((b) => {
    const d = b.data || {};
    const out: Record<string, string> = {};
    for (const c of schema.columns) out[c.name] = d[c.name] ?? '';
    return out;
  });
  return { rows, count };
}

/** Row count + last ingest per template for the dashboard. */
export async function tableStats(env: Env, schemas: SheetSchema[]) {
  const out: { key: string; label: string; count: number; lastIngest: string | null }[] = [];
  for (const s of schemas) {
    let count = 0;
    let lastIngest: string | null = null;

    // Cluster-2 templates live on Neon.
    if (usesNeon(env, s.key)) {
      try {
        const sql = neonSql(env);
        const rows = (await sql.query(
          `select count(*)::int as c, max(ingested_at) as last from public.records where template = $1`,
          [s.key]
        )) as any[];
        if (rows && rows.length) {
          count = Number(rows[0].c) || 0;
          lastIngest = rows[0].last ? String(rows[0].last) : null;
        }
      } catch {
        /* ignore per-table errors */
      }
      out.push({ key: s.key, label: s.label, count, lastIngest });
      continue;
    }

    try {
      // count
      const cu =
        restBase(env) +
        `/records?template=eq.${encodeURIComponent(s.key)}&select=id&limit=1`;
      const cr = await fetch(cu, { headers: headers(env, { Prefer: 'count=exact' }) });
      const range = cr.headers.get('content-range');
      if (range) {
        const m = range.match(/\/(\d+|\*)$/);
        if (m && m[1] !== '*') count = Number(m[1]);
      }
      // last ingest
      const lu =
        restBase(env) +
        `/records?template=eq.${encodeURIComponent(s.key)}&select=ingested_at&order=ingested_at.desc&limit=1`;
      const lr = await fetch(lu, { headers: headers(env) });
      if (lr.ok) {
        const lb = (await lr.json()) as { ingested_at: string }[];
        if (lb.length) lastIngest = lb[0].ingested_at;
      }
    } catch {
      /* ignore per-table errors so the dashboard still renders */
    }
    out.push({ key: s.key, label: s.label, count, lastIngest });
  }
  return out;
}

/**
 * Cluster Trainings dashboard aggregate (calls the Postgres RPC
 * `cluster_trainings` over the compact `cluster_summary` table).
 */
export async function clusterTrainings(
  env: Env,
  opts: { districts?: string[]; from?: string; to?: string } = {}
): Promise<any> {
  const url = restBase(env) + '/rpc/cluster_trainings';
  const body = {
    p_districts: opts.districts && opts.districts.length ? opts.districts : null,
    p_from: opts.from || null,
    p_to: opts.to || null,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`cluster_trainings failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return r.json();
}

/** Rebuild the cluster_summary table from records (call after new uploads). */
export async function refreshClusterSummary(env: Env): Promise<number> {
  const r = await fetch(restBase(env) + '/rpc/refresh_cluster_summary', {
    method: 'POST',
    headers: headers(env),
    body: '{}',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`refresh_cluster_summary failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return Number(await r.json());
}

/**
 * Monthly New Youth Reached dashboard aggregate (calls the Postgres RPC
 * `new_youth_dash` over the compact `new_youth` first-touch table).
 */
export async function newYouthDash(
  env: Env,
  opts: { districts?: string[]; from?: string; to?: string } = {}
): Promise<any> {
  const url = restBase(env) + '/rpc/new_youth_dash';
  const body = {
    p_districts: opts.districts && opts.districts.length ? opts.districts : null,
    p_from: opts.from || null,
    p_to: opts.to || null,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`new_youth_dash failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return r.json();
}

/** Rebuild the new_youth first-touch table from records (call after new uploads). */
export async function refreshNewYouth(env: Env): Promise<number> {
  const r = await fetch(restBase(env) + '/rpc/refresh_new_youth', {
    method: 'POST',
    headers: headers(env),
    body: '{}',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`refresh_new_youth failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return Number(await r.json());
}

/**
 * Trainings by Frontliners dashboard aggregate (calls the Postgres RPC
 * `frontliner_dash` over the compact `frontliner_rows` table).
 */
export async function frontlinerDash(
  env: Env,
  opts: { districts?: string[]; from?: string; to?: string; collectors?: string[] } = {}
): Promise<any> {
  const url = restBase(env) + '/rpc/frontliner_dash';
  const body = {
    p_districts: opts.districts && opts.districts.length ? opts.districts : null,
    p_from: opts.from || null,
    p_to: opts.to || null,
    p_collectors: opts.collectors && opts.collectors.length ? opts.collectors : null,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`frontliner_dash failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return r.json();
}

/** Rebuild the frontliner_rows table from records (heavy; call after uploads). */
export async function refreshFrontliners(env: Env): Promise<number> {
  const r = await fetch(restBase(env) + '/rpc/refresh_frontliner_rows', {
    method: 'POST',
    headers: headers(env),
    body: '{}',
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`refresh_frontliner_rows failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return Number(await r.json());
}

/**
 * Distribution to Participants dashboard aggregate (calls the Postgres RPC
 * `distribution_dash` over the compact `distribution_rows` join table).
 */
export interface DistFilters {
  districts?: string[];
  from?: string;
  to?: string;
  materials?: string[];
  units?: string[];
  submitters?: string[];
  suppliers?: string[];
}

export async function distributionDash(env: Env, opts: DistFilters = {}): Promise<any> {
  return neonRpcJson(
    env,
    'distribution_dash',
    'p_districts := $1::text[], p_from := $2::date, p_to := $3::date, ' +
      'p_materials := $4::text[], p_units := $5::text[], ' +
      'p_submitters := $6::text[], p_suppliers := $7::text[]',
    [
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.from || null,
      opts.to || null,
      opts.materials && opts.materials.length ? opts.materials : null,
      opts.units && opts.units.length ? opts.units : null,
      opts.submitters && opts.submitters.length ? opts.submitters : null,
      opts.suppliers && opts.suppliers.length ? opts.suppliers : null,
    ]
  );
}

/**
 * Lightweight slicer option lists only (districts/materials/units/submitters/
 * suppliers). Fetched independently by the page so the slicers always populate
 * fast, regardless of how long the heavy dashboard query takes.
 */
export async function distributionOptions(env: Env): Promise<any> {
  return neonRpcJson(env, 'distribution_options', '', []);
}

/** Per-participant detail rows for one SHG group (expandable hierarchy). */
export async function distributionDetail(
  env: Env,
  shg: string,
  opts: DistFilters = {}
): Promise<any> {
  return neonRpcJson(
    env,
    'distribution_detail',
    'p_shg := $1, p_districts := $2::text[], p_from := $3::date, p_to := $4::date, ' +
      'p_materials := $5::text[], p_units := $6::text[], ' +
      'p_submitters := $7::text[], p_suppliers := $8::text[]',
    [
      shg,
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.from || null,
      opts.to || null,
      opts.materials && opts.materials.length ? opts.materials : null,
      opts.units && opts.units.length ? opts.units : null,
      opts.submitters && opts.submitters.length ? opts.submitters : null,
      opts.suppliers && opts.suppliers.length ? opts.suppliers : null,
    ]
  );
}

/** Rebuild the distribution_rows join table from records (call after uploads). [Neon] */
export async function refreshDistribution(env: Env): Promise<number> {
  return neonRpcScalar(env, 'refresh_distribution_rows');
}

// ---- Distribution to SHGs (shg_group ⋈ distribution_form_v2) --------------

/** Dashboard aggregate: KPIs + grouped-by-SHG_Group table + slicer lists. */
export async function shgDistributionDash(env: Env, opts: DistFilters = {}): Promise<any> {
  return neonRpcJson(
    env,
    'shg_distribution_dash',
    'p_districts := $1::text[], p_from := $2::date, p_to := $3::date, ' +
      'p_materials := $4::text[], p_units := $5::text[], ' +
      'p_submitters := $6::text[], p_suppliers := $7::text[]',
    [
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.from || null,
      opts.to || null,
      opts.materials && opts.materials.length ? opts.materials : null,
      opts.units && opts.units.length ? opts.units : null,
      opts.submitters && opts.submitters.length ? opts.submitters : null,
      opts.suppliers && opts.suppliers.length ? opts.suppliers : null,
    ]
  );
}

/** Lightweight slicer option lists only (for the SHG distribution page). [Neon] */
export async function shgDistributionOptions(env: Env): Promise<any> {
  return neonRpcJson(env, 'shg_distribution_options', '', []);
}

/** Per-record detail rows for one SHG group (expandable hierarchy). [Neon] */
export async function shgDistributionDetail(
  env: Env,
  shg: string,
  opts: DistFilters = {}
): Promise<any> {
  return neonRpcJson(
    env,
    'shg_distribution_detail',
    'p_shg := $1, p_districts := $2::text[], p_from := $3::date, p_to := $4::date, ' +
      'p_materials := $5::text[], p_units := $6::text[], ' +
      'p_submitters := $7::text[], p_suppliers := $8::text[]',
    [
      shg,
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.from || null,
      opts.to || null,
      opts.materials && opts.materials.length ? opts.materials : null,
      opts.units && opts.units.length ? opts.units : null,
      opts.submitters && opts.submitters.length ? opts.submitters : null,
      opts.suppliers && opts.suppliers.length ? opts.suppliers : null,
    ]
  );
}

/** Rebuild shg_distribution_rows from records (call after uploads). [Neon] */
export async function refreshShgDistribution(env: Env): Promise<number> {
  return neonRpcScalar(env, 'refresh_shg_distribution_rows');
}

// ---- SHG Profiling (shg_groups_view ⋈ Dim_SHG[shg_profiling_form]) ----------

export interface ProfilingFilters {
  districts?: string[];
  profilers?: string[];
  from?: string;
  to?: string;
  totalMin?: number;
  totalMax?: number;
  /** Monthly_SHGs target (MAX(Targets[Monthly_SHGs])); not affected by filters. */
  monthlyTarget?: number;
}

/** Dashboard aggregate: VS KPIs + one-row-per-SHG table + slicer lists. */
export async function shgProfilingDash(env: Env, opts: ProfilingFilters = {}): Promise<any> {
  return neonRpcJson(
    env,
    'shg_profiling_dash',
    'p_districts := $1::text[], p_profilers := $2::text[], ' +
      'p_from := $3::date, p_to := $4::date, ' +
      'p_total_min := $5::int, p_total_max := $6::int, p_monthly_target := $7::int',
    [
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.profilers && opts.profilers.length ? opts.profilers : null,
      opts.from || null,
      opts.to || null,
      typeof opts.totalMin === 'number' ? opts.totalMin : null,
      typeof opts.totalMax === 'number' ? opts.totalMax : null,
      typeof opts.monthlyTarget === 'number' ? opts.monthlyTarget : 29,
    ]
  );
}

/** Lightweight slicer option lists only (District + profiler + total range). [Neon] */
export async function shgProfilingOptions(env: Env): Promise<any> {
  return neonRpcJson(env, 'shg_profiling_options', '', []);
}

/** Rebuild shg_profiling_rows from records (call after uploads). [Neon] */
export async function refreshShgProfiling(env: Env): Promise<number> {
  return neonRpcScalar(env, 'refresh_shg_profiling_rows');
}

// --------------------------------------------------------------------------
// ISLA (SHGs SAVING IN A CLUSTER) dashboard
// --------------------------------------------------------------------------
export interface IslaFilters {
  districts?: string[];
  profilers?: string[];
  from?: string;
  to?: string;
}

/** Dashboard aggregate: SHG_Saving KPI + table (grouped by shg_name) + slicers. [Neon] */
export async function islaDash(env: Env, opts: IslaFilters = {}): Promise<any> {
  return neonRpcJson(
    env,
    'isla_dash',
    'p_districts := $1::text[], p_profilers := $2::text[], ' +
      'p_from := $3::date, p_to := $4::date',
    [
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.profilers && opts.profilers.length ? opts.profilers : null,
      opts.from || null,
      opts.to || null,
    ]
  );
}

/** Lightweight slicer option lists only (District_SHG + Profilers_name). [Neon] */
export async function islaOptions(env: Env): Promise<any> {
  return neonRpcJson(env, 'isla_options', '', []);
}

/** Rebuild isla_final_rows from records (call after uploads). [Neon] */
export async function refreshIsla(env: Env): Promise<number> {
  return neonRpcScalar(env, 'refresh_isla_final_rows');
}

// --------------------------------------------------------------------------
// Youth in Production (Mainly Horticulture) — production_and_marketing_tool
// filtered pdn_level='production', joined to participants + shg profiling.
// --------------------------------------------------------------------------
export interface ProductionFilters {
  districts?: string[];
  valuechains?: string[];
  from?: string;
  to?: string;
}

/** Dashboard aggregate: 3 KPIs + table (grouped by shg_name) + slicers. [Neon] */
export async function productionDash(env: Env, opts: ProductionFilters = {}): Promise<any> {
  return neonRpcJson(
    env,
    'production_dash',
    '$1::text[], $2::text[], $3::date, $4::date',
    [
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.valuechains && opts.valuechains.length ? opts.valuechains : null,
      opts.from || null,
      opts.to || null,
    ]
  );
}

/** Lightweight slicer option lists only (district_name + value_chain). [Neon] */
export async function productionOptions(env: Env): Promise<any> {
  return neonRpcJson(env, 'production_options', '', []);
}

/** Rebuild production_rows from records (call after uploads). [Neon] */
export async function refreshProduction(env: Env): Promise<number> {
  return neonRpcScalar(env, 'refresh_production_rows');
}

// --------------------------------------------------------------------------
// Sales in Horticulture/Oilseeds — production_and_marketing_tool filtered
// pdn_level='marketing', joined to participants + shg profiling.
// --------------------------------------------------------------------------
export interface SalesFilters {
  districts?: string[];
  valuechains?: string[];
  from?: string;
  to?: string;
}

/** Dashboard aggregate: 3 sales KPIs + table (grouped by shg_name) + slicers. [Neon] */
export async function salesDash(env: Env, opts: SalesFilters = {}): Promise<any> {
  return neonRpcJson(
    env,
    'sales_dash',
    '$1::text[], $2::text[], $3::date, $4::date',
    [
      opts.districts && opts.districts.length ? opts.districts : null,
      opts.valuechains && opts.valuechains.length ? opts.valuechains : null,
      opts.from || null,
      opts.to || null,
    ]
  );
}

/** Lightweight slicer option lists only (district_name + value_chain). [Neon] */
export async function salesOptions(env: Env): Promise<any> {
  return neonRpcJson(env, 'sales_options', '', []);
}

/** Rebuild sales_rows from records (call after uploads). [Neon] */
export async function refreshSales(env: Env): Promise<number> {
  return neonRpcScalar(env, 'refresh_sales_rows');
}

/** Delete all rows for a template (reset a master table). */
export async function clearTable(env: Env, schema: SheetSchema): Promise<void> {
  if (usesNeon(env, schema.key)) {
    const sql = neonSql(env);
    await sql.query(`delete from public.records where template = $1`, [schema.key]);
    return;
  }
  const url =
    restBase(env) + `/records?template=eq.${encodeURIComponent(schema.key)}`;
  const r = await fetch(url, { method: 'DELETE', headers: headers(env) });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase reset failed (${r.status}): ${t.slice(0, 200)}`);
  }
}

/**
 * Backfill any column with a `fillFrom` rule (e.g. docId <- __Submissions-id /
 * unique_id) for rows where the target is empty. Reads affected rows in pages
 * and PATCHes the JSONB `data` back. Returns how many rows were updated.
 */
export async function backfillFilled(
  env: Env,
  schema: SheetSchema
): Promise<{ updated: number; pairs: string[] }> {
  const fillCols = schema.columns.filter((c) => c.fillFrom);
  if (!fillCols.length) return { updated: 0, pairs: [] };

  // Neon: do the whole backfill in one UPDATE per fill column (set target from
  // source where target is empty). Column names come from the trusted schema.
  if (usesNeon(env, schema.key)) {
    const sql = neonSql(env);
    let updated = 0;
    for (const col of fillCols) {
      const tgt = col.name.replace(/'/g, "''");
      const src = (col.fillFrom as string).replace(/'/g, "''");
      const res = (await sql.query(
        `update public.records ` +
          `set data = jsonb_set(data, $2, to_jsonb(data->>$3), true) ` +
          `where template = $1 ` +
          `and coalesce(data->>$4, '') = '' ` +
          `and coalesce(data->>$3, '') <> '' returning 1`,
        [schema.key, `{${tgt}}`, src, tgt]
      )) as any[];
      updated += Array.isArray(res) ? res.length : 0;
    }
    const pairs = fillCols.map((c) => `${c.name}<-${c.fillFrom}`);
    return { updated, pairs };
  }

  let updated = 0;
  const pageSize = 1000;
  let offset = 0;

  // Loop pages of this template.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url =
      restBase(env) +
      `/records?template=eq.${encodeURIComponent(schema.key)}` +
      `&select=id,data&order=id.asc&limit=${pageSize}&offset=${offset}`;
    const r = await fetch(url, { headers: headers(env) });
    if (!r.ok) break;
    const page = (await r.json()) as { id: number; data: Record<string, string> }[];
    if (!page.length) break;

    const updates: { id: number; data: Record<string, string> }[] = [];
    for (const row of page) {
      const d = row.data || {};
      let changed = false;
      for (const col of fillCols) {
        const cur = (d[col.name] ?? '').toString().trim();
        const srcVal = (d[col.fillFrom as string] ?? '').toString().trim();
        if (!cur && srcVal) {
          d[col.name] = srcVal;
          changed = true;
        }
      }
      if (changed) updates.push({ id: row.id, data: d });
    }

    // PATCH each changed row's data by id (bulk via one request each; batched).
    for (const u of updates) {
      const pu = restBase(env) + `/records?id=eq.${u.id}`;
      const pr = await fetch(pu, {
        method: 'PATCH',
        headers: headers(env, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ data: u.data }),
      });
      if (pr.ok) updated++;
    }

    offset += pageSize;
    if (page.length < pageSize) break;
  }

  const pairs = fillCols.map((c) => `${c.name}<-${c.fillFrom}`);
  return { updated, pairs };
}
