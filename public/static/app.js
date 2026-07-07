const $ = (id) => document.getElementById(id);

let SCHEMAS = [];             // loaded from /api/schemas
let pending = null;          // { file, headers, rows, detection }

// ---- Load schema definitions ----------------------------------------------
async function loadSchemas() {
  const res = await fetch('/api/schemas');
  SCHEMAS = (await res.json()).schemas;
}

// ---- Header normalization (mirror of server normHeader) --------------------
function normHeader(h) {
  return String(h).toLowerCase()
    .replace(/@odata_navigationlink/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// ---- Client-side detection (mirror of server detectSchema) -----------------
function detect(headers, filename) {
  const srcNorm = new Set(headers.map(normHeader));
  const fnameLc = (filename || '').toLowerCase();
  let best = null;
  for (const schema of SCHEMAS) {
    const targets = schema.columns.filter(c => c.type !== 'seq');
    let hit = 0; const matched = [];
    for (const col of targets) if (srcNorm.has(normHeader(col.name))) { hit++; matched.push(col.name); }
    let score = hit / targets.length;
    if (schema.filenameHints.some(h => fnameLc.includes(h.replace('.csv','')))) score += 0.15;
    score = Math.min(score, 1);
    if (!best || score > best.score) best = { schema, score, matched };
  }
  const schema = best.schema;
  const targetNames = schema.columns.filter(c => c.type !== 'seq').map(c => c.name);
  const missing = targetNames.filter(c => !srcNorm.has(normHeader(c)));
  const targetNormSet = new Set(schema.columns.map(c => normHeader(c.name)));
  const extra = headers.filter(h => !targetNormSet.has(normHeader(h)));
  const matched = best.score >= 0.6;
  return {
    matched, schema, score: best.score, matchedColumns: best.matched,
    missingColumns: missing, extraColumns: extra,
    message: matched
      ? `Matched template "${schema.label}" (${schema.key}) with ${(best.score*100).toFixed(0)}% column confidence.`
      : `No confident match. Closest is "${schema.label}" (${schema.key}) at ${(best.score*100).toFixed(0)}% (below 60% threshold). Please verify the file.`,
  };
}

// ---- Client-side cleaning preview (mirror of server) -----------------------
const MONTHS = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
const pad = n => String(n).padStart(2,'0');
const isoD = (y,m,d) => `${y}-${pad(m)}-${pad(d)}`;
function cleanDate(raw){ if(!raw) return ''; let s=String(raw).trim(); if(!s) return ''; s=s.replace(/^[A-Za-z]+,\s*/,''); let m;
  m=s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/); if(m){const mo=MONTHS[m[2].toLowerCase()]; if(mo) return isoD(+m[3],mo,+m[1]);}
  m=s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/); if(m){const mo=MONTHS[m[1].toLowerCase()]; if(mo) return isoD(+m[3],mo,+m[2]);}
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return isoD(+m[1],+m[2],+m[3]);
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(m){let a=+m[1],b=+m[2],y=+m[3]; if(a>12) return isoD(y,b,a); if(b>12) return isoD(y,a,b); return isoD(y,b,a);}
  return s; }
function cleanPhone(raw){ if(!raw) return ''; let s=String(raw).trim(); if(!s) return '';
  if(/e\+?\d+/i.test(s)){const n=Number(s); if(!isNaN(n)) s=n.toFixed(0);}
  const plus=s.startsWith('+'); s=s.replace(/[^\d]/g,''); if(!s) return '';
  if(s.startsWith('256')&&s.length>=12) s='0'+s.slice(3); else if(plus) s='+'+s; return s; }
