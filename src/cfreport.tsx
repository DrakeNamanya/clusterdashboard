import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// CF (Community Facilitator) PERFORMANCE REPORT CARD
//   Filters: Cluster + Field Staff (CF, multi-select to merge duplicates) + Date range.
//
//   VISUAL DESIGN cloned from the user's Lovable "Everton" report card
//   (github.com/DrakeNamanya/everton-insights-dashboard, commit "Designed
//   print-ready report card"): Royal Blue #003399 on white, A4 2-page sheet.
//     PAGE 1 — full-bleed blue masthead (SAYE wordmark + "Performance Report
//              Card" + OVERALL % / grade block), 4-col meta strip, 01 Snapshot
//              (4 stats), 02 Targets vs Achieved (progress bars + grade boxes),
//              03 Key Highlights (2-col square bullets), footer Page 1/2.
//     PAGE 2 — 04 Activity Detail table, 05 Grading Scale + Verification,
//              sign-off lines, footer Page 2/2.
//   Fonts: Inter Tight (sans) + IBM Plex Mono (figures). Radius 0.25rem.
//   Live data UNCHANGED: /api/cf-report, /api/cf-report/staff, /api/youth-in-work.
// ---------------------------------------------------------------------------

export function renderCfReport(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF Performance Report Card — SAYE Uganda MEL</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* ===== "Everton" report-card design — Royal Blue #003399 on white ===== */
    :root{
      --primary:#003399; --primary-deep:#001f5c; --primary-tint:#eef2fb;
      --pf:#ffffff;
      --fg:#1b2437; --muted-fg:#5a6480; --card:#ffffff;
      --muted:#f1f3f9; --border:#d7deee; --rule:#b9c4e4;
      --good:#1f8a4c; --warn:#c07d12; --bad:#c62f2f;
      --desk:#eceff6;
      --sans:"Inter Tight",ui-sans-serif,system-ui,sans-serif;
      --mono:"IBM Plex Mono",ui-monospace,monospace;
    }
    *{ box-sizing:border-box; }
    body{ background:var(--desk); color:var(--fg); font-family:var(--sans); margin:0; -webkit-font-smoothing:antialiased; }
    .num{ font-family:var(--mono); font-variant-numeric:tabular-nums; letter-spacing:-.02em; }

    /* toolbar (screen only) */
    .toolbar{ max-width:210mm; margin:0 auto 14px; padding:16px 0 0; display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld.grow{ flex:1; min-width:240px; }
    .fld label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted-fg); }
    .fld select, .fld input{ border:1px solid var(--border); border-radius:2px; padding:8px 10px; font-size:13px; background:#fff; min-width:150px; color:var(--fg); font-family:inherit; }
    .fld select:focus, .fld input:focus{ outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(0,51,153,.12); }
    .btn{ background:var(--primary); color:#fff; border:0; border-radius:2px; padding:9px 16px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.12em; cursor:pointer; font-family:var(--sans); }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); border:1px solid var(--border); }

    /* multi-select facilitator picker */
    .staffbox{ border:1px solid var(--border); border-radius:2px; background:#fff; padding:8px; }
    .staffbox input[type=text]{ width:100%; border:1px solid var(--border); border-radius:2px; padding:7px 9px; font-size:13px; font-family:inherit; }
    .stafflist{ max-height:150px; overflow:auto; margin-top:8px; border-top:1px solid var(--border); }
    .stafflist label{ display:flex; align-items:center; gap:8px; padding:5px 4px; font-size:12.5px; cursor:pointer; border-bottom:1px solid var(--muted); }
    .stafflist label:hover{ background:var(--primary-tint); }
    .stafflist label .cnt{ margin-left:auto; font-family:var(--mono); font-size:10px; color:var(--muted-fg); }
    .staffloading,.staffempty{ padding:10px; font-size:12px; color:var(--muted-fg); }
    .staffchosen{ display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .staffchosen .chip{ display:inline-flex; align-items:center; gap:7px; background:var(--primary-tint); color:var(--primary-deep); border:1px solid var(--rule); font-size:11px; font-weight:600; padding:3px 8px; border-radius:2px; }
    .staffchosen .chip i{ cursor:pointer; color:var(--muted-fg); }
    .staffchosen .chip i:hover{ color:var(--bad); }
    .note{ max-width:210mm; margin:0 auto 14px; background:var(--primary-tint); border:1px solid var(--rule); border-left:3px solid var(--primary); color:var(--primary-deep); font-size:12px; padding:9px 13px; border-radius:2px; }
    .note i{ margin-right:6px; color:var(--primary); }

    /* A4 sheet */
    .sheet{ width:210mm; min-height:297mm; background:var(--pf); margin:0 auto 28px; box-shadow:0 1px 2px rgba(0,0,0,.08), 0 24px 48px -24px rgba(0,0,0,.25); display:flex; flex-direction:column; }

    /* ---- PAGE 1 masthead ---- */
    .mast{ background:var(--primary); color:#fff; padding:32px 16mm 28px; }
    .brand{ display:flex; align-items:center; gap:12px; }
    .brand .mark{ width:44px; height:44px; display:grid; place-items:center; background:#fff; }
    .brand .mark span{ font-family:var(--mono); font-size:13px; font-weight:700; letter-spacing:-.02em; color:var(--primary); }
    .brand .bn{ font-size:13px; font-weight:600; letter-spacing:.22em; }
    .brand .bt{ font-size:9px; letter-spacing:.3em; opacity:.72; margin-top:2px; }
    .mastrow{ margin-top:34px; display:flex; align-items:flex-end; justify-content:space-between; gap:24px; }
    .mastrow .eyebrow{ font-size:10px; letter-spacing:.34em; opacity:.7; }
    .mastrow h1{ margin:8px 0 0; font-size:38px; font-weight:600; line-height:1.05; letter-spacing:-.02em; }
    .ovbox{ border-left:1px solid rgba(255,255,255,.3); padding-left:20px; text-align:right; margin-bottom:4px; }
    .ovbox .ol{ font-size:9px; letter-spacing:.24em; opacity:.6; }
    .ovbox .ov{ font-family:var(--mono); font-size:52px; font-weight:700; line-height:1; }
    .ovbox .ov sup{ font-size:24px; vertical-align:top; }
    .ovbox .og{ margin-top:6px; font-size:10px; font-weight:600; letter-spacing:.2em; opacity:.82; }

    /* meta strip */
    .metastrip{ display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid var(--border); background:var(--primary-tint); }
    .metastrip .cell{ border-right:1px solid rgba(0,51,153,.12); padding:12px 16px; }
    .metastrip .cell:last-child{ border-right:0; }
    .metastrip .k{ font-family:var(--mono); font-size:8px; text-transform:uppercase; letter-spacing:.18em; color:var(--muted-fg); }
    .metastrip .v{ margin-top:5px; font-size:11px; font-weight:600; line-height:1.3; color:var(--primary-deep); }

    /* body + section head */
    .body{ padding:26px 16mm; flex:1; }
    .secthead{ display:flex; align-items:baseline; gap:12px; border-bottom:2px solid var(--primary); padding-bottom:6px; margin-bottom:14px; }
    .secthead .no{ font-family:var(--mono); font-size:10px; font-weight:700; color:var(--primary); }
    .secthead h2{ margin:0; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.16em; color:var(--primary); }
    .secthead .rng{ margin-left:auto; font-size:9px; color:var(--muted-fg); text-align:right; max-width:60%; line-height:1.4; }

    /* snapshot stats */
    .snap{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--border); }
    .snap .st{ background:var(--card); padding:16px; }
    .snap .st .v{ font-family:var(--mono); font-size:26px; font-weight:700; line-height:1; color:var(--primary); }
    .snap .st .v .u{ font-size:11px; font-weight:500; color:var(--muted-fg); margin-right:4px; }
    .snap .st .l{ margin-top:8px; font-size:9px; text-transform:uppercase; letter-spacing:.16em; color:var(--muted-fg); }

    .sect{ margin-top:30px; }

    /* targets table */
    table.rc{ width:100%; border-collapse:collapse; }
    table.rc thead th{ font-size:8px; text-transform:uppercase; letter-spacing:.18em; font-weight:500; color:var(--muted-fg); text-align:left; padding:0 0 6px; }
    table.rc thead th.r{ text-align:right; }
    table.rc tbody td{ border-top:1px solid var(--border); padding:9px 0; font-size:11px; vertical-align:middle; }
    table.rc td.no{ font-family:var(--mono); font-size:9px; color:var(--muted-fg); width:28px; }
    table.rc td.area{ font-weight:500; }
    table.rc td.tgt{ font-family:var(--mono); text-align:right; color:var(--muted-fg); width:64px; }
    table.rc td.ach{ font-family:var(--mono); text-align:right; font-weight:600; width:64px; }
    table.rc td.bar{ padding-left:24px; width:34%; }
    .pbar{ display:flex; align-items:center; gap:12px; }
    .pbar .track{ height:7px; flex:1; background:var(--muted); }
    .pbar .fill{ height:100%; }
    .pbar .pval{ font-family:var(--mono); width:44px; text-align:right; font-size:10px; font-weight:600; }
    table.rc td.grade{ text-align:right; width:44px; }
    .gbox{ display:inline-grid; place-items:center; width:20px; height:20px; border:1px solid; font-family:var(--mono); font-size:10px; font-weight:700; }

    /* key highlights */
    ul.hls{ list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:10px 24px; }
    ul.hls li{ display:flex; gap:10px; font-size:11px; line-height:1.4; }
    ul.hls li .sq{ margin-top:6px; width:6px; height:6px; background:var(--primary); flex:none; }
    ul.hls li b{ color:var(--primary-deep); }

    /* footer */
    .foot{ margin-top:auto; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding:12px 16mm; font-size:8px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted-fg); }

    /* ---- PAGE 2 ---- */
    .conthead{ display:flex; align-items:center; justify-content:space-between; border-bottom:4px solid var(--primary); padding:20px 16mm; }
    .conthead .ce{ font-size:9px; letter-spacing:.3em; color:var(--muted-fg); }
    .conthead .ct{ font-size:15px; font-weight:600; color:var(--primary); letter-spacing:-.01em; margin-top:2px; }
    .conthead .cm{ text-align:right; font-size:9px; text-transform:uppercase; letter-spacing:.18em; color:var(--muted-fg); line-height:1.5; }

    table.act{ width:100%; border-collapse:collapse; }
    table.act thead th{ font-size:8px; text-transform:uppercase; letter-spacing:.18em; font-weight:500; color:var(--muted-fg); text-align:left; padding:0 8px 6px 0; }
    table.act thead th.r{ text-align:right; }
    table.act tbody td{ border-top:1px solid var(--border); padding:10px 8px 10px 0; font-size:10.5px; vertical-align:top; }
    table.act td.no{ font-family:var(--mono); font-size:9px; color:var(--muted-fg); width:28px; }
    table.act td.aa{ font-weight:600; color:var(--primary-deep); width:26%; }
    table.act td.ind{ color:var(--muted-fg); line-height:1.45; }
    table.act td.ach{ font-family:var(--mono); text-align:right; font-weight:600; width:15%; }
    table.act td.perf{ width:18%; padding-left:12px; }
    .perf-pill{ display:inline-flex; align-items:center; gap:6px; font-size:8.5px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; white-space:nowrap; }
    .perf-pill .dot{ width:6px; height:6px; border-radius:50%; }

    .p2grid{ margin-top:34px; display:grid; grid-template-columns:1.4fr 1fr; gap:32px; }
    .scalegrid{ display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:var(--border); }
    .scalecell{ background:var(--card); padding:12px 6px; text-align:center; }
    .scalecell .g{ font-family:var(--mono); font-size:20px; font-weight:700; color:var(--primary); line-height:1; }
    .scalecell .l{ margin-top:6px; font-size:8px; font-weight:500; line-height:1.15; }
    .scalecell .r{ font-family:var(--mono); margin-top:4px; font-size:8.5px; color:var(--muted-fg); }
    .scalenote{ margin-top:12px; font-size:9.5px; line-height:1.55; color:var(--muted-fg); }
    .verif{ border-left:2px solid var(--primary); background:var(--primary-tint); padding:16px 20px; }
    .verif .vk{ font-size:8px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted-fg); }
    .verif p{ margin:8px 0 0; font-size:10px; line-height:1.5; color:var(--primary-deep); }
    .signoff{ margin-top:40px; display:grid; grid-template-columns:1fr 1fr; gap:40px; }
    .sign .sline{ height:40px; border-bottom:1px solid var(--rule); }
    .sign .slbl{ margin-top:8px; display:flex; justify-content:space-between; font-size:8px; text-transform:uppercase; letter-spacing:.18em; color:var(--muted-fg); }

    .loading{ text-align:center; color:var(--muted-fg); padding:80px 0; font-size:13px; }
    .cardsheet{ width:210mm; min-height:297mm; background:var(--pf); margin:0 auto 28px; box-shadow:0 1px 2px rgba(0,0,0,.08), 0 24px 48px -24px rgba(0,0,0,.25); display:flex; align-items:center; justify-content:center; }

    @media print{
      @page{ size:A4; margin:8mm; }
      html,body{ background:#fff; }
      .toolbar, .note, .shg-nav, .shg-nav-open, .no-print{ display:none !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .sheet,.cardsheet{ box-shadow:none !important; margin:0 !important; width:100% !important; min-height:0 !important; page-break-after:always; break-after:page; }
      .sheet:last-of-type,.cardsheet:last-of-type{ page-break-after:auto; break-after:auto; }
      .mast,.metastrip,.body,.foot,.conthead{ padding-left:10mm; padding-right:10mm; }
      *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <div class="fld"><label>Cluster</label><select id="cluster">${clusterOptions('iganga')}</select></div>
    <div class="fld grow">
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
    <button class="btn" id="printBtn"><i class="fas fa-print"></i> Print / PDF</button>
  </div>

  <div id="noteBox"><div class="note"><i class="fas fa-circle-info"></i> Facilitator names are auto-cleaned (spacing/punctuation). If the same person still appears under two spellings, tick <b>both</b> to merge them into one report card.</div></div>
  <div id="report"><div class="cardsheet"><div class="loading">Select a cluster and a field staff (CF), then click <b>Generate</b>.</div></div></div>

  ${navSidebar('cfreport')}

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
function compact(n){ n=Number(n)||0; if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M'; if(n>=1e3) return (n/1e3).toFixed(0)+'K'; return fmt(n); }
function db(female, pwd){ return fmt(female)+' female · '+fmt(pwd)+' PWD'; }
function prettyDate(s){ if(!s) return ''; const d=new Date(s+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function daysBetween(a,b){ if(!a||!b) return null; const d1=new Date(a), d2=new Date(b); return Math.round((d2-d1)/86400000)+1; }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Royal-blue grading ramp (Everton): A/B good green, C/D warn amber, E bad red.
function gradeFor(p){
  if(p>=80) return {g:'A',lbl:'Excellent',c:'#1f8a4c',bg:'#eaf6ef'};
  if(p>=60) return {g:'B',lbl:'Very Good',c:'#1f8a4c',bg:'#eaf6ef'};
  if(p>=40) return {g:'C',lbl:'Good',c:'#c07d12',bg:'#fbf2e3'};
  if(p>=20) return {g:'D',lbl:'Fair',c:'#c07d12',bg:'#fbf2e3'};
  return {g:'E',lbl:'Needs Improvement',c:'#c62f2f',bg:'#fbe9e9'};
}
// activity-detail performance category from a grade letter
function perfFor(g){
  if(g==='A'||g==='B') return {lbl:'Excellent', c:'#1f8a4c'};
  if(g==='C'||g==='D') return {lbl:'Fair', c:'#c07d12'};
  return {lbl:'Needs Improvement', c:'#c62f2f'};
}

// -------- Multi-select facilitator picker --------
let STAFF=[];                 // [{key,name,activities}]
const CHOSEN=new Map();       // key -> name

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

// =============== BUILD THE 2-PAGE REPORT CARD ===============
function buildCard(d, clusterLabel, from, to){
  const prof=d.profiling||{}, tr=d.training||{}, dist=d.distribution||{}, prod=d.production||{}, hs=d.hort_sales||{}, ps=d.poultry||{}, isla=d.isla||{}, lev=d.leverage||{};
  const yiw=d.youthInWork||{};
  const name=d.staff_name||'—';
  const days=daysBetween(from,to);
  const period = (from&&to) ? (prettyDate(from)+' – '+prettyDate(to)) : 'All available data';
  const genDate=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  // Snapshot totals
  const totalBeneficiaries = (Number(prof.youth_profiled)||0);
  const totalShgs = (Number(tr.groups_trained)||0);
  const valueMobilized = (Number(isla.savings)||0)+(Number(hs.hs_value)||0)+(Number(ps.ps_value)||0)+(Number(lev.lev_amount)||0);
  const areaVals=[prof.shgs_profiled, tr.youth_trained, dist.dist_birds, prod.prod_youth, hs.hs_youth, ps.birds_sold, isla.isla_shgs, lev.lev_count];
  const totalActivities = areaVals.filter(x=>(Number(x)||0)>0).length;

  // -------- TARGETS vs ACHIEVED --------
  const T=d.targets||{shgs_profiled:16,youth:400,female_pct:70,pwd_pct:3,shgs_saving:16,youth_production:400,groups_trained:16};
  const femalePct = (Number(prof.youth_profiled)||0)>0 ? Math.round(100*(Number(prof.female)||0)/(Number(prof.youth_profiled)||1)) : 0;
  const pwdPct    = (Number(prof.youth_profiled)||0)>0 ? Math.round(100*(Number(prof.pwd)||0)/(Number(prof.youth_profiled)||1)) : 0;
  const targetRows=[
    {label:'SHGs Profiled', ach:Number(prof.shgs_profiled)||0, tgt:Number(T.shgs_profiled)||16},
    {label:'Youth Mobilized', ach:Number(prof.youth_profiled)||0, tgt:Number(T.youth)||400},
    {label:'Female Share', ach:femalePct, tgt:Number(T.female_pct)||70, isPct:true},
    {label:'PWD Share', ach:pwdPct, tgt:Number(T.pwd_pct)||3, isPct:true},
    {label:'SHGs Saving (ISLA)', ach:Number(isla.isla_shgs)||0, tgt:Number(T.shgs_saving)||16},
    {label:'Youth into Production', ach:Number(prod.prod_youth)||0, tgt:Number(T.youth_production)||400},
    {label:'Groups Trained', ach:Number(tr.groups_trained)||0, tgt:Number(T.groups_trained)||16},
    {label:'Youth in Work', ach:Number(yiw.employedYouth)||0, tgt:Number(yiw.yiwTarget)||0}
  ].map(r=>{ r.pct = r.tgt>0 ? Math.round(100*r.ach/r.tgt) : 0; r.grade=gradeFor(Math.min(100,r.pct)); return r; });

  const overall = Math.round(targetRows.reduce((a,r)=>a+Math.min(100,r.pct),0)/targetRows.length);
  const og = gradeFor(overall);

  const targetTable = targetRows.map((r,i)=>{
    const barPct=Math.min(100,r.pct);
    return '<tr>'+
      '<td class="no">'+String(i+1).padStart(2,'0')+'</td>'+
      '<td class="area">'+esc(r.label)+'</td>'+
      '<td class="tgt">'+fmt(r.tgt)+(r.isPct?'%':'')+'</td>'+
      '<td class="ach">'+fmt(r.ach)+(r.isPct?'%':'')+'</td>'+
      '<td class="bar"><div class="pbar"><div class="track"><div class="fill" style="width:'+barPct+'%;background:var(--primary)"></div></div><span class="pval" style="color:var(--primary-deep)">'+r.pct+'%</span></div></td>'+
      '<td class="grade"><span class="gbox" style="color:'+r.grade.c+';border-color:'+r.grade.c+'">'+r.grade.g+'</span></td>'+
    '</tr>';
  }).join('');

  // -------- ACTIVITY DETAIL (page 2) --------
  function tgtGrade(ach,tgt){ return gradeFor(tgt>0?Math.min(100,100*(Number(ach)||0)/tgt):0); }
  function presenceGrade(v){ return (Number(v)||0)>0 ? gradeFor(100) : gradeFor(0); }
  const acts=[
    {area:'Trainings (first trainings)', ind:fmt(tr.groups_trained)+' groups trained across '+fmt(tr.training_areas)+' areas', ach:fmt(tr.youth_trained)+' youth', gr:tgtGrade(tr.groups_trained, T.groups_trained)},
    {area:'Distribution to Participants (birds)', ind:fmt(dist.dist_birds)+' youth received birds', ach:esc(dist.items||'—'), gr:presenceGrade(dist.dist_birds)},
    {area:'SHG Profiling', ind:fmt(prof.youth_profiled)+' youth ('+db(prof.female, prof.pwd)+') · '+fmt(prof.shgs_below_25)+' SHGs &lt;25 · '+fmt(prof.shgs_25_plus)+' SHGs ≥25', ach:fmt(prof.shgs_profiled)+' SHGs', gr:tgtGrade(prof.shgs_profiled, T.shgs_profiled)},
    {area:'ISLA Savings & Loans', ind:ugx(isla.savings)+' saved by '+fmt(isla.youth_savers)+' youth · '+ugx(isla.loans_value)+' loans · '+fmt(isla.youth_loans)+' youth got loans', ach:fmt(isla.isla_shgs)+' SHGs', gr:tgtGrade(isla.isla_shgs, T.shgs_saving)},
    {area:'Youth into Production', ind:fmt(prod.prod_shgs)+' SHGs · '+db(prod.female, prod.pwd)+' · '+fmt(prod.prod_youth_hort)+' horticulture + '+fmt(prod.prod_youth_birds)+' birds', ach:fmt(prod.prod_youth)+' youth', gr:tgtGrade(prod.prod_youth, T.youth_production)},
    {area:'Sales (Horticulture)', ind:fmt(hs.hs_youth)+' youth sellers ('+db(hs.female, hs.pwd)+') · horticulture + oil seeds', ach:ugx(hs.hs_value), gr:presenceGrade(hs.hs_value)},
    {area:'Sales (Poultry)', ind:fmt(ps.ps_youth)+' youth ('+db(ps.female, ps.pwd)+') · '+ugx(ps.ps_value), ach:fmt(ps.birds_sold)+' birds', gr:presenceGrade(ps.birds_sold)},
    {area:'Local Leverage', ind:fmt(lev.lev_count)+' contributions', ach:ugx(lev.lev_amount), gr:presenceGrade(lev.lev_count)},
    {area:'Youth in Work', ind:'Of '+fmt(prof.youth_profiled)+' mobilized, '+fmt(yiw.employedYouth)+' in work · '+fmt(yiw.selfEmployed)+' self-employed · '+fmt(yiw.wageEmployed)+' wage-employed · '+ugx(yiw.totalIncome)+' income', ach:fmt(yiw.employedYouth)+' in work', gr:tgtGrade(yiw.employedYouth, yiw.yiwTarget)}
  ];
  const actTable = acts.map((a,i)=>{
    const pf=perfFor(a.gr.g);
    return '<tr>'+
      '<td class="no">'+String(i+1).padStart(2,'0')+'</td>'+
      '<td class="aa">'+esc(a.area)+'</td>'+
      '<td class="ind">'+a.ind+'</td>'+
      '<td class="ach">'+a.ach+'</td>'+
      '<td class="perf"><span class="perf-pill" style="color:'+pf.c+'"><span class="dot" style="background:'+pf.c+'"></span>'+pf.lbl+'</span></td>'+
    '</tr>';
  }).join('');

  // -------- KEY HIGHLIGHTS (dynamic) --------
  const hls=[];
  if((Number(lev.lev_amount)||0)>0) hls.push('Mobilized <b>'+ugx(lev.lev_amount)+'</b> in local leverage across '+fmt(lev.lev_count)+' contributions.');
  if((Number(isla.savings)||0)>0) hls.push('ISLA groups saved <b>'+ugx(isla.savings)+'</b>'+((Number(isla.loans_value)||0)>0?('; '+ugx(isla.loans_value)+' in loans disbursed'):'; no loans disbursed in the period')+'.');
  if((Number(prof.shgs_profiled)||0)>0) hls.push('Profiled <b>'+fmt(prof.shgs_profiled)+' SHGs</b> ('+fmt(prof.shgs_below_25)+' with &lt;25 members, '+fmt(prof.shgs_25_plus)+' with ≥25) reaching '+fmt(prof.youth_profiled)+' youth — '+db(prof.female, prof.pwd)+'.');
  if((Number(yiw.employedYouth)||0)>0) hls.push('<b>'+fmt(yiw.employedYouth)+'</b> of the '+fmt(prof.youth_profiled)+' youth mobilized are now in work'+((Number(yiw.yiwTarget)||0)>0?(' — '+Math.round(100*(Number(yiw.employedYouth)||0)/(Number(yiw.yiwTarget)||1))+'% of the Youth-in-Work target'):'')+'.');
  if((Number(ps.ps_value)||0)>0) hls.push('Poultry sales generated <b>'+ugx(ps.ps_value)+'</b> from '+fmt(ps.birds_sold)+' birds.');
  if((Number(prod.prod_youth)||0)>0) hls.push('Engaged <b>'+fmt(prod.prod_youth)+' youth</b> in production ('+db(prod.female, prod.pwd)+').');
  if(!hls.length) hls.push('No recorded activity for this facilitator in the selected period.');

  const SCALE=[['A','Excellent','80–100%'],['B','Very Good','60–79%'],['C','Good','40–59%'],['D','Fair','20–39%'],['E','Needs Improvement','0–19%']];

  // ===================== PAGE 1 =====================
  let html='<section class="sheet">'+
    '<header class="mast">'+
      '<div class="brand"><div class="mark"><span>SAYE</span></div>'+
        '<div><div class="bn">SAYE UGANDA</div><div class="bt">MONITORING · EVALUATION · LEARNING</div></div></div>'+
      '<div class="mastrow">'+
        '<div><div class="eyebrow">COMMUNITY FACILITATOR</div><h1>Performance<br/>Report Card</h1></div>'+
        '<div class="ovbox"><div class="ol">OVERALL</div>'+
          '<div class="ov">'+overall+'<sup>%</sup></div>'+
          '<div class="og">GRADE '+og.g+' · '+og.lbl.toUpperCase()+'</div></div>'+
      '</div>'+
    '</header>'+
    '<div class="metastrip">'+
      '<div class="cell"><div class="k">Field staff (CF)</div><div class="v">'+esc(name)+'</div></div>'+
      '<div class="cell"><div class="k">Cluster</div><div class="v">'+esc(clusterLabel)+'</div></div>'+
      '<div class="cell"><div class="k">Report period</div><div class="v">'+esc(period)+'</div></div>'+
      '<div class="cell"><div class="k">Generated</div><div class="v">'+esc(genDate)+'</div></div>'+
    '</div>'+
    '<div class="body">'+
      '<div class="secthead"><span class="no">01</span><h2>Snapshot</h2><span class="rng">Days in period '+(days!=null?days:'—')+'</span></div>'+
      '<div class="snap">'+
        '<div class="st"><div class="v">'+totalActivities+'</div><div class="l">Activity areas</div></div>'+
        '<div class="st"><div class="v">'+fmt(totalBeneficiaries)+'</div><div class="l">Youth reached</div></div>'+
        '<div class="st"><div class="v">'+fmt(totalShgs)+'</div><div class="l">SHGs reached</div></div>'+
        '<div class="st"><div class="v"><span class="u">UGX</span>'+compact(valueMobilized)+'</div><div class="l">Value mobilized</div></div>'+
      '</div>'+
      '<div class="sect">'+
        '<div class="secthead"><span class="no">02</span><h2>Targets vs Achieved</h2>'+
          '<span class="rng">Standard: 16 SHGs · 400 youth · 70% female · 3% PWD · 16 saving · 400 in production · 16 trained</span></div>'+
        '<table class="rc"><thead><tr><th>#</th><th>Target area</th><th class="r">Target</th><th class="r">Achieved</th><th style="padding-left:24px">% Achieved</th><th class="r">Grade</th></tr></thead>'+
        '<tbody>'+targetTable+'</tbody></table>'+
      '</div>'+
      '<div class="sect">'+
        '<div class="secthead"><span class="no">03</span><h2>Key Highlights</h2></div>'+
        '<ul class="hls">'+hls.map(h=>'<li><span class="sq"></span><span>'+h+'</span></li>').join('')+'</ul>'+
      '</div>'+
    '</div>'+
    '<footer class="foot"><span>SAYE Uganda · MEL</span><span>CF Report Card · '+esc(name)+'</span><span class="num">Page 1 / 2</span></footer>'+
  '</section>';

  // ===================== PAGE 2 =====================
  html+='<section class="sheet">'+
    '<div class="conthead">'+
      '<div><div class="ce">SAYE UGANDA · MEL</div><div class="ct">Activity Detail &amp; Grading</div></div>'+
      '<div class="cm">'+esc(name)+'<br/>'+esc(clusterLabel)+'</div>'+
    '</div>'+
    '<div class="body">'+
      '<div class="secthead"><span class="no">04</span><h2>Activity Detail</h2><span class="rng">'+acts.length+' activity areas</span></div>'+
      '<table class="act"><thead><tr><th>#</th><th>Activity area</th><th>Indicator</th><th class="r">Achieved</th><th style="padding-left:12px">Performance</th></tr></thead>'+
      '<tbody>'+actTable+'</tbody></table>'+
      '<div class="p2grid">'+
        '<div>'+
          '<div class="secthead"><span class="no">05</span><h2>Grading Scale</h2></div>'+
          '<div class="scalegrid">'+SCALE.map(s=>'<div class="scalecell"><div class="g">'+s[0]+'</div><div class="l">'+s[1]+'</div><div class="r">'+s[2]+'</div></div>').join('')+'</div>'+
          '<p class="scalenote">Grades are computed against the per-field-staff standard. Overall score is the mean of the eight target areas, capped at 100% per area.</p>'+
        '</div>'+
        '<div><div class="secthead" style="visibility:hidden"><span class="no">·</span><h2>·</h2></div>'+
          '<div class="verif"><div class="vk">Verification</div>'+
          '<p>Data verified by SAYE Uganda M&amp;E on '+esc(genDate)+'. Figures cover '+esc(period.toLowerCase())+'.</p></div>'+
        '</div>'+
      '</div>'+
      '<div class="signoff">'+
        '<div class="sign"><div class="sline"></div><div class="slbl"><span>Field staff (CF)</span><span>Date</span></div></div>'+
        '<div class="sign"><div class="sline"></div><div class="slbl"><span>Supervisor</span><span>Date</span></div></div>'+
      '</div>'+
    '</div>'+
    '<footer class="foot"><span>SAYE Uganda · MEL</span><span>M&amp;E Verified · '+esc(genDate)+'</span><span class="num">Page 2 / 2</span></footer>'+
  '</section>';

  return html;
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
  qs.set('staff', keys.join('|'));
  if(districts.length) qs.set('districts', districts.join(','));
  if(from) qs.set('from', from);
  if(to) qs.set('to', to);
  try{
    const yqs=new URLSearchParams();
    yqs.set('staff', keys.join('|'));
    if(districts.length) yqs.set('districts', districts.join(','));
    if(from) yqs.set('from', from);
    if(to) yqs.set('to', to);
    const [res, yres]=await Promise.all([
      fetch('/api/cf-report?'+qs.toString()),
      fetch('/api/youth-in-work?'+yqs.toString()).catch(()=>null)
    ]);
    const d=await res.json();
    try{ if(yres && yres.ok){ const yd=await yres.json();
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
document.getElementById('staffList').addEventListener('change', (e)=>{
  const cb=e.target.closest('input[type=checkbox]'); if(!cb) return;
  const k=cb.getAttribute('data-key'), n=cb.getAttribute('data-name');
  if(cb.checked) CHOSEN.set(k,n); else CHOSEN.delete(k);
  renderChosen();
});
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
