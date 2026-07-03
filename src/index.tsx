import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SCHEMAS, SCHEMA_BY_KEY } from './schemas';
import { parseFile } from './parse';
import { detectSchema, cleanRecords } from './cleaner';
import {
  appendRecords, maxSeq, queryRecords, tableStats, clearTable,
  backfillFilled, Env,
} from './store';
import {
  serviceDocument, metadataDocument, entitySetResponse, entitySetName,
} from './odata';
import { renderPage } from './ui';

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
