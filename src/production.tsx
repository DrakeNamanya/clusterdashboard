import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// "YOUTH IN PRODUCTION (Mainly Horticulture)"
//   Production_Table = production_and_marketing_tool filtered pdn_level='production'
//   Join: production[shg_participant_id] -> participants[refID]
//           -> shg_id, shg_name, Disability_status
//         participants[shg_id] -> shg_profiling_form[refID] -> Profilers_name
//   district_name comes from the production feed itself.
// Table grouped by shg_name. KPIs: Unique SHGs / Unique Participants /
//   New Participants in production. Slicers: district_name + value_chain.
// Data from /api/production (+ /options).
// ---------------------------------------------------------------------------

export function renderProduction(base: string, opts: any = {}): string {
  const bootOpts = JSON.stringify({
    districts: opts.districts || [],
    valuechains: opts.valuechains || [],
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Youth in Production (Horticulture)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#28343a; --muted:#7c8a8f;
      --head:#2f5d6b; --row-alt:#faf1e6; --line:#d9e2e3; --teal:#2f8f9d; --amber:#e08a2b;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:10px;
           box-shadow:0 1px 2px rgba(40,60,60,.06); }
    .ttl{ background:#f3ede4; border-radius:12px; }
    .kpi{ position:relative; overflow:hidden; min-width:150px; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:4px; background:var(--amber); }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--head); color:#fff; font-weight:700; font-size:11px;
              padding:7px 9px; text-align:left; position:sticky; top:0; z-index:2; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:5px 9px; font-size:11.5px; vertical-align:top; border-bottom:1px solid #f0e6d8; }
    tbody td.num{ text-align:right; }
    tbody tr:nth-child(even) td{ background:var(--row-alt); }
    tbody tr:hover td{ background:#f4fafb; }
    tbody tr.total-row td{ background:var(--head) !important; color:#fff; font-weight:700; border-bottom:none; }
    .sortable{ cursor:pointer; user-select:none; }
    .sortable .arrow{ opacity:.7; font-size:9px; margin-left:2px; }
    .dist-item{ display:flex; align-items:center; gap:6px; padding:2px 2px; cursor:pointer; font-size:12px; }
    .dist-item:hover{ background:var(--cream); border-radius:5px; }
    .dist-item input{ accent-color:#2f5d6b; width:13px; height:13px; }
    .scrollbar-thin::-webkit-scrollbar{ width:7px; height:7px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#c7d4d5; border-radius:3px; }
    .slbl{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; }
    .mini-btn{ font-size:9px; padding:2px 4px; border-radius:4px; border:1px solid var(--line); background:#fff; }
    .mini-btn:hover{ background:var(--cream); }
    .mini-search{ width:100%; background:#fff; border:1px solid var(--line); border-radius:5px; padding:2px 6px; font-size:10px; }
    input[type=range]{ accent-color:var(--head); }
  </style>
</head>
<body>
${navSidebar('production')}
  <div class="max-w-[1600px] mx-auto p-3 md:p-4">

    <!-- Title + top toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to Home"><i class="fas fa-arrow-left"></i></a>

      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Unique SHGs</div>
        <div id="kpiShgs" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Unique Participants</div>
        <div id="kpiParts" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">New Participants in production</div>
        <div id="kpiNew" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>

      <div class="ttl px-5 py-1.5 flex-1 text-center"><h1 class="text-lg md:text-2xl font-extrabold tracking-tight">YOUTH IN PRODUCTION(Mainly Horticulture)</h1></div>

      <div class="flex items-center gap-1.5 card px-3 py-1.5">
        <span class="text-[10px] text-[var(--muted)] uppercase font-bold mr-1">Activity date</span>
        <input id="fromDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px]" />
        <span class="text-[var(--muted)] text-xs">→</span>
        <input id="toDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px]" />
        <button data-preset="clear" class="preset text-[10px] px-2 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] ml-1">All time</button>
        <button data-preset="thismonth" class="preset text-[10px] px-2 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)]">Month</button>
      </div>

      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--cream)] text-[var(--muted)]">
        <i class="fas fa-rotate mr-1"></i> Refresh
      </button>
    </div>

    <div class="grid grid-cols-12 gap-3">

      <!-- Main table (10/12) -->
      <section class="col-span-12 lg:col-span-10">
        <div class="card p-2">
          <div class="scrollbar-thin overflow-auto max-h-[calc(100vh-160px)]">
            <table id="tbl">
              <thead id="thead"></thead>
              <tbody id="tbody">
                <tr><td class="text-center text-[var(--muted)] py-8">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Right slicers (2/12) -->
      <aside class="col-span-12 lg:col-span-2 space-y-2">
        <div class="card p-2" id="sl-dist"></div>
        <div class="card p-2" id="sl-vc"></div>
      </aside>
    </div>
  </div>

  <script>
    window.__OPTS__ = ${bootOpts};
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    const num = (v) => { const n = Number(v); return (n||0).toLocaleString('en-US',{maximumFractionDigits:2}); };

    // Table columns in the Power BI order shown in the dashboard images.
    const COLS = [
      { key:'horticulture',       label:'First horticulture',       type:'txt' },
      { key:'acres',              label:'Sum of acres',             type:'num' },
      { key:'other_horticulture', label:'First other_horticulture', type:'txt' },
      { key:'oil_seeds',          label:'First oil_seeds',          type:'txt' },
      { key:'other_oil_seeds',    label:'First other_oil_seeds',    type:'txt' },
      { key:'qty_seed',           label:'Sum of qty_seed',          type:'num' },
      { key:'qty_seed_measure',   label:'First qty_seed_measure',   type:'txt' },
      { key:'poultry',            label:'First poultry',            type:'txt' },
      { key:'other_poultry',      label:'First other_poultry',      type:'txt' },
      { key:'district_name',      label:'First district_name',      type:'txt' },
      { key:'profilers_name',     label:'First profilers_name',     type:'txt' },
      { key:'shg_count',          label:'Count of shg_id',          type:'num' },
      { key:'participant_count',  label:'Count of shg_participant_id', type:'num' },
      { key:'pwds',               label:'PWDs_in_Production',       type:'num' },
    ];

    const SL = [
      { id:'dist', mount:'sl-dist', label:'District_name', optsKey:'districts',   search:true },
      { id:'vc',   mount:'sl-vc',   label:'Value chain',   optsKey:'valuechains', search:false },
    ];
    const SL_PARAM = { dist:'districts', vc:'valuechains' };

    const S = {};
    SL.forEach(s => S[s.id] = { id:s.id, opts:[], sel:new Set(), all:true, cfg:s });

    let sortKey = 'participant_count';
    let lastData = null;

    function param(id){ const s=S[id]; return s.all ? '' : [...s.sel].join(','); }

    // ---- Slicers ----
    function buildSlicerShell(s){
      const searchHtml = s.cfg.search
        ? '<input id="'+s.id+'Search" type="text" placeholder="Search…" class="mini-search mb-1" />' : '';
      document.getElementById(s.cfg.mount).innerHTML =
        '<div class="slbl mb-1">'+s.cfg.label+'</div>'
        + searchHtml
        + '<div class="flex gap-1 mb-1">'
        +   '<button class="mini-btn flex-1 font-semibold" data-all="'+s.id+'">Select all</button>'
        +   '<button class="mini-btn flex-1 font-semibold" data-none="'+s.id+'">None</button>'
        + '</div>'
        + '<div id="'+s.id+'List" class="scrollbar-thin overflow-y-auto max-h-[320px] pr-1"></div>';
      if (s.cfg.search)
        document.getElementById(s.id+'Search').addEventListener('input', ()=>renderSlicer(s.id));
      document.querySelector('[data-all="'+s.id+'"]').addEventListener('click', ()=>{ s.all=true; s.sel=new Set(); renderSlicer(s.id); load(); });
      document.querySelector('[data-none="'+s.id+'"]').addEventListener('click', ()=>{ s.all=false; s.sel=new Set(); renderSlicer(s.id); load(); });
    }
    function renderSlicer(id){
      const s = S[id];
      const box = document.getElementById(id+'List');
      if (!box) return;
      const se = s.cfg.search ? document.getElementById(id+'Search') : null;
      const q = se ? (se.value||'').toLowerCase() : '';
      let html=''; let shown=0;
      for (const o of s.opts){
        if (q && !o.toLowerCase().includes(q)) continue;
        if (++shown > 500){ html+='<div class="text-[var(--muted)] text-[9px] py-1">…refine search…</div>'; break; }
        const on = s.all || s.sel.has(o);
        html += '<label class="dist-item"><input type="checkbox" data-o="'+o.replace(/"/g,'&quot;')+'" '+(on?'checked':'')+'/><span>'+o+'</span></label>';
      }
      if (!html) html='<div class="text-[var(--muted)] text-[10px] py-1">No match.</div>';
      box.innerHTML = html;
      box.querySelectorAll('input[data-o]').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          const o = cb.getAttribute('data-o');
          if (s.all){ s.sel=new Set(s.opts); s.all=false; }
          if (cb.checked) s.sel.add(o); else s.sel.delete(o);
          if (s.sel.size === s.opts.length) s.all=true;
          renderSlicer(id); load();
        });
      });
    }

    // ---- Table ----
    function cell(r, c){
      const v = r[c.key];
      if (c.type==='num'){ const n = Number(v)||0; return '<td class="num">'+num(n)+'</td>'; }
      return '<td>'+(v==null?'':v)+'</td>';
    }
    function renderHead(){
      let html = '<tr><th style="min-width:260px">shg_name</th>';
      for (const c of COLS){
        const sortable = c.type==='num' ? ' sortable' : '';
        const arrow = c.type==='num' ? '<span class="arrow" data-k="'+c.key+'"></span>' : '';
        html += '<th class="'+(c.type==='num'?'num':'')+sortable+'" '+(c.type==='num'?'data-k="'+c.key+'"':'')+'>'+c.label+arrow+'</th>';
      }
      html += '</tr>';
      document.getElementById('thead').innerHTML = html;
      document.querySelectorAll('#thead th.sortable').forEach(th=>
        th.addEventListener('click', ()=>{ sortKey = th.getAttribute('data-k'); renderTable(); }));
    }
    function renderTable(){
      if (!lastData){ return; }
      const rows = lastData.rows || [];
      const total = lastData.total || {};
      renderHead();
      const tbody = document.getElementById('tbody');
      const span = COLS.length + 1;
      if (!rows.length){ tbody.innerHTML='<tr><td colspan="'+span+'" class="text-center text-[var(--muted)] py-8">No data for this selection.</td></tr>'; return; }
      const sorted = [...rows].sort((a,b)=> (Number(b[sortKey])||0) - (Number(a[sortKey])||0));
      let html='';
      for (const r of sorted){
        html += '<tr><td>'+(r.shg_name||'')+'</td>' + COLS.map(c=>cell(r,c)).join('') + '</tr>';
      }
      // Total row (only some columns have totals)
      const totalKeys = { acres:1, qty_seed:1, shg_count:1, participant_count:1, pwds:1 };
      html += '<tr class="total-row"><td>Total</td>'
        + COLS.map(c=>{
            if (c.type==='num' && totalKeys[c.key]){ return '<td class="num">'+num(total[c.key])+'</td>'; }
            return '<td></td>';
          }).join('')
        + '</tr>';
      tbody.innerHTML = html;
      document.querySelectorAll('#thead .arrow').forEach(a=>a.textContent='');
      const ar = document.querySelector('#thead .arrow[data-k="'+sortKey+'"]');
      if (ar) ar.textContent='▼';
    }

    function filterParams(){
      const params = new URLSearchParams();
      for (const s of SL){ const p = param(s.id); if (p) params.set(SL_PARAM[s.id], p); }
      const fe = document.getElementById('fromDate'); const f = fe ? fe.value : '';
      const te = document.getElementById('toDate');   const t = te ? te.value : '';
      if (f) params.set('from', f);
      if (t) params.set('to', t);
      return params;
    }

    async function loadOptions(){
      try{
        const res = await fetch('/api/production/options');
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        for (const s of SL){
          const list = d[s.optsKey];
          if (list && list.length){ S[s.id].opts = list; renderSlicer(s.id); }
        }
      }catch(err){ /* slicers stay All; load() fallback fills them */ }
    }

    async function load(){
      const params = filterParams();
      const tb = document.getElementById('tbody');
      if (tb) tb.innerHTML = '<tr><td class="text-center text-[var(--muted)] py-8"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
      try{
        const res = await fetch('/api/production?'+params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        lastData = d;
        const a=document.getElementById('kpiShgs'); if(a) a.textContent=fmt(d.unique_shgs);
        const b=document.getElementById('kpiParts'); if(b) b.textContent=fmt(d.unique_participants);
        const c=document.getElementById('kpiNew'); if(c) c.textContent=fmt(d.new_participants);
        for (const s of SL){
          if (d[s.optsKey] && d[s.optsKey].length && S[s.id].opts.length === 0){
            S[s.id].opts = d[s.optsKey]; renderSlicer(s.id);
          }
        }
        renderTable();
      }catch(err){
        const eb = document.getElementById('tbody');
        if (eb) eb.innerHTML =
          '<tr><td class="text-center text-red-500 py-8">Failed to load: '+err.message+'</td></tr>';
      }
    }

    function applyPreset(kind){
      const from = document.getElementById('fromDate'), to = document.getElementById('toDate');
      if (kind === 'clear'){ from.value=''; to.value=''; load(); return; }
      const base = new Date((from.value || '2026-06-01') + 'T00:00:00');
      const y = base.getFullYear(), mo = base.getMonth();
      if (kind === 'thismonth'){
        const last = new Date(y, mo+1, 0).getDate();
        from.value = y+'-'+String(mo+1).padStart(2,'0')+'-01';
        to.value   = y+'-'+String(mo+1).padStart(2,'0')+'-'+String(last).padStart(2,'0');
      }
      load();
    }

    // init
    SL.forEach(s=>buildSlicerShell(S[s.id]));
    (function seedFromBoot(){
      const boot = window.__OPTS__ || {};
      for (const s of SL){
        const list = boot[s.optsKey];
        if (list && list.length){ S[s.id].opts = list; renderSlicer(s.id); }
      }
    })();
    document.getElementById('fromDate').addEventListener('change', load);
    document.getElementById('toDate').addEventListener('change', load);
    document.querySelectorAll('.preset').forEach(b=>
      b.addEventListener('click', ()=>applyPreset(b.getAttribute('data-preset'))));
    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/production/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    loadOptions();
    load();
  </script>
</body>
</html>`;
}
