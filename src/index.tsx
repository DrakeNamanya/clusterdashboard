import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SCHEMAS, SCHEMA_BY_KEY } from './schemas';
import { parseFile } from './parse';
import { detectSchema, cleanRecords } from './cleaner';
import {
  appendRecords, maxSeq, queryRecords, tableStats, clearTable,
  backfillFilled, clusterTrainings, refreshClusterSummary,
  newYouthDash, refreshNewYouth,
  frontlinerDash, refreshFrontliners,
  distributionDash, distributionDetail, distributionOptions, refreshDistribution,
  shgDistributionDash, shgDistributionDetail, shgDistributionOptions, refreshShgDistribution,
  shgProfilingDash, shgProfilingOptions, refreshShgProfiling,
  islaDash, islaOptions, refreshIsla, valueChainSales,
  productionDash, productionOptions, productionDetail, refreshProduction,
  salesDash, salesOptions, salesDetail, refreshSales, Env,
  poultrySalesDash, poultrySalesOptions, refreshPoultrySales,
  itemsNotSoldDash, itemsNotSoldOptions, refreshItemsNotSold,
  localLeverageDash, localLeverageOptions, refreshLocalLeverage,
  melReportDash, weeklyReport, cfReport, cfStaffList, cfPremierLeague,
  misSyncSlice, misSyncStatus, misSyncView, misSyncAllViews, misViewSyncStatus,
  ingestTraineeRows,
  ingestTraineesV2,
  traineesV2Summary,
  traineesV2DetailBreakdown,
  youthInWorkDash, youthInWorkSummary, refreshJobTracking,
  syncDistributionOData, neonQuery,
} from './store';
import { askData, narrate, anomalies } from './ai';
import { renderAiObservation } from './aiobservation';
import {
  serviceDocument, metadataDocument, entitySetResponse, entitySetName,
} from './odata';
import { ODATA_SOURCES, fetchOdataPage, resolveSource } from './odataimport';
import { renderPage } from './ui';
import { renderHome } from './home';
import { renderClusterTrainings } from './cluster';
import { renderTraineesV2 } from './trainees_v2';
import { renderTrainingDetails } from './training_details';
import { renderMonthlyNewYouth } from './newyouth';
import { renderFrontliners } from './frontliner';
import { renderDistribution } from './distribution';
import { renderShgDistribution } from './shgdistribution';
import { renderShgProfiling } from './shgprofiling';
import { renderIsla } from './isla';
import { renderProduction } from './production';
import { renderSales } from './sales';
import { renderPoultrySales } from './poultry_sales';
import { renderItemsNotSold } from './items_not_sold';
import { renderLocalLeverage } from './local_leverage';
import { renderReport } from './report';
import { renderWeeklyReport } from './weekly';
import { renderCfReport } from './cfreport';
import { renderCfPremierLeague } from './cfleague';
import { clusterDistricts } from './clusters';
import { renderProgrammeReport } from './programmepage';
import { renderYouthInWork } from './youthinwork';
import { programmeReport } from './programme';
import { buildTokens as buildDocTokens, generateDocx } from './programmedoc';

// Cloudflare env: Supabase creds are injected as secrets / vars.
type Bindings = Env;

// Build the store Env from the request context (validates configuration).
function storeEnv(c: any): Env {
  // Supabase is decommissioned; keep the fields populated when present but do
  // NOT hard-fail — Cluster data now lives on the Oracle VM Postgres and
  // all_trainees_view is synced from the MIS.
  return {
    SUPABASE_URL: c.env.SUPABASE_URL || '',
    SUPABASE_SERVICE_KEY: c.env.SUPABASE_SERVICE_KEY || '',
    // Oracle VM Postgres is the long-term home for all Cluster + at_rows data.
    ORACLE_DATABASE_URL: c.env.ORACLE_DATABASE_URL,
    // CockroachDB / Neon kept only as fallbacks until fully decommissioned.
    COCKROACH_DATABASE_URL: c.env.COCKROACH_DATABASE_URL,
    NEON_DATABASE_URL: c.env.NEON_DATABASE_URL,
    // D1 serves the Frontliner cluster only when no cluster Postgres is set.
    DB: c.env.DB,
    // Hyperdrive is the PRODUCTION path to the Oracle VM Postgres: it terminates
    // TLS with the uploaded CA (verify-ca) and pools connections, sidestepping
    // workerd's refusal to trust the VM's self-signed cert over a direct socket.
    HYPERDRIVE: c.env.HYPERDRIVE,
    // Heifer SAYE MIS credentials for the direct all_trainees_view sync.
    MIS_BASE_URL: c.env.MIS_BASE_URL,
    MIS_USERNAME: c.env.MIS_USERNAME,
    MIS_PASSWORD: c.env.MIS_PASSWORD,
    // Cloudflare Workers AI binding for the AI features.
    AI: c.env.AI,
  };
}

// ---------------------------------------------------------------------------
// Edge cache for heavy dashboard aggregations.
//
// ROOT CAUSE of the "dashboard switched off" outages (Cloudflare showed 1,032
// "Exceeded CPU Time Limits" errors): the home page fires ~9 dashboard loaders
// concurrently, and several of them (esp. /api/new-youth, which runs 6 queries
// including 3 full-table first-touch scans over ~765k at_rows) recompute heavy
// aggregations on EVERY request. Concurrent + repeated on each refresh / filter
// change / auto-sync exhausts the Worker's per-request CPU budget, so requests
// get killed with no response and the dashboard goes blank.
//
// Fix: put the expensive aggregation results in Cloudflare's shared edge cache
// (caches.default). Data only changes every ~5 min (the cron sync cadence), so
// the first request in each 5-min window pays the DB/CPU cost and every other
// request — including the whole concurrent fan-out — is a near-zero-CPU cache
// HIT. Cache key = full request URL, so different filter/date selections cache
// independently. The cache is warmed asynchronously via waitUntil so the
// producing request still returns immediately.
// Freshness window raised 300->900s to match the new 15-min cron rotation
// (Phase-3 overload fix). With stale-while-revalidate the served data is never
// more than one cron cycle behind, but fewer entries fall "stale" between
// warms, so fewer background recomputes fire against the slow VM Postgres —
// directly cutting the request volume that was tripping the CF limits.
const EDGE_TTL = 900;        // seconds a cached entry is considered "fresh"
const EDGE_STORE_TTL = 86400; // how long the edge physically keeps the entry

// Build the canonical cache key (bare GET Request on the full URL incl. query).
function edgeCacheKey(url: string): Request {
  return new Request(new URL(url).toString(), { method: 'GET' });
}

// Produce → serialise → store the aggregation in the edge cache. Stamps an
// internal freshness header so we can implement stale-while-revalidate.
async function produceAndStore(
  c: any,
  cache: Cache | undefined,
  cacheKey: Request,
  producer: () => Promise<unknown>,
  ttl: number,
): Promise<Response> {
  const data = await producer();
  const body = JSON.stringify(data);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    // Physically keep the entry a long time so we can serve it stale while we
    // recompute in the background; browsers reuse it briefly (60s).
    'Cache-Control': `public, max-age=60, s-maxage=${EDGE_STORE_TTL}`,
    'X-Edge-Fresh-Until': String(Date.now() + ttl * 1000),
  };
  const resp = new Response(body, { status: 200, headers });
  if (cache) {
    try { await cache.put(cacheKey, resp.clone()); } catch { /* ignore */ }
  }
  return resp;
}

/**
 * Edge-cached JSON with stale-while-revalidate.
 *
 * ROOT CAUSE of the outages (Cloudflare: 1,032 "Exceeded CPU Time Limits"):
 * the home page fans out ~9 dashboard loaders at once, and several recompute
 * heavy aggregations over ~765k at_rows against a SLOW self-hosted Postgres VM
 * (a single COUNT(*) over at_rows already takes ~10-15s). Concurrent + repeated
 * on every refresh/filter/auto-sync blows the Worker's CPU/subrequest budget,
 * the request is killed with no response, and the dashboard goes blank.
 *
 * Strategy:
 *  - HIT & fresh  -> return instantly (near-zero CPU).
 *  - HIT & stale  -> return the stale copy instantly, recompute in background
 *                    (waitUntil) so NO user ever waits on a slow DB query.
 *  - MISS         -> compute once, store, return. Only the very first request
 *                    per key (ideally the cron warmer, not a user) pays this.
 */
async function cachedJson(
  c: any,
  producer: () => Promise<unknown>,
  ttl: number = EDGE_TTL,
): Promise<Response> {
  const method = (c.req.method || 'GET').toUpperCase();
  const cache: Cache | undefined = (globalThis as any).caches?.default;
  const ctx = c.executionCtx ?? (c as any).ctx;
  if (!cache || method !== 'GET') {
    return produceAndStore(c, undefined, edgeCacheKey(c.req.url), producer, ttl);
  }

  const cacheKey = edgeCacheKey(c.req.url);
  let hit: Response | undefined;
  try { hit = await cache.match(cacheKey); } catch { hit = undefined; }

  if (hit) {
    const freshUntil = Number(hit.headers.get('X-Edge-Fresh-Until') || 0);
    const isStale = !freshUntil || Date.now() > freshUntil;
    if (isStale && ctx?.waitUntil) {
      // Serve stale NOW, refresh in the background so the next hit is fresh.
      ctx.waitUntil(
        produceAndStore(c, cache, cacheKey, producer, ttl).catch(() => {}),
      );
    }
    return hit;
  }

  // Cold cache: compute once and store.
  return produceAndStore(c, cache, cacheKey, producer, ttl);
}

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());
app.use('/odata/*', cors());

