import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// "LOCAL LEVERAGE"  — Leverage Contributions by Category
//   Source: local_leverage_fund_contribution_form OData feed.
//   The free-text `contribution_kind` column is NLP-categorised (in SQL, via
//   public.leverage_category) into a small set of buckets:
//     Animal Structures and Equipment · Land Hire and Cultivation ·
//     Commitment Fee · Venue and Seats · Chemicals and Fertilizers ·
//     Refreshments · Labour and Transport · Others
//   Central infographic: a hand-drawn TRADITIONAL WOODEN BALANCE structure
//   (thin dark-grey outlines) with six coloured circular joints and a bold
//   central "Overview of Leverage Contributions" + UGX total. Contribution
//   categories are arranged around the balance per the client reference.
//   Plus a District Ranking bar chart (highest→lowest, filter-aware) and a
//   detail table.
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
      --paper:#FFFFFF; --ink:#3b444a; --ink2:#4a555c; --muted:#8a969c;
      --line:#e2e7ea; --wood:#5b5148; --joint-w:#ffffff;
    }
    body{ background:#f6f8f9; color:var(--ink); font-family:"Aptos","Segoe UI",Calibri,Arial,system-ui,-apple-system,sans-serif; }
    .card{ background:var(--paper); border:1px solid var(--line); border-radius:12px;
           box-shadow:0 1px 3px rgba(40,60,60,.05); }
    .kpi{ position:relative; overflow:hidden; min-width:150px; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:3px; background:var(--ink); }

    table{ border-collapse:collapse; width:100%; }
    thead th{ background:#eef2f4; color:var(--ink); font-weight:700; font-size:10.5px;
              padding:6px 8px; text-align:left; position:sticky; top:0; z-index:2; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:4px 8px; font-size:11px; vertical-align:top; border-bottom:1px solid #eef2f4; white-space:nowrap; }
    tbody td.num{ text-align:right; }
    tbody tr:nth-child(even) td{ background:#fafbfc; }
    tbody tr:hover td{ background:#f0f6f2; }

    .dist-item{ display:flex; align-items:center; gap:6px; padding:2px 2px; cursor:pointer; font-size:12px; }
    .dist-item:hover{ background:#f2f6f7; border-radius:5px; }
    .dist-item input{ accent-color:var(--ink); width:13px; height:13px; }
    .scrollbar-thin::-webkit-scrollbar{ width:8px; height:8px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#cdd6da; border-radius:3px; }
    .slbl{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; }
    .mini-btn{ font-size:9px; padding:2px 4px; border-radius:4px; border:1px solid var(--line); background:#fff; }
    .mini-btn:hover{ background:#f2f6f7; }
    .mini-search{ width:100%; background:#fff; border:1px solid var(--line); border-radius:5px; padding:2px 6px; font-size:10px; }
    .dt{ width:100%; background:#fff; border:1px solid var(--line); border-radius:5px; padding:3px 6px; font-size:11px; }

    /* ---- Wooden balance infographic ------------------------------------ */
    .bal-title{ text-align:center; font-size:clamp(15px,1.7vw,22px); color:var(--ink2); font-weight:600; letter-spacing:.2px; }
    .bal-canvas{ position:relative; width:100%; aspect-ratio:16/9; background:#fff; }
    .bal-svg{ position:absolute; inset:0; width:100%; height:100%; z-index:0; }
    .bal-hub{ position:absolute; left:50%; top:63%; transform:translate(-50%,-50%); text-align:center; z-index:2; width:34%; }
    .bal-hub .h1{ font-size:clamp(15px,1.6vw,21px); font-weight:800; color:var(--ink); line-height:1.12; }
    .bal-hub .h2{ font-size:clamp(12px,1.15vw,15px); font-weight:600; color:var(--ink2); margin-top:6px; }
    /* category node */
    .cat{ position:absolute; z-index:3; display:flex; align-items:flex-start; gap:9px; max-width:23%; }
    .cat.l{ flex-direction:row-reverse; text-align:right; }
    .cat .ic{ font-size:clamp(18px,1.9vw,26px); flex:0 0 auto; line-height:1; margin-top:2px; }
    .cat .lbl{ font-size:clamp(11px,1.15vw,15px); font-weight:700; line-height:1.12; }
    .cat .amt{ font-size:clamp(11px,1.1vw,14px); font-weight:700; color:var(--ink); margin-top:1px; white-space:nowrap; }
    .cat .cnt{ font-size:9.5px; color:var(--muted); font-weight:600; margin-top:1px; }
    @media (max-width:1023px){
      .bal-canvas{ aspect-ratio:auto; min-height:auto; }
      .bal-svg{ position:relative; height:230px; }
      .bal-hub{ position:static; transform:none; width:auto; margin:6px 0 10px; }
      .cat{ position:static; max-width:none; margin-bottom:6px; }
      .cat.l{ flex-direction:row; text-align:left; }
      .cats-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    }

    /* ---- District ranking bars ----------------------------------------- */
    .rank-row{ display:grid; grid-template-columns:88px 1fr; align-items:center; gap:7px; margin-bottom:6px; }
    .rank-name{ font-size:10px; font-weight:700; color:var(--ink); text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .rank-bar{ position:relative; }
    .rank-track{ background:#eef2f4; border-radius:5px; height:15px; position:relative; overflow:hidden; }
    .rank-fill{ height:100%; border-radius:5px; background:linear-gradient(90deg,#2f9e44,#7bc47f); transition:width .45s ease; }
    .rank-val{ font-size:9px; font-weight:700; color:var(--ink2); margin-top:1px; }
    .rank-cnt{ color:var(--muted); font-weight:600; }
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
      <div class="card kpi px-4 py-2">
        <div class="text-[10px] uppercase tracking-wide text-[var(--muted)] font-semibold">Districts</div>
        <div id="kpiDist" class="text-2xl font-extrabold mt-0.5">–</div>
      </div>

      <div class="flex-1"></div>

      <button id="refreshBtn" class="text-xs px-3 py-1.5 rounded-lg border border-[var(--line)] bg-white hover:bg-[#f2f6f7] text-[var(--muted)]">
        <i class="fas fa-rotate mr-1"></i> Refresh
      </button>
    </div>

    <div class="grid grid-cols-12 gap-3">
      <section class="col-span-12 lg:col-span-10 space-y-3">

        <!-- Wooden balance infographic -->
        <div class="card p-4 md:p-6">
          <h1 id="balTitle" class="bal-title mb-1">Leverage Contributions by Category</h1>
          <div class="bal-canvas" id="balCanvas">
            <svg class="bal-svg" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <!-- thin dark-grey hand-drawn wooden balance structure -->
              <g fill="none" stroke="var(--wood)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
                <!-- long horizontal balance beam (upper-left-middle -> upper-right-middle) -->
                <path d="M215 233 C 360 208, 640 208, 792 235" />
                <path d="M215 239 C 360 214, 640 214, 792 241" opacity=".45"/>
                <!-- second diagonal beam crossing over the horizontal beam -->
                <path d="M300 158 C 470 214, 610 250, 742 305" opacity=".85"/>
                <!-- left support leg (leans outward, ends lower-left) -->
                <path d="M356 214 C 300 330, 250 430, 196 512" />
                <!-- right support leg (leans outward, ends lower-right) -->
                <path d="M648 214 C 706 330, 756 430, 812 512" />
                <!-- crossing diagonal support beams behind the main beam -->
                <path d="M300 300 C 430 262, 590 262, 712 236" opacity=".5"/>
                <path d="M300 236 C 430 262, 590 262, 712 300" opacity=".5"/>
                <!-- little cross-tie near the apex -->
                <path d="M470 220 L 530 220" opacity=".7"/>
                <!-- ground hints under the legs -->
                <path d="M170 518 L 236 512" opacity=".5"/>
                <path d="M778 512 L 844 518" opacity=".5"/>
              </g>
              <!-- six coloured circular joints (white centres, coloured outlines only) -->
              <g fill="var(--joint-w)" stroke-width="3.4">
                <circle cx="215" cy="235" r="11" stroke="#2f9e44"/>   <!-- green - left of main beam -->
                <circle cx="392" cy="212" r="11" stroke="#2f6fd1"/>   <!-- blue - upper centre-left -->
                <circle cx="612" cy="212" r="11" stroke="#8a5cd1"/>   <!-- purple - upper centre-right -->
                <circle cx="742" cy="305" r="11" stroke="#a06bd8"/>   <!-- violet - upper-right sloping beam -->
                <circle cx="215" cy="470" r="11" stroke="#2f9e44"/>   <!-- green - lower-left support -->
                <circle cx="792" cy="470" r="11" stroke="#e05a9c"/>   <!-- pink - lower-right support -->
              </g>
            </svg>

            <div class="bal-hub">
              <div class="h1">Overview of Leverage<br/>Contributions</div>
              <div class="h2">UGX <span id="hubTotal">–</span></div>
            </div>

            <!-- category nodes injected here on wide screens -->
            <div id="cats"></div>
            <div id="catsGrid" class="cats-grid" style="display:none"></div>
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
        <!-- District ranking (highest -> lowest, filter-aware) -->
        <div class="card p-2">
          <div class="slbl mb-2 flex items-center gap-1"><i class="fas fa-ranking-star"></i> District Ranking</div>
          <div id="rankList" class="scrollbar-thin overflow-y-auto max-h-[320px] pr-1">
            <div class="text-[var(--muted)] text-[10px] py-1">Loading…</div>
          </div>
        </div>

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
    const compact = (v) => { const n=Number(v)||0; if(n>=1e9)return (n/1e9).toFixed(2)+'B'; if(n>=1e6)return (n/1e6).toFixed(1)+'M'; if(n>=1e3)return (n/1e3).toFixed(0)+'K'; return String(n); };

    // NLP category -> colour + FontAwesome icon + position around the balance.
    // Colours & positions follow the client reference wooden-balance graphic.
    const CAT_STYLE = {
      'Commitment Fee':                  { c:'#3f4c53', ic:'fa-hand-holding-dollar' },
      'Land Hire and Cultivation':       { c:'#3f4c53', ic:'fa-tractor' },
      'Chemicals and Fertilizers':       { c:'#7bc47f', ic:'fa-spray-can-sparkles' },
      'Animal Structures and Equipment': { c:'#2f9e44', ic:'fa-warehouse' },
      'Others':                          { c:'#8a5cd1', ic:'fa-people-group' },
      'Venue and Seats':                 { c:'#e05a9c', ic:'fa-chair' },
      'Refreshments':                    { c:'#f2a0c4', ic:'fa-mug-hot' },
      'Labour and Transport':            { c:'#3f4c53', ic:'fa-truck' },
    };
    // Positions around the balance (wide layout). left/top in %, side l|r.
    const CAT_POS = {
      'Commitment Fee':                  { left:'20%',  top:'6%',  side:'r' }, // TOP-LEFT
      'Land Hire and Cultivation':       { left:'62%',  top:'6%',  side:'r' }, // TOP-RIGHT
      'Chemicals and Fertilizers':       { left:'3%',   top:'28%', side:'r' }, // UPPER-LEFT-MIDDLE
      'Others':                          { left:'70%',  top:'30%', side:'r' }, // UPPER-RIGHT-MIDDLE
      'Animal Structures and Equipment': { left:'2%',   top:'55%', side:'r' }, // MIDDLE-LEFT
      'Venue and Seats':                 { left:'74%',  top:'55%', side:'r' }, // MIDDLE-RIGHT
      'Refreshments':                    { left:'72%',  top:'80%', side:'r' }, // LOWER-RIGHT
      'Labour and Transport':            { left:'4%',   top:'80%', side:'r' }, // LOWER-LEFT (8th)
    };
    const defStyle = { c:'#8a5cd1', ic:'fa-shapes' };

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

    // ---- Category nodes around the balance -------------------------------
    function catCard(name, amt, cnt, wide){
      const st = CAT_STYLE[name] || defStyle;
      const side = (CAT_POS[name] && CAT_POS[name].side) || 'r';
      const inner =
        '<div class="ic" style="color:'+st.c+'"><i class="fas '+st.ic+'"></i></div>'
        + '<div><div class="lbl" style="color:'+st.c+'">'+name+'</div>'
        + '<div class="amt">UGX '+ugx(amt)+'</div>'
        + '<div class="cnt">'+fmt(cnt)+' contributions</div></div>';
      if (wide){
        const p = CAT_POS[name] || { left:'50%', top:'50%', side:'r' };
        return '<div class="cat '+side+'" style="left:'+p.left+';top:'+p.top+'">'+inner+'</div>';
      }
      return '<div class="cat r">'+inner+'</div>';
    }

    function renderBalance(){
      if (!lastData) return;
      const by = lastData.by_category || [];
      document.getElementById('hubTotal').textContent = ugx(lastData.total_amount);
      // Keep the fixed reference ordering (biggest reference categories first),
      // but only show categories present in the data.
      const order = ['Commitment Fee','Land Hire and Cultivation','Chemicals and Fertilizers',
                     'Animal Structures and Equipment','Others','Venue and Seats',
                     'Refreshments','Labour and Transport'];
      const map = {}; for (const c of by) map[c.category] = c;
      const list = order.filter(n=>map[n]).map(n=>map[n]);
      for (const c of by){ if (!order.includes(c.category)) list.push(c); }
      const wide = window.matchMedia('(min-width:1024px)').matches;
      const cats = document.getElementById('cats');
      const grid = document.getElementById('catsGrid');
      if (wide){
        cats.style.display=''; grid.style.display='none';
        cats.innerHTML = list.map(c=>catCard(c.category, c.amount, c.contributions, true)).join('');
      } else {
        cats.style.display='none'; grid.style.display='grid';
        grid.innerHTML = list.map(c=>catCard(c.category, c.amount, c.contributions, false)).join('');
      }
    }

    // ---- District ranking chart (highest -> lowest, filter-aware) --------
    function renderRanking(){
      const box = document.getElementById('rankList'); if (!box) return;
      const rows = (lastData && lastData.by_district) ? lastData.by_district.slice() : [];
      if (!rows.length){ box.innerHTML='<div class="text-[var(--muted)] text-[10px] py-1">No data.</div>'; return; }
      // already sorted desc by amount in SQL, but re-sort defensively.
      rows.sort((a,b)=> (Number(b.amount)||0)-(Number(a.amount)||0));
      const max = Number(rows[0].amount)||1;
      let html='';
      rows.forEach((d,i)=>{
        const amt = Number(d.amount)||0;
        const pct = Math.max(2, Math.round(100*amt/max));
        html += '<div class="rank-row">'
              +   '<div class="rank-name" title="'+(d.district||'')+'">'+(i+1)+'. '+(d.district||'(Blank)')+'</div>'
              +   '<div class="rank-bar">'
              +     '<div class="rank-track"><div class="rank-fill" style="width:'+pct+'%"></div></div>'
              +     '<div class="rank-val">UGX '+compact(amt)+' <span class="rank-cnt">· '+fmt(d.contributions)+'</span></div>'
              +   '</div>'
              + '</div>';
      });
      box.innerHTML = html;
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

    // Update the page title to "... (As of <date>)".
    function updateTitle(){
      const dt = document.getElementById('dateTo').value;
      const df = document.getElementById('dateFrom').value;
      const asOf = dt || (lastData && lastData.date_bounds && lastData.date_bounds.max) || '';
      const el = document.getElementById('balTitle');
      let t = 'Leverage Contributions by Category';
      if (asOf) t += ' (As of '+asOf+')';
      else if (df) t += ' (From '+df+')';
      el.textContent = t;
    }

    async function load(){
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
        const e=document.getElementById('kpiDist');   if(e) e.textContent=fmt(d.districts_count);
        if (d.districts && d.districts.length && S.opts.length === 0){ S.opts = d.districts; renderDist(); }
        updateTitle();
        renderBalance();
        renderRanking();
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
    window.addEventListener('resize', ()=>{ renderBalance(); });
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
