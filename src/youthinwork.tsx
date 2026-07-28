import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// "Youth in Work" — combined_job_tracking_tool_view.
// Shows, per district: how many youth have been job-tracked, status BEFORE vs
// AFTER, employment status (Self / Wage employed), Value Chain Engaged, and
// total income. Targets: YiW target = 70% of the district reach target (same %
// as the female target); female YiW target = 70% of YiW; PWD YiW target = 3% of
// YiW. Achieved = distinct youth (participant_id) whose latest status_after =
// 'Employed'. Data from /api/youth-in-work.
// ---------------------------------------------------------------------------

export function renderYouthInWork(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Youth in Work</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#28343a; --muted:#7c8a8f;
      --head:#0B3C5D; --row-alt:#f4f8fb; --line:#d9e2e3; --teal:#2f8f9d;
      --amber:#e08a2b; --green:#1a7a3d; --blue:#0e6ba8;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:10px; box-shadow:0 1px 2px rgba(40,60,60,.06); }
    .ttl{ background:#e9f0f6; border-radius:12px; }
    .kpi{ position:relative; overflow:hidden; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:4px; background:var(--head); }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--head); color:#fff; font-weight:700; font-size:11px; padding:7px 9px; text-align:left; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:5px 9px; font-size:11.5px; vertical-align:top; border-bottom:1px solid #eef2f5; }
    tbody td.num{ text-align:right; }
    tbody tr:nth-child(even) td{ background:var(--row-alt); }
    tbody tr:hover td{ background:#eef6fb; }
    tbody tr.total-row td{ background:var(--head) !important; color:#fff; font-weight:700; border-bottom:none; }
    .dist-item{ display:flex; align-items:center; gap:6px; padding:2px; cursor:pointer; font-size:12px; }
    .dist-item:hover{ background:var(--cream); border-radius:5px; }
    .dist-item input{ accent-color:var(--head); width:13px; height:13px; }
    .scrollbar-thin::-webkit-scrollbar{ width:7px; height:7px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#c7d4d5; border-radius:3px; }
    .slbl{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; }
    .mini-btn{ font-size:9px; padding:2px 4px; border-radius:4px; border:1px solid var(--line); background:#fff; }
    .mini-btn:hover{ background:var(--cream); }
    .bar{ height:9px; border-radius:5px; background:#e6edf2; overflow:hidden; }
    .bar > span{ display:block; height:100%; }
    .pill{ font-size:9px; padding:1px 6px; border-radius:999px; font-weight:700; }
    .secttl{ font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.03em; color:var(--head); }
  </style>
</head>
<body>
${navSidebar('youthinwork')}
  <div class="max-w-[1600px] mx-auto p-3 md:p-4">

    <!-- Title + toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to Home"><i class="fas fa-arrow-left"></i></a>
      <div class="ttl px-5 py-1.5 flex-1 text-center">
        <h1 class="text-lg md:text-2xl font-extrabold tracking-tight"><i class="fas fa-briefcase mr-2 text-[var(--head)]"></i>YOUTH IN WORK</h1>
        <div class="text-[11px] text-[var(--muted)]">Job tracking — status before vs after, employment status, value chain &amp; income</div>
      </div>
      <div class="flex items-center gap-1.5 card px-3 py-1.5">
        <span class="text-[10px] text-[var(--muted)] uppercase font-bold mr-1">Submission date</span>
        <input id="fromDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px]" />
        <span class="text-[var(--muted)] text-xs">→</span>
        <input id="toDate" type="date" class="bg-white border border-[var(--line)] rounded px-1.5 py-1 text-[12px]" />
        <button data-preset="clear" class="preset text-[10px] px-2 py-1 rounded border border-[var(--line)] bg-white hover:bg-[var(--cream)] ml-1">All time</button>
      </div>
      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--cream)] text-[var(--muted)]" title="Rebuild the job-tracking fact table from the latest MIS sync">
        <i class="fas fa-rotate mr-1"></i> Refresh
      </button>
    </div>

    <!-- KPI strip -->
    <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
      <div class="card kpi px-3 py-2"><div class="slbl">Youth job-tracked</div><div id="kYouth" class="text-xl font-extrabold mt-0.5">–</div></div>
      <div class="card kpi px-3 py-2"><div class="slbl">Employed (Youth in Work)</div><div id="kEmp" class="text-xl font-extrabold mt-0.5 text-[var(--green)]">–</div></div>
      <div class="card kpi px-3 py-2"><div class="slbl">YiW Target (70% reach)</div><div id="kTgt" class="text-xl font-extrabold mt-0.5">–</div></div>
      <div class="card kpi px-3 py-2"><div class="slbl">Self employed</div><div id="kSelf" class="text-xl font-extrabold mt-0.5">–</div></div>
      <div class="card kpi px-3 py-2"><div class="slbl">Wage employed</div><div id="kWage" class="text-xl font-extrabold mt-0.5">–</div></div>
      <div class="card kpi px-3 py-2"><div class="slbl">Total income (UGX)</div><div id="kInc" class="text-lg font-extrabold mt-0.5">–</div></div>
    </div>

    <div class="grid grid-cols-12 gap-3">
      <!-- Main column -->
      <section class="col-span-12 lg:col-span-9 space-y-3">

        <!-- Target vs achieved by district -->
        <div class="card p-3">
          <div class="secttl mb-2">Target vs achieved by district <span class="text-[10px] font-normal text-[var(--muted)] normal-case">— YiW target = 70% of reach target; female = 70% of YiW; PWD = 3% of YiW. Achieved = distinct youth with status "Employed".</span></div>
          <div class="scrollbar-thin overflow-auto">
            <table id="tblDist">
              <thead>
                <tr>
                  <th>District</th>
                  <th class="num">Reach target</th>
                  <th class="num">YiW target</th>
                  <th class="num">Female target</th>
                  <th class="num">PWD target</th>
                  <th class="num">Youth tracked</th>
                  <th class="num">Employed (YiW)</th>
                  <th class="num">Total income</th>
                  <th style="min-width:150px">% of YiW target</th>
                </tr>
              </thead>
              <tbody id="distBody"><tr><td colspan="9" class="text-center text-[var(--muted)] py-8">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <!-- Status before vs after -->
          <div class="card p-3">
            <div class="secttl mb-2">Status before → after</div>
            <div style="height:220px"><canvas id="chStatus"></canvas></div>
            <table class="mt-2"><thead><tr><th>Before</th><th>After</th><th class="num">Youth</th></tr></thead>
              <tbody id="flowBody"><tr><td colspan="3" class="text-center text-[var(--muted)] py-4">…</td></tr></tbody></table>
          </div>
          <!-- Value chain -->
          <div class="card p-3">
            <div class="secttl mb-2">Value Chain Engaged</div>
            <div style="height:220px"><canvas id="chChain"></canvas></div>
            <table class="mt-2"><thead><tr><th>Value chain</th><th class="num">Youth</th><th class="num">Income</th></tr></thead>
              <tbody id="chainBody"><tr><td colspan="3" class="text-center text-[var(--muted)] py-4">…</td></tr></tbody></table>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <!-- Employment status -->
          <div class="card p-3">
            <div class="secttl mb-2">Employment status</div>
            <table><thead><tr><th>Status</th><th class="num">Youth</th></tr></thead>
              <tbody id="empBody"><tr><td colspan="2" class="text-center text-[var(--muted)] py-4">…</td></tr></tbody></table>
          </div>
          <!-- Employment change -->
          <div class="card p-3">
            <div class="secttl mb-2">Nature of employment (change)</div>
            <table><thead><tr><th>Category</th><th class="num">Youth</th></tr></thead>
              <tbody id="chgBody"><tr><td colspan="2" class="text-center text-[var(--muted)] py-4">…</td></tr></tbody></table>
          </div>
        </div>
      </section>

      <!-- Right: district slicer -->
      <aside class="col-span-12 lg:col-span-3 space-y-2">
        <div class="card p-2" id="sl-dist"></div>
      </aside>
    </div>
  </div>

  <script>
    const fmt = (n) => (Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0});
    const money = (n) => 'UGX ' + fmt(n);
    const compact = (n)=>{ n=Number(n)||0; if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(2)+'M'; if(n>=1e3) return (n/1e3).toFixed(1)+'k'; return fmt(n); };
    function pctColor(p){ if(p==null) return '#9aa'; if(p>=80) return '#1a7a3d'; if(p>=60) return '#b46e0a'; if(p>=40) return '#c9791b'; return '#c0392b'; }

    const dist = { opts:[], sel:new Set(), all:true };
    let charts = {};

    function buildDistShell(){
      document.getElementById('sl-dist').innerHTML =
        '<div class="slbl mb-1">District</div>'
        + '<input id="distSearch" type="text" placeholder="Search…" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[10px] mb-1" />'
        + '<div class="flex gap-1 mb-1"><button class="mini-btn flex-1 font-semibold" id="distAll">All</button><button class="mini-btn flex-1 font-semibold" id="distNone">None</button></div>'
        + '<div id="distList" class="scrollbar-thin overflow-y-auto max-h-[360px] pr-1"></div>';
      document.getElementById('distSearch').addEventListener('input', renderDist);
      document.getElementById('distAll').addEventListener('click', ()=>{ dist.all=true; dist.sel=new Set(); renderDist(); load(); });
      document.getElementById('distNone').addEventListener('click', ()=>{ dist.all=false; dist.sel=new Set(); renderDist(); load(); });
    }
    function renderDist(){
      const box=document.getElementById('distList'); if(!box) return;
      const q=(document.getElementById('distSearch').value||'').toLowerCase();
      let html='';
      for(const o of dist.opts){
        if(q && !o.toLowerCase().includes(q)) continue;
        const on = dist.all || dist.sel.has(o);
        html += '<label class="dist-item"><input type="checkbox" data-o="'+o.replace(/"/g,'&quot;')+'" '+(on?'checked':'')+'/><span>'+o+'</span></label>';
      }
      box.innerHTML = html || '<div class="text-[var(--muted)] text-[10px] py-1">No match.</div>';
      box.querySelectorAll('input[data-o]').forEach(cb=>cb.addEventListener('change', ()=>{
        const o=cb.getAttribute('data-o');
        if(dist.all){ dist.sel=new Set(dist.opts); dist.all=false; }
        if(cb.checked) dist.sel.add(o); else dist.sel.delete(o);
        if(dist.sel.size===dist.opts.length) dist.all=true;
        renderDist(); load();
      }));
    }

    function filterParams(){
      const p=new URLSearchParams();
      if(!dist.all && dist.sel.size) p.set('districts',[...dist.sel].join(','));
      const f=document.getElementById('fromDate').value, t=document.getElementById('toDate').value;
      if(f) p.set('from',f); if(t) p.set('to',t);
      return p;
    }

    function renderDistTable(rows){
      const b=document.getElementById('distBody');
      if(!rows.length){ b.innerHTML='<tr><td colspan="9" class="text-center text-[var(--muted)] py-8">No data.</td></tr>'; return; }
      let tR=0,tY=0,tYt=0,tF=0,tP=0,tE=0,tI=0;
      let html='';
      for(const r of rows){
        tR+=r.reachTarget; tY+=r.yiwTarget; tF+=r.femaleTarget; tP+=r.pwdTarget; tYt+=r.youthTracked; tE+=r.employedYouth; tI+=r.totalIncome;
        const p=r.pct;
        html += '<tr><td class="font-semibold">'+r.district+'</td>'
          +'<td class="num">'+fmt(r.reachTarget)+'</td>'
          +'<td class="num font-semibold">'+fmt(r.yiwTarget)+'</td>'
          +'<td class="num">'+fmt(r.femaleTarget)+'</td>'
          +'<td class="num">'+fmt(r.pwdTarget)+'</td>'
          +'<td class="num">'+fmt(r.youthTracked)+'</td>'
          +'<td class="num font-semibold text-[var(--green)]">'+fmt(r.employedYouth)+'</td>'
          +'<td class="num">'+money(r.totalIncome)+'</td>'
          +'<td><div class="flex items-center gap-2"><div class="bar flex-1"><span style="width:'+Math.min(100,p||0)+'%;background:'+pctColor(p)+'"></span></div><span class="pill" style="color:'+pctColor(p)+'">'+(p==null?'—':p.toFixed(1)+'%')+'</span></div></td></tr>';
      }
      const tp = tY>0 ? Math.round(tE/tY*1000)/10 : null;
      html += '<tr class="total-row"><td>Total</td><td class="num">'+fmt(tR)+'</td><td class="num">'+fmt(tY)+'</td><td class="num">'+fmt(tF)+'</td><td class="num">'+fmt(tP)+'</td><td class="num">'+fmt(tYt)+'</td><td class="num">'+fmt(tE)+'</td><td class="num">'+money(tI)+'</td><td>'+(tp==null?'—':tp.toFixed(1)+'%')+'</td></tr>';
      document.getElementById('distBody').innerHTML=html;
    }

    function simpleTable(id, rows, cols){
      const b=document.getElementById(id);
      if(!rows.length){ b.innerHTML='<tr><td colspan="'+cols.length+'" class="text-center text-[var(--muted)] py-4">No data.</td></tr>'; return; }
      b.innerHTML = rows.map(r=>'<tr>'+cols.map(c=>'<td class="'+(c.num?'num':'')+'">'+(c.money?money(r[c.k]):(c.num?fmt(r[c.k]):(r[c.k]==null?'':r[c.k])))+'</td>').join('')+'</tr>').join('');
    }

    function drawChart(id, type, labels, data, colors){
      if(charts[id]) charts[id].destroy();
      const ctx=document.getElementById(id); if(!ctx) return;
      charts[id]=new Chart(ctx,{ type, data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:0 }] },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:type!=='bar', position:'bottom', labels:{ font:{size:10} } } },
          scales: type==='bar' ? { x:{ ticks:{font:{size:9}} }, y:{ beginAtZero:true, ticks:{font:{size:9}} } } : {} } });
    }

    async function load(){
      const p=filterParams();
      document.getElementById('distBody').innerHTML='<tr><td colspan="9" class="text-center text-[var(--muted)] py-8"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
      try{
        const res=await fetch('/api/youth-in-work?'+p.toString());
        if(!res.ok) throw new Error('HTTP '+res.status);
        const d=await res.json();
        // KPIs
        document.getElementById('kYouth').textContent=fmt(d.kpi.youthTracked);
        document.getElementById('kEmp').textContent=fmt(d.kpi.employedYouth);
        const tgt=(d.byDistrict||[]).reduce((s,r)=>s+(r.yiwTarget||0),0);
        document.getElementById('kTgt').textContent=fmt(tgt);
        document.getElementById('kSelf').textContent=fmt(d.kpi.selfEmployed);
        document.getElementById('kWage').textContent=fmt(d.kpi.wageEmployed);
        document.getElementById('kInc').textContent=compact(d.kpi.totalIncome);
        // District table
        renderDistTable(d.byDistrict||[]);
        // slicer opts
        if(d.districts && d.districts.length && dist.opts.length===0){ dist.opts=d.districts; renderDist(); }
        // Status flow
        simpleTable('flowBody', (d.statusFlow||[]).map(r=>({b:r.before,a:r.after,y:r.youth})), [{k:'b'},{k:'a'},{k:'y',num:true}]);
        const flow=d.statusFlow||[];
        drawChart('chStatus','bar', flow.map(r=>r.before+'→'+r.after), flow.map(r=>r.youth), flow.map((_,i)=>['#0e6ba8','#1a7a3d','#e08a2b','#c0392b','#7c8a8f','#2f8f9d'][i%6]));
        // Value chain
        simpleTable('chainBody', (d.valueChain||[]).map(r=>({v:r.label,y:r.youth,i:r.totalIncome})), [{k:'v'},{k:'y',num:true},{k:'i',num:true,money:true}]);
        const vc=d.valueChain||[];
        drawChart('chChain','doughnut', vc.map(r=>r.label), vc.map(r=>r.youth), ['#0B3C5D','#2f8f9d','#e08a2b','#1a7a3d','#c0392b','#7c8a8f','#9b59b6']);
        // Employment status + change
        simpleTable('empBody', (d.employmentStatus||[]).map(r=>({s:r.label,y:r.youth})), [{k:'s'},{k:'y',num:true}]);
        simpleTable('chgBody', (d.employedChange||[]).map(r=>({c:r.label,y:r.youth})), [{k:'c'},{k:'y',num:true}]);
      }catch(err){
        document.getElementById('distBody').innerHTML='<tr><td colspan="9" class="text-center text-red-500 py-8">Failed to load: '+err.message+'</td></tr>';
      }
    }

    buildDistShell();
    document.getElementById('fromDate').addEventListener('change', load);
    document.getElementById('toDate').addEventListener('change', load);
    document.querySelectorAll('.preset').forEach(b=>b.addEventListener('click', ()=>{ document.getElementById('fromDate').value=''; document.getElementById('toDate').value=''; load(); }));
    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn=e.currentTarget, old=btn.innerHTML; btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/youth-in-work/refresh',{method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });
    load();
  </script>
</body>
</html>`;
}
