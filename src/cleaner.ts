// ---------------------------------------------------------------------------
// Detection + cleaning engine.
// - Detects which template an uploaded sheet matches (header fingerprint).
// - Cleans / standardizes each column to the target schema.
// ---------------------------------------------------------------------------

import { SCHEMAS, SCHEMA_BY_KEY, SheetSchema, ColType, normHeader } from './schemas';

export interface DetectionResult {
  matched: boolean;
  schema?: SheetSchema;
  score: number;            // 0..1 overlap of target columns present in source
  closest?: SheetSchema;    // best guess even if below threshold
  message: string;
  matchedColumns: string[];
  missingColumns: string[]; // target cols not found in source (filled blank)
  extraColumns: string[];   // source cols dropped
}

const MATCH_THRESHOLD = 0.6;

/**
 * Detect the best matching template for a set of source headers.
 * Uses header-fingerprint overlap, with the filename as a tie-breaker/booster.
 */
export function detectSchema(headers: string[], filename = ''): DetectionResult {
  const srcNorm = new Map<string, string>(); // normalized -> original
  for (const h of headers) srcNorm.set(normHeader(h), h);

  const fnameLc = filename.toLowerCase();

  let best: { schema: SheetSchema; score: number; matched: string[] } | null = null;

  for (const schema of SCHEMAS) {
    const targets = schema.columns.filter((c) => c.type !== 'seq'); // 'No' is computed
    let hit = 0;
    const matched: string[] = [];
    for (const col of targets) {
      if (srcNorm.has(normHeader(col.name))) {
        hit++;
        matched.push(col.name);
      }
    }
    let score = hit / targets.length;

    // Filename hint boost.
    if (schema.filenameHints.some((h) => fnameLc.includes(h.replace('.csv', '')))) {
      score += 0.15;
    }
    score = Math.min(score, 1);

    if (!best || score > best.score) best = { schema, score, matched };
  }

  if (!best) {
    return {
      matched: false, score: 0, message: 'No templates configured.',
      matchedColumns: [], missingColumns: [], extraColumns: headers,
    };
  }

  const schema = best.schema;
  const targetNames = schema.columns.filter((c) => c.type !== 'seq').map((c) => c.name);
  const missing = targetNames.filter((c) => !srcNorm.has(normHeader(c)));
  const targetNormSet = new Set(schema.columns.map((c) => normHeader(c.name)));
  const extra = headers.filter((h) => !targetNormSet.has(normHeader(h)));

  if (best.score >= MATCH_THRESHOLD) {
    return {
      matched: true,
      schema,
      score: best.score,
      message: `Matched template "${schema.label}" (${schema.key}) with ${(best.score * 100).toFixed(0)}% column confidence.`,
      matchedColumns: best.matched,
      missingColumns: missing,
      extraColumns: extra,
    };
  }

  return {
    matched: false,
    score: best.score,
    closest: schema,
    message: `Uploaded sheet did not confidently match any known template. Closest match is "${schema.label}" (${schema.key}) at ${(best.score * 100).toFixed(0)}% confidence, below the ${(MATCH_THRESHOLD * 100).toFixed(0)}% threshold. Please verify the file is the correct template.`,
    matchedColumns: best.matched,
    missingColumns: missing,
    extraColumns: extra,
  };
}

// --- Value standardizers -----------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

