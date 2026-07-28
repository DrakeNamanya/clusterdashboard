import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// WEEKLY REPORT — Mon→Sun narrative summary of ALL indicators, per cluster.
//   Filters: Cluster + Date range (default = current Mon→Sun week).
//   Renders a "Weekly Highlights" narrative broken into sections:
//     Profiling & SHG Formation, Training (by area), Distribution,
//     Production & Marketing, Poultry Sales, Access to Finance (ISLA),
//     Leverage Contributions.
//   Data from /api/weekly (mel_weekly_report RPC).
// ---------------------------------------------------------------------------

export function renderWeeklyReport(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Report — SAYE</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --green:#006837; --green-2:#00A859; --lgreen:#e9f5ee; --ink:#25352c;
      --muted:#7f8c85; --line:#e2e9e4; --amber:#F6921E; --blue:#2E9BD6;
      --band:#0f5132; --cream:#fbf6e3; --purple:#7c5cbf; --red:#c0392b; --teal:#1f9e94;
    }
    body{ background:#eef2ef; color:var(--ink); font-family:"Segoe UI",Calibri,Arial,system-ui,sans-serif; margin:0; }
    .wrap{ max-width:1080px; margin:0 auto; padding:22px 20px 40px; }
    h1{ font-size:24px; font-weight:800; color:var(--green); margin:0 0 2px; }

    /* Formal document masthead (shared style with Report Dashboard) */
    .masthead{ background:#fff; border:1px solid var(--line); border-top:5px solid var(--green); border-radius:12px 12px 0 0; padding:20px 26px; display:flex; align-items:center; gap:24px; flex-wrap:wrap; box-shadow:0 1px 3px rgba(40,60,50,.05); }
    .mh-brand{ display:flex; align-items:center; gap:12px; }
    .mh-logo{ width:48px; height:48px; border-radius:10px; background:linear-gradient(135deg,var(--green),var(--green-2)); color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; box-shadow:0 2px 6px rgba(0,104,55,.25); }
    .mh-org-name{ font-size:18px; font-weight:800; color:var(--green); line-height:1.1; }
    .mh-org-tag{ font-size:10.5px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); margin-top:2px; }
    .mh-titleblock{ flex:1; min-width:180px; border-left:1px solid var(--line); padding-left:24px; }
    .mh-doctype{ font-size:10.5px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--green-2); }
    .mh-title{ font-size:23px; font-weight:800; color:var(--ink); margin:2px 0 0; letter-spacing:-.01em; }
    .mh-meta{ display:flex; flex-direction:column; gap:2px; font-size:11.5px; min-width:200px; }
    .mh-meta > div{ display:flex; justify-content:space-between; gap:16px; padding:3px 0; border-bottom:1px dotted var(--line); }
    .mh-meta > div:last-child{ border-bottom:0; }
    .mh-meta span{ color:var(--muted); text-transform:uppercase; letter-spacing:.03em; font-size:10px; font-weight:700; }
    .mh-meta b{ color:var(--ink); font-weight:700; }
    @media(max-width:760px){ .mh-titleblock{ border-left:0; padding-left:0; } }

    .sub{ color:var(--muted); font-size:12.5px; line-height:1.6; margin:0 0 18px; background:#fff; border:1px solid var(--line); border-top:0; border-radius:0 0 12px 12px; padding:12px 26px; box-shadow:0 1px 3px rgba(40,60,50,.05); }

    /* Document footer */
    .docfoot{ display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap; margin-top:14px; padding:16px 22px; background:#fff; border:1px solid var(--line); border-top:3px solid var(--green); border-radius:12px; font-size:11.5px; color:var(--ink); }
    .docfoot b{ color:var(--green); }
    .df-src{ color:var(--muted); font-size:11px; margin-top:4px; max-width:620px; line-height:1.55; }
    .df-right{ text-align:right; font-weight:700; color:var(--muted); }
    .card{ background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 1px 3px rgba(40,60,50,.05); }

    .filters{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:18px; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:700; }
    .fld select, .fld input{ border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; background:#fff; min-width:150px; }
    .btn{ background:var(--green); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; }
    .btn:hover{ background:var(--green-2); }
    .btn.ghost{ background:#fff; color:var(--green); border:1px solid var(--line); }

    .periodband{ display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; background:var(--band); color:#fff; border-radius:10px; padding:12px 20px; margin-bottom:18px; }
    .periodband .pb-left{ font-size:15px; font-weight:800; letter-spacing:.01em; }
    .periodband .pb-left i{ opacity:.8; margin-right:6px; }
    .periodband .pb-right{ font-size:12.5px; opacity:.92; font-weight:600; }

    .kstrip{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px; }
    @media(max-width:820px){ .kstrip{ grid-template-columns:repeat(2,1fr); } }
    .kcard{ padding:14px 16px; }
    .kcard .kt{ font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
    .kcard .kv{ font-size:24px; font-weight:800; color:var(--ink); margin-top:6px; line-height:1; }
    .kcard .ks{ font-size:11px; color:var(--muted); margin-top:4px; }

    .sec{ padding:18px 20px; margin-bottom:14px; }
    .sec h2{ font-size:15px; font-weight:800; margin:0 0 8px; display:flex; align-items:center; gap:9px; }
    .sec h2 .ic{ width:30px; height:30px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:13px; }
    .sec p{ margin:0; font-size:14px; line-height:1.65; color:#3a4a41; }
    .sec p b{ color:var(--green); }
    .chips{ display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    .chip{ background:var(--lgreen); border:1px solid #cfe6d8; color:var(--green); font-size:12px; font-weight:700; padding:5px 11px; border-radius:20px; }
    .chip b{ color:var(--ink); }
    .trtable{ width:100%; border-collapse:collapse; margin-top:12px; }
    .trtable td{ padding:6px 10px; font-size:13px; border-bottom:1px solid #eef2ef; }
    .trtable td.n{ text-align:right; font-variant-numeric:tabular-nums; font-weight:700; }
    .loading{ text-align:center; color:var(--muted); padding:26px; font-size:13px; }
    .note{ background:#fff8e6; border:1px solid #f0e2b6; color:#7a6414; font-size:12px; padding:8px 12px; border-radius:8px; margin-bottom:16px; }

    /* sign-off + MEL stamp */
    .signoff{ display:flex; align-items:flex-end; gap:34px; padding:16px 22px 26px; position:relative; margin-top:6px; }
    .sign{ flex:1; max-width:220px; }
    .sign .sline{ border-bottom:1.5px solid #9aa8a0; height:34px; }
    .sign .slbl{ font-size:11px; color:var(--muted); font-weight:700; margin-top:5px; text-transform:uppercase; letter-spacing:.04em; }
    .stamp{ margin-left:auto; }
    .stamp-inner{ width:150px; height:150px; border-radius:50%; border:3px solid #c0392b; color:#c0392b; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; transform:rotate(-11deg); opacity:.86; box-shadow:inset 0 0 0 2px #c0392b33; }
    .stamp-top{ font-size:12px; font-weight:900; letter-spacing:.08em; }
    .stamp-mid{ font-size:16px; font-weight:900; margin:3px 0; border-top:2px solid #c0392b; border-bottom:2px solid #c0392b; padding:3px 0; width:82%; }
    .stamp-dt{ font-size:12px; font-weight:800; margin:3px 0; }
    .stamp-bot{ font-size:7.5px; font-weight:800; letter-spacing:.03em; width:88%; }

    /* PRINT — colored PDF via browser Print → Save as PDF */
    @media print{
      @page{ size:A4; margin:12mm; }
      html,body{ background:#fff !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .shg-nav,.shg-nav-open,.filters,#noteBox,.no-print{ display:none !important; }
      .wrap{ max-width:100% !important; margin:0 !important; padding:0 4mm !important; }
      .card,.sec,.hero,.kcard{ box-shadow:none; page-break-inside:avoid; }
      .sec h2 .ic,.chip,.hero{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>
${navSidebar('weekly')}
  <div class="wrap">
    <header class="masthead">
      <div class="mh-brand">
        <div class="mh-logo"><i class="fas fa-calendar-week"></i></div>
        <div class="mh-org">
          <div class="mh-org-name">SAYE Uganda</div>
          <div class="mh-org-tag">Monitoring, Evaluation &amp; Learning</div>
        </div>
      </div>
      <div class="mh-titleblock">
        <div class="mh-doctype">Weekly Field Report</div>
        <h1 class="mh-title">Weekly Highlights</h1>
      </div>
      <div class="mh-meta">
        <div><span>Cluster</span><b id="mhCluster">Iganga</b></div>
        <div><span>Week</span><b id="mhWeek">—</b></div>
        <div><span>Generated</span><b id="mhDate">—</b></div>
      </div>
    </header>
    <p class="sub">Monday → Sunday summary of all indicators for the selected cluster, disaggregated by <b>female</b> and <b>persons with disabilities (PWD)</b>. Prepared for weekly review and sharing.</p>

    <div class="filters">
      <div class="fld"><label>Cluster</label>
        <select id="cluster">${clusterOptions('iganga')}</select></div>
      <div class="fld"><label>Week from (Mon)</label><input type="date" id="from" /></div>
      <div class="fld"><label>Week to (Sun)</label><input type="date" id="to" /></div>
      <button class="btn" id="apply"><i class="fas fa-filter"></i> Apply</button>
      <button class="btn ghost" id="thisweek">This week</button>
      <button class="btn ghost" id="reset">All time</button>
      <button class="btn ghost" id="printBtn"><i class="fas fa-file-pdf" style="color:#c0392b"></i> Print / PDF</button>
    </div>

    <div id="noteBox"></div>

    <div class="periodband">
      <div class="pb-left"><i class="fas fa-calendar-day"></i> <span id="heroTtl">—</span></div>
      <div class="pb-right" id="heroMeta">Loading…</div>
    </div>

    <div class="kstrip">
      <div class="card kcard"><div class="kt">Youth Reached / Trained</div><div class="kv" id="kTrained">—</div><div class="ks">distinct participants trained</div></div>
      <div class="card kcard"><div class="kt">SHGs Formed</div><div class="kv" id="kShgs">—</div><div class="ks">new groups profiled</div></div>
      <div class="card kcard"><div class="kt">Savings Mobilized</div><div class="kv" id="kSavings">—</div><div class="ks">UGX (ISLA amount saved)</div></div>
      <div class="card kcard"><div class="kt">Leverage Raised</div><div class="kv" id="kLev">—</div><div class="ks">UGX local contributions</div></div>
    </div>

    <div id="narrative"></div>

    <footer class="docfoot">
      <div class="df-left">
        <div><b>Prepared by</b> the SAYE Uganda MEL team</div>
        <div class="df-src">Sources: youth attendance &amp; training register, SHG profiling, production, sales, poultry and ISLA records. Figures cover the selected week and cluster; gender source is the participant register.</div>
      </div>
      <div class="df-right">
        <div>SAYE Uganda &middot; Weekly Report</div>
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
const CLUSTER_LABEL = { iganga:'Iganga Cluster', kamuli:'Kamuli Cluster', bugiri:'Bugiri Cluster', central:'Central Cluster', all:'All Clusters' };
const fmt = n => (n==null||isNaN(n)) ? '0' : Math.round(Number(n)).toLocaleString();
function ugx(n){ n=Number(n)||0; if(n>=1e9) return 'UGX '+(n/1e9).toFixed(2)+'B'; if(n>=1e6) return 'UGX '+(n/1e6).toFixed(1)+'M'; if(n>=1e3) return 'UGX '+(n/1e3).toFixed(0)+'K'; return 'UGX '+fmt(n); }
// Female / PWD (disability) disaggregation string, e.g. "5,198 female · 421 PWDs".
function dis(female, pwd){ return fmt(female)+' female · '+fmt(pwd)+' PWDs'; }
function pct(part, whole){ part=Number(part)||0; whole=Number(whole)||0; return whole>0 ? Math.round(100*part/whole)+'%' : '0%'; }

// Monday of the current week + Sunday
function weekBounds(){
  const d=new Date(); const day=(d.getDay()+6)%7; // 0=Mon
  const mon=new Date(d); mon.setDate(d.getDate()-day);
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  const iso=x=>x.toISOString().slice(0,10);
  return { from:iso(mon), to:iso(sun) };
}
function prettyDate(s){ if(!s) return ''; const d=new Date(s+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }

function sec(color, icon, title, bodyHtml){
  return '<section class="card sec"><h2><span class="ic" style="background:'+color+'"><i class="fas '+icon+'"></i></span>'+title+'</h2>'+bodyHtml+'</section>';
}

function buildNarrative(d, clusterLabel, yiw){
  const p=d.profiling||{}, dist=d.distribution||{}, prod=d.production||{}, poul=d.poultry||{}, hs=d.hort_sales||{}, isla=d.isla||{}, lev=d.leverage||{};
  const trBy=d.training_by||[]; const trained=d.training_total||0;
  let out='';

  // Profiling & SHG Formation
  out += sec('var(--amber)','fa-users','Profiling & SHG Formation',
    '<p>The '+clusterLabel+' registered <b>'+fmt(p.shgs_formed)+' SHGs</b> during the period, profiling a total of <b>'+fmt(p.youth_profiled)+' youth</b> ('+fmt(p.female_profiled)+' female, '+fmt(p.male_profiled)+' male).</p>'+
    '<div class="chips"><span class="chip">SHGs formed <b>'+fmt(p.shgs_formed)+'</b></span><span class="chip">Youth profiled <b>'+fmt(p.youth_profiled)+'</b></span><span class="chip">Female <b>'+fmt(p.female_profiled)+'</b></span><span class="chip">Male <b>'+fmt(p.male_profiled)+'</b></span></div>');

  // Training
  let trRows = trBy.slice(0,10).map(t=>'<tr><td>'+(t.type||'—')+'</td><td class="n">'+fmt(t.n)+'</td></tr>').join('');
  if(!trRows) trRows='<tr><td colspan="2" class="loading">No trainings recorded.</td></tr>';
  out += sec('var(--blue)','fa-chalkboard-user','Training by Frontliners',
    '<p>A total of <b>'+fmt(trained)+' youth</b> were trained across '+fmt(trBy.length)+' training areas. Breakdown by area:</p>'+
    '<table class="trtable"><tbody>'+trRows+'</tbody></table>');

  // Distribution — say WHAT was distributed (material types) rather than opaque
  // "N distribution lines". Falls back gracefully if no items are available.
  const distItems = (dist.items && String(dist.items).trim()) ? String(dist.items) : '';
  out += sec('var(--green-2)','fa-box-open','Distribution to Participants',
    '<p>'+(distItems
      ? '<b>'+distItems+'</b> were distributed to '
      : 'Materials were distributed to ')
    +'<b>'+fmt(dist.participants)+' participants</b> across <b>'+fmt(dist.shgs)+' SHGs</b> during the period.</p>');

  // Production & Marketing — with female/PWD disaggregation + WHAT was sold (kg/pieces).
  const hsItems = (hs.items && String(hs.items).trim()) ? String(hs.items) : '';
  out += sec('var(--green)','fa-seedling','Production & Marketing',
    '<p>In production, <b>'+fmt(prod.youth)+' youth</b> ('+dis(prod.female, prod.pwd)+') from <b>'+fmt(prod.shgs)+' SHGs</b> were active across '+fmt(prod.districts)+' districts ('+(prod.district_list||'—')+'). '+
    'Horticulture/oilseed marketing engaged <b>'+fmt(hs.youth)+' youth sellers</b> ('+dis(hs.female, hs.pwd)+') generating <b>'+ugx(hs.value)+'</b>.'+
    (hsItems ? ' Produce sold: <b>'+hsItems+'</b>.' : '')+'</p>'+
    '<div class="chips">'+
      '<span class="chip">Prod. youth <b>'+fmt(prod.youth)+'</b></span>'+
      '<span class="chip">Female <b>'+fmt(prod.female)+'</b></span>'+
      '<span class="chip">PWDs <b>'+fmt(prod.pwd)+'</b></span>'+
      '<span class="chip">Youth sellers <b>'+fmt(hs.youth)+'</b></span>'+
      '<span class="chip">Sellers · Female <b>'+fmt(hs.female)+'</b></span>'+
      '<span class="chip">Sellers · PWDs <b>'+fmt(hs.pwd)+'</b></span>'+
      '<span class="chip">Hort. sales <b>'+ugx(hs.value)+'</b></span>'+
    '</div>');

  // Poultry Sales — with female/PWD disaggregation.
  out += sec('var(--amber)','fa-egg','Poultry Sales',
    '<p><b>'+fmt(poul.birds_sold)+' birds</b> were sold by <b>'+fmt(poul.youth)+' youth</b> ('+dis(poul.female, poul.pwd)+') across <b>'+fmt(poul.shgs)+' SHGs</b>, earning <b>'+ugx(poul.value)+'</b>.</p>'+
    '<div class="chips"><span class="chip">Youth sellers <b>'+fmt(poul.youth)+'</b></span><span class="chip">Female <b>'+fmt(poul.female)+'</b></span><span class="chip">PWDs <b>'+fmt(poul.pwd)+'</b></span><span class="chip">Birds sold <b>'+fmt(poul.birds_sold)+'</b></span></div>');

  // Access to Finance / ISLA — now includes how many youth are saving.
  out += sec('var(--purple)','fa-piggy-bank','Access to Finance (ISLA)',
    '<p><b>'+fmt(isla.shgs)+' SHGs</b> mobilized <b>'+ugx(isla.savings)+'</b> in savings from <b>'+fmt(isla.savers)+' youth savers</b>, with <b>'+ugx(isla.loans_value)+'</b> in loans given to <b>'+fmt(isla.loans_count)+'</b> youth.</p>'+
    '<div class="chips"><span class="chip">Youth saving <b>'+fmt(isla.savers)+'</b></span><span class="chip">Amount saved <b>'+ugx(isla.savings)+'</b></span><span class="chip">Loans given <b>'+ugx(isla.loans_value)+'</b></span><span class="chip">Youth who got loans <b>'+fmt(isla.loans_count)+'</b></span></div>');

  // Youth in Work (job tracking)
  if(yiw){
    const k=yiw.kpi||{}; const bd=yiw.byDistrict||[];
    const yiwTgt=bd.reduce((s,r)=>s+(Number(r.yiwTarget)||0),0);
    const empPct = yiwTgt>0 ? Math.round(100*(Number(k.employedYouth)||0)/yiwTgt)+'%' : '—';
    out += sec('var(--blue)','fa-briefcase','Youth in Work',
      '<p>During the period, <b>'+fmt(k.youthTracked)+' youth</b> were job-tracked, of whom <b>'+fmt(k.employedYouth)+'</b> are <b>employed</b> (Youth in Work) — <b>'+fmt(k.selfEmployed)+'</b> self-employed and <b>'+fmt(k.wageEmployed)+'</b> wage-employed, generating <b>'+ugx(k.totalIncome)+'</b> in income. This is <b>'+empPct+'</b> of the Youth-in-Work target ('+fmt(yiwTgt)+', i.e. 70% of the cluster reach target).</p>'+
      '<div class="chips"><span class="chip">Job-tracked <b>'+fmt(k.youthTracked)+'</b></span><span class="chip">Employed (YiW) <b>'+fmt(k.employedYouth)+'</b></span><span class="chip">YiW target <b>'+fmt(yiwTgt)+'</b></span><span class="chip">Self-employed <b>'+fmt(k.selfEmployed)+'</b></span><span class="chip">Wage-employed <b>'+fmt(k.wageEmployed)+'</b></span><span class="chip">Income <b>'+ugx(k.totalIncome)+'</b></span></div>');
  }

  // Leverage
  out += sec('var(--teal)','fa-handshake','Leverage Contributions',
    '<p>Local leverage contributions totalled <b>'+ugx(lev.amount)+'</b> during the reporting period.</p>');

  // ---- SIGN-OFF + MEL STAMP ----
  out += '<section class="card"><div class="signoff">'+
    '<div class="sign"><div class="sline"></div><div class="slbl">Prepared by (M&amp;E)</div></div>'+
    '<div class="sign"><div class="sline"></div><div class="slbl">Cluster Supervisor</div></div>'+
    '<div class="stamp"><div class="stamp-inner">'+
      '<div class="stamp-top">SAYE UGANDA</div>'+
      '<div class="stamp-mid">M &amp; E VERIFIED</div>'+
      '<div class="stamp-dt">'+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+'</div>'+
      '<div class="stamp-bot">MONITORING · EVALUATION · LEARNING</div>'+
    '</div></div>'+
  '</div></section>';

  document.getElementById('narrative').innerHTML = out;
  // KPIs
  document.getElementById('kTrained').textContent = fmt(trained);
  document.getElementById('kShgs').textContent = fmt(p.shgs_formed);
  document.getElementById('kSavings').textContent = ugx(isla.savings);
  document.getElementById('kLev').textContent = ugx(lev.amount);
}

let loading=false;
async function load(){
  if(loading) return; loading=true;
  const cl=document.getElementById('cluster').value;
  const from=document.getElementById('from').value;
  const to=document.getElementById('to').value;
  const districts=CLUSTER_DISTRICTS[cl]||[];
  const label=CLUSTER_LABEL[cl]||'Cluster';
  document.getElementById('heroTtl').textContent=label;
  document.getElementById('heroMeta').textContent='Loading…';
  const nowStr = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const setTxt=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  setTxt('mhCluster',label); setTxt('mhDate',nowStr);
  setTxt('mhWeek', (from&&to) ? (prettyDate(from)+' – '+prettyDate(to)) : 'All time');
  setTxt('dfStamp','Generated '+nowStr);
  const qs=new URLSearchParams();
  if(districts.length) qs.set('districts', districts.join(','));
  if(from) qs.set('from', from);
  if(to) qs.set('to', to);
  try{
    const [res, yiwRes]=await Promise.all([
      fetch('/api/weekly?'+qs.toString()),
      fetch('/api/youth-in-work?'+qs.toString()).catch(()=>null)
    ]);
    const d=await res.json();
    let yiw=null; try{ if(yiwRes && yiwRes.ok) yiw=await yiwRes.json(); }catch(e){}
    const range = (from&&to) ? (prettyDate(from)+' → '+prettyDate(to)) : 'All available data';
    document.getElementById('heroMeta').textContent = range;
    buildNarrative(d, label, yiw);
    document.getElementById('noteBox').innerHTML='';
  }catch(e){
    document.getElementById('heroMeta').textContent='Error loading data';
    document.getElementById('narrative').innerHTML='<section class="card sec"><p class="loading">Failed to load weekly report.</p></section>';
  }
  loading=false;
}
document.getElementById('apply').addEventListener('click', load);
document.getElementById('cluster').addEventListener('change', load);
document.getElementById('thisweek').addEventListener('click', ()=>{ const w=weekBounds(); document.getElementById('from').value=w.from; document.getElementById('to').value=w.to; load(); });
document.getElementById('reset').addEventListener('click', ()=>{ document.getElementById('from').value=''; document.getElementById('to').value=''; load(); });
document.getElementById('printBtn').addEventListener('click', ()=>window.print());
// default to current week
(function(){ const w=weekBounds(); document.getElementById('from').value=w.from; document.getElementById('to').value=w.to; })();
load();
</script>
</body>
</html>`;
}
