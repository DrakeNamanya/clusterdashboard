import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// CF WORKPLAN & ADVANCE-PAYMENT REQUEST
//   Every CF submits, at each end of month, (1) an advance-payment request
//   letter and (2) a monthly workplan for the NEXT month. This tab produces a
//   customised, Word-typed-looking request + workplan per CF, and AUTO-INJECTS
//   "areas of improvement" activities that NAME the specific groups behind on
//   each programme target (computed from mel_cf_groups):
//      * groups not yet TRAINED           (all groups trained within 8 months)
//      * groups with < 25 members         (min 25 members / group)
//      * groups not SAVING/ISLA this month(all groups save every month)
//      * groups not in PRODUCTION         (400 youth into production /12 months)
//      * forming 16 groups within 6 months; leverage data every month.
//   The improvement list SHRINKS as months move on (fewer lagging groups).
//
//   Padlocked (admin only) — gated by navGate() at the route level.
//   Live data: /api/cf-workplan/{groups,save,list,get}, /api/cf-report/staff.
// ---------------------------------------------------------------------------

// The whole browser runtime lives here as a string so it ships verbatim inside
// the page (no bundler needed for the inline <script>). Uses only DOM + fetch.
const CLIENT_JS = String.raw`
const CLUSTER_DISTRICTS = {
  iganga:['IGANGA','JINJA','JINJA CITY','MAYUGE','LUUKA'],
  kamuli:['KAMULI','KALIRO','BUYENDE'],
  bugiri:['BUGIRI','NAMUTUMBA','NAMAYINGO','BUGWERI'],
  central:['MUKONO','BUIKWE','KAYUNGA']
};
const CLUSTER_LABEL = { iganga:'Iganga Cluster', kamuli:'Kamuli Cluster', bugiri:'Bugiri Cluster', central:'Central Cluster' };

// Programme targets / pace rules (from the SAYE brief):
//   16 groups formed within 6 months; all groups trained within 8 months;
//   400 youth into production within 12 months; min 25 members / group;
//   every group saves (ISLA) every month + collects leverage data monthly.
const TARGET_GROUPS = 16, TARGET_YOUTH = 400, MIN_MEMBERS = 25;
const MONTHS_FORM = 6, MONTHS_TRAIN = 8, MONTHS_PROD = 12;
// Shared programme start month (pace baseline). Configurable via the "Start"
// field; defaults to Jan 2026 (first cohort month). Persisted per browser.
const DEFAULT_START = '2026-01';

function fmt(n){ return (n==null||isNaN(n)) ? '0' : Math.round(Number(n)).toLocaleString(); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function monthName(mIdx){ return ['January','February','March','April','May','June','July','August','September','October','November','December'][mIdx]||''; }
function ordinal(n){ const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }
// months between two 'YYYY-MM' strings (b - a)
function monthDiff(a,b){ if(!a||!b) return 0; const [ay,am]=a.split('-').map(Number),[by,bm]=b.split('-').map(Number); return (by-ay)*12+(bm-am); }
// UGX in words (up to millions — enough for facilitation advances)
function ugxWords(n){
  n=Math.round(Number(n)||0); if(n===0) return 'Zero';
  const ones=['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  function u3(x){ let r=''; if(x>=100){ r+=ones[Math.floor(x/100)]+' hundred'; x%=100; if(x) r+=' '; } if(x>=20){ r+=tens[Math.floor(x/10)]; x%=10; if(x) r+='-'+ones[x]; } else if(x>0){ r+=ones[x]; } return r; }
  let out=''; const mil=Math.floor(n/1e6); n%=1e6; const th=Math.floor(n/1e3); n%=1e3; const rest=n;
  if(mil){ out+=u3(mil)+' million'; if(th||rest) out+=' '; }
  if(th){ out+=u3(th)+' thousand'; if(rest) out+=' '; }
  if(rest){ out+=u3(rest); }
  return out.replace(/\b\w/, c=>c.toUpperCase()).trim();
}

// -------- Single-select facilitator picker --------
let STAFF=[]; let SEL=null; // {key,name}
function renderStaffList(){
  const q=(document.getElementById('staffSearch').value||'').trim().toLowerCase();
  const box=document.getElementById('staffList');
  const items=STAFF.filter(s=>!q || s.name.toLowerCase().includes(q));
  if(!items.length){ box.innerHTML='<div class="staffempty">No facilitators match.</div>'; return; }
  box.innerHTML=items.slice(0,400).map(s=>{
    const k=esc(s.key), sel=(SEL&&SEL.key===s.key)?' sel':'';
    return '<label class="'+sel.trim()+'"><input type="radio" name="cf" data-key="'+k+'" data-name="'+esc(s.name)+'" '+((SEL&&SEL.key===s.key)?'checked':'')+'/>'+
      '<span>'+esc(s.name)+'</span><span class="cnt">'+fmt(s.activities)+'</span></label>';
  }).join('');
}
async function loadStaff(){
  const cl=document.getElementById('cluster').value;
  const districts=CLUSTER_DISTRICTS[cl]||[];
  SEL=null;
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

// ================= GENERATE =================
let GROUPS=null, SUMMARY=null, DOCMETA=null;
let loading=false;
async function generate(){
  if(!SEL){ alert('Pick a Community Facilitator first.'); return; }
  if(loading) return; loading=true;
  document.getElementById('save').disabled=true;
  const cl=document.getElementById('cluster').value;
  const districts=CLUSTER_DISTRICTS[cl]||[];
  const doc=document.getElementById('doc');
  doc.innerHTML='<div class="sheet"><p style="color:#5a6480">Analysing '+esc(SEL.name)+"'s groups… naming those behind on each target.</p></div>";
  const qs=new URLSearchParams();
  qs.set('staff', SEL.key);
  if(districts.length) qs.set('districts', districts.join(','));
  try{
    const res=await fetch('/api/cf-workplan/groups?'+qs.toString());
    const d=await res.json();
    GROUPS=(d&&d.groups)||[]; SUMMARY=(d&&d.summary)||{};
    buildDocument();
    document.getElementById('save').disabled=false;
  }catch(e){
    doc.innerHTML='<div class="sheet"><p style="color:#c62f2f">Failed to analyse groups for this CF. Please try again.</p></div>';
  }
  loading=false;
}

// ---- Build the list of NAMED groups behind on each target ----
function laggingGroups(){
  const g=GROUPS||[];
  const untrained = g.filter(x=>!x.trained).map(x=>x.name).filter(Boolean);
  const below25  = g.filter(x=>x.below_25).map(x=>x.name+' ('+fmt(x.members)+')').filter(Boolean);
  const notSaving= g.filter(x=>!x.saving).map(x=>x.name).filter(Boolean);
  const notProd  = g.filter(x=>!x.in_production).map(x=>x.name).filter(Boolean);
  return { untrained, below25, notSaving, notProd };
}
// English list joiner ("A, B and C")
function nameList(arr, max){
  max=max||8; const a=arr.slice(0,max);
  let s=a.length>1 ? a.slice(0,-1).join(', ')+' and '+a[a.length-1] : (a[0]||'');
  if(arr.length>max) s+=', and '+(arr.length-max)+' more';
  return s;
}

// ---- Compute the auto "areas of improvement" activities (named groups) ----
// Rows SHRINK over time because the source lists shrink as groups catch up.
function improvementRows(){
  const L=laggingGroups();
  const rows=[]; const profiled=(GROUPS||[]).length;
  const start=DOCMETA.start, plan=DOCMETA.planMonth;
  const monthNo=Math.max(1, monthDiff(start, plan)+1); // 1-based programme month being planned
  // 1) Group formation — below the 16-group target and still inside the 6-month window
  if(profiled < TARGET_GROUPS){
    const need=TARGET_GROUPS-profiled;
    rows.push({
      area:'Form '+need+' more SHG(s) to reach the 16-group target',
      target:String(need), needs:'Mobilisation tools, registration & profiling forms',
      out:'Currently '+profiled+' of 16 groups formed'+(monthNo<=MONTHS_FORM?(' (month '+monthNo+' of '+MONTHS_FORM+')'):' (past the 6-month window — urgent)'),
      imp:true
    });
  }
  // 2) < 25 members — NAME the groups
  if(L.below25.length){
    rows.push({
      area:'Recruit members into under-strength groups (min 25): '+nameList(L.below25),
      target:String(L.below25.length), needs:'Community mobilisation, membership drive, registration forms',
      out:'Bring '+L.below25.length+' group(s) up to the 25-member minimum',
      imp:true
    });
  }
  // 3) Untrained — NAME the groups (all trained within 8 months)
  if(L.untrained.length){
    rows.push({
      area:'Train the following groups: '+nameList(L.untrained),
      target:String(L.untrained.length), needs:'Flip charts, markers, pens, masking tape, attendance forms',
      out:L.untrained.length+' group(s) trained'+(monthNo<=MONTHS_TRAIN?(' toward the 8-month training target (month '+monthNo+')'):' (past the 8-month window — urgent)'),
      imp:true
    });
  }
  // 4) Not saving/ISLA this period — NAME the groups (every group saves monthly)
  if(L.notSaving.length){
    rows.push({
      area:'Start / resume monthly ISLA savings in: '+nameList(L.notSaving),
      target:String(L.notSaving.length), needs:'ISLA kits, passbooks, ISLA reporting forms',
      out:'All '+((GROUPS||[]).length)+' groups saving every month; '+L.notSaving.length+' still to activate',
      imp:true
    });
  }
  // 5) Not in production — NAME the groups (400 youth into production /12 months)
  if(L.notProd.length){
    rows.push({
      area:'Take the following groups into production: '+nameList(L.notProd),
      target:String(L.notProd.length), needs:'Inputs, demo materials, production forms',
      out:'Move '+L.notProd.length+' group(s) into production'+(monthNo<=MONTHS_PROD?(' toward the 12-month / 400-youth target (month '+monthNo+')'):' (past the 12-month window — urgent)'),
      imp:true
    });
  }
  // 6) Leverage — always collect monthly
  rows.push({
    area:'Collect local leverage data from all '+((GROUPS||[]).length)+' groups',
    target:String((GROUPS||[]).length), needs:'Leverage data forms',
    out:'Leverage contributions recorded for every group this month',
    imp:true
  });
  return rows;
}

// Standard recurring CF activities (from the example workplan). Editable.
function standardRows(){
  return [
    {area:'Continuous Agrihub strengthening', target:'1', needs:'Flip charts, markers, pens, masking tape, attendance forms', out:'Registration of participants'},
    {area:'Solicitation of subscription fees and shares', target:'30', needs:'Flip charts, markers, masking tape, attendance forms', out:'Subscription fees and shares solicited'},
    {area:'Land verification / ISLA reporting & monitoring', target:'5', needs:'Flip charts, markers, masking tape, attendance forms', out:'No. of SHGs land verified'},
    {area:'Linking SHGs to financial institutions', target:'', needs:'Transport facilitation', out:'No. of SHGs linked to financial institutions'},
    {area:'Job tracking', target:'40', needs:'Job-tracking forms', out:'No. of jobs tracked'},
    {area:'Submitting accountabilities & reports for the month', target:'', needs:'Attendance lists and reports', out:'Well-detailed activity reports & attendance lists'},
    {area:'Attend monthly review meeting & plan for next month', target:'', needs:'Monthly report review (achievements vs targets)', out:'Monthly activity plan'}
  ];
}

// ================= RENDER THE DOCUMENT =================
function buildDocument(){
  const cl=document.getElementById('cluster').value;
  const clusterLabel=CLUSTER_LABEL[cl]||'Cluster';
  const planMonth=document.getElementById('planMonth').value || DEFAULT_START;
  const start=(document.getElementById('startMonth') && document.getElementById('startMonth').value) || DEFAULT_START;
  const amount=Number(document.getElementById('amount').value)||0;
  const mm=(document.getElementById('mm').value||'').trim();
  // dominant district/subcounty from this CF's groups
  const districts={}, subs={};
  (GROUPS||[]).forEach(g=>{ if(g.district) districts[g.district]=(districts[g.district]||0)+1; if(g.subcounty) subs[g.subcounty]=(subs[g.subcounty]||0)+1; });
  const district=Object.keys(districts).sort((a,b)=>districts[b]-districts[a])[0]||'';
  const subcounty=Object.keys(subs).sort((a,b)=>subs[b]-subs[a])[0]||'';

  const [py,pm]=planMonth.split('-').map(Number);
  const planMonthName=monthName(pm-1);
  const planYear=py;
  // next month after the plan month (for the review-meeting row)
  const nd=new Date(py, pm, 1); const nextName=monthName(nd.getMonth()); const nextYear=nd.getFullYear();
  const today=new Date();
  const dateStr=ordinal(today.getDate())+' '+monthName(today.getMonth())+' '+today.getFullYear();

  DOCMETA={ cf:SEL.name, key:SEL.key, cluster:cl, clusterLabel, planMonth, start, district, subcounty, amount, mm, planMonthName, planYear };

  const improvements=improvementRows();
  const standards=standardRows();

  renderImpSummary();

  // ---------- PAGE 1 — REQUEST LETTER ----------
  const amtWords=amount>0 ? (ugxWords(amount)+' shillings') : '____';
  const amtFig=amount>0 ? ('{UGX'+fmt(amount).replace(/,/g,'')+'}') : '{UGX________}';
  let html='<section class="sheet letter" id="pg1">'+
    '<div class="addr">'+
      '<div contenteditable="true">'+esc(SEL.name)+'</div>'+
      '<div>CF, <span contenteditable="true">'+esc(subcounty||'________')+'</span> subcounty</div>'+
      '<div contenteditable="true">'+esc(titleCase(district)||'________')+' District</div>'+
      '<div contenteditable="true">'+esc(dateStr)+'</div>'+
    '</div>'+
    '<div class="addr">'+
      '<div>The Finance Manager</div>'+
      '<div>Heifer International Uganda</div>'+
      '<div>Kampala, Uganda</div>'+
    '</div>'+
    '<p class="re">RE: REQUEST FOR ADVANCE PAYMENT TO FACILITATE THE MONTH OF '+esc(planMonthName.toUpperCase())+' ACTIVITIES.</p>'+
    '<p contenteditable="true">I write to respectfully request for an advance facilitation payment amounting to Uganda shillings '+
      '<b>'+esc(amtWords)+'</b> '+esc(amtFig)+' to support the execution of planned activities for the month of '+
      esc(planMonthName)+' in '+esc(subcounty||'________')+' subcounty, '+esc(titleCase(district)||'________')+' District, where I serve as a Community Facilitator.</p>'+
    '<p contenteditable="true">'+letterActivitiesParagraph(improvements)+'</p>'+
    '<p>In view of the above, I kindly request that the advance facilitation amount of '+esc(amtFig)+' be paid using the details below.</p>'+
    '<ul>'+
      '<li>Name: <span contenteditable="true">'+esc(SEL.name)+'</span>.</li>'+
      '<li>Mobile Money Number: <span contenteditable="true">'+esc(mm||'__________')+'</span>.</li>'+
    '</ul>'+
    '<p>I will be grateful for your support and consideration of this request.</p>'+
    '<div class="sig"><p>Yours faithfully,</p>'+
      '<p class="nm" style="margin-top:26pt">'+esc(SEL.name)+'</p>'+
      '<p style="margin:0">Community Facilitator</p>'+
      '<p style="margin:0">'+esc(titleCase(subcounty)||'________')+' Subcounty.</p></div>'+
  '</section>';

  // ---------- PAGE 2 — WORKPLAN TABLE ----------
  const allRows=improvements.concat(standards);
  const bodyRows=allRows.map((r,i)=>rowHtml(r,i)).join('');
  html+='<section class="sheet wide" id="pg2">'+
    '<div class="wpmeta">'+
      '<div class="ttl">Monthly Workplan '+planYear+'</div>'+
      '<div class="row">NAME OF PREPARING OFFICER: <span contenteditable="true">'+esc(SEL.name.toUpperCase())+'</span></div>'+
      '<div class="row">DESIGNATION: <span>COMMUNITY FACILITATOR</span></div>'+
      '<div class="row">MONTH: <span contenteditable="true">'+esc(planMonthName.toUpperCase())+'</span></div>'+
    '</div>'+
    '<table class="wp"><thead><tr>'+
      '<th style="width:150px">Activity (Specify)</th>'+
      '<th class="tg" style="width:52px">Target (figures)</th>'+
      '<th class="wk">Wk 1</th><th class="wk">Wk 2</th><th class="wk">Wk 3</th><th class="wk">Wk 4</th>'+
      '<th>What is needed to facilitate the activity</th>'+
      '<th>Expected Key Outputs / Outcomes</th>'+
      '<th style="width:90px">Area of Implementation</th>'+
    '</tr></thead><tbody id="wpbody">'+bodyRows+'</tbody></table>'+
    '<div class="addrow no-print"><button class="btn ghost" onclick="addRow()"><i class="fas fa-plus"></i> Add activity row</button></div>'+
    '<div class="wpfoot">'+
      '<div class="b"><div class="ln"></div><div><span class="k">Prepared by:</span> <span contenteditable="true">'+esc(SEL.name)+'</span><br/>Designation: Community Facilitator</div></div>'+
      '<div class="b"><div class="ln"></div><div><span class="k">Reviewed by:</span> <span contenteditable="true">Arinaitwe Francis</span><br/>District Business Facilitator</div></div>'+
      '<div class="b"><div class="ln"></div><div><span class="k">Approved by:</span> <span contenteditable="true">Charles Ochom</span><br/>Coordinator</div></div>'+
    '</div>'+
  '</section>';

  document.getElementById('doc').innerHTML=html;
  wireWeekCells();
}

function titleCase(s){ return String(s||'').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); }

// Build the letter's "activities include…" paragraph from the improvement areas.
function letterActivitiesParagraph(improvements){
  const acts=['Agrihub strengthening','mobilisation of participants into production','ISLA savings & reporting','land verification','job tracking','linking SHGs to financial institutions'];
  const L=laggingGroups();
  const extra=[];
  if(L.untrained.length) extra.push('training of '+L.untrained.length+' outstanding group(s)');
  if(L.below25.length) extra.push('recruiting members into '+L.below25.length+' under-strength group(s)');
  if(L.notSaving.length) extra.push('activating monthly savings in '+L.notSaving.length+' group(s)');
  const all=acts.concat(extra);
  return 'The advance will facilitate timely implementation of key field activities which include; '+
    all.slice(0,-1).join(', ')+' and '+all[all.length-1]+
    '. These activities are critical to ensuring smooth program implementation and effective farmer engagement.';
}

// One workplan table row. Week cells are click-to-toggle (colour-blocked).
function rowHtml(r,i){
  const wk=(r.weeks||[false,false,false,false]);
  const wkTd=wk.map((on,w)=>'<td class="wk'+(on?' on':'')+'" data-row="'+i+'" data-wk="'+w+'"></td>').join('');
  return '<tr class="'+(r.imp?'improw':'')+'" data-row="'+i+'">'+
    '<td class="area'+(r.imp?' imp':'')+'" contenteditable="true">'+esc(r.area)+'</td>'+
    '<td class="tg" contenteditable="true">'+esc(r.target||'')+'</td>'+
    wkTd+
    '<td'+(r.imp?' class="imp"':'')+' contenteditable="true">'+esc(r.needs||'')+'</td>'+
    '<td'+(r.imp?' class="imp"':'')+' contenteditable="true">'+esc(r.out||'')+'</td>'+
    '<td contenteditable="true">'+esc((DOCMETA&&titleCase(DOCMETA.district))||'')+'</td>'+
  '</tr>';
}
function wireWeekCells(){
  const body=document.getElementById('wpbody'); if(!body) return;
  body.addEventListener('click', (e)=>{ const c=e.target.closest('td.wk'); if(!c) return; c.classList.toggle('on'); });
}
let ROWSEQ=999;
function addRow(){
  const body=document.getElementById('wpbody'); if(!body) return;
  const i=++ROWSEQ;
  const tr=document.createElement('tr'); tr.setAttribute('data-row',i);
  tr.innerHTML=rowHtml({area:'',target:'',needs:'',out:''}, i).replace(/^<tr[^>]*>|<\/tr>$/g,'');
  body.appendChild(tr);
}

// ---- Improvement summary strip (named counts) ----
function renderImpSummary(){
  const s=SUMMARY||{}; const box=document.getElementById('impsum');
  box.className='impsum show';
  box.innerHTML='<h4>Areas of improvement for '+esc(DOCMETA.planMonthName)+' — '+esc(DOCMETA.cf)+' ('+fmt((GROUPS||[]).length)+' groups)</h4>'+
    '<div class="grid">'+
      cell('bad', s.groups_untrained, 'Groups to train')+
      cell('bad', s.groups_below_25, 'Groups < 25 members')+
      cell('bad', s.groups_not_saving, 'Groups not saving')+
      cell('bad', s.groups_not_in_production, 'Groups not in production')+
    '</div>'+
    '<div class="grid" style="margin-top:1px">'+
      cell('good', s.groups_trained, 'Trained')+
      cell('good', s.groups_saving, 'Saving (ISLA)')+
      cell('good', s.groups_in_production, 'In production')+
      cell('', (GROUPS||[]).length, 'Groups profiled')+
    '</div>';
  function cell(cls,v,l){ return '<div class="c '+cls+'"><div class="v">'+fmt(v)+'</div><div class="l">'+l+'</div></div>'; }
}

// ================= SAVE =================
async function saveDoc(){
  if(!DOCMETA){ return; }
  const btn=document.getElementById('save'); const bar=document.getElementById('savebar'); const msg=document.getElementById('savemsg');
  bar.className='savebar show'; msg.className='savemsg'; msg.textContent='Saving…'; btn.disabled=true;
  // capture the (possibly edited) document HTML so it re-opens exactly
  const payload={
    person_id: DOCMETA.key || null,
    cf_name: DOCMETA.cf,
    plan_month: DOCMETA.planMonth,
    district: DOCMETA.district || null,
    subcounty: DOCMETA.subcounty || null,
    amount: DOCMETA.amount || null,
    mm_number: DOCMETA.mm || null,
    created_by: 'admin',
    payload: {
      cluster: DOCMETA.cluster, clusterLabel: DOCMETA.clusterLabel,
      start: DOCMETA.start,
      summary: SUMMARY, groups: GROUPS,
      html: document.getElementById('doc').innerHTML
    }
  };
  try{
    const res=await fetch('/api/cf-workplan/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await res.json();
    if(j && j.ok){ msg.className='savemsg ok'; msg.textContent='✓ Saved workplan for '+DOCMETA.cf+' ('+DOCMETA.planMonth+').'; }
    else { msg.className='savemsg err'; msg.textContent='Save failed: '+((j&&j.error)||'unknown error'); }
  }catch(e){ msg.className='savemsg err'; msg.textContent='Save failed: '+String(e&&e.message||e); }
  btn.disabled=false;
}

// ================= WIRING =================
document.getElementById('cluster').addEventListener('change', loadStaff);
document.getElementById('staffSearch').addEventListener('input', renderStaffList);
document.getElementById('staffList').addEventListener('change', (e)=>{
  const r=e.target.closest('input[type=radio]'); if(!r) return;
  SEL={ key:r.getAttribute('data-key'), name:r.getAttribute('data-name') };
  renderStaffList();
});
document.getElementById('gen').addEventListener('click', generate);
document.getElementById('save').addEventListener('click', saveDoc);
document.getElementById('printBtn').addEventListener('click', ()=>{ if(!DOCMETA){ alert('Generate a workplan first.'); return; } window.print(); });
// default plan month = next calendar month
(function(){ const d=new Date(); d.setMonth(d.getMonth()+1); const mm=String(d.getMonth()+1).padStart(2,'0'); document.getElementById('planMonth').value=d.getFullYear()+'-'+mm; })();
loadStaff();
`;