// Any uncaught error (e.g. Supabase not configured, transient network) becomes
// a clean JSON 503 instead of a raw crash — the client retries 5xx.
app.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);
  return c.json({ error: msg }, 503);
});

// ---- Helpers ---------------------------------------------------------------

function baseUrl(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

// ---- Detection (preview only, no save) -------------------------------------

app.post('/api/detect', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
  const buf = await file.arrayBuffer();
  const parsed = parseFile(file.name, file.type || '', buf);
  const det = detectSchema(parsed.headers, file.name);

  let previewRows: Record<string, string>[] = [];
  if (det.schema) {
    const { cleaned } = cleanRecords(det.schema, parsed.headers, parsed.rows.slice(0, 10), 1);
    previewRows = cleaned;
  }

  return c.json({
    filename: file.name,
    detection: {
      matched: det.matched,
      score: det.score,
      message: det.message,
      schemaKey: det.schema?.key ?? det.closest?.key ?? null,
      schemaLabel: det.schema?.label ?? det.closest?.label ?? null,
      matchedColumns: det.matchedColumns,
      missingColumns: det.missingColumns,
      extraColumns: det.extraColumns,
    },
    sourceHeaders: parsed.headers,
    targetColumns: det.schema?.columns.map((x) => x.name) ?? det.closest?.columns.map((x) => x.name) ?? [],
    totalSourceRows: parsed.rows.length,
    previewRows,
  });
});

// ---- Upload + clean + append (append-only, dedup) --------------------------

app.post('/api/upload', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  const forceKey = form.get('schemaKey');
  if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);

  const buf = await file.arrayBuffer();
  const parsed = parseFile(file.name, file.type || '', buf);

  let det = detectSchema(parsed.headers, file.name);
  // Allow the user to override detection (e.g. confirm a close match).
  if (typeof forceKey === 'string' && SCHEMA_BY_KEY[forceKey]) {
    det = { ...det, matched: true, schema: SCHEMA_BY_KEY[forceKey] };
  }

  if (!det.matched || !det.schema) {
    return c.json({
      error: 'schema_mismatch',
      message: det.message,
      closest: det.closest?.key ?? null,
      detection: det,
    }, 422);
  }

  const schema = det.schema;

  // Guard: very large files must use the chunked client-side path to avoid
  // exceeding Worker CPU/time limits in a single request.
  const SINGLE_REQUEST_ROW_LIMIT = 3000;
  if (parsed.rows.length > SINGLE_REQUEST_ROW_LIMIT) {
    return c.json({
      error: 'too_large_for_single_request',
      message: `File has ${parsed.rows.length} rows; use chunked upload (the web UI does this automatically).`,
      rows: parsed.rows.length,
    }, 413);
  }

  const startSeq = (await maxSeq(storeEnv(c), schema)) + 1;
  const { cleaned } = cleanRecords(schema, parsed.headers, parsed.rows, startSeq);
  const result = await appendRecords(storeEnv(c), schema, cleaned, file.name);

  return c.json({
    ok: true,
    schemaKey: schema.key,
    schemaLabel: schema.label,
    filename: file.name,
    detection: {
      matched: det.matched, score: det.score, message: det.message,
      missingColumns: det.missingColumns, extraColumns: det.extraColumns,
    },
    result,
    odataFeed: `${baseUrl(c.req.url)}/odata/${entitySetName(schema)}`,
  });
});

// ---- Chunked append (JSON rows, client pre-parses large files) -------------
// The browser parses & detects locally, then streams batches of raw rows here.
// Each request cleans + appends one small batch → fast, safe for large files.

app.post('/api/append', async (c) => {
  let body: {
    schemaKey?: string;
    headers?: string[];
    rows?: string[][];
    sourceFile?: string;
    startSeq?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const schema = body.schemaKey ? SCHEMA_BY_KEY[body.schemaKey] : undefined;
  if (!schema) return c.json({ error: 'Unknown or missing schemaKey' }, 400);
  if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) {
    return c.json({ error: 'headers and rows are required' }, 400);
  }

  // Continue the `No` sequence across appends when caller does not supply it.
  const startSeq = typeof body.startSeq === 'number'
    ? body.startSeq
    : (await maxSeq(storeEnv(c), schema)) + 1;

  const { cleaned } = cleanRecords(schema, body.headers, body.rows, startSeq);
  try {
    const result = await appendRecords(storeEnv(c), schema, cleaned, body.sourceFile || 'upload');
    const nextSeq = startSeq + cleaned.length;
    return c.json({ ok: true, schemaKey: schema.key, result, nextSeq });
  } catch (err) {
    return c.json(
      { error: `Storage error: ${err instanceof Error ? err.message : String(err)}` },
      503
    );
  }
});

// ---- Import FROM an external OData feed (paginated, one page per request) ---
// The browser drives the loop: POST with { skip } and repeat with the returned
// `nextSkip` until `done` is true. Credentials live in Worker secrets.

app.post('/api/import-odata/:key', async (c) => {
  const schema = SCHEMA_BY_KEY[c.req.param('key')];
  if (!schema) return c.json({ error: 'Unknown table' }, 404);
  if (!ODATA_SOURCES[schema.key]) {
    return c.json({ error: `No OData source configured for '${schema.key}'.` }, 400);
  }

  let body: { skip?: number; top?: number; startSeq?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine — treat as first page
  }

  const src = resolveSource(schema, c.env as any);
  if (!src) return c.json({ error: 'No OData source configured.' }, 400);

  const skip = typeof body.skip === 'number' && body.skip >= 0 ? body.skip : 0;
  const top = typeof body.top === 'number' && body.top > 0 ? Math.min(body.top, 500) : 500;

  const page = await fetchOdataPage(src, skip, top);

  // Continue the `No` sequence across pages when caller does not supply it.
  const startSeq = typeof body.startSeq === 'number'
    ? body.startSeq
    : (await maxSeq(storeEnv(c), schema)) + 1;

  let result = { inserted: 0, skippedDuplicates: 0, received: 0 } as any;
  if (page.rows.length > 0) {
    const { cleaned } = cleanRecords(schema, page.headers, page.rows, startSeq);
    result = await appendRecords(storeEnv(c), schema, cleaned, `odata:${schema.key}`);
  }

  const fetched = page.rows.length;
  const nextSkip = skip + fetched;
  const nextSeq = startSeq + fetched;

  return c.json({
    ok: true,
    schemaKey: schema.key,
    skip,
    fetched,
    total: page.total,
    result,
    done: page.done || fetched === 0,
    nextSkip,
    nextSeq,
    odataFeed: `${baseUrl(c.req.url)}/odata/${entitySetName(schema)}`,
  });
});

// Report which schemas have an external OData source (for the UI).
app.get('/api/odata-sources', (c) => {
  return c.json({ keys: Object.keys(ODATA_SOURCES) });
});

// Lightweight: return the current maxSeq so the client can continue numbering.
app.get('/api/maxseq/:key', async (c) => {
  const schema = SCHEMA_BY_KEY[c.req.param('key')];
  if (!schema) return c.json({ error: 'Unknown table' }, 404);
  const m = await maxSeq(storeEnv(c), schema);
  return c.json({ key: schema.key, maxSeq: m });
});

// ---- Master data browse ----------------------------------------------------

app.get('/api/stats', async (c) => {
  const base = baseUrl(c.req.url);
  return cachedJson(c, async () => {
    const stats = await tableStats(storeEnv(c), SCHEMAS);
    return {
      schemas: stats.map((s) => ({
        ...s,
        odataFeed: `${base}/odata/${s.key}`,
        apiData: `${base}/api/data/${s.key}`,
        csv: `${base}/api/export/${s.key}.csv`,
      })),
      odataService: `${base}/odata/`,
      odataMetadata: `${base}/odata/$metadata`,
    };
  });
});

// Live freshness: when did the MIS sync last run, and how many rows do we hold?
// Surfaced as a "Data live — synced X min ago" badge so users can SEE the
// 5-minute pipeline is alive even when distinct-count KPIs move slowly.
app.get('/api/freshness', async (c) => {
  try {
    const st = await misSyncStatus(storeEnv(c));
    const lastRun: string | null = (st as any).last_run ?? null;
    let ageMinutes: number | null = null;
    if (lastRun) ageMinutes = Math.max(0, Math.round((Date.now() - new Date(lastRun).getTime()) / 60000));
    // Backfill gap: how many training rows the MIS reports vs how many we hold.
    // When we're behind (e.g. the MIS was down and the deep-page backfill hasn't
    // finished a full pass), recent-month trainee KPIs read a little LOW until we
    // converge — so we surface it as an honest "catching up" note on the UI.
    const total = Number((st as any).total_records ?? 0) || 0;
    const held = Number((st as any).atRowsCount ?? 0) || 0;
    const gap = total > 0 ? Math.max(0, total - held) : 0;
    // Small tolerance: <1% (or <2k rows) is "converged" — normal 5-min churn.
    const catchingUp = total > 0 && gap > Math.max(2000, Math.round(total * 0.01));
    return c.json({
      ok: true,
      last_run: lastRun,
      age_minutes: ageMinutes,
      total_records: total || null,
      at_rows: held || null,
      last_upserted: (st as any).last_upserted ?? null,
      // "live" if the cron ran within the last ~12 min (2+ missed cycles = stale)
      live: ageMinutes !== null && ageMinutes <= 12,
      // backfill convergence — drives the "catching up" note on dashboards
      backfill: {
        held,
        mis_total: total,
        gap,
        pct: total > 0 ? Math.round((held / total) * 1000) / 10 : null,
        catching_up: catchingUp,
      },
    }, 200, { 'Cache-Control': 'no-store' });
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 200, { 'Cache-Control': 'no-store' });
  }
});

