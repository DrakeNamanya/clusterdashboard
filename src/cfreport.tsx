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
  <style>
    :root{
      --green:#0F4C3A; --green-2:#00A859; --lgreen:#e9f5ee; --ink:#25352c;
      --muted:#7f8c85; --line:#e2e9e4; --amber:#F6921E; --blue:#2E9BD6;
      --band:#0f5132; --cream:#fbf6e3; --purple:#7c5cbf; --red:#c0392b; --teal:#1f9e94; --yellow:#e6b400;
    }
    body{ background:#eef3f0; color:var(--ink); font-family:"Segoe UI",Calibri,Arial,system-ui,sans-serif; margin:0; }
    .wrap{ max-width:1080px; margin:0 auto; padding:22px 20px 60px; }
    .filters{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:18px; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:700; }
    .fld select, .fld input{ border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; background:#fff; min-width:160px; }
    .btn{ background:var(--green); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; }
    .btn:hover{ background:var(--green-2); }
    .btn.ghost{ background:#fff; color:var(--green); border:1px solid var(--line); }

    /* Multi-select facilitator picker */
    .staffbox{ border:1px solid var(--line); border-radius:8px; background:#fff; padding:6px; width:340px; max-width:100%; }
    .staffbox #staffSearch{ border:1px solid var(--line); border-radius:6px; padding:6px 8px; font-size:13px; width:100%; box-sizing:border-box; margin-bottom:6px; }
    .stafflist{ max-height:190px; overflow-y:auto; border-top:1px solid #f0f3f1; }
    .stafflist label{ display:flex; align-items:center; gap:8px; padding:5px 6px; font-size:12.5px; border-radius:6px; cursor:pointer; text-transform:none; letter-spacing:0; color:var(--ink); font-weight:500; }
    .stafflist label:hover{ background:var(--lgreen); }
    .stafflist input[type=checkbox]{ min-width:auto; accent-color:var(--green-2); }
    .stafflist .cnt{ margin-left:auto; color:var(--muted); font-size:11px; }
    .staffloading,.staffempty{ color:var(--muted); font-size:12px; padding:10px 6px; text-align:center; }
    .staffchosen{ display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
    .chip{ background:var(--green); color:#fff; font-size:11px; font-weight:700; padding:3px 8px; border-radius:14px; display:inline-flex; align-items:center; gap:6px; }
    .chip i{ cursor:pointer; opacity:.85; }
    .chip i:hover{ opacity:1; }

    .cardsheet{ background:#fff; border:1px solid var(--line); border-radius:16px; box-shadow:0 4px 18px rgba(30,50,40,.08); overflow:hidden; }
    .chead{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 26px; border-bottom:3px solid var(--green-2); }
    .chead .logo{ width:46px; height:46px; border-radius:12px; background:var(--green); color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; }
    .chead .mid{ flex:1; text-align:center; }
    .chead .mid .t{ font-size:19px; font-weight:800; color:var(--green); letter-spacing:.01em; }
    .chead .mid .s{ font-size:12px; color:var(--green-2); font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
    .chead .meta{ font-size:11px; color:var(--muted); text-align:right; line-height:1.6; }
    .chead .meta b{ color:var(--ink); }

    .idrow{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:18px 26px; }
    @media(max-width:820px){ .idrow{ grid-template-columns:repeat(2,1fr); } }
    .idcard{ border:1px solid #cfe6d8; background:#f6fbf8; border-radius:12px; padding:12px 14px; display:flex; gap:11px; align-items:center; }
    .idcard .ic{ width:34px; height:34px; border-radius:9px; background:var(--green); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; }
    .idcard .lb{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:700; }
    .idcard .vl{ font-size:14px; font-weight:800; color:var(--ink); }

    .kpis{ display:grid; grid-template-columns:repeat(5,1fr); gap:12px; padding:0 26px 18px; }
    @media(max-width:900px){ .kpis{ grid-template-columns:repeat(2,1fr); } }
    .kpi{ border:1px solid var(--line); border-radius:12px; padding:14px; text-align:center; }
    .kpi .ic{ font-size:16px; color:var(--green-2); }
    .kpi .v{ font-size:22px; font-weight:800; color:var(--ink); margin-top:6px; line-height:1; }
    .kpi .l{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; margin-top:5px; }

    .tblwrap{ padding:0 26px 18px; }
    table.act{ border-collapse:collapse; width:100%; }
    table.act thead th{ background:var(--green); color:#fff; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; padding:10px 12px; text-align:left; }
    table.act thead th.num{ text-align:right; }
    table.act tbody td{ padding:11px 12px; font-size:13px; border-bottom:1px solid #eef2ef; vertical-align:top; }
    table.act tbody td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    .areahead{ display:flex; align-items:center; gap:9px; }
    .areahead .ic{ width:28px; height:28px; border-radius:7px; color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; flex:0 0 auto; }
    .areahead .nm{ font-weight:800; }
    .ind{ color:var(--muted); font-size:12px; }
    .grade{ display:inline-block; padding:2px 9px; border-radius:20px; font-size:11px; font-weight:800; }

    .btm{ display:grid; grid-template-columns:1.4fr 1fr; gap:16px; padding:0 26px 24px; }
    @media(max-width:820px){ .btm{ grid-template-columns:1fr; } }
    .panel{ border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
    .panel h3{ margin:0 0 10px; font-size:14px; font-weight:800; color:var(--green); display:flex; align-items:center; gap:8px; }
    .hl{ display:flex; gap:9px; font-size:13px; margin-bottom:9px; line-height:1.5; }
    .hl i{ color:var(--green-2); margin-top:3px; }
    .gaugewrap{ display:flex; align-items:center; gap:18px; }
    .gradetbl{ width:100%; border-collapse:collapse; }
    .gradetbl td{ padding:4px 6px; font-size:11.5px; border-bottom:1px solid #f0f3f1; }
    .gradetbl td.g{ font-weight:800; width:26px; }

    .loading{ text-align:center; color:var(--muted); padding:40px; font-size:14px; }
    .note{ background:#fff8e6; border:1px solid #f0e2b6; color:#7a6414; font-size:12px; padding:8px 12px; border-radius:8px; margin-bottom:16px; }

    /* section titles */
    .secttl{ font-size:13px; font-weight:800; color:var(--green); display:flex; align-items:center; gap:8px; margin:6px 0 10px; flex-wrap:wrap; }
    .secttl .secsub{ font-weight:600; color:var(--muted); font-size:11px; }
    /* progress bar in targets table */
    table.act.tgt thead th{ background:var(--band); }
    .pbar{ display:inline-block; width:88px; height:8px; border-radius:6px; background:#eef2ef; vertical-align:middle; overflow:hidden; }
    .pbar-f{ height:100%; border-radius:6px; }
    .pval{ font-size:11.5px; font-weight:800; margin-left:8px; font-variant-numeric:tabular-nums; }

    /* sign-off + MEL stamp */
    .signoff{ display:flex; align-items:flex-end; gap:34px; padding:10px 26px 26px; position:relative; }
    .sign{ flex:1; max-width:220px; }
    .sign .sline{ border-bottom:1.5px solid #9aa8a0; height:34px; }
    .sign .slbl{ font-size:11px; color:var(--muted); font-weight:700; margin-top:5px; text-transform:uppercase; letter-spacing:.04em; }
    .stamp{ margin-left:auto; }
    .stamp-inner{ width:150px; height:150px; border-radius:50%; border:3px solid #c0392b; color:#c0392b; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; transform:rotate(-11deg); opacity:.86; box-shadow:inset 0 0 0 2px #c0392b33; }
    .stamp-top{ font-size:12px; font-weight:900; letter-spacing:.08em; }
    .stamp-mid{ font-size:16px; font-weight:900; margin:3px 0; border-top:2px solid #c0392b; border-bottom:2px solid #c0392b; padding:3px 0; width:82%; }
    .stamp-dt{ font-size:12px; font-weight:800; margin:3px 0; }
    .stamp-bot{ font-size:7.5px; font-weight:800; letter-spacing:.03em; width:88%; }

    /* PRINT — colored PDF via browser Print → Save as PDF (aligned) */
    @media print{
      @page{ size:A4; margin:12mm; }
      html,body{ background:#fff !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .shg-nav,.shg-nav-open,.filters,#noteBox,.no-print{ display:none !important; }
      .wrap{ max-width:100% !important; margin:0 !important; padding:0 4mm !important; }
      .cardsheet{ box-shadow:none; border:1px solid #ccc; page-break-inside:avoid; }
      table.act thead th{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>
${navSidebar('cfreport')}
  <div class="wrap">
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
function prettyDate(s){ if(!s) return ''; const d=new Date(s+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function daysBetween(a,b){ if(!a||!b) return null; const d1=new Date(a), d2=new Date(b); return Math.round((d2-d1)/86400000)+1; }
function gradeFor(p){
  if(p>=80) return {g:'A',lbl:'Excellent',c:'#1a7a3d',bg:'#e5f4ea'};
  if(p>=60) return {g:'B',lbl:'Very Good',c:'#2E9BD6',bg:'#e3f1fb'};
  if(p>=40) return {g:'C',lbl:'Good',c:'#b46e0a',bg:'#fdf1dd'};
  if(p>=20) return {g:'D',lbl:'Fair',c:'#c9791b',bg:'#fdf1dd'};
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
  const name=d.staff_name||'—';
  const days=daysBetween(from,to);
  const period = (from&&to) ? (prettyDate(from)+' – '+prettyDate(to)) : 'All available data';

  // Totals for KPI tiles
  const totalBeneficiaries = (Number(prof.youth_profiled)||0);
  const totalShgs = (Number(prof.shgs_profiled)||0)+(Number(prod.prod_shgs)||0)+(Number(isla.isla_shgs)||0);
  const valueMobilized = (Number(isla.savings)||0)+(Number(hs.hs_value)||0)+(Number(ps.ps_value)||0)+(Number(lev.lev_amount)||0);
  const areaVals=[prof.shgs_profiled, tr.youth_trained, dist.dist_lines, prod.prod_youth, hs.hs_youth, ps.birds_sold, isla.isla_shgs, lev.lev_count];
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
    {ic:'fa-seedling', c:'var(--green)', label:'Youth into Production', ach:Number(prod.prod_youth)||0, tgt:Number(T.youth_production)||400, unit:'youth'},
    {ic:'fa-chalkboard-user', c:'var(--green-2)', label:'Groups Trained', ach:Number(tr.groups_trained)||0, tgt:Number(T.groups_trained)||16, unit:'groups'}
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
  rows += actRow(1,'var(--blue)','fa-chalkboard-user','Trainings by Frontliners', fmt(tr.groups_trained)+' groups trained across '+fmt(tr.training_areas)+' areas', fmt(tr.youth_trained)+' youth', tgtGrade(tr.groups_trained, T.groups_trained));
  rows += actRow(2,'var(--green-2)','fa-box-open','Distribution to Participants', fmt(dist.dist_participants)+' participants', fmt(dist.dist_lines)+' lines', presenceGrade(dist.dist_lines));
  rows += actRow(3,'var(--amber)','fa-users','SHG Profiling', fmt(prof.youth_profiled)+' youth ('+femalePct+'% F / '+pwdPct+'% PWD)', fmt(prof.shgs_profiled)+' SHGs', tgtGrade(prof.shgs_profiled, T.shgs_profiled));
  rows += actRow(4,'var(--purple)','fa-piggy-bank','ISLA Savings & Loans', ugx(isla.savings)+' saved · '+ugx(isla.loans_value)+' loans given · '+fmt(isla.youth_loans)+' youth got loans', fmt(isla.isla_shgs)+' SHGs', tgtGrade(isla.isla_shgs, T.shgs_saving));
  rows += actRow(5,'var(--green)','fa-seedling','Youth into Production', fmt(prod.prod_shgs)+' SHGs · horticulture + livestock recipients', fmt(prod.prod_youth)+' youth', tgtGrade(prod.prod_youth, T.youth_production));
  rows += actRow(6,'var(--red)','fa-basket-shopping','Sales (Horticulture)', fmt(hs.hs_youth)+' youth sellers', ugx(hs.hs_value), presenceGrade(hs.hs_value));
  rows += actRow(7,'var(--yellow)','fa-egg','Sales (Poultry)', fmt(ps.ps_youth)+' youth · '+ugx(ps.ps_value), fmt(ps.birds_sold)+' birds', presenceGrade(ps.birds_sold));
  rows += actRow(8,'var(--teal)','fa-handshake','Local Leverage', fmt(lev.lev_count)+' contributions', ugx(lev.lev_amount), presenceGrade(lev.lev_count));

  // Key highlights (dynamic)
  const hls=[];
  if((Number(ps.ps_value)||0)>0) hls.push('Poultry sales generated <b>'+ugx(ps.ps_value)+'</b> from '+fmt(ps.birds_sold)+' birds.');
  if((Number(lev.lev_amount)||0)>0) hls.push('Mobilized <b>'+ugx(lev.lev_amount)+'</b> in local leverage across '+fmt(lev.lev_count)+' contributions.');
  if((Number(isla.savings)||0)>0) hls.push('Strong ISLA performance: <b>'+ugx(isla.savings)+'</b> saved and <b>'+ugx(isla.loans_value)+'</b> in loans given.');
  if((Number(prof.shgs_profiled)||0)>0) hls.push('Profiled <b>'+fmt(prof.shgs_profiled)+' SHGs</b> reaching '+fmt(prof.youth_profiled)+' youth.');
  if((Number(prod.prod_youth)||0)>0) hls.push('Engaged <b>'+fmt(prod.prod_youth)+' youth</b> in production.');
  if(!hls.length) hls.push('No recorded activity for this facilitator in the selected period.');

  const gradeTbl = [
    ['A','Excellent','80% - 100%','#1a7a3d'],['B','Very Good','60% - 79%','#2E9BD6'],
    ['C','Good','40% - 59%','#b46e0a'],['D','Fair','20% - 39%','#c9791b'],['E','Needs Improvement','0% - 19%','#c0392b']
  ].map(r=>'<tr><td class="g" style="color:'+r[3]+'">'+r[0]+'</td><td>'+r[1]+'</td><td style="text-align:right;color:var(--muted)">'+r[2]+'</td></tr>').join('');

  const circ=2*Math.PI*46; const off=circ*(1-overall/100);

  return '<div class="cardsheet">'+
    '<div class="chead">'+
      '<div class="logo"><i class="fas fa-people-group"></i></div>'+
      '<div class="mid"><div class="t">COMMUNITY FACILITATOR REPORT CARD</div><div class="s">Performance Summary</div></div>'+
      '<div class="meta">Date Generated: <b>'+new Date().toLocaleString('en-GB')+'</b><br/>Report Period: <b>'+period+'</b></div>'+
    '</div>'+
    '<div class="idrow">'+
      '<div class="idcard"><span class="ic"><i class="fas fa-map-pin"></i></span><div><div class="lb">Cluster</div><div class="vl">'+clusterLabel+'</div></div></div>'+
      '<div class="idcard"><span class="ic"><i class="fas fa-user"></i></span><div><div class="lb">Field Staff (CF)</div><div class="vl">'+name+'</div></div></div>'+
      '<div class="idcard"><span class="ic"><i class="fas fa-calendar"></i></span><div><div class="lb">Report Period</div><div class="vl">'+period+'</div></div></div>'+
      '<div class="idcard"><span class="ic"><i class="fas fa-clock"></i></span><div><div class="lb">Days in Period</div><div class="vl">'+(days!=null?days+' Days':'—')+'</div></div></div>'+
    '</div>'+
    '<div class="kpis">'+
      '<div class="kpi"><div class="ic"><i class="fas fa-clipboard-list"></i></div><div class="v">'+totalActivities+'</div><div class="l">Activity Areas</div></div>'+
      '<div class="kpi"><div class="ic"><i class="fas fa-users"></i></div><div class="v">'+fmt(totalBeneficiaries)+'</div><div class="l">Youth Reached</div></div>'+
      '<div class="kpi"><div class="ic"><i class="fas fa-people-group"></i></div><div class="v">'+fmt(totalShgs)+'</div><div class="l">SHGs Reached</div></div>'+
      '<div class="kpi"><div class="ic"><i class="fas fa-sack-dollar"></i></div><div class="v">'+ugx(valueMobilized)+'</div><div class="l">Value Mobilized</div></div>'+
      '<div class="kpi"><div class="ic"><i class="fas fa-arrow-trend-up"></i></div><div class="v" style="color:'+og.c+'">'+overall+'%</div><div class="l">Overall</div></div>'+
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
          '<svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="46" fill="none" stroke="#eef2ef" stroke-width="12"/>'+
          '<circle cx="55" cy="55" r="46" fill="none" stroke="'+og.c+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+circ.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'" transform="rotate(-90 55 55)"/>'+
          '<text x="55" y="50" text-anchor="middle" font-size="26" font-weight="800" fill="'+og.c+'">'+og.g+'</text>'+
          '<text x="55" y="70" text-anchor="middle" font-size="13" font-weight="700" fill="#7f8c85">'+overall+'%</text></svg>'+
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
    const res=await fetch('/api/cf-report?'+qs.toString());
    const d=await res.json();
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
