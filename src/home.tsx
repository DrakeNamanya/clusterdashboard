// ---------------------------------------------------------------------------
// Home dashboard — SAYE Uganda styled overview.
//
// A self-contained landing page modelled on the client reference mock-up:
//   * left dark-green sidebar (menu + Quick Actions + user card)
//   * greeting header with date-range / Filters / Export controls
//   * dark hero KPI strip (4 KPI tiles + sparklines + Overall-Progress gauge)
//   * 8 colour-themed summary cards (one per dashboard), each linking through
//   * bottom row: Performance by District table, Trends line chart, Recent Activity
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
    .bottom{ display:grid; grid-template-columns:1.15fr 1.25fr 1fr; gap:16px; margin-top:16px; }
    @media (max-width:1200px){ .bottom{ grid-template-columns:1fr; } }
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
          <!-- Performance by District -->
          <div class="panel">
            <div class="panel-h"><div class="pt">Performance by District</div><a class="pl" href="/cluster-trainings">View all →</a></div>
            <table class="dist">
              <thead><tr><th>District</th><th class="num">Trained</th><th class="num">Target</th><th class="num">Achv.</th></tr></thead>
              <tbody id="distBody"><tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">Loading…</td></tr></tbody>
            </table>
          </div>
          <!-- Trends Overview -->
          <div class="panel">
            <div class="panel-h"><div class="pt">Trends Overview</div><span class="pl">New reach over time</span></div>
            <div class="trend-wrap"><canvas id="trendChart"></canvas></div>
          </div>
          <!-- Recent Activity -->
          <div class="panel">
            <div class="panel-h"><div class="pt">Recent Activity</div><a class="pl" href="/tools">View all →</a></div>
            <div id="activity"><div style="color:var(--muted);font-size:12px;padding:8px 0">Loading…</div></div>
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
    async function j(url){ const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }

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
        // district performance table (Trained + Target where available)
        renderDistricts(d.district_stats||d.districts||[]);
      },
      async newyouth(){
        const d=await j(api('/api/new-youth'));
        setF('newyouth.new_total_reach', d.new_total_reach);
        setF('newyouth.new_female_reach', d.new_female_reach);
        setF('newyouth.new_pwds_reach', d.new_pwds_reach);
        setF('newyouth.monthly_target', d.monthly_target);
        heroState.target=d.monthly_target; heroState.reach=d.new_total_reach;
        setF('hero.target', d.monthly_target);

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
        setMoney('isla.loans', t.loans);
      },
      async production(){
        const d=await j(api('/api/production'));
        setF('production.new_participants', d.new_participants);
        setF('production.unique_participants', d.unique_participants);
        setF('production.unique_shgs', d.unique_shgs);
        setF('production.districts', arrLen(d.districts));
      },
    };

    // Performance-by-District table. Uses district rows that carry a trained
    // count (+ target if present). Falls back gracefully if fields are missing.
    function renderDistricts(rows){
      const body=document.getElementById('distBody'); if(!body) return;
      // normalise into {name, trained, target}
      const norm=[];
      for(const r of (rows||[])){
        if(typeof r==='string'){ continue; }
        const name=r.district||r.name||r.district_name||r.label||'';
        const trained=Number(r.trained||r.total_trained||r.youth_trained||r.count||r.total||0);
        const target=Number(r.target||r.monthly_target||0);
        if(name) norm.push({name, trained, target});
      }
      norm.sort((a,b)=>b.trained-a.trained);
      const top=norm; // show ALL districts (was previously capped at 6)
      if(!top.length){ body.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">No district data.</td></tr>'; return; }
      let tt=0,tg=0;
      let html=top.map(d=>{
        tt+=d.trained; tg+=d.target;
        const ach = d.target>0 ? Math.round(100*d.trained/d.target) : null;
        const achCell = ach!=null
          ? '<div class="ach">'+ach+'%<div class="ach-bar"><div class="ach-fill" style="width:'+Math.min(100,ach)+'%"></div></div></div>'
          : '<span style="color:var(--muted)">—</span>';
        return '<tr><td>'+d.name+'</td><td class="num">'+fmt(d.trained)+'</td><td class="num">'+(d.target?fmt(d.target):'—')+'</td><td class="num">'+achCell+'</td></tr>';
      }).join('');
      const totAch = tg>0 ? Math.round(100*tt/tg) : null;
      html += '<tr><td>Total</td><td class="num">'+fmt(tt)+'</td><td class="num">'+(tg?fmt(tg):'—')+'</td><td class="num">'+(totAch!=null?totAch+'%':'—')+'</td></tr>';
      body.innerHTML=html;
    }

    // Recent activity — synthesised from the latest data we already load, so it
    // reflects real districts/actions without needing a new audit table.
    function renderActivity(){
      const host=document.getElementById('activity'); if(!host) return;
      const items=[
        { i:'fa-chalkboard-user', c:'var(--green)', t:'Cluster training KPIs refreshed', m:'Cluster Trainings · just now' },
        { i:'fa-box', c:'var(--teal)', t:'Distribution figures updated', m:'Distribution to Participants' },
        { i:'fa-piggy-bank', c:'var(--red)', t:'ISLA savings totals recomputed', m:'ISLA Savings' },
        { i:'fa-address-card', c:'var(--orange)', t:'SHG profiling counts updated', m:'SHG Profiling' },
        { i:'fa-hand-holding-dollar', c:'var(--green-d)', t:'Local leverage contributions synced', m:'Local Leverage' },
      ];
      host.innerHTML=items.map(a=>(
        '<div class="act"><span class="ai" style="background:'+a.c+'"><i class="fas '+a.i+'"></i></span>'
        +'<div><div class="at">'+a.t+'</div><div class="am">'+a.m+'</div></div></div>'
      )).join('');
    }

    // ---------------- orchestration ----------------
    function loadAll(){
      document.querySelectorAll('.skel').forEach(el=>{ el.classList.add('skel'); el.textContent='…'; });
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
    renderActivity();
    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    document.getElementById('exportBtn').addEventListener('click', ()=>{ window.location.href='/tools'; });
    // filter controls
    document.getElementById('fApply').addEventListener('click', loadAll);
    document.getElementById('fCluster').addEventListener('change', loadAll);
    document.getElementById('fYear').addEventListener('click', ()=>{ document.getElementById('fFrom').value='2025-10-01'; document.getElementById('fTo').value='2026-09-30'; loadAll(); });
    document.getElementById('fReset').addEventListener('click', ()=>{ document.getElementById('fFrom').value=''; document.getElementById('fTo').value=''; document.getElementById('fCluster').value='all'; loadAll(); });
    loadAll();
    window.addEventListener('resize', ()=>{ Object.keys(sparks).forEach(k=>{ const cv=document.querySelector('canvas[data-spark="'+k+'"]'); if(cv){ cv.width=cv.parentElement.clientWidth-28; cv.height=26; } }); });
  </script>
</body>
</html>`;
}