// ---------------------------------------------------------------------------
// Cache warmer — called by the VM cron right after each 5-min MIS sync.
//
// This is the piece that actually PREVENTS the "Exceeded CPU Time Limits"
// outages. The heavy first-compute of each dashboard aggregation (10-30s over
// ~765k rows on the slow Postgres VM) is paid HERE, server-to-server, once per
// 5-min window — NOT by a browser. It self-fetches each heavy endpoint so the
// normal cachedJson() path computes and stores the result in the edge cache.
// After this runs, every real dashboard request is a near-instant cache HIT,
// and stale-while-revalidate keeps refreshing in the background so users never
// wait on a cold compute again. Fire-and-forget with waitUntil so the warmer
// itself returns immediately (it must never block or itself time out).
app.all('/api/warm-cache', async (c) => {
  const base = baseUrl(c.req.url);
  // Current calendar month range (drives the default dashboard views).
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthFrom = `${y}-${pad(m + 1)}-01`;
  const monthEnd = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const monthTo = `${y}-${pad(m + 1)}-${pad(monthEnd)}`;
  const dr = `from=${monthFrom}&to=${monthTo}`;
  const ll = `dateFrom=${monthFrom}&dateTo=${monthTo}`;

  // Heavy endpoints to pre-warm, in both "all time" (no filter) and current
  // month flavours — the two selections the dashboards open with. Grouped by a
  // warm-key so the cron can warm only the heaviest few every tick (?only=...)
  // and pay the full warm just once per rotation.
  const groups: Record<string, string[]> = {
    cluster: [`/api/stats`, `/api/cluster-trainings`, `/api/cluster-trainings?${dr}`],
    newyouth: [`/api/new-youth`, `/api/new-youth?${dr}`, `/api/frontliners`, `/api/frontliners?${dr}`],
    distribution: [`/api/distribution`, `/api/distribution?${dr}`, `/api/shg-distribution`, `/api/shg-distribution?${dr}`],
    shgprofiling: [`/api/shg-profiling`, `/api/shg-profiling?${dr}`],
    isla: [`/api/isla`, `/api/isla?${dr}`],
    sales: [`/api/value-chain-sales`, `/api/value-chain-sales?${dr}`, `/api/sales`, `/api/sales?${dr}`, `/api/poultry-sales`, `/api/poultry-sales?${dr}`],
    production: [`/api/production`, `/api/production?${dr}`],
    itemsnotsold: [`/api/items-not-sold`],
    localleverage: [`/api/local-leverage`, `/api/local-leverage?${ll}`],
    report: [`/api/report`, `/api/report?${dr}`],
  };
  const onlyParam = (c.req.query('only') || '').trim();
  const onlyKeys = onlyParam
    ? onlyParam.split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(groups);
  const paths = onlyKeys.flatMap((k) => groups[k] || []);

  // Warm by making REAL external requests to each endpoint's public URL. Each
  // such request is a SEPARATE Worker invocation with its OWN CPU/subrequest
  // budget, so the heavy first-compute of every dashboard is isolated and can
  // never blow a single invocation's limit (which is what warming them all
  // in-process would risk). We deliberately do NOT wait for the responses:
  // firing the request is enough to trigger the compute-and-store on the other
  // side. A tiny stagger keeps the slow VM Postgres from being stampeded.
  const warmAll = async () => {
    const results: Record<string, string> = {};
    for (const p of paths) {
      try {
        // Fully await each downstream request so its compute-and-store COMPLETES
        // (each is a separate Worker invocation with its own CPU budget, so a
        // slow one can't blow this warmer's budget). We read the status only.
        const r = await fetch(base + p, { method: 'GET', headers: { 'X-Warm': '1' } });
        results[p] = String(r.status);
      } catch (e: any) {
        results[p] = 'err:' + String(e?.message || e).slice(0, 30);
      }
    }
    return results;
  };

  const wait = c.req.query('wait') === '1';
  if (wait) {
    const results = await warmAll();
    return c.json({ ok: true, warmed: paths.length, results }, 200, { 'Cache-Control': 'no-store' });
  }
  const ctx = c.executionCtx ?? (c as any).ctx;
  if (ctx?.waitUntil) ctx.waitUntil(warmAll());
  else warmAll(); // fire and forget
  return c.json({ ok: true, warming: paths.length, month: { monthFrom, monthTo } }, 200, { 'Cache-Control': 'no-store' });
});

app.get('/api/data/:key', async (c) => {
  const schema = SCHEMA_BY_KEY[c.req.param('key')];
  if (!schema) return c.json({ error: 'Unknown table' }, 404);
  const top = Number(c.req.query('top') ?? 50);
  const skip = Number(c.req.query('skip') ?? 0);
  const { rows, count } = await queryRecords(storeEnv(c), schema, { top, skip });
  return c.json({ key: schema.key, columns: schema.columns.map((x) => x.name), count, rows });
});

app.get('/api/export/:file', async (c) => {
  const file = c.req.param('file');
  const key = file.replace(/\.csv$/i, '');
  const schema = SCHEMA_BY_KEY[key];
  if (!schema) return c.json({ error: 'Unknown table' }, 404);
  const { rows } = await queryRecords(storeEnv(c), schema, { top: 50000 });
  const cols = schema.columns.map((x) => x.name);
  const esc = (v: string) => {
    if (v == null) return '';
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map((cn) => esc(r[cn] ?? '')).join(','));
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${key}.csv"`,
    },
  });
});

app.post('/api/reset/:key', async (c) => {
  const schema = SCHEMA_BY_KEY[c.req.param('key')];
  if (!schema) return c.json({ error: 'Unknown table' }, 404);
  await clearTable(storeEnv(c), schema);
  return c.json({ ok: true, cleared: schema.key });
});

// Backfill fill-from columns (e.g. docId) on rows stored before the rule
// existed. POST /api/backfill-docid           -> all schemas
// POST /api/backfill-docid/:key               -> one schema
app.post('/api/backfill-docid/:key?', async (c) => {
  const key = c.req.param('key');
  const targets = key ? [SCHEMA_BY_KEY[key]].filter(Boolean) : SCHEMAS;
  if (key && targets.length === 0) return c.json({ error: 'Unknown table' }, 404);
  const report: Record<string, { updated: number; pairs: string[] }> = {};
  let total = 0;
  for (const s of targets) {
    const r = await backfillFilled(storeEnv(c), s);
    if (r.pairs.length) report[s.key] = r;
    total += r.updated;
  }
  return c.json({ ok: true, totalUpdated: total, report });
});

// ---- OData v4 endpoints (for Power BI) -------------------------------------

// Power BI's OData connector is strict: JSON payloads MUST advertise the OData
// content type and version, otherwise it rejects the URL with
// "neither points to an OData service or a feed".
const ODATA_JSON = 'application/json;odata.metadata=minimal;charset=utf-8';
function odataJson(c: any, obj: unknown) {
  return c.body(JSON.stringify(obj), 200, {
    'Content-Type': ODATA_JSON,
    'OData-Version': '4.0',
    'Access-Control-Allow-Origin': '*',
    // Master sheets (Excel / Power BI) should never serve data older than 5 min.
    // max-age caps any downstream/edge caching; must-revalidate forbids stale
    // reuse, so a refresh after 5 min always re-fetches live rows from Oracle.
    'Cache-Control': 'public, max-age=300, must-revalidate',
  });
}

app.get('/odata', (c) => odataJson(c, serviceDocument(baseUrl(c.req.url))));
app.get('/odata/', (c) => odataJson(c, serviceDocument(baseUrl(c.req.url))));

app.get('/odata/$metadata', (c) =>
  c.body(metadataDocument(), 200, {
    'Content-Type': 'application/xml;charset=utf-8',
    'OData-Version': '4.0',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300, must-revalidate',
  })
);

