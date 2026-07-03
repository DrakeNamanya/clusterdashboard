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

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
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

/** Max value of the seq (`No`) column so appends continue the sequence. */
export async function maxSeq(env: Env, schema: SheetSchema): Promise<number> {
  const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
  if (seqIdx < 0) return 0;
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

/** Delete all rows for a template (reset a master table). */
export async function clearTable(env: Env, schema: SheetSchema): Promise<void> {
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
