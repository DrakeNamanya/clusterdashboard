// ---------------------------------------------------------------------------
// "Trainings by Frontliners" — Power BI-style TRAININGS table for
// all_trainees_view, grouped by data_collector.
// Columns: data_collector, PWDs_Trained, Female_Reached, Youth_Trained,
// Groups_Reached, Training_Types_ListY, Group_Names_ListY, First district.
// Cream table theme; district filter (Select all / Unselect all + search),
// date range picker. Data from GET /api/frontliners (Supabase RPC).
// ---------------------------------------------------------------------------

export function renderFrontliners(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trainings by Frontliners</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#3d3128; --muted:#8a7c6d;
      --head:#33566b; --row-alt:#f5ead9; --line:#e6dccf; --orange:#c8622a;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:10px;
           box-shadow:0 1px 2px rgba(80,60,40,.06); }
    .ttl{ background:#fbf1e6; border-radius:12px; }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--head); color:#fff; font-weight:700; font-size:12px;
              padding:8px 10px; text-align:left; position:sticky; top:0; z-index:1; }
    thead th.num{ text-align:right; }
    tbody td{ padding:8px 10px; font-size:12px; vertical-align:top; border-bottom:1px solid #efe3d4; }
    tbody td.num{ text-align:right; white-space:nowrap; }
    tbody tr:nth-child(even){ background:var(--row-alt); }
    tbody tr:hover{ background:#f0e2cd; }
    .sortable{ cursor:pointer; user-select:none; }
    .sortable .arrow{ opacity:.6; font-size:10px; margin-left:3px; }
    .dist-item{ display:flex; align-items:center; gap:8px; padding:3px 2px; cursor:pointer; font-size:13px; }
    .dist-item:hover{ background:var(--cream); border-radius:6px; }
    .dist-item input{ accent-color:#2c241d; width:14px; height:14px; }
    .scrollbar-thin::-webkit-scrollbar{ width:7px; height:7px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#d9cdbf; border-radius:3px; }
  </style>
</head>
<body>
  <div class="max-w-[1300px] mx-auto p-4 md:p-6">

    <!-- Title bar -->
    <div class="flex items-center justify-between mb-4">
      <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to app"><i class="fas fa-arrow-left"></i></a>
      <div class="ttl px-8 py-2"><h1 class="text-2xl md:text-3xl font-extrabold tracking-tight">TRAININGS</h1></div>
      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--cream)] text-[var(--muted)]">
        <i class="fas fa-rotate mr-1"></i> Refresh data
      </button>
    </div>

    <div class="grid grid-cols-12 gap-4">

      <!-- Main table -->
      <section class="col-span-12 md:col-span-9">
        <div class="card p-2">
          <div class="scrollbar-thin overflow-auto max-h-[calc(100vh-190px)]">
            <table id="tbl">
              <thead>
                <tr>
                  <th>data_collector</th>
                  <th class="num sortable" data-k="pwds_trained">PWDs_Trained<span class="arrow"></span></th>
                  <th class="num sortable" data-k="female_reached">Female_Reached<span class="arrow"></span></th>
                  <th class="num sortable" data-k="youth_trained">Youth_Trained<span class="arrow">▼</span></th>
                  <th class="num sortable" data-k="groups_reached">Groups_Reached<span class="arrow"></span></th>
                  <th>Training_Types_ListY</th>
                  <th>Group_Names_ListY</th>
                  <th>First district</th>
                </tr>
              </thead>
              <tbody id="tbody">
                <tr><td colspan="8" class="text-center text-[var(--muted)] py-8">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Right: date + district filters -->
      <aside class="col-span-12 md:col-span-3 space-y-4">
        <div class="card p-3">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-2">Date range</div>
          <label class="block text-[10px] text-[var(--muted)] mb-0.5">From</label>
          <input id="fromDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px] w-full mb-1.5" />
          <label class="block text-[10px] text-[var(--muted)] mb-0.5">To</label>
          <input id="toDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px] w-full mb-2" />
          <div class="grid grid-cols-3 gap-1">
            <button data-preset="clear" class="preset text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)]">All time</button>
            <button data-preset="thismonth" class="preset text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)]">Month</button>
            <button data-preset="year" class="preset text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)]">Year</button>
          </div>
        </div>
        <div class="card p-3">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-2">District</div>
          <input id="distSearch" type="text" placeholder="Search…" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px] mb-2" />
          <div class="flex gap-1 mb-2">
            <button id="selAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">Select all</button>
            <button id="clrAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] font-semibold">Unselect all</button>
          </div>
          <div id="districtList" class="scrollbar-thin overflow-y-auto max-h-[360px] pr-1 text-sm">
            <div class="text-[var(--muted)] text-xs">Loading…</div>
          </div>
        </div>
        <div class="text-[11px] text-[var(--muted)] px-1"><span id="rowCount">–</span> frontliners</div>
      </aside>
    </div>
  </div>

  <script>
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    let districts = [];
    let selected = new Set();
    let allMode = true;
    let sortKey = 'youth_trained';
    let lastRows = [];

    function selectedParam(){ return allMode ? '' : [...selected].join(','); }

    function renderDistricts(){
      const box = document.getElementById('districtList');
      const q = (document.getElementById('distSearch').value || '').toLowerCase();
      let html = '';
      for (const d of districts){
        if (q && !d.toLowerCase().includes(q)) continue;
        const on = allMode || selected.has(d);
        html += '<label class="dist-item"><input type="checkbox" data-d="'+d+'" '
             + (on ? 'checked' : '') + '/><span>'+d+'</span></label>';
      }
      if (!html) html = '<div class="text-[var(--muted)] text-xs py-2">No match.</div>';
      box.innerHTML = html;
      box.querySelectorAll('input[data-d]').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          const d = cb.getAttribute('data-d');
          if (allMode){ selected = new Set(districts); allMode = false; }
          if (cb.checked) selected.add(d); else selected.delete(d);
          if (selected.size === districts.length){ allMode = true; }
          renderDistricts(); load();
        });
      });
    }
    function selectAll(){ allMode = true; selected = new Set(); renderDistricts(); load(); }
    function unselectAll(){ allMode = false; selected = new Set(); renderDistricts(); load(); }

    function renderTable(rows){
      lastRows = rows;
      const tbody = document.getElementById('tbody');
      document.getElementById('rowCount').textContent = fmt(rows.length);
      if (!rows.length){ tbody.innerHTML = '<tr><td colspan="8" class="text-center text-[var(--muted)] py-8">No data for this selection.</td></tr>'; return; }
      const sorted = [...rows].sort((a,b)=> (b[sortKey]??0) - (a[sortKey]??0));
      tbody.innerHTML = sorted.map(r=>
        '<tr>'
        + '<td class="font-semibold">'+(r.data_collector||'')+'</td>'
        + '<td class="num">'+fmt(r.pwds_trained)+'</td>'
        + '<td class="num">'+fmt(r.female_reached)+'</td>'
        + '<td class="num">'+fmt(r.youth_trained)+'</td>'
        + '<td class="num">'+fmt(r.groups_reached)+'</td>'
        + '<td>'+(r.training_types||'')+'</td>'
        + '<td>'+(r.group_names||'')+'</td>'
        + '<td>'+(r.first_district||'')+'</td>'
        + '</tr>'
      ).join('');
      // update sort arrows
      document.querySelectorAll('th.sortable .arrow').forEach(a=>a.textContent='');
      const th = document.querySelector('th.sortable[data-k="'+sortKey+'"] .arrow');
      if (th) th.textContent = '▼';
    }

    async function load(){
      if (!allMode && selected.size === 0){ renderTable([]); return; }
      const params = new URLSearchParams();
      const dp = selectedParam(); if (dp) params.set('districts', dp);
      const f = document.getElementById('fromDate').value; if (f) params.set('from', f);
      const t = document.getElementById('toDate').value;   if (t) params.set('to', t);
      document.getElementById('tbody').innerHTML = '<tr><td colspan="8" class="text-center text-[var(--muted)] py-8"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
      try{
        const res = await fetch('/api/frontliners?' + params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        if (!districts.length && d.districts){ districts = d.districts; renderDistricts(); }
        renderTable(d.rows || []);
      }catch(err){
        document.getElementById('tbody').innerHTML =
          '<tr><td colspan="8" class="text-center text-red-500 py-8">Failed to load: '+err.message+'</td></tr>';
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

    // Default: all time, all districts (matches the reference "TRAININGS" table).
    document.getElementById('fromDate').addEventListener('change', load);
    document.getElementById('toDate').addEventListener('change', load);
    document.getElementById('distSearch').addEventListener('input', renderDistricts);
    document.getElementById('selAllBtn').addEventListener('click', selectAll);
    document.getElementById('clrAllBtn').addEventListener('click', unselectAll);
    document.querySelectorAll('.preset').forEach(b=>
      b.addEventListener('click', ()=>applyPreset(b.getAttribute('data-preset'))));
    document.querySelectorAll('th.sortable').forEach(th=>
      th.addEventListener('click', ()=>{ sortKey = th.getAttribute('data-k'); renderTable(lastRows); }));

    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/frontliners/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    load();
  </script>
</body>
</html>`;
}