app.get('/odata/:set', async (c) => {
  const set = c.req.param('set');
  const schema = SCHEMAS.find((s) => entitySetName(s) === set);
  if (!schema) return c.json({ error: `No entity set '${set}'` }, 404);

  const top = Math.min(Number(c.req.query('$top') ?? 5000), 20000);
  const skip = Number(c.req.query('$skip') ?? 0);
  const orderby = c.req.query('$orderby');
  const includeCount = c.req.query('$count') === 'true';

  let orderCol: string | undefined;
  let desc = false;
  if (orderby) {
    const [col, dir] = orderby.split(/\s+/);
    orderCol = schema.columns.find((x) => x.name === col || entitySetName(schema))?.name ? col : undefined;
    desc = (dir ?? '').toLowerCase() === 'desc';
  }

  const { rows, count } = await queryRecords(storeEnv(c), schema, {
    top, skip, orderBy: orderCol, desc,
  });

  let nextLink: string | undefined;
  if (rows.length === top && skip + top < count) {
    const u = new URL(c.req.url);
    u.searchParams.set('$skip', String(skip + top));
    nextLink = u.toString();
  }

  const body = entitySetResponse(baseUrl(c.req.url), schema, rows, count, includeCount, nextLink);
  return odataJson(c, body);
});

// ---- Frontend --------------------------------------------------------------

// Home is now the KPI overview dashboard. The upload / OData tools page moved
// to /tools (with /upload kept as a friendly alias).
app.get('/', (c) => c.html(renderHome(baseUrl(c.req.url))));
app.get('/tools', (c) => c.html(renderPage(baseUrl(c.req.url))));
app.get('/upload', (c) => c.html(renderPage(baseUrl(c.req.url))));

// ---- AI features (Cloudflare Workers AI) ----------------------------------

// AI Observation page (anomaly digest + ask-your-data console).
app.get('/ai-observation', (c) => c.html(renderAiObservation(baseUrl(c.req.url))));

