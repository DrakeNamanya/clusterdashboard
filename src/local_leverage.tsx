import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// "LOCAL LEVERAGE"  — Leverage Contributions by Category
//   Source: local_leverage_fund_contribution_form OData feed.
//   The free-text `contribution_kind` column is NLP-categorised (in SQL, via
//   public.leverage_category) into a small set of buckets:
//     Animal Structures and Equipment · Land Hire and Cultivation ·
//     Commitment Fee · Venue and Seats · Chemicals and Fertilizers ·
//     Refreshments · Labour and Transport · Others
//   Napkin-style arch layout mirroring the client reference graphic:
//   a central TOTAL hub with colour-coded category nodes (icon + UGX amount)
//   arranged over a wooden-arch backdrop, plus a detail table.
//   Filters: District + Date range (date_created).
//   Data from /api/local-leverage (+ /options).
// ---------------------------------------------------------------------------

export function renderLocalLeverage(base: string, opts: any = {}): string {
  const bootOpts = JSON.stringify({
    districts: opts.districts || [],
    date_bounds: opts.date_bounds || { min: null, max: null },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Local Leverage</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --cream:#FCF8F5; --panel:#FFFFFF; --ink:#28343a; --muted:#7c8a8f;
      --head:#3b6e57; --row-alt:#f0f6f2; --line:#dfe6e1; --arch:#5b6b74;
    }
    body{ background:var(--cream); color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:var(--panel); border:1px solid var(--line); border-radius:10px;
           box-shadow:0 1px 2px rgba(40,60,60,.06); }
    .ttl{ background:#e7f0ea; border-radius:12px; }
    .kpi{ position:relative; overflow:hidden; min-width:150px; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:4px; background:var(--head); }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--head); color:#fff; font-weight:700; font-size:10.5px;
              padding:6px 8px; text-align:left; position:sticky; top:0; z-index:2; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:4px 8px; font-size:11px; vertical-align:top; border-bottom:1px solid #edf3ef; white-space:nowrap; }
    tbody td.num{ text-align:right; }
    tbody tr:nth-child(even) td{ background:var(--row-alt); }
    tbody tr:hover td{ background:#eef7f1; }
    .dist-item{ display:flex; align-items:center; gap:6px; padding:2px 2px; cursor:pointer; font-size:12px; }
    .dist-item:hover{ background:var(--cream); border-radius:5px; }
    .dist-item input{ accent-color:var(--head); width:13px; height:13px; }
    .scrollbar-thin::-webkit-scrollbar{ width:8px; height:8px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#c6d5cc; border-radius:3px; }
    .slbl{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; }
    .mini-btn{ font-size:9px; padding:2px 4px; border-radius:4px; border:1px solid var(--line); background:#fff; }
    .mini-btn:hover{ background:var(--cream); }
    .mini-search{ width:100%; background:#fff; border:1px solid var(--line); border-radius:5px; padding:2px 6px; font-size:10px; }
    .dt{ width:100%; background:#fff; border:1px solid var(--line); border-radius:5px; padding:3px 6px; font-size:11px; }

    /* ---- Napkin-style arch infographic ---- */
    .arch-wrap{ position:relative; min-height:430px; }
    .arch-svg{ position:absolute; inset:0; width:100%; height:100%; z-index:0; }
    .hub{ position:absolute; left:50%; top:58%; transform:translate(-50%,-50%); text-align:center; z-index:2; }
    .hub-total{ font-size:30px; font-weight:800; letter-spacing:-.5px; color:var(--ink); }
    .cat{ position:absolute; z-index:3; display:flex; align-items:flex-start; gap:8px; max-width:230px; }
    .cat .ic{ width:36px; height:36px; border-radius:9px; display:flex; align-items:center; justify-content:center;
              font-size:17px; color:#fff; flex:0 0 auto; box-shadow:0 1px 3px rgba(0,0,0,.12); }
    .cat .lbl{ font-size:12.5px; font-weight:800; line-height:1.15; }
    .cat .amt{ font-size:12px; font-weight:700; color:var(--ink); margin-top:2px; }
    .cat .cnt{ font-size:9.5px; color:var(--muted); font-weight:600; }
    .cat.r{ flex-direction:row; } .cat.l{ flex-direction:row-reverse; text-align:right; }
    @media (max-width:1023px){
      .arch-wrap{ min-height:auto; }
      .arch-svg,.hub{ position:static; transform:none; }
      .cat{ position:static; max-width:none; margin-bottom:8px; }
      .grid-cats{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    }
  </style>
</head>
<body>
${navSidebar('localleverage')}
  <div class="max-w-[1600px] mx-auto p-3 md:p-4">

    <div class="flex flex-wrap items-center gap-3 mb-3">
      <a href="/" class="text-[var(--muted)] hover:text-[var(--ink)]" title="Back to Home"><i class="fas fa-arrow-left"></i></a>

      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Total Amount (UGX)</div>
        <div id="kpiAmount" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Contributions</div>
        <div id="kpiCount" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>
      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Categories</div>
        <div id="kpiCats" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>

      <div class="ttl px-5 py-1.5 flex-1 text-center">
        <h1 class="text-lg md:text-2xl font-extrabold tracking-tight">LEVERAGE CONTRIBUTIONS BY CATEGORY</h1>
        <div id="subDate" class="text-[11px] text-[var(--muted)] font-semibold"></div>
      </div>

      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[var(--cream)] text-[var(--muted)]">
        <i class="fas fa-rotate mr-1"></i> Refresh
      </button>
    </div>

    <div class="grid grid-cols-12 gap-3">
      <section class="col-span-12 lg:col-span-10 space-y-3">

        <!-- Napkin arch infographic -->
        <div class="card p-3">
          <div class="arch-wrap" id="archWrap">
            <svg class="arch-svg" viewBox="0 0 1000 430" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <g fill="none" stroke="var(--arch)" stroke-width="10" stroke-linejoin="round" opacity=".55">
                <path d="M120 400 L250 250" />
                <path d="M250 250 L430 200" />
                <path d="M430 200 L500 175" />
                <path d="M500 175 L570 200" />
                <path d="M570 200 L750 250" />
                <path d="M750 250 L880 400" />
                <path d="M170 400 L300 260 M300 260 L470 215 M470 215 L530 215 M530 215 L700 260 M700 260 L830 400" opacity=".35"/>
              </g>
            </svg>
            <div class="hub">
              <div class="text-[13px] font-bold text-[var(--muted)]">Overview of Leverage Contributions</div>
              <div class="hub-total">UGX <span id="hubTotal">–</span></div>
            </div>
            <!-- category nodes injected here on wide screens; grid on mobile -->
            <div id="cats"></div>
            <div id="catsGrid" class="grid-cats" style="display:none"></div>
          </div>
        </div>

        <!-- Detail table -->
        <div class="card p-2">
          <div class="scrollbar-thin overflow-auto max-h-[calc(100vh-160px)]">
            <table id="tbl">
              <thead id="thead"></thead>
              <tbody id="tbody">
                <tr><td class="text-center text-[var(--muted)] py-8">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <aside class="col-span-12 lg:col-span-2 space-y-2">
        <div class="card p-2" id="sl-dist"></div>
        <div class="card p-2">
          <div class="slbl mb-1">Date (created)</div>
          <label class="text-[9px] text-[var(--muted)] font-semibold">From</label>
          <input id="dateFrom" type="date" class="dt mb-1.5" />
          <label class="text-[9px] text-[var(--muted)] font-semibold">To</label>
          <input id="dateTo" type="date" class="dt" />
          <div class="flex gap-1 mt-2">
            <button data-date="clear" class="mini-btn flex-1 font-semibold">All dates</button>
          </div>
          <div id="dateHint" class="text-[9px] text-[var(--muted)] mt-1"></div>
        </div>
      </aside>
    </div>
  </div>

  <script>
    window.__OPTS__ = ${bootOpts};
    const fmt = (n) => (n ?? 0).toLocaleString('en-US');
    const num = (v) => { const n = Number(v); return (n||0).toLocaleString('en-US',{maximumFractionDigits:2}); };
    const ugx = (v) => (Number(v)||0).toLocaleString('en-US');

    // NLP category → colour + FontAwesome icon (mirrors the client graphic).
    const CAT_STYLE = {
      'Animal Structures and Equipment': { c:'#2f9e77', ic:'fa-kiwi-bird' },
      'Land Hire and Cultivation':       { c:'#8a6d1f', ic:'fa-tractor' },
      'Commitment Fee':                  { c:'#3f4c53', ic:'fa-hand-holding-dollar' },
      'Venue and Seats':                 { c:'#c2489a', ic:'fa-chair' },
      'Chemicals and Fertilizers':       { c:'#7f9b1e', ic:'fa-flask' },
      'Refreshments':                    { c:'#e07aa6', ic:'fa-glass-water' },
      'Labour and Transport':            { c:'#2b7fb0', ic:'fa-truck' },
      'Others':                          { c:'#8560c9', ic:'fa-shapes' },
    };
    // Positions around the arch (wide layout). left/top in %.
    const CAT_POS = {
      'Commitment Fee':                  { left:'30%', top:'8%',  side:'l' },
      'Land Hire and Cultivation':       { left:'66%', top:'8%',  side:'r' },
      'Chemicals and Fertilizers':       { left:'10%', top:'34%', side:'l' },
      'Others':                          { left:'70%', top:'34%', side:'r' },
      'Animal Structures and Equipment': { left:'8%',  top:'66%', side:'l' },
      'Venue and Seats':                 { left:'72%', top:'58%', side:'r' },
      'Refreshments':                    { left:'74%', top:'80%', side:'r' },
      'Labour and Transport':            { left:'10%', top:'86%', side:'l' },
    };
    const defStyle = { c:'#8560c9', ic:'fa-shapes' };

    const COLS = [
      ['contribution_kind','Contribution_Kind','txt'],
      ['category','Category','txt'],
      ['contribution_amount','Amount_UGX','num'],
      ['district','District','txt'],
      ['subcounty','Subcounty','txt'],
      ['type_of_entity','Type_of_Entity','txt'],
      ['type_of_contribution','Type_of_Contribution','txt'],
      ['submitter_name','Submitter_Name','txt'],
      ['submitter_position','Submitter_Position','txt'],
      ['partner','Partner','txt'],
      ['date_created','Date_Created','txt'],
    ];

    // District slicer state.
    const S = { opts:[], sel:new Set(), all:true };
    let lastData = null;
    let sortKey = 'contribution_amount';

    function distParam(){ return S.all ? '' : [...S.sel].join(','); }

    function buildDistShell(){
      document.getElementById('sl-dist').innerHTML =
        '<div class="slbl mb-1">District</div>'
        + '<input id="distSearch" type="text" placeholder="Search…" class="mini-search mb-1" />'
        + '<div class="flex gap-1 mb-1">'
        +   '<button class="mini-btn flex-1 font-semibold" id="distAll">Select all</button>'
        +   '<button class="mini-btn flex-1 font-semibold" id="distNone">None</button>'
        + '</div>'
        + '<div id="distList" class="scrollbar-thin overflow-y-auto max-h-[240px] pr-1"></div>';
      document.getElementById('distSearch').addEventListener('input', renderDist);
      document.getElementById('distAll').addEventListener('click', ()=>{ S.all=true; S.sel=new Set(); renderDist(); load(); });
      document.getElementById('distNone').addEventListener('click', ()=>{ S.all=false; S.sel=new Set(); renderDist(); load(); });
    }
    function renderDist(){
      const box = document.getElementById('distList'); if(!box) return;
      const q = (document.getElementById('distSearch').value||'').toLowerCase();
      let html='';
      for (const o of S.opts){
        if (q && !o.toLowerCase().includes(q)) continue;
        const on = S.all || S.sel.has(o);
        html += '<label class="dist-item"><input type="checkbox" data-o="'+o.replace(/"/g,'&quot;')+'" '+(on?'checked':'')+'/><span>'+o+'</span></label>';
      }
      if (!html) html='<div class="text-[var(--muted)] text-[10px] py-1">No match.</div>';
      box.innerHTML = html;
      box.querySelectorAll('input[data-o]').forEach(cb=>{
        cb.addEventListener('change', ()=>{
          const o = cb.getAttribute('data-o');
          if (S.all){ S.sel=new Set(S.opts); S.all=false; }
          if (cb.checked) S.sel.add(o); else S.sel.delete(o);
          if (S.sel.size === S.opts.length) S.all=true;
          renderDist(); load();
        });
      });
    }

    function catCard(name, amt, cnt, wide){
      const st = CAT_STYLE[name] || defStyle;
      const side = (CAT_POS[name] && CAT_POS[name].side) || 'r';
      const inner =
        '<div class="ic" style="background:'+st.c+'"><i class="fas '+st.ic+'"></i></div>'
        + '<div><div class="lbl" style="color:'+st.c+'">'+name+'</div>'
        + '<div class="amt">UGX '+ugx(amt)+'</div>'
        + '<div class="cnt">'+fmt(cnt)+' contributions</div></div>';
      if (wide){
        const p = CAT_POS[name] || { left:'50%', top:'50%', side:'r' };
        return '<div class="cat '+side+'" style="left:'+p.left+';top:'+p.top+'">'+inner+'</div>';
      }
      return '<div class="cat r">'+inner+'</div>';
    }

    function renderArch(){
      if (!lastData) return;
      const by = lastData.by_category || [];
      document.getElementById('hubTotal').textContent = ugx(lastData.total_amount);
      const wide = window.matchMedia('(min-width:1024px)').matches;
      const cats = document.getElementById('cats');
      const grid = document.getElementById('catsGrid');
      if (wide){
        cats.style.display=''; grid.style.display='none';
        cats.innerHTML = by.map(c=>catCard(c.category, c.amount, c.contributions, true)).join('');
      } else {
        cats.style.display='none'; grid.style.display='grid';
        grid.innerHTML = by.map(c=>catCard(c.category, c.amount, c.contributions, false)).join('');
      }
    }

    function renderHead(){
      let html = '<tr>';
      for (const [key,label,type] of COLS){
        const sortable = type==='num';
        html += '<th class="'+(type==='num'?'num':'')+(sortable?' cursor-pointer':'')+'" '+(sortable?'data-k="'+key+'"':'')+'>'+label+(key===sortKey?' ▼':'')+'</th>';
      }
      html += '</tr>';
      document.getElementById('thead').innerHTML = html;
      document.querySelectorAll('#thead th[data-k]').forEach(th=>
        th.addEventListener('click', ()=>{ sortKey = th.getAttribute('data-k'); renderTable(); }));
    }
    function fmtCell(v, type){
      if (v==null || v==='') return '';
      if (type==='num') return num(v);
      return String(v);
    }
    function catBadge(name){
      const st = CAT_STYLE[name] || defStyle;
      return '<span style="display:inline-block;background:'+st.c+'22;color:'+st.c+';border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700">'+(name||'Others')+'</span>';
    }
    function renderTable(){
      if (!lastData) return;
      const rows = lastData.rows || [];
      renderHead();
      const tbody = document.getElementById('tbody');
      if (!rows.length){ tbody.innerHTML='<tr><td colspan="'+COLS.length+'" class="text-center text-[var(--muted)] py-8">No contributions match this selection.</td></tr>'; return; }
      const sorted = [...rows].sort((a,b)=> (Number(b[sortKey])||0) - (Number(a[sortKey])||0));
      let html='';
      for (const r of sorted){
        html += '<tr>';
        for (const [key,label,type] of COLS){
          const cls = type==='num' ? ' class="num"' : '';
          const val = key==='category' ? catBadge(r[key]) : fmtCell(r[key], type);
          html += '<td'+cls+'>'+val+'</td>';
        }
        html += '</tr>';
      }
      tbody.innerHTML = html;
    }

    function filterParams(){
      const params = new URLSearchParams();
      const dp = distParam(); if (dp) params.set('districts', dp);
      const df = document.getElementById('dateFrom').value;
      const dt = document.getElementById('dateTo').value;
      if (df) params.set('dateFrom', df);
      if (dt) params.set('dateTo', dt);
      return params;
    }

    function seedBounds(b){
      if (!b) return;
      const df = document.getElementById('dateFrom'), dt = document.getElementById('dateTo');
      if (b.min){ df.min=b.min; dt.min=b.min; }
      if (b.max){ df.max=b.max; dt.max=b.max; }
      if (b.min && b.max){
        document.getElementById('dateHint').textContent = 'Data: '+b.min+' → '+b.max;
      }
    }

    async function loadOptions(){
      try{
        const res = await fetch('/api/local-leverage/options');
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        if (d.districts && d.districts.length){ S.opts = d.districts; renderDist(); }
        seedBounds(d.date_bounds);
      }catch(err){ /* slicers stay All */ }
    }

    function updateSubDate(){
      const df = document.getElementById('dateFrom').value;
      const dt = document.getElementById('dateTo').value;
      const el = document.getElementById('subDate');
      if (df || dt){ el.textContent = 'As of '+(dt||'…')+(df?(' (from '+df+')'):''); }
      else el.textContent = '';
    }

    async function load(){
      updateSubDate();
      const params = filterParams();
      const tb = document.getElementById('tbody');
      if (tb) tb.innerHTML = '<tr><td class="text-center text-[var(--muted)] py-8"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
      try{
        const res = await fetch('/api/local-leverage?'+params.toString());
        if (!res.ok) throw new Error('HTTP '+res.status);
        const d = await res.json();
        lastData = d;
        const a=document.getElementById('kpiAmount'); if(a) a.textContent=ugx(d.total_amount);
        const b=document.getElementById('kpiCount');  if(b) b.textContent=fmt(d.total_contributions);
        const c=document.getElementById('kpiCats');   if(c) c.textContent=fmt(d.categories_count);
        if (d.districts && d.districts.length && S.opts.length === 0){ S.opts = d.districts; renderDist(); }
        renderArch();
        renderTable();
      }catch(err){
        const eb = document.getElementById('tbody');
        if (eb) eb.innerHTML =
          '<tr><td class="text-center text-red-500 py-8">Failed to load: '+err.message+'</td></tr>';
      }
    }

    buildDistShell();
    (function seedFromBoot(){
      const boot = window.__OPTS__ || {};
      if (boot.districts && boot.districts.length){ S.opts = boot.districts; renderDist(); }
      seedBounds(boot.date_bounds);
    })();

    document.getElementById('dateFrom').addEventListener('change', load);
    document.getElementById('dateTo').addEventListener('change', load);
    document.querySelectorAll('[data-date]').forEach(b=>b.addEventListener('click', ()=>{
      document.getElementById('dateFrom').value='';
      document.getElementById('dateTo').value='';
      load();
    }));
    window.addEventListener('resize', ()=>{ renderArch(); });
    document.getElementById('refreshBtn').addEventListener('click', async (e)=>{
      const btn = e.currentTarget; const old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Refreshing…';
      try{ await fetch('/api/local-leverage/refresh', {method:'POST'}); await load(); }
      catch(err){ alert('Refresh failed: '+err.message); }
      finally{ btn.disabled=false; btn.innerHTML=old; }
    });

    loadOptions();
    load();
  </script>
</body>
</html>`;
}