function cleanInt(raw){ if(raw==null) return ''; const s=String(raw).trim(); if(!s) return ''; const n=Number(s.replace(/,/g,'')); return isNaN(n)?'':String(Math.round(n)); }
function cleanNumber(raw){ if(raw==null) return ''; const s=String(raw).trim(); if(!s) return ''; const n=Number(s.replace(/,/g,'')); return isNaN(n)?'':String(n); }
function cleanText(raw){ if(raw==null) return ''; return String(raw).replace(/\s+/g,' ').trim(); }
function cleanValue(type,raw){ switch(type){case 'date':return cleanDate(raw);case 'phone':return cleanPhone(raw);case 'int':return cleanInt(raw);case 'number':return cleanNumber(raw);case 'seq':return '';default:return cleanText(raw);} }

function cleanBatch(schema, headers, rows, startSeq){
  const idx = new Map(); headers.forEach((h,i)=>idx.set(normHeader(h),i));
  const out=[]; let seq=startSeq;
  for(const row of rows){
    if(row.every(c=>(c==null?'':String(c)).trim()==='')) continue;
    const rec={};
    for(const col of schema.columns){
      if(col.type==='seq'){ rec[col.name]=String(seq); continue; }
      const i=idx.get(normHeader(col.name));
      let raw = i===undefined?'':(row[i]??'');
      if((raw==null||String(raw).trim()==='') && col.fillFrom){
        const fi=idx.get(normHeader(col.fillFrom));
        if(fi!==undefined) raw=row[fi]??'';
      }
      rec[col.name]=cleanValue(col.type, raw);
    }
    out.push(rec); seq++;
  }
  return out;
}

// ---- File parsing: preview via a Web Worker (no main-thread freeze) --------
// We only pull the header + first chunk of rows for detection/preview so even
// a 700k-row / 75MB file never blocks the UI. Full parsing happens later,
// streamed straight to the server on confirm.
function previewViaWorker(file){
  return new Promise((resolve,reject)=>{
    const w=new Worker('/static/parse-worker.js');
    let headers=null; const rows=[]; let settled=false;
    const finish=()=>{ if(settled) return; settled=true; w.terminate(); resolve({headers:headers||[],rows}); };
    w.onmessage=(e)=>{
      const m=e.data;
      if(m.type==='meta'){ headers=m.headers; }
      else if(m.type==='rows'){ for(const r of m.rows){ if(rows.length<200) rows.push(r.map(c=>String(c??''))); }
        if(rows.length>=200) finish(); }
      else if(m.type==='done'){ finish(); }
      else if(m.type==='error'){ if(!settled){settled=true; w.terminate(); reject(new Error(m.error));} }
    };
    w.onerror=(err)=>{ if(!settled){settled=true; w.terminate(); reject(err.message?new Error(err.message):err);} };
    w.postMessage({ file });
  });
}

// ---- Upload UI -------------------------------------------------------------
const dropzone=$('dropzone'), fileInput=$('fileInput');
dropzone.addEventListener('click',()=>fileInput.click());
dropzone.addEventListener('dragover',e=>{e.preventDefault();dropzone.classList.add('border-emerald-400');});
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('border-emerald-400'));
dropzone.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('border-emerald-400');if(e.dataTransfer.files.length)handleFile(e.dataTransfer.files[0]);});
fileInput.addEventListener('change',e=>{if(e.target.files.length)handleFile(e.target.files[0]);});

async function handleFile(file){
  $('fileMeta').classList.remove('hidden');
  $('fileMeta').innerHTML=`<i class="fas fa-file-lines text-slate-500 mr-1"></i> <b>${esc(file.name)}</b> · ${(file.size/1024/1024).toFixed(2)} MB`;
  $('detectResult').classList.remove('hidden');
  $('detectResult').innerHTML='<div class="text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Parsing &amp; detecting template…</div>';
  $('uploadActions').classList.add('hidden'); $('uploadStatus').classList.add('hidden');
  try{
    const { headers, rows } = await previewViaWorker(file);
    if(!headers.length) throw new Error('Could not read a header row from the file.');
    const det = detect(headers, file.name);
    pending = { file, headers, detection: det };  // note: rows here are a PREVIEW only
    renderDetection(det, headers, rows);
  }catch(err){
    $('detectResult').innerHTML=`<div class="text-red-600">Parse failed: ${esc(String(err&&err.message?err.message:err))}</div>`;
  }
}

