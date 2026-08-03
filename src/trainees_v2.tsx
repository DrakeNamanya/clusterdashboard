import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// "Trainees (from Attendance)" — NEW trainees dashboard built from the true
// source: the 4 attendance OData feeds (v1+v2 parent⋈child) → public.trainees_v2.
//
// Unlike the legacy all_trainees_view, this exposes the per-training-type
// detail (Cornerstone, PRSP, VBHCD, ISLA, incubation, agrihub, sacco, ToT…)
// plus location down to village.
//
// Two headline counts (per the programme's definitions):
//   • Cluster attendances  = COUNT(*)             — one per participant-session
//   • Youth trained (uniq) = DISTINCT participant_id
//   • Monthly New Youth    = participant counted once, in the month of their
//                            FIRST activity_day (first-touch attribution).
//
// Data: GET /api/trainees-v2  (filters: districts, from, to, training_type).
// ---------------------------------------------------------------------------

export function renderTraineesV2(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trainees (from Attendance)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#3d3128; --muted:#8a7c6d;
      --green:#12d100; --green-soft:#e9f9e6; --line:#efe7de; --navy:#0B3C5D;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:12px;
           box-shadow:0 1px 2px rgba(80,60,40,.05); }
    .kpi-num{ font-weight:800; letter-spacing:-.02em; line-height:1; color:#2c241d; }
    .kpi-label{ color:var(--muted); font-weight:600; }
    .bar-fill{ background:var(--green); height:16px; border-radius:2px; transition:width .5s ease; }
    .dist-item{ display:flex; align-items:center; gap:8px; padding:3px 2px; cursor:pointer; font-size:13px; }
    .dist-item:hover{ background:var(--cream); border-radius:6px; }
    .dist-item input{ accent-color:#2c241d; width:14px; height:14px; }
    .scrollbar-thin::-webkit-scrollbar{ width:6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#d9cdbf; border-radius:3px; }
    .badge{ display:inline-block; font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px;
            background:var(--green-soft); color:#0a6b00; }
    table.tv2 th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); padding:6px 8px; border-bottom:2px solid var(--line); }
    table.tv2 td{ font-size:13px; padding:6px 8px; border-bottom:1px solid var(--line); }
    table.tv2 tr:hover td{ background:var(--cream); }
  </style>
</head>
<body>
${navSidebar('traineesv2')}
  <div class="max-w-[1280px] mx-auto p-4 md:p-6">

    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to Home"><i class="fas fa-arrow-left"></i></a>
        <h1 class="text-xl md:text-2xl font-extrabold tracking-tight">Trainees <span class="badge ml-1">NEW · from attendance forms</span></h1>
      </div>
      <div class="text-[11px] text-[var(--muted)]">Source: attendance_registration_form (v1 + v2) · parent ⋈ child</div>
    </div>
    <div class="card p-3 mb-4 text-[12px] text-[var(--ink)] bg-[var(--green-soft)] border-[var(--green)]">
      <i class="fas fa-circle-info mr-1 text-[var(--green)]"></i>
      <b>How youth are counted:</b> a participant is counted <b>once</b> as a
      <b>new youth</b> — in the month of their <b>first-ever</b> training (all rows
      checked since inception, v1 + v2 appended). Attending many trainings does
      <b>not</b> inflate this. The grey <i>“Total attendances”</i> card is the raw
      session count (a youth trained 8 times = 8 there) and is <b>not</b> a reported figure.
    </div>

    <div class="grid grid-cols-12 gap-4">

      <!-- Left: filters -->
      <aside class="col-span-12 md:col-span-2 space-y-4">
        <div class="card p-3">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-2">District</div>
          <div id="districtList" class="scrollbar-thin overflow-y-auto max-h-[300px] pr-1 text-sm">
            <div class="text-[var(--muted)] text-xs">Loading…</div>
          </div>
        </div>
        <div class="card p-3">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-2">Training type</div>
          <select id="ttypeSel" class="w-full text-xs border border-[var(--line)] rounded px-2 py-1 bg-white">
            <option value="">All types</option>
          </select>
        </div>
        <div class="card p-3">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-2">Date range</div>
          <label class="block text-[11px] text-[var(--muted)]">From</label>
          <input id="fromDate" type="date" class="w-full bg-transparent border border-[var(--line)] rounded px-2 py-1 text-xs mb-2" />
          <label class="block text-[11px] text-[var(--muted)]">To</label>
          <input id="toDate" type="date" class="w-full bg-transparent border border-[var(--line)] rounded px-2 py-1 text-xs" />
          <button id="clearDates" class="mt-2 text-[11px] text-[var(--muted)] underline">Clear dates (all time)</button>
        </div>
      </aside>

      <!-- Right -->
      <section class="col-span-12 md:col-span-10 space-y-4">

        <!-- KPI cards: the REPORTED metric (new youth, counted once ever) leads. -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="card p-4 text-center flex flex-col justify-center" style="border:2px solid var(--green)" title="Each participant counted ONCE — as a new youth in the month of their first-ever training (scanning all rows since inception). This is the figure the programme reports.">
            <div id="kpiYouth" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">New Youth Reached <span class="text-[10px] font-normal text-[var(--muted)]">(counted once)</span></div>
          </div>
          <div class="card p-4 text-center flex flex-col justify-center">
            <div id="kpiFemale" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">Female <span class="text-[10px] font-normal text-[var(--muted)]">(unique)</span></div>
          </div>
          <div class="card p-4 text-center flex flex-col justify-center">
            <div id="kpiPwd" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">PWDs <span class="text-[10px] font-normal text-[var(--muted)]">(unique)</span></div>
          </div>
          <div class="card p-4 text-center flex flex-col justify-center bg-[var(--cream)]" title="Raw session tally = COUNT(*) of every attendance row. A youth attending 8 trainings counts 8 times here. This is NOT a reported headline — it just shows training volume.">
            <div id="kpiAttend" class="kpi-num text-2xl md:text-3xl text-[var(--muted)]">–</div>
            <div class="kpi-label text-xs mt-1">Total attendances <span class="text-[10px] font-normal text-[var(--muted)]">(sessions, not youth)</span></div>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="card p-4 text-center">
            <div id="kpiTypes" class="kpi-num text-2xl md:text-3xl">–</div>
            <div class="kpi-label text-xs mt-1">Training types</div>
          </div>
          <div class="card p-4 text-center">
            <div id="kpiDistricts" class="kpi-num text-2xl md:text-3xl">–</div>
            <div class="kpi-label text-xs mt-1">Districts</div>
          </div>
          <div class="card p-4 text-center">
            <div id="kpiVillages" class="kpi-num text-2xl md:text-3xl">–</div>
            <div class="kpi-label text-xs mt-1">Villages</div>
          </div>
          <div class="card p-4 text-center">
            <div id="kpiMonths" class="kpi-num text-2xl md:text-3xl">–</div>
            <div class="kpi-label text-xs mt-1">Active months</div>
          </div>
        </div>

        <!-- Charts row -->
        <div class="grid grid-cols-12 gap-4">
          <div class="card p-5 col-span-12 md:col-span-7">
            <h2 class="text-center font-bold text-[15px] mb-4">Attendances by training type</h2>
            <div id="barChart" class="space-y-1.5 text-[13px]">
              <div class="text-[var(--muted)] text-center py-8">Loading…</div>
            </div>
          </div>
          <div class="card p-5 col-span-12 md:col-span-5">
            <h2 class="text-center font-bold text-[15px] mb-1">Monthly New Youth <span class="badge">v2</span></h2>
            <div class="text-center text-[10px] text-[var(--muted)] mb-3">first-touch · from attendance forms · compare with <a href="/monthly-new-youth" class="underline">legacy chart</a></div>
            <canvas id="monthChart" height="220"></canvas>
          </div>
        </div>

        <!-- By district table -->
        <div class="card p-5">
          <h2 class="font-bold text-[15px] mb-3">By district</h2>
          <div class="overflow-x-auto">
            <table class="tv2 w-full">
              <thead><tr>
                <th>District</th><th>Youth (uniq)</th><th>Attendances</th>
                <th>Female</th><th>PWDs</th><th>New Youth</th>
              </tr></thead>
              <tbody id="distTable"><tr><td colspan="6" class="text-[var(--muted)]">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>

      </section>
    </div>
  </div>

  <script>
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    let districts = [];
    let selected = new Set();
    let monthChart = null;

    function selectedParam(){ return selected.size ? [...selected].join(',') : ''; }

    function renderDistricts(){
      const box = document.getElementById('districtList');
      const all = selected.size === 0;
      let html = '<label class="dist-item font-semibold"><input type="checkbox" id="selAll" '
        + (all ? 'checked' : '') + '/><span>Select all</span></label>';
      for (const d of districts){
        const on = all || selected.has(d);
        html += '<label class="dist-item"><input type="checkbox" data-d="'+d+'" '
             + (on ? 'checked' : '') + '/><span>'+(d||'(blank)')+'</span></label>';
      }
      box.innerHTML = html;
      document.getElementById('selAll').addEventListener('change', ()=>{ selected.clear(); renderDistricts(); load(); });
      box.querySelectorAll('input[data-d]').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          const d = cb.getAttribute('data-d');
          if (selected.size === 0){ districts.forEach(x=>selected.add(x)); }
          if (cb.checked) selected.add(d); else selected.delete(d);
          if (selected.size === districts.length) selected.clear();
          renderDistricts(); load();
        });
      });
    }

    function renderBars(bars){
      const box = document.getElementById('barChart');
      if (!bars || !bars.length){ box.innerHTML='<div class="text-[var(--muted)] text-center py-8">No data.</div>'; return; }
      const max = Math.max(...bars.map(b=>b.value), 1);
      box.innerHTML = bars.map(b=>{
        const pct = Math.max((b.value/max)*100, b.value>0?1.5:0);
        return '<div class="grid grid-cols-[200px_1fr] items-center gap-3">'
          + '<div class="truncate text-right" title="'+b.label+'">'+b.label+'</div>'
          + '<div class="flex items-center gap-2"><div class="bar-fill" style="width:'+pct+'%"></div>'
          + '<span class="text-[12px] text-[var(--muted)] whitespace-nowrap">'+fmt(b.value)+'</span></div></div>';
      }).join('');
    }

    function renderMonth(series){
      const ctx = document.getElementById('monthChart');
      const labels = (series||[]).map(s=>s.month);
      const data = (series||[]).map(s=>s.value);
      if (monthChart) monthChart.destroy();
      monthChart = new Chart(ctx, {
        type:'line',
        data:{ labels, datasets:[{ label:'New youth', data, borderColor:'#0B3C5D',
          backgroundColor:'rgba(11,60,93,.12)', fill:true, tension:.25, pointRadius:2 }]},
        options:{ plugins:{legend:{display:false}}, scales:{ x:{ ticks:{ maxTicksLimit:8, font:{size:10} } }, y:{ beginAtZero:true } } }
      });
    }

    function renderDistTable(rows){
      const tb = document.getElementById('distTable');
      if (!rows || !rows.length){ tb.innerHTML='<tr><td colspan="6" class="text-[var(--muted)]">No data.</td></tr>'; return; }
      tb.innerHTML = rows.map(r=>'<tr>'
        + '<td class="font-semibold">'+(r.district||'(blank)')+'</td>'
        + '<td>'+fmt(r.youth)+'</td><td>'+fmt(r.attendances)+'</td>'
        + '<td>'+fmt(r.female)+'</td><td>'+fmt(r.pwds)+'</td><td>'+fmt(r.new_youth)+'</td></tr>').join('');
    }

    async function load(){
      const params = new URLSearchParams();
      const dp = selectedParam(); if (dp) params.set('districts', dp);
      const f = document.getElementById('fromDate').value; if (f) params.set('from', f);
      const t = document.getElementById('toDate').value;   if (t) params.set('to', t);
      const tt = document.getElementById('ttypeSel').value; if (tt) params.set('training_type', tt);
      try{
        const res = await fetch('/api/trainees-v2?' + params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        if (!districts.length && d.districts){ districts = d.districts; renderDistricts(); }
        if (d.training_type_list){
          const sel = document.getElementById('ttypeSel');
          if (sel.options.length <= 1){
            for (const t of d.training_type_list){ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); }
          }
        }
        document.getElementById('kpiYouth').textContent = fmt(d.youth_trained);
        document.getElementById('kpiAttend').textContent = fmt(d.attendances);
        document.getElementById('kpiFemale').textContent = fmt(d.female_unique);
        document.getElementById('kpiPwd').textContent = fmt(d.pwd_unique);
        document.getElementById('kpiTypes').textContent = fmt(d.training_types);
        document.getElementById('kpiDistricts').textContent = fmt(d.district_count);
        document.getElementById('kpiVillages').textContent = fmt(d.village_count);
        document.getElementById('kpiMonths').textContent = fmt(d.month_count);
        renderBars(d.by_training_type);
        renderMonth(d.by_month);
        renderDistTable(d.by_district);
      }catch(err){
        document.getElementById('barChart').innerHTML =
          '<div class="text-red-500 text-center py-8">Failed to load: '+err.message+'</div>';
      }
    }

    document.getElementById('fromDate').addEventListener('change', load);
    document.getElementById('toDate').addEventListener('change', load);
    document.getElementById('ttypeSel').addEventListener('change', load);
    document.getElementById('clearDates').addEventListener('click', ()=>{
      document.getElementById('fromDate').value=''; document.getElementById('toDate').value=''; load();
    });

    load();
  </script>
</body>
</html>`;
}
