import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
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
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    /* Royal Blue Reports design system — primary #003399 */
    :root{
      --primary:#003399; --primary-deep:#012366; --primary-2:#2b52c4;
      --primary-soft:#e7ecfb; --ink:#1c2540; --muted:#6a7392; --line:#d8def0;
      --band:#003399; --band-deep:#012366; --cream:#eef2fd;
      --success:#1a7a3d; --success-soft:#e5f4ea; --warning:#b46e0a; --warning-soft:#fdf1dd;
      --danger:#c0392b; --danger-soft:#fbe4e0;
      --blue:#2b52c4; --amber:#c99012;
    }
    body{ background:#f2f5fc; color:var(--ink); font-family:"Barlow","Segoe UI",system-ui,-apple-system,sans-serif; margin:0; }
    .wrap{ max-width:1180px; margin:0 auto; padding:22px 20px 40px; }

    /* Formal document masthead */
    .masthead{ background:#fff; border:1px solid var(--line); border-top:5px solid var(--primary); border-radius:12px 12px 0 0; padding:20px 26px; display:flex; align-items:center; gap:24px; flex-wrap:wrap; box-shadow:0 1px 3px rgba(0,51,153,.06); }
    .mh-brand{ display:flex; align-items:center; gap:12px; }
    .mh-logo{ width:48px; height:48px; border-radius:12px; background:var(--primary); color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; box-shadow:0 2px 6px rgba(0,51,153,.28); }
    .mh-org-name{ font-size:18px; font-weight:800; color:var(--primary); line-height:1.1; letter-spacing:-.01em; }
    .mh-org-tag{ font-size:10.5px; font-weight:700; letter-spacing:.11em; text-transform:uppercase; color:var(--muted); margin-top:2px; }
    .mh-titleblock{ flex:1; min-width:180px; border-left:1px solid var(--line); padding-left:24px; }
    .mh-doctype{ font-size:10.5px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--primary); }
    .mh-title{ font-size:24px; font-weight:800; color:var(--ink); margin:2px 0 0; letter-spacing:-.01em; }
    .mh-meta{ display:flex; flex-direction:column; gap:2px; font-size:11.5px; min-width:190px; }
    .mh-meta > div{ display:flex; justify-content:space-between; gap:16px; padding:3px 0; border-bottom:1px dotted var(--line); }
    .mh-meta > div:last-child{ border-bottom:0; }
    .mh-meta span{ color:var(--muted); text-transform:uppercase; letter-spacing:.03em; font-size:10px; font-weight:700; }
    .mh-meta b{ color:var(--ink); font-weight:700; }
    @media(max-width:760px){ .mh-titleblock{ border-left:0; padding-left:0; } }

    .sub{ color:var(--muted); font-size:12.5px; line-height:1.6; margin:0 0 18px; background:var(--primary-soft); border:1px solid var(--line); border-top:0; border-radius:0 0 12px 12px; padding:12px 26px; box-shadow:0 1px 3px rgba(0,51,153,.05); }
    .sub b{ color:var(--ink); }

    /* Document footer */
    .docfoot{ display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap; margin-top:8px; padding:16px 22px; background:#fff; border:1px solid var(--line); border-top:3px solid var(--primary); border-radius:12px; font-size:11.5px; color:var(--ink); }
    .docfoot b{ color:var(--primary); }
    .df-src{ color:var(--muted); font-size:11px; margin-top:4px; max-width:640px; line-height:1.55; }
    .df-right{ text-align:right; font-weight:700; color:var(--muted); }
    .card{ background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 1px 3px rgba(0,51,153,.05); }
    .bar{ height:4px; border-radius:14px 14px 0 0; }

    .filters{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:18px; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:700; }
    .fld select, .fld input{ border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; background:#fff; min-width:150px; }
    .btn{ background:var(--primary); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; transition:background .15s; }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); border:1px solid var(--line); }
    .btn.ghost:hover{ background:var(--primary-soft); }

    .kstrip{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:22px; }
    @media(max-width:760px){ .kstrip{ grid-template-columns:1fr; } }
    .kcard{ padding:16px 18px 18px; position:relative; overflow:hidden; border-radius:12px; }
    .kcard .bar{ position:absolute; top:0; left:0; right:0; background:var(--primary); }
    .kcard .kt{ font-size:11.5px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:.04em; display:flex; align-items:center; gap:7px; }
    .kcard .kt i{ color:var(--primary); }
    .kcard .krow{ display:flex; align-items:baseline; gap:8px; margin-top:12px; }
    .kcard .kach{ font-size:34px; font-weight:900; color:var(--ink); line-height:1; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
    .kcard .ktgt{ font-size:13.5px; color:var(--muted); font-weight:600; }
    .kcard .kpct{ font-size:12px; font-weight:700; margin-top:10px; color:var(--primary); }
    .kbar{ height:8px; border-radius:6px; background:var(--cream); margin-top:10px; overflow:hidden; }
    .kbar > span{ display:block; height:100%; border-radius:6px; width:0; background:var(--primary); transition:width .5s; }

    section h2{ font-size:16px; font-weight:800; color:var(--primary); margin:0 0 3px; display:flex; align-items:center; gap:10px; padding-bottom:10px; border-bottom:1px solid var(--line); }
    section h2 .snum{ width:26px; height:26px; border-radius:7px; background:var(--primary); color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; flex:none; }
    section h2 i{ color:var(--primary); }
    section .desc{ font-size:12px; color:var(--muted); margin:10px 0 12px; line-height:1.55; }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--band); color:#fff; font-weight:700; font-size:12px; padding:11px 14px; text-align:left; text-transform:uppercase; letter-spacing:.02em; }
    thead th.num{ text-align:right; }
    tbody td{ padding:10px 14px; font-size:13px; border-bottom:1px solid var(--line); }
    tbody td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    tbody td.sub{ color:var(--muted); font-weight:600; }
    thead th.gcol{ background:var(--band-deep); }
    .kgen{ display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
    .gchip{ font-size:11px; font-weight:700; padding:3px 10px; border-radius:20px; display:inline-flex; align-items:center; gap:5px; }
    .gchip.gf{ background:var(--primary-soft); color:var(--primary-deep); }
    .gchip.gp{ background:var(--cream); color:var(--primary-2); }
    .gchip i{ font-size:10px; }
    tbody tr:nth-child(even) td{ background:#f6f8fe; }
    tr.total td{ background:var(--primary-soft)!important; font-weight:800; border-top:2px solid var(--primary); }
    .pill{ display:inline-block; min-width:52px; text-align:center; padding:3px 10px; border-radius:20px; font-size:11.5px; font-weight:800; }
    .achbar{ display:inline-block; height:8px; border-radius:5px; background:var(--primary); vertical-align:middle; }
    .achwrap{ display:inline-block; width:90px; height:8px; background:var(--cream); border-radius:5px; overflow:hidden; vertical-align:middle; margin-right:6px; }
    .muted{ color:var(--muted); }
    .season-grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px; }
    @media(max-width:760px){ .season-grid{ grid-template-columns:1fr; } }
    .loading{ text-align:center; color:var(--muted); padding:26px; font-size:13px; }
    .note{ background:var(--warning-soft); border:1px solid #f0e2b6; color:#7a6414; font-size:12px; padding:8px 12px; border-radius:8px; margin-bottom:16px; }

    /* PRINT — colored PDF, aligned (neutralise sidebar padding, hide the nav) */
    @media print{
      @page{ size:A4; margin:12mm; }
      html,body{ background:#fff !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .shg-nav,.shg-nav-open,.filters,#noteBox,.no-print{ display:none !important; }
      .wrap{ max-width:100% !important; margin:0 !important; padding:0 4mm !important; }
      table,.card,.season-grid,tr,.masthead,.docfoot{ page-break-inside:avoid; }
      .masthead{ border-radius:0; }
      thead th{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>
${navSidebar('report')}
  <div class="wrap">
    <header class="masthead">
      <div class="mh-brand">
        <div class="mh-logo"><i class="fas fa-seedling"></i></div>
        <div class="mh-org">
          <div class="mh-org-name">SAYE Uganda</div>
          <div class="mh-org-tag">Monitoring, Evaluation &amp; Learning</div>
        </div>
      </div>
      <div class="mh-titleblock">
        <div class="mh-doctype">Performance Report</div>
        <h1 class="mh-title">Targets vs Achieved</h1>
      </div>
      <div class="mh-meta">
        <div><span>Reporting year</span><b>Oct 2025 – Sep 2026</b></div>
        <div><span>Cluster</span><b id="mhCluster">Iganga</b></div>
        <div><span>Generated</span><b id="mhDate">—</b></div>
      </div>
    </header>
    <p class="sub">Production, Reach and Mobilization performance against Year-3 targets. Achieved figures are counted within the selected date range, so they reconcile with the source dashboards (Monthly New Youth, SHG Profiling) filtered to the same period. Reach and Mobilization are further disaggregated by <b>female</b> and <b>persons with disabilities (PWD)</b>.</p>

    <div class="filters">
      <div class="fld"><label>Cluster</label>
        <select id="cluster">${clusterOptions('iganga')}</select></div>
      <div class="fld"><label>Date from</label><input type="date" id="from" value="2025-10-01" /></div>
      <div class="fld"><label>Date to</label><input type="date" id="to" value="2026-09-30" /></div>
      <button class="btn" id="apply"><i class="fas fa-filter"></i> Apply</button>
      <button class="btn ghost" id="reset">Reset</button>
      <div id="stamp" style="margin-left:auto;font-size:11px;color:var(--muted)"></div>
    </div>

    <div id="noteBox"></div>

    <div class="kstrip">
      <div class="card kcard"><div class="bar"></div>
        <div class="kt"><i class="fas fa-seedling"></i> Production</div>
        <div class="krow"><span class="kach" id="prodAch">—</span><span class="ktgt">/ <span id="prodTgt">—</span></span></div>
        <div class="kbar"><span id="prodBar"></span></div>
        <div class="kpct" id="prodPct">—</div>
      </div>
      <div class="card kcard"><div class="bar"></div>
        <div class="kt"><i class="fas fa-users"></i> Reach (New Youth)</div>
        <div class="krow"><span class="kach" id="reachAch">—</span><span class="ktgt">/ <span id="reachTgt">—</span></span></div>
        <div class="kbar"><span id="reachBar"></span></div>
        <div class="kpct" id="reachPct">—</div>
        <div class="kgen" id="reachGen"></div>
      </div>
      <div class="card kcard"><div class="bar"></div>
        <div class="kt"><i class="fas fa-people-group"></i> Mobilization</div>
        <div class="krow"><span class="kach" id="mobAch">—</span><span class="ktgt">/ <span id="mobTgt">—</span></span></div>
        <div class="kbar"><span id="mobBar"></span></div>
        <div class="kpct" id="mobPct">—</div>
        <div class="kgen" id="mobGen"></div>
      </div>
    </div>

    <section class="card" style="padding:18px; margin-bottom:18px">
      <h2><span class="snum">1</span><i class="fas fa-seedling"></i> Production: Targets vs Achieved</h2>
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
      <h2><span class="snum">2</span><i class="fas fa-users"></i> Reach: Targets vs Achieved</h2>
      <p class="desc">Reach = New Youth Reached (distinct participant at first training date). Balance = Target − Achieved. Reach target is the Year-3 cumulative target. <b>Female</b> and <b>PWD</b> counts are of the youth reached.</p>
      <div style="overflow-x:auto">
        <table><thead><tr>
          <th>District</th><th class="num">Target</th><th class="num">Achieved</th>
          <th class="num">Female</th><th class="num">PWD</th>
          <th class="num">Balance</th><th class="num">% Achieved</th><th style="width:120px">Progress</th>
        </tr></thead><tbody id="reachBody"><tr><td colspan="8" class="loading">Loading…</td></tr></tbody></table>
      </div>
    </section>

    <section class="card" style="padding:18px; margin-bottom:18px">
      <h2><span class="snum">3</span><i class="fas fa-people-group"></i> Mobilization: Targets vs Achieved</h2>
      <p class="desc">Mobilization Achieved = SHG Profiling &amp; Group Statistics (sum of participants). Target = Monthly SHGs × 25 participants × months. <b>Female</b> and <b>PWD</b> counts are of the participants profiled.</p>
      <div style="overflow-x:auto">
        <table><thead><tr>
          <th>District</th><th class="num">Target</th><th class="num">Achieved</th>
          <th class="num">Female</th><th class="num">PWD</th>
          <th class="num">% Achieved</th><th style="width:120px">Progress</th>
        </tr></thead><tbody id="mobBody"><tr><td colspan="7" class="loading">Loading…</td></tr></tbody></table>
      </div>
    </section>

    <footer class="docfoot">
      <div class="df-left">
        <div><b>Prepared by</b> the SAYE Uganda MEL team</div>
        <div class="df-src">Sources: youth attendance &amp; training register, SHG profiling &amp; group statistics, production and sales records. Targets from the Year-3 reach and production target frameworks.</div>
      </div>
      <div class="df-right">
        <div>SAYE Uganda &middot; MEL Report</div>
        <div id="dfStamp" class="df-src">—</div>
      </div>
    </footer>
  </div>

<script>
const CLUSTER_DISTRICTS = {
  iganga:['IGANGA','JINJA','JINJA CITY','MAYUGE','LUUKA'],
  kamuli:['KAMULI','KALIRO','BUYENDE'],
  bugiri:['BUGIRI','NAMUTUMBA','NAMAYINGO','BUGWERI'],
  central:['MUKONO','BUIKWE','KAYUNGA']
};
const fmt = n => (n==null||isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString();
function pctColor(p){ if(p==null) return '#9aa'; if(p>=80) return '#1a7a3d'; if(p>=50) return '#b46e0a'; return '#c0392b'; }
function pctBg(p){ if(p==null) return '#eee'; if(p>=80) return '#e5f4ea'; if(p>=50) return '#fdf1dd'; return '#fbe4e0'; }
function progressCell(p){
  const w = p==null ? 0 : Math.max(0, Math.min(100, Number(p)));
  return '<span class="achwrap"><span class="achbar" style="width:'+w+'%"></span></span>';
}
function pctPill(p){
  if(p==null) return '<span class="muted">—</span>';
  return '<span class="pill" style="color:'+pctColor(p)+';background:'+pctBg(p)+'">'+Number(p).toFixed(1)+'%</span>';
}

function gcell(v){ return '<td class="num sub">'+fmt(v)+'</td>'; }
function renderReach(rows){
  const b=document.getElementById('reachBody');
  if(!rows||!rows.length){ b.innerHTML='<tr><td colspan="8" class="loading">No data for this selection.</td></tr>'; return; }
  let tT=0,tA=0,tB=0,tF=0,tP=0;
  let html = rows.map(r=>{
    tT+=Number(r.target)||0; tA+=Number(r.achieved)||0; tB+=Number(r.balance)||0; tF+=Number(r.female)||0; tP+=Number(r.pwd)||0;
    return '<tr><td>'+r.district+'</td><td class="num">'+fmt(r.target)+'</td><td class="num">'+fmt(r.achieved)+
      '</td>'+gcell(r.female)+gcell(r.pwd)+'<td class="num">'+fmt(r.balance)+'</td><td class="num">'+pctPill(r.pct)+'</td><td>'+progressCell(r.pct)+'</td></tr>';
  }).join('');
  const tp = tT>0 ? (100*tA/tT) : null;
  html += '<tr class="total"><td>Total</td><td class="num">'+fmt(tT)+'</td><td class="num">'+fmt(tA)+'</td>'+gcell(tF)+gcell(tP)+'<td class="num">'+fmt(tB)+'</td><td class="num">'+pctPill(tp)+'</td><td>'+progressCell(tp)+'</td></tr>';
  b.innerHTML=html;
}
function renderMob(rows){
  const b=document.getElementById('mobBody');
  if(!rows||!rows.length){ b.innerHTML='<tr><td colspan="7" class="loading">No data for this selection.</td></tr>'; return; }
  let tT=0,tA=0,tF=0,tP=0;
  let html = rows.map(r=>{
    tT+=Number(r.target)||0; tA+=Number(r.achieved)||0; tF+=Number(r.female)||0; tP+=Number(r.pwd)||0;
    return '<tr><td>'+r.district+'</td><td class="num">'+fmt(r.target)+'</td><td class="num">'+fmt(r.achieved)+
      '</td>'+gcell(r.female)+gcell(r.pwd)+'<td class="num">'+pctPill(r.pct)+'</td><td>'+progressCell(r.pct)+'</td></tr>';
  }).join('');
  const tp = tT>0 ? (100*tA/tT) : null;
  html += '<tr class="total"><td>Total</td><td class="num">'+fmt(tT)+'</td><td class="num">'+fmt(tA)+'</td>'+gcell(tF)+gcell(tP)+'<td class="num">'+pctPill(tp)+'</td><td>'+progressCell(tp)+'</td></tr>';
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
    div.innerHTML='<div style="font-weight:800;color:var(--primary);font-size:13px;margin-bottom:6px">'+season+' — Expected Jobs by value chain</div>'+
      '<div style="overflow-x:auto"><table><thead><tr><th class="gcol">District</th><th class="num gcol">Exp. Jobs</th><th class="num gcol">Poultry</th><th class="num gcol">Goats</th><th class="num gcol">Hort.</th><th class="num gcol">Dairy</th><th class="num gcol">Total</th></tr></thead><tbody>'+body+'</tbody></table></div>';
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
    const genLine = (f,p) => '<span class="gchip gf"><i class="fas fa-venus"></i> '+fmt(f)+' female</span><span class="gchip gp"><i class="fas fa-wheelchair"></i> '+fmt(p)+' PWD</span>';
    document.getElementById('reachGen').innerHTML = genLine(t.reach_female||0, t.reach_pwd||0);
    document.getElementById('mobGen').innerHTML = genLine(t.mob_female||0, t.mob_pwd||0);
    renderProd(d.production||[]);
    renderSeasons(d.production_seasons||[]);
    renderReach(d.reach||[]);
    renderMob(d.mobilization||[]);
    document.getElementById('noteBox').innerHTML = (cl!=='iganga' && cl!=='all')
      ? '<div class="note"><i class="fas fa-circle-info"></i> Targets are currently loaded for the <b>Iganga cluster</b> only. Other clusters show achieved figures with blank targets until their targets are added.</div>'
      : '';
    const db=d.date_bounds||{};
    document.getElementById('stamp').textContent = 'Data through '+(db.max||'—');
    const clLabel = (document.getElementById('cluster').selectedOptions[0]||{}).text || cl;
    const nowStr = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    const mhc=document.getElementById('mhCluster'); if(mhc) mhc.textContent=clLabel;
    const mhd=document.getElementById('mhDate'); if(mhd) mhd.textContent=nowStr;
    const dfs=document.getElementById('dfStamp'); if(dfs) dfs.textContent='Generated '+nowStr+' · data through '+(db.max||'—');
  }catch(e){
    document.getElementById('stamp').textContent='Error loading data';
    ['prodBody','reachBody','mobBody'].forEach(id=>document.getElementById(id).innerHTML='<tr><td colspan="7" class="loading">Failed to load.</td></tr>');
  }
  loading=false;
}
document.getElementById('apply').addEventListener('click', load);
document.getElementById('reset').addEventListener('click', ()=>{ document.getElementById('from').value='2025-10-01'; document.getElementById('to').value='2026-09-30'; document.getElementById('cluster').value='iganga'; load(); });
document.getElementById('cluster').addEventListener('change', load);
load();
</script>
</body>
</html>`;
}