function renderDetection(det, headers, rows){
  const ok=det.matched, color=ok?'emerald':'amber';
  const targetCols=det.schema.columns.map(c=>c.name);
  const preview=cleanBatch(det.schema, headers, rows.slice(0,10), 1);
  let html=`<div class="border-l-4 border-${color}-500 bg-${color}-50 p-4 rounded">
    <div class="font-semibold text-${color}-700"><i class="fas ${ok?'fa-circle-check':'fa-triangle-exclamation'} mr-1"></i>${ok?'Template detected':'No confident match'}</div>
    <p class="text-sm mt-1">${esc(det.message)}</p>
    <div class="text-sm mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
      <div><b>Target schema:</b> ${esc(det.schema.label)} <span class="text-slate-400">(${esc(det.schema.key)})</span></div>
      <div><b>Confidence:</b> ${(det.score*100).toFixed(0)}%</div>
      <div><b>Preview rows:</b> ${rows.length.toLocaleString()}${rows.length>=200?'+ (full file streamed on append)':''}</div>
      <div><b>Target columns:</b> ${targetCols.length}</div>
    </div>`;
  if(det.missingColumns.length) html+=`<p class="text-xs mt-2 text-amber-700"><b>Filled blank (missing in source):</b> ${det.missingColumns.map(esc).join(', ')}</p>`;
  if(det.extraColumns.length) html+=`<p class="text-xs mt-1 text-slate-500"><b>Dropped extra columns:</b> ${det.extraColumns.map(esc).join(', ')}</p>`;
  html+=`</div>`;
  if(preview.length){
    html+=`<div class="mt-4"><div class="text-sm font-semibold mb-1">Cleaned preview (first ${preview.length} rows)</div>
      <div class="overflow-auto border rounded max-h-72"><table class="text-xs w-full">
      <thead class="bg-slate-100 sticky top-0"><tr>${targetCols.map(c=>`<th class="px-2 py-1 text-left whitespace-nowrap">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${preview.map(r=>`<tr class="border-t">${targetCols.map(c=>`<td class="px-2 py-1 whitespace-nowrap">${esc(r[c]||'')}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div>`;
  }
  $('detectResult').innerHTML=html;
  $('uploadActions').classList.remove('hidden');
  $('confirmBtn').innerHTML=ok?'<i class="fas fa-database mr-1"></i> Clean &amp; Append to Master':'<i class="fas fa-database mr-1"></i> Append anyway to closest match';
}

$('cancelBtn').addEventListener('click',resetUpload);
function resetUpload(){ pending=null; fileInput.value=''; ['fileMeta','detectResult','uploadActions','uploadStatus'].forEach(id=>$(id).classList.add('hidden')); }

// ---- Chunked streaming upload (parse in worker, upload as chunks arrive) ---
// Size each POST so the server issues a bounded number of D1 statements.
// Wide tables (e.g. distribution_form_v2 = 61 cols) force 1 row per INSERT
// statement, so we send fewer rows per request to stay well under Cloudflare's
// D1 subrequest/time limits (which otherwise surface as HTTP 503).
function chunkRowsFor(schema){
  const nCols = schema.columns.length;
  const perRow = 3 + nCols;
  const rowsPerStmt = Math.max(1, Math.floor(90 / perRow));
  // Aim for <= ~120 INSERT statements per request.
  return Math.max(50, Math.min(400, rowsPerStmt * 120));
}

$('confirmBtn').addEventListener('click', async ()=>{
  if(!pending) return;
  const { file, headers, detection } = pending;
  const schema = detection.schema;
  const CHUNK_ROWS = chunkRowsFor(schema);
  $('confirmBtn').disabled=true; $('cancelBtn').disabled=true;
  $('uploadStatus').classList.remove('hidden');

  // Continue the No sequence from the server.
  let seq = 1;
  try{ const r=await fetch('/api/maxseq/'+schema.key); seq=(await r.json()).maxSeq+1; }catch{}

  let totalInserted=0, totalDup=0, processed=0, grandTotal=0;
  const t0=performance.now();

  const paint=(msg)=>{
    const pct = grandTotal>0 ? Math.round(processed/grandTotal*100) : 0;
    const barW = grandTotal>0 ? pct+'%' : '100%';
    const label = grandTotal>0
      ? `${processed.toLocaleString()}/${grandTotal.toLocaleString()} rows`
      : `${processed.toLocaleString()} rows`;
    $('uploadStatus').innerHTML=`<div class="text-sm">
      <div class="flex justify-between mb-1"><span>${msg||'Cleaning &amp; appending…'} ${label}</span><span>${grandTotal>0?pct+'%':''}</span></div>
      <div class="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden"><div class="bg-emerald-500 h-2.5 rounded-full transition-all ${grandTotal>0?'':'animate-pulse'}" style="width:${barW}"></div></div>
      <div class="text-xs text-slate-500 mt-1">Inserted ${totalInserted.toLocaleString()} · Skipped ${totalDup.toLocaleString()} duplicates</div>
    </div>`;
  };
  paint('Reading file…');

  // Upload a batch of raw rows to the server (server cleans + dedups).
  // Retry transient failures (HTTP 503 / network) with backoff so a busy D1
  // moment doesn't abort a large upload.
  async function sendBatch(rows){
    if(!rows.length) return true;
    const payload=JSON.stringify({ schemaKey:schema.key, headers, rows, sourceFile:file.name, startSeq:seq });
    let lastErr;
    for(let attempt=1; attempt<=5; attempt++){
      try{
        const res=await fetch('/api/append',{ method:'POST', headers:{'Content-Type':'application/json'}, body:payload });
        if(res.status===503 || res.status===429 || res.status>=500){
          lastErr=new Error('HTTP '+res.status+' (server busy)');
          await new Promise(r=>setTimeout(r, 400*attempt)); continue;
        }
        if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.error||('HTTP '+res.status)); }
        const d=await res.json();
        totalInserted+=d.result.inserted; totalDup+=d.result.duplicatesSkipped;
        seq=d.nextSeq; processed+=rows.length;
        paint();
        return true;
      }catch(err){
        lastErr=err;
        if(attempt>=5) break;
        await new Promise(r=>setTimeout(r, 400*attempt));
      }
    }
    throw lastErr||new Error('Upload failed');
  }

  // Parse via worker; buffer worker chunks into CHUNK_ROWS-sized POSTs, and
  // apply back-pressure (worker rows arrive faster than we can upload, so we
  // queue and drain sequentially).
  await new Promise((resolve,reject)=>{
    const w=new Worker('/static/parse-worker.js');
    let buf=[];               // pending rows waiting to be POSTed
    let uploading=false;      // a POST is in flight
    let workerDone=false;
    let failed=false;

    const drain=async ()=>{
      if(uploading||failed) return;
      uploading=true;
      try{
        while(buf.length>=CHUNK_ROWS){
          await sendBatch(buf.splice(0,CHUNK_ROWS));
        }
        if(workerDone && buf.length){
          await sendBatch(buf.splice(0,buf.length));
        }
        if(workerDone && buf.length===0){ w.terminate(); resolve(); }
      }catch(err){ failed=true; w.terminate(); reject(err); }
      finally{ uploading=false; }
    };

    w.onmessage=(e)=>{
      const m=e.data;
      if(m.type==='meta'){ if(m.total>0){ grandTotal=m.total; } paint('Cleaning &amp; appending…'); }
      else if(m.type==='rows'){ for(const r of m.rows) buf.push(r); drain(); }
      else if(m.type==='done'){ workerDone=true; if(grandTotal<=0) grandTotal=processed+buf.length; drain(); }
      else if(m.type==='error'){ failed=true; w.terminate(); reject(new Error(m.error)); }
    };
    w.onerror=(err)=>{ failed=true; w.terminate(); reject(err.message?new Error(err.message):new Error('Worker error')); };
    w.postMessage({ file });
  }).catch((err)=>{
    $('uploadStatus').innerHTML=`<div class="text-red-600 bg-red-50 p-3 rounded"><b>Upload failed:</b> ${esc(String(err&&err.message?err.message:err))}<div class="text-xs mt-1">Inserted ${totalInserted.toLocaleString()} before failure.</div></div>`;
    $('confirmBtn').disabled=false; $('cancelBtn').disabled=false;
    throw err;
  }).then(()=>{
    const secs=((performance.now()-t0)/1000).toFixed(1);
    const base=window.__BASE__;
    $('uploadStatus').innerHTML=`<div class="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded text-sm">
      <div class="font-semibold text-emerald-700"><i class="fas fa-circle-check mr-1"></i>Appended to <b>${esc(schema.label)}</b> in ${secs}s</div>
      <div class="mt-1">Inserted <b>${totalInserted.toLocaleString()}</b> new · Skipped <b>${totalDup.toLocaleString()}</b> duplicates · Processed ${processed.toLocaleString()} rows.</div>
      <div class="mt-1 text-xs">OData feed: <a class="text-emerald-700 underline break-all" href="${base}/odata/${schema.key}" target="_blank">${base}/odata/${schema.key}</a></div>
    </div>`;
    $('confirmBtn').disabled=false; $('cancelBtn').disabled=false;
    loadStats();
    setTimeout(()=>{ ['fileMeta','detectResult','uploadActions'].forEach(id=>$(id).classList.add('hidden')); pending=null; fileInput.value=''; }, 800);
    // Master data changed → rebuild the dashboard summaries so every page reflects it.
    if(totalInserted>0){ rebuildDashboards(); }
  }).catch(()=>{});
});

// ---- Stats -----------------------------------------------------------------
async function loadStats(){
  const res=await fetch('/api/stats'); const data=await res.json();
  $('odataService').textContent=data.odataService; $('odataMeta').textContent=data.odataMetadata;
  const grid=$('statsGrid');
  grid.innerHTML=data.schemas.map(s=>`
    <div class="border rounded-lg p-4 hover:shadow transition">
      <div class="flex items-center justify-between"><div class="font-semibold">${esc(s.label)}</div><span class="text-xs bg-slate-100 px-2 py-0.5 rounded">${esc(s.key)}</span></div>
      <div class="text-3xl font-bold text-emerald-600 mt-2">${s.count.toLocaleString()}</div>
      <div class="text-xs text-slate-400">records${s.lastIngest?' · last '+new Date(s.lastIngest).toLocaleString():''}</div>
      <div class="flex flex-wrap gap-3 mt-3 text-xs">
        <a class="text-emerald-600 hover:underline" href="${s.odataFeed}" target="_blank"><i class="fas fa-plug mr-1"></i>OData</a>
        <button class="text-emerald-600 hover:underline previewBtn" data-key="${s.key}" data-label="${esc(s.label)}"><i class="fas fa-eye mr-1"></i>Preview</button>
        <a class="text-emerald-600 hover:underline" href="${s.csv}"><i class="fas fa-download mr-1"></i>CSV</a>
        <button class="text-red-500 hover:underline resetBtn" data-key="${s.key}"><i class="fas fa-trash mr-1"></i>Reset</button>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.previewBtn').forEach(b=>b.addEventListener('click',()=>previewTable(b.dataset.key,b.dataset.label)));
  grid.querySelectorAll('.resetBtn').forEach(b=>b.addEventListener('click',async()=>{
    const key=b.dataset.key;
    if(!window.confirm('Clear ALL records in "'+key+'"? This cannot be undone.')) return;
    const orig=b.innerHTML; b.disabled=true; b.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Resetting…';
    try{
      const res=await fetch('/api/reset/'+key,{method:'POST'});
      if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.error||('HTTP '+res.status)); }
      await res.json();
      await loadStats();          // rebuilds the grid; button element is replaced
    }catch(err){
      b.disabled=false; b.innerHTML=orig;
      alert('Reset failed: '+(err&&err.message?err.message:err));
    }
  }));
}
$('refreshBtn').addEventListener('click',loadStats);

// Backfill empty docId columns on existing rows (docId <- __Submissions-id / unique_id).
const backfillBtn=$('backfillBtn');
if(backfillBtn) backfillBtn.addEventListener('click',async()=>{
  const s=$('backfillStatus');
  backfillBtn.disabled=true; const orig=backfillBtn.innerHTML;
  backfillBtn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Filling…';
  s.classList.remove('hidden'); s.className='mb-3 text-sm text-slate-500'; s.textContent='Filling empty docId values from source columns…';
  try{
    const res=await fetch('/api/backfill-docid',{method:'POST'});
    if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.error||('HTTP '+res.status)); }
    const d=await res.json();
    const detail=Object.entries(d.report||{}).map(([k,v])=>`${k}: ${v.updated}`).join(' · ')||'no empty docId found';
    s.className='mb-3 text-sm text-emerald-700 bg-emerald-50 border-l-4 border-emerald-500 p-2 rounded';
    s.innerHTML=`<i class="fas fa-circle-check mr-1"></i>Filled <b>${d.totalUpdated.toLocaleString()}</b> docId values. (${esc(detail)})`;
    loadStats();
  }catch(err){
    s.className='mb-3 text-sm text-red-700 bg-red-50 p-2 rounded';
    s.textContent='Backfill failed: '+(err&&err.message?err.message:err);
  }finally{
    backfillBtn.disabled=false; backfillBtn.innerHTML=orig;
  }
});

