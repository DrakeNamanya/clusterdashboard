import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// CF (Community Facilitator) REPORT CARD
//   Filters: Cluster + Field Staff (CF) + Date range.
//   Matches the "COMMUNITY FACILITATOR REPORT CARD" design:
//     - Branded header + date/period metadata
//     - Identity row (Cluster / Field Staff / Report Period / Days in period)
//     - KPI tiles (activities, beneficiaries, SHGs, value mobilized, overall)
//     - Activity-area table with Achieved figures + performance grade
//     - Key Highlights + Overall Performance Grade gauge
//   Data from /api/cf-report and /api/cf-report/staff (mel_cf_report* RPCs).
// ---------------------------------------------------------------------------

export function renderCfReport(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF Report Card — SAYE</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Public+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* ---- West Ham United palette · print-first (white paper) ---------------
       Claret #7A263A · Sky Blue #1BB1E7 · Gold #F3D459 · White #FFFFFF.
       Looks like a clean document on white paper — no gray page ground,
       hairline rules, prints beautifully. Impeccable principles: one type
       scale, one spacing rhythm, restrained chrome, no gradient chips,
       no gray-on-color, no icon-tile-above-heading cliché. ------------------ */
    :root{
      --claret:#7A263A; --claret-d:#5e1b2c; --claret-t:#f4e7ea;
      --sky:#1BB1E7; --sky-d:#0f83b0; --sky-t:#e5f6fd;
      --gold:#F3D459; --gold-d:#b8931f; --gold-t:#fdf6dd;
      /* legacy aliases so existing markup keeps working */
      --green:var(--claret); --green-d:var(--claret-d); --green-2:var(--claret); --green-t:var(--claret-t); --lgreen:var(--claret-t);
      --blue:var(--sky); --blue-d:var(--sky-d); --blue-t:var(--sky-t);
      --red:#c0392b; --red-t:#fbe4e0;
      --ink:#1a1116; --body:#3a2f34; --muted:#7a6f73; --faint:#a89ea2;
      --line:#e7dfe1; --line-2:#d6c9cd; --paper:#ffffff; --ground:#ffffff;
      --band:var(--claret-d);
      /* per-area accents (harmonised to the palette family) */
      --amber:#c78a1e; --purple:#7A263A; --teal:#0f83b0; --yellow:#b8931f; --indigo:#5e1b2c;
      /* type scale */
      --t-cap:10.5px; --t-sm:12px; --t-base:13.5px; --t-md:15px; --t-lg:19px; --t-xl:26px; --t-2xl:34px;
      /* spacing */
      --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px;
      /* radii */
      --r-sm:6px; --r-md:10px; --r-lg:14px; --r-pill:999px;
      --shadow:none;
    }
    *{ box-sizing:border-box; }
    body{ background:var(--ground); color:var(--body); font-family:"Public Sans",-apple-system,Segoe UI,system-ui,sans-serif; margin:0; -webkit-font-smoothing:antialiased; }
    h1,h2,h3,.display{ font-family:"Sora","Public Sans",system-ui,sans-serif; }
    .wrap{ max-width:1120px; margin:0 auto; padding:var(--s6) var(--s5) var(--s7); }

    /* ---- Page masthead ---------------------------------------------------- */
    .masthead{ display:flex; flex-direction:column; gap:var(--s1); margin-bottom:var(--s5); }
    .kicker{ display:inline-flex; align-items:center; gap:var(--s2); font-size:var(--t-cap); font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--green); }
    .kicker::before{ content:""; width:22px; height:3px; border-radius:2px; background:var(--green); }
    .masthead h1{ margin:0; font-size:var(--t-2xl); font-weight:800; letter-spacing:-.02em; color:var(--ink); line-height:1.04; }
    .masthead .sub{ font-size:var(--t-base); color:var(--muted); max-width:60ch; margin:0; }

    /* ---- Filter bar ------------------------------------------------------- */
    .filters{ display:flex; flex-wrap:wrap; gap:var(--s3); align-items:flex-end; margin-bottom:var(--s5); background:var(--paper); border:1px solid var(--line); border-radius:var(--r-md); padding:var(--s4); }
    .fld{ display:flex; flex-direction:column; gap:var(--s1); }
    .fld label{ font-size:var(--t-cap); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:700; }
    .fld select, .fld input{ border:1px solid var(--line-2); border-radius:var(--r-sm); padding:9px 11px; font-size:var(--t-sm); background:var(--paper); min-width:160px; color:var(--ink); font-family:inherit; }
    .fld select:focus, .fld input:focus{ outline:none; border-color:var(--green); box-shadow:0 0 0 3px var(--green-t); }
    .btn{ background:var(--green); color:#fff; border:0; border-radius:var(--r-sm); padding:10px 16px; font-size:var(--t-sm); font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:background .15s; font-family:inherit; }
    .btn:hover{ background:var(--green-d); }
    .btn.ghost{ background:var(--paper); color:var(--green); border:1px solid var(--line-2); }
    .btn.ghost:hover{ background:var(--green-t); }

    /* Multi-select facilitator picker */
    .staffbox{ border:1px solid var(--line-2); border-radius:var(--r-sm); background:var(--paper); padding:6px; width:340px; max-width:100%; }
    .staffbox #staffSearch{ border:1px solid var(--line-2); border-radius:var(--r-sm); padding:7px 9px; font-size:var(--t-sm); width:100%; box-sizing:border-box; margin-bottom:6px; font-family:inherit; }
    .staffbox #staffSearch:focus{ outline:none; border-color:var(--green); box-shadow:0 0 0 3px var(--green-t); }
    .stafflist{ max-height:190px; overflow-y:auto; border-top:1px solid var(--line); }
    .stafflist label{ display:flex; align-items:center; gap:8px; padding:6px; font-size:var(--t-sm); border-radius:var(--r-sm); cursor:pointer; text-transform:none; letter-spacing:0; color:var(--ink); font-weight:500; }
    .stafflist label:hover{ background:var(--green-t); }
    .stafflist input[type=checkbox]{ min-width:auto; accent-color:var(--green); }
    .stafflist .cnt{ margin-left:auto; color:var(--muted); font-size:11px; font-variant-numeric:tabular-nums; }
    .staffloading,.staffempty{ color:var(--muted); font-size:var(--t-sm); padding:10px 6px; text-align:center; }
    .staffchosen{ display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
    .chip{ background:var(--green); color:#fff; font-size:11px; font-weight:700; padding:3px 9px; border-radius:var(--r-pill); display:inline-flex; align-items:center; gap:6px; }
    .chip i{ cursor:pointer; opacity:.85; }
    .chip i:hover{ opacity:1; }

    /* ---- Report sheet (looks like a document on white paper) -------------- */
    .cardsheet{ background:var(--paper); border:1px solid var(--line-2); border-radius:var(--r-md); overflow:hidden; }
    .chead{ display:flex; align-items:center; justify-content:space-between; gap:var(--s4); padding:var(--s5) var(--s5) var(--s4); border-bottom:3px solid var(--claret); }
    .chead .brandblock{ display:flex; align-items:center; gap:var(--s3); min-width:150px; }
    .chead .wordmark{ font-family:"Sora"; font-weight:800; font-size:var(--t-lg); letter-spacing:-.02em; line-height:1; color:var(--claret); }
    .chead .wordmark span{ color:var(--gold-d); }
    .chead .brandtxt .bt{ font-size:9px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); margin-top:3px; }
    .chead .mid{ flex:1; text-align:center; }
    .chead .mid .t{ font-family:"Sora"; font-size:var(--t-xl); font-weight:800; color:var(--ink); letter-spacing:-.02em; line-height:1; }
    .chead .mid .s{ font-size:var(--t-cap); color:var(--blue); font-weight:700; text-transform:uppercase; letter-spacing:.16em; margin-bottom:var(--s1); }
    .chead .meta{ font-size:9.5px; color:var(--faint); text-align:right; line-height:1.55; text-transform:uppercase; letter-spacing:.05em; font-weight:700; min-width:130px; }
    .chead .meta b{ color:var(--ink); font-size:var(--t-sm); text-transform:none; letter-spacing:0; display:block; margin-bottom:5px; }

    /* ---- ID strip — flat columns, hairline dividers ----------------------- */
    .idrow{ display:grid; grid-template-columns:repeat(4,1fr); padding:var(--s4) var(--s5); border-bottom:1px solid var(--line); }
    @media(max-width:820px){ .idrow{ grid-template-columns:repeat(2,1fr); gap:var(--s4) 0; } }
    .idcard{ display:flex; flex-direction:column; gap:3px; padding:0 var(--s4); border-left:2px solid var(--line-2); }
    .idcard:first-child{ border-left:0; padding-left:0; }
    .idcard .lb{ font-size:var(--t-cap); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:700; }
    .idcard .vl{ font-size:var(--t-md); font-weight:700; color:var(--ink); font-family:"Sora"; }

    /* ---- KPI strip -------------------------------------------------------- */
    .kpis{ display:grid; grid-template-columns:repeat(5,1fr); gap:var(--s3); padding:var(--s4) var(--s5); }
    @media(max-width:900px){ .kpis{ grid-template-columns:repeat(2,1fr); } }
    .kpi{ border:1px solid var(--line); border-radius:var(--r-md); padding:var(--s4); position:relative; }
    .kpi::before{ content:""; position:absolute; left:0; top:14px; bottom:14px; width:3px; border-radius:2px; background:var(--green); }
    .kpi.k-blue::before{ background:var(--blue); }
    .kpi .l{ font-size:var(--t-cap); text-transform:uppercase; letter-spacing:.07em; color:var(--muted); font-weight:700; }
    .kpi .v{ font-family:"Sora"; font-size:var(--t-xl); font-weight:800; color:var(--ink); margin-top:6px; line-height:1; }

    /* ---- Tables ----------------------------------------------------------- */
    .tblwrap{ padding:0 var(--s5) var(--s4); }
    table.act{ border-collapse:collapse; width:100%; }
    table.act thead th{ background:var(--paper); color:var(--muted); font-size:var(--t-cap); font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:9px 12px; text-align:left; border-bottom:2px solid var(--green); }
    table.act thead th.num{ text-align:right; }
    table.act tbody td{ padding:11px 12px; font-size:var(--t-base); border-bottom:1px solid var(--line); vertical-align:top; color:var(--body); }
    table.act tbody td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    table.act tbody tr:hover{ background:var(--ground); }
    .areahead{ display:flex; align-items:center; gap:9px; }
    .areahead .ic{ width:26px; height:26px; border-radius:var(--r-sm); color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; flex:0 0 auto; }
    .areahead .nm{ font-weight:700; color:var(--ink); }
    .ind{ color:var(--muted); font-size:var(--t-sm); }
    .grade{ display:inline-block; padding:2px 10px; border-radius:var(--r-pill); font-size:var(--t-sm); font-weight:800; }

    .btm{ display:grid; grid-template-columns:1.4fr 1fr; gap:var(--s4); padding:0 var(--s5) var(--s5); }
    @media(max-width:820px){ .btm{ grid-template-columns:1fr; } }
    .panel{ border:1px solid var(--line); border-radius:var(--r-md); padding:var(--s4) var(--s5); }
    .panel h3{ font-family:"Sora"; margin:0 0 var(--s3); font-size:var(--t-base); font-weight:700; color:var(--ink); display:flex; align-items:center; gap:8px; }
    .panel h3 i{ color:var(--green); }
    .hl{ display:flex; gap:9px; font-size:var(--t-base); margin-bottom:9px; line-height:1.55; }
    .hl i{ color:var(--green); margin-top:3px; }
    .gaugewrap{ display:flex; align-items:center; gap:var(--s5); }
    .gradetbl{ width:100%; border-collapse:collapse; }
    .gradetbl td{ padding:5px 6px; font-size:11.5px; border-bottom:1px solid var(--line); }
    .gradetbl td.g{ font-weight:800; width:26px; font-family:"Sora"; }

    .loading{ text-align:center; color:var(--muted); padding:var(--s7); font-size:var(--t-base); }
    .note{ display:flex; gap:var(--s2); background:var(--blue-t); border:1px solid #bfe6f8; color:var(--blue-d); font-size:var(--t-sm); line-height:1.5; padding:11px 14px; border-radius:var(--r-md); margin-bottom:var(--s4); }
    .note i{ color:var(--blue); margin-top:2px; }
    .note b{ color:var(--ink); }

    /* section titles */
    .secttl{ font-family:"Sora"; font-size:var(--t-base); font-weight:700; color:var(--ink); display:flex; align-items:baseline; gap:var(--s2); margin:var(--s2) 0 var(--s3); flex-wrap:wrap; }
    .secttl i{ color:var(--green); align-self:center; }
    .secttl .secsub{ font-family:"Public Sans"; font-weight:500; color:var(--muted); font-size:var(--t-sm); }
    /* progress bar in targets table */
    .pbar{ display:inline-block; width:88px; height:7px; border-radius:var(--r-pill); background:var(--line); vertical-align:middle; overflow:hidden; }
    .pbar-f{ height:100%; border-radius:var(--r-pill); }
    .pval{ font-family:"Sora"; font-size:var(--t-sm); font-weight:700; margin-left:8px; font-variant-numeric:tabular-nums; }

    /* sign-off + MEL stamp */
    .signoff{ display:flex; align-items:flex-end; gap:34px; padding:var(--s3) var(--s5) var(--s5); position:relative; }
    .sign{ flex:1; max-width:220px; }
    .sign .sline{ border-bottom:1.5px solid var(--line-2); height:34px; }
    .sign .slbl{ font-size:11px; color:var(--muted); font-weight:700; margin-top:5px; text-transform:uppercase; letter-spacing:.06em; }
    .stamp{ margin-left:auto; }
    .stamp-inner{ width:150px; height:150px; border-radius:50%; border:3px solid var(--green); color:var(--green); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; transform:rotate(-11deg); opacity:.9; box-shadow:inset 0 0 0 2px rgba(0,141,63,.2); }
    .stamp-top{ font-size:12px; font-weight:900; letter-spacing:.08em; }
    .stamp-mid{ font-family:"Sora"; font-size:16px; font-weight:900; margin:3px 0; border-top:2px solid var(--green); border-bottom:2px solid var(--green); padding:3px 0; width:82%; }
    .stamp-dt{ font-size:12px; font-weight:800; margin:3px 0; }
    .stamp-bot{ font-size:7.5px; font-weight:800; letter-spacing:.03em; width:88%; }

    /* PRINT — colored PDF via browser Print → Save as PDF (aligned) */
    @media print{
      @page{ size:A4; margin:12mm; }
      html,body{ background:#fff !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .shg-nav,.shg-nav-open,.filters,#noteBox,.masthead .sub,.no-print{ display:none !important; }
      .wrap{ max-width:100% !important; margin:0 !important; padding:0 4mm !important; }
      .masthead{ margin-bottom:8px; }
      .cardsheet{ box-shadow:none; border:1px solid #ccc; page-break-inside:avoid; }
      table.act thead th{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>
${navSidebar('cfreport')}
  <div class="wrap">
    <header class="masthead">
      <span class="kicker">SAYE Uganda · MEL</span>
      <h1>CF Report Card</h1>
      <p class="sub">A per-facilitator performance card — targets vs achieved, activity detail, and an overall grade. Pick a cluster and one or more field staff to generate, then export to PDF.</p>
    </header>

    <div class="filters">
      <div class="fld"><label>Cluster</label><select id="cluster">${clusterOptions('iganga')}</select></div>
      <div class="fld" style="flex:1;min-width:280px">
        <label>Field Staff (CF) — tick one, or several to merge duplicates</label>
        <div id="staffBox" class="staffbox">
          <input type="text" id="staffSearch" placeholder="Search facilitator…" autocomplete="off" />
          <div id="staffList" class="stafflist"><div class="staffloading">Loading…</div></div>
          <div id="staffChosen" class="staffchosen"></div>
        </div>
      </div>
      <div class="fld"><label>Date from</label><input type="date" id="from" /></div>
      <div class="fld"><label>Date to</label><input type="date" id="to" /></div>
      <button class="btn" id="apply"><i class="fas fa-id-badge"></i> Generate</button>
      <button class="btn ghost" id="reset">All time</button>
      <button class="btn ghost" id="printBtn"><i class="fas fa-file-pdf" style="color:#c0392b"></i> Print / PDF</button>
    </div>

    <div id="noteBox"><div class="note"><i class="fas fa-circle-info"></i> Facilitator names are auto-cleaned (spacing/punctuation). If the same person still appears under two spellings, tick <b>both</b> to merge them into one report card.</div></div>
    <div id="report"><div class="cardsheet"><div class="loading">Select a cluster and a field staff (CF), then click <b>Generate</b>.</div></div></div>
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
// Female / PWD disaggregation brief, e.g. "43 female · 1 PWD".
function db(female, pwd){ return fmt(female)+' female · '+fmt(pwd)+' PWD'; }
function prettyDate(s){ if(!s) return ''; const d=new Date(s+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function daysBetween(a,b){ if(!a||!b) return null; const d1=new Date(a), d2=new Date(b); return Math.round((d2-d1)/86400000)+1; }
function gradeFor(p){
  // West Ham ramp: claret (strong) → sky (mid) → gold (fair) → red (weak).
  if(p>=80) return {g:'A',lbl:'Excellent',c:'#7A263A',bg:'#f4e7ea'};
  if(p>=60) return {g:'B',lbl:'Very Good',c:'#0f83b0',bg:'#e5f6fd'};
  if(p>=40) return {g:'C',lbl:'Good',c:'#1BB1E7',bg:'#eaf8fe'};
  if(p>=20) return {g:'D',lbl:'Fair',c:'#b8931f',bg:'#fdf6dd'};
  return {g:'E',lbl:'Needs Improvement',c:'#c0392b',bg:'#fbe4e0'};
}

// -------- Multi-select facilitator picker --------
let STAFF=[];                 // [{key,name,activities}]
const CHOSEN=new Map();       // key -> name
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderStaffList(){
  const q=(document.getElementById('staffSearch').value||'').trim().toLowerCase();
  const box=document.getElementById('staffList');
  const items=STAFF.filter(s=>!q || s.name.toLowerCase().includes(q));
  if(!items.length){ box.innerHTML='<div class="staffempty">No facilitators match.</div>'; return; }
  box.innerHTML=items.slice(0,400).map(s=>{
    const k=esc(s.key), checked=CHOSEN.has(s.key)?'checked':'';
    return '<label><input type="checkbox" data-key="'+k+'" data-name="'+esc(s.name)+'" '+checked+'/>'+
      '<span>'+esc(s.name)+'</span><span class="cnt">'+fmt(s.activities)+'</span></label>';
  }).join('');
}
function renderChosen(){
  const host=document.getElementById('staffChosen');
  if(!CHOSEN.size){ host.innerHTML=''; return; }
  host.innerHTML=[...CHOSEN.entries()].map(([k,n])=>
    '<span class="chip">'+esc(n)+'<i class="fas fa-xmark" data-rm="'+esc(k)+'"></i></span>').join('');
}
function chosenKeys(){ return [...CHOSEN.keys()]; }

// Populate the facilitator list for the chosen cluster
async function loadStaff(){
  const cl=document.getElementById('cluster').value;
  const districts=CLUSTER_DISTRICTS[cl]||[];
  CHOSEN.clear(); renderChosen();
  const box=document.getElementById('staffList');
  box.innerHTML='<div class="staffloading">Loading…</div>';
  const qs=new URLSearchParams(); if(districts.length) qs.set('districts', districts.join(','));
  try{
    const res=await fetch('/api/cf-report/staff?'+qs.toString());
    const list=await res.json();
    STAFF=(list||[]).map(s=>({key:String(s.key), name:String(s.name), activities:Number(s.activities)||0}));
    renderStaffList();
  }catch(e){ box.innerHTML='<div class="staffempty">Failed to load facilitators.</div>'; }
}

// Build one activity table row
function actRow(idx, color, icon, area, indicatorText, achievedHtml, grade){
  return '<tr>'+
    '<td class="num" style="color:var(--muted)">'+idx+'</td>'+
    '<td><div class="areahead"><span class="ic" style="background:'+color+'"><i class="fas '+icon+'"></i></span><span class="nm">'+area+'</span></div></td>'+
    '<td class="ind">'+indicatorText+'</td>'+
    '<td class="num">'+achievedHtml+'</td>'+
    '<td>'+(grade?('<span class="grade" style="color:'+grade.c+';background:'+grade.bg+'">'+grade.lbl+'</span>'):'<span class="ind">—</span>')+'</td>'+
  '</tr>';
}

function buildCard(d, clusterLabel, from, to){
  const prof=d.profiling||{}, tr=d.training||{}, dist=d.distribution||{}, prod=d.production||{}, hs=d.hort_sales||{}, ps=d.poultry||{}, isla=d.isla||{}, lev=d.leverage||{};
  const yiw=d.youthInWork||{};
  const name=d.staff_name||'—';
  const days=daysBetween(from,to);
  const period = (from&&to) ? (prettyDate(from)+' – '+prettyDate(to)) : 'All available data';

  // Totals for KPI tiles
  const totalBeneficiaries = (Number(prof.youth_profiled)||0);
  // "SHGs Reached" = groups the CF actually trained (per client: SHGs reached
  // should equal groups trained), not profiled+production+isla SHGs summed.
  const totalShgs = (Number(tr.groups_trained)||0);
  const valueMobilized = (Number(isla.savings)||0)+(Number(hs.hs_value)||0)+(Number(ps.ps_value)||0)+(Number(lev.lev_amount)||0);
  const areaVals=[prof.shgs_profiled, tr.youth_trained, dist.dist_birds, prod.prod_youth, hs.hs_youth, ps.birds_sold, isla.isla_shgs, lev.lev_count];
  const totalActivities = areaVals.filter(x=>(Number(x)||0)>0).length;

  // -------- TARGETS vs ACHIEVED (client-defined per-CF targets) --------
  const T=d.targets||{shgs_profiled:16,youth:400,female_pct:70,pwd_pct:3,shgs_saving:16,youth_production:400,groups_trained:16};
  const femalePct = (Number(prof.youth_profiled)||0)>0 ? Math.round(100*(Number(prof.female)||0)/(Number(prof.youth_profiled)||1)) : 0;
  const pwdPct    = (Number(prof.youth_profiled)||0)>0 ? Math.round(100*(Number(prof.pwd)||0)/(Number(prof.youth_profiled)||1)) : 0;
  // each target: {label, achieved, target, pct, unit}
  const targetRows=[
    {ic:'fa-people-group', c:'var(--amber)', label:'SHGs Profiled', ach:Number(prof.shgs_profiled)||0, tgt:Number(T.shgs_profiled)||16, unit:'SHGs'},
    {ic:'fa-users', c:'var(--blue)', label:'Youth Mobilized', ach:Number(prof.youth_profiled)||0, tgt:Number(T.youth)||400, unit:'youth'},
    {ic:'fa-venus', c:'#d6408a', label:'Female Share', ach:femalePct, tgt:Number(T.female_pct)||70, unit:'%', isPct:true},
    {ic:'fa-wheelchair', c:'var(--teal)', label:'PWD Share', ach:pwdPct, tgt:Number(T.pwd_pct)||3, unit:'%', isPct:true},
    {ic:'fa-piggy-bank', c:'var(--purple)', label:'SHGs Saving (ISLA)', ach:Number(isla.isla_shgs)||0, tgt:Number(T.shgs_saving)||16, unit:'SHGs'},
    {ic:'fa-seedling', c:'var(--green)', label:'Youth into Production (hort + birds)', ach:Number(prod.prod_youth)||0, tgt:Number(T.youth_production)||400, unit:'youth'},
    {ic:'fa-chalkboard-user', c:'var(--green-2)', label:'Groups Trained', ach:Number(tr.groups_trained)||0, tgt:Number(T.groups_trained)||16, unit:'groups'},
    {ic:'fa-briefcase', c:'var(--indigo)', label:'Youth in Work (70% of mobilized)', ach:Number(yiw.employedYouth)||0, tgt:Number(yiw.yiwTarget)||0, unit:'youth'}
  ].map(r=>{ r.pct = r.tgt>0 ? Math.round(100*r.ach/r.tgt) : 0; r.grade=gradeFor(Math.min(100,r.pct)); return r; });

  // Overall = average % achievement across the client targets (capped at 100 each).
  const overall = Math.round(targetRows.reduce((a,r)=>a+Math.min(100,r.pct),0)/targetRows.length);
  const og = gradeFor(overall);

  const targetTable = targetRows.map((r,i)=>{
    const barPct=Math.min(100,r.pct);
    return '<tr>'+
      '<td class="num" style="color:var(--muted)">'+(i+1)+'</td>'+
      '<td><div class="areahead"><span class="ic" style="background:'+r.c+'"><i class="fas '+r.ic+'"></i></span><span class="nm">'+r.label+'</span></div></td>'+
      '<td class="num">'+fmt(r.tgt)+(r.isPct?'%':'')+'</td>'+
      '<td class="num">'+fmt(r.ach)+(r.isPct?'%':'')+'</td>'+
      '<td><div class="pbar"><div class="pbar-f" style="width:'+barPct+'%;background:'+r.grade.c+'"></div></div><span class="pval" style="color:'+r.grade.c+'">'+r.pct+'%</span></td>'+
      '<td><span class="grade" style="color:'+r.grade.c+';background:'+r.grade.bg+'">'+r.grade.g+'</span></td>'+
    '</tr>';
  }).join('');

  // Activity rows — grade against the client target where one exists, else presence.
  function presenceGrade(v){ return (Number(v)||0)>0 ? gradeFor(100) : gradeFor(0); }
  function tgtGrade(ach,tgt){ return gradeFor(tgt>0?Math.min(100,100*(Number(ach)||0)/tgt):0); }
  let rows='';
  rows += actRow(1,'var(--blue)','fa-chalkboard-user','Trainings (first trainings)', fmt(tr.groups_trained)+' groups trained across '+fmt(tr.training_areas)+' areas', fmt(tr.youth_trained)+' youth', tgtGrade(tr.groups_trained, T.groups_trained));
  rows += actRow(2,'var(--green-2)','fa-box-open','Distribution to Participants(birds)', fmt(dist.dist_birds)+' youth received birds', (dist.items||'—'), presenceGrade(dist.dist_birds));
  rows += actRow(3,'var(--amber)','fa-users','SHG Profiling', fmt(prof.youth_profiled)+' youth ('+db(prof.female, prof.pwd)+') · '+fmt(prof.shgs_below_25)+' SHGs &lt;25 · '+fmt(prof.shgs_25_plus)+' SHGs ≥25', fmt(prof.shgs_profiled)+' SHGs', tgtGrade(prof.shgs_profiled, T.shgs_profiled));
  rows += actRow(4,'var(--purple)','fa-piggy-bank','ISLA Savings & Loans', ugx(isla.savings)+' saved by '+fmt(isla.youth_savers)+' youth · '+ugx(isla.loans_value)+' loans given · '+fmt(isla.youth_loans)+' youth got loans', fmt(isla.isla_shgs)+' SHGs', tgtGrade(isla.isla_shgs, T.shgs_saving));
  rows += actRow(5,'var(--green)','fa-seedling','Youth into Production', fmt(prod.prod_shgs)+' SHGs · '+db(prod.female, prod.pwd)+' · '+fmt(prod.prod_youth_hort)+' horticulture + '+fmt(prod.prod_youth_birds)+' birds', fmt(prod.prod_youth)+' youth', tgtGrade(prod.prod_youth, T.youth_production));
  rows += actRow(6,'var(--red)','fa-basket-shopping','Sales (Horticulture)', fmt(hs.hs_youth)+' youth sellers ('+db(hs.female, hs.pwd)+') · horticulture + oil seeds', ugx(hs.hs_value), presenceGrade(hs.hs_value));
  rows += actRow(7,'var(--yellow)','fa-egg','Sales (Poultry)', fmt(ps.ps_youth)+' youth ('+db(ps.female, ps.pwd)+') · '+ugx(ps.ps_value), fmt(ps.birds_sold)+' birds', presenceGrade(ps.birds_sold));
  rows += actRow(8,'var(--teal)','fa-handshake','Local Leverage', fmt(lev.lev_count)+' contributions', ugx(lev.lev_amount), presenceGrade(lev.lev_count));
  rows += actRow(9,'var(--indigo)','fa-briefcase','Youth in Work', 'Of '+fmt(prof.youth_profiled)+' youth mobilized, '+fmt(yiw.employedYouth)+' are in work ('+((Number(prof.youth_profiled)||0)>0?Math.round(100*(Number(yiw.employedYouth)||0)/(Number(prof.youth_profiled)||1)):0)+'% of mobilized) · '+fmt(yiw.selfEmployed)+' self-employed · '+fmt(yiw.wageEmployed)+' wage-employed · '+ugx(yiw.totalIncome)+' income', fmt(yiw.employedYouth)+' in work', tgtGrade(yiw.employedYouth, yiw.yiwTarget));

  // Key highlights (dynamic)
  const hls=[];
  if((Number(ps.ps_value)||0)>0) hls.push('Poultry sales generated <b>'+ugx(ps.ps_value)+'</b> from '+fmt(ps.birds_sold)+' birds.');
  if((Number(lev.lev_amount)||0)>0) hls.push('Mobilized <b>'+ugx(lev.lev_amount)+'</b> in local leverage across '+fmt(lev.lev_count)+' contributions.');
  if((Number(isla.savings)||0)>0) hls.push('Strong ISLA performance: <b>'+ugx(isla.savings)+'</b> saved and <b>'+ugx(isla.loans_value)+'</b> in loans given.');
  if((Number(prof.shgs_profiled)||0)>0) hls.push('Profiled <b>'+fmt(prof.shgs_profiled)+' SHGs</b> ('+fmt(prof.shgs_below_25)+' with &lt;25 members, '+fmt(prof.shgs_25_plus)+' with ≥25) reaching '+fmt(prof.youth_profiled)+' youth &mdash; '+db(prof.female, prof.pwd)+'.');
  if((Number(prod.prod_youth)||0)>0) hls.push('Engaged <b>'+fmt(prod.prod_youth)+' youth</b> in production ('+db(prod.female, prod.pwd)+').');
  if((Number(yiw.employedYouth)||0)>0) hls.push('Of the <b>'+fmt(prof.youth_profiled)+'</b> youth this CF mobilized, <b>'+fmt(yiw.employedYouth)+'</b> are now in work'+((Number(yiw.yiwTarget)||0)>0?' ('+Math.round(100*(Number(yiw.employedYouth)||0)/(Number(yiw.yiwTarget)||1))+'% of the 70% Youth-in-Work target)':'')+'.');
  if(!hls.length) hls.push('No recorded activity for this facilitator in the selected period.');

  const gradeTbl = [
    ['A','Excellent','80% - 100%','#7A263A'],['B','Very Good','60% - 79%','#0f83b0'],
    ['C','Good','40% - 59%','#1BB1E7'],['D','Fair','20% - 39%','#b8931f'],['E','Needs Improvement','0% - 19%','#c0392b']
  ].map(r=>'<tr><td class="g" style="color:'+r[3]+'">'+r[0]+'</td><td>'+r[1]+'</td><td style="text-align:right;color:var(--muted)">'+r[2]+'</td></tr>').join('');

  const circ=2*Math.PI*46; const off=circ*(1-overall/100);

  return '<div class="cardsheet">'+
    '<div class="chead">'+
      '<div class="brandblock">'+
        '<div class="brandtxt"><div class="wordmark">SAYE<span>·</span>MEL</div><div class="bt">Monitoring · Evaluation · Learning</div></div></div>'+
      '<div class="mid"><div class="s">Community Facilitator</div><div class="t">Performance Report Card</div></div>'+
      '<div class="meta"><b>'+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+'</b>Generated<br/><b style="margin-top:6px">'+period+'</b>Period</div>'+
    '</div>'+
    '<div class="idrow">'+
      '<div class="idcard"><div class="lb">Cluster</div><div class="vl">'+clusterLabel+'</div></div>'+
      '<div class="idcard"><div class="lb">Field Staff (CF)</div><div class="vl">'+name+'</div></div>'+
      '<div class="idcard"><div class="lb">Report Period</div><div class="vl">'+period+'</div></div>'+
      '<div class="idcard"><div class="lb">Days in Period</div><div class="vl">'+(days!=null?days+' Days':'—')+'</div></div>'+
    '</div>'+
    '<div class="kpis">'+
      '<div class="kpi"><div class="l">Activity Areas</div><div class="v">'+totalActivities+'</div></div>'+
      '<div class="kpi k-blue"><div class="l">Youth Reached</div><div class="v">'+fmt(totalBeneficiaries)+'</div></div>'+
      '<div class="kpi"><div class="l">SHGs Reached</div><div class="v">'+fmt(totalShgs)+'</div></div>'+
      '<div class="kpi k-blue"><div class="l">Value Mobilized</div><div class="v" style="font-size:var(--t-md)">'+ugx(valueMobilized)+'</div></div>'+
      '<div class="kpi"><div class="l">Overall</div><div class="v" style="color:'+og.c+'">'+overall+'%</div></div>'+
    '</div>'+
    // ---- TARGETS vs ACHIEVED ----
    '<div class="tblwrap"><div class="secttl"><i class="fas fa-bullseye"></i> Targets vs Achieved <span class="secsub">(per field-staff standard: 16 SHGs · 400 youth · 70% female · 3% PWD · 16 SHGs saving · 400 into production · 16 groups trained)</span></div>'+
      '<table class="act tgt"><thead><tr><th class="num">#</th><th>Target Area</th><th class="num">Target</th><th class="num">Achieved</th><th>% Achieved</th><th>Grade</th></tr></thead><tbody>'+targetTable+'</tbody></table></div>'+
    // ---- ACTIVITY DETAIL ----
    '<div class="tblwrap"><div class="secttl"><i class="fas fa-list-check"></i> Activity Detail</div>'+
      '<table class="act"><thead><tr><th class="num">#</th><th>Activity Area</th><th>Indicator</th><th class="num">Achieved</th><th>Performance</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="btm">'+
      '<div class="panel"><h3><i class="fas fa-star"></i> Key Highlights</h3>'+hls.map(h=>'<div class="hl"><i class="fas fa-circle-check"></i><span>'+h+'</span></div>').join('')+'</div>'+
      '<div class="panel"><h3><i class="fas fa-gauge-high"></i> Overall Performance Grade</h3>'+
        '<div class="gaugewrap">'+
          '<svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="46" fill="none" stroke="#e6ece8" stroke-width="12"/>'+
          '<circle cx="55" cy="55" r="46" fill="none" stroke="'+og.c+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+circ.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 55 55)"/>'+
          '<text x="55" y="50" text-anchor="middle" font-size="26" font-weight="800" font-family="Sora,sans-serif" fill="'+og.c+'">'+og.g+'</text>'+
          '<text x="55" y="70" text-anchor="middle" font-size="13" font-weight="700" fill="#6b7770">'+overall+'%</text></svg>'+
          '<table class="gradetbl">'+gradeTbl+'</table>'+
        '</div>'+
      '</div>'+
    '</div>'+
    // ---- SIGN-OFF + MEL STAMP ----
    '<div class="signoff">'+
      '<div class="sign"><div class="sline"></div><div class="slbl">Field Staff (CF)</div></div>'+
      '<div class="sign"><div class="sline"></div><div class="slbl">Supervisor</div></div>'+
      '<div class="stamp">'+
        '<div class="stamp-inner"><div class="stamp-top">SAYE UGANDA</div><div class="stamp-mid">M &amp; E VERIFIED</div>'+
        '<div class="stamp-dt">'+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+'</div>'+
        '<div class="stamp-bot">MONITORING · EVALUATION · LEARNING</div></div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

let loading=false;
async function load(){
  const keys=chosenKeys();
  if(!keys.length){ document.getElementById('report').innerHTML='<div class="cardsheet"><div class="loading">Tick one or more field staff (CF), then click <b>Generate</b>.</div></div>'; return; }
  if(loading) return; loading=true;
  const cl=document.getElementById('cluster').value;
  const from=document.getElementById('from').value;
  const to=document.getElementById('to').value;
  const districts=CLUSTER_DISTRICTS[cl]||[];
  const label=CLUSTER_LABEL[cl]||'Cluster';
  document.getElementById('report').innerHTML='<div class="cardsheet"><div class="loading">Generating report card…</div></div>';
  const qs=new URLSearchParams();
  qs.set('staff', keys.join('|'));   // multi-select merge: pipe-joined keys
  if(districts.length) qs.set('districts', districts.join(','));
  if(from) qs.set('from', from);
  if(to) qs.set('to', to);
  try{
    const yqs=new URLSearchParams();
    yqs.set('staff', keys.join('|'));   // YiW filtered to THIS CF's job-tracking
    if(districts.length) yqs.set('districts', districts.join(','));
    if(from) yqs.set('from', from);
    if(to) yqs.set('to', to);
    const [res, yres]=await Promise.all([
      fetch('/api/cf-report?'+qs.toString()),
      fetch('/api/youth-in-work?'+yqs.toString()).catch(()=>null)
    ]);
    const d=await res.json();
    try{ if(yres && yres.ok){ const yd=await yres.json();
      // Per-CF YiW target = 70% of the youth this CF mobilised (SHG profiling).
      const mobilized=Number((d.profiling&&d.profiling.youth_profiled)||0);
      d.youthInWork=(yd&&yd.kpi)?{ employedYouth:yd.kpi.employedYouth, youthTracked:yd.kpi.youthTracked, selfEmployed:yd.kpi.selfEmployed, wageEmployed:yd.kpi.wageEmployed, totalIncome:yd.kpi.totalIncome, mobilized:mobilized, yiwTarget:Math.round(mobilized*0.70) }:{ mobilized:mobilized, yiwTarget:Math.round(mobilized*0.70) }; } }catch(_){}
    document.getElementById('report').innerHTML=buildCard(d, label, from, to);
  }catch(e){
    document.getElementById('report').innerHTML='<div class="cardsheet"><div class="loading">Failed to generate report card.</div></div>';
  }
  loading=false;
}
document.getElementById('cluster').addEventListener('change', loadStaff);
document.getElementById('apply').addEventListener('click', load);
document.getElementById('staffSearch').addEventListener('input', renderStaffList);
// checkbox toggle (delegated)
document.getElementById('staffList').addEventListener('change', (e)=>{
  const cb=e.target.closest('input[type=checkbox]'); if(!cb) return;
  const k=cb.getAttribute('data-key'), n=cb.getAttribute('data-name');
  if(cb.checked) CHOSEN.set(k,n); else CHOSEN.delete(k);
  renderChosen();
});
// remove chip (delegated)
document.getElementById('staffChosen').addEventListener('click', (e)=>{
  const x=e.target.closest('[data-rm]'); if(!x) return;
  CHOSEN.delete(x.getAttribute('data-rm')); renderChosen(); renderStaffList();
});
document.getElementById('reset').addEventListener('click', ()=>{ document.getElementById('from').value=''; document.getElementById('to').value=''; load(); });
document.getElementById('printBtn').addEventListener('click', ()=>{
  if(!chosenKeys().length){ alert('Generate a report card first, then Print / PDF.'); return; }
  window.print();
});
loadStaff();
</script>
</body>
</html>`;
}
