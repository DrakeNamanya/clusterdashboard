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
  shgDistributionDash, shgDistributionDetail, shgDistributionOptions, refreshShgDistribution, Env,
} from './store';
import {
  serviceDocument, metadataDocument, entitySetResponse, entitySetName,
} from './odata';
import { ODATA_SOURCES, fetchOdataPage, resolveSource } from './odataimport';
import { renderPage } from './ui';
import { renderClusterTrainings } from './cluster';
import { renderMonthlyNewYouth } from './newyouth';
import { renderFrontliners } from './frontliner';
import { renderDistribution } from './distribution';
import { renderShgDistribution } from './shgdistribution';

// Cloudflare env: Supabase creds are injected as secrets / vars.
type Bindings = Env;

// Build the store Env from the request context (validates configuration).
function storeEnv(c: any): Env {
  const url = c.env.SUPABASE_URL;
  const key = c.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing).');
  }
  return { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key };
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
  const stats = await tableStats(storeEnv(c), SCHEMAS);
  const base = baseUrl(c.req.url);
  return c.json({
    schemas: stats.map((s) => ({
      ...s,
      odataFeed: `${base}/odata/${s.key}`,
      apiData: `${base}/api/data/${s.key}`,
      csv: `${base}/api/export/${s.key}.csv`,
    })),
    odataService: `${base}/odata/`,
    odataMetadata: `${base}/odata/$metadata`,
  });
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
  });
}

app.get('/odata', (c) => odataJson(c, serviceDocument(baseUrl(c.req.url))));
app.get('/odata/', (c) => odataJson(c, serviceDocument(baseUrl(c.req.url))));

app.get('/odata/$metadata', (c) =>
  c.body(metadataDocument(), 200, {
    'Content-Type': 'application/xml;charset=utf-8',
    'OData-Version': '4.0',
    'Access-Control-Allow-Origin': '*',
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

app.get('/', (c) => c.html(renderPage(baseUrl(c.req.url))));

// ---- Cluster Trainings dashboard ------------------------------------------

// Page (Power BI-style dashboard).
app.get('/cluster-trainings', (c) => c.html(renderClusterTrainings(baseUrl(c.req.url))));

// Aggregated data feed for the dashboard (KPIs + bar chart), with filters.
app.get('/api/cluster-trainings', async (c) => {
  const q = c.req.query();
  const districts = (q.districts || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const data = await clusterTrainings(storeEnv(c), {
    districts,
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
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
  const data = await newYouthDash(storeEnv(c), {
    districts,
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
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
  const data = await frontlinerDash(storeEnv(c), {
    districts,
    collectors,
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
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
  const data = await distributionDash(storeEnv(c), {
    districts: split(q.districts),
    materials: split(q.materials),
    units: split(q.units),
    submitters: split(q.submitters),
    suppliers: split(q.suppliers),
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
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
  const data = await shgDistributionDash(storeEnv(c), {
    districts: split(q.districts),
    materials: split(q.materials),
    units: split(q.units),
    submitters: split(q.submitters),
    suppliers: split(q.suppliers),
    from: q.from || undefined,
    to: q.to || undefined,
  });
  return c.json(data);
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

// ---- Refresh ALL dashboards after a master-sheet update --------------------
// Rebuilds every pre-aggregated summary table so all pages reflect new data.
// Optional ?only=cluster,newyouth,frontliners,distribution,shgdistribution to target a subset.
// Each summary is refreshed independently and its result/error is reported, so
// one heavy rebuild failing (or timing out) does not block the others.
app.post('/api/refresh-all', async (c) => {
  const env = storeEnv(c);
  const only = (c.req.query('only') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const want = (k: string) => only.length === 0 || only.includes(k);

  const jobs: { key: string; fn: () => Promise<number> }[] = [];
  if (want('cluster'))      jobs.push({ key: 'cluster',      fn: () => refreshClusterSummary(env) });
  if (want('newyouth'))     jobs.push({ key: 'newyouth',     fn: () => refreshNewYouth(env) });
  if (want('distribution')) jobs.push({ key: 'distribution', fn: () => refreshDistribution(env) });
  if (want('shgdistribution')) jobs.push({ key: 'shgdistribution', fn: () => refreshShgDistribution(env) });
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

export default app;
