// ---------------------------------------------------------------------------
// "Distribution to SHGs" — shg_group ⋈ distribution_form_v2
// (join on shg_group[__Submissions-id] = distribution_form_v2[_id]).
// Mirrors the SHG_GROUP_DISTRIBUTION_TABLE DAX. Power BI-style matrix grouped
// by SHG_Group_Name with an expandable hierarchy (click a group to reveal its
// individual distribution records). Empty columns auto-hide. Total row.
// Compact slicers (District, Material_Type, Unit_Received, Submitted_By,
// Other_Supplier). Data from /api/shg-distribution (+ /detail, /options).
// ---------------------------------------------------------------------------

export function renderShgDistribution(base: string, opts: any = {}): string {
  const bootOpts = JSON.stringify({
    districts: opts.districts || [],
    materials: opts.materials || [],
    units: opts.units || [],
    submitters: opts.submitters || [],
    suppliers: opts.suppliers || [],
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Distribution to SHGs</title>
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
    .ttl{ background:#eef5f6; border-radius:12px; }
    .kpi{ position:relative; overflow:hidden; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:4px; background:var(--teal); }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--head); color:#fff; font-weight:700; font-size:11px;
              padding:7px 9px; text-align:left; position:sticky; top:0; z-index:2; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:5px 9px; font-size:11.5px; vertical-align:top; border-bottom:1px solid #f0e6d8; white-space:nowrap; }
    tbody td.num{ text-align:right; }
    tbody tr.grp{ background:#fff; }
    tbody tr.grp td{ font-weight:700; border-bottom:2px solid var(--amber); }
    tbody tr.det td{ background:var(--row-alt); font-weight:400; border-bottom:1px solid #f0e6d8; }
    tbody tr.grp:hover td{ background:#f4fafb; }
    tbody tr.det:hover td{ background:#f6ead9; }
    tbody tr.total-row td{ background:var(--head) !important; color:#fff; font-weight:700; border-bottom:none; }
    .toggle{ cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:6px; }
    .toggle .box{ width:13px; height:13px; border:1px solid var(--muted); border-radius:2px; display:inline-flex;
                  align-items:center; justify-content:center; font-size:9px; line-height:1; color:var(--head); }
    .det-name{ padding-left:22px; }
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
  </style>
</head>
<body>
  <div class="max-w-[1600px] mx-auto p-3 md:p-4">

    <!-- Title + top toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to app"><i class="fas fa-arrow-left"></i></a>
      <div class="ttl px-4 py-1.5"><h1 class="text-lg md:text-xl font-extrabold tracking-tight">DISTRIBUTION TO SHGs</h1></div>

      <div class="flex items-center gap-1.5 card px-3 py-1.5">
        <span class="text-[10px] text-[var(--muted)] uppercase font-bold mr-1">Date</span>
        <input id="fromDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px]" />
        <span class="text-[var(--muted)] text-xs">→</span>
        <input id="toDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px]" />
        <button data-preset="clear" class="preset text-[10px] px-2 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] ml-1">All time</button>
        <button data-preset="thismonth" class="preset text-[10px] px-2 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)]">Month</button>
        <button data-preset="year" class="preset text-[10px] px-2 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)]">Year</button>
      </div>

      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--cream)] text-[var(--muted)] ml-auto">
        <i class="fas fa-rotate mr-1"></i> Refresh
      </button>
    </div>

    <!-- KPI cards -->
    <div class="grid grid-cols-3 gap-3 mb-3">
      <div class="card kpi p-2.5">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">SHGs Reached</div>
        <div id="kpiShgs" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi p-2.5">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Distribution Records</div>
        <div id="kpiRecs" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi p-2.5">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Total Qty Received</div>
        <div id="kpiQty" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-3">

      <!-- Main table — very wide (11/12) -->
      <section class="col-span-12 lg:col-span-11">
        <div class="card p-2">
          <div class="scrollbar-thin overflow-auto max-h-[calc(100vh-210px)]">
            <table id="tbl">
              <thead id="thead"></thead>
              <tbody id="tbody">
                <tr><td class="text-center text-[var(--muted)] py-8">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Right: compact narrow slicers (1/12) -->
      <aside class="col-span-12 lg:col-span-1 space-y-2">
        <div class="card p-2" id="sl-dist"></div>
        <div class="card p-2" id="sl-mat"></div>
        <div class="card p-2" id="sl-unit"></div>
        <div class="card p-2" id="sl-sub"></div>
        <div class="card p-2" id="sl-sup"></div>
      </aside>
    </div>
  </div>

  <script>
    // Slicer option lists embedded server-side so the slicers ALWAYS populate
    // synchronously on first paint (no dependency on any client fetch).
    window.__OPTS__ = ${bootOpts};
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    const num = (v) => { const n = Number(v); return (n||0).toLocaleString('en-US',{maximumFractionDigits:2}); };

    // Column definitions in DAX order. type:'num' right-aligned & sum, 'txt' left.
    // Every column auto-hides if empty across all visible rows.
    const COLS = [
      { key:'first_shg_group_id',           label:'SHG_Group_ID',                     type:'txt' },
      { key:'first_district',               label:'District',                         type:'txt' },
      { key:'first_subcounty',              label:'Subcounty',                        type:'txt' },
      { key:'first_unit',                   label:'First Unit_Received',              type:'txt' },
      { key:'first_other_unit',             label:'First Other_Unit_Received',        type:'txt' },
      { key:'qty_received',                 label:'Sum of Qty_Received',              type:'num' },
      { key:'first_material_type',          label:'First Material_Type',              type:'txt' },
      { key:'first_other_material_type',    label:'First Other_Material_Type',        type:'txt' },
      { key:'first_livestock_type',         label:'First Livestock_Type',             type:'txt' },
      { key:'first_other_livestock_type',   label:'First Other_Livestock_Type',       type:'txt' },
      { key:'first_crop_type',              label:'First Crop_Type',                  type:'txt' },
      { key:'first_other_crop_type',        label:'First Other_Crop_Type',            type:'txt' },
      { key:'first_agri_resources_type',    label:'First Agri_Resources_Type',        type:'txt' },
      { key:'first_other_agri_resources_type', label:'First Other_Agri_Resources_Type', type:'txt' },
      { key:'first_isla_kits',              label:'First ISLA_Kits',                  type:'txt' },
      { key:'first_other_isla_kits',        label:'First Other_ISLA_Kits',            type:'txt' },
      { key:'qty_kgs',                      label:'Sum of Qty_KGs',                   type:'num' },
      { key:'qty_grams',                    label:'Sum of Qty_Grams',                 type:'num' },
      { key:'qty_liters',                   label:'Sum of Qty_Liters',                type:'num' },
      { key:'qty_seedlings',                label:'Sum of Qty_Seedlings',             type:'num' },
      { key:'qty_packets',                  label:'Sum of Qty_Packets',               type:'num' },
      { key:'qty_tins',                     label:'Sum of Qty_Tins',                  type:'num' },
      { key:'qty_pieces',                   label:'Sum of Qty_Pieces',                type:'num' },
      { key:'qty_dozens',                   label:'Sum of Qty_Dozens',                type:'num' },
      { key:'qty_sackets',                  label:'Sum of Qty_Sackets',               type:'num' },
      { key:'qty_boxes',                    label:'Sum of Qty_Boxes',                 type:'num' },
      { key:'qty_number',                   label:'Sum of Qty_Number',                type:'num' },
      { key:'qty_meters',                   label:'Sum of Qty_Meters',                type:'num' },
      { key:'qty_kit',                      label:'Sum of Qty_Kit',                   type:'num' },
      { key:'qty_hectare',                  label:'Sum of Qty_Hectare',               type:'num' },
      { key:'qty_acre',                     label:'Sum of Qty_Acre',                  type:'num' },
      { key:'qty_foot',                     label:'Sum of Qty_Foot',                  type:'num' },
      { key:'qty_other',                    label:'Sum of Qty_Other',                 type:'num' },
      { key:'first_partner',                label:'First Partner',                    type:'txt' },
      { key:'first_supplier',               label:'First Supplier',                   type:'txt' },
      { key:'first_other_supplier',         label:'First Other_Supplier',             type:'txt' },
      { key:'first_distributor',            label:'First Distributor',                type:'txt' },
      { key:'first_distributor_title',      label:'First Distributor_Title',          type:'txt' },
      { key:'first_submitted_by',           label:'First Submitted_By',               type:'txt' },
      { key:'records_count',                label:'Distribution Records',             type:'num' },
    ];

    // Slicer configs. narrow=true means no search box.
    const SL = [
      { id:'dist', mount:'sl-dist', label:'District',        optsKey:'districts',  search:true },
      { id:'mat',  mount:'sl-mat',  label:'Material_Type',   optsKey:'materials',  search:false },
      { id:'unit', mount:'sl-unit', label:'Unit_Received',   optsKey:'units',      search:true },
      { id:'sub',  mount:'sl-sub',  label:'Submitted_By',    optsKey:'submitters', search:true },
      { id:'sup',  mount:'sl-sup',  label:'Other_Supplier',  optsKey:'suppliers',  search:true },
    ];
    const SL_PARAM = { dist:'districts', mat:'materials', unit:'units', sub:'submitters', sup:'suppliers' };

    const S = {};
    SL.forEach(s => S[s.id] = { id:s.id, opts:[], sel:new Set(), all:true, cfg:s });

    let sortKey = 'qty_received';
    let lastData = null;
    let expanded = new Set();      // SHG group names currently expanded
    let detailCache = {};          // shg -> record rows

    function param(id){ const s=S[id]; return s.all ? '' : [...s.sel].join(','); }

    // ---- Slicers ----
    function buildSlicerShell(s){
      const searchHtml = s.cfg.search
        ? '<input id="'+s.id+'Search" type="text" placeholder="Search…" class="mini-search mb-1" />' : '';
      document.getElementById(s.cfg.mount).innerHTML =
        '<div class="slbl mb-1">'+s.cfg.label+'</div>'
        + searchHtml
        + '<div class="flex gap-1 mb-1">'
        +   '<button class="mini-btn flex-1 font-semibold" data-all="'+s.id+'">All</button>'
        +   '<button class="mini-btn flex-1 font-semibold" data-none="'+s.id+'">None</button>'
        + '</div>'
        + '<div id="'+s.id+'List" class="scrollbar-thin overflow-y-auto max-h-[130px] pr-1"></div>';
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
        if (++shown > 300){ html+='<div class="text-[var(--muted)] text-[9px] py-1">…refine…</div>'; break; }
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
    function activeCols(rows, total){
      return COLS.filter(c=>{
        const anyRow = rows.some(r=>{
          const v=r[c.key];
          return c.type==='num' ? (Number(v)||0)!==0 : (v!=null && String(v).trim()!=='');
        });
        const t = total ? total[c.key] : null;
        const totalHas = c.type==='num' ? (Number(t)||0)!==0 : (t!=null && String(t).trim()!=='');
        return anyRow || totalHas;
      });
    }
    function cell(r, c){
      const v = r[c.key];
      if (c.type==='num'){
        const n = Number(v)||0;
        return '<td class="num">'+(n? num(n) : '')+'</td>';
      }
      return '<td>'+(v==null?'':v)+'</td>';
    }
    function renderHead(cols){
      let html = '<tr><th style="min-width:220px">SHG_Group_Name</th>';
      for (const c of cols){
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
      const cols = activeCols(rows, total);
      renderHead(cols);
      const tbody = document.getElementById('tbody');
      const span = cols.length + 1;
      if (!rows.length){ tbody.innerHTML='<tr><td colspan="'+span+'" class="text-center text-[var(--muted)] py-8">No data for this selection.</td></tr>'; return; }
      const sorted = [...rows].sort((a,b)=> (Number(b[sortKey])||0) - (Number(a[sortKey])||0));
      let html='';
      for (const r of sorted){
        const isOpen = expanded.has(r.shg_group_name);
        html += '<tr class="grp" data-shg="'+encodeURIComponent(r.shg_group_name)+'">'
          + '<td><span class="toggle" data-shg="'+encodeURIComponent(r.shg_group_name)+'">'
          +   '<span class="box">'+(isOpen?'−':'+')+'</span>'+(r.shg_group_name||'')+'</span></td>'
          + cols.map(c=>cell(r,c)).join('')
          + '</tr>';
        if (isOpen){
          const det = detailCache[r.shg_group_name];
          if (!det){
            html += '<tr class="det"><td class="det-name text-[var(--muted)]"><i class="fas fa-spinner fa-spin"></i> Loading…</td><td colspan="'+cols.length+'"></td></tr>';
          } else if (!det.length){
            html += '<tr class="det"><td class="det-name text-[var(--muted)]">No records.</td><td colspan="'+cols.length+'"></td></tr>';
          } else {
            for (const p of det){
              const lbl = (p.dist_date || p.first_material_type || 'record');
              html += '<tr class="det">'
                + '<td class="det-name">'+lbl+'</td>'
                + cols.map(c=>cell(p,c)).join('')
                + '</tr>';
            }
          }
        }
      }
      // Total row
      html += '<tr class="total-row"><td>Total</td>'
        + cols.map(c=>{
            if (c.type==='num'){ const n=Number(total[c.key])||0; return '<td class="num">'+(n?num(n):'')+'</td>'; }
            const v=total[c.key]; return '<td>'+(v==null?'':v)+'</td>';
          }).join('')
        + '</tr>';
      tbody.innerHTML = html;
      // sort arrow
      document.querySelectorAll('#thead .arrow').forEach(a=>a.textContent='');
      const ar = document.querySelector('#thead .arrow[data-k="'+sortKey+'"]');
      if (ar) ar.textContent='▼';
      // toggle handlers
      tbody.querySelectorAll('.toggle').forEach(t=>{
        t.addEventListener('click', ()=>toggleGroup(decodeURIComponent(t.getAttribute('data-shg'))));
      });
    }

    async function toggleGroup(shg){
      if (expanded.has(shg)){ expanded.delete(shg); renderTable(); return; }
      expanded.add(shg); renderTable();
      if (!detailCache[shg]){
        try{
          const params = filterParams(); params.set('shg', shg);
          const res = await fetch('/api/shg-distribution/detail?'+params.toString());
          const d = await res.json();
          detailCache[shg] = d.rows || [];
        }catch(err){ detailCache[shg] = []; }
        renderTable();
      }
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

    // Fill slicer option lists from the lightweight, dedicated endpoint so they
    // always populate quickly, independent of the heavy dashboard load.
    async function loadOptions(){
      try{
        const res = await fetch('/api/shg-distribution/options');
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        for (const s of SL){
          const list = d[s.optsKey];
          if (list && list.length){
            S[s.id].opts = list;
            renderSlicer(s.id);
          }
        }
      }catch(err){ /* slicers stay as All; load() also populates as fallback */ }
    }

    async function load(){
      detailCache = {};
      const params = filterParams();
      const tb = document.getElementById('tbody');
      if (tb) tb.innerHTML = '<tr><td class="text-center text-[var(--muted)] py-8"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
      try{
        const res = await fetch('/api/shg-distribution?'+params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        lastData = d;
        const ks = document.getElementById('kpiShgs'); if (ks) ks.textContent = fmt(d.shgs_reached);
        const kr = document.getElementById('kpiRecs'); if (kr) kr.textContent = fmt(d.records_count);
        const kq = document.getElementById('kpiQty');  if (kq) kq.textContent = num(d.total_qty);
        for (const s of SL){
          if (d[s.optsKey] && d[s.optsKey].length && S[s.id].opts.length === 0){
            S[s.id].opts = d[s.optsKey];
            renderSlicer(s.id);
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
      } else if (kind === 'year'){
        from.value = '2025-10-01'; to.value = '2026-09-30';
      }
      load();
    }

    // init slicers — build shells, then fill options from the server-embedded
    // lists so checkboxes appear on first paint (fetch fallbacks refresh later).
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
    // Default to All time — the SHG dataset is small (~926 rows) so this is fast.
    document.querySelectorAll('.preset').forEach(b=>
      b.addEventListener('click', ()=>applyPreset(b.getAttribute('data-preset'))));
    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/shg-distribution/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    loadOptions();   // fill slicers immediately (independent of the heavy query)
    load();
  </script>
</body>
</html>`;
}
