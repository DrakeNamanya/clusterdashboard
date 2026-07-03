// ---------------------------------------------------------------------------
// Web Worker: parse a large Excel/CSV file OFF the main thread so the page
// never freezes ("Page Unresponsive"). Streams the header row first, then the
// data rows back in chunks so the main thread can upload incrementally without
// ever holding the whole 700k+ row dataset in a giant array it re-slices.
// ---------------------------------------------------------------------------
/* global importScripts, XLSX */
importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

const CHUNK = 2000; // rows posted back per message

self.onmessage = async (e) => {
  const { file } = e.data;
  try {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      await parseCSV(file);
    } else {
      await parseXLSX(file);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.message ? err.message : err) });
  }
};

// --- XLSX path (SheetJS) ----------------------------------------------------
async function parseXLSX(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
  const headers = (aoa.shift() || []).map((h) => String(h == null ? '' : h).trim());
  const total = aoa.length;
  self.postMessage({ type: 'meta', headers, total });
  for (let i = 0; i < total; i += CHUNK) {
    const slice = aoa.slice(i, i + CHUNK).map((r) => r.map((c) => String(c == null ? '' : c)));
    self.postMessage({ type: 'rows', rows: slice, done: Math.min(i + CHUNK, total), total });
  }
  self.postMessage({ type: 'done', total });
}

// --- CSV path (streaming line parser, RFC-4180 quotes) ----------------------
async function parseCSV(file) {
  const stream = file.stream ? file.stream() : null;
  let headers = null;
  let buffer = '';
  let batch = [];
  let count = 0;
  const decoder = new TextDecoder('utf-8');

  const flush = (force) => {
    if (batch.length >= CHUNK || (force && batch.length)) {
      self.postMessage({ type: 'rows', rows: batch, done: count, total: count });
      batch = [];
    }
  };

  const handleLine = (line) => {
    if (line === '' ) return;
    const fields = parseCSVLine(line);
    if (!headers) {
      headers = fields.map((h) => String(h).trim());
      self.postMessage({ type: 'meta', headers, total: -1 });
      return;
    }
    batch.push(fields);
    count++;
    flush(false);
  };

  // Split into physical lines but respect quoted newlines.
  const processBuffer = (final) => {
    let i = 0, start = 0, inQuotes = false;
    while (i < buffer.length) {
      const ch = buffer[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (ch === '\n' || ch === '\r')) {
        const line = buffer.slice(start, i);
        handleLine(line.replace(/\r$/, ''));
        if (ch === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      i++;
    }
    buffer = buffer.slice(start);
    if (final && buffer.length) { handleLine(buffer.replace(/\r$/, '')); buffer = ''; }
  };

  if (stream) {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      processBuffer(false);
    }
    buffer += decoder.decode();
    processBuffer(true);
  } else {
    buffer = await file.text();
    processBuffer(true);
  }
  flush(true);
  self.postMessage({ type: 'done', total: count });
}

function parseCSVLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