// Rebuild all dashboard summary tables (cluster / newyouth / distribution / frontliners)
// so the dashboard pages reflect the latest master data.
const DASH_LABELS={cluster:'Cluster Trainings',newyouth:'Monthly New Youth',distribution:'Distribution to Participants',shgdistribution:'Distribution to SHGs',shgprofiling:'SHG Profiling',isla:'ISLA Savings',frontliners:'Trainings by Frontliners'};
async function rebuildDashboards(opts){
  opts=opts||{};
  const btn=$('rebuildDashBtn');
  const s=$('rebuildDashStatus');
  let orig='';
  if(btn){ btn.disabled=true; orig=btn.innerHTML; btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Rebuilding…'; }
  if(s){ s.classList.remove('hidden'); s.className='mb-3 text-sm text-slate-500'; s.textContent='Rebuilding dashboard summaries from the master data… this can take up to a minute.'; }
  try{
    const res=await fetch('/api/refresh-all',{method:'POST'});
    const d=await res.json().catch(()=>({}));
    if(!res.ok && !d.results){ throw new Error(d.error||('HTTP '+res.status)); }
    const parts=Object.entries(d.results||{}).map(([k,v])=>{
      const name=DASH_LABELS[k]||k;
      return v.ok
        ? `<span class="text-emerald-700"><i class="fas fa-check mr-1"></i>${esc(name)}: ${Number(v.rows||0).toLocaleString()} rows</span>`
        : `<span class="text-red-600"><i class="fas fa-triangle-exclamation mr-1"></i>${esc(name)}: ${esc(String(v.error||'failed'))}</span>`;
    });
    if(s){
      s.className='mb-3 text-sm bg-slate-50 border-l-4 '+(d.ok?'border-emerald-500':'border-amber-500')+' p-3 rounded';
      s.innerHTML=`<div class="font-semibold mb-1">${d.ok?'<i class="fas fa-circle-check text-emerald-600 mr-1"></i>Dashboards rebuilt':'<i class="fas fa-triangle-exclamation text-amber-600 mr-1"></i>Rebuild finished with issues'}</div><div class="flex flex-col gap-0.5">${parts.join('')}</div>`;
    }
    await loadStats();
    return d;
  }catch(err){
    if(s){ s.className='mb-3 text-sm text-red-700 bg-red-50 p-2 rounded'; s.textContent='Rebuild failed: '+(err&&err.message?err.message:err); }
    return null;
  }finally{
    if(btn){ btn.disabled=false; btn.innerHTML=orig; }
  }
}
const rebuildDashBtn=$('rebuildDashBtn');
if(rebuildDashBtn) rebuildDashBtn.addEventListener('click',()=>rebuildDashboards());

// ---- Import from external OData feed (paginated loop) ----------------------
const importOdataBtn=$('importOdataBtn');
if(importOdataBtn) importOdataBtn.addEventListener('click',async()=>{
  const key=importOdataBtn.dataset.key;
  const box=$('importOdataStatus');
  importOdataBtn.disabled=true; const orig=importOdataBtn.innerHTML;
  importOdataBtn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i>Importing…';
  box.classList.remove('hidden');
  box.className='mb-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3';
  let skip=0, startSeq=undefined, totalInserted=0, totalDup=0, totalFetched=0, total=null, done=false, pages=0;
  try{
    while(!done){
      const res=await fetch('/api/import-odata/'+key,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({skip,startSeq})
      });
      const d=await res.json();
      if(!res.ok||d.error) throw new Error(d.error||('HTTP '+res.status));
      pages++;
      totalFetched+=d.fetched||0;
      totalInserted+=(d.result&&d.result.inserted)||0;
      totalDup+=(d.result&&d.result.skippedDuplicates)||0;
      if(d.total!=null) total=d.total;
      skip=d.nextSkip; startSeq=d.nextSeq; done=d.done;
      const pct=total?Math.min(100,Math.round(totalFetched/total*100)):null;
      box.innerHTML='<i class="fas fa-cloud-arrow-down text-sky-600 mr-1"></i>Fetched '
        +totalFetched.toLocaleString()+(total?(' / '+total.toLocaleString()):'')
        +(pct!=null?(' ('+pct+'%)'):'')+' — inserted '+totalInserted.toLocaleString()
        +', duplicates skipped '+totalDup.toLocaleString()+'.';
      if(d.fetched===0) break;
    }
    box.className='mb-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3';
    box.innerHTML='<i class="fas fa-circle-check mr-1"></i>Import complete: '
      +totalInserted.toLocaleString()+' new rows inserted, '
      +totalDup.toLocaleString()+' duplicates skipped ('+totalFetched.toLocaleString()+' fetched over '+pages+' pages).';
    await loadStats();
  }catch(err){
    box.className='mb-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3';
    box.innerHTML='<i class="fas fa-triangle-exclamation mr-1"></i>Import failed: '+esc(err.message||String(err));
  }finally{
    importOdataBtn.disabled=false; importOdataBtn.innerHTML=orig;
  }
});

async function previewTable(key,label){
  const res=await fetch('/api/data/'+key+'?top=100'); const data=await res.json();
  $('previewSection').classList.remove('hidden');
  $('previewTitle').textContent=label+' — showing '+data.rows.length+' of '+data.count.toLocaleString();
  $('previewHead').innerHTML='<tr>'+data.columns.map(c=>`<th class="px-2 py-1 text-left whitespace-nowrap">${esc(c)}</th>`).join('')+'</tr>';
  $('previewBody').innerHTML=data.rows.map(r=>'<tr class="border-t">'+data.columns.map(c=>`<td class="px-2 py-1 whitespace-nowrap">${esc(r[c]||'')}</td>`).join('')+'</tr>').join('');
  $('previewSection').scrollIntoView({behavior:'smooth'});
}
$('closePreview').addEventListener('click',()=>$('previewSection').classList.add('hidden'));

document.querySelectorAll('.copyBtn').forEach(b=>b.addEventListener('click',()=>{ const t=$(b.dataset.target).textContent; navigator.clipboard.writeText(t); const i=b.querySelector('i'); i.className='fas fa-check'; setTimeout(()=>i.className='fas fa-copy',1200); }));

function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

(async ()=>{ await loadSchemas(); await loadStats(); })();
