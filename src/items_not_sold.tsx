import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// "ITEMS NOT SOLD"
//   Report_Not_Sold = FILTER(Distribution_Marketing_Matrix, [Has_Sold]="No")
//   Participants who RECEIVED an item (participants_shg ⋈ distribution_form_v2)
//   but never reported selling it in the marketing form (per value chain).
//   Wide detail table (one row per received-but-unsold item).
//   Filters: Value Chain, District, Days Since Distribution (range).
//   Data from /api/items-not-sold (+ /options).
// ---------------------------------------------------------------------------

export function renderItemsNotSold(base: string, opts: any = {}): string {
  const bootOpts = JSON.stringify({
    value_chains: opts.value_chains || [],
    districts: opts.districts || [],
    days_bounds: opts.days_bounds || { min: 0, max: 0 },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Items Not Sold</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#28343a; --muted:#7c8a8f;
      --head:#8a3d2b; --row-alt:#fbeee6; --line:#e2d6cf; --amber:#e08a2b;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:10px;
           box-shadow:0 1px 2px rgba(40,60,60,.06); }
    .ttl{ background:#f3e6df; border-radius:12px; }
    .kpi{ position:relative; overflow:hidden; min-width:150px; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:4px; background:var(--head); }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--head); color:#fff; font-weight:700; font-size:10.5px;
              padding:6px 8px; text-align:left; position:sticky; top:0; z-index:2; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:4px 8px; font-size:11px; vertical-align:top; border-bottom:1px solid #f0e2d8; white-space:nowrap; }
    tbody td.num{ text-align:right; }
    tbody tr:nth-child(even) td{ background:var(--row-alt); }
    tbody tr:hover td{ background:#fbf4ef; }
    .dist-item{ display:flex; align-items:center; gap:6px; padding:2px 2px; cursor:pointer; font-size:12px; }
    .dist-item:hover{ background:var(--cream); border-radius:5px; }
    .dist-item input{ accent-color:var(--head); width:13px; height:13px; }
    .scrollbar-thin::-webkit-scrollbar{ width:8px; height:8px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#d8c4b8; border-radius:3px; }
    .slbl{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; }
    .mini-btn{ font-size:9px; padding:2px 4px; border-radius:4px; border:1px solid var(--line); background:#fff; }
    .mini-btn:hover{ background:var(--cream); }
    .mini-search{ width:100%; background:#fff; border:1px solid var(--line); border-radius:5px; padding:2px 6px; font-size:10px; }
    input[type=range]{ accent-color:var(--head); width:100%; }
    .badge{ display:inline-block; background:#fce6de; color:#8a3d2b; border-radius:5px; padding:1px 6px; font-size:10px; font-weight:700; }
  </style>
</head>
<body>
${navSidebar('itemsnotsold')}
  <div class="max-w-[1600px] mx-auto p-3 md:p-4">

    <div class="flex flex-wrap items-center gap-3 mb-3">
      <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to Home"><i class="fas fa-arrow-left"></i></a>

      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Participants (Not Sold)</div>
        <div id="kpiParts" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">SHGs</div>
        <div id="kpiShgs" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Items Not Sold</div>
        <div id="kpiItems" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>

      <div class="ttl px-5 py-1.5 flex-1 text-center"><h1 class="text-lg md:text-2xl font-extrabold tracking-tight">ITEMS NOT SOLD</h1></div>

      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--cream)] text-[var(--muted)]">
        <i class="fas fa-rotate mr-1"></i> Refresh
      </button>
    </div>

    <div class="grid grid-cols-12 gap-3">
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

      <aside class="col-span-12 lg:col-span-2 space-y-2">
        <div class="card p-2" id="sl-vc"></div>
        <div class="card p-2" id="sl-dist"></div>
        <div class="card p-2" id="sl-days">
          <div class="slbl mb-1">Days since distribution</div>
          <div class="flex items-center gap-2 text-[11px]">
            <input id="daysMin" type="number" class="w-16 bg-white border border-[var(--line)] rounded px-1.5 py-1" placeholder="min" />
            <span class="text-[var(--muted)]">to</span>
            <input id="daysMax" type="number" class="w-16 bg-white border border-[var(--line)] rounded px-1.5 py-1" placeholder="max" />
          </div>
          <div class="flex gap-1 mt-2">
            <button data-days="over90" class="mini-btn flex-1 font-semibold">&gt; 90 days</button>
            <button data-days="clear"  class="mini-btn flex-1 font-semibold">All</button>
          </div>
          <div id="daysHint" class="text-[9px] text-[var(--muted)] mt-1"></div>
        </div>
      </aside>
    </div>
  </div>

  <script>
    window.__OPTS__ = ${bootOpts};
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    const num = (v) => { const n = Number(v); return (n||0).toLocaleString('en-US',{maximumFractionDigits:2}); };

    // Column order mirrors the source matrix; numeric columns right-aligned.
    const COLS = [
      ['participant_name','Participant_Name','txt'],
      ['participant_id','Participant_ID','txt'],
      ['gender','Gender','txt'],
      ['shg_group_name','SHG_Group_Name','txt'],
      ['district','District','txt'],
      ['subcounty','Subcounty','txt'],
      ['value_chain','ValueChain','txt'],
      ['material_type','Material_Type','txt'],
      ['other_material_type','Other_Material_Type','txt'],
      ['livestock_type','Livestock_Type','txt'],
      ['crop_type','Crop_Type','txt'],
      ['agri_resources_type','Agri_Resources_Type','txt'],
      ['isla_kits','ISLA_Kits','txt'],
      ['unit_received','Unit_Received','txt'],
      ['qty_received','Qty_Received','num'],
      ['other_unit_received','Other_Unit_Received','txt'],
      ['plot_size','Plot_Size','txt'],
      ['parish','Parish','txt'],
      ['village','Village','txt'],
      ['qty_kgs','Qty_KGs','num'],
      ['qty_grams','Qty_Grams','num'],
      ['qty_liters','Qty_Liters','num'],
      ['qty_seedlings','Qty_Seedlings','num'],
      ['qty_packets','Qty_Packets','num'],
      ['qty_tins','Qty_Tins','num'],
      ['qty_pieces','Qty_Pieces','num'],
      ['qty_number','Qty_Number','num'],
      ['qty_acre','Qty_Acre','num'],
      ['qty_hectare','Qty_Hectare','num'],
      ['qty_other','Qty_Other','num'],
      ['distribution_date','Distribution_Date','txt'],
      ['partner','Partner','txt'],
      ['supplier','Supplier','txt'],
      ['distributor','Distributor','txt'],
      ['distributor_title','Distributor_Title','txt'],
      ['submitted_by','Submitted_By','txt'],
      ['distribution_id','Distribution_ID','txt'],
      ['submission_date','Submission_Date','txt'],
      ['has_sold','Has_Sold','txt'],
      ['total_qty_sold','Total_Qty_Sold','num'],
      ['days_since_distribution','Days_Since_Distribution','num'],
      ['shg_id','shg_id','txt'],
    ];

    const SL = [
      { id:'vc',   mount:'sl-vc',   label:'Value chain', optsKey:'value_chains', search:false },
      { id:'dist', mount:'sl-dist', label:'District',    optsKey:'districts',    search:true  },
    ];
    const SL_PARAM = { vc:'valuechains', dist:'districts' };

    const S = {};
    SL.forEach(s => S[s.id] = { id:s.id, opts:[], sel:new Set(), all:true, cfg:s });
    let lastData = null;
    let sortKey = 'days_since_distribution';

    function param(id){ const s=S[id]; return s.all ? '' : [...s.sel].join(','); }

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
        + '<div id="'+s.id+'List" class="scrollbar-thin overflow-y-auto max-h-[220px] pr-1"></div>';
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

    function renderHead(){
      let html = '<tr>';
      for (const [key,label,type] of COLS){
        const sortable = type==='num';
        html += '<th class="'+(type==='num'?'num':'')+(sortable?' cursor-pointer':'')+'" '+(sortable?'data-k="'+key+'"':'')+'>'+label+(key===sortKey?' ▼':'')+'</th>';
      }
      html += '</tr>';
      document.getElementById('thead').innerHTML = html;
      document.querySelectorAll('#thead th[data-k]').forEach(th=>
        th.addEventListener('click', ()=>{ sortKey = th.getAttribute('data-k'); renderTable(); }));
    }
    function fmtCell(v, type){
      if (v==null || v==='') return '';
      if (type==='num') return num(v);
      return String(v);
    }
    function renderTable(){
      if (!lastData) return;
      const rows = lastData.rows || [];
      renderHead();
      const tbody = document.getElementById('tbody');
      if (!rows.length){ tbody.innerHTML='<tr><td colspan="'+COLS.length+'" class="text-center text-[var(--muted)] py-8">No items match this selection.</td></tr>'; return; }
      const sorted = [...rows].sort((a,b)=> (Number(b[sortKey])||0) - (Number(a[sortKey])||0));
      let html='';
      for (const r of sorted){
        html += '<tr>';
        for (const [key,label,type] of COLS){
          const cls = type==='num' ? ' class="num"' : (key==='has_sold' ? ' class="text-center"' : '');
          const val = key==='has_sold'
            ? '<span class="badge">'+ (r[key]||'No') +'</span>'
            : fmtCell(r[key], type);
          html += '<td'+cls+'>'+val+'</td>';
        }
        html += '</tr>';
      }
      tbody.innerHTML = html;
    }

    function filterParams(){
      const params = new URLSearchParams();
      for (const s of SL){ const p = param(s.id); if (p) params.set(SL_PARAM[s.id], p); }
      const mn = document.getElementById('daysMin').value;
      const mx = document.getElementById('daysMax').value;
      if (mn !== '') params.set('daysMin', mn);
      if (mx !== '') params.set('daysMax', mx);
      return params;
    }

    async function loadOptions(){
      try{
        const res = await fetch('/api/items-not-sold/options');
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        for (const s of SL){
          const list = d[s.optsKey];
          if (list && list.length){ S[s.id].opts = list; renderSlicer(s.id); }
        }
        if (d.days_bounds){
          document.getElementById('daysHint').textContent =
            'Range in data: '+d.days_bounds.min+'–'+d.days_bounds.max+' days';
        }
      }catch(err){ /* slicers stay All */ }
    }

    async function load(){
      const params = filterParams();
      const tb = document.getElementById('tbody');
      if (tb) tb.innerHTML = '<tr><td class="text-center text-[var(--muted)] py-8"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
      try{
        const res = await fetch('/api/items-not-sold?'+params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        lastData = d;
        const a=document.getElementById('kpiParts'); if(a) a.textContent=fmt(d.unique_participants);
        const b=document.getElementById('kpiShgs');  if(b) b.textContent=fmt(d.unique_shgs);
        const c=document.getElementById('kpiItems'); if(c) c.textContent=fmt(d.total_items);
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

    SL.forEach(s=>buildSlicerShell(S[s.id]));
    (function seedFromBoot(){
      const boot = window.__OPTS__ || {};
      for (const s of SL){
        const list = boot[s.optsKey];
        if (list && list.length){ S[s.id].opts = list; renderSlicer(s.id); }
      }
      if (boot.days_bounds){
        document.getElementById('daysHint').textContent =
          'Range in data: '+boot.days_bounds.min+'–'+boot.days_bounds.max+' days';
      }
    })();

    document.getElementById('daysMin').addEventListener('change', load);
    document.getElementById('daysMax').addEventListener('change', load);
    document.querySelectorAll('[data-days]').forEach(b=>b.addEventListener('click', ()=>{
      const k = b.getAttribute('data-days');
      const mn = document.getElementById('daysMin'), mx = document.getElementById('daysMax');
      if (k==='clear'){ mn.value=''; mx.value=''; }
      if (k==='over90'){ mn.value='90'; mx.value=''; }
      load();
    }));
    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/items-not-sold/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    loadOptions();
    load();
  </script>
</body>
</html>`;
}
