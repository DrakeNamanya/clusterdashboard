// ---------------------------------------------------------------------------
// D1 storage layer.
// Each template maps to a physical table. Because target column names contain
// characters that are awkward as SQL identifiers (spaces, '@', '-', '__'),
// we store physical column names c0..cN and keep the exact target names in the
// schema. Output always reconstructs the exact target column names + order.
// ---------------------------------------------------------------------------

import { SheetSchema } from './schemas';

/** Physical column id for the Nth target column. */
export function physCol(i: number): string {
  return `c${i}`;
}

/** Physical table name for a schema. */
export function physTable(schema: SheetSchema): string {
  return `t_${schema.key}`;
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

/**
 * Compute the effective dedup key for a cleaned record.
 * - If `dedupCols` is set: key = hash of those columns joined (composite rule,
 *   e.g. all_trainees_view excludes `_id`).
 * - Else: use the single `dedupKey` value; if blank, fall back to a full-row
 *   hash so blank-id rows still de-duplicate on identical content.
 */
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

/** Create the master table for a schema if it does not exist. */
export async function ensureTable(db: D1Database, schema: SheetSchema): Promise<void> {
  const tbl = physTable(schema);
  const colDefs = schema.columns.map((_, i) => `${physCol(i)} TEXT`).join(', ');
  const sql = `CREATE TABLE IF NOT EXISTS ${tbl} (
    _rowid TEXT PRIMARY KEY,
    _ingested_at TEXT NOT NULL,
    _source_file TEXT,
    ${colDefs}
  )`;
  await db.prepare(sql).run();
}

/** Max value of the seq (`No`) column so appends continue the sequence. */
export async function maxSeq(db: D1Database, schema: SheetSchema): Promise<number> {
  const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
  if (seqIdx < 0) return 0;
  const tbl = physTable(schema);
  const col = physCol(seqIdx);
  const row = await db
    .prepare(`SELECT MAX(CAST(${col} AS INTEGER)) AS m FROM ${tbl}`)
    .first<{ m: number | null }>();
  return row?.m ?? 0;
}

/** Fetch the set of existing dedup keys (for append-only de-duplication).
 * The dedup key is stored as `_rowid` (the PRIMARY KEY), so read it directly. */
export async function existingKeys(db: D1Database, schema: SheetSchema): Promise<Set<string>> {
  const tbl = physTable(schema);
  const res = await db.prepare(`SELECT _rowid AS k FROM ${tbl}`).all<{ k: string }>();
  return new Set((res.results ?? []).map((r) => r.k));
}

export interface AppendResult {
  inserted: number;
  duplicatesSkipped: number;
  total: number;
}

/**
 * Append cleaned records with append-only de-duplication on the schema's
 * dedup key. Records whose dedup key already exists are skipped.
 */
export async function appendRecords(
  db: D1Database,
  schema: SheetSchema,
  records: Record<string, string>[],
  sourceFile: string
): Promise<AppendResult> {
  await ensureTable(db, schema);
  const tbl = physTable(schema);

  const now = new Date().toISOString();
  const physCols = schema.columns.map((_, i) => physCol(i));
  const perRowCols = 3 + physCols.length; // _rowid, _ingested_at, _source_file + data cols
  const colList = `(_rowid, _ingested_at, _source_file, ${physCols.join(', ')})`;

  // De-duplicate within this batch only. Cross-batch / cross-upload dedup is
  // enforced by the PRIMARY KEY (_rowid = dedup key) + `INSERT OR IGNORE` at the
  // DB level, so we do NOT scan the whole table on every batch (avoids O(n^2)).
  // The dedup key follows the schema rule: a composite of `dedupCols` when set
  // (e.g. all_trainees_view, which EXCLUDES `_id`), else the single `dedupKey`.
  const seen = new Set<string>();
  const toInsert: string[][] = [];

  for (const rec of records) {
    const effKey = dedupKeyFor(schema, rec);
    if (seen.has(effKey)) continue;
    seen.add(effKey);

    const values = schema.columns.map((c) => rec[c.name] ?? '');
    toInsert.push([effKey, now, sourceFile, ...values]);
  }

  // Multi-row INSERT: pack many value tuples into a single statement.
  const MAX_PARAMS = 90;
  const rowsPerStmt = Math.max(1, Math.floor(MAX_PARAMS / perRowCols));
  const tuple = `(${Array(perRowCols).fill('?').join(', ')})`;

  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < toInsert.length; i += rowsPerStmt) {
    const chunk = toInsert.slice(i, i + rowsPerStmt);
    const sql = `INSERT OR IGNORE INTO ${tbl} ${colList} VALUES ${chunk.map(() => tuple).join(', ')}`;
    const flat: string[] = [];
    for (const row of chunk) flat.push(...row);
    stmts.push(db.prepare(sql).bind(...flat));
  }

  // Execute all statements for this batch in a single D1 batch call and sum
  // the actual rows written (rows_written reflects INSERT OR IGNORE result).
  // D1 can intermittently return a transient error (surfaces as HTTP 503) when
  // busy, so retry each sub-batch a few times with backoff.
  let inserted = 0;
  const BATCH = 20;
  for (let i = 0; i < stmts.length; i += BATCH) {
    const slice = stmts.slice(i, i + BATCH);
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const res = await db.batch(slice);
        for (const r of res) {
          const rw = (r.meta && (r.meta as any).changes) ?? 0;
          inserted += rw;
        }
        break;
      } catch (err) {
        attempt++;
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
  }

  const dup = records.length - inserted;
  return { inserted, duplicatesSkipped: dup < 0 ? 0 : dup, total: records.length };
}