/** Standardize a variety of date strings into ISO YYYY-MM-DD. Empty -> ''. */
export function cleanDate(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  if (!s) return '';

  // Drop weekday prefix: "Wednesday, 24 June 2026" -> "24 June 2026"
  s = s.replace(/^[A-Za-z]+,\s*/, '');

  // "24 June 2026"
  let m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const day = +m[1], mon = MONTHS[m[2].toLowerCase()], yr = +m[3];
    if (mon) return iso(yr, mon, day);
  }
  // "June 24, 2026" / "June 24 2026"
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()], day = +m[2], yr = +m[3];
    if (mon) return iso(yr, mon, day);
  }
  // Already ISO "2026-06-24"
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // "24/06/2026" or "06/24/2026" -> assume DD/MM/YYYY (common in UG data), fallback MM/DD
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let a = +m[1], b = +m[2], yr = +m[3];
    if (a > 12) return iso(yr, b, a);      // clearly DD/MM
    if (b > 12) return iso(yr, a, b);      // clearly MM/DD
    return iso(yr, b, a);                  // default DD/MM
  }
  // Unknown format -> return trimmed original (do not corrupt meaning).
  return s;
}

function iso(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Repair phone numbers. Handles Excel scientific-notation corruption
 * (e.g. "2.56774E+11" -> "256774000000"), strips spaces/dashes,
 * normalizes Ugandan numbers to a leading 0 local format where possible.
 */
export function cleanPhone(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // Scientific notation from Excel.
  if (/e\+?\d+/i.test(s)) {
    const n = Number(s);
    if (!isNaN(n)) s = n.toFixed(0);
  }

  // Keep leading + then digits only.
  const hasPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return '';

  // Normalize Uganda country code 256 -> local 0 form.
  if (s.startsWith('256') && s.length >= 12) {
    s = '0' + s.slice(3);
  } else if (hasPlus) {
    s = '+' + s;
  }
  return s;
}

/** Integer: keep digits (and sign); empty/invalid -> ''. */
export function cleanInt(raw: string): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const n = Number(s.replace(/,/g, ''));
  if (isNaN(n)) return '';
  return String(Math.round(n));
}

/** Number: preserve decimals; empty/invalid -> ''. */
export function cleanNumber(raw: string): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const n = Number(s.replace(/,/g, ''));
  if (isNaN(n)) return '';
  return String(n);
}

/** Collapse internal whitespace and trim; preserves original casing/meaning. */
export function cleanText(raw: string): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

export function cleanValue(type: ColType, raw: string): string {
  switch (type) {
    case 'date': return cleanDate(raw);
    case 'phone': return cleanPhone(raw);
    case 'int': return cleanInt(raw);
    case 'number': return cleanNumber(raw);
    case 'seq': return ''; // filled by caller
    default: return cleanText(raw);
  }
}

/**
 * Clean a set of raw records against a schema.
 * Returns rows keyed by exact target column names, in order.
 * `startSeq` lets the caller continue the `No` sequence across appends.
 */
export function cleanRecords(
  schema: SheetSchema,
  headers: string[],
  rows: string[][],
  startSeq = 1
): { cleaned: Record<string, string>[]; dedupKey: string } {
  // Map target column -> source index (by normalized header).
  const srcIndex = new Map<string, number>();
  headers.forEach((h, i) => srcIndex.set(normHeader(h), i));

  const cleaned: Record<string, string>[] = [];
  let seq = startSeq;

  for (const row of rows) {
    // Skip fully-empty rows.
    if (row.every((c) => (c ?? '').toString().trim() === '')) continue;

    const rec: Record<string, string> = {};
    for (const col of schema.columns) {
      if (col.type === 'seq') {
        rec[col.name] = String(seq);
        continue;
      }
      const idx = srcIndex.get(normHeader(col.name));
      let raw = idx === undefined ? '' : (row[idx] ?? '');
      // Fallback: if this column arrived empty and it has a fillFrom source,
      // pull the value from that source column (e.g. docId <- __Submissions-id).
      if ((raw == null || String(raw).trim() === '') && col.fillFrom) {
        const fidx = srcIndex.get(normHeader(col.fillFrom));
        if (fidx !== undefined) raw = row[fidx] ?? '';
      }
      rec[col.name] = cleanValue(col.type, raw);
    }
    cleaned.push(rec);
    seq++;
  }

  return { cleaned, dedupKey: schema.dedupKey };
}
