// ---------------------------------------------------------------------------
// Home dashboard — SAYE Uganda styled overview.
//
// A self-contained landing page modelled on the client reference mock-up:
//   * left dark-green sidebar (menu + Quick Actions + user card)
//   * greeting header with date-range / Filters / Export controls
//   * dark hero KPI strip (4 KPI tiles + sparklines + Overall-Progress gauge)
//   * 8 colour-themed summary cards (one per dashboard), each linking through
//   * bottom row: District Race (Performance by District + Trends merged into a
//     horse-race target-achievement visual), Value Chain Total Sales
//
// All headline numbers are pulled live from each dashboard's own JSON API so
// they always match the underlying dashboard. Every indicator re-fetches when
// the Cluster + Date filters at the top change, passing ?districts=&from=&to=
// to each dashboard API (which all accept those params).
//
// The page uses the SHARED navy sidebar (navSidebar) — the same one every other
// dashboard uses — so navigation is identical across the whole app.
// ---------------------------------------------------------------------------

import { navSidebar } from './nav';

export function renderHome(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SAYE Uganda — Home</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root{
      --side:#0a4733; --side-2:#083a29; --side-active:#00A859; --side-hover:#0c6444;
      --bg:#F1F5F3; --ink:#12211a; --ink2:#3c4b43; --muted:#8a978f; --line:#e6ece9;
      --green:#00A859; --green-d:#006837; --orange:#F6921E; --blue:#2E9BD6;
      --purple:#8C5CD1; --teal:#12b5a5; --red:#E8556B; --lgreen:#4CB963;
    }
    *{ box-sizing:border-box; }
    body{ margin:0; background:var(--bg); color:var(--ink); font-family:"Inter",system-ui,-apple-system,sans-serif; }
    a{ text-decoration:none; color:inherit; }

    /* ---------- layout (shared navy sidebar handles nav; main is full width) ---------- */
    .main{ min-width:0; }

    /* ---------- filters bar ---------- */
    .filters{ display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
    .fld{ display:flex; flex-direction:column; gap:3px; }
    .fld label{ font-size:9.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:700; }
    .fld select, .fld input{ border:1px solid var(--line); border-radius:9px; padding:8px 10px; font-size:13px; background:#fff; min-width:130px; color:var(--ink); }

    /* ---------- header ---------- */
    .topbar{ display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:20px 26px 6px; }
    .hi{ font-size:24px; font-weight:800; color:#12211a; letter-spacing:-.01em; }
    .hi-sub{ font-size:13px; color:var(--muted); margin-top:2px; }
    .ctl{ display:inline-flex; align-items:center; gap:8px; height:38px; padding:0 14px; border-radius:10px;
          background:#fff; border:1px solid var(--line); font-size:13px; font-weight:600; color:var(--ink2); cursor:pointer; }
    .ctl:hover{ background:#f6faf8; }
    .ctl.primary{ background:var(--green); border-color:var(--green); color:#fff; }
    .ctl.primary:hover{ background:#009c53; }
    .side-toggle{ display:none; }

    .wrap{ padding:6px 26px 30px; }

    /* ---------- hero strip ---------- */
    .hero{ background:linear-gradient(180deg,#0a4733,#083a29); border-radius:18px; padding:18px 20px;
           display:grid; grid-template-columns:repeat(4,1fr) 230px; gap:14px; color:#eafff4; }
    @media (max-width:1500px){ .hero{ grid-template-columns:repeat(4,1fr); } .hero .gauge-tile{ grid-column:1 / -1; justify-content:flex-start; } }
    @media (max-width:820px){ .hero{ grid-template-columns:repeat(2,1fr); } }
    @media (max-width:520px){ .hero{ grid-template-columns:1fr; } }
    .htile{ padding:6px 14px; position:relative; }
    .htile + .htile{ border-left:1px solid rgba(255,255,255,.08); }
    .htile .ico{ width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; color:#fff; margin-bottom:10px; }
    .htile .val{ font-size:27px; font-weight:800; color:#fff; line-height:1; letter-spacing:-.02em; }
    .htile .lab{ font-size:12.5px; color:#a9cdbc; margin-top:4px; font-weight:500; }
    .htile .chg{ font-size:11px; margin-top:8px; font-weight:600; }
    .htile .chg.up{ color:#54e08c; } .htile .chg.flat{ color:#a9cdbc; }
    .htile .spark{ width:100%; height:26px; margin-top:8px; display:block; }
    .gauge-tile{ background:rgba(255,255,255,.05); border-radius:14px; padding:14px; display:flex; align-items:center; gap:12px; }
    .gauge-wrap{ position:relative; width:120px; height:120px; flex:none; }
    .gauge-wrap .pct{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .gauge-wrap .pct .p{ font-size:26px; font-weight:800; color:#fff; line-height:1; }
    .gauge-wrap .pct .t{ font-size:9.5px; color:#a9cdbc; margin-top:3px; text-align:center; }

    /* ---------- summary cards ---------- */
    .cards{ display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-top:16px; }
    @media (max-width:1300px){ .cards{ grid-template-columns:repeat(2,1fr); } }
    @media (max-width:680px){ .cards{ grid-template-columns:1fr; } }
    .card{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px; box-shadow:0 1px 3px rgba(20,40,30,.05); }
    .card-h{ display:flex; align-items:center; gap:9px; margin-bottom:12px; }
    .card-h .ci{ width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px; flex:none; }
    .card-h .ct{ font-size:13.5px; font-weight:700; color:#1a2b22; flex:1; line-height:1.1; }
    .card-h .cv{ font-size:11px; font-weight:600; color:var(--muted); white-space:nowrap; }
    .card-h .cv:hover{ color:var(--green); }
    .card-mainrow{ display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
    .big{ font-size:26px; font-weight:800; color:#12211a; line-height:1; letter-spacing:-.02em; }
    .big-l{ font-size:11.5px; color:var(--muted); font-weight:500; margin-top:4px; }
    .card-art{ width:56px; height:56px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:22px; flex:none; }
    .subs{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:14px; }
    .sub .sn{ font-size:15px; font-weight:800; color:#22332a; line-height:1; }
    .sub .sl{ font-size:10px; color:var(--muted); margin-top:3px; line-height:1.15; }
    .card-foot{ margin-top:12px; font-size:11px; font-weight:600; color:var(--green); }
    .skel{ color:#c3d3ca !important; }

    /* ---------- bottom row ---------- */
    .bottom{ display:grid; grid-template-columns:2.15fr 1fr; gap:16px; margin-top:16px; }
    @media (max-width:1200px){ .bottom{ grid-template-columns:1fr; } }
    /* District Race */
    .race-panel{ display:flex; flex-direction:column; }
    .race-sub{ font-size:11.5px; color:var(--muted); margin:-4px 0 10px; }
    .race-wrap{ width:100%; }
    #raceTrack svg{ display:block; width:100%; height:auto; }
    .race-legend{ display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:8px 16px; margin-top:14px; }
    .rl-row{ display:flex; align-items:center; gap:9px; font-size:12px; }
    .rl-dot{ width:11px; height:11px; border-radius:50%; flex:none; }
    .rl-name{ font-weight:700; color:#1a2b22; }
    .rl-stat{ margin-left:auto; color:var(--muted); font-variant-numeric:tabular-nums; }
    .rl-pct{ font-weight:800; min-width:38px; text-align:right; font-variant-numeric:tabular-nums; }
    .panel{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px; box-shadow:0 1px 3px rgba(20,40,30,.05); }
    .panel-h{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .panel-h .pt{ font-size:14px; font-weight:700; color:#1a2b22; }
    .panel-h .pl{ font-size:11px; font-weight:600; color:var(--muted); }
    .trend-wrap{ position:relative; width:100%; height:220px; }
    .trend-wrap canvas{ position:absolute; inset:0; width:100% !important; height:100% !important; }
    table.dist{ width:100%; border-collapse:collapse; }
    table.dist th{ text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); padding:6px 6px; border-bottom:1px solid var(--line); }
    table.dist th.num, table.dist td.num{ text-align:right; }
    table.dist td{ padding:6px 6px; font-size:12px; border-bottom:1px solid #f1f5f2; }
    table.dist tr:last-child td{ font-weight:800; background:#f6faf8; }
    .ach{ display:flex; align-items:center; gap:6px; justify-content:flex-end; }
    .ach-bar{ width:56px; height:7px; border-radius:4px; background:#e9efeb; overflow:hidden; }
    .ach-fill{ height:100%; background:var(--green); border-radius:4px; }
    .act{ display:flex; gap:10px; padding:9px 0; border-bottom:1px solid #f1f5f2; }
    .act:last-child{ border-bottom:0; }
    .act .ai{ width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:12px; color:#fff; flex:none; }
    .act .at{ font-size:12.5px; font-weight:600; color:#22332a; line-height:1.25; }
    .act .am{ font-size:10.5px; color:var(--muted); margin-top:2px; }
    /* Value Chain Total Sales list */
    .vc-row{ display:flex; gap:10px; align-items:center; padding:9px 0; border-bottom:1px solid #f1f5f2; }
    .vc-row:last-child{ border-bottom:0; }
    .vc-ic{ width:30px; height:30px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:13px; color:#fff; flex:none; }
    .vc-main{ flex:1; min-width:0; }
    .vc-top{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
    .vc-name{ font-size:12.5px; font-weight:600; color:#22332a; }
    .vc-val{ font-size:12.5px; font-weight:700; color:#14432c; white-space:nowrap; }
    .vc-bar{ height:7px; border-radius:4px; background:#e9efeb; overflow:hidden; margin:5px 0 3px; }
    .vc-fill{ height:100%; border-radius:4px; }
    .vc-sub{ font-size:10.5px; color:var(--muted); }
  </style>
</head>
<body>
${navSidebar('home')}
  <div class="main">
      <div class="topbar">
        <div style="flex:1;min-width:200px">
          <div class="hi">Welcome back, Drake <span style="font-weight:400">👋</span></div>
          <div class="hi-sub"><span id="kpiStamp">Here's what's happening with SAYE Uganda today.</span></div>
        </div>
        <button class="ctl primary" id="exportBtn"><i class="fas fa-download"></i> Export</button>
        <button class="ctl" id="refreshBtn" title="Refresh KPIs"><i class="fas fa-rotate"></i></button>
      </div>

      <!-- ==================== FILTERS ==================== -->
      <div class="topbar" style="padding-top:0">
        <div class="filters">
          <div class="fld"><label>Cluster</label>
            <select id="fCluster">
              <option value="all">All clusters</option>
              <option value="iganga">Iganga Cluster</option>
              <option value="kamuli">Kamuli Cluster</option>
              <option value="bugiri">Bugiri Cluster</option>
              <option value="central">Central Cluster</option>
            </select>
          </div>
          <div class="fld"><label>Month</label>
            <select id="fMonth">
              <option value="">— pick a month —</option>
            </select>
          </div>
          <div class="fld"><label>From</label><input type="date" id="fFrom" /></div>
          <div class="fld"><label>To</label><input type="date" id="fTo" /></div>
          <button class="ctl primary" id="fApply"><i class="fas fa-filter"></i> Apply</button>
          <button class="ctl" id="fYear">Reporting year</button>
          <button class="ctl" id="fReset">All time</button>
        </div>
      </div>

      <div class="wrap">

        <!-- ---------- HERO KPI STRIP ---------- -->
        <section class="hero">
          <div class="htile">
            <div class="ico" style="background:var(--green)"><i class="fas fa-users"></i></div>
            <div class="val skel" data-f="hero.youth">…</div>
            <div class="lab">Youth Trained</div>
            <div class="chg up" data-f="hero.youth_chg">↑ — vs last month</div>
            <canvas class="spark" data-spark="youth" data-color="#54e08c"></canvas>
          </div>
          <div class="htile">
            <div class="ico" style="background:var(--orange)"><i class="fas fa-venus"></i></div>
            <div class="val skel" data-f="hero.female">…</div>
            <div class="lab">Female Reached</div>
            <div class="chg up" data-f="hero.female_chg">↑ — vs last month</div>
            <canvas class="spark" data-spark="female" data-color="#f6b45a"></canvas>
          </div>
          <div class="htile">
            <div class="ico" style="background:var(--purple)"><i class="fas fa-wheelchair"></i></div>
            <div class="val skel" data-f="hero.pwds">…</div>
            <div class="lab">PWDs Trained</div>
            <div class="chg up" data-f="hero.pwds_chg">↑ — vs last month</div>
            <canvas class="spark" data-spark="pwds" data-color="#b48ce0"></canvas>
          </div>
          <div class="htile">
            <div class="ico" style="background:var(--blue)"><i class="fas fa-bullseye"></i></div>
            <div class="val skel" data-f="hero.target">…</div>
            <div class="lab" title="Planned new-youth reach for one month = Monthly_SHGs × 25 participants (from the reach-target table). The gauge below shows the current month's pace against this.">Monthly Target <i class="fas fa-circle-info" style="font-size:8px;opacity:.6"></i></div>
            <div class="chg flat" data-f="hero.target_chg">— of last-month pace</div>
            <canvas class="spark" data-spark="target" data-color="#5ab6e0"></canvas>
          </div>
          <div class="gauge-tile">
            <div class="gauge-wrap">
              <canvas id="gaugeChart" width="120" height="120"></canvas>
              <div class="pct"><div class="p" id="gaugePct">—</div><div class="t">of last<br/>month</div></div>
            </div>
            <div>
              <div style="font-size:12px;color:#a9cdbc;font-weight:600;margin-bottom:4px" title="Latest month's new reach ÷ previous month's new reach × 100. 100% means this month is keeping pace with last month.">Monthly Pace <i class="fas fa-circle-info" style="font-size:9px;opacity:.7"></i></div>
              <div style="font-size:12px;color:#eafff4;font-weight:700" id="gaugeFrac">— / —</div>
              <div style="font-size:10.5px;color:#7fbf9f;margin-top:6px">Latest month ÷ previous month (new reach)</div>
            </div>
          </div>
        </section>

        <!-- ---------- SUMMARY CARDS ---------- -->
        <section class="cards" id="cards"></section>

        <!-- ---------- BOTTOM ROW ---------- -->
        <section class="bottom">
          <!-- District Race — Participant Target Achievement (merges Performance
               by District + Trends): each district is a jockey positioned along
               the track by its % of the participant reach target (Oct 2025 – Sep 2026).
               The one that crosses the FINISH line (100%) has met its target. -->
          <div class="panel race-panel">
            <div class="panel-h">
              <div class="pt"><i class="fas fa-horse-head" style="color:var(--green);margin-right:6px"></i>District Race — Participant Target Achievement</div>
              <a class="pl" href="/monthly-new-youth">View all →</a>
            </div>
            <div class="race-sub" id="raceSub">New youth reached vs reach target · racing to 100% (FINISH)</div>
            <div class="race-wrap"><div id="raceTrack"><div style="color:var(--muted);font-size:12px;padding:30px 0;text-align:center">Loading race…</div></div></div>
            <div class="race-legend" id="raceLegend"></div>
          </div>
          <!-- Value Chain Total Sales -->
          <div class="panel">
            <div class="panel-h"><div class="pt">Value Chain Total Sales</div><span class="pl">UGX sold per chain</span></div>
            <div id="valueChains"><div style="color:var(--muted);font-size:12px;padding:8px 0">Loading…</div></div>
          </div>
        </section>

      </div>
  </div>

  <script>
    // ---------------- helpers ----------------
    const fmt = (n) => (Number(n)||0).toLocaleString('en-US');
    const compact = (v)=>{ const n=Number(v)||0; if(Math.abs(n)>=1e9)return (n/1e9).toFixed(2)+'B'; if(Math.abs(n)>=1e6)return (n/1e6).toFixed(2)+'M'; if(Math.abs(n)>=1e3)return (n/1e3).toFixed(1)+'K'; return fmt(n); };
    const setF = (path,val,f)=>{ document.querySelectorAll('[data-f="'+path+'"]').forEach(el=>{ el.classList.remove('skel'); el.textContent=(f||fmt)(val); }); };
    const arrLen = (a)=>Array.isArray(a)?a.length:0;
    // Always bypass HTTP cache so a filter change re-fetches fresh data (a repeated
    // querystring must not be served from the browser/CDN cache — that was making the
    // dashboard look like it "didn't respond" to the cluster/date filters).
    async function j(url){ const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }

    // ---------------- filters ----------------
    // Cluster → district list (single source of truth, matches clusters.ts).
    const CLUSTER_DISTRICTS = {
      all:[],
      iganga:['IGANGA','JINJA','JINJA CITY','MAYUGE','LUUKA'],
      kamuli:['KAMULI','KALIRO','BUYENDE'],
      bugiri:['BUGIRI','NAMUTUMBA','NAMAYINGO','BUGWERI'],
      central:['MUKONO','BUIKWE','KAYUNGA']
    };
    // Build the shared ?districts=&from=&to= querystring from the current filters.
    function filterQS(){
      const cl=(document.getElementById('fCluster')||{}).value||'all';
      const from=(document.getElementById('fFrom')||{}).value||'';
      const to=(document.getElementById('fTo')||{}).value||'';
      const qs=new URLSearchParams();
      const ds=CLUSTER_DISTRICTS[cl]||[];
      if(ds.length) qs.set('districts', ds.join(','));
      if(from) qs.set('from', from);
      if(to) qs.set('to', to);
      const s=qs.toString();
      return s ? ('?'+s) : '';
    }
    // Append the filter querystring to a dashboard API path.
    function api(path){ const q=filterQS(); if(!q) return path; return path + (path.includes('?')?'&':'') + q.slice(1); }

    // ---------------- summary card definitions ----------------
    // Each renders a themed card; subs are filled by the loaders via data-f.
    const CARDS = [
      { key:'cluster', title:'Cluster Trainings', href:'/cluster-trainings', color:'var(--green)', icon:'fa-chart-simple', art:'fa-chart-column',
        big:['cluster.total_trained','Youth Trained'],
        subs:[['cluster.groups_reached','Groups Reached'],['cluster.female_reached','Female Reached'],['cluster.pwds_trained','PWDs Trained']] },
      { key:'newyouth', title:'Monthly New Youth Reached', href:'/monthly-new-youth', color:'var(--orange)', icon:'fa-user-plus', art:'fa-arrow-trend-up',
        big:['newyouth.new_total_reach','New Total Reach'],
        subs:[['newyouth.new_female_reach','New Female Reach'],['newyouth.new_pwds_reach','New PWDs Reach'],['newyouth.monthly_target','Monthly Target']] },
      { key:'frontliners', title:'Trainings by Frontliners', href:'/frontliners', color:'var(--blue)', icon:'fa-chalkboard-user', art:'fa-users',
        big:['frontliners.frontliners','Frontliners'],
        subs:[['frontliners.youth_trained','Youth Trained'],['frontliners.female_reached','Female Reached'],['frontliners.pwds_trained','PWDs Trained']] },
      { key:'distribution', title:'Distribution to Participants', href:'/distribution', color:'var(--teal)', icon:'fa-boxes-stacked', art:'fa-box-open',
        big:['distribution.new_distributees','New Distributions'],
        subs:[['distribution.districts','Districts'],['distribution.materials','Material Types'],['distribution.rows','SHG Groups']] },
      { key:'shgdist', title:'Distribution to SHGs', href:'/shg-distribution', color:'var(--green-d)', icon:'fa-people-carry-box', art:'fa-people-group',
        big:['shgdist.shgs_reached','SHGs Reached'],
        subs:[['shgdist.records_count','Distribution Records'],['shgdist.total_qty','Total Quantity'],['shgdist.districts','Districts']] },
      { key:'profiling', title:'SHG Profiling', href:'/shg-profiling', color:'var(--orange)', icon:'fa-address-card', art:'fa-id-card',
        big:['profiling.new_shgs_profiles','SHG Profiles'],
        subs:[['profiling.monthly_shgs','Monthly SHGs'],['profiling.profilers','Profilers'],['profiling.districts','Districts']] },
      { key:'isla', title:'ISLA Savings', href:'/isla', color:'var(--red)', icon:'fa-piggy-bank', art:'fa-coins',
        big:['isla.savings_value','Savings Value (UGX)'],
        subs:[['isla.total_fund','Total Fund (UGX)'],['isla.shg_count','SHGs Saving'],['isla.loans','Loans (UGX)']], money:true },
      { key:'production', title:'Production (Horticulture)', href:'/production', color:'var(--lgreen)', icon:'fa-seedling', art:'fa-leaf',
        big:['production.new_participants','New Participants'],
        subs:[['production.unique_participants','Unique Participants'],['production.unique_shgs','Unique SHGs'],['production.districts','Districts']] },
    ];

    function renderCards(){
      const host = document.getElementById('cards');
      host.innerHTML = CARDS.map(c=>{
        const money = c.money;
        const bigFmt = money ? 'data-money="1"' : '';
        const subCells = c.subs.map(([f,l])=>(
          '<div class="sub"><div class="sn skel" data-f="'+f+'" '+(money?'data-money="1"':'')+'>…</div><div class="sl">'+l+'</div></div>'
        )).join('');
        return (
          '<a class="card" href="'+c.href+'">'
          + '<div class="card-h"><span class="ci" style="background:'+c.color+'"><i class="fas '+c.icon+'"></i></span>'
          +   '<span class="ct">'+c.title+'</span><span class="cv">View details →</span></div>'
          + '<div class="card-mainrow"><div><div class="big skel" data-f="'+c.big[0]+'" '+bigFmt+'>…</div>'
          +   '<div class="big-l">'+c.big[1]+'</div></div>'
          +   '<div class="card-art" style="background:'+c.color+'1a;color:'+c.color+'"><i class="fas '+c.art+'"></i></div></div>'
          + '<div class="subs">'+subCells+'</div>'
          + '<div class="card-foot" data-f="'+c.key+'.foot">&nbsp;</div>'
          + '</a>'
        );
      }).join('');
    }

    // money-aware setter
    function setMoney(path,val){ document.querySelectorAll('[data-f="'+path+'"][data-money]').forEach(el=>{ el.classList.remove('skel'); el.textContent='UGX '+compact(val); }); document.querySelectorAll('[data-f="'+path+'"]:not([data-money])').forEach(el=>{ el.classList.remove('skel'); el.textContent=fmt(val); }); }

    // ---------------- sparklines & charts ----------------
    let sparks={};
    function drawSpark(name, series, color){
      const cv=document.querySelector('canvas[data-spark="'+name+'"]'); if(!cv) return;
      if(sparks[name]) sparks[name].destroy();
      const data = (series&&series.length)?series:[3,4,4,5,6,6,7,8];
      sparks[name]=new Chart(cv,{ type:'line', data:{ labels:data.map((_,i)=>i), datasets:[{ data, borderColor:color, borderWidth:2, fill:true,
        backgroundColor:(ctx)=>{ const g=ctx.chart.ctx.createLinearGradient(0,0,0,26); g.addColorStop(0,color+'55'); g.addColorStop(1,color+'00'); return g; },
        tension:.4, pointRadius:0 }] },
        options:{ responsive:false, plugins:{legend:{display:false},tooltip:{enabled:false}}, scales:{x:{display:false},y:{display:false}}, elements:{line:{borderJoinStyle:'round'}} } });
      cv.width=cv.parentElement.clientWidth-28; cv.height=26;
    }

    let gauge=null;
    function drawGauge(pct){
      const el=document.getElementById('gaugeChart'); if(!el) return;
      const p=Math.max(0,Math.min(100,Math.round(pct)));
      if(gauge) gauge.destroy();
      gauge=new Chart(el,{ type:'doughnut', data:{ datasets:[{ data:[p,100-p], backgroundColor:['#3ce07f','rgba(255,255,255,.12)'], borderWidth:0, circumference:270, rotation:225 }] },
        options:{ cutout:'75%', responsive:false, plugins:{legend:{display:false},tooltip:{enabled:false}} } });
      document.getElementById('gaugePct').textContent=p+'%';
    }

    let trend=null;
    function drawTrend(labels, datasets){
      const el=document.getElementById('trendChart'); if(!el) return;
      if(trend) trend.destroy();
      trend=new Chart(el,{ type:'line', data:{ labels, datasets }, options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:true, position:'top', labels:{ boxWidth:10, font:{size:10}, color:'#3c4b43' } } },
        scales:{ x:{ grid:{display:false}, ticks:{font:{size:9},color:'#8a978f'} }, y:{ grid:{color:'#eef3f0'}, ticks:{font:{size:9},color:'#8a978f',callback:v=>compact(v)} } },
        elements:{ point:{radius:0}, line:{tension:.35,borderWidth:2} } } });
    }

    // ---------------- data loaders ----------------
    const heroState = { youth:null, female:null, pwds:null, target:null, reach:null };
    function pctChange(el, txt){ setF(el, txt, x=>x); }

    const loaders = {
      async cluster(){
        const d=await j(api('/api/cluster-trainings'));
        setF('cluster.total_trained', d.total_trained);
        setF('cluster.groups_reached', d.groups_reached);
        setF('cluster.female_reached', d.female_reached);
        setF('cluster.pwds_trained', d.pwds_trained);
        // hero tiles
        heroState.youth=d.total_trained; heroState.female=d.female_reached; heroState.pwds=d.pwds_trained;
        setF('hero.youth', d.total_trained); setF('hero.female', d.female_reached); setF('hero.pwds', d.pwds_trained);
      },
      async newyouth(){
        const d=await j(api('/api/new-youth'));
        setF('newyouth.new_total_reach', d.new_total_reach);
        setF('newyouth.new_female_reach', d.new_female_reach);
        setF('newyouth.new_pwds_reach', d.new_pwds_reach);
        setF('newyouth.monthly_target', d.monthly_target);
        heroState.target=d.monthly_target; heroState.reach=d.new_total_reach;
        setF('hero.target', d.monthly_target);
        // District Race: each district is a jockey positioned by its % of the
        // reach target. Merges the old Performance-by-District table + Trends chart
        // into one racing visual. Source of truth = the Report dashboard's
        // "Reach: Targets vs Achieved" table (/api/report → reach). That table is a
        // reporting-year (Oct 1 2025 – Sep 30 2026) achievement, so the race ALWAYS
        // pins that window — the home page's global date filter defaults to all-time,
        // which would over-count reach against the Year-3 target and inflate the %.
        // If the user has explicitly picked a from/to on the home filter, honour it.
        try{
          const rf=(document.getElementById('fFrom')||{}).value;
          const rt=(document.getElementById('fTo')||{}).value;
          const from = rf || '2025-10-01';
          const to   = rt || '2026-09-30';
          const cl=(document.getElementById('fCluster')||{}).value||'all';
          const ds=CLUSTER_DISTRICTS[cl]||[];
          const qs=new URLSearchParams();
          if(ds.length) qs.set('districts', ds.join(','));
          qs.set('from', from); qs.set('to', to);
          const rep=await j('/api/report?'+qs.toString());
          renderDistrictRace((rep&&rep.reach)||d.by_district||[]);
          const rsub=document.getElementById('raceSub');
          if(rsub){
            const per=(rf&&rt)?(rf+' → '+rt):'Oct 1 2025 – Sep 30 2026';
            rsub.textContent='New Youth Reached vs reach target · '+per+' · racing to 100% (FINISH)';
          }
        }catch(_){ renderDistrictRace(d.by_district||[]); }

        // by_date is a daily series of {date, value} (new reach per day).
        const bd=(d.by_date||[]).filter(r=>r && r.date);
        // Gauge = current (partial) month's reach vs the previous full month's reach — a
        // monthly PACE indicator that is always meaningful and naturally sits in a sensible
        // range (the raw "monthly_target" field is a far-smaller sub-target and cannot be
        // compared to actual monthly reach, so we use month-over-month pace instead).
        const byMonth={};
        bd.forEach(r=>{ const m=String(r.date).slice(0,7); byMonth[m]=(byMonth[m]||0)+(Number(r.value)||0); });
        const months=Object.keys(byMonth).sort();
        const curM = months.length ? byMonth[months[months.length-1]] : 0;
        const prevM = months.length>1 ? byMonth[months[months.length-2]] : 0;
        const paceRaw = prevM>0 ? (100*curM/prevM) : (curM>0?100:0);
        const pct = Math.max(0, Math.min(100, paceRaw));
        drawGauge(pct);
        document.getElementById('gaugeFrac').textContent = fmt(curM)+' / '+fmt(prevM||curM);
        pctChange('hero.target_chg', (prevM>0?Math.round(paceRaw):100)+'% of last-month pace');

        // Trends line chart + sparklines from the daily value series.
        if(bd.length){
          const recent=bd.slice(-30);
          const labels=recent.map(r=>String(r.date).slice(5));
          const reachSeries=recent.map(r=>Number(r.value)||0);
          drawTrend(labels,[
            { label:'New Reach', data:reachSeries, borderColor:'#F6921E', backgroundColor:'#F6921E22', fill:true },
          ]);
          const allVals=bd.map(r=>Number(r.value)||0);
          drawSpark('youth',  allVals.slice(-14), '#54e08c');
          drawSpark('female', allVals.slice(-14), '#f6b45a');
          drawSpark('pwds',   allVals.slice(-14), '#b48ce0');
          drawSpark('target', allVals.slice(-14), '#5ab6e0');
        }
      },
      async frontliners(){
        const d=await j(api('/api/frontliners'));
        const rows=d.rows||[]; let y=0,f=0,p=0;
        for(const r of rows){ y+=Number(r.youth_trained)||0; f+=Number(r.female_reached)||0; p+=Number(r.pwds_trained)||0; }
        setF('frontliners.frontliners', rows.length);
        setF('frontliners.youth_trained', y);
        setF('frontliners.female_reached', f);
        setF('frontliners.pwds_trained', p);
      },
      async distribution(){
        const d=await j(api('/api/distribution'));
        setF('distribution.new_distributees', d.new_distributees);
        setF('distribution.districts', arrLen(d.districts));
        setF('distribution.materials', arrLen(d.materials));
        setF('distribution.rows', arrLen(d.rows));
      },
      async shgdist(){
        const d=await j(api('/api/shg-distribution'));
        setF('shgdist.shgs_reached', d.shgs_reached);
        setF('shgdist.records_count', d.records_count);
        setF('shgdist.total_qty', Math.round(d.total_qty||0));
        setF('shgdist.districts', arrLen(d.districts));
      },
      async profiling(){
        const d=await j(api('/api/shg-profiling'));
        setF('profiling.new_shgs_profiles', d.new_shgs_profiles);
        setF('profiling.monthly_shgs', d.monthly_shgs);
        setF('profiling.profilers', arrLen(d.profilers));
        setF('profiling.districts', arrLen(d.districts));
      },
      async isla(){
        const d=await j(api('/api/isla')); const t=d.total||{};
        setMoney('isla.savings_value', t.savings_value);
        setMoney('isla.total_fund', t.total_fund);
        setF('isla.shg_count', t.shg_count!=null?t.shg_count:d.shg_saving);
        // "Loans (UGX)" must show the monetary VALUE of loans given, not the
        // borrower COUNT (t.loans). Prefer loans_value; fall back to
        // youth_loans_value_given for older API responses.
        setMoney('isla.loans', t.loans_value!=null?t.loans_value:(t.youth_loans_value_given!=null?t.youth_loans_value_given:0));
      },
      async production(){
        const d=await j(api('/api/production'));
        setF('production.new_participants', d.new_participants);
        setF('production.unique_participants', d.unique_participants);
        setF('production.unique_shgs', d.unique_shgs);
        setF('production.districts', arrLen(d.districts));
      },
      async valuechains(){
        const d=await j(api('/api/value-chain-sales'));
        renderValueChains(d.chains||[]);
      },
    };

    // ---- District Race (horse-race target achievement) --------------------
    // Palette cycled across districts (distinct, print-friendly).
    const RACE_COLORS = ['#e08a2b','#d94b3f','#2fae76','#2E9BD6','#7c5cbf','#e0a23a','#1f9e94','#c0392b','#3a5bb0','#8a6d3b'];
    // A reusable jockey-on-horse symbol (grey horse + colored rider), from the
    // client's Napkin racing artwork. Scaled to ~0.42 so several fit on the track.
    function raceHorseSVG(color){
      return '<g class="racer">'+
        '<g stroke="#b0b6bc" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round">'+
          '<path d="M110 55 C130 25 155 8 178 12 C192 15 198 26 190 36 C184 43 172 43 165 35"/>'+
          '<path d="M190 36 L200 40"/><path d="M150 18 L158 2"/>'+
          '<path d="M110 55 C80 48 45 46 15 58"/><path d="M15 58 C8 62 2 68 -2 76"/>'+
          '<path d="M108 58 C104 70 100 82 92 92"/>'+
          '<path d="M-2 60 C-25 55 -35 72 -28 95 C-24 108 -12 112 -6 104"/>'+
          '<path d="M92 90 C100 105 108 112 106 135"/><path d="M85 92 C78 106 82 118 70 138"/>'+
          '<path d="M20 62 C16 80 24 92 14 115"/><path d="M0 72 C-18 82 -28 92 -35 112"/>'+
        '</g>'+
        '<g stroke="'+color+'" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round">'+
          '<circle cx="118" cy="0" r="15"/>'+
          '<path d="M104 -6 C112 -14 128 -14 134 -4"/>'+
          '<path d="M112 14 C88 20 72 36 66 55"/>'+
          '<path d="M92 30 C110 20 130 18 150 14"/>'+
          '<path d="M70 52 C58 60 54 72 62 82 L82 80"/>'+
        '</g></g>';
    }

    // Normalise API district rows → {name, trained, target, pct}. Accepts the
    // /report "reach" shape ({district, achieved, target, pct}) as the source of
    // truth, and also tolerates the /new-youth by_district shape ({trained,
    // achieved_pct}). pct is null when no reach target exists for that district.
    function normRaceRows(rows){
      const out=[];
      for(const r of (rows||[])){
        if(typeof r==='string') continue;
        const name=r.district||r.name||r.district_name||r.label||'';
        const trained=Number(r.achieved!=null?r.achieved:(r.trained||r.total_trained||r.youth_trained||r.count||r.total||0));
        const target=Number(r.target||r.monthly_target||0);
        let pct = (r.pct!=null) ? Number(r.pct)
                : (r.achieved_pct!=null) ? Number(r.achieved_pct)
                : (target>0 ? (100*trained/target) : null);
        if(pct!=null) pct=Math.round(pct);
        if(name) out.push({ name: name.replace(/\\b\\w/g,c=>c.toUpperCase()).replace(/City/i,'City'), trained, target, pct });
      }
      // Rank by progress (highest % first); target-less districts sink to the bottom.
      out.sort((a,b)=>((b.pct==null?-1:b.pct)-(a.pct==null?-1:a.pct)) || (b.trained-a.trained));
      return out;
    }

    // Draw the horse-race SVG + a legend of exact figures.
    // ALL districts race along ONE shared ground line; each horse is positioned
    // by its % of the reach target (0% at startX, 100% at the FINISH). Each
    // district's name + % sits on TOP of its own horse. Districts that have no
    // reach target (target = 0) don't race — they're listed in the legend only.
    function renderDistrictRace(rows){
      const track=document.getElementById('raceTrack');
      const legend=document.getElementById('raceLegend');
      if(!track) return;
      const all=normRaceRows(rows);
      const racers=all.filter(d=>d.pct!=null && d.target>0);   // only target-bearing districts race
      if(!all.length){
        track.innerHTML='<div style="color:var(--muted);font-size:12px;padding:30px 0;text-align:center">No district reach data for this selection.</div>';
        if(legend) legend.innerHTML=''; return;
      }

      // Single-line geometry (matches the reference artwork): every horse stands on
      // ONE shared ground line, positioned horizontally by its % of the reach target
      // (0% at startX, 100% at the FINISH). Horses are small. Each carries its own
      // "District · NN%" label on top; when two horses sit close, their labels are
      // stacked at alternating heights so they stay readable.
      const W=1000, top=120, bottom=52, groundY=380;
      const startX=60, finishX=690;              // 0% at startX, 100% at FINISH box left edge
      const scale=0.30;                          // small horses
      const horseH=150*scale;                    // rendered horse height (~45)
      const H=groundY+bottom;
      const span=finishX-startX;
      const xFor=(pct)=>{ const p=Math.max(0,Math.min(115,(pct==null?0:pct))); return startX + span*(p/100); };

      let svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="District participant target race" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">';

      // shared ground line + direction arrow
      svg+='<line x1="'+startX+'" y1="'+groundY+'" x2="'+(W-30)+'" y2="'+groundY+'" stroke="#b8bfba" stroke-width="3"/>';
      svg+='<polyline points="'+(W-42)+','+(groundY-11)+' '+(W-24)+','+groundY+' '+(W-42)+','+(groundY+11)+'" fill="none" stroke="#b8bfba" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
      // % gridlines + axis labels
      [0,25,50,75].forEach(g=>{ const gx=xFor(g); if(g>0) svg+='<line x1="'+gx+'" y1="'+(top-8)+'" x2="'+gx+'" y2="'+groundY+'" stroke="#eef1ef" stroke-width="2"/>'; svg+='<text x="'+gx+'" y="'+(groundY+24)+'" text-anchor="middle" font-size="12" fill="#aeb6b1">'+g+'%</text>'; });
      svg+='<line x1="'+startX+'" y1="'+(top-8)+'" x2="'+startX+'" y2="'+groundY+'" stroke="#c9cfd4" stroke-width="2" stroke-dasharray="4 4"/>';

      // FINISH box (100% line)
      const fbw=W-finishX-30;
      svg+='<rect x="'+finishX+'" y="'+(top-8)+'" width="'+fbw+'" height="'+(groundY-(top-8))+'" fill="none" stroke="#2b2b2b" stroke-width="2.5"/>';
      svg+='<rect x="'+finishX+'" y="'+(top-8)+'" width="'+fbw+'" height="40" fill="#f0f0f0" stroke="#2b2b2b" stroke-width="2.5"/>';
      svg+='<text x="'+(finishX+fbw/2)+'" y="'+(top+19)+'" text-anchor="middle" font-size="18" font-weight="700" letter-spacing="2" fill="#9a9a9a">FINISH</text>';
      svg+='<text x="'+(finishX+fbw/2)+'" y="'+(groundY+24)+'" text-anchor="middle" font-size="12" fill="#aeb6b1">100%</text>';

      // draw racers left→right so higher-% horses overlap in front; labels stacked to avoid clashes
      const ordered=racers.slice().sort((a,b)=>a.pct-b.pct);
      let lastLx=-999, tierToggle=0;
      ordered.forEach((d)=>{
        const i=racers.indexOf(d);                       // stable colour by rank
        const color=RACE_COLORS[i%RACE_COLORS.length];
        const rx=xFor(d.pct);
        // the small racer, hooves on the shared ground line
        svg+='<g transform="translate('+(rx-70*scale)+' '+(groundY-horseH)+') scale('+scale+')">'+raceHorseSVG(color)+'</g>';
        // label ON TOP; stack alternately if this horse is horizontally close to the previous one
        const done=d.pct>=100;
        const pcol=done?'#2fae76':color;
        if(rx-lastLx < 110){ tierToggle=(tierToggle+1)%3; } else { tierToggle=0; }
        lastLx=rx;
        const labelY=(groundY-horseH-12) - tierToggle*22;   // lift stacked labels higher
        const nearFinish = rx > finishX-30;
        const anchor = nearFinish ? 'end' : 'middle';
        const lx = nearFinish ? finishX-8 : rx;
        // small connector when the label is lifted well above the horse
        if(tierToggle>0) svg+='<line x1="'+rx+'" y1="'+(labelY+6)+'" x2="'+rx+'" y2="'+(groundY-horseH-4)+'" stroke="'+color+'" stroke-width="1" opacity="0.4"/>';
        svg+='<text text-anchor="'+anchor+'" x="'+lx+'" y="'+labelY+'" font-size="13.5" font-weight="800" fill="#1a2b22">'+d.name+' · <tspan fill="'+pcol+'">'+d.pct+'%'+(done?' ✓':'')+'</tspan></text>';
      });

      svg+='</svg>';
      track.innerHTML=svg;

      // Legend with exact figures (all districts, incl. those with no target).
      if(legend){
        legend.innerHTML=all.map((d)=>{
          const i=racers.indexOf(d);
          const color = i>=0 ? RACE_COLORS[i%RACE_COLORS.length] : '#c3cbc6';
          const stat = d.target>0 ? (fmt(d.trained)+' / '+fmt(d.target)) : (fmt(d.trained)+' reached');
          const pc = d.pct==null?'—':(d.pct+'%');
          const pcol = d.pct==null?'#9aa5a0':(d.pct>=100?'#2fae76':(d.pct>=60?'#b46e0a':'#c0392b'));
          return '<div class="rl-row"><span class="rl-dot" style="background:'+color+'"></span>'+
            '<span class="rl-name">'+d.name+'</span>'+
            '<span class="rl-stat">'+stat+'</span>'+
            '<span class="rl-pct" style="color:'+pcol+'">'+pc+'</span></div>';
        }).join('');
      }
    }

    // Value Chain Total Sales — real UGX sold per chain (poultry, oil seeds,
    // tomatoes, watermelon, …), from /api/value-chain-sales. Respects filters.
    const VC_META = {
      'Poultry':      { i:'fa-egg',            c:'#e0a23a' },
      'Oil seeds':    { i:'fa-seedling',       c:'#8a6d3b' },
      'Groundnuts':   { i:'fa-seedling',       c:'#8a6d3b' },
      'Soybean':      { i:'fa-seedling',       c:'#b0902f' },
      'Tomatoes':     { i:'fa-apple-whole',    c:'#d64b3f' },
      'Watermelon':   { i:'fa-lemon',          c:'#3fae5a' },
      'Onions':       { i:'fa-layer-group',    c:'#a05ad0' },
      'Passion Fruit':{ i:'fa-circle',         c:'#7a4fd0' }
    };
    function renderValueChains(chains){
      const host=document.getElementById('valueChains'); if(!host) return;
      const rows=(chains||[]).filter(x=>x && x.chain);
      if(!rows.length){ host.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">No sales recorded for this selection.</div>'; return; }
      const max=Math.max.apply(null, rows.map(r=>Number(r.value)||0)) || 1;
      const ugxC=(n)=>{ n=Number(n)||0; if(n>=1e9) return 'UGX '+(n/1e9).toFixed(2)+'B'; if(n>=1e6) return 'UGX '+(n/1e6).toFixed(1)+'M'; if(n>=1e3) return 'UGX '+(n/1e3).toFixed(0)+'K'; return 'UGX '+fmt(n); };
      host.innerHTML=rows.map(r=>{
        const m=VC_META[r.chain]||{ i:'fa-basket-shopping', c:'var(--teal)' };
        const w=Math.max(3, Math.round(100*(Number(r.value)||0)/max));
        return '<div class="vc-row">'+
          '<span class="vc-ic" style="background:'+m.c+'"><i class="fas '+m.i+'"></i></span>'+
          '<div class="vc-main">'+
            '<div class="vc-top"><span class="vc-name">'+r.chain+'</span><span class="vc-val">'+ugxC(r.value)+'</span></div>'+
            '<div class="vc-bar"><div class="vc-fill" style="width:'+w+'%;background:'+m.c+'"></div></div>'+
            '<div class="vc-sub">'+fmt(r.sellers)+' youth sellers</div>'+
          '</div></div>';
      }).join('');
    }

    // ---------------- orchestration ----------------
    function loadAll(){
      // Reset EVERY value element (by data-f) back to the loading state on each
      // refilter. NB: loaders remove the .skel class after first load, so a plain
      // '.skel' selector would match nothing on the 2nd+ load and the cards would
      // never visibly refresh — making filters look like they "do nothing".
      document.querySelectorAll('[data-f]').forEach(el=>{ el.classList.add('skel'); el.textContent='…'; });
      // Show the district race is refreshing too.
      const raceTrack=document.getElementById('raceTrack');
      if(raceTrack) raceTrack.innerHTML='<div style="color:var(--muted);font-size:12px;padding:30px 0;text-align:center">Loading race…</div>';
      const raceLegend=document.getElementById('raceLegend');
      if(raceLegend) raceLegend.innerHTML='';
      const vcHost=document.getElementById('valueChains');
      if(vcHost) vcHost.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">Loading…</div>';
      // baseline sparklines so the strip never looks empty
      drawSpark('youth', null, '#54e08c'); drawSpark('female', null, '#f6b45a');
      drawSpark('pwds', null, '#b48ce0'); drawSpark('target', null, '#5ab6e0');
      const jobs=Object.entries(loaders).map(([k,fn])=>fn().catch(err=>{ console.error(k,err); }));
      Promise.allSettled(jobs).then(()=>{
        const cl=(document.getElementById('fCluster')||{}).value||'all';
        const clLbl={all:'All clusters',iganga:'Iganga Cluster',kamuli:'Kamuli Cluster',bugiri:'Bugiri Cluster',central:'Central Cluster'}[cl]||'All clusters';
        const from=(document.getElementById('fFrom')||{}).value, to=(document.getElementById('fTo')||{}).value;
        const range = (from&&to) ? (from+' → '+to) : 'all time';
        document.getElementById('kpiStamp').textContent=clLbl+' · '+range+' · updated '+new Date().toLocaleTimeString('en-GB');
        // hero % change placeholders (no month-over-month source yet)
        ['hero.youth_chg','hero.female_chg','hero.pwds_chg'].forEach(f=>{
          const els=document.querySelectorAll('[data-f="'+f+'"]'); els.forEach(e=>{ if(e.textContent.includes('—')) e.textContent='↑ trending vs last month'; });
        });
      });
    }

    renderCards();
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('exportBtn').addEventListener('click', ()=>{ window.location.href='/tools'; });
    // filter controls
    // ---- Month quick-picker ----------------------------------------------
    // Populate a "pick a month" dropdown spanning the reporting year (Oct 2025 –
    // Sep 2026) plus the prior calendar year, so "pick July" is a single click.
    // Selecting a month sets From/To to that month's first/last day and reloads
    // immediately — the user does NOT have to also click Apply.
    (function buildMonthPicker(){
      const sel=document.getElementById('fMonth'); if(!sel) return;
      const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      // Reporting-year months first (Oct 2025 → Sep 2026), then 2025 calendar months.
      const list=[];
      for(let m=9; m<=11; m++) list.push([2025,m]);      // Oct–Dec 2025
      for(let m=0; m<=8;  m++) list.push([2026,m]);      // Jan–Sep 2026
      for(let m=0; m<=11; m++) list.push([2025,m]);      // Jan–Dec 2025 (earlier data)
      const seen={};
      list.forEach(([y,m])=>{
        const key=y+'-'+String(m+1).padStart(2,'0');
        if(seen[key]) return; seen[key]=1;
        const first=key+'-01';
        const last =new Date(y, m+1, 0);
        const lastStr=y+'-'+String(m+1).padStart(2,'0')+'-'+String(last.getDate()).padStart(2,'0');
        const o=document.createElement('option');
        o.value=first+'|'+lastStr;
        o.textContent=MN[m]+' '+y;
        sel.appendChild(o);
      });
      sel.addEventListener('change', ()=>{
        const v=sel.value;
        if(!v){ document.getElementById('fFrom').value=''; document.getElementById('fTo').value=''; loadAll(); return; }
        const [f,t]=v.split('|');
        document.getElementById('fFrom').value=f;
        document.getElementById('fTo').value=t;
        loadAll();
      });
    })();

    document.getElementById('fApply').addEventListener('click', loadAll);
    document.getElementById('fCluster').addEventListener('change', loadAll);
    // Date inputs auto-apply on change (match the cluster dropdown behaviour) so
    // picking a date takes effect immediately — no separate Apply click needed.
    // Changing a date manually also clears the Month quick-picker so it doesn't
    // contradict the shown range.
    document.getElementById('fFrom').addEventListener('change', ()=>{ const m=document.getElementById('fMonth'); if(m) m.value=''; loadAll(); });
    document.getElementById('fTo').addEventListener('change', ()=>{ const m=document.getElementById('fMonth'); if(m) m.value=''; loadAll(); });
    document.getElementById('fYear').addEventListener('click', ()=>{ document.getElementById('fFrom').value='2025-10-01'; document.getElementById('fTo').value='2026-09-30'; const m=document.getElementById('fMonth'); if(m) m.value=''; loadAll(); });
    document.getElementById('fReset').addEventListener('click', ()=>{ document.getElementById('fFrom').value=''; document.getElementById('fTo').value=''; document.getElementById('fCluster').value='all'; const m=document.getElementById('fMonth'); if(m) m.value=''; loadAll(); });
    loadAll();
    window.addEventListener('resize', ()=>{ Object.keys(sparks).forEach(k=>{ const cv=document.querySelector('canvas[data-spark="'+k+'"]'); if(cv){ cv.width=cv.parentElement.clientWidth-28; cv.height=26; } }); });
  </script>
</body>
</html>`;
}
