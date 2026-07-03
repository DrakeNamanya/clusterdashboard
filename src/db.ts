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

/** Index of the dedup key column within the schema. */
function dedupIndex(schema: SheetSchema): number {
  return schema.columns.findIndex((c) => c.name === schema.dedupKey);
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

/** Fetch the set of existing dedup keys (for append-only de-duplication). */
export async function existingKeys(db: D1Database, schema: SheetSchema): Promise<Set<string>> {
  const tbl = physTable(schema);
  const idx = dedupIndex(schema);
  const col = physCol(idx);
  const res = await db.prepare(`SELECT ${col} AS k FROM ${tbl}`).all<{ k: string }>();
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
  const dedupCol = schema.dedupKey;

  const now = new Date().toISOString();
  const physCols = schema.columns.map((_, i) => physCol(i));
  const perRowCols = 3 + physCols.length; // _rowid, _ingested_at, _source_file + data cols
  const colList = `(_rowid, _ingested_at, _source_file, ${physCols.join(', ')})`;

  // De-duplicate within this batch only. Cross-batch / cross-upload dedup is
  // enforced by the PRIMARY KEY + `INSERT OR IGNORE` at the DB level, so we do
  // NOT scan the whole table on every batch (that would be O(n^2)).
  const seen = new Set<string>();
  const toInsert: string[][] = [];

  for (const rec of records) {
    const key = (rec[dedupCol] ?? '').trim();
    // If no dedup key value, synthesize a stable key from all values.
    const effKey = key || 'row:' + schema.columns.map((c) => rec[c.name] ?? '').join('|');
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
  let inserted = 0;
  const BATCH = 30;
  for (let i = 0; i < stmts.length; i += BATCH) {
    const res = await db.batch(stmts.slice(i, i + BATCH));
    for (const r of res) {
      const rw = (r.meta && (r.meta as any).changes) ?? 0;
      inserted += rw;
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