// Ask your data: natural-language question -> generated SQL -> answer.
app.post('/api/ai/ask', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const question = String(body.question || '').slice(0, 500);
    const r = await askData(storeEnv(c), question);
    return c.json(r);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// AI Observation: week-over-week anomaly signals + AI digest. Cached briefly
// because the model call + several SQL sweeps are relatively expensive.
app.get('/api/ai/observation', async (c) => {
  return cachedJson(c, () => anomalies(storeEnv(c)), 600); // 10-min TTL
});

// Report narrative summary (used by Weekly / Programme reports). The client
// posts the KPI JSON it already fetched so we don't recompute it here.
app.post('/api/ai/narrate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.report || 'report').slice(0, 80);
    const summary = await narrate(storeEnv(c), name, body.kpis ?? {});
    return c.json({ summary });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// ---- Cluster Trainings dashboard ------------------------------------------

// Page (Power BI-style dashboard).
app.get('/cluster-trainings', (c) => c.html(renderClusterTrainings(baseUrl(c.req.url))));

// NEW trainees dashboard built from the attendance OData feeds (trainees_v2).
app.get('/trainees-v2', (c) => c.html(renderTraineesV2(baseUrl(c.req.url))));
app.get('/api/trainees-v2', async (c) => {
  try {
    const q = c.req.query();
    const districts = (q.districts || '').split(',').map((s) => s.trim()).filter(Boolean);
    const res = await traineesV2Summary(storeEnv(c), {
      districts: districts.length ? districts : undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      training_type: q.training_type || undefined,
    });
    return c.json(res);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// Training deep-dive tab: PSRP / cornerstone / leadership etc. by district & date.
app.get('/trainees-v2/details', (c) => c.html(renderTrainingDetails(baseUrl(c.req.url))));
app.get('/api/trainees-v2/details', async (c) => {
  try {
    const q = c.req.query();
    const districts = (q.districts || '').split(',').map((s) => s.trim()).filter(Boolean);
    const res = await traineesV2DetailBreakdown(storeEnv(c), {
      districts: districts.length ? districts : undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    });
    return c.json(res);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// Aggregated data feed for the dashboard (KPIs + bar chart), with filters.
app.get('/api/cluster-trainings', async (c) => {
  const q = c.req.query();
  const districts = (q.districts || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cachedJson(c, () => clusterTrainings(storeEnv(c), {
    districts,
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Rebuild the summary table (run after new uploads change the data).
app.post('/api/cluster-trainings/refresh', async (c) => {
  const n = await refreshClusterSummary(storeEnv(c));
  return c.json({ ok: true, summaryRows: n });
});

// ---- Monthly New Youth Reached dashboard ----------------------------------

// Page (Power BI-style "first touch" dashboard).
app.get('/monthly-new-youth', (c) => c.html(renderMonthlyNewYouth(baseUrl(c.req.url))));

// Aggregated data feed (10 KPIs + area chart series), with filters.
app.get('/api/new-youth', async (c) => {
  const q = c.req.query();
  const districts = (q.districts || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cachedJson(c, () => newYouthDash(storeEnv(c), {
    districts,
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Rebuild the new_youth first-touch table (run after new uploads change data).
app.post('/api/new-youth/refresh', async (c) => {
  const n = await refreshNewYouth(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Trainings by Frontliners dashboard -----------------------------------

// Page (TRAININGS table by data_collector).
app.get('/frontliners', (c) => c.html(renderFrontliners(baseUrl(c.req.url))));

// Aggregated data feed (per-collector KPIs + list columns), with filters.
app.get('/api/frontliners', async (c) => {
  const q = c.req.query();
  const districts = (q.districts || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const collectors = (q.collectors || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cachedJson(c, () => frontlinerDash(storeEnv(c), {
    districts,
    collectors,
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Rebuild the frontliner_rows table (heavy; run after uploads change data).
app.post('/api/frontliners/refresh', async (c) => {
  const n = await refreshFrontliners(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Distribution to Participants dashboard -------------------------------

// Page (grouped-by-SHG_Name distribution table + KPI cards).
// Options are fetched server-side and embedded so the slicers always populate.
app.get('/distribution', async (c) => {
  let opts = {};
  try { opts = await distributionOptions(storeEnv(c)); } catch { /* fall back to client fetch */ }
  return c.html(renderDistribution(baseUrl(c.req.url), opts));
});

// Aggregated data feed (KPIs + grouped table + slicer lists), with filters.
app.get('/api/distribution', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => distributionDash(storeEnv(c), {
    districts: split(q.districts),
    materials: split(q.materials),
    units: split(q.units),
    submitters: split(q.submitters),
    suppliers: split(q.suppliers),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Lightweight slicer option lists (loaded independently so slicers always fill).
app.get('/api/distribution/options', async (c) => {
  const data = await distributionOptions(storeEnv(c));
  return c.json(data);
});

// Per-participant detail rows for one SHG group (expandable hierarchy).
app.get('/api/distribution/detail', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const rows = await distributionDetail(storeEnv(c), q.shg || '', {
    districts: split(q.districts),
    materials: split(q.materials),
    units: split(q.units),
    submitters: split(q.submitters),
    suppliers: split(q.suppliers),
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json({ rows });
});

// Rebuild the distribution_rows join table (run after uploads change data).
app.post('/api/distribution/refresh', async (c) => {
  const n = await refreshDistribution(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Direct-from-system distribution (OData) --------------------------------
// Pull all 4 distribution OData feeds and rebuild the join tables the three
// distribution dashboards read. Run from the VM cron each cycle, or manually.
// A single Worker request can't sync all ~85k rows within CPU/time limits, so
// the cron drives one phase per call: ?feed=events|shg|participants|agrihubs|rebuild
// (default 'rebuild'). Chain them in order, ending with rebuild.
app.all('/api/distribution-odata/sync', async (c) => {
  const feed = (c.req.query('feed') || 'rebuild') as any;
  const valid = ['events', 'shg', 'participants', 'agrihubs', 'rebuild', 'all'];
  if (!valid.includes(feed)) {
    return c.json({ ok: false, error: `feed must be one of ${valid.join('|')}` }, 400);
  }
  const pSkip = parseInt(c.req.query('skip') || '0', 10) || 0;
  const pLimit = parseInt(c.req.query('limit') || '20000', 10) || 20000;
  try {
    const res = await syncDistributionOData(storeEnv(c), feed, pSkip, pLimit);
    return c.json({ phase: feed, ...res });
  } catch (e: any) {
    return c.json({ ok: false, phase: feed, error: String(e?.message || e) }, 500);
  }
});

// Diagnostic: current distribution_rows/shg_distribution_rows columns + the
// definitions of the RPC functions that read them, so we can confirm the
// rebuilt tables line up with what the dashboards expect.
app.get('/api/distribution-odata/diag', async (c) => {
  const env = storeEnv(c);
  const out: any = {};
  try {
    for (const t of ['distribution_rows', 'shg_distribution_rows', 'agrihub_distribution_rows',
      'odata_dist_events', 'odata_dist_participants', 'odata_dist_shg', 'odata_dist_agrihubs']) {
      try {
        const cols = await neonQuery(env,
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
        const cnt = await neonQuery(env, `SELECT COUNT(*)::int AS c FROM public.${t}`).catch(() => [{ c: null }]);
        out[t] = { columns: cols, rows: cnt?.[0]?.c ?? null };
      } catch (e: any) { out[t] = { error: String(e?.message || e) }; }
    }
    // Join-overlap probe: how many participant submissions match an event / SHG.
    try {
      const probe = await neonQuery(env, `SELECT
        (SELECT COUNT(*) FROM public.odata_dist_participants p JOIN public.odata_dist_events e ON e.doc_id=p.submission_id)::int AS part_join_event,
        (SELECT COUNT(*) FROM public.odata_dist_participants p WHERE EXISTS (SELECT 1 FROM public.odata_dist_shg s WHERE s.submission_id=p.submission_id))::int AS part_has_shg,
        (SELECT COUNT(DISTINCT submission_id) FROM public.odata_dist_shg)::int AS shg_distinct_sub,
        (SELECT COUNT(DISTINCT submission_id) FROM public.odata_dist_participants)::int AS part_distinct_sub,
        (SELECT COUNT(DISTINCT shg_name) FROM public.distribution_rows)::int AS distrows_distinct_shg,
        (SELECT COUNT(*) FROM public.odata_dist_events WHERE doc_id LIKE 'uuid:%')::int AS events_uuid,
        (SELECT COUNT(*) FROM public.odata_dist_participants WHERE submission_id LIKE 'uuid:%')::int AS part_sub_uuid`);
      out['join_probe'] = probe?.[0] ?? null;
    } catch (e: any) { out['join_probe'] = { error: String(e?.message || e) }; }
    for (const fn of ['distribution_dash', 'shg_distribution_dash', 'distribution_options',
      'shg_distribution_options', 'distribution_detail']) {
      try {
        const def = await neonQuery(env, `SELECT pg_get_functiondef(p.oid) AS def
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname=$1 LIMIT 1`, [fn]);
        out[`fn_${fn}`] = def?.[0]?.def ?? '(not found)';
      } catch (e: any) { out[`fn_${fn}`] = { error: String(e?.message || e) }; }
    }
    return c.json(out);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// Ops diagnostic: dump a function definition. Token-gated so DB internals are
// not publicly readable.   /api/_fn?name=mel_cf_report&token=...
app.get('/api/_fn', async (c) => {
  const env = storeEnv(c);
  if (c.req.query('token') !== 'shg-fix-2026') return c.json({ error: 'forbidden' }, 403);
  const name = c.req.query('name') || '';
  try {
    const rows = await neonQuery(env, `SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1`, [name]);
    return c.text(rows.map((r) => r.def).join('\n\n-- ---- overload ----\n\n') || '(not found)');
  } catch (e: any) { return c.json({ error: String(e?.message || e) }, 500); }
});

// Ops diagnostic: run a guarded read-only SELECT. Token-gated.
//   /api/_q?sql=SELECT ...&token=...
app.get('/api/_q', async (c) => {
  const env = storeEnv(c);
  if (c.req.query('token') !== 'shg-fix-2026') return c.json({ error: 'forbidden' }, 403);
  const sql = c.req.query('sql') || '';
  if (!/^\s*(select|with)\b/i.test(sql) || /;/.test(sql)) {
    return c.json({ error: 'only a single SELECT/WITH statement allowed' }, 400);
  }
  try {
    const rows = await neonQuery(env, sql);
    return c.json({ rows });
  } catch (e: any) { return c.json({ error: String(e?.message || e) }, 500); }
});

// Ops: run DDL (CREATE FUNCTION / VIEW etc.). POST body = raw SQL.
// Token-gated so it cannot be triggered casually.
app.post('/api/_ddl', async (c) => {
  const env = storeEnv(c);
  if (c.req.query('token') !== 'shg-fix-2026') {
    return c.json({ error: 'forbidden' }, 403);
  }
  const sql = await c.req.text();
  if (!sql || !sql.trim()) return c.json({ error: 'empty body' }, 400);
  try {
    await neonQuery(env, sql);
    return c.json({ ok: true });
  } catch (e: any) { return c.json({ error: String(e?.message || e) }, 500); }
});

// ---- Distribution to SHGs dashboard (shg_group ⋈ distribution_form_v2) -----

// Page (grouped-by-SHG_Group_Name distribution table + KPI cards).
// Options are fetched server-side and embedded so the slicers always populate.
app.get('/shg-distribution', async (c) => {
  let opts = {};
  try { opts = await shgDistributionOptions(storeEnv(c)); } catch { /* fall back to client fetch */ }
  return c.html(renderShgDistribution(baseUrl(c.req.url), opts));
});

// Aggregated data feed (KPIs + grouped table + slicer lists), with filters.
app.get('/api/shg-distribution', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => shgDistributionDash(storeEnv(c), {
    districts: split(q.districts),
    materials: split(q.materials),
    units: split(q.units),
    submitters: split(q.submitters),
    suppliers: split(q.suppliers),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Lightweight slicer option lists (loaded independently so slicers always fill).
app.get('/api/shg-distribution/options', async (c) => {
  const data = await shgDistributionOptions(storeEnv(c));
  return c.json(data);
});

// Per-record detail rows for one SHG group (expandable hierarchy).
app.get('/api/shg-distribution/detail', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const rows = await shgDistributionDetail(storeEnv(c), q.shg || '', {
    districts: split(q.districts),
    materials: split(q.materials),
    units: split(q.units),
    submitters: split(q.submitters),
    suppliers: split(q.suppliers),
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json({ rows });
});

// Rebuild the shg_distribution_rows join table (run after uploads change data).
app.post('/api/shg-distribution/refresh', async (c) => {
  const n = await refreshShgDistribution(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- SHG Profiling dashboard (shg_groups_view ⋈ Dim_SHG) -------------------

// Page (server-embeds slicer options so they populate on first paint).
app.get('/shg-profiling', async (c) => {
  let opts = {};
  try { opts = await shgProfilingOptions(storeEnv(c)); } catch { /* client fetch fallback */ }
  return c.html(renderShgProfiling(baseUrl(c.req.url), opts));
});

// Aggregated data feed (VS KPIs + one-row-per-SHG table + slicer lists).
app.get('/api/shg-profiling', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const numOrU = (s?: string) => {
    const n = Number(s);
    return s != null && s !== '' && Number.isFinite(n) ? n : undefined;
  };
  return cachedJson(c, () => shgProfilingDash(storeEnv(c), {
    districts: split(q.districts),
    profilers: split(q.profilers),
    from: q.from || undefined,
    to: q.to || undefined,
    totalMin: numOrU(q.totalMin),
    totalMax: numOrU(q.totalMax),
  }));
});

// Lightweight slicer option lists.
app.get('/api/shg-profiling/options', async (c) => {
  const data = await shgProfilingOptions(storeEnv(c));
  return c.json(data);
});

// Rebuild the shg_profiling_rows table (run after uploads / imports change data).
app.post('/api/shg-profiling/refresh', async (c) => {
  const n = await refreshShgProfiling(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- ISLA (SHGs SAVING IN A CLUSTER) --------------------------------------
app.get('/isla', async (c) => {
  let opts = {};
  try { opts = await islaOptions(storeEnv(c)); } catch { /* client fetch fallback */ }
  return c.html(renderIsla(baseUrl(c.req.url), opts));
});

// Aggregated data feed (SHG_Saving KPI + table grouped by shg_name + slicers).
app.get('/api/isla', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => islaDash(storeEnv(c), {
    districts: split(q.districts),
    profilers: split(q.profilers),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Lightweight slicer option lists.
app.get('/api/isla/options', async (c) => {
  const data = await islaOptions(storeEnv(c));
  return c.json(data);
});

// Rebuild the isla_final_rows table (run after uploads / imports change data).
app.post('/api/isla/refresh', async (c) => {
  const n = await refreshIsla(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Value-chain total sales (home dashboard panel) -----------------------
app.get('/api/value-chain-sales', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => valueChainSales(storeEnv(c), {
    districts: split(q.districts),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// ---- Youth in Production (Mainly Horticulture) -----------------------------
app.get('/production', async (c) => {
  let opts = {};
  try { opts = await productionOptions(storeEnv(c)); } catch { /* client fetch fallback */ }
  return c.html(renderProduction(baseUrl(c.req.url), opts));
});

// Aggregated data feed (3 KPIs + table grouped by shg_name + slicers).
app.get('/api/production', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => productionDash(storeEnv(c), {
    districts: split(q.districts),
    valuechains: split(q.valuechains),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Lightweight slicer option lists.
app.get('/api/production/options', async (c) => {
  const data = await productionOptions(storeEnv(c));
  return c.json(data);
});

// Per-participant detail rows for one SHG (expandable "+" hierarchy).
app.get('/api/production/detail', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const shg = q.shg || '';
  if (!shg) return c.json({ rows: [] });
  const data = await productionDetail(storeEnv(c), shg, {
    districts: split(q.districts),
    valuechains: split(q.valuechains),
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
});

// Rebuild the production_rows table (run after uploads / imports change data).
app.post('/api/production/refresh', async (c) => {
  const n = await refreshProduction(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Sales in Horticulture/Oilseeds ----------------------------------------
app.get('/sales', async (c) => {
  let opts = {};
  try { opts = await salesOptions(storeEnv(c)); } catch { /* client fetch fallback */ }
  return c.html(renderSales(baseUrl(c.req.url), opts));
});

// Aggregated data feed (3 sales KPIs + table grouped by shg_name + slicers).
app.get('/api/sales', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => salesDash(storeEnv(c), {
    districts: split(q.districts),
    valuechains: split(q.valuechains),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Lightweight slicer option lists.
app.get('/api/sales/options', async (c) => {
  const data = await salesOptions(storeEnv(c));
  return c.json(data);
});

// Per-participant detail rows for one SHG (expandable "+" hierarchy).
app.get('/api/sales/detail', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const shg = q.shg || '';
  if (!shg) return c.json({ rows: [] });
  const data = await salesDetail(storeEnv(c), shg, {
    districts: split(q.districts),
    valuechains: split(q.valuechains),
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
});

// Rebuild the sales_rows table (run after uploads / imports change data).
app.post('/api/sales/refresh', async (c) => {
  const n = await refreshSales(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Poultry Sales (production_and_marketing_tool: marketing + poultry) -----
app.get('/poultry-sales', async (c) => {
  let opts = {};
  try { opts = await poultrySalesOptions(storeEnv(c)); } catch { /* client fetch fallback */ }
  return c.html(renderPoultrySales(baseUrl(c.req.url), opts));
});

// Aggregated data feed (KPIs + table grouped by shg_name + slicers).
app.get('/api/poultry-sales', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => poultrySalesDash(storeEnv(c), {
    districts: split(q.districts),
    poultry: split(q.poultry),
    profilers: split(q.profilers),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// Lightweight slicer option lists.
app.get('/api/poultry-sales/options', async (c) => {
  const data = await poultrySalesOptions(storeEnv(c));
  return c.json(data);
});

// Rebuild the poultry_sales_rows table (run after uploads / imports change data).
app.post('/api/poultry-sales/refresh', async (c) => {
  const n = await refreshPoultrySales(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Items Not Sold (distribution ⋈ marketing, Has_Sold='No') --------------
app.get('/items-not-sold', async (c) => {
  let opts = {};
  try { opts = await itemsNotSoldOptions(storeEnv(c)); } catch { /* client fetch fallback */ }
  return c.html(renderItemsNotSold(baseUrl(c.req.url), opts));
});

// Aggregated data feed (KPIs + detail rows + slicers).
app.get('/api/items-not-sold', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const numOrNull = (s?: string) => {
    const n = Number(s);
    return s != null && s !== '' && Number.isFinite(n) ? n : null;
  };
  return cachedJson(c, () => itemsNotSoldDash(storeEnv(c), {
    valuechains: split(q.valuechains),
    districts: split(q.districts),
    daysMin: numOrNull(q.daysMin) ?? undefined,
    daysMax: numOrNull(q.daysMax) ?? undefined,
  }));
});

// Lightweight slicer option lists.
app.get('/api/items-not-sold/options', async (c) => {
  const data = await itemsNotSoldOptions(storeEnv(c));
  return c.json(data);
});

// Rebuild the items_not_sold_rows table (run after uploads / imports change data).
app.post('/api/items-not-sold/refresh', async (c) => {
  const n = await refreshItemsNotSold(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Local Leverage (contribution_kind NLP categories) --------------------
app.get('/local-leverage', async (c) => {
  let opts = {};
  try { opts = await localLeverageOptions(storeEnv(c)); } catch { /* client fetch fallback */ }
  return c.html(renderLocalLeverage(baseUrl(c.req.url), opts));
});

// Aggregated data feed (KPIs + category breakdown + detail rows + slicers).
app.get('/api/local-leverage', async (c) => {
  const q = c.req.query();
  const split = (s?: string) =>
    (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => localLeverageDash(storeEnv(c), {
    districts: split(q.districts),
    dateFrom: q.dateFrom || undefined,
    dateTo: q.dateTo || undefined,
  }));
});

// Lightweight slicer option lists.
app.get('/api/local-leverage/options', async (c) => {
  const data = await localLeverageOptions(storeEnv(c));
  return c.json(data);
});

// Rebuild the local_leverage_rows table (run after uploads / imports change data).
app.post('/api/local-leverage/refresh', async (c) => {
  const n = await refreshLocalLeverage(storeEnv(c));
  return c.json({ ok: true, rows: n });
});

// ---- Report Dashboard: Targets vs Achieved ---------------------------------
app.get('/report', (c) => c.html(renderReport(baseUrl(c.req.url))));
app.get('/api/report', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return cachedJson(c, () => melReportDash(storeEnv(c), {
    districts: split(q.districts),
    from: q.from || undefined,
    to: q.to || undefined,
  }));
});

// ---- Weekly Report (Mon–Sun summary of all indicators) ---------------------
app.get('/weekly-report', (c) => c.html(renderWeeklyReport(baseUrl(c.req.url))));
app.get('/api/weekly', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const data = await weeklyReport(storeEnv(c), {
    districts: split(q.districts),
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
});

// ---- CF (Community Facilitator) Report Card --------------------------------
app.get('/cf-report', (c) => c.html(renderCfReport(baseUrl(c.req.url))));
app.get('/api/cf-report', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const data = await cfReport(storeEnv(c), {
    districts: split(q.districts),
    staff: q.staff || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
});

// ---- CF Premier League (ranks all CFs in a cluster by overall grade) -------
app.get('/cf-premier-league', (c) => c.html(renderCfPremierLeague(baseUrl(c.req.url))));
app.get('/api/cf-premier-league', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  // Accept either an explicit districts list or a cluster key (resolved here).
  const districts = q.districts ? split(q.districts) : clusterDistricts(q.cluster);
  const data = await cfPremierLeague(storeEnv(c), {
    districts,
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
});

// ---- Programme Report (auto-filled SAYE Monthly/Quarterly Word report) ------
app.get('/programme-report', (c) => c.html(renderProgrammeReport(baseUrl(c.req.url))));
app.get('/api/programme-report', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const data = await programmeReport(storeEnv(c), {
    districts: split(q.districts),
    from: q.from || undefined,
    to: q.to || undefined,
    qFrom: q.qFrom || undefined,
    qTo: q.qTo || undefined,
  });
  return c.json(data);
});

// ---- Programme Report: server-side filled .docx download -------------------
// Fetches the template, replaces every token (tables + KPI + narratives + meta)
// and re-zips with fflate (media copied STORED). Reliable, unlike the browser
// JSZip path which stalled recompressing the 4 MB template.
app.get('/api/programme-report/docx', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const districts = split(q.districts);
  const cluster = q.cluster || 'iganga';
  const mFrom = q.from || undefined;
  const qFrom = q.qFrom || undefined;
  const qTo = q.qTo || undefined;

  const data = await programmeReport(storeEnv(c), {
    districts,
    from: mFrom,
    to: q.to || undefined,
    qFrom,
    qTo,
  });

  // Load the template. Prefer the ASSETS binding (avoids a self-fetch that can
  // deadlock the single-threaded local wrangler dev server); fall back to an
  // absolute origin fetch if the binding is unavailable.
  const assetPath = '/static/programme_template.docx';
  let tplRes: Response;
  const assets = (c.env as any).ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    tplRes = await assets.fetch(new URL(assetPath, baseUrl(c.req.url)).toString());
  } else {
    tplRes = await fetch(baseUrl(c.req.url) + assetPath);
  }
  if (!tplRes.ok) {
    return c.text('Template load failed (' + tplRes.status + ')', 500);
  }
  const tplBytes = new Uint8Array(await tplRes.arrayBuffer());

  const tokens = buildDocTokens(data, cluster, mFrom, qFrom, qTo);

  // AI executive-summary narrative, injected into the {{narr.ai_summary}}
  // paragraph. Runs server-side (Cloudflare Workers AI) so the DOWNLOADED .docx
  // actually contains AI prose (not just the canned template sentences). If the
  // AI call fails we fall back to a deterministic one-liner so the download
  // never breaks.
  const coordName = tokens['coord.name'] || '';
  const clusterLabel = cluster.charAt(0).toUpperCase() + cluster.slice(1);
  try {
    const aiKpis = {
      cluster: clusterLabel,
      cluster_coordinator: coordName,
      reporting_month: tokens['meta.month'],
      reporting_quarter: tokens['meta.quarter'],
      youth_reached_month: tokens['narr.reached'],
      female_month: tokens['narr.female'],
      pwd_month: tokens['narr.pwd'],
      shgs_profiled: tokens['narr.shgs'],
      savers: tokens['narr.savers'],
      amount_saved_ugx: tokens['narr.saved'],
      loans_ugx: tokens['narr.loans'],
      birds_distributed: tokens['narr.birds_dist'],
      goats_distributed: tokens['narr.goats'],
      horticulture_sales_ugx: tokens['narr.hort_sales'],
      poultry_sales_ugx: tokens['narr.poultry_sales'],
    };
    let prose = await narrate(
      storeEnv(c),
      `SAYE ${clusterLabel} cluster programme report for ${tokens['meta.month'] || 'the period'}`,
      aiKpis
    );
    prose = (prose || '').trim();
    if (prose) {
      // Prefix with the coordinator lead-in the user asked for.
      tokens['narr.ai_summary'] =
        `Cluster: ${clusterLabel}. Cluster Coordinator: ${coordName}. ` + prose;
    }
  } catch (e) {
    tokens['narr.ai_summary'] =
      `Cluster: ${clusterLabel} (Coordinator: ${coordName}). During ${tokens['meta.month'] || 'the reporting period'} the cluster reached ${tokens['narr.reached'] || 0} youth across ${tokens['narr.shgs'] || 0} new SHGs.`;
  }

  const out = generateDocx(tplBytes, tokens);

  const fname = 'SAYE_Programme_Report_' + (mFrom || 'report') + '.docx';
  return new Response(out, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
});

app.get('/api/cf-report/staff', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const data = await cfStaffList(storeEnv(c), { districts: split(q.districts) });
  return c.json(data);
});

// ---- Youth in Work (combined_job_tracking_tool_view) -----------------------
app.get('/youth-in-work', (c) => c.html(renderYouthInWork(baseUrl(c.req.url))));
app.get('/api/youth-in-work', async (c) => {
  const q = c.req.query();
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const data = await youthInWorkDash(storeEnv(c), {
    districts: split(q.districts),
    from: q.from || undefined,
    to: q.to || undefined,
    // Optional CF filter: pipe-joined normalized name keys (from the CF report).
    staff: (q.staff || '').split('|').map((x) => x.trim()).filter(Boolean),
  });
  return c.json(data);
});
// Rebuild the job_tracking_rows fact table (call after a MIS sync of the view).
app.all('/api/youth-in-work/refresh', async (c) => {
  try {
    const rows = await refreshJobTracking(storeEnv(c));
    return c.json({ ok: true, rows });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || String(e) }, 500);
  }
});

// ---- Refresh ALL dashboards after a master-sheet update --------------------
// Rebuilds every pre-aggregated summary table so all pages reflect new data.
// Optional ?only=cluster,newyouth,frontliners,distribution,shgdistribution,shgprofiling,isla to target a subset.
// Each summary is refreshed independently and its result/error is reported, so
// one heavy rebuild failing (or timing out) does not block the others.
app.all('/api/refresh-all', async (c) => {
  const env = storeEnv(c);
  const only = (c.req.query('only') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const want = (k: string) => only.length === 0 || only.includes(k);

  const jobs: { key: string; fn: () => Promise<number> }[] = [];
  if (want('cluster'))      jobs.push({ key: 'cluster',      fn: () => refreshClusterSummary(env) });
  if (want('newyouth'))     jobs.push({ key: 'newyouth',     fn: () => refreshNewYouth(env) });
  if (want('distribution')) jobs.push({ key: 'distribution', fn: () => refreshDistribution(env) });
  if (want('shgdistribution')) jobs.push({ key: 'shgdistribution', fn: () => refreshShgDistribution(env) });
  if (want('shgprofiling')) jobs.push({ key: 'shgprofiling', fn: () => refreshShgProfiling(env) });
  if (want('isla'))         jobs.push({ key: 'isla',         fn: () => refreshIsla(env) });
  if (want('production'))   jobs.push({ key: 'production',   fn: () => refreshProduction(env) });
  if (want('sales'))        jobs.push({ key: 'sales',        fn: () => refreshSales(env) });
  if (want('poultrysales')) jobs.push({ key: 'poultrysales', fn: () => refreshPoultrySales(env) });
  if (want('itemsnotsold')) jobs.push({ key: 'itemsnotsold', fn: () => refreshItemsNotSold(env) });
  if (want('localleverage')) jobs.push({ key: 'localleverage', fn: () => refreshLocalLeverage(env) });
  if (want('jobtracking'))  jobs.push({ key: 'jobtracking',  fn: () => refreshJobTracking(env) });
  // frontliners is the heaviest (728k rows) — run it last.
  if (want('frontliners'))  jobs.push({ key: 'frontliners',  fn: () => refreshFrontliners(env) });

  const results: Record<string, { ok: boolean; rows?: number; error?: string }> = {};
  for (const j of jobs) {
    try {
      const rows = await j.fn();
      results[j.key] = { ok: true, rows };
    } catch (err) {
      results[j.key] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const allOk = Object.values(results).every((r) => r.ok);
  return c.json({ ok: allOk, results });
});

// Expose schema definitions so the browser can detect + clean-preview locally.
app.get('/api/schemas', (c) =>
  c.json({
    schemas: SCHEMAS.map((s) => ({
      key: s.key,
      label: s.label,
      dedupKey: s.dedupKey,
      filenameHints: s.filenameHints,
      columns: s.columns.map((col) => ({ name: col.name, type: col.type, fillFrom: col.fillFrom })),
    })),
  })
);

// Tiny inline favicon to avoid 404 noise.
app.get('/favicon.ico', (c) =>
  c.body(
    Uint8Array.from(atob('AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAD/////'), (x) => x.charCodeAt(0)),
    200,
    { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' }
  )
);

app.get('/health', (c) => c.json({ ok: true, schemas: SCHEMAS.map((s) => s.key) }));

// ---------------------------------------------------------------------------
// Serve the canonical cron driver as plain text, so it can be installed on the
// VM with a single `curl -o` (no error-prone heredoc paste).
//   curl -s -o /home/ubuntu/mis-cron.sh https://shg-data-cleaner.pages.dev/api/cron-script
//   chmod +x /home/ubuntu/mis-cron.sh
//
// IMPORTANT (overload fix 2026-08-02): install this on a *15-minute* schedule,
// NOT the old 5-minute one, or the request budget will be tripped again:
//   crontab -e  ->  */15 * * * * /home/ubuntu/mis-cron.sh >> /home/ubuntu/mis-cron.log 2>&1
// The script rotates its heavy work across 3 cycle slots, so a full refresh of
// every dataset completes about every 45 minutes.
// ---------------------------------------------------------------------------
const CRON_SCRIPT = `#!/usr/bin/env bash
# SHG dashboard refresh driver (run every 15 min). Installed via /api/cron-script.
set -u

BASE="https://shg-data-cleaner.pages.dev"
LOCK=/tmp/mis-cron.lock

# Prevent overlapping runs if one cycle runs long.
exec 9>"$LOCK"
flock -n 9 || { echo "$(date -u) SKIP: previous run still active"; exit 0; }

# ---------------------------------------------------------------------------
# OVERLOAD FIX (2026-08-02): the previous version fired the ENTIRE workload
# (heavy multi-page MIS pulls + 6 view syncs + 6 distribution OData feeds +
# 10 dashboard rebuilds + a full warm-cache) EVERY 5 minutes. That request
# volume is what "exceeded the limit" and switched the dashboard off. This
# rewrite:
#   * keeps ONLY the cheap, must-stay-fresh work every tick (trainee freshness
#     + light dashboard refresh + warm the 2 heaviest caches);
#   * SPREADS the heavy work across a 3-cycle rotation (a persisted counter),
#     so no single tick does everything;
#   * RUN THIS ON A 15-MINUTE CRON, not 5 (see install note at /api/cron-script).
# Net effect: ~1/3 the requests per tick and roughly 1/9 the heavy load vs the
# old 5-min-everything driver, while every dataset still refreshes within ~45m.
# ---------------------------------------------------------------------------

# Rotating cycle counter (0,1,2,0,1,2,...) persisted between runs so heavy work
# can be assigned to a specific slot instead of running every tick.
CYCLE_FILE=/tmp/mis-cron.cycle
CYCLE=$(cat "$CYCLE_FILE" 2>/dev/null || echo 0)
case "$CYCLE" in ''|*[!0-9]*) CYCLE=0 ;; esac
NEXT=$(( (CYCLE + 1) % 3 ))
echo "$NEXT" > "$CYCLE_FILE"
echo "$(date -u) === cron start (cycle slot $CYCLE) ==="

# Sync helper: retry up to 3x on a transient MIS 5xx (e.g. "HTTP 502").
# Brief MIS outages then no longer skip a whole 5-min cycle.
sync_call() {
  local label="$1"; local url="$2"; local out=""
  for attempt in 1 2 3; do
    out=$(curl -s --max-time 110 "$url")
    case "$out" in
      *'HTTP 502'*|*'HTTP 503'*|*'HTTP 504'*|*'Network connection lost'*)
        echo -n "$label (retry $attempt): "; echo "$out"; sleep 5 ;;
      *) echo -n "$label: "; echo "$out"; return 0 ;;
    esac
  done
  echo -n "$label (gave up): "; echo "$out"
}

# ===== EVERY CYCLE (cheap, keeps the headline KPIs live) =====================
# 1) Trainee freshness pass = page 1 forward. New submissions land on page 1, so
#    this keeps "Youth Trained" current every tick at minimal gateway cost.
sync_call "run" "$BASE/api/mis-sync/run"

# 2) Light dashboard rebuilds that the home page reads directly. Kept every tick
#    so the landing KPIs never go stale; the heavier rebuilds are rotated below.
for c in cluster newyouth; do
  echo -n "refresh $c: "; curl -s --max-time 170 -X POST "$BASE/api/refresh-all?only=$c"; echo
done

# 3) Warm ONLY the two heaviest caches every tick (these are the ones whose cold
#    compute over ~765k rows caused the CPU-limit outages). The rest are warmed
#    by the full warm-cache on cycle slot 2.
echo -n "warm-cache(core): "; curl -s --max-time 300 "$BASE/api/warm-cache?wait=1&only=cluster,newyouth"; echo

# ===== CYCLE SLOT 0 — trainee deep backfill + SHG/profiling views ============
if [ "$CYCLE" = "0" ]; then
  # Advance the deep backfill cursor a little. Kept SMALL (1 page * 1000 rows)
  # so a compute-heavy page (many new inserts) can't blow the Worker CPU budget
  # and return "error code: 1102". The backfill is already caught up (gap:0), so
  # a small slice per slot is enough to keep wrapping/staying fresh.
  sync_call "run backfill" "$BASE/api/mis-sync/run?fresh=0&maxPages=1&pageSize=1000"
  # View syncs one page of 1000 at a time (was 3*2000) for the same CPU-limit
  # reason; split across two slots so no single tick syncs all four heavy views.
  for v in shg_groups_view isla_form; do
    sync_call "view $v" "$BASE/api/mis-sync/view?key=$v&maxPages=1&pageSize=1000"
  done
  for v in youth_profiling shg_profiling_form; do
    sync_call "view $v" "$BASE/api/mis-sync/view?key=$v&maxPages=1&pageSize=1000"
  done
  for c in shgprofiling isla; do
    echo -n "refresh $c: "; curl -s --max-time 170 -X POST "$BASE/api/refresh-all?only=$c"; echo
  done
fi

# ===== CYCLE SLOT 1 — production / sales / leverage / jobs views =============
if [ "$CYCLE" = "1" ]; then
  # These three views have WIDE rows (many numeric columns) so their per-row
  # map+JSON cost is higher than the slot-0 views; 1000 still tripped 1102, so
  # they run 1 page * 500 rows each.
  for v in production_and_marketing_tool job_tracking; do
    sync_call "view $v" "$BASE/api/mis-sync/view?key=$v&maxPages=1&pageSize=500"
  done
  sync_call "view leverage(fresh)" "$BASE/api/mis-sync/view?key=local_leverage_fund_contribution_form&fresh=1&pageSize=250&maxPages=1"
  for c in production sales poultrysales localleverage jobtracking; do
    echo -n "refresh $c: "; curl -s --max-time 170 -X POST "$BASE/api/refresh-all?only=$c"; echo
  done
fi

# ===== CYCLE SLOT 2 — distribution OData + items-not-sold + full warm ========
if [ "$CYCLE" = "2" ]; then
  sync_call "dist events"       "$BASE/api/distribution-odata/sync?feed=events"
  sync_call "dist shg"          "$BASE/api/distribution-odata/sync?feed=shg"
  sync_call "dist agrihubs"     "$BASE/api/distribution-odata/sync?feed=agrihubs"
  for s in 0 20000 40000 60000; do
    sync_call "dist participants @$s" "$BASE/api/distribution-odata/sync?feed=participants&skip=$s&limit=20000"
  done
  sync_call "dist rebuild"      "$BASE/api/distribution-odata/sync?feed=rebuild"
  # Items Not Sold depends on distribution_rows ⋈ marketing records (after rebuild).
  echo -n "refresh itemsnotsold: "; curl -s --max-time 170 -X POST "$BASE/api/refresh-all?only=itemsnotsold"; echo
  # Full warm now that every fact table has been refreshed at least once this rotation.
  echo -n "warm-cache(full): "; curl -s --max-time 300 "$BASE/api/warm-cache?wait=1"; echo
fi

echo "$(date -u) === cron done (slot $CYCLE) ==="
`;

app.get('/api/cron-script', (c) =>
  c.body(CRON_SCRIPT, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
);

// ---------------------------------------------------------------------------
// Heifer SAYE MIS sync — pull all_trainees_view straight from the MIS.
// Replaces the failing 76MB manual upload. Runs in slices (Cloudflare CPU
// limits) and is idempotent by dedup_key. A Cron trigger advances the cursor.
// ---------------------------------------------------------------------------

// Read-only progress: rows in at_rows, cursor, last run, cycles.
app.get('/api/mis-sync/status', async (c) => {
  try {
    const st = await misSyncStatus(storeEnv(c));
    return c.json(st);
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});





// Run ONE sync slice on demand. Optional query params:
//   ?pageSize=2000&maxPages=3   — tune batch size
//   ?startPage=50               — override cursor (parallel backfill helper)
// Protected by the same optional token used for OData if configured.
app.all('/api/mis-sync/run', async (c) => {
  try {
    const q = c.req.query();
    const pageSize = q.pageSize ? parseInt(q.pageSize, 10) : undefined;
    const maxPages = q.maxPages ? parseInt(q.maxPages, 10) : undefined;
    const startPage = q.startPage ? parseInt(q.startPage, 10) : undefined;
    // Default to a FRESHNESS pass (page 1 forward) so the existing VM cron —
    // which calls this plainly with no params — keeps KPIs current every cycle.
    // Opt out with ?fresh=0 (or provide ?startPage=N) to run a backfill slice.
    const fresh = startPage ? false : !(q.fresh === 'false' || q.fresh === '0');
    const res = await misSyncSlice(storeEnv(c), { pageSize, maxPages, startPage, fresh });
    return c.json(res);
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// Token-gated BULK INGEST of already-fetched MIS trainee rows. The MIS gateway
// is too slow/unstable for a Worker to fetch reliably (Youth Trained froze at
// 99,050 with 32,556 rows pending because Worker fetches 500'd/timed out). An
// external drain (the sandbox, which CAN reach the gateway) fetches each page
// and POSTs {rows:[...]} here; this route only does the cheap DB upsert.
//   POST /api/mis-sync/ingest?token=...   body: {"rows":[ ...raw MIS rows... ]}
app.post('/api/mis-sync/ingest', async (c) => {
  if (c.req.query('token') !== 'shg-fix-2026') return c.json({ error: 'forbidden' }, 403);
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return c.json({ ok: false, error: 'no rows' }, 400);
    const res = await ingestTraineeRows(storeEnv(c), rows);
    return c.json(res);
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// Bulk-ingest already-joined trainees_v2 rows (POSTed by the sandbox ingester
// which does the parent⋈child join + v1/v2 union). Token-gated.
app.post('/api/trainees-v2/ingest', async (c) => {
  if (c.req.query('token') !== 'shg-fix-2026') return c.json({ error: 'forbidden' }, 403);
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return c.json({ ok: false, error: 'no rows' }, 400);
    const res = await ingestTraineesV2(storeEnv(c), rows);
    return c.json(res);
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// --- Multi-view MIS sync (Shg_group review, ISLA, Youth/SHG profiling,
//     Production & Marketing) ------------------------------------------------
// Per-view sync progress (cursors + counts) without pulling data.
app.get('/api/mis-sync/view-status', async (c) => {
  try {
    return c.json(await misViewSyncStatus(storeEnv(c)));
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// Sync ONE view slice. ?key=shg_groups_view&pageSize=2000&maxPages=3[&startPage=N]
app.all('/api/mis-sync/view', async (c) => {
  try {
    const q = c.req.query();
    const key = q.key;
    if (!key) return c.json({ ok: false, error: 'missing ?key' }, 400);
    const pageSize = q.pageSize ? parseInt(q.pageSize, 10) : undefined;
    const maxPages = q.maxPages ? parseInt(q.maxPages, 10) : undefined;
    const startPage = q.startPage ? parseInt(q.startPage, 10) : undefined;
    const replace = q.replace === 'true' || q.replace === '1';
    const fresh = q.fresh === 'true' || q.fresh === '1';
    const res = await misSyncView(storeEnv(c), key, { pageSize, maxPages, startPage, replace, fresh });
    return c.json(res);
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// Sync ALL mapped views one slice each. ?pageSize=2000&maxPages=3
app.all('/api/mis-sync/all', async (c) => {
  try {
    const q = c.req.query();
    const pageSize = q.pageSize ? parseInt(q.pageSize, 10) : undefined;
    const maxPages = q.maxPages ? parseInt(q.maxPages, 10) : undefined;
    const replace = q.replace === 'true' || q.replace === '1';
    // Default to a FRESHNESS pass so the existing VM cron keeps every view
    // current each cycle. Opt out with ?fresh=0 to run a backfill slice.
    const fresh = replace ? false : !(q.fresh === 'false' || q.fresh === '0');
    const res = await misSyncAllViews(storeEnv(c), { pageSize, maxPages, replace, fresh });
    return c.json(res);
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

// Cloudflare Cron entry point: advance every MIS cursor by one slice.
// (On Cloudflare Pages this handler does not fire natively — an external cron
// hits /api/mis-sync/run + /api/mis-sync/all. Kept for Workers/portability.)
async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(
    (async () => {
      // 1) FRESHNESS PASS — always sweep page 1 forward so brand-new submissions
      //    (which land on page 1) are picked up every cycle, independent of the
      //    deep-backfill cursor. This is what keeps the KPIs changing every 5 min.
      try {
        await misSyncSlice(env, { pageSize: 2000, maxPages: 3, fresh: true });
      } catch (e) {
        console.error('MIS all_trainees freshness pass failed:', e);
      }
      try {
        await misSyncAllViews(env, { pageSize: 2000, maxPages: 2, fresh: true });
      } catch (e) {
        console.error('MIS multi-view freshness pass failed:', e);
      }
      // 2) BACKFILL PASS — advance the historical cursor by one slice to keep
      //    converging the full dataset. Page-level HTTP 500s are now skipped
      //    instead of aborting, so a deep bad page can't stall the sync.
      try {
        await misSyncSlice(env, { pageSize: 2000, maxPages: 3 });
      } catch (e) {
        console.error('MIS all_trainees backfill sync failed:', e);
      }
      try {
        await misSyncAllViews(env, { pageSize: 2000, maxPages: 2 });
      } catch (e) {
        console.error('MIS multi-view backfill sync failed:', e);
      }
    })()
  );
}

export default {
  fetch: app.fetch,
  scheduled,
};
