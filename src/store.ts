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
import { Client } from 'pg';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  // CockroachDB Serverless (Postgres-wire compatible) — serves Cluster-2
  // dashboards (Production, Sales, ISLA, SHG Profiling, Distribution, SHG
  // Distribution). These tables JOIN together and are disconnected from the
  // Frontliners cluster (all_trainees_view), which stays on Supabase.
  //
  // MIGRATION NOTE: This layer previously used Neon's serverless HTTP driver,
  // but Neon's 512 MB free-tier storage was exhausted (~430k rows). CockroachDB
  // Serverless gives 10 GiB free, so all Cluster-2 data moved here. We connect
  // with node-postgres (`pg`) over TCP sockets, which runs on Cloudflare Workers
  // thanks to `nodejs_compat`. NEON_DATABASE_URL is still accepted for backward
  // compatibility but COCKROACH_DATABASE_URL takes precedence.
  //
  // MIGRATION NOTE (Oracle): all Cluster-2 data has been migrated to a
  // PostgreSQL 16 instance running on an Oracle Cloud compute VM (long-term
  // home). ORACLE_DATABASE_URL now takes precedence over everything else;
  // COCKROACH_DATABASE_URL is kept only as a fallback until the CockroachDB
  // instance is decommissioned.
  ORACLE_DATABASE_URL?: string;
  COCKROACH_DATABASE_URL?: string;
  NEON_DATABASE_URL?: string;
  // Cloudflare D1 (SQLite) — serves the heavy Frontliner cluster
  // (all_trainees_view: Frontliners / Cluster Trainings / New Youth). Moved off
  // Supabase because ~728k rows exhausted the 0.5GB RAM nano tier. D1 gives 5GB
  // storage and no RAM ceiling, so it never crashes on this dataset.
  DB?: D1Database;
}

/** Resolve the Cluster-2 Postgres connection string (Oracle VM preferred). */
function clusterDbUrl(env: Env): string | undefined {
  return env.ORACLE_DATABASE_URL || env.COCKROACH_DATABASE_URL || env.NEON_DATABASE_URL;
}

/** Templates whose records live in Cloudflare D1 (the Frontliner cluster). */
const D1_TEMPLATES = new Set<string>(['all_trainees_view', 'reach_targets']);

/** True when this template's records should be stored/queried on D1. */
function usesD1(env: Env, template: string): boolean {
  return !!env.DB && D1_TEMPLATES.has(template);
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
  'isla_participants',
  'youth_profiling',
  'shg_groups_view',
  'shg_group',
  'participants_shg',
  'distribution_form_v2',
  'agrihubs',
]);

/** True when this template's records should be stored/queried on the Cluster-2
 *  Postgres backend (CockroachDB, formerly Neon). */
function usesNeon(env: Env, template: string): boolean {
  return !!clusterDbUrl(env) && NEON_TEMPLATES.has(template);
}

/**
 * Open a fresh node-postgres Client to the Cluster-2 backend (CockroachDB).
 * Cloudflare Workers has no connection pooling across requests, so we open one
 * short-lived connection per logical operation and close it in a `finally`.
 * TCP sockets are provided by the Workers runtime under `nodejs_compat`.
 */
function newClusterClient(env: Env): Client {
  const url = clusterDbUrl(env);
  if (!url) {
    throw new Error('COCKROACH_DATABASE_URL (or NEON_DATABASE_URL) is not configured');
  }
  return new Client({
    connectionString: url,
    // CockroachDB Cloud terminates TLS; the Workers socket layer verifies it.
    ssl: { rejectUnauthorized: false },
    // CockroachDB Serverless scales compute to zero when idle; the FIRST
    // connection after that can take 15-20s. Give it room so a cold start does
    // not surface as a spurious HTTP 503 on the first upload batch.
    connectionTimeoutMillis: 30000,
    query_timeout: 55000,
    statement_timeout: 55000,
  });
}

/**
 * Open a connected CockroachDB client, retrying transient connect failures with
 * backoff (cold-start wake-ups look like connect errors). Mirrors neonQuery's
 * resilience so bulk-insert paths don't 503 on the first batch after idle.
 */
async function connectClusterWithRetry(env: Env, tries = 5): Promise<Client> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    const client = newClusterClient(env);
    try {
      await client.connect();
      return client;
    } catch (e) {
      last = e;
      try { await client.end(); } catch { /* ignore */ }
      if (i < tries) await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i - 1)));
    }
  }
  throw last instanceof Error ? last : new Error('CockroachDB connect failed');
}

/**
 * Lightweight adapter that mimics the old Neon `sql.query(text, params)`
 * contract (returns a plain row array) on top of a node-postgres Client.
 * Lazily connects on first query; the caller MUST call `.close()` when done
 * (Workers has no cross-request pooling, so leaving a socket open leaks it).
 * Use this when a code path issues several queries on one logical connection.
 */
function clusterSql(env: Env): { query: (text: string, params?: any[]) => Promise<any[]>; close: () => Promise<void> } {
  let client: Client | null = null;
  return {
    async query(text: string, params: any[] = []): Promise<any[]> {
      if (!client) {
        client = newClusterClient(env);
        await client.connect();
      }
      const res = await client.query(text, params);
      return res.rows as any[];
    },
    async close(): Promise<void> {
      if (client) {
        try { await client.end(); } catch { /* ignore */ }
        client = null;
      }
    },
  };
}