/** Reconstruct a target-named record from a physical DB row. */
export function toTargetRecord(schema: SheetSchema, row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  schema.columns.forEach((c, i) => {
    const v = row[physCol(i)];
    out[c.name] = v === null || v === undefined ? '' : String(v);
  });
  return out;
}

export interface QueryOpts {
  top?: number;
  skip?: number;
  orderBy?: string;   // target column name
  desc?: boolean;
}

/** Query rows from a master table, returning target-named records. */
export async function queryRecords(
  db: D1Database,
  schema: SheetSchema,
  opts: QueryOpts = {}
): Promise<{ rows: Record<string, string>[]; count: number }> {
  await ensureTable(db, schema);
  const tbl = physTable(schema);

  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM ${tbl}`).first<{ n: number }>();
  const count = countRow?.n ?? 0;

  let order = '_rowid';
  if (opts.orderBy) {
    const idx = schema.columns.findIndex((c) => c.name === opts.orderBy);
    if (idx >= 0) order = physCol(idx);
  } else {
    // Default: order by seq col if present, else ingest order.
    const seqIdx = schema.columns.findIndex((c) => c.type === 'seq');
    order = seqIdx >= 0 ? `CAST(${physCol(seqIdx)} AS INTEGER)` : 'rowid';
  }

  const top = Math.min(Math.max(opts.top ?? 1000, 0), 50000);
  const skip = Math.max(opts.skip ?? 0, 0);
  const dir = opts.desc ? 'DESC' : 'ASC';

  const res = await db
    .prepare(`SELECT * FROM ${tbl} ORDER BY ${order} ${dir} LIMIT ? OFFSET ?`)
    .bind(top, skip)
    .all<Record<string, unknown>>();

  const rows = (res.results ?? []).map((r) => toTargetRecord(schema, r));
  return { rows, count };
}

/** Delete all rows for a schema (reset a master table). */
export async function clearTable(db: D1Database, schema: SheetSchema): Promise<void> {
  await ensureTable(db, schema);
  await db.prepare(`DELETE FROM ${physTable(schema)}`).run();
}

/**
 * Backfill any column that has a `fillFrom` rule (e.g. docId <- __Submissions-id
 * / unique_id) for rows already stored with an empty target value. This repairs
 * data that was ingested before the fill rule existed. Operates directly on the
 * physical columns via a single UPDATE per schema.
 */
export async function backfillFilled(
  db: D1Database,
  schema: SheetSchema
): Promise<{ updated: number; pairs: string[] }> {
  await ensureTable(db, schema);
  const tbl = physTable(schema);
  const pairs: string[] = [];
  let updated = 0;

  for (let i = 0; i < schema.columns.length; i++) {
    const col = schema.columns[i];
    if (!col.fillFrom) continue;
    const srcIdx = schema.columns.findIndex((x) => x.name === col.fillFrom);
    if (srcIdx < 0) continue;

    const tgt = physCol(i);
    const src = physCol(srcIdx);
    // Fill target from source where target is empty/null AND source has a value.
    const sql =
      `UPDATE ${tbl} SET ${tgt} = ${src} ` +
      `WHERE (${tgt} IS NULL OR ${tgt} = '') AND ${src} IS NOT NULL AND ${src} <> ''`;
    const res = await db.prepare(sql).run();
    const n = (res.meta && (res.meta as any).changes) ?? 0;
    updated += n;
    pairs.push(`${col.name}<-${col.fillFrom}:${n}`);
  }

  return { updated, pairs };
}

/** Row count per master table for the dashboard. */
export async function tableStats(db: D1Database, schemas: SheetSchema[]) {
  const out: { key: string; label: string; count: number; lastIngest: string | null }[] = [];
  for (const s of schemas) {
    await ensureTable(db, s);
    const tbl = physTable(s);
    const r = await db
      .prepare(`SELECT COUNT(*) AS n, MAX(_ingested_at) AS last FROM ${tbl}`)
      .first<{ n: number; last: string | null }>();
    out.push({ key: s.key, label: s.label, count: r?.n ?? 0, lastIngest: r?.last ?? null });
  }
  return out;
}
