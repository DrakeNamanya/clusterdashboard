import { clusterOptions } from './clusters';
// ---------------------------------------------------------------------------
// REPORT DASHBOARD — Targets vs Achieved
//   Filters: Cluster + Date range.
//   Sections:
//     1. KPI strip: Reach / Mobilization / Production (target vs achieved + %).
//     2. Production Targets vs Achieved (per district) + Y3 season breakdown.
//     3. Reach Targets vs Achieved (per district, with Balance + %).
//     4. Mobilization Targets vs Achieved (per district).
//   Data from /api/report (mel_report_dash RPC). Achieved is live; targets come
//   from mel_reach_targets / mel_production_targets (Iganga cluster for now).
// ---------------------------------------------------------------------------

export function renderReport(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Report Dashboard — Targets vs Achieved</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root{
      --green:#006837; --green-2:#00A859; --lgreen:#e9f5ee; --ink:#25352c;
      --muted:#7f8c85; --line:#e2e9e4; --amber:#F6921E; --blue:#2E9BD6;
      --band:#0f5132; --cream:#fbf6e3;
    }
    body{ background:#f2f6f3; color:var(--ink); font-family:"Segoe UI",Calibri,Arial,system-ui,sans-serif; margin:0; }
    .wrap{ max-width:1180px; margin:0 auto; padding:22px 20px 60px; }
    h1{ font-size:24px; font-weight:800; color:var(--green); margin:0 0 2px; }
    .sub{ color:var(--muted); font-size:13px; margin-bottom:16px; }
    .card{ background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 1px 3px rgba(40,60,50,.05); }
    .bar{ height:4px; border-radius:14px 14px 0 0; }

    .filters{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:18px; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:700; }
    .fld select, .fld input{ border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; background:#fff; min-width:150px; }
    .btn{ background:var(--green); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; }
    .btn:hover{ background:var(--green-2); }
    .btn.ghost{ background:#fff; color:var(--green); border:1px solid var(--line); }

    .kstrip{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:18px; }
    @media(max-width:760px){ .kstrip{ grid-template-columns:1fr; } }
    .kcard{ padding:16px 18px; position:relative; overflow:hidden; }
    .kcard .kt{ font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
    .kcard .krow{ display:flex; align-items:baseline; gap:8px; margin-top:8px; }
    .kcard .kach{ font-size:30px; font-weight:800; color:var(--ink); line-height:1; }
    .kcard .ktgt{ font-size:14px; color:var(--muted); font-weight:600; }
    .kcard .kpct{ font-size:13px; font-weight:800; margin-top:10px; }
    .kbar{ height:9px; border-radius:6px; background:#eef2ef; margin-top:8px; overflow:hidden; }
    .kbar > span{ display:block; height:100%; border-radius:6px; width:0; transition:width .5s; }

    section h2{ font-size:16px; font-weight:800; color:var(--green); margin:0 0 3px; display:flex; align-items:center; gap:8px; }
    section .desc{ font-size:12px; color:var(--muted); margin:0 0 10px; }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--band); color:#fff; font-weight:700; font-size:12px; padding:11px 14px; text-align:left; }
    thead th.num{ text-align:right; }
    tbody td{ padding:10px 14px; font-size:13px; border-bottom:1px solid #eef2ef; }
    tbody td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    tbody tr:nth-child(even) td{ background:#f7faf8; }
    tr.total td{ background:var(--cream)!important; font-weight:800; border-top:2px solid #e5d9a8; }
    .pill{ display:inline-block; min-width:52px; text-align:center; padding:2px 8px; border-radius:20px; font-size:11.5px; font-weight:800; }
    .achbar{ display:inline-block; height:8px; border-radius:5px; background:linear-gradient(90deg,var(--green-2),var(--green)); vertical-align:middle; }
    .achwrap{ display:inline-block; width:90px; height:8px; background:#eef2ef; border-radius:5px; overflow:hidden; vertical-align:middle; margin-right:6px; }
    .muted{ color:var(--muted); }
    .season-grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px; }
    @media(max-width:760px){ .season-grid{ grid-template-columns:1fr; } }
    .loading{ text-align:center; color:var(--muted); padding:26px; font-size:13px; }
    .note{ background:#fff8e6; border:1px solid #f0e2b6; color:#7a6414; font-size:12px; padding:8px 12px; border-radius:8px; margin-bottom:16px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1><i class="fas fa-bullseye" style="margin-right:8px"></i>Report Dashboard — Targets vs Achieved</h1>
    <p class="sub">Production, Reach and Mobilization performance against Year-3 targets. Filter by cluster and date.</p>

    <div class="filters">
      <div class="fld"><label>Cluster</label>
        <select id="cluster">${clusterOptions('iganga')}</select></div>
      <div class="fld"><label>Date from</label><input type="date" id="from" /></div>
      <div class="fld"><label>Date to</label><input type="date" id="to" /></div>
      <button class="btn" id="apply"><i class="fas fa-filter"></i> Apply</button>
      <button class="btn ghost" id="reset">Reset</button>
      <div id="stamp" style="margin-left:auto;font-size:11px;color:var(--muted)"></div>
    </div>

    <div id="noteBox"></div>

    <div class="kstrip">
      <div class="card kcard"><div class="bar" style="background:var(--green-2)"></div>
        <div class="kt"><i class="fas fa-seedling"></i> Production</div>
        <div class="krow"><span class="kach" id="prodAch">—</span><span class="ktgt">/ <span id="prodTgt">—</span></span></div>
        <div class="kbar"><span id="prodBar" style="background:var(--green-2)"></span></div>
        <div class="kpct" id="prodPct" style="color:var(--green)">—</div>
      </div>
      <div class="card kcard"><div class="bar" style="background:var(--blue)"></div>
        <div class="kt"><i class="fas fa-users"></i> Reach (New Youth)</div>
        <div class="krow"><span class="kach" id="reachAch">—</span><span class="ktgt">/ <span id="reachTgt">—</span></span></div>
        <div class="kbar"><span id="reachBar" style="background:var(--blue)"></span></div>
        <div class="kpct" id="reachPct" style="color:var(--blue)">—</div>
      </div>
      <div class="card kcard"><div class="bar" style="background:var(--amber)"></div>
        <div class="kt"><i class="fas fa-people-group"></i> Mobilization</div>
        <div class="krow"><span class="kach" id="mobAch">—</span><span class="ktgt">/ <span id="mobTgt">—</span></span></div>
        <div class="kbar"><span id="mobBar" style="background:var(--amber)"></span></div>
        <div class="kpct" id="mobPct" style="color:#b46e0a">—</div>
      </div>
    </div>

    <section class="card" style="padding:18px; margin-bottom:18px">
      <h2><i class="fas fa-seedling"></i> Production: Targets vs Achieved</h2>
      <p class="desc">Achieved = Youth in Production (Horticulture + Oil seeds) + Livestock Distribution (unit = Number), distinct youth. Target = Year-3 production target.</p>
      <div style="overflow-x:auto">
        <table><thead><tr>
          <th>District</th><th class="num">Y3 Target</th><th class="num">Achieved</th>
          <th class="num">Youth in Prod.</th><th class="num">Livestock Dist.</th>
          <th class="num">% Achieved</th><th style="width:120px">Progress</th>
        </tr></thead><tbody id="prodBody"><tr><td colspan="7" class="loading">Loading…</td></tr></tbody></table>
      </div>
      <div class="season-grid" id="seasonGrid"></div>
    </section>

    <section class="card" style="padding:18px; margin-bottom:18px">
      <h2><i class="fas fa-users"></i> Reach: Targets vs Achieved</h2>
      <p class="desc">Reach = New Youth Reached (distinct participant at first training date). Balance = Target − Achieved. Reach target is the Year-3 cumulative target.</p>
      <div style="overflow-x:auto">
        <table><thead><tr>
          <th>District</th><th class="num">Target</th><th class="num">Achieved</th>
          <th class="num">Balance</th><th class="num">% Achieved</th><th style="width:120px">Progress</th>
        </tr></thead><tbody id="reachBody"><tr><td colspan="6" class="loading">Loading…</td></tr></tbody></table>
      </div>
    </section>

    <section class="card" style="padding:18px; margin-bottom:18px">
      <h2><i class="fas fa-people-group"></i> Mobilization: Targets vs Achieved</h2>
      <p class="desc">Mobilization Achieved = SHG Profiling &amp; Group Statistics (sum of participants). Target = Monthly SHGs × 25 participants × months.</p>
      <div style="overflow-x:auto">
        <table><thead><tr>
          <th>District</th><th class="num">Target</th><th class="num">Achieved</th>
          <th class="num">% Achieved</th><th style="width:120px">Progress</th>
        </tr></thead><tbody id="mobBody"><tr><td colspan="5" class="loading">Loading…</td></tr></tbody></table>
      </div>
    </section>
  </div>

<script>
const CLUSTER_DISTRICTS = {
  iganga:['IGANGA','JINJA','JINJA CITY','MAYUGE','LUUKA'],
  kamuli:['KAMULI','KALIRO','BUYENDE'],
  bugiri:['BUGIRI','NAMUTUMBA','NAMAYINGO','BUGWERI'],
  central:['MUKONO','BUIKWE','KAYUNGA']
};
const fmt = n => (n==null||isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString();
function pctColor(p){ if(p==null) return '#9aa'; if(p>=80) return '#1a7a3d'; if(p>=60) return '#b46e0a'; if(p>=40) return '#c9791b'; return '#c0392b'; }
function pctBg(p){ if(p==null) return '#eee'; if(p>=80) return '#e5f4ea'; if(p>=60) return '#fdf1dd'; if(p>=40) return '#fdf1dd'; return '#fbe4e0'; }
function progressCell(p){
  const w = p==null ? 0 : Math.max(0, Math.min(100, Number(p)));
  return '<span class="achwrap"><span class="achbar" style="width:'+w+'%"></span></span>';
}
function pctPill(p){
  if(p==null) return '<span class="muted">—</span>';
  return '<span class="pill" style="color:'+pctColor(p)+';background:'+pctBg(p)+'">'+Number(p).toFixed(1)+'%</span>';
}

function renderReach(rows){
  const b=document.getElementById('reachBody');
  if(!rows||!rows.length){ b.innerHTML='<tr><td colspan="6" class="loading">No data for this selection.</td></tr>'; return; }
  let tT=0,tA=0,tB=0;
  let html = rows.map(r=>{
    tT+=Number(r.target)||0; tA+=Number(r.achieved)||0; tB+=Number(r.balance)||0;
    return '<tr><td>'+r.district+'</td><td class="num">'+fmt(r.target)+'</td><td class="num">'+fmt(r.achieved)+
      '</td><td class="num">'+fmt(r.balance)+'</td><td class="num">'+pctPill(r.pct)+'</td><td>'+progressCell(r.pct)+'</td></tr>';
  }).join('');
  const tp = tT>0 ? (100*tA/tT) : null;
  html += '<tr class="total"><td>Total</td><td class="num">'+fmt(tT)+'</td><td class="num">'+fmt(tA)+'</td><td class="num">'+fmt(tB)+'</td><td class="num">'+pctPill(tp)+'</td><td>'+progressCell(tp)+'</td></tr>';
  b.innerHTML=html;
}
function renderMob(rows){
  const b=document.getElementById('mobBody');
  if(!rows||!rows.length){ b.innerHTML='<tr><td colspan="5" class="loading">No data for this selection.</td></tr>'; return; }
  let tT=0,tA=0;
  let html = rows.map(r=>{
    tT+=Number(r.target)||0; tA+=Number(r.achieved)||0;
    return '<tr><td>'+r.district+'</td><td class="num">'+fmt(r.target)+'</td><td class="num">'+fmt(r.achieved)+
      '</td><td class="num">'+pctPill(r.pct)+'</td><td>'+progressCell(r.pct)+'</td></tr>';
  }).join('');
  const tp = tT>0 ? (100*tA/tT) : null;
  html += '<tr class="total"><td>Total</td><td class="num">'+fmt(tT)+'</td><td class="num">'+fmt(tA)+'</td><td class="num">'+pctPill(tp)+'</td><td>'+progressCell(tp)+'</td></tr>';
  b.innerHTML=html;
}
function renderProd(rows){
  const b=document.getElementById('prodBody');
  if(!rows||!rows.length){ b.innerHTML='<tr><td colspan="7" class="loading">No data for this selection.</td></tr>'; return; }
  let tT=0,tA=0,tY=0,tL=0;
  let html = rows.map(r=>{
    tT+=Number(r.target)||0; tA+=Number(r.achieved)||0; tY+=Number(r.youth_in_prod)||0; tL+=Number(r.livestock_dist)||0;
    return '<tr><td>'+r.district+'</td><td class="num">'+fmt(r.target)+'</td><td class="num">'+fmt(r.achieved)+
      '</td><td class="num">'+fmt(r.youth_in_prod)+'</td><td class="num">'+fmt(r.livestock_dist)+
      '</td><td class="num">'+pctPill(r.pct)+'</td><td>'+progressCell(r.pct)+'</td></tr>';
  }).join('');
  const tp = tT>0 ? (100*tA/tT) : null;
  html += '<tr class="total"><td>Total</td><td class="num">'+fmt(tT)+'</td><td class="num">'+fmt(tA)+'</td><td class="num">'+fmt(tY)+'</td><td class="num">'+fmt(tL)+'</td><td class="num">'+pctPill(tp)+'</td><td>'+progressCell(tp)+'</td></tr>';
  b.innerHTML=html;
}
function renderSeasons(rows){
  const g=document.getElementById('seasonGrid'); g.innerHTML='';
  if(!rows||!rows.length) return;
  const bySeason={};
  rows.forEach(r=>{ (bySeason[r.season]=bySeason[r.season]||[]).push(r); });
  Object.keys(bySeason).sort().forEach(season=>{
    const rs=bySeason[season];
    let body=rs.map(r=>'<tr><td>'+r.district+'</td><td class="num">'+fmt(r.expected_jobs)+'</td><td class="num">'+fmt(r.poultry)+'</td><td class="num">'+fmt(r.goats)+'</td><td class="num">'+fmt(r.horticulture)+'</td><td class="num">'+fmt(r.dairy)+'</td><td class="num">'+fmt(r.total_achieved)+'</td></tr>').join('');
    const div=document.createElement('div'); div.className='card'; div.style.padding='12px';
    div.innerHTML='<div style="font-weight:800;color:var(--green);font-size:13px;margin-bottom:6px">'+season+' — Expected Jobs by value chain</div>'+
      '<div style="overflow-x:auto"><table><thead><tr><th>District</th><th class="num">Exp. Jobs</th><th class="num">Poultry</th><th class="num">Goats</th><th class="num">Hort.</th><th class="num">Dairy</th><th class="num">Total</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    g.appendChild(div);
  });
}

function setKpi(prefix, ach, tgt){
  document.getElementById(prefix+'Ach').textContent=fmt(ach);
  document.getElementById(prefix+'Tgt').textContent=fmt(tgt);
  const p = tgt>0 ? (100*ach/tgt) : null;
  const bar=document.getElementById(prefix+'Bar');
  bar.style.width=(p==null?0:Math.max(0,Math.min(100,p)))+'%';
  document.getElementById(prefix+'Pct').textContent = p==null ? 'No target set' : (p.toFixed(1)+'% of target');
}

let loading=false;
async function load(){
  if(loading) return; loading=true;
  const cl=document.getElementById('cluster').value;
  const from=document.getElementById('from').value;
  const to=document.getElementById('to').value;
  const districts=CLUSTER_DISTRICTS[cl]||[];
  document.getElementById('stamp').textContent='Loading…';
  const qs=new URLSearchParams();
  if(districts.length) qs.set('districts', districts.join(','));
  if(from) qs.set('from', from);
  if(to) qs.set('to', to);
  try{
    const res=await fetch('/api/report?'+qs.toString());
    const d=await res.json();
    const t=d.totals||{};
    setKpi('prod', t.prod_achieved||0, t.prod_target||0);
    setKpi('reach', t.reach_achieved||0, t.reach_target||0);
    setKpi('mob', t.mob_achieved||0, t.mob_target||0);
    renderProd(d.production||[]);
    renderSeasons(d.production_seasons||[]);
    renderReach(d.reach||[]);
    renderMob(d.mobilization||[]);
    document.getElementById('noteBox').innerHTML = (cl!=='iganga' && cl!=='all')
      ? '<div class="note"><i class="fas fa-circle-info"></i> Targets are currently loaded for the <b>Iganga cluster</b> only. Other clusters show achieved figures with blank targets until their targets are added.</div>'
      : '';
    const db=d.date_bounds||{};
    document.getElementById('stamp').textContent = 'Data through '+(db.max||'—');
  }catch(e){
    document.getElementById('stamp').textContent='Error loading data';
    ['prodBody','reachBody','mobBody'].forEach(id=>document.getElementById(id).innerHTML='<tr><td colspan="7" class="loading">Failed to load.</td></tr>');
  }
  loading=false;
}
document.getElementById('apply').addEventListener('click', load);
document.getElementById('reset').addEventListener('click', ()=>{ document.getElementById('from').value=''; document.getElementById('to').value=''; document.getElementById('cluster').value='iganga'; load(); });
document.getElementById('cluster').addEventListener('change', load);
load();
</script>
</body>
</html>`;
}