/**
 * Run a single query against CockroachDB with connect/close bookkeeping and
 * retry/backoff. CockroachDB Serverless can cold-start (~1-3s) after idle, so
 * a transient connect error is retried rather than surfaced as an HTTP 503.
 * Returns the plain row array (mirrors the previous Neon `.query()` contract,
 * which returned rows directly rather than pg's `{rows}` wrapper).
 */
async function neonQuery(
  env: Env,
  text: string,
  params: any[] = [],
  tries = 5
): Promise<any[]> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    const client = newClusterClient(env);
    try {
      await client.connect();
      const res = await client.query(text, params);
      return res.rows as any[];
    } catch (e) {
      last = e;
      // Backoff: 0.4s, 0.8s, 1.6s, 3.2s — enough for a cold compute to wake.
      if (i < tries) {
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, i - 1)));
      }
    } finally {
      // Always release the socket; ignore close errors on a failed connection.
      try { await client.end(); } catch { /* ignore */ }
    }
  }
  throw last instanceof Error ? last : new Error('CockroachDB query failed');
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

// ---------------------------------------------------------------------------
// CockroachDB-as-D1 adapter.
//
// The Frontliner cluster (all_trainees_view / reach_targets) was originally on
// Cloudflare D1. To move it onto CockroachDB *without* rewriting every dashboard
// query, this adapter exposes the small slice of the D1 API those functions use
// (`prepare(sql).bind(...).all()/.first()/.run()`) on top of a node-postgres
// client. It rewrites `?` placeholders to `$1,$2,...` and keeps ONE connection
// open per logical operation; callers MUST `await d1.close()` in a finally.
// ---------------------------------------------------------------------------

/** Rewrite anonymous `?` placeholders (D1/SQLite) to `$1,$2,...` (Postgres). */
function qmarkToDollar(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

interface D1Like {
  prepare(sql: string): {
    bind(...params: any[]): {
      all<T = any>(): Promise<{ results: T[] }>;
      first<T = any>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
    all<T = any>(): Promise<{ results: T[] }>;
    first<T = any>(): Promise<T | null>;
    run(): Promise<{ meta: { changes: number } }>;
  };
  batch(stmts: { __sql: string; __params: any[] }[]): Promise<{ meta: { changes: number } }[]>;
  close(): Promise<void>;
}

/**
 * Build a D1-compatible facade backed by a single CockroachDB connection.
 * `at_rows` / `reach_targets` live in the `public` schema on CockroachDB.
 */
function crdbAsD1(env: Env): D1Like {
  let client: Client | null = null;
  async function conn(): Promise<Client> {
    if (!client) {
      client = newClusterClient(env);
      await client.connect();
    }
    return client;
  }
  function stmt(sql: string, boundParams: any[] = []) {
    const text = qmarkToDollar(sql);
    return {
      async all<T = any>(): Promise<{ results: T[] }> {
        const c = await conn();
        const r = await c.query(text, boundParams);
        return { results: r.rows as T[] };
      },
      async first<T = any>(): Promise<T | null> {
        const c = await conn();
        const r = await c.query(text, boundParams);
        return (r.rows.length ? (r.rows[0] as T) : null);
      },
      async run(): Promise<{ meta: { changes: number } }> {
        const c = await conn();
        const r = await c.query(text, boundParams);
        return { meta: { changes: r.rowCount ?? 0 } };
      },
    };
  }
  return {
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return stmt(sql, params);
        },
        ...stmt(sql, []),
      };
    },
    async batch(stmts: { __sql: string; __params: any[] }[]) {
      const c = await conn();
      const out: { meta: { changes: number } }[] = [];
      // CockroachDB implicit txn per statement is fine here; run sequentially.
      for (const s of stmts) {
        const r = await c.query(qmarkToDollar(s.__sql), s.__params);
        out.push({ meta: { changes: r.rowCount ?? 0 } });
      }
      return out;
    },
    async close() {
      if (client) {
        try { await client.end(); } catch { /* ignore */ }
        client = null;
      }
    },
  };
}

/** True when the Frontliner cluster should live on CockroachDB (preferred). */
function frontlinerOnCrdb(env: Env): boolean {
  return !!clusterDbUrl(env);
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

  // Route Cluster-2 templates to CockroachDB; Frontliner cluster
  // (all_trainees_view, reach_targets) to CockroachDB when configured (falls
  // back to Cloudflare D1 only if no CockroachDB URL); anything else to Supabase.
  if (D1_TEMPLATES.has(schema.key)) {
    if (frontlinerOnCrdb(env)) {
      return appendFrontlinerCrdb(env, schema, records, sourceFile);
    }
    if (usesD1(env, schema.key)) {
      return appendRecordsD1(env, schema, records, sourceFile);
    }
  }
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

  // Insert in chunks to stay under parameter limits (5 params/row). One pg
  // connection is opened for the whole append and closed in `finally`.
  const CHUNK = 400;
  let inserted = 0;
  const client = newClusterClient(env);
  try {
    await client.connect();
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
      const res = await client.query(text, params);
      inserted += Array.isArray(res.rows) ? res.rows.length : 0;
    }
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
  const dup = records.length - inserted;
  return { inserted, duplicatesSkipped: dup < 0 ? 0 : dup, total: records.length };
}

