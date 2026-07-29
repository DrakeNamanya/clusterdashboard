import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// WEEKLY REPORT — Mon→Sun narrative summary of ALL indicators, per cluster.
//   Filters: Cluster + Date range (default = current Mon→Sun week).
//   Data from /api/weekly (mel_weekly_report RPC) + /api/youth-in-work.
//
//   VISUAL DESIGN cloned from the user's Lovable "Warm" editorial mock:
//     Royal Blue #003399 on white · Instrument Serif (display) + Archivo (sans)
//     + IBM Plex Mono (figures) · radius 0 · numbered sections 01-08 in a
//     12-col grid · drop-cap intro · Datum headline figures · hairline zebra
//     data tables · 3-column sign-off · print-first A4 white paper.
//   Live data wiring is UNCHANGED (same API, same field names).
// ---------------------------------------------------------------------------

export function renderWeeklyReport(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Field Report — SAYE Uganda</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root{
      --primary:#003399; --primary-deep:#001f5c; --primary-wash:#eef2fb;
      --ink:#101828; --ink-85:#28303f; --border:#c9d2e8; --muted:#55617a;
      --font-display:"Instrument Serif",Georgia,serif;
      --font-sans:"Archivo","Helvetica Neue",Arial,sans-serif;
      --font-mono:"IBM Plex Mono",ui-monospace,monospace;
    }
    *{ box-sizing:border-box; }
    html,body{ margin:0; }
    body{ background:#fff; color:var(--ink); font-family:var(--font-sans);
      font-feature-settings:"kern" 1; -webkit-font-smoothing:antialiased; }

    .figure{ font-family:var(--font-mono); font-variant-numeric:tabular-nums; letter-spacing:-.03em; }
    .label{ font-family:var(--font-mono); font-size:.6875rem; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
    .em{ font-weight:600; color:var(--primary); }

    main{ max-width:68rem; margin:0 auto; padding:24px 40px 40px; min-height:100vh; }
    @media(max-width:720px){ main{ padding:20px 22px 32px; } }

    /* toolbar (screen only) */
    .toolbar{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; justify-content:flex-end; margin-bottom:20px; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-family:var(--font-mono); font-size:.625rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
    .fld select,.fld input{ border:1px solid var(--border); border-radius:0; padding:7px 10px; font-size:13px; font-family:var(--font-sans); background:#fff; min-width:150px; color:var(--ink); }
    .btn{ font-family:var(--font-mono); border:1px solid var(--primary); background:var(--primary); color:#fff; padding:8px 14px; font-size:.6875rem; text-transform:uppercase; letter-spacing:.14em; cursor:pointer; border-radius:0; }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); }
    .btn.ghost:hover{ background:var(--primary-wash); }

    /* masthead */
    .mast-bar{ height:.5rem; background:var(--primary); margin-bottom:12px; }
    .mast-row{ display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:16px; border-bottom:2px solid var(--primary); padding-bottom:12px; }
    .mast-org{ font-family:var(--font-display); font-size:2.5rem; line-height:.95; letter-spacing:-.01em; color:var(--primary); margin-top:4px; }
    @media(max-width:720px){ .mast-org{ font-size:2rem; } }
    .mast-right{ text-align:right; }
    .mast-badge{ font-family:var(--font-mono); background:var(--primary); color:#fff; padding:4px 8px; font-size:.75rem; text-transform:uppercase; letter-spacing:.18em; display:inline-block; }
    .mast-sub{ font-family:var(--font-display); font-style:italic; font-size:1.25rem; line-height:1.1; color:var(--primary-deep); margin-top:4px; }

    /* meta + intro */
    .metarow{ display:flex; flex-direction:column; gap:16px; border-bottom:1px solid var(--border); padding:14px 0; margin-top:2px; }
    @media(min-width:721px){ .metarow{ flex-direction:row; align-items:flex-start; gap:40px; } }
    .metalist{ width:100%; max-width:19rem; margin:0; }
    .meta{ display:flex; align-items:baseline; gap:12px; border-bottom:1px solid var(--border); padding:4px 0; }
    .meta dt{ margin:0; }
    .meta dd{ margin:0 0 0 auto; font-family:var(--font-mono); font-variant-numeric:tabular-nums; letter-spacing:-.03em; font-size:.8125rem; color:var(--ink); }
    .intro{ max-width:38rem; font-size:.875rem; line-height:1.55; color:var(--ink-85); margin:0; }
    .dropcap{ float:left; margin:.35rem .5rem 0 0; font-family:var(--font-display); font-size:2.4rem; line-height:.7; color:var(--primary); }

    /* headline figures */
    .datums{ display:grid; grid-template-columns:repeat(2,1fr); gap:16px 20px; margin-top:20px; }
    @media(min-width:900px){ .datums{ grid-template-columns:repeat(4,1fr); } }
    .datum{ border-top:2px solid var(--primary); background:var(--primary-wash); padding:8px 12px 10px; break-inside:avoid; }
    .datum .dn{ font-family:var(--font-mono); font-size:.625rem; letter-spacing:.14em; text-transform:uppercase; color:rgba(0,51,153,.7); margin-bottom:8px; }
    .datum .dv{ font-family:var(--font-mono); font-variant-numeric:tabular-nums; letter-spacing:-.03em; font-size:2rem; line-height:1; color:var(--primary); }
    @media(min-width:721px){ .datum .dv{ font-size:2.25rem; } }
    .datum .dl{ margin-top:8px; font-size:.8125rem; font-weight:600; letter-spacing:-.01em; }
    .datum .dnote{ margin-top:2px; font-size:.75rem; font-style:italic; color:var(--muted); }

    /* record-of-activity heading */
    .roa{ font-family:var(--font-mono); font-size:.6875rem; letter-spacing:.14em; text-transform:uppercase; color:var(--primary); border-left:4px solid var(--primary); padding-left:8px; margin:32px 0 4px; }

    /* numbered sections */
    .sec{ display:grid; grid-template-columns:1fr; gap:12px 32px; border-top:1px solid var(--border); padding:16px 0; break-inside:avoid; }
    @media(min-width:721px){ .sec{ grid-template-columns:repeat(12,1fr); } }
    .sec-head{ grid-column:auto; }
    @media(min-width:721px){ .sec-head{ grid-column:span 3; } }
    .sec-n{ font-family:var(--font-mono); font-size:.6875rem; letter-spacing:.14em; text-transform:uppercase; color:var(--primary); }
    .sec-title{ font-family:var(--font-display); font-size:1.25rem; line-height:1.05; color:var(--primary-deep); margin:4px 0 0; }
    .sec-prose{ grid-column:auto; }
    @media(min-width:721px){ .sec-prose{ grid-column:span 5; } }
    .sec-prose p{ max-width:38rem; font-size:.875rem; line-height:1.5; color:var(--ink-85); margin:0; }
    .sec-data{ grid-column:auto; }
    @media(min-width:721px){ .sec-data{ grid-column:span 4; } }
    .sec-dl{ margin:0; border-top:1px solid var(--primary); }
    .dr{ display:flex; align-items:baseline; gap:16px; border-bottom:1px solid var(--border); padding:3px 8px; }
    .dr.zebra{ background:var(--primary-wash); }
    .dr dt{ margin:0; font-size:.8125rem; color:var(--muted); }
    .dr dd{ margin:0 0 0 auto; font-family:var(--font-mono); font-variant-numeric:tabular-nums; letter-spacing:-.03em; font-size:.875rem; font-weight:500; color:var(--primary-deep); }

    /* sign-off */
    .signoff{ display:grid; grid-template-columns:repeat(3,1fr); gap:32px; border-top:2px solid var(--primary); padding-top:24px; margin-top:8px; break-inside:avoid; }
    @media(max-width:560px){ .signoff{ grid-template-columns:1fr; gap:18px; } }
    .sign .sline{ height:2rem; border-bottom:1px solid var(--primary); }
    .sign .slbl{ margin-top:8px; }

    /* footer */
    footer{ margin-top:32px; border-top:1px solid var(--border); padding-top:12px; break-inside:avoid; }
    footer p{ max-width:38rem; font-size:.75rem; line-height:1.7; color:var(--muted); margin:0; }
    .foot-strip{ display:flex; justify-content:space-between; gap:16px; border-top:2px solid var(--primary); padding-top:8px; margin-top:16px; }

    .loading{ font-family:var(--font-mono); font-size:.8125rem; color:var(--muted); padding:8px; }
    .note{ background:var(--primary-wash); border:1px solid var(--border); border-left:4px solid var(--primary); color:var(--primary-deep); font-size:.8125rem; padding:8px 12px; margin-bottom:16px; }

    /* PRINT — A4 portrait white paper */
    @page{ size:A4 portrait; margin:10mm 10mm 9mm; }
    @media print{
      html,body{ background:#fff !important; font-size:8.6pt; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .shg-nav,.shg-nav-open,.toolbar,#noteBox,.no-print{ display:none !important; }
      main{ max-width:none !important; padding:0 !important; }
      .sec,.datum,.signoff,header,footer{ break-inside:avoid; page-break-inside:avoid; }
    }
  </style>
</head>
<body>
${navSidebar('weekly')}
  <main>
    <div class="toolbar no-print">
      <div class="fld"><label>Cluster</label>
        <select id="cluster">${clusterOptions('iganga')}</select></div>
      <div class="fld"><label>Week from (Mon)</label><input type="date" id="from" /></div>
      <div class="fld"><label>Week to (Sun)</label><input type="date" id="to" /></div>
      <button class="btn" id="apply">Apply</button>
      <button class="btn ghost" id="thisweek">This week</button>
      <button class="btn ghost" id="reset">All time</button>
      <button class="btn" id="printBtn">Print / Save PDF</button>
    </div>

    <div id="noteBox"></div>

    <header>
      <div class="mast-bar"></div>
      <div class="mast-row">
        <div>
          <div class="label" style="color:var(--primary)">Monitoring, Evaluation &amp; Learning</div>
          <div class="mast-org">SAYE Uganda</div>
        </div>
        <div class="mast-right">
          <div class="mast-badge">Weekly Field Report</div>
          <div class="mast-sub" id="mhClusterLabel">Iganga Cluster</div>
        </div>
      </div>
    </header>

    <div class="metarow">
      <dl class="metalist">
        <div class="meta"><dt class="label">Cluster</dt><dd id="mhCluster">Iganga</dd></div>
        <div class="meta"><dt class="label">Week</dt><dd id="mhWeek">—</dd></div>
        <div class="meta"><dt class="label">Generated</dt><dd id="mhDate">—</dd></div>
      </dl>
      <p class="intro">
        <span class="dropcap">M</span>onday to Sunday summary of all indicators for the selected cluster,
        disaggregated by female participants and persons with disabilities. Prepared for weekly review and circulation.
      </p>
    </div>

    <div class="datums">
      <div class="datum"><div class="dn">i</div><div class="dv" id="kTrained">—</div><div class="dl">Youth reached / trained</div><div class="dnote">distinct participants</div></div>
      <div class="datum"><div class="dn">ii</div><div class="dv" id="kShgs">—</div><div class="dl">SHGs formed</div><div class="dnote">new groups profiled</div></div>
      <div class="datum"><div class="dn">iii</div><div class="dv" id="kSavings">—</div><div class="dl">Savings mobilized</div><div class="dnote">UGX, ISLA amount saved</div></div>
      <div class="datum"><div class="dn">iv</div><div class="dv" id="kLev">—</div><div class="dl">Leverage raised</div><div class="dnote">UGX, local contributions</div></div>
    </div>

    <div class="roa">Record of activity</div>
    <div id="narrative"><div class="loading">Loading…</div></div>

    <footer>
      <p>Prepared by the SAYE Uganda MEL team. Sources: youth attendance and training register,
      SHG profiling, production, sales, poultry and ISLA records. Figures cover the selected week and cluster;
      gender source is the participant register.</p>
      <div class="foot-strip label" style="color:var(--primary)">
        <span>SAYE Uganda · Weekly Report</span>
        <span id="dfStamp">—</span>
      </div>
    </footer>
  </main>

<script>
const CLUSTER_DISTRICTS = {
  iganga:['IGANGA','JINJA','JINJA CITY','MAYUGE','LUUKA'],
  kamuli:['KAMULI','KALIRO','BUYENDE'],
  bugiri:['BUGIRI','NAMUTUMBA','NAMAYINGO','BUGWERI'],
  central:['MUKONO','BUIKWE','KAYUNGA']
};
const CLUSTER_LABEL = { iganga:'Iganga Cluster', kamuli:'Kamuli Cluster', bugiri:'Bugiri Cluster', central:'Central Cluster', all:'All Clusters' };
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => (n==null||isNaN(n)) ? '0' : Math.round(Number(n)).toLocaleString();
function ugx(n){ n=Number(n)||0; if(n>=1e9) return 'UGX '+(n/1e9).toFixed(2)+'B'; if(n>=1e6) return 'UGX '+(n/1e6).toFixed(1)+'M'; if(n>=1e3) return 'UGX '+(n/1e3).toFixed(0)+'K'; return 'UGX '+fmt(n); }
// compact figure for the headline Datum cards (e.g. 12.3M)
function compact(n){ n=Number(n)||0; if(n>=1e9) return (n/1e9).toFixed(2)+'B'; if(n>=1e6) return (n/1e6).toFixed(1)+'M'; if(n>=1e3) return (n/1e3).toFixed(0)+'K'; return fmt(n); }
function dis(female, pwd){ return fmt(female)+' female · '+fmt(pwd)+' PWDs'; }

function weekBounds(){
  const d=new Date(); const day=(d.getDay()+6)%7;
  const mon=new Date(d); mon.setDate(d.getDate()-day);
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  const iso=x=>x.toISOString().slice(0,10);
  return { from:iso(mon), to:iso(sun) };
}
function prettyDate(s){ if(!s) return ''; const d=new Date(s+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }

// Editorial numbered section: title / prose / hairline zebra data table.
function section(n, title, proseHtml, rows){
  const dl = rows.map((r,i)=>'<div class="dr'+(i%2===0?' zebra':'')+'"><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>').join('');
  return '<section class="sec">'+
    '<div class="sec-head"><div class="sec-n">'+n+'</div><h2 class="sec-title">'+title+'</h2></div>'+
    '<div class="sec-prose"><p>'+proseHtml+'</p></div>'+
    '<div class="sec-data"><dl class="sec-dl">'+dl+'</dl></div>'+
  '</section>';
}
function em(s){ return '<span class="em">'+s+'</span>'; }

function buildNarrative(d, clusterLabel, yiw){
  const p=d.profiling||{}, dist=d.distribution||{}, prod=d.production||{}, poul=d.poultry||{}, hs=d.hort_sales||{}, isla=d.isla||{}, lev=d.leverage||{};
  const trBy=d.training_by||[]; const trained=d.training_total||0;
  let out='';

  // 01 Profiling & SHG Formation
  out += section('01','Profiling &amp; SHG Formation',
    'The '+esc(clusterLabel)+' registered '+em(fmt(p.shgs_formed)+' SHGs')+' during the period, profiling a total of '+
    em(fmt(p.youth_profiled)+' youth')+' ('+fmt(p.female_profiled)+' female, '+fmt(p.male_profiled)+' male).',
    [['SHGs formed', fmt(p.shgs_formed)],['Youth profiled', fmt(p.youth_profiled)],['Female', fmt(p.female_profiled)],['Male', fmt(p.male_profiled)]]);

  // 02 Training
  const trRows = trBy.slice(0,8).map(t=>[String(t.type||'—'), fmt(t.n)]);
  const trBody = trRows.length ? [['Youth trained', fmt(trained)],['Training areas', fmt(trBy.length)]].concat(trRows) : [['Youth trained', fmt(trained)],['Training areas', fmt(trBy.length)]];
  out += section('02','Training by Frontliners',
    'A total of '+em(fmt(trained)+' youth')+' were trained across '+em(fmt(trBy.length)+' training areas')+'.'+(trRows.length?' Breakdown by area shown alongside.':' No trainings were recorded for this week.'),
    trBody);

  // 03 Distribution
  const distItems = (dist.items && String(dist.items).trim()) ? String(dist.items) : '';
  out += section('03','Distribution to Participants',
    (distItems ? em(esc(distItems))+' were distributed to ' : 'Materials were distributed to ')+
    em(fmt(dist.participants)+' participants')+' across '+em(fmt(dist.shgs)+' SHGs')+' during the period.',
    [['Participants', fmt(dist.participants)],['SHGs reached', fmt(dist.shgs)]]);

  // 04 Production & Marketing
  const hsItems = (hs.items && String(hs.items).trim()) ? String(hs.items) : '';
  out += section('04','Production &amp; Marketing',
    'In production, '+em(fmt(prod.youth)+' youth')+' ('+dis(prod.female, prod.pwd)+') from '+em(fmt(prod.shgs)+' SHGs')+
    ' were active across '+fmt(prod.districts)+' districts ('+esc(prod.district_list||'—')+'). '+
    'Horticulture and oilseed marketing engaged '+em(fmt(hs.youth)+' youth sellers')+' ('+dis(hs.female, hs.pwd)+') generating '+em(ugx(hs.value))+'.'+
    (hsItems ? ' Produce sold: '+em(esc(hsItems))+'.' : ''),
    [['Production youth', fmt(prod.youth)],['Female', fmt(prod.female)],['PWDs', fmt(prod.pwd)],
     ['Youth sellers', fmt(hs.youth)],['Sellers · female', fmt(hs.female)],['Sellers · PWDs', fmt(hs.pwd)],
     ['Horticulture sales', ugx(hs.value)]]);

  // 05 Poultry Sales
  out += section('05','Poultry Sales',
    em(fmt(poul.birds_sold)+' birds')+' were sold by '+em(fmt(poul.youth)+' youth')+' ('+dis(poul.female, poul.pwd)+') across '+
    em(fmt(poul.shgs)+' SHGs')+', earning '+em(ugx(poul.value))+'.',
    [['Birds sold', fmt(poul.birds_sold)],['Youth sellers', fmt(poul.youth)],['Female', fmt(poul.female)],
     ['PWDs', fmt(poul.pwd)],['SHGs involved', fmt(poul.shgs)],['Earnings', ugx(poul.value)]]);

  // 06 Access to Finance (ISLA)
  out += section('06','Access to Finance',
    'Through ISLA, '+em(fmt(isla.shgs)+' SHGs')+' mobilized '+em(ugx(isla.savings))+' in savings from '+
    em(fmt(isla.savers)+' youth savers')+', with '+em(ugx(isla.loans_value))+' in loans issued to '+em(fmt(isla.loans_count)+' youth')+'.',
    [['SHGs saving', fmt(isla.shgs)],['Youth saving', fmt(isla.savers)],['Amount saved', ugx(isla.savings)],
     ['Loans given', ugx(isla.loans_value)],['Youth with loans', fmt(isla.loans_count)]]);

  // 07 Youth in Work
  if(yiw){
    const k=yiw.kpi||{}; const bd=yiw.byDistrict||[];
    const yiwTgt=bd.reduce((s,r)=>s+(Number(r.yiwTarget)||0),0);
    const empPct = yiwTgt>0 ? Math.round(100*(Number(k.employedYouth)||0)/yiwTgt)+'%' : '—';
    out += section('07','Youth in Work',
      'During the period, '+em(fmt(k.youthTracked)+' youth')+' were job-tracked, of whom '+em(fmt(k.employedYouth))+' are employed — '+
      fmt(k.selfEmployed)+' self-employed and '+fmt(k.wageEmployed)+' wage-employed, generating '+em(ugx(k.totalIncome))+' in income. '+
      'This is '+em(empPct)+' of the Youth-in-Work target of '+fmt(yiwTgt)+', being 70% of the cluster reach target.',
      [['Job-tracked', fmt(k.youthTracked)],['Employed (YiW)', fmt(k.employedYouth)],['Self-employed', fmt(k.selfEmployed)],
       ['Wage-employed', fmt(k.wageEmployed)],['Income', ugx(k.totalIncome)],['YiW target', fmt(yiwTgt)]]);
  }

  // 08 Leverage Contributions
  out += section('08','Leverage Contributions',
    'Local leverage contributions totalled '+em(ugx(lev.amount))+' during the reporting period.',
    [['Total leverage', ugx(lev.amount)]]);

  // sign-off
  out += '<div class="signoff">'+
    ['Prepared by (M&amp;E)','Cluster supervisor','Verified'].map(role=>
      '<div class="sign"><div class="sline"></div><div class="slbl label" style="color:var(--primary)">'+role+'</div></div>').join('')+
  '</div>';

  document.getElementById('narrative').innerHTML = out;

  // headline Datum figures
  document.getElementById('kTrained').textContent = compact(trained);
  document.getElementById('kShgs').textContent = compact(p.shgs_formed);
  document.getElementById('kSavings').textContent = compact(isla.savings);
  document.getElementById('kLev').textContent = compact(lev.amount);
}

let loading=false;
async function load(){
  if(loading) return; loading=true;
  const cl=document.getElementById('cluster').value;
  const from=document.getElementById('from').value;
  const to=document.getElementById('to').value;
  const districts=CLUSTER_DISTRICTS[cl]||[];
  const label=CLUSTER_LABEL[cl]||'Cluster';
  const nowStr = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const setTxt=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  setTxt('mhClusterLabel', label);
  setTxt('mhCluster', label.replace(/ Cluster$/,''));
  setTxt('mhDate', nowStr);
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
    buildNarrative(d, label, yiw);
    document.getElementById('noteBox').innerHTML='';
  }catch(e){
    document.getElementById('narrative').innerHTML='<div class="loading">Failed to load weekly report.</div>';
  }
  loading=false;
}
document.getElementById('apply').addEventListener('click', load);
document.getElementById('cluster').addEventListener('change', load);
document.getElementById('thisweek').addEventListener('click', ()=>{ const w=weekBounds(); document.getElementById('from').value=w.from; document.getElementById('to').value=w.to; load(); });
document.getElementById('reset').addEventListener('click', ()=>{ document.getElementById('from').value=''; document.getElementById('to').value=''; load(); });
document.getElementById('printBtn').addEventListener('click', ()=>window.print());
(function(){ const w=weekBounds(); document.getElementById('from').value=w.from; document.getElementById('to').value=w.to; })();
load();
</script>
</body>
</html>`;
}
