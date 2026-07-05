// ---------------------------------------------------------------------------
// "Distribution to Participants" — participants_shg ⋈ distribution_form_v2
// (join on participants_shg[__Submissions-id] = distribution_form_v2[_id]).
// Title, date slicer, 3 KPI cards (Unique / New Distributees, SHGs distributees),
// table grouped by SHG_Name (First District_Name, First Material_Type,
// First Other_Material_Type, Sum of Qty_Received, First Unit) + Total row,
// and District / Material_Type / Unit slicers (Select all / None + search).
// Data from GET /api/distribution (Supabase RPC distribution_dash).
// ---------------------------------------------------------------------------

export function renderDistribution(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Distribution to Participants</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#28343a; --muted:#7c8a8f;
      --head:#2f5d6b; --row-alt:#e9f0f1; --line:#d9e2e3; --teal:#2f8f9d;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:10px;
           box-shadow:0 1px 2px rgba(40,60,60,.06); }
    .ttl{ background:#eef5f6; border-radius:12px; }
    .kpi{ position:relative; overflow:hidden; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:4px; background:var(--teal); }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--head); color:#fff; font-weight:700; font-size:12px;
              padding:8px 10px; text-align:left; position:sticky; top:0; z-index:1; }
    thead th.num{ text-align:right; }
    tbody td{ padding:7px 10px; font-size:12px; vertical-align:top; border-bottom:1px solid #e6eeef; }
    tbody td.num{ text-align:right; white-space:nowrap; }
    tbody tr:nth-child(even){ background:var(--row-alt); }
    tbody tr:hover{ background:#dce8ea; }
    tbody tr.total-row{ background:var(--head) !important; color:#fff; font-weight:700; position:sticky; bottom:0; }
    tbody tr.total-row td{ border-bottom:none; }
    .sortable{ cursor:pointer; user-select:none; }
    .sortable .arrow{ opacity:.6; font-size:10px; margin-left:3px; }
    .dist-item{ display:flex; align-items:center; gap:8px; padding:3px 2px; cursor:pointer; font-size:13px; }
    .dist-item:hover{ background:var(--cream); border-radius:6px; }
    .dist-item input{ accent-color:#2f5d6b; width:14px; height:14px; }
    .scrollbar-thin::-webkit-scrollbar{ width:7px; height:7px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#c7d4d5; border-radius:3px; }
  </style>
</head>
<body>
  <div class="max-w-[1300px] mx-auto p-4 md:p-6">

    <!-- Title + top toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to app"><i class="fas fa-arrow-left"></i></a>
      <div class="ttl px-5 py-1.5"><h1 class="text-xl md:text-2xl font-extrabold tracking-tight">DISTRIBUTION TO PARTICIPANTS</h1></div>

      <!-- Compact date range slicer -->
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
      <div class="card kpi p-3">
        <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-semibold">Unique Distributees</div>
        <div id="kpiUnique" class="text-3xl font-extrabold mt-1">–</div>
      </div>
      <div class="card kpi p-3">
        <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-semibold">New Distributees</div>
        <div id="kpiNew" class="text-3xl font-extrabold mt-1">–</div>
      </div>
      <div class="card kpi p-3">
        <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-semibold">SHGs distributees</div>
        <div id="kpiShgs" class="text-3xl font-extrabold mt-1">–</div>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-3">

      <!-- Main table -->
      <section class="col-span-12 lg:col-span-9">
        <div class="card p-2">
          <div class="scrollbar-thin overflow-auto max-h-[calc(100vh-260px)]">
            <table id="tbl">
              <thead>
                <tr>
                  <th>SHG_Name</th>
                  <th>First District_Name</th>
                  <th>First Material_Type</th>
                  <th>First Other_Material_Type</th>
                  <th class="num sortable" data-k="qty_received">Sum of Qty_Received<span class="arrow">▼</span></th>
                  <th>First Unit</th>
                </tr>
              </thead>
              <tbody id="tbody">
                <tr><td colspan="6" class="text-center text-[var(--muted)] py-8">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Right: District / Material_Type / Unit slicers -->
      <aside class="col-span-12 lg:col-span-3 space-y-3">
        <div class="card p-2.5">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-1.5">District</div>
          <input id="distSearch" type="text" placeholder="Search…" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[11px] mb-1.5" />
          <div class="flex gap-1 mb-1.5">
            <button id="selAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">Select all</button>
            <button id="clrAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">None</button>
          </div>
          <div id="districtList" class="scrollbar-thin overflow-y-auto max-h-[160px] pr-1 text-sm">
            <div class="text-[var(--muted)] text-xs">Loading…</div>
          </div>
        </div>
        <div class="card p-2.5">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-1.5">Material_Type</div>
          <div class="flex gap-1 mb-1.5">
            <button id="matAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">Select all</button>
            <button id="matNoneBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">None</button>
          </div>
          <div id="matList" class="scrollbar-thin overflow-y-auto max-h-[160px] pr-1 text-sm">
            <div class="text-[var(--muted)] text-xs">Loading…</div>
          </div>
        </div>
        <div class="card p-2.5">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-1.5">Unit</div>
          <input id="unitSearch" type="text" placeholder="Search…" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[11px] mb-1.5" />
          <div class="flex gap-1 mb-1.5">
            <button id="unitAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">Select all</button>
            <button id="unitNoneBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">None</button>
          </div>
          <div id="unitList" class="scrollbar-thin overflow-y-auto max-h-[160px] pr-1 text-sm">
            <div class="text-[var(--muted)] text-xs">Loading…</div>
          </div>
        </div>
      </aside>
    </div>
  </div>

  <script>
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    const num = (n) => (Number(n) || 0).toLocaleString('en-US', {maximumFractionDigits: 2});

    // Three independent multi-select slicers. Each: options[], sel Set, allMode.
    const S = {
      dist: { opts: [], sel: new Set(), all: true, listId: 'districtList', searchId: 'distSearch' },
      mat:  { opts: [], sel: new Set(), all: true, listId: 'matList',      searchId: null },
      unit: { opts: [], sel: new Set(), all: true, listId: 'unitList',     searchId: 'unitSearch' },
    };
    let sortKey = 'qty_received';
    let lastRows = [];

    function param(s){ return s.all ? '' : [...s.sel].join(','); }

    function renderSlicer(key){
      const s = S[key];
      const box = document.getElementById(s.listId);
      const q = s.searchId ? (document.getElementById(s.searchId).value || '').toLowerCase() : '';
      let html = '';
      for (const o of s.opts){
        if (q && !o.toLowerCase().includes(q)) continue;
        const on = s.all || s.sel.has(o);
        html += '<label class="dist-item"><input type="checkbox" data-o="'+o.replace(/"/g,'&quot;')+'" '
             + (on ? 'checked' : '') + '/><span>'+o+'</span></label>';
      }
      if (!html) html = '<div class="text-[var(--muted)] text-xs py-2">No match.</div>';
      box.innerHTML = html;
      box.querySelectorAll('input[data-o]').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          const o = cb.getAttribute('data-o');
          if (s.all){ s.sel = new Set(s.opts); s.all = false; }
          if (cb.checked) s.sel.add(o); else s.sel.delete(o);
          if (s.sel.size === s.opts.length){ s.all = true; }
          renderSlicer(key); load();
        });
      });
    }
    function selectAll(key){ const s=S[key]; s.all=true; s.sel=new Set(); renderSlicer(key); load(); }
    function selectNone(key){ const s=S[key]; s.all=false; s.sel=new Set(); renderSlicer(key); load(); }

    function renderTable(rows, totalQty){
      lastRows = rows;
      const tbody = document.getElementById('tbody');
      if (!rows.length){ tbody.innerHTML = '<tr><td colspan="6" class="text-center text-[var(--muted)] py-8">No data for this selection.</td></tr>'; return; }
      const sorted = [...rows].sort((a,b)=> (Number(b[sortKey])||0) - (Number(a[sortKey])||0));
      let html = sorted.map(r=>
        '<tr>'
        + '<td class="font-semibold">'+(r.shg_name||'')+'</td>'
        + '<td>'+(r.first_district||'')+'</td>'
        + '<td>'+(r.first_material_type||'')+'</td>'
        + '<td>'+(r.first_other_material_type||'')+'</td>'
        + '<td class="num">'+num(r.qty_received)+'</td>'
        + '<td>'+(r.first_unit||'')+'</td>'
        + '</tr>'
      ).join('');
      // Total row
      html += '<tr class="total-row">'
        + '<td>Total</td><td></td><td></td><td></td>'
        + '<td class="num">'+num(totalQty)+'</td><td></td></tr>';
      tbody.innerHTML = html;
      document.querySelectorAll('th.sortable .arrow').forEach(a=>a.textContent='');
      const th = document.querySelector('th.sortable[data-k="'+sortKey+'"] .arrow');
      if (th) th.textContent = '▼';
    }

    let firstLoad = true;
    async function load(){
      const params = new URLSearchParams();
      const dp = param(S.dist); if (dp) params.set('districts', dp);
      const mp = param(S.mat);  if (mp) params.set('materials', mp);
      const up = param(S.unit); if (up) params.set('units', up);
      const f = document.getElementById('fromDate').value; if (f) params.set('from', f);
      const t = document.getElementById('toDate').value;   if (t) params.set('to', t);
      document.getElementById('tbody').innerHTML = '<tr><td colspan="6" class="text-center text-[var(--muted)] py-8"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
      try{
        const res = await fetch('/api/distribution?' + params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        document.getElementById('kpiUnique').textContent = fmt(d.unique_distributees);
        document.getElementById('kpiNew').textContent    = fmt(d.new_distributees);
        document.getElementById('kpiShgs').textContent   = fmt(d.shgs_distributees);
        // Populate slicer option lists once (they are global).
        if (firstLoad){
          if (d.districts){ S.dist.opts = d.districts; renderSlicer('dist'); }
          if (d.materials){ S.mat.opts  = d.materials; renderSlicer('mat'); }
          if (d.units){     S.unit.opts = d.units;     renderSlicer('unit'); }
          firstLoad = false;
        }
        renderTable(d.rows || [], d.total_qty);
      }catch(err){
        document.getElementById('tbody').innerHTML =
          '<tr><td colspan="6" class="text-center text-red-500 py-8">Failed to load: '+err.message+'</td></tr>';
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

    document.getElementById('fromDate').addEventListener('change', load);
    document.getElementById('toDate').addEventListener('change', load);
    document.getElementById('distSearch').addEventListener('input', ()=>renderSlicer('dist'));
    document.getElementById('unitSearch').addEventListener('input', ()=>renderSlicer('unit'));
    document.getElementById('selAllBtn').addEventListener('click', ()=>selectAll('dist'));
    document.getElementById('clrAllBtn').addEventListener('click', ()=>selectNone('dist'));
    document.getElementById('matAllBtn').addEventListener('click', ()=>selectAll('mat'));
    document.getElementById('matNoneBtn').addEventListener('click', ()=>selectNone('mat'));
    document.getElementById('unitAllBtn').addEventListener('click', ()=>selectAll('unit'));
    document.getElementById('unitNoneBtn').addEventListener('click', ()=>selectNone('unit'));
    document.querySelectorAll('.preset').forEach(b=>
      b.addEventListener('click', ()=>applyPreset(b.getAttribute('data-preset'))));
    document.querySelectorAll('th.sortable').forEach(th=>
      th.addEventListener('click', ()=>{ sortKey = th.getAttribute('data-k');
        const totalQty = lastRows.reduce((a,r)=>a+(Number(r.qty_received)||0),0);
        renderTable(lastRows, totalQty); }));

    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/distribution/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    load();
  </script>
</body>
</html>`;
}