// ===========================================================================
// Cloudflare D1 (SQLite) layer — Frontliner cluster (all_trainees_view).
// Records are flattened to participant-grain rows at INSERT time (D1 has no
// stored functions), and all three dashboards aggregate over `at_rows` in TS.
// ===========================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Parse a YYYY-MM-DD (or longer ISO) string to 'YYYY-MM-DD', else null. */
function toDay(v: string | undefined | null): string | null {
  const s = (v ?? '').trim();
  return DATE_RE.test(s) ? s.slice(0, 10) : null;
}

/** Flatten one all_trainees_view record into an at_rows row (mirrors refresh_* SQL). */
function flattenTrainee(rec: Record<string, string>, dedupKey: string, sourceFile: string) {
  const t = (k: string) => (rec[k] ?? '').trim() || null;
  const activity = (rec['activity_date'] ?? '').trim();
  return {
    dedup_key: dedupKey,
    data_collector: t('data_collector'),
    participant_id: t('participant_id'),
    group_id: t('group_id'),
    group_name: t('group_name'),
    training_type: t('training_type'),
    district: (t('district') || '')?.toUpperCase() || null,
    day: toDay(activity),
    sex: t('sex'),
    is_pwd: (rec['Disability_status'] ?? '').trim().toLowerCase() === 'yes' ? 1 : 0,
    is_farming: (rec['Do_for_living'] ?? '').trim() === 'Farming' ? 1 : 0,
    has_date: DATE_RE.test(activity) ? 1 : 0,
    source_file: sourceFile,
  };
}

/**
 * D1 variant of appendRecords for all_trainees_view: flatten + INSERT OR IGNORE
 * into at_rows (dedup_key PRIMARY KEY makes re-uploads idempotent). Batched to
 * stay under D1's ~100-bound / statement limits.
 */
async function appendRecordsD1(
  env: Env,
  schema: SheetSchema,
  records: Record<string, string>[],
  sourceFile: string
): Promise<AppendResult> {
  const db = env.DB!;
  // reach_targets is handled by its own dedicated path (see appendTargetsD1).
  if (schema.key === 'reach_targets') {
    return appendTargetsD1(env, records);
  }

  const seen = new Set<string>();
  const rows = [] as ReturnType<typeof flattenTrainee>[];
  for (const rec of records) {
    const dk = dedupKeyFor(schema, rec);
    if (seen.has(dk)) continue;
    seen.add(dk);
    rows.push(flattenTrainee(rec, dk, sourceFile));
  }
  if (!rows.length) {
    return { inserted: 0, duplicatesSkipped: records.length, total: records.length };
  }

  // IMPORTANT: do NOT COUNT(*) the whole table per batch — at ~500k+ rows that
  // O(n) scan is what made huge uploads slow down and eventually 503. Instead we
  // read the exact number of rows inserted from each statement's meta.changes
  // (INSERT OR IGNORE reports 0 for skipped duplicates).
  const COLS = 13;
  // Multi-row insert: 30 rows * 13 cols = 390 bound params per statement, well
  // within D1's per-statement variable limit and far fewer statements overall.
  const MAX_ROWS = 30;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += MAX_ROWS) {
    const chunk = rows.slice(i, i + MAX_ROWS);
    const ph = chunk.map(() => `(${Array(COLS).fill('?').join(',')})`).join(',');
    const sql =
      `INSERT OR IGNORE INTO at_rows
       (dedup_key,data_collector,participant_id,group_id,group_name,training_type,
        district,day,sex,is_pwd,is_farming,has_date,source_file) VALUES ` + ph;
    const params: any[] = [];
    for (const r of chunk) {
      params.push(
        r.dedup_key, r.data_collector, r.participant_id, r.group_id, r.group_name,
        r.training_type, r.district, r.day, r.sex, r.is_pwd, r.is_farming, r.has_date,
        r.source_file
      );
    }
    stmts.push(db.prepare(sql).bind(...params));
  }
  // batch() runs all statements in a single implicit transaction and returns a
  // result per statement; sum meta.changes for the exact inserted count.
  let inserted = 0;
  const BATCH = 20;
  for (let i = 0; i < stmts.length; i += BATCH) {
    const res = await db.batch(stmts.slice(i, i + BATCH));
    for (const r of res as any[]) inserted += Number(r?.meta?.changes ?? 0);
  }
  const dup = records.length - inserted;
  return { inserted, duplicatesSkipped: dup < 0 ? 0 : dup, total: records.length };
}

async function d1Count(db: D1Database): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS c FROM at_rows').first<{ c: number }>();
  return Number(r?.c ?? 0);
}

/** at_rows row count on whichever backend holds the Frontliner cluster. */
async function frontlinerCount(env: Env): Promise<number> {
  if (frontlinerOnCrdb(env)) {
    const rows = await neonQuery(env, 'SELECT COUNT(*)::int AS c FROM public.at_rows');
    return Number(rows?.[0]?.c ?? 0);
  }
  return d1Count(env.DB!);
}

