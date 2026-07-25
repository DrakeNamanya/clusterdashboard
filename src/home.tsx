// ---------------------------------------------------------------------------
// Home dashboard — a single overview page that summarises the headline KPIs
// from every other dashboard. It calls each dashboard's own JSON API from the
// browser (so the numbers always match what that dashboard shows) and lays them
// out as grouped KPI cards, each card linking to its full dashboard.
// ---------------------------------------------------------------------------

import { navSidebar } from './nav';

export function renderHome(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Home — SHG Dashboards Overview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{ --navy:#0B3C5D; --ink:#243b53; --muted:#6b7c90; --line:#e7edf3; }
    body{ background:#f3f6f9; color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .grp{ background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 1px 3px rgba(20,40,60,.05); }
    .grp-head{ display:flex; align-items:center; gap:10px; padding:14px 18px; border-bottom:1px solid var(--line); }
    .grp-ico{ width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:15px; }
    .kpi{ padding:14px 16px; border-radius:12px; background:#f7fafc; border:1px solid var(--line); }
    .kpi .n{ font-size:26px; font-weight:800; letter-spacing:-.02em; color:#12263a; line-height:1; }
    .kpi .l{ font-size:12px; color:var(--muted); font-weight:600; margin-top:6px; }
    .open-link{ font-size:12.5px; font-weight:700; color:var(--navy); text-decoration:none; }
    .open-link:hover{ text-decoration:underline; }
    .skel{ color:#b9c6d3; }
  </style>
</head>
<body>
${navSidebar('home')}

  <main class="max-w-[1180px] mx-auto px-4 md:px-6 py-6">

    <!-- Page header -->
    <header class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div class="flex items-center gap-3">
        <span class="grp-ico" style="background:var(--navy)"><i class="fas fa-gauge-high"></i></span>
        <div>
          <h1 class="text-xl md:text-2xl font-extrabold tracking-tight text-[#12263a]">Dashboards Overview</h1>
          <p class="text-sm text-[var(--muted)]">All key KPIs across every dashboard, in one place. Click any panel to open the full dashboard.</p>
        </div>
      </div>
      <button id="refreshBtn" class="text-sm px-4 py-2 rounded-lg bg-[var(--navy)] hover:opacity-90 text-white font-semibold">
        <i class="fas fa-rotate mr-1"></i> Refresh KPIs
      </button>
    </header>

    <div id="statusBar" class="hidden mb-4 text-sm rounded-lg px-4 py-2"></div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">

      <!-- Cluster Trainings -->
      <section class="grp" id="grp-cluster">
        <div class="grp-head">
          <span class="grp-ico" style="background:#12b886"><i class="fas fa-chart-simple"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Cluster Trainings</h2>
          <a class="open-link" href="/cluster-trainings">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="cluster.total_trained">…</div><div class="l">Youth Trained</div></div>
          <div class="kpi"><div class="n skel" data-f="cluster.groups_reached">…</div><div class="l">Groups Reached</div></div>
          <div class="kpi"><div class="n skel" data-f="cluster.female_reached">…</div><div class="l">Female Reached</div></div>
          <div class="kpi"><div class="n skel" data-f="cluster.pwds_trained">…</div><div class="l">PWDs Trained</div></div>
        </div>
      </section>

      <!-- Monthly New Youth -->
      <section class="grp" id="grp-newyouth">
        <div class="grp-head">
          <span class="grp-ico" style="background:#f59f00"><i class="fas fa-user-plus"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Monthly New Youth Reached</h2>
          <a class="open-link" href="/monthly-new-youth">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="newyouth.new_total_reach">…</div><div class="l">New Total Reach</div></div>
          <div class="kpi"><div class="n skel" data-f="newyouth.new_female_reach">…</div><div class="l">New Female Reach</div></div>
          <div class="kpi"><div class="n skel" data-f="newyouth.new_pwds_reach">…</div><div class="l">New PWDs Reach</div></div>
          <div class="kpi"><div class="n skel" data-f="newyouth.monthly_target">…</div><div class="l">Monthly Target</div></div>
        </div>
      </section>

      <!-- Trainings by Frontliners -->
      <section class="grp" id="grp-frontliners">
        <div class="grp-head">
          <span class="grp-ico" style="background:#1c7ed6"><i class="fas fa-table"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Trainings by Frontliners</h2>
          <a class="open-link" href="/frontliners">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="frontliners.frontliners">…</div><div class="l">Frontliners</div></div>
          <div class="kpi"><div class="n skel" data-f="frontliners.youth_trained">…</div><div class="l">Youth Trained</div></div>
          <div class="kpi"><div class="n skel" data-f="frontliners.female_reached">…</div><div class="l">Female Reached</div></div>
          <div class="kpi"><div class="n skel" data-f="frontliners.pwds_trained">…</div><div class="l">PWDs Trained</div></div>
        </div>
      </section>

      <!-- Distribution to Participants -->
      <section class="grp" id="grp-distribution">
        <div class="grp-head">
          <span class="grp-ico" style="background:#0ca678"><i class="fas fa-boxes-stacked"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Distribution to Participants</h2>
          <a class="open-link" href="/distribution">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="distribution.new_distributees">…</div><div class="l">New Distributees</div></div>
          <div class="kpi"><div class="n skel" data-f="distribution.districts">…</div><div class="l">Districts</div></div>
          <div class="kpi"><div class="n skel" data-f="distribution.materials">…</div><div class="l">Material Types</div></div>
          <div class="kpi"><div class="n skel" data-f="distribution.rows">…</div><div class="l">SHG Groups</div></div>
        </div>
      </section>

      <!-- Distribution to SHGs -->
      <section class="grp" id="grp-shgdist">
        <div class="grp-head">
          <span class="grp-ico" style="background:#087f5b"><i class="fas fa-people-group"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Distribution to SHGs</h2>
          <a class="open-link" href="/shg-distribution">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="shgdist.shgs_reached">…</div><div class="l">SHGs Reached</div></div>
          <div class="kpi"><div class="n skel" data-f="shgdist.records_count">…</div><div class="l">Distribution Records</div></div>
          <div class="kpi"><div class="n skel" data-f="shgdist.total_qty">…</div><div class="l">Total Quantity</div></div>
          <div class="kpi"><div class="n skel" data-f="shgdist.districts">…</div><div class="l">Districts</div></div>
        </div>
      </section>

      <!-- SHG Profiling -->
      <section class="grp" id="grp-profiling">
        <div class="grp-head">
          <span class="grp-ico" style="background:#e8590c"><i class="fas fa-address-card"></i></span>
          <h2 class="font-bold text-[15px] flex-1">SHG Profiling</h2>
          <a class="open-link" href="/shg-profiling">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="profiling.new_shgs_profiles">…</div><div class="l">SHG Profiles</div></div>
          <div class="kpi"><div class="n skel" data-f="profiling.monthly_shgs">…</div><div class="l">Monthly SHGs</div></div>
          <div class="kpi"><div class="n skel" data-f="profiling.profilers">…</div><div class="l">Profilers</div></div>
          <div class="kpi"><div class="n skel" data-f="profiling.districts">…</div><div class="l">Districts</div></div>
        </div>
      </section>

      <!-- ISLA Savings -->
      <section class="grp" id="grp-isla">
        <div class="grp-head">
          <span class="grp-ico" style="background:#e03131"><i class="fas fa-piggy-bank"></i></span>
          <h2 class="font-bold text-[15px] flex-1">ISLA Savings</h2>
          <a class="open-link" href="/isla">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="isla.savings_value">…</div><div class="l">Savings Value (UGX)</div></div>
          <div class="kpi"><div class="n skel" data-f="isla.total_fund">…</div><div class="l">Total Fund (UGX)</div></div>
          <div class="kpi"><div class="n skel" data-f="isla.shg_count">…</div><div class="l">SHGs Saving</div></div>
          <div class="kpi"><div class="n skel" data-f="isla.loans">…</div><div class="l">Loans</div></div>
        </div>
      </section>

      <!-- Production -->
      <section class="grp" id="grp-production">
        <div class="grp-head">
          <span class="grp-ico" style="background:#66a80f"><i class="fas fa-seedling"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Production (Horticulture)</h2>
          <a class="open-link" href="/production">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="production.new_participants">…</div><div class="l">New Participants</div></div>
          <div class="kpi"><div class="n skel" data-f="production.unique_participants">…</div><div class="l">Unique Participants</div></div>
          <div class="kpi"><div class="n skel" data-f="production.unique_shgs">…</div><div class="l">Unique SHGs</div></div>
          <div class="kpi"><div class="n skel" data-f="production.districts">…</div><div class="l">Districts</div></div>
        </div>
      </section>

      <!-- Sales -->
      <section class="grp" id="grp-sales">
        <div class="grp-head">
          <span class="grp-ico" style="background:#2b8a3e"><i class="fas fa-sack-dollar"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Sales (Horticulture/Oilseeds)</h2>
          <a class="open-link" href="/sales">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="sales.new_participants">…</div><div class="l">New Participants</div></div>
          <div class="kpi"><div class="n skel" data-f="sales.unique_participants">…</div><div class="l">Unique Participants</div></div>
          <div class="kpi"><div class="n skel" data-f="sales.unique_shgs">…</div><div class="l">Unique SHGs</div></div>
          <div class="kpi"><div class="n skel" data-f="sales.districts">…</div><div class="l">Districts</div></div>
        </div>
      </section>

      <!-- Poultry Sales -->
      <section class="grp" id="grp-poultrysales">
        <div class="grp-head">
          <span class="grp-ico" style="background:#e8590c"><i class="fas fa-kiwi-bird"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Poultry Sales</h2>
          <a class="open-link" href="/poultry-sales">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="poultrysales.new_participants">…</div><div class="l">New Participants</div></div>
          <div class="kpi"><div class="n skel" data-f="poultrysales.unique_participants">…</div><div class="l">Unique Participants</div></div>
          <div class="kpi"><div class="n skel" data-f="poultrysales.unique_shgs">…</div><div class="l">Unique SHGs</div></div>
          <div class="kpi"><div class="n skel" data-f="poultrysales.districts">…</div><div class="l">Districts</div></div>
        </div>
      </section>

      <!-- Items Not Sold -->
      <section class="grp" id="grp-itemsnotsold">
        <div class="grp-head">
          <span class="grp-ico" style="background:#8a3d2b"><i class="fas fa-triangle-exclamation"></i></span>
          <h2 class="font-bold text-[15px] flex-1">Items Not Sold</h2>
          <a class="open-link" href="/items-not-sold">Open <i class="fas fa-arrow-right ml-1"></i></a>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div class="kpi"><div class="n skel" data-f="itemsnotsold.unique_participants">…</div><div class="l">Participants (Not Sold)</div></div>
          <div class="kpi"><div class="n skel" data-f="itemsnotsold.unique_shgs">…</div><div class="l">SHGs</div></div>
          <div class="kpi"><div class="n skel" data-f="itemsnotsold.total_items">…</div><div class="l">Items Not Sold</div></div>
          <div class="kpi"><div class="n skel" data-f="itemsnotsold.value_chains">…</div><div class="l">Value Chains</div></div>
        </div>
      </section>

    </div>

    <footer class="text-center text-xs text-slate-400 py-8">
      SHG Data Cleaner &bull; Cloudflare Pages + Hono + CockroachDB &bull; OData v4 feed for Power BI
    </footer>
  </main>

  <script>
    const fmt = (n) => (Number(n) || 0).toLocaleString('en-US');
    const setF = (path, val) => {
      document.querySelectorAll('[data-f="'+path+'"]').forEach(el => {
        el.classList.remove('skel'); el.textContent = fmt(val);
      });
    };
    const setErr = (prefix) => {
      document.querySelectorAll('[data-f^="'+prefix+'."]').forEach(el => {
        el.classList.remove('skel'); el.textContent = '—';
      });
    };
    const arrLen = (a) => Array.isArray(a) ? a.length : 0;

    async function j(url){
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }

    // Each loader is independent so one slow/failing dashboard never blocks the
    // others. Fired in parallel; each fills its own cards as it resolves.
    const loaders = {
      async cluster(){
        const d = await j('/api/cluster-trainings');
        setF('cluster.total_trained', d.total_trained);
        setF('cluster.groups_reached', d.groups_reached);
        setF('cluster.female_reached', d.female_reached);
        setF('cluster.pwds_trained', d.pwds_trained);
      },
      async newyouth(){
        const d = await j('/api/new-youth');
        setF('newyouth.new_total_reach', d.new_total_reach);
        setF('newyouth.new_female_reach', d.new_female_reach);
        setF('newyouth.new_pwds_reach', d.new_pwds_reach);
        setF('newyouth.monthly_target', d.monthly_target);
      },
      async frontliners(){
        const d = await j('/api/frontliners');
        const rows = d.rows || [];
        let youth=0, female=0, pwds=0;
        for (const r of rows){ youth += Number(r.youth_trained)||0; female += Number(r.female_reached)||0; pwds += Number(r.pwds_trained)||0; }
        setF('frontliners.frontliners', rows.length);
        setF('frontliners.youth_trained', youth);
        setF('frontliners.female_reached', female);
        setF('frontliners.pwds_trained', pwds);
      },
      async distribution(){
        const d = await j('/api/distribution');
        setF('distribution.new_distributees', d.new_distributees);
        setF('distribution.districts', arrLen(d.districts));
        setF('distribution.materials', arrLen(d.materials));
        setF('distribution.rows', arrLen(d.rows));
      },
      async shgdist(){
        const d = await j('/api/shg-distribution');
        setF('shgdist.shgs_reached', d.shgs_reached);
        setF('shgdist.records_count', d.records_count);
        setF('shgdist.total_qty', Math.round(d.total_qty||0));
        setF('shgdist.districts', arrLen(d.districts));
      },
      async profiling(){
        const d = await j('/api/shg-profiling');
        setF('profiling.new_shgs_profiles', d.new_shgs_profiles);
        setF('profiling.monthly_shgs', d.monthly_shgs);
        setF('profiling.profilers', arrLen(d.profilers));
        setF('profiling.districts', arrLen(d.districts));
      },
      async isla(){
        const d = await j('/api/isla');
        const t = d.total || {};
        setF('isla.savings_value', t.savings_value);
        setF('isla.total_fund', t.total_fund);
        setF('isla.shg_count', t.shg_count != null ? t.shg_count : d.shg_saving);
        setF('isla.loans', t.loans);
      },
      async production(){
        const d = await j('/api/production');
        setF('production.new_participants', d.new_participants);
        setF('production.unique_participants', d.unique_participants);
        setF('production.unique_shgs', d.unique_shgs);
        setF('production.districts', arrLen(d.districts));
      },
      async sales(){
        const d = await j('/api/sales');
        setF('sales.new_participants', d.new_participants);
        setF('sales.unique_participants', d.unique_participants);
        setF('sales.unique_shgs', d.unique_shgs);
        setF('sales.districts', arrLen(d.districts));
      },
      async poultrysales(){
        const d = await j('/api/poultry-sales');
        setF('poultrysales.new_participants', d.new_participants);
        setF('poultrysales.unique_participants', d.unique_participants);
        setF('poultrysales.unique_shgs', d.unique_shgs);
        setF('poultrysales.districts', arrLen(d.districts));
      },
      async itemsnotsold(){
        const d = await j('/api/items-not-sold');
        setF('itemsnotsold.unique_participants', d.unique_participants);
        setF('itemsnotsold.unique_shgs', d.unique_shgs);
        setF('itemsnotsold.total_items', d.total_items);
        setF('itemsnotsold.value_chains', arrLen(d.value_chains));
      },
    };

    function loadAll(){
      // reset skeletons
      document.querySelectorAll('.kpi .n').forEach(el => { el.classList.add('skel'); el.textContent='…'; });
      const status = document.getElementById('statusBar');
      status.className = 'mb-4 text-sm rounded-lg px-4 py-2 bg-sky-50 text-sky-700';
      status.textContent = 'Loading KPIs from all dashboards…';
      const jobs = Object.entries(loaders).map(([k, fn]) =>
        fn().catch(err => { console.error(k, err); setErr(k); })
      );
      Promise.allSettled(jobs).then(() => {
        status.className = 'mb-4 text-sm rounded-lg px-4 py-2 bg-emerald-50 text-emerald-700';
        status.textContent = 'KPIs updated · ' + new Date().toLocaleString();
      });
    }

    document.getElementById('refreshBtn').addEventListener('click', loadAll);
    loadAll();
  </script>
</body>
</html>`;
}
