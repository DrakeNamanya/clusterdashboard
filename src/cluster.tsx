import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// "Cluster Trainings" — Power BI-style dashboard for all_trainees_view.
// Cream theme, green horizontal bar chart, district checkbox filter, date range.
// Data comes from GET /api/cluster-trainings (Supabase RPC over cluster_summary).
// ---------------------------------------------------------------------------

export function renderClusterTrainings(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cluster Trainings</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#3d3128; --muted:#8a7c6d;
      --green:#12d100; --green-soft:#e9f9e6; --line:#efe7de;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:12px;
           box-shadow:0 1px 2px rgba(80,60,40,.05); }
    .kpi-num{ font-weight:800; letter-spacing:-.02em; line-height:1; color:#2c241d; }
    .kpi-label{ color:var(--muted); font-weight:600; }
    .bar-track{ background:transparent; }
    .bar-fill{ background:var(--green); height:16px; border-radius:2px; transition:width .5s ease; }
    .dist-item{ display:flex; align-items:center; gap:8px; padding:3px 2px; cursor:pointer; font-size:13px; }
    .dist-item:hover{ background:var(--cream); border-radius:6px; }
    .dist-item input{ accent-color:#2c241d; width:14px; height:14px; }
    input[type=range]{ accent-color:#3d3128; }
    .scrollbar-thin::-webkit-scrollbar{ width:6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#d9cdbf; border-radius:3px; }
  </style>
</head>
<body>
${navSidebar('cluster')}
  <div class="max-w-[1200px] mx-auto p-4 md:p-6">

    <!-- Title bar -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to Home"><i class="fas fa-arrow-left"></i></a>
        <h1 class="text-xl md:text-2xl font-extrabold tracking-tight">Cluster Trainings</h1>
      </div>
      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--cream)] text-[var(--muted)]">
        <i class="fas fa-rotate mr-1"></i> Refresh data
      </button>
    </div>

    <div class="grid grid-cols-12 gap-4">

      <!-- Left: district filter -->
      <aside class="col-span-12 md:col-span-2">
        <div class="card p-3 h-full">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-2">District</div>
          <div id="districtList" class="scrollbar-thin overflow-y-auto max-h-[520px] pr-1 text-sm">
            <div class="text-[var(--muted)] text-xs">Loading…</div>
          </div>
        </div>
      </aside>

      <!-- Right: dashboard -->
      <section class="col-span-12 md:col-span-10 space-y-4">

        <!-- Top row: date slicer + two KPI cards -->
        <div class="grid grid-cols-12 gap-4">
          <div class="card p-4 col-span-12 md:col-span-6">
            <div class="flex items-center justify-between text-sm mb-2">
              <input id="fromDate" type="date" class="bg-transparent border border-[var(--line)] rounded px-2 py-1 text-xs" />
              <span class="text-[var(--muted)]"><i class="far fa-calendar"></i></span>
              <input id="toDate" type="date" class="bg-transparent border border-[var(--line)] rounded px-2 py-1 text-xs" />
            </div>
            <input id="dateRange" type="range" min="0" max="100" value="100" class="w-full" />
            <div class="text-[11px] text-[var(--muted)] mt-1">Drag to set the upper date bound, or pick dates.</div>
          </div>
          <div class="card p-4 col-span-6 md:col-span-3 text-center flex flex-col justify-center">
            <div id="kpiTotal" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">Youth_TrainedY</div>
          </div>
          <div class="card p-4 col-span-6 md:col-span-3 text-center flex flex-col justify-center">
            <div id="kpiTypes" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">Total_Trainings_types</div>
          </div>
        </div>

        <!-- Middle row: four KPI cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="card p-4 text-center">
            <div id="kpiGroups" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">Groups_Reached</div>
          </div>
          <div class="card p-4 text-center">
            <div id="kpiFemale" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">Female_Reached</div>
          </div>
          <div class="card p-4 text-center">
            <div id="kpiPwd" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">PWDs_Trained</div>
          </div>
          <div class="card p-4 text-center">
            <div id="kpiFemalePwd" class="kpi-num text-3xl md:text-4xl">–</div>
            <div class="kpi-label text-sm mt-1">Female_PWDs</div>
          </div>
        </div>

        <!-- Bar chart -->
        <div class="card p-5">
          <h2 class="text-center font-bold text-[15px] mb-4">Participant_by training_type</h2>
          <div id="barChart" class="space-y-1.5 text-[13px]">
            <div class="text-[var(--muted)] text-center py-8">Loading…</div>
          </div>
        </div>

      </section>
    </div>
  </div>

  <script>
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    let districts = [];       // all district names
    let selected = new Set(); // selected districts (empty => all)

    function selectedParam(){
      return selected.size ? [...selected].join(',') : '';
    }

    function renderDistricts(){
      const box = document.getElementById('districtList');
      const all = selected.size === 0;
      let html = '<label class="dist-item font-semibold">'
        + '<input type="checkbox" id="selAll" ' + (all ? 'checked' : '') + '/>'
        + '<span>Select all</span></label>';
      for (const d of districts){
        const on = all || selected.has(d);
        html += '<label class="dist-item"><input type="checkbox" data-d="'+d+'" '
             + (on ? 'checked' : '') + '/><span>'+d+'</span></label>';
      }
      box.innerHTML = html;
      document.getElementById('selAll').addEventListener('change', (e)=>{
        selected.clear();               // empty set = all
        renderDistricts(); load();
      });
      box.querySelectorAll('input[data-d]').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          const d = cb.getAttribute('data-d');
          // If currently "all" and user unticks one, start from full set.
          if (selected.size === 0){ districts.forEach(x=>selected.add(x)); }
          if (cb.checked) selected.add(d); else selected.delete(d);
          if (selected.size === districts.length) selected.clear(); // all again
          renderDistricts(); load();
        });
      });
    }

    function renderBars(bars){
      const box = document.getElementById('barChart');
      if (!bars || !bars.length){ box.innerHTML='<div class="text-[var(--muted)] text-center py-8">No data for this selection.</div>'; return; }
      const max = Math.max(...bars.map(b=>b.value), 1);
      box.innerHTML = bars.map(b=>{
        const pct = Math.max((b.value/max)*100, b.value>0?1.5:0);
        return '<div class="grid grid-cols-[210px_1fr] items-center gap-3">'
          + '<div class="truncate text-right text-[var(--ink)]" title="'+b.label+'">'+b.label+'</div>'
          + '<div class="flex items-center gap-2">'
          +   '<div class="bar-fill" style="width:'+pct+'%"></div>'
          +   '<span class="text-[12px] text-[var(--muted)] whitespace-nowrap">'+fmt(b.value)+'</span>'
          + '</div></div>';
      }).join('');
    }

    async function load(){
      const params = new URLSearchParams();
      const dp = selectedParam(); if (dp) params.set('districts', dp);
      const f = document.getElementById('fromDate').value; if (f) params.set('from', f);
      const t = document.getElementById('toDate').value;   if (t) params.set('to', t);
      try{
        const res = await fetch('/api/cluster-trainings?' + params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        if (!districts.length && d.districts){ districts = d.districts; renderDistricts(); }
        document.getElementById('kpiTotal').textContent = fmt(d.total_trained);
        document.getElementById('kpiTypes').textContent = fmt(d.training_types);
        document.getElementById('kpiGroups').textContent = fmt(d.groups_reached);
        document.getElementById('kpiFemale').textContent = fmt(d.female_reached);
        document.getElementById('kpiPwd').textContent = fmt(d.pwds_trained);
        document.getElementById('kpiFemalePwd').textContent = fmt(d.female_pwds);
        renderBars(d.by_training_type);
      }catch(err){
        document.getElementById('barChart').innerHTML =
          '<div class="text-red-500 text-center py-8">Failed to load: '+err.message+'</div>';
      }
    }

    // Default the date range to June 2026 (matches the reference dashboard view
    // and keeps queries fast). Users can widen it as needed.
    document.getElementById('fromDate').value = '2026-06-01';
    document.getElementById('toDate').value = '2026-06-30';

    // Date inputs
    document.getElementById('fromDate').addEventListener('change', load);
    document.getElementById('toDate').addEventListener('change', load);

    // Refresh button rebuilds the Supabase summary then reloads.
    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/cluster-trainings/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    load();
  </script>
</body>
</html>`;
}