/** reach_targets upload: replace all rows (targets are a full authoritative set). */
async function appendTargetsD1(
  env: Env,
  records: Record<string, string>[]
): Promise<AppendResult> {
  const db = env.DB!;
  const num = (v: string | undefined) => {
    const s = (v ?? '').replace(/[^0-9.\-]/g, '').trim();
    return s === '' ? null : Number(s);
  };
  const monthOf = (v: string | undefined) => {
    const s = (v ?? '').trim();
    if (DATE_RE.test(s)) return s.slice(0, 8) + '01';
    return null;
  };
  const rows = records
    .map((rec) => ({
      district: (rec['district'] ?? '').trim().toUpperCase() || null,
      month: monthOf(rec['month']),
      target: num(rec['target']),
      target_shgs: num(rec['target_shgs']),
      target_yiw: num(rec['target_yiw']),
      target_female: num(rec['target_female']),
      target_pwds: num(rec['target_pwds']),
    }))
    .filter((r) => r.district && r.month);
  if (!rows.length) return { inserted: 0, duplicatesSkipped: records.length, total: records.length };
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM reach_targets')];
  for (const r of rows) {
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO reach_targets
           (district,month,target,target_shgs,target_yiw,target_female,target_pwds)
           VALUES (?,?,?,?,?,?,?)`
        )
        .bind(r.district, r.month, r.target, r.target_shgs, r.target_yiw, r.target_female, r.target_pwds)
    );
  }
  const BATCH = 60;
  for (let i = 0; i < stmts.length; i += BATCH) {
    await db.batch(stmts.slice(i, i + BATCH));
  }
  return { inserted: rows.length, duplicatesSkipped: 0, total: records.length };
}

// ---------------------------------------------------------------------------
// CockroachDB variant of the Frontliner cluster append (all_trainees_view /
// reach_targets). Mirrors appendRecordsD1/appendTargetsD1 but talks to
// CockroachDB via node-postgres. Large uploads (all_trainees_view is hundreds
// of thousands of rows) are chunked into multi-row INSERTs; ON CONFLICT DO
// NOTHING makes re-uploads idempotent on the dedup_key primary key.
// ---------------------------------------------------------------------------

async function appendFrontlinerCrdb(
  env: Env,
  schema: SheetSchema,
  records: Record<string, string>[],
  sourceFile: string
): Promise<AppendResult> {
  if (schema.key === 'reach_targets') {
    return appendTargetsCrdb(env, records);
  }

  // Flatten + de-dupe within this batch (dedup_key PK rejects intra-batch dups).
  const seen = new Set<string>();
  const rows = [] as ReturnType<typeof flattenTrainee>[];
  for (const rec of records) {
    const dk = dedupKeyFor(schema, rec);
    if (seen.has(dk)) continue;
    seen.add(dk);
    rows.push(flattenTrainee(rec, dk, sourceFile));
  }
  if (!rows.length) {
    return { inserted: 0, duplicatesSkipped: records.length, total: records.length };
  }

  const client = await connectClusterWithRetry(env);
  let inserted = 0;
  try {
    const COLS = 13;
    // 300 rows * 13 cols = 3900 bound params/statement — safe for Postgres
    // (65535 param ceiling) and keeps the statement count low for big uploads.
    const CHUNK = 300;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const ph: string[] = [];
      const params: any[] = [];
      chunk.forEach((r, j) => {
        const b = j * COLS;
        ph.push(
          `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`
        );
        params.push(
          r.dedup_key, r.data_collector, r.participant_id, r.group_id, r.group_name,
          r.training_type, r.district, r.day, r.sex, r.is_pwd, r.is_farming, r.has_date,
          r.source_file
        );
      });
      const sql =
        `INSERT INTO public.at_rows
         (dedup_key,data_collector,participant_id,group_id,group_name,training_type,
          district,day,sex,is_pwd,is_farming,has_date,source_file)
         VALUES ${ph.join(',')}
         ON CONFLICT (dedup_key) DO NOTHING`;
      const res = await client.query(sql, params);
      inserted += res.rowCount ?? 0;
    }
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
  const dup = records.length - inserted;
  return { inserted, duplicatesSkipped: dup < 0 ? 0 : dup, total: records.length };
}

/** reach_targets upload to CockroachDB: replace all rows (authoritative set). */
async function appendTargetsCrdb(
  env: Env,
  records: Record<string, string>[]
): Promise<AppendResult> {
  const num = (v: string | undefined) => {
    const s = (v ?? '').replace(/[^0-9.\-]/g, '').trim();
    return s === '' ? null : Number(s);
  };
  const monthOf = (v: string | undefined) => {
    const s = (v ?? '').trim();
    if (DATE_RE.test(s)) return s.slice(0, 8) + '01';
    return null;
  };
  const rows = records
    .map((rec) => ({
      district: (rec['district'] ?? '').trim().toUpperCase() || null,
      month: monthOf(rec['month']),
      target: num(rec['target']),
      target_shgs: num(rec['target_shgs']),
      target_yiw: num(rec['target_yiw']),
      target_female: num(rec['target_female']),
      target_pwds: num(rec['target_pwds']),
    }))
    .filter((r) => r.district && r.month);
  if (!rows.length) return { inserted: 0, duplicatesSkipped: records.length, total: records.length };

  const client = await connectClusterWithRetry(env);
  try {
    await client.query('DELETE FROM public.reach_targets');
    const COLS = 7;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const ph: string[] = [];
      const params: any[] = [];
      chunk.forEach((r, j) => {
        const b = j * COLS;
        ph.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
        params.push(r.district, r.month, r.target, r.target_shgs, r.target_yiw, r.target_female, r.target_pwds);
      });
      await client.query(
        `INSERT INTO public.reach_targets
         (district,month,target,target_shgs,target_yiw,target_female,target_pwds)
         VALUES ${ph.join(',')}
         ON CONFLICT (district,month) DO UPDATE SET
           target=excluded.target, target_shgs=excluded.target_shgs,
           target_yiw=excluded.target_yiw, target_female=excluded.target_female,
           target_pwds=excluded.target_pwds`,
        params
      );
    }
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
  return { inserted: rows.length, duplicatesSkipped: 0, total: records.length };
}

/** Max value of the seq (`No`) column so appends continue the sequence. */
export async function maxSeq(env: Env, schema: SheetSchema): Promise<number> {
  const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
  if (seqIdx < 0) return 0;

  // Route to CockroachDB (Cluster-2 templates).
  if (usesNeon(env, schema.key)) {
    const sql = clusterSql(env);
    try {
      const rows = await sql.query(
        `select max(seq) as m from public.records where template = $1`,
        [schema.key]
      );
      const m = rows && rows.length ? rows[0].m : null;
      return m ? Number(m) : 0;
    } finally {
      await sql.close();
    }
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

  // Route Cluster-2 templates to CockroachDB.
  if (usesNeon(env, schema.key)) {
    const sql = clusterSql(env);
    try {
      let orderExpr: string;
      if (opts.orderBy && schema.columns.some((c) => c.name === opts.orderBy)) {
        // orderBy is validated against schema column names above (no injection).
        orderExpr = `data->>'${opts.orderBy.replace(/'/g, "''")}'`;
      } else {
        // CockroachDB's records table has no `id` column (it uses seq +
        // created_at); fall back to created_at for ingest order there.
        orderExpr = seqIdx >= 0 ? 'seq' : 'created_at';
      }
      const dirSql = dir === 'desc' ? 'desc nulls last' : 'asc';
      const dataRows = await sql.query(
        `select data from public.records where template = $1 ` +
          `order by ${orderExpr} ${dirSql} limit $2 offset $3`,
        [schema.key, top, skip]
      );
      const cntRows = await sql.query(
        `select count(*)::int as c from public.records where template = $1`,
        [schema.key]
      );
      const count = cntRows && cntRows.length ? Number(cntRows[0].c) : 0;
      const rows = (dataRows || []).map((b: any) => {
        const d = b.data || {};
        const out: Record<string, string> = {};
        for (const c of schema.columns) out[c.name] = d[c.name] ?? '';
        return out;
      });
      return { rows, count };
    } finally {
      await sql.close();
    }
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

    // Frontliner cluster: CockroachDB when configured, else Cloudflare D1.
    if (D1_TEMPLATES.has(s.key)) {
      try {
        if (frontlinerOnCrdb(env)) {
          const tbl = s.key === 'reach_targets' ? 'public.reach_targets' : 'public.at_rows';
          const rows = await neonQuery(env, `SELECT COUNT(*)::int AS c FROM ${tbl}`);
          count = Number(rows?.[0]?.c ?? 0);
        } else if (s.key === 'reach_targets') {
          const r = await env.DB!.prepare('SELECT COUNT(*) AS c FROM reach_targets').first<{ c: number }>();
          count = Number(r?.c ?? 0);
        } else {
          count = await d1Count(env.DB!);
        }
      } catch {
        /* ignore per-table errors */
      }
      out.push({ key: s.key, label: s.label, count, lastIngest });
      continue;
    }

    // Cluster-2 templates live on CockroachDB.
    if (usesNeon(env, s.key)) {
      const sql = clusterSql(env);
      try {
        const rows = await sql.query(
          // CockroachDB records table uses created_at (no ingested_at column).
          `select count(*)::int as c, max(created_at) as last from public.records where template = $1`,
          [s.key]
        );
        if (rows && rows.length) {
          count = Number(rows[0].c) || 0;
          lastIngest = rows[0].last ? String(rows[0].last) : null;
        }
      } catch {
        /* ignore per-table errors */
      } finally {
        await sql.close();
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

// ---------------------------------------------------------------------------
// Frontliner cluster dashboards — served from Cloudflare D1 (SQLite).
// `at_rows` is participant-grain (flattened at insert). WHERE clauses honour
// district (UPPER) + date range; string_agg-style lists are built in TS.
// ---------------------------------------------------------------------------

/** Build the shared WHERE clause + bound params for at_rows filters. */
function atWhere(opts: { districts?: string[]; from?: string; to?: string }): {
  clause: string;
  params: any[];
} {
  const parts: string[] = [];
  const params: any[] = [];
  const dl = (opts.districts || []).filter(Boolean).map((d) => d.toUpperCase());
  if (dl.length) {
    parts.push(`district IN (${dl.map(() => '?').join(',')})`);
    params.push(...dl);
  }
  if (opts.from) {
    parts.push(`day >= ?`);
    params.push(opts.from);
  }
  if (opts.to) {
    parts.push(`day <= ?`);
    params.push(opts.to);
  }
  return { clause: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

/**
 * Cluster Trainings dashboard aggregate. All KPIs are COUNT(DISTINCT
 * participant_id) matching the Power BI DAX. Reads `at_rows` in D1.
 */
export async function clusterTrainings(
  env: Env,
  opts: { districts?: string[]; from?: string; to?: string } = {}
): Promise<any> {
  const onCrdb = frontlinerOnCrdb(env);
  const db: any = onCrdb ? crdbAsD1(env) : env.DB!;
  try {
  const { clause, params } = atWhere(opts);

  const kpi = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN has_date=1 AND participant_id IS NOT NULL THEN participant_id END) AS total_trained,
         COUNT(DISTINCT training_type)  AS training_types,
         COUNT(DISTINCT group_id)       AS groups_reached,
         COUNT(DISTINCT CASE WHEN sex='Female' THEN participant_id END) AS female_reached,
         COUNT(DISTINCT CASE WHEN is_pwd=1 THEN participant_id END)     AS pwds_trained,
         COUNT(DISTINCT CASE WHEN is_pwd=1 AND sex='Female' THEN participant_id END) AS female_pwds
       FROM at_rows ${clause}`
    )
    .bind(...params)
    .first<any>();

  const bars = await db
    .prepare(
      `SELECT COALESCE(training_type,'(blank)') AS label,
              COUNT(DISTINCT participant_id) AS value
       FROM at_rows ${clause}
       ${clause ? 'AND' : 'WHERE'} participant_id IS NOT NULL
       GROUP BY label ORDER BY value DESC`
    )
    .bind(...params)
    .all<{ label: string; value: number }>();

  const districts = await db
    .prepare(`SELECT DISTINCT district FROM at_rows WHERE district IS NOT NULL ORDER BY district`)
    .all<{ district: string }>();

  return {
    total_trained: Number(kpi?.total_trained ?? 0),
    training_types: Number(kpi?.training_types ?? 0),
    groups_reached: Number(kpi?.groups_reached ?? 0),
    female_reached: Number(kpi?.female_reached ?? 0),
    pwds_trained: Number(kpi?.pwds_trained ?? 0),
    female_pwds: Number(kpi?.female_pwds ?? 0),
    by_training_type: (bars.results || []).map((b) => ({ label: b.label, value: Number(b.value) })),
    districts: (districts.results || []).map((d) => d.district),
  };
  } finally {
    if (onCrdb && db.close) await db.close();
  }
}

/** No-op on D1: at_rows is flattened at insert time (kept for API compatibility). */
export async function refreshClusterSummary(env: Env): Promise<number> {
  return frontlinerCount(env);
}

/**
 * Monthly New Youth Reached — "first touch" model. A participant is counted on
 * their FIRST-EVER activity_date; flags come from that first-date row(s).
 * Computed in TS from at_rows (D1 lacks window functions we'd want here).
 */
export async function newYouthDash(
  env: Env,
  opts: { districts?: string[]; from?: string; to?: string; target?: number } = {}
): Promise<any> {
  const onCrdb = frontlinerOnCrdb(env);
  const db: any = onCrdb ? crdbAsD1(env) : env.DB!;
  try {
  const pTarget = opts.target ?? 726;

  // Pull all dated, id-bearing rows (district filter applied later on the
  // first-date row so we match the DAX ALLEXCEPT(participant_id) semantics).
  const rows = await db
    .prepare(
      `SELECT participant_id AS pid, day, district, sex, is_pwd, is_farming
       FROM at_rows
       WHERE participant_id IS NOT NULL AND has_date=1 AND day IS NOT NULL`
    )
    .all<{ pid: string; day: string; district: string | null; sex: string | null; is_pwd: number; is_farming: number }>();

  // firsts: min day per participant
  const firstDay = new Map<string, string>();
  for (const r of rows.results || []) {
    const cur = firstDay.get(r.pid);
    if (!cur || r.day < cur) firstDay.set(r.pid, r.day);
  }
  // aggregate flags over the participant's first-date row(s)
  type NY = {
    first_date: string;
    district: string | null;
    is_female: boolean;
    is_pwd: boolean;
    is_farming: boolean;
    female_pwd: boolean;
    farming_female: boolean;
    farming_pwd: boolean;
    farming_fpwd: boolean;
  };
  const ny = new Map<string, NY>();
  for (const r of rows.results || []) {
    if (r.day !== firstDay.get(r.pid)) continue;
    const f = r.sex === 'Female';
    const p = r.is_pwd === 1;
    const w = r.is_farming === 1;
    const prev = ny.get(r.pid);
    const merged: NY = {
      first_date: r.day,
      district: prev?.district ?? null,
      is_female: (prev?.is_female ?? false) || f,
      is_pwd: (prev?.is_pwd ?? false) || p,
      is_farming: (prev?.is_farming ?? false) || w,
      female_pwd: (prev?.female_pwd ?? false) || (f && p),
      farming_female: (prev?.farming_female ?? false) || (w && f),
      farming_pwd: (prev?.farming_pwd ?? false) || (w && p),
      farming_fpwd: (prev?.farming_fpwd ?? false) || (w && p && f),
    };
    // deterministic district pick: max() like the SQL (keep the larger string)
    if (r.district && (!merged.district || r.district > merged.district)) merged.district = r.district;
    ny.set(r.pid, merged);
  }

  const dl = (opts.districts || []).filter(Boolean).map((d) => d.toUpperCase());
  const inSel = (v: NY) =>
    (dl.length === 0 || (v.district != null && dl.includes(v.district))) &&
    (!opts.from || v.first_date >= opts.from) &&
    (!opts.to || v.first_date <= opts.to);

  let total = 0, female = 0, pwd = 0, fpwd = 0, work = 0, fwork = 0, pwork = 0, fpwork = 0;
  const series = new Map<string, number>();
  for (const v of ny.values()) {
    if (!inSel(v)) continue;
    total++;
    if (v.is_female) female++;
    if (v.is_pwd) pwd++;
    if (v.female_pwd) fpwd++;
    if (v.is_farming) work++;
    if (v.farming_female) fwork++;
    if (v.farming_pwd) pwork++;
    if (v.farming_fpwd) fpwork++;
    series.set(v.first_date, (series.get(v.first_date) || 0) + 1);
  }

  // targets: sum over selected districts whose month intersects the range
  const trows = await db.prepare(`SELECT district, month, target FROM reach_targets`).all<{
    district: string;
    month: string;
    target: number | null;
  }>();
  let periodTotal = 0;
  const months = new Set<string>();
  const tdistricts = new Set<string>();
  for (const t of trows.results || []) {
    if (dl.length && !dl.includes(t.district)) continue;
    // month window [month, month+1mo); intersects [from,to]
    const mStart = t.month;
    const mEndDate = monthEnd(t.month);
    if (opts.to && mStart > opts.to) continue;
    if (opts.from && mEndDate < opts.from) continue;
    periodTotal += Number(t.target || 0);
    months.add(t.month);
    tdistricts.add(t.district);
  }
  const nMonths = months.size;

  const byDate = [...series.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // district slicer = union of at_rows districts and target districts
  const dd = await db
    .prepare(`SELECT DISTINCT district FROM at_rows WHERE district IS NOT NULL`)
    .all<{ district: string }>();
  const distSet = new Set<string>((dd.results || []).map((x) => x.district));
  for (const t of trows.results || []) if (t.district) distSet.add(t.district);

  return {
    new_total_reach: total,
    target_selected_period: Math.round(periodTotal),
    monthly_target: nMonths > 0 ? Math.round(periodTotal / nMonths) : pTarget,
    new_female_reach: female,
    new_pwds_reach: pwd,
    new_female_pwds_reach: fpwd,
    new_youth_in_work: work,
    new_female_youth_in_work: fwork,
    new_pwds_in_work: pwork,
    new_female_pwds_in_work: fpwork,
    by_date: byDate,
    districts: [...distSet].sort(),
  };
  } finally {
    if (onCrdb && db.close) await db.close();
  }
}

/** Last calendar day of the month whose first day is `firstOfMonth` ('YYYY-MM-01'). */
function monthEnd(firstOfMonth: string): string {
  const y = Number(firstOfMonth.slice(0, 4));
  const m = Number(firstOfMonth.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day
  return `${firstOfMonth.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** No-op on D1: at_rows is flattened at insert time (kept for API compatibility). */
export async function refreshNewYouth(env: Env): Promise<number> {
  return frontlinerCount(env);
}

/**
 * Trainings by Frontliners — per data_collector summary. KPIs are plain COUNT
 * (attendance-based, per the SQL note). Reads `at_rows` in D1.
 */
export async function frontlinerDash(
  env: Env,
  opts: { districts?: string[]; from?: string; to?: string; collectors?: string[] } = {},
  limit = 1000
): Promise<any> {
  const onCrdb = frontlinerOnCrdb(env);
  const db: any = onCrdb ? crdbAsD1(env) : env.DB!;
  try {
  const parts: string[] = ['data_collector IS NOT NULL'];
  const params: any[] = [];
  const dl = (opts.districts || []).filter(Boolean).map((d) => d.toUpperCase());
  if (dl.length) {
    parts.push(`district IN (${dl.map(() => '?').join(',')})`);
    params.push(...dl);
  }
  const cl = (opts.collectors || []).filter(Boolean);
  if (cl.length) {
    parts.push(`data_collector IN (${cl.map(() => '?').join(',')})`);
    params.push(...cl);
  }
  if (opts.from) { parts.push(`day >= ?`); params.push(opts.from); }
  if (opts.to) { parts.push(`day <= ?`); params.push(opts.to); }
  const where = 'WHERE ' + parts.join(' AND ');

  // Per-collector numeric KPIs + min district (aggregatable in SQL).
  const agg = await db
    .prepare(
      `SELECT data_collector,
              SUM(CASE WHEN has_date=1 THEN 1 ELSE 0 END) AS youth_trained,
              SUM(CASE WHEN sex='Female' THEN 1 ELSE 0 END) AS female_reached,
              SUM(CASE WHEN is_pwd=1 THEN 1 ELSE 0 END) AS pwds_trained,
              COUNT(DISTINCT group_id) AS groups_reached,
              MIN(district) AS first_district
       FROM at_rows ${where}
       GROUP BY data_collector
       ORDER BY youth_trained DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all<any>();

  const collectors = (agg.results || []).map((r) => r.data_collector);

  // distinct training_type + group_name lists per collector (built in TS).
  const ttMap = new Map<string, Set<string>>();
  const gnMap = new Map<string, Set<string>>();
  if (collectors.length) {
    // Fetch distinct pairs honouring the base filters, then keep only the
    // collectors that survived the LIMIT. We deliberately DO NOT add a
    // `data_collector IN (...)` clause here: with up to `limit` (1000)
    // collectors that would exceed D1/SQLite's bound-variable ceiling
    // ("too many SQL variables"). Instead we scope in TS via `keep`.
    const keep = new Set(collectors);
    const lists = await db
      .prepare(
        `SELECT DISTINCT data_collector, training_type, group_name
         FROM at_rows WHERE ${parts.join(' AND ')}`
      )
      .bind(...params)
      .all<{ data_collector: string; training_type: string | null; group_name: string | null }>();
    for (const r of lists.results || []) {
      if (!keep.has(r.data_collector)) continue;
      if (r.training_type) {
        if (!ttMap.has(r.data_collector)) ttMap.set(r.data_collector, new Set());
        ttMap.get(r.data_collector)!.add(r.training_type);
      }
      if (r.group_name) {
        if (!gnMap.has(r.data_collector)) gnMap.set(r.data_collector, new Set());
        gnMap.get(r.data_collector)!.add(r.group_name);
      }
    }
  }

  const rowsOut = (agg.results || []).map((r) => {
    const tt = [...(ttMap.get(r.data_collector) || [])].sort().join(', ') || null;
    const gnAll = [...(gnMap.get(r.data_collector) || [])].sort().join(', ');
    const gn = gnAll.length > 100 ? gnAll.slice(0, 100) + '...' : gnAll || null;
    return {
      data_collector: r.data_collector,
      pwds_trained: Number(r.pwds_trained || 0),
      female_reached: Number(r.female_reached || 0),
      youth_trained: Number(r.youth_trained || 0),
      groups_reached: Number(r.groups_reached || 0),
      training_types: tt,
      group_names: gn,
      first_district: r.first_district ?? null,
    };
  });

  // slicers
  const dd = await db
    .prepare(`SELECT DISTINCT district FROM at_rows WHERE district IS NOT NULL ORDER BY district`)
    .all<{ district: string }>();
  // collector list scoped to selected districts + date range (not collector filter)
  const cParts: string[] = ['data_collector IS NOT NULL'];
  const cParams: any[] = [];
  if (dl.length) { cParts.push(`district IN (${dl.map(() => '?').join(',')})`); cParams.push(...dl); }
  if (opts.from) { cParts.push(`day >= ?`); cParams.push(opts.from); }
  if (opts.to) { cParts.push(`day <= ?`); cParams.push(opts.to); }
  const cc = await db
    .prepare(`SELECT DISTINCT data_collector FROM at_rows WHERE ${cParts.join(' AND ')} ORDER BY data_collector`)
    .bind(...cParams)
    .all<{ data_collector: string }>();

  return {
    rows: rowsOut,
    districts: (dd.results || []).map((d) => d.district),
    collectors: (cc.results || []).map((c) => c.data_collector),
  };
  } finally {
    if (onCrdb && db.close) await db.close();
  }
}

/** No-op on D1: at_rows is flattened at insert time (kept for API compatibility). */
export async function refreshFrontliners(env: Env): Promise<number> {
  return frontlinerCount(env);
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
    '$1::text[], $2::date, $3::date, ' +
      '$4::text[], $5::text[], ' +
      '$6::text[], $7::text[]',
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
    '$1, $2::text[], $3::date, $4::date, ' +
      '$5::text[], $6::text[], ' +
      '$7::text[], $8::text[]',
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
    '$1::text[], $2::date, $3::date, ' +
      '$4::text[], $5::text[], ' +
      '$6::text[], $7::text[]',
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
    '$1, $2::text[], $3::date, $4::date, ' +
      '$5::text[], $6::text[], ' +
      '$7::text[], $8::text[]',
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
    '$1::text[], $2::text[], ' +
      '$3::date, $4::date, ' +
      '$5::int, $6::int, $7::int',
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
    '$1::text[], $2::text[], ' +
      '$3::date, $4::date',
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
    const sql = clusterSql(env);
    try {
      await sql.query(`delete from public.records where template = $1`, [schema.key]);
    } finally {
      await sql.close();
    }
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
    const sql = clusterSql(env);
    let updated = 0;
    try {
      for (const col of fillCols) {
        const tgt = col.name.replace(/'/g, "''");
        const src = (col.fillFrom as string).replace(/'/g, "''");
        const res = await sql.query(
          `update public.records ` +
            `set data = jsonb_set(data, $2, to_jsonb(data->>$3), true) ` +
            `where template = $1 ` +
            `and coalesce(data->>$4, '') = '' ` +
            `and coalesce(data->>$3, '') <> '' returning 1`,
          [schema.key, `{${tgt}}`, src, tgt]
        );
        updated += Array.isArray(res) ? res.length : 0;
      }
    } finally {
      await sql.close();
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
