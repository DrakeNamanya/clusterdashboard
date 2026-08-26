import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// MERGE CF NAMES — user-driven duplicate-spelling folding
//
// The M&E team's tool for the "Praise vs Praise Joan" problem: the same real
// Community Facilitator shows up under several spellings, so their numbers are
// split across two (or more) cards on the CF Report / Premier League /
// Production League / Payment Report.
//
// Workflow:
//   1. Search + browse the full CF list (one checkbox per spelling).
//   2. Tick every spelling that is the SAME person.
//   3. Choose which ticked spelling is the canonical display name to keep.
//   4. Merge — all ticked spellings' numbers are folded under the canonical
//      name across EVERY report. Durable: survives every sync/refresh.
//
// Actions call /api/cf-merge/* (see src/index.tsx), which wrap the
// mel_cf_merge_* RPCs and re-run the identity->universe refresh chain.
// Design language cloned from the Field Staff registry (Royal Blue #003399).
// ---------------------------------------------------------------------------

export function renderCfMerge(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Merge CF Names — SAYE Uganda MEL</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root{
      --primary:#003399; --primary-deep:#001f5c; --primary-tint:#eef2fb;
      --fg:#1b2437; --muted-fg:#5a6480; --card:#ffffff;
      --muted:#f1f3f9; --border:#d7deee; --rule:#b9c4e4;
      --good:#1f8a4c; --warn:#c07d12; --bad:#c62f2f; --desk:#eceff6;
      --sans:"Inter Tight",ui-sans-serif,system-ui,sans-serif;
      --mono:"IBM Plex Mono",ui-monospace,monospace;
    }
    *{ box-sizing:border-box; }
    body{ background:var(--desk); color:var(--fg); font-family:var(--sans); margin:0; -webkit-font-smoothing:antialiased; }
    .num{ font-family:var(--mono); font-variant-numeric:tabular-nums; }
    .wrap{ max-width:1100px; margin:0 auto; padding:18px 14px 60px; }
    .masthead{ background:var(--primary); color:#fff; padding:20px 26px; border-radius:4px 4px 0 0; }
    .masthead .brand{ font-family:var(--mono); font-size:11px; letter-spacing:.2em; text-transform:uppercase; opacity:.85; }
    .masthead h1{ margin:4px 0 2px; font-size:24px; font-weight:700; }
    .masthead .sub{ font-size:13px; opacity:.9; }
    .panel{ background:#fff; border:1px solid var(--border); border-top:0; }
    .toolbar{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; padding:16px; border-bottom:1px solid var(--border); }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted-fg); }
    .fld input{ border:1px solid var(--border); border-radius:2px; padding:8px 10px; font-size:13px; background:#fff; min-width:220px; color:var(--fg); font-family:inherit; }
    .btn{ border:1px solid var(--primary); background:var(--primary); color:#fff; border-radius:2px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); }
    .btn.ghost:hover{ background:var(--primary-tint); }
    .btn.danger{ background:#fff; color:var(--bad); border-color:var(--bad); }
    .btn.danger:hover{ background:#fff0f0; }
    .btn:disabled{ opacity:.5; cursor:not-allowed; }
    .hint{ font-size:12.5px; color:var(--muted-fg); padding:12px 16px; background:var(--primary-tint); border-bottom:1px solid var(--border); }
    .hint b{ color:var(--fg); }
    .list{ max-height:56vh; overflow:auto; }
    table{ border-collapse:collapse; width:100%; font-size:13px; }
    thead th{ position:sticky; top:0; background:var(--muted); text-align:left; padding:9px 12px; font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted-fg); border-bottom:1px solid var(--rule); }
    tbody td{ padding:8px 12px; border-bottom:1px solid var(--border); vertical-align:middle; }
    tbody tr:hover{ background:#f7f9ff; }
    tbody tr.sel{ background:#eef6ee; }
    td.chk{ width:34px; text-align:center; }
    td.canon{ width:110px; text-align:center; }
    .badge{ display:inline-block; font-family:var(--mono); font-size:10px; padding:1px 7px; border-radius:10px; background:#e9edf7; color:var(--primary-deep); }
    .badge.merged{ background:#e6f3ea; color:var(--good); }
    .tray{ position:sticky; bottom:0; background:#fff; border-top:2px solid var(--primary); padding:14px 16px; display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
    .tray .count{ font-size:13px; }
    .tray .count b{ color:var(--primary); }
    .canonpick{ display:flex; flex-direction:column; gap:4px; min-width:240px; }
    .canonpick select{ border:1px solid var(--border); border-radius:2px; padding:8px 10px; font-size:13px; background:#fff; color:var(--fg); font-family:inherit; }
    .toast{ position:fixed; left:50%; transform:translateX(-50%); bottom:24px; background:#111a2e; color:#fff; padding:11px 18px; border-radius:4px; font-size:13px; z-index:50; opacity:0; transition:opacity .2s; pointer-events:none; }
    .toast.show{ opacity:1; }
    .toast.err{ background:#7a1414; }
    .section-title{ font-family:var(--mono); font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted-fg); padding:14px 16px 6px; }
    .merges{ padding:0 16px 16px; }
    .merge-card{ border:1px solid var(--border); border-left:3px solid var(--good); border-radius:3px; padding:10px 12px; margin-top:8px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .merge-card .mc-name{ font-weight:600; }
    .merge-card .mc-aliases{ font-size:12px; color:var(--muted-fg); font-family:var(--mono); }
    .empty{ padding:22px 16px; color:var(--muted-fg); font-size:13px; text-align:center; }
  </style>
</head>
<body>
  ${navSidebar('cfmerge')}
  <div class="wrap">
    <header class="masthead">
      <div class="brand">SAYE Uganda · Heifer International · MEL</div>
      <h1><i class="fa-solid fa-code-merge"></i> Merge CF Names</h1>
      <div class="sub">Fold duplicate spellings of the same Community Facilitator into ONE name. Their numbers then add up on every report.</div>
    </header>

    <div class="panel">
      <div class="hint">
        <b>How to use:</b> 1) Search &amp; tick every spelling that is the same person (e.g. <b>Praise</b> and <b>Praise Joan</b>).
        2) Pick which ticked spelling to keep as the display name. 3) Click <b>Merge selected</b>.
        The merge survives every data sync and is applied across the CF Report Card, Premier League, Production League &amp; Payment Report.
      </div>

      <div class="toolbar">
        <div class="fld">
          <label for="q">Search CF name</label>
          <input id="q" type="text" placeholder="e.g. praise" autocomplete="off" />
        </div>
        <button class="btn ghost" id="clearSel"><i class="fa-solid fa-eraser"></i> Clear selection</button>
        <div style="flex:1"></div>
        <button class="btn ghost" id="reload"><i class="fa-solid fa-rotate"></i> Reload list</button>
      </div>

      <div class="list">
        <table>
          <thead>
            <tr>
              <th class="chk"><i class="fa-solid fa-check"></i></th>
              <th>CF Name (spelling)</th>
              <th>Districts</th>
              <th class="num" style="text-align:right">Activity rows</th>
              <th>Status</th>
              <th class="canon">Keep as name</th>
            </tr>
          </thead>
          <tbody id="rows"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
        </table>
      </div>

      <div class="tray">
        <div class="count">Selected: <b id="selCount">0</b> spelling(s)</div>
        <div class="canonpick">
          <label style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted-fg)">Canonical name to keep</label>
          <select id="canonSel"><option value="">— tick names first —</option></select>
        </div>
        <div style="flex:1"></div>
        <button class="btn" id="mergeBtn" disabled><i class="fa-solid fa-code-merge"></i> Merge selected</button>
      </div>

      <div class="section-title">Existing merges</div>
      <div class="merges" id="merges"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
const API = ${JSON.stringify(base)};
const rowsEl = document.getElementById('rows');
const qEl = document.getElementById('q');
const canonSel = document.getElementById('canonSel');
const selCountEl = document.getElementById('selCount');
const mergeBtn = document.getElementById('mergeBtn');
const mergesEl = document.getElementById('merges');
const toastEl = document.getElementById('toast');

let CANDS = [];                 // current candidate rows
const SELECTED = new Map();     // name -> row  (survives search/filter)

function toast(msg, isErr){
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(()=>{ toastEl.className = 'toast'; }, 2600);
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(n){ return (Number(n)||0).toLocaleString(); }

async function loadList(){
  const q = qEl.value.trim();
  rowsEl.innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
  try{
    const r = await fetch(API + '/api/cf-merge/candidates' + (q ? '?q='+encodeURIComponent(q) : ''));
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'failed');
    CANDS = j.rows || [];
    renderRows();
  }catch(e){ rowsEl.innerHTML = '<tr><td colspan="6" class="empty">Error: '+esc(e.message)+'</td></tr>'; }
}

function renderRows(){
  if(!CANDS.length){ rowsEl.innerHTML = '<tr><td colspan="6" class="empty">No CF names match.</td></tr>'; return; }
  rowsEl.innerHTML = CANDS.map(function(row){
    const name = row.name;
    const picked = SELECTED.has(name);
    const statusBadge = row.is_canon
      ? '<span class="badge merged"><i class="fa-solid fa-code-merge"></i> canonical</span>'
      : '<span class="badge">'+fmt(row.activity_rows)+' rows</span>';
    return '<tr class="'+(picked?'sel':'')+'" data-name="'+esc(name)+'">'
      + '<td class="chk"><input type="checkbox" class="pick" '+(picked?'checked':'')+' /></td>'
      + '<td><b>'+esc(name)+'</b></td>'
      + '<td>'+esc(row.districts||'')+'</td>'
      + '<td class="num" style="text-align:right">'+fmt(row.activity_rows)+'</td>'
      + '<td>'+statusBadge+'</td>'
      + '<td class="canon"><input type="radio" name="canonradio" class="canonradio" value="'+esc(name)+'" '+(picked?'':'disabled')+' /></td>'
      + '</tr>';
  }).join('');
}

// Delegate checkbox + radio changes.
rowsEl.addEventListener('change', function(ev){
  const tr = ev.target.closest('tr'); if(!tr) return;
  const name = tr.getAttribute('data-name');
  const row = CANDS.find(r=>r.name===name);
  if(ev.target.classList.contains('pick')){
    if(ev.target.checked){ SELECTED.set(name, row); tr.classList.add('sel'); }
    else { SELECTED.delete(name); tr.classList.remove('sel'); }
    // enable/disable that row's canon radio
    const radio = tr.querySelector('.canonradio');
    if(radio) radio.disabled = !ev.target.checked;
    syncTray();
  } else if(ev.target.classList.contains('canonradio')){
    canonSel.value = ev.target.value;
  }
});

function syncTray(){
  selCountEl.textContent = SELECTED.size;
  const names = Array.from(SELECTED.keys());
  const prev = canonSel.value;
  canonSel.innerHTML = names.length
    ? names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('')
    : '<option value="">— tick names first —</option>';
  if(names.includes(prev)) canonSel.value = prev;
  mergeBtn.disabled = SELECTED.size < 2;
}

canonSel.addEventListener('change', function(){
  // reflect the dropdown choice onto the radio buttons
  document.querySelectorAll('.canonradio').forEach(function(rb){ rb.checked = (rb.value === canonSel.value); });
});

document.getElementById('clearSel').addEventListener('click', function(){
  SELECTED.clear(); syncTray(); renderRows();
});
document.getElementById('reload').addEventListener('click', function(){ loadList(); loadMerges(); });

let searchTimer=null;
qEl.addEventListener('input', function(){ clearTimeout(searchTimer); searchTimer=setTimeout(loadList, 250); });

mergeBtn.addEventListener('click', async function(){
  const names = Array.from(SELECTED.keys());
  const canon = canonSel.value || names[0];
  if(names.length < 2){ toast('Select at least two names.', true); return; }
  if(!canon){ toast('Choose the canonical name to keep.', true); return; }
  mergeBtn.disabled = true; mergeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Merging…';
  try{
    const r = await fetch(API + '/api/cf-merge/apply', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ canon: canon, names: names })
    });
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'failed');
    toast('Merged '+names.length+' spellings into "'+canon+'". Reports updated.');
    SELECTED.clear(); syncTray();
    await loadList(); await loadMerges();
  }catch(e){ toast('Merge failed: '+e.message, true); }
  finally{ mergeBtn.innerHTML = '<i class="fa-solid fa-code-merge"></i> Merge selected'; mergeBtn.disabled = SELECTED.size<2; }
});

async function loadMerges(){
  try{
    const r = await fetch(API + '/api/cf-merge/list');
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'failed');
    const rows = j.rows || [];
    if(!rows.length){ mergesEl.innerHTML = '<div class="empty">No merges yet.</div>'; return; }
    mergesEl.innerHTML = rows.map(function(m){
      return '<div class="merge-card">'
        + '<div><div class="mc-name"><i class="fa-solid fa-user-check" style="color:var(--good)"></i> '+esc(m.canon_name)+'</div>'
        + '<div class="mc-aliases">folds: '+esc((m.alias_keys||[]).join(', '))+'</div></div>'
        + '<button class="btn danger undo" data-name="'+esc(m.canon_name)+'"><i class="fa-solid fa-rotate-left"></i> Undo</button>'
        + '</div>';
    }).join('');
  }catch(e){ mergesEl.innerHTML = '<div class="empty">Error: '+esc(e.message)+'</div>'; }
}

mergesEl.addEventListener('click', async function(ev){
  const btn = ev.target.closest('.undo'); if(!btn) return;
  const name = btn.getAttribute('data-name');
  if(!confirm('Undo the merge for "'+name+'"? Its spellings will show as separate CFs again.')) return;
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try{
    const r = await fetch(API + '/api/cf-merge/undo', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name: name })
    });
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'failed');
    toast('Merge undone.');
    await loadList(); await loadMerges();
  }catch(e){ toast('Undo failed: '+e.message, true); btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-rotate-left"></i> Undo'; }
});

loadList();
loadMerges();
</script>
</body>
</html>`;
}
