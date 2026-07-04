// ---------------------------------------------------------------------------
// "Monthly New Youth Reached" — Power BI-style dashboard for all_trainees_view.
// "First touch" model: each participant is counted only on their FIRST-EVER
// activity_date. Orange/peach theme, VS comparison block, 10 KPI cards, and a
// green area chart of New_Total_Reach by activity_date.
// Data comes from GET /api/new-youth (Supabase RPC over the new_youth table).
// ---------------------------------------------------------------------------

export function renderMonthlyNewYouth(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Monthly New Youth Reached</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --bg:#FFFFFF; --peach:#e8c9a8; --peach-soft:#fbf1e6; --card:#fdf6ee;
      --ink:#3d3128; --muted:#8a7c6d; --green:#5cd83a; --green-line:#3fb81f;
      --orange:#f0932b; --line:#efe3d4;
    }
    body{ background:var(--bg); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--card); border:1px solid var(--line); border-radius:10px;
           box-shadow:0 1px 2px rgba(80,60,40,.06); }
    .kpi-num{ font-weight:800; letter-spacing:-.02em; line-height:1; color:#2c241d; }
    .kpi-label{ color:var(--muted); font-weight:600; }
    .cards-wrap{ background:var(--peach); border-radius:14px; }
    .dist-item{ display:flex; align-items:center; gap:8px; padding:3px 2px; cursor:pointer; font-size:13px; }
    .dist-item:hover{ background:var(--peach-soft); border-radius:6px; }
    .dist-item input{ accent-color:#2c241d; width:14px; height:14px; }
    input[type=range]{ accent-color:#3d3128; }
    .scrollbar-thin::-webkit-scrollbar{ width:6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#e0cdb6; border-radius:3px; }
    .vs-badge{ color:var(--orange); font-weight:900; font-size:34px; line-height:1; }
    .vs-card{ border-top:3px solid var(--orange); }
  </style>
</head>
<body>
  <div class="max-w-[1200px] mx-auto p-4 md:p-6">

    <!-- Title bar -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to app"><i class="fas fa-arrow-left"></i></a>
      </div>
      <h1 class="text-xl md:text-3xl font-extrabold tracking-tight text-center flex-1">NEW YOUTH REACHED BY MONTH</h1>
      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--peach-soft)] text-[var(--muted)]">
        <i class="fas fa-rotate mr-1"></i> Refresh data
      </button>
    </div>

    <div class="grid grid-cols-12 gap-4">

      <!-- Left: date slicer + district filter -->
      <aside class="col-span-12 md:col-span-2 space-y-4">
        <div class="card p-3">
          <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold mb-2">Period</div>
          <!-- Quick month/period pickers -->
          <div class="flex gap-1 mb-2">
            <select id="monthPick" class="flex-1 bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[11px]"></select>
          </div>
          <div class="grid grid-cols-3 gap-1 mb-2">
            <button data-preset="thismonth" class="preset text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--peach-soft)]">Month</button>
            <button data-preset="quarter" class="preset text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--peach-soft)]">Quarter</button>
            <button data-preset="year" class="preset text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--peach-soft)]">Year</button>
          </div>
          <!-- Explicit from/to (kept in sync with the picker) -->
          <label class="block text-[10px] text-[var(--muted)] mb-0.5">From</label>
          <input id="fromDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[11px] w-full mb-1.5" />
          <label class="block text-[10px] text-[var(--muted)] mb-0.5">To</label>
          <input id="toDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[11px] w-full" />
        </div>
        <div class="card p-3">
          <div class="flex items-center justify-between mb-2">
            <div class="text-[11px] uppercase tracking-wide text-[var(--muted)] font-bold">District</div>
          </div>
          <input id="distSearch" type="text" placeholder="Search…" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[11px] mb-2" />
          <div class="flex gap-1 mb-2">
            <button id="selAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--peach-soft)] font-semibold">Select all</button>
            <button id="clrAllBtn" class="flex-1 text-[10px] px-1 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--peach-soft)] font-semibold">Unselect all</button>
          </div>
          <div id="districtList" class="scrollbar-thin overflow-y-auto max-h-[380px] pr-1 text-sm">
            <div class="text-[var(--muted)] text-xs">Loading…</div>
          </div>
        </div>
      </aside>

      <!-- Right: dashboard -->
      <section class="col-span-12 md:col-span-10 space-y-4">

        <!-- KPI cards inside peach container -->
        <div class="cards-wrap p-3">
          <!-- Row 1: Total + VS + targets + female + pwds -->
          <div class="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3 items-stretch">
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kTotal" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_Total_Reach</div>
            </div>
            <div class="flex items-center justify-center">
              <span class="vs-badge">VS</span>
            </div>
            <div class="card vs-card p-3 flex flex-col justify-center">
              <div class="kpi-label text-[11px]">Monthly_Target</div>
              <div id="kTargetM" class="kpi-num text-3xl mt-1">–</div>
            </div>
            <div class="card vs-card p-3 flex flex-col justify-center">
              <div class="kpi-label text-[11px]">Target_Selected_Period</div>
              <div id="kTargetP" class="kpi-num text-3xl mt-1">–</div>
            </div>
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kFemale" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_Female_Reach</div>
            </div>
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kPwd" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_PWDs_Reach</div>
            </div>
          </div>
          <!-- Row 2: five cards -->
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3 items-stretch">
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kFemalePwd" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_Female_PWDs_Reach</div>
            </div>
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kWork" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_Youth_in_Work</div>
            </div>
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kFemaleWork" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_Female_Youth_in_Work</div>
            </div>
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kPwdWork" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_PWDs_in_Work</div>
            </div>
            <div class="card p-3 text-center flex flex-col justify-center">
              <div id="kFemalePwdWork" class="kpi-num text-3xl">–</div>
              <div class="kpi-label text-xs mt-1">New_Female_PWDs_in_Work</div>
            </div>
          </div>
        </div>

        <!-- Area chart -->
        <div class="card p-5">
          <h2 class="font-bold text-[15px] mb-2">New_Total_Reach by activity_date</h2>
          <svg id="areaChart" viewBox="0 0 900 320" preserveAspectRatio="none" class="w-full" style="height:320px">
            <text x="450" y="160" text-anchor="middle" fill="#8a7c6d" font-size="14">Loading…</text>
          </svg>
        </div>

      </section>
    </div>
  </div>

  <script>
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    let districts = [];         // all district names
    let selected = new Set();   // explicit selected districts
    let allMode = true;         // true => all districts (default), ignores set

    // For the API: allMode => '' (server treats empty as all); otherwise the list.
    function selectedParam(){
      if (allMode) return '';
      return [...selected].join(',');
    }

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
          // Leaving "all mode": seed the set with every district first.
          if (allMode){ selected = new Set(districts); allMode = false; }
          if (cb.checked) selected.add(d); else selected.delete(d);
          // Re-entering "all mode" when everything is ticked again.
          if (selected.size === districts.length){ allMode = true; }
          renderDistricts(); load();
        });
      });
    }

    function selectAll(){ allMode = true; selected = new Set(); renderDistricts(); load(); }
    function unselectAll(){ allMode = false; selected = new Set(); renderDistricts(); load(); }

    // Build the month dropdown for the target period Oct 2025 .. Sep 2026.
    function buildMonthPicker(){
      const sel = document.getElementById('monthPick');
      const months = [];
      let d = new Date(2025,9,1); // Oct 2025
      const end = new Date(2026,8,1); // Sep 2026
      while (d <= end){ months.push(new Date(d)); d.setMonth(d.getMonth()+1); }
      const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let opts = '<option value="">— pick a month —</option>';
      for (const m of months){
        const y=m.getFullYear(), mo=m.getMonth();
        const val = y+'-'+String(mo+1).padStart(2,'0');
        opts += '<option value="'+val+'">'+names[mo]+' '+y+'</option>';
      }
      sel.innerHTML = opts;
      sel.value = '2026-06'; // default June 2026
      sel.addEventListener('change', ()=>{
        if (!sel.value) return;
        const [y,mo] = sel.value.split('-').map(Number);
        const first = y+'-'+String(mo).padStart(2,'0')+'-01';
        const last = new Date(y, mo, 0).getDate();
        setDates(first, y+'-'+String(mo).padStart(2,'0')+'-'+String(last).padStart(2,'0'));
      });
    }

    function setDates(from, to){
      document.getElementById('fromDate').value = from;
      document.getElementById('toDate').value = to;
      load();
    }

    function applyPreset(kind){
      const f = document.getElementById('fromDate').value || '2026-06-01';
      const base = new Date(f + 'T00:00:00');
      const y = base.getFullYear(), mo = base.getMonth();
      if (kind === 'thismonth'){
        const last = new Date(y, mo+1, 0).getDate();
        setDates(f.slice(0,8)+'01', y+'-'+String(mo+1).padStart(2,'0')+'-'+String(last).padStart(2,'0'));
      } else if (kind === 'quarter'){
        const endM = new Date(y, mo+2, 1); // 3-month window
        const last = new Date(endM.getFullYear(), endM.getMonth()+1, 0).getDate();
        setDates(y+'-'+String(mo+1).padStart(2,'0')+'-01',
                 endM.getFullYear()+'-'+String(endM.getMonth()+1).padStart(2,'0')+'-'+String(last).padStart(2,'0'));
      } else if (kind === 'year'){
        // full programme year Oct 2025 -> Sep 2026
        setDates('2025-10-01','2026-09-30');
      }
    }

    function renderArea(series){
      const svg = document.getElementById('areaChart');
      const W = 900, H = 320, padL = 40, padR = 20, padT = 20, padB = 40;
      if (!series || !series.length){
        svg.innerHTML = '<text x="450" y="160" text-anchor="middle" fill="#8a7c6d" font-size="14">No data for this selection.</text>';
        return;
      }
      const n = series.length;
      const maxV = Math.max(...series.map(s=>s.value), 1);
      const plotW = W - padL - padR, plotH = H - padT - padB;
      const x = (i) => padL + (n === 1 ? plotW/2 : (i/(n-1))*plotW);
      const y = (v) => padT + plotH - (v/maxV)*plotH;

      // gridlines / y labels
      let grid = '';
      const ticks = 4;
      for (let t=0; t<=ticks; t++){
        const val = Math.round((maxV/ticks)*t);
        const gy = y(val);
        grid += '<line x1="'+padL+'" y1="'+gy+'" x2="'+(W-padR)+'" y2="'+gy+'" stroke="#efe3d4" stroke-width="1"/>';
        grid += '<text x="'+(padL-6)+'" y="'+(gy+4)+'" text-anchor="end" fill="#b3a595" font-size="11">'+val+'</text>';
      }

      // area + line path
      let line = '';
      series.forEach((s,i)=>{ line += (i===0?'M':'L') + x(i).toFixed(1) + ',' + y(s.value).toFixed(1) + ' '; });
      const area = line + 'L' + x(n-1).toFixed(1) + ',' + (padT+plotH) + ' L' + x(0).toFixed(1) + ',' + (padT+plotH) + ' Z';

      // data labels: show peaks + a few points to mirror the reference
      let labels = '';
      series.forEach((s,i)=>{
        const isPeak = (i>0 && i<n-1 && s.value >= series[i-1].value && s.value >= series[i+1].value) || i===0 || i===n-1;
        if (isPeak && s.value>0){
          const ly = y(s.value) - 6;
          labels += '<text x="'+x(i).toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" fill="#4a3f34" font-size="11" font-weight="600">'+s.value+'</text>';
        }
      });

      // x axis month/day labels (every ~7 days)
      let xlab = '';
      const step = Math.max(1, Math.round(n/4));
      for (let i=0; i<n; i+=step){
        const d = series[i].date; // YYYY-MM-DD
        const dd = d.slice(8,10), mm = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(d.slice(5,7),10)];
        xlab += '<text x="'+x(i).toFixed(1)+'" y="'+(H-14)+'" text-anchor="middle" fill="#b3a595" font-size="11">'+mm+' '+dd+'</text>';
      }

      svg.innerHTML = grid
        + '<path d="'+area+'" fill="#5cd83a" fill-opacity="0.55"/>'
        + '<path d="'+line+'" fill="none" stroke="#3fb81f" stroke-width="2.5"/>'
        + labels + xlab;
    }

    function zeroCards(){
      ['kTotal','kFemale','kPwd','kFemalePwd','kWork','kFemaleWork','kPwdWork','kFemalePwdWork','kTargetM','kTargetP']
        .forEach(id=>document.getElementById(id).textContent = '0');
      renderArea([]);
    }

    async function load(){
      // Explicit "unselect all" (not all-mode, nothing chosen) => show zeros.
      if (!allMode && selected.size === 0){ zeroCards(); return; }
      const params = new URLSearchParams();
      const dp = selectedParam(); if (dp) params.set('districts', dp);
      const f = document.getElementById('fromDate').value; if (f) params.set('from', f);
      const t = document.getElementById('toDate').value;   if (t) params.set('to', t);
      try{
        const res = await fetch('/api/new-youth?' + params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        if (!districts.length && d.districts){ districts = d.districts; renderDistricts(); }
        document.getElementById('kTotal').textContent = fmt(d.new_total_reach);
        document.getElementById('kTargetM').textContent = fmt(d.monthly_target);
        document.getElementById('kTargetP').textContent = fmt(d.target_selected_period);
        document.getElementById('kFemale').textContent = fmt(d.new_female_reach);
        document.getElementById('kPwd').textContent = fmt(d.new_pwds_reach);
        document.getElementById('kFemalePwd').textContent = fmt(d.new_female_pwds_reach);
        document.getElementById('kWork').textContent = fmt(d.new_youth_in_work);
        document.getElementById('kFemaleWork').textContent = fmt(d.new_female_youth_in_work);
        document.getElementById('kPwdWork').textContent = fmt(d.new_pwds_in_work);
        document.getElementById('kFemalePwdWork').textContent = fmt(d.new_female_pwds_in_work);
        renderArea(d.by_date);
      }catch(err){
        document.getElementById('areaChart').innerHTML =
          '<text x="450" y="160" text-anchor="middle" fill="#ef4444" font-size="14">Failed to load: '+err.message+'</text>';
      }
    }

    // Default the date range to June 2026 (matches the reference dashboard view).
    document.getElementById('fromDate').value = '2026-06-01';
    document.getElementById('toDate').value = '2026-06-30';
    buildMonthPicker();

    document.getElementById('fromDate').addEventListener('change', load);
    document.getElementById('toDate').addEventListener('change', load);
    document.getElementById('distSearch').addEventListener('input', renderDistricts);
    document.getElementById('selAllBtn').addEventListener('click', selectAll);
    document.getElementById('clrAllBtn').addEventListener('click', unselectAll);
    document.querySelectorAll('.preset').forEach(b=>
      b.addEventListener('click', ()=>applyPreset(b.getAttribute('data-preset'))));

    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/new-youth/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    load();
  </script>
</body>
</html>`;
}
