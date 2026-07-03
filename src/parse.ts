// ---------------------------------------------------------------------------
// File parsing: CSV (custom RFC-4180 parser) and XLSX (SheetJS).
// Returns { headers, rows } as string matrices.
// ---------------------------------------------------------------------------

import * as XLSX from 'xlsx';

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  sheetName?: string;
}

/** RFC-4180-ish CSV parser supporting quotes, embedded commas and newlines. */
export function parseCSV(text: string): ParsedTable {
  // Strip UTF-8 BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => { record.push(field); field = ''; };
  const pushRecord = () => { rows.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') pushField();
      else if (ch === '\r') { /* ignore, handle on \n */ }
      else if (ch === '\n') { pushField(); pushRecord(); }
      else field += ch;
    }
  }
  // Trailing field/record (file may not end with newline).
  if (field.length > 0 || record.length > 0) { pushField(); pushRecord(); }

  // Drop trailing empty records.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();

  const headers = rows.shift() ?? [];
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Parse an XLSX/XLS buffer; reads the first non-empty sheet by default. */
export function parseXLSX(buf: ArrayBuffer, preferredSheet?: string): ParsedTable {
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName =
    (preferredSheet && wb.SheetNames.includes(preferredSheet))
      ? preferredSheet
      : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,        // format everything as strings (avoids float phone corruption where possible)
    defval: '',
    blankrows: false,
  });
  const headers = (aoa.shift() ?? []).map((h) => (h ?? '').toString().trim());
  const rows = aoa.map((r) => r.map((c) => (c ?? '').toString()));
  return { headers, rows, sheetName };
}

/** Dispatch based on filename / mime. */
export function parseFile(filename: string, mime: string, data: ArrayBuffer): ParsedTable {
  const lower = filename.toLowerCase();
  const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls') ||
    mime.includes('spreadsheetml') || mime.includes('ms-excel');
  if (isXlsx) return parseXLSX(data);
  // Default: treat as CSV/text.
  const text = new TextDecoder('utf-8').decode(data);
  return parseCSV(text);
}