export function renderCfWorkplan(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF Workplan &amp; Request — SAYE Uganda MEL</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet" />
  <style>
    :root{
      --primary:#003399; --primary-deep:#001f5c; --primary-tint:#eef2fb;
      --fg:#1b2437; --muted-fg:#5a6480; --border:#d7deee; --rule:#b9c4e4;
      --good:#1f8a4c; --warn:#c07d12; --bad:#c62f2f; --desk:#eceff6;
      --sans:"Inter Tight",ui-sans-serif,system-ui,sans-serif;
      --serif:"Source Serif 4",Georgia,"Times New Roman",serif;
      --mono:"IBM Plex Mono",ui-monospace,monospace;
    }
    *{ box-sizing:border-box; }
    body{ background:var(--desk); color:var(--fg); font-family:var(--sans); margin:0; -webkit-font-smoothing:antialiased; }

    /* toolbar (screen only) */
    .toolbar{ max-width:210mm; margin:0 auto 14px; padding:16px 0 0; display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld.grow{ flex:1; min-width:230px; }
    .fld label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted-fg); }
    .fld select, .fld input{ border:1px solid var(--border); border-radius:2px; padding:8px 10px; font-size:13px; background:#fff; min-width:140px; color:var(--fg); font-family:inherit; }
    .fld select:focus, .fld input:focus{ outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(0,51,153,.12); }
    .btn{ background:var(--primary); color:#fff; border:0; border-radius:2px; padding:9px 16px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.12em; cursor:pointer; font-family:var(--sans); }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); border:1px solid var(--border); }
    .btn.ok{ background:var(--good); } .btn.ok:hover{ background:#166e3b; }
    .btn:disabled{ opacity:.55; cursor:default; }

    /* single-select facilitator picker */
    .staffbox{ border:1px solid var(--border); border-radius:2px; background:#fff; padding:8px; min-width:240px; }
    .staffbox input[type=text]{ width:100%; border:1px solid var(--border); border-radius:2px; padding:7px 9px; font-size:13px; font-family:inherit; }
    .stafflist{ max-height:150px; overflow:auto; margin-top:8px; border-top:1px solid var(--border); }
    .stafflist label{ display:flex; align-items:center; gap:8px; padding:5px 4px; font-size:12.5px; cursor:pointer; border-bottom:1px solid var(--muted,#f1f3f9); }
    .stafflist label:hover{ background:var(--primary-tint); }
    .stafflist label .cnt{ margin-left:auto; font-family:var(--mono); font-size:10px; color:var(--muted-fg); }
    .stafflist label.sel{ background:var(--primary-tint); font-weight:600; }
    .staffloading,.staffempty{ padding:10px; font-size:12px; color:var(--muted-fg); }

    .note{ max-width:210mm; margin:0 auto 14px; background:var(--primary-tint); border:1px solid var(--rule); border-left:3px solid var(--primary); color:var(--primary-deep); font-size:12px; padding:9px 13px; border-radius:2px; }
    .note i{ margin-right:6px; color:var(--primary); }
    .savebar{ max-width:210mm; margin:0 auto 14px; display:none; gap:10px; align-items:center; }
    .savebar.show{ display:flex; }
    .savemsg{ font-size:12px; color:var(--muted-fg); }
    .savemsg.ok{ color:var(--good); font-weight:600; }
    .savemsg.err{ color:var(--bad); font-weight:600; }

    /* ===== A4 document sheets (Word-typed look) ===== */
    .sheet{ width:210mm; min-height:297mm; background:#fff; margin:0 auto 22px; padding:22mm 20mm; box-shadow:0 1px 2px rgba(0,0,0,.08), 0 24px 48px -24px rgba(0,0,0,.25); font-family:var(--serif); color:#141414; font-size:12pt; line-height:1.5; }
    .sheet.wide{ width:297mm; padding:16mm 14mm; }
    .letter p{ margin:0 0 12pt; }
    .letter .addr{ margin-bottom:14pt; }
    .letter .addr div{ line-height:1.35; }
    .letter .re{ font-weight:700; text-transform:uppercase; margin:6pt 0 12pt; }
    .letter ul{ margin:0 0 12pt; padding-left:24pt; }
    .letter li{ margin:2pt 0; }
    .letter .sig{ margin-top:30pt; }
    .letter .sig .nm{ font-weight:700; }
    [contenteditable=true]{ outline:none; }
    [contenteditable=true]:focus{ background:#fffbe6; box-shadow:0 0 0 2px #ffe38a inset; border-radius:2px; }

    /* workplan table */
    .wpmeta{ margin-bottom:10pt; font-size:11pt; }
    .wpmeta .ttl{ font-weight:700; font-size:14pt; text-transform:uppercase; letter-spacing:.02em; margin-bottom:6pt; }
    .wpmeta .row span{ font-weight:700; }
    table.wp{ width:100%; border-collapse:collapse; font-size:9.5pt; font-family:var(--sans); }
    table.wp th, table.wp td{ border:1px solid #6b7280; padding:5px 6px; vertical-align:top; text-align:left; }
    table.wp thead th{ background:var(--primary); color:#fff; font-size:8.5pt; text-transform:uppercase; letter-spacing:.04em; font-weight:600; }
    table.wp thead th.wk{ width:26px; text-align:center; }
    table.wp td.tg{ text-align:center; font-family:var(--mono); width:52px; }
    table.wp td.wk{ text-align:center; width:26px; padding:0; }
    table.wp td.wk.on{ background:var(--primary); }
    table.wp td.area{ font-weight:600; width:150px; }
    table.wp td.imp{ background:#fff7e6; }
    table.wp tr.improw td.area{ color:var(--bad); }
    .wpfoot{ display:flex; justify-content:space-between; margin-top:26pt; font-size:10pt; font-family:var(--sans); gap:16px; }
    .wpfoot .b{ flex:1; }
    .wpfoot .b .ln{ border-top:1px solid #444; margin-bottom:4px; height:34px; }
    .wpfoot .b .k{ font-weight:700; }
    .addrow{ margin:10px 0 0; }
    .rmrow{ color:var(--bad); cursor:pointer; font-size:11px; }

    /* status chips for the improvement summary */
    .impsum{ max-width:210mm; margin:0 auto 14px; background:#fff; border:1px solid var(--border); border-radius:3px; padding:12px 14px; font-size:12px; display:none; }
    .impsum.show{ display:block; }
    .impsum h4{ margin:0 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:.14em; color:var(--primary); }
    .impsum .grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--border); }
    .impsum .c{ background:#fff; padding:8px 10px; }
    .impsum .c .v{ font-family:var(--mono); font-size:20px; font-weight:700; }
    .impsum .c .l{ font-size:9px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted-fg); margin-top:3px; }
    .impsum .c.bad .v{ color:var(--bad); } .impsum .c.good .v{ color:var(--good); }

    @media print{
      body{ background:#fff; }
      .toolbar,.note,.savebar,.impsum,.shg-nav,#shgGate,.addrow,.rmrow,.no-print{ display:none !important; }
      .sheet{ box-shadow:none; margin:0; padding:16mm; page-break-after:always; }
      .sheet.wide{ width:auto; }
      @page{ size:A4; margin:0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="fld"><label>Cluster</label>
      <select id="cluster">
        <option value="iganga">Iganga Cluster</option>
        <option value="kamuli">Kamuli Cluster</option>
        <option value="bugiri">Bugiri Cluster</option>
        <option value="central">Central Cluster</option>
      </select>
    </div>
    <div class="fld grow"><label>Community Facilitator (CF)</label>
      <div class="staffbox">
        <input type="text" id="staffSearch" placeholder="Search facilitator…" />
        <div class="stafflist" id="staffList"><div class="staffloading">Loading…</div></div>
      </div>
    </div>
    <div class="fld"><label>Plan month (next month)</label><input type="month" id="planMonth" /></div>
    <div class="fld"><label>Programme start</label><input type="month" id="startMonth" value="2026-01" /></div>
    <div class="fld"><label>Advance amount (UGX)</label><input type="number" id="amount" min="0" step="1000" value="330000" placeholder="330000" /></div>
    <div class="fld"><label>Mobile Money No.</label><input type="text" id="mm" placeholder="07XXXXXXXX" /></div>
    <button class="btn" id="gen"><i class="fas fa-file-signature"></i> Generate</button>
    <button class="btn ok" id="save" disabled><i class="fas fa-floppy-disk"></i> Save</button>
    <button class="btn ghost" id="printBtn"><i class="fas fa-print"></i> Print / Word</button>
  </div>

  <div class="savebar" id="savebar"><span class="savemsg" id="savemsg"></span></div>
  <div id="noteBox"><div class="note"><i class="fas fa-circle-info"></i> Pick a cluster + CF + the month being planned, then <b>Generate</b>. The workplan auto-adds improvement/training activities that <b>name the specific groups</b> behind on each target. Every field in the letter and table is editable — click to type. Then <b>Save</b> or <b>Print / Word</b>.</div></div>
  <div class="impsum" id="impsum"></div>

  <div id="doc"><div class="sheet"><p style="color:#5a6480">Select a cluster and a Community Facilitator, then click <b>Generate</b> to build the request letter + workplan.</p></div></div>

  ${navSidebar('cfworkplan')}

<script>
${CLIENT_JS}
</script>
</body>
</html>`;
}
