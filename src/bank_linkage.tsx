import { navSidebar } from './nav';
import { dashToolsAssets } from './dashtools';
// ---------------------------------------------------------------------------
// YOUTH LINKED TO BANKS dashboard
//   Source: fsdu_service_linkage_tracking_form OData feed -> bank_linkage_rows.
//   Tracks youth linked to financial institutions (banks/MFIs): financial
//   institution, data collector, loan amount disbursed (UGX), and participant
//   type counts. Plus district, gender, PWD, savings, financial service.
//   KPIs + by-institution + by-participant-type + by-district + by-collector +
//   detail table. Filters: District + Institution + Participant type + Date.
//   Data from /api/bank-linkage (+ /options).
// ---------------------------------------------------------------------------

export function renderBankLinkage(base: string, opts: any = {}): string {
  const bootOpts = JSON.stringify({
    districts: opts.districts || [],
    institutions: opts.institutions || [],
    types: opts.types || [],
    date_bounds: opts.date_bounds || { min: null, max: null },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Youth Linked to Banks</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{ --paper:#fff; --ink:#15324d; --accent:#1d4ed8; --accent2:#3b82f6;
           --muted:#8a969c; --line:#e2e7ea; }
    body{ background:#f6f8f9; color:var(--ink);
          font-family:"Segoe UI",Calibri,Arial,system-ui,-apple-system,sans-serif; }
    .card{ background:var(--paper); border:1px solid var(--line); border-radius:12px;
           box-shadow:0 1px 3px rgba(40,60,60,.05); }
    .kpi{ position:relative; overflow:hidden; }
    .kpi::before{ content:''; position:absolute; top:0; left:0; right:0; height:3px; background:var(--accent); }
    .kpi .v{ font-size:22px; font-weight:800; color:var(--accent); line-height:1.1; }
    .kpi .l{ font-size:10.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; }
    table{ border-collapse:collapse; width:100%; }
    thead th{ background:#e8eef9; color:var(--ink); font-weight:700; font-size:10.5px;
              padding:6px 8px; text-align:left; position:sticky; top:0; z-index:2; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:4px 8px; font-size:11px; vertical-align:top; border-bottom:1px solid #eef2f4; white-space:nowrap; }
    tbody td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    tbody tr:nth-child(even) td{ background:#fafbfc; }
    tbody tr:hover td{ background:#eef3fc; }
    .dist-item{ display:flex; align-items:center; gap:6px; padding:2px; cursor:pointer; font-size:12px; }
    .dist-item:hover{ background:#f2f6f7; border-radius:5px; }
    .dist-item input{ accent-color:var(--accent); width:13px; height:13px; }
    .scrollbar-thin::-webkit-scrollbar{ width:8px; height:8px; }
    .scrollbar-thin::-webkit-scrollbar-thumb{ background:#cdd6da; border-radius:3px; }
    .slbl{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; }
    .btn{ background:var(--accent); color:#fff; border:0; border-radius:8px; padding:7px 12px;
          font-size:12px; font-weight:700; cursor:pointer; }
    .btn.ghost{ background:#fff; color:var(--accent); border:1px solid var(--accent); }
    .bar{ height:9px; border-radius:5px; background:var(--accent2); }
    .prettyFI{ text-transform:capitalize; }
  </style>
</head>
<body>
  <main class="max-w-[1400px] mx-auto p-4">
    <header class="mb-4">
      <h1 class="text-2xl font-extrabold" style="color:var(--accent)">
        <i class="fas fa-building-columns mr-2"></i>Youth Linked to Banks
      </h1>
      <p class="text-sm text-[var(--muted)]">Youth linked to financial institutions (banks / MFIs) — financial institution, data collector, loan amount disbursed (UGX) and participant-type counts, with district, gender, PWD and financial service.</p>
    </header>

    <section class="card p-3 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="slbl mb-1">Linked from</div>
          <input id="fromDate" type="date" class="bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]" />
        </div>
        <div>
          <div class="slbl mb-1">Linked to</div>
          <input id="toDate" type="date" class="bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]" />
        </div>
        <div class="min-w-[190px]">
          <div class="slbl mb-1">Financial institution</div>
          <select id="fiSel" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]"><option value="">All institutions</option></select>
        </div>
        <div class="min-w-[170px]">
          <div class="slbl mb-1">Participant type</div>
          <select id="typeSel" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]"><option value="">All participant types</option></select>
        </div>
        <button id="applyBtn" class="btn"><i class="fas fa-filter mr-1"></i>Apply</button>
        <button id="resetBtn" class="btn ghost">Reset</button>
        <button id="xlsBtn" class="btn ghost"><i class="fas fa-file-excel mr-1"></i>Export</button>
        <span id="stamp" class="text-[11px] text-[var(--muted)] ml-auto"></span>
      </div>
    </section>

    <section class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      <div class="card kpi p-3"><div class="v" id="kLink">–</div><div class="l">Linkages</div></div>
      <div class="card kpi p-3"><div class="v" id="kLoan">–</div><div class="l">Loan disbursed</div></div>
      <div class="card kpi p-3"><div class="v" id="kFI">–</div><div class="l">Institutions</div></div>
      <div class="card kpi p-3"><div class="v" id="kDistricts">–</div><div class="l">Districts</div></div>
      <div class="card kpi p-3"><div class="v" id="kFemale">–</div><div class="l">Female</div></div>
      <div class="card kpi p-3"><div class="v" id="kPwd">–</div><div class="l">PWD</div></div>
      <div class="card kpi p-3"><div class="v" id="kColl">–</div><div class="l">Data collectors</div></div>
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <section class="card p-3">
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-landmark mr-1" style="color:var(--accent)"></i>By financial institution</h2>
        <div id="fiBars" class="space-y-1 max-h-[320px] overflow-auto scrollbar-thin"></div>
      </section>
      <section class="card p-3">
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-user-tag mr-1" style="color:var(--accent)"></i>By participant type</h2>
        <div class="overflow-auto max-h-[320px] scrollbar-thin">
          <table id="typeTbl"><thead><tr><th>Participant type</th><th class="num">Linkages</th><th class="num">Loan</th></tr></thead><tbody></tbody></table>
        </div>
      </section>
      <section class="card p-3">
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-user-pen mr-1" style="color:var(--accent)"></i>By data collector</h2>
        <div class="overflow-auto max-h-[320px] scrollbar-thin">
          <table id="collTbl"><thead><tr><th>Data collector</th><th class="num">Linkages</th><th class="num">Loan</th></tr></thead><tbody></tbody></table>
        </div>
      </section>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <section class="card p-3 lg:col-span-1">
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-bold text-[14px]"><i class="fas fa-location-dot mr-1" style="color:var(--accent)"></i>Districts</h2>
          <div class="flex gap-1">
            <button id="selAll" class="text-[10px] px-2 py-0.5 border border-[var(--line)] rounded">All</button>
            <button id="clrAll" class="text-[10px] px-2 py-0.5 border border-[var(--line)] rounded">None</button>
          </div>
        </div>
        <div id="districtList" class="scrollbar-thin overflow-y-auto max-h-[460px] pr-1"></div>
      </section>
      <section class="card p-3 lg:col-span-3">
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-table-list mr-1" style="color:var(--accent)"></i>Linkage detail</h2>
        <div class="overflow-auto max-h-[460px] scrollbar-thin">
          <table id="detailTbl">
            <thead><tr>
              <th>Linked</th><th>Financial institution</th><th>Data collector</th><th>Participant</th>
              <th>Type</th><th>Gender</th><th>PWD</th><th>District</th><th>Service</th>
              <th class="num">Loan amount</th><th>Purpose</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>
    </div>
  </main>

  ${navSidebar('banklinkage')}
  ${dashToolsAssets()}

  <script>
    var BOOT = ${bootOpts};
    var districts = [];
    var selected = new Set();

    function fmt(n){ return (n==null||isNaN(n)) ? '0' : Math.round(Number(n)).toLocaleString(); }
    function ugx(n){ n=Number(n)||0; if(n>=1e9) return 'UGX '+(n/1e9).toFixed(2)+'B'; if(n>=1e6) return 'UGX '+(n/1e6).toFixed(1)+'M'; if(n>=1e3) return 'UGX '+(n/1e3).toFixed(0)+'K'; return 'UGX '+fmt(n); }
    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function pretty(s){ return String(s==null?'':s).replace(/_/g,' ').replace(/\\b\\w/g, function(c){ return c.toUpperCase(); }); }
    function prettyDate(s){ if(!s) return ''; var d=new Date(String(s).slice(0,10)+'T00:00:00'); return isNaN(d)?'':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }

    function renderDistricts(){
      var box = document.getElementById('districtList');
      box.innerHTML = districts.map(function(d){
        return '<label class="dist-item"><input type="checkbox" data-d="'+esc(d)+'"'+(selected.has(d)?' checked':'')+'> <span>'+esc(d)+'</span></label>';
      }).join('');
      box.querySelectorAll('input[type=checkbox]').forEach(function(cb){
        cb.addEventListener('change', function(){
          var d = cb.getAttribute('data-d');
          if(cb.checked) selected.add(d); else selected.delete(d);
          load();
        });
      });
    }

    function params(){
      var p = new URLSearchParams();
      if(selected.size) p.set('districts', Array.from(selected).join(','));
      var fi = document.getElementById('fiSel').value; if(fi) p.set('institutions', fi);
      var ty = document.getElementById('typeSel').value; if(ty) p.set('types', ty);
      var f = document.getElementById('fromDate').value; if(f) p.set('from', f);
      var t = document.getElementById('toDate').value; if(t) p.set('to', t);
      return p;
    }

    function bars(el, arr, labelKey, valKey){
      var max = Math.max(1, ...arr.map(function(r){ return Number(r[valKey])||0; }));
      el.innerHTML = arr.map(function(r){
        var w = Math.round((Number(r[valKey])||0)/max*100);
        return '<div class="text-[11px]"><div class="flex justify-between"><span class="prettyFI">'+esc(pretty(r[labelKey]))+'</span><span class="font-semibold">'+ugx(r.loan)+' · '+fmt(r.linkages)+'</span></div>'+
               '<div class="bar" style="width:'+w+'%"></div></div>';
      }).join('') || '<div class="text-[11px] text-[var(--muted)]">No data</div>';
    }

    async function load(){
      document.getElementById('stamp').textContent = 'Loading…';
      var res = await fetch('/api/bank-linkage?'+params().toString());
      var d = await res.json();
      if(d.error){ document.getElementById('stamp').textContent = 'Error: '+d.error; return; }

      document.getElementById('kLink').textContent = fmt(d.total_linkages);
      document.getElementById('kLoan').textContent = ugx(d.total_loan);
      document.getElementById('kFI').textContent = fmt(d.institutions_count);
      document.getElementById('kDistricts').textContent = fmt(d.districts_count);
      document.getElementById('kFemale').textContent = fmt(d.female_count);
      document.getElementById('kPwd').textContent = fmt(d.pwd_count);
      document.getElementById('kColl').textContent = fmt(d.collectors_count);

      bars(document.getElementById('fiBars'), d.by_institution||[], 'institution', 'loan');

      document.querySelector('#typeTbl tbody').innerHTML = (d.by_type||[]).map(function(r){
        return '<tr><td class="prettyFI">'+esc(pretty(r.type))+'</td><td class="num">'+fmt(r.linkages)+'</td><td class="num">'+ugx(r.loan)+'</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-[var(--muted)]">No data</td></tr>';

      document.querySelector('#collTbl tbody').innerHTML = (d.by_collector||[]).map(function(r){
        return '<tr><td>'+esc(r.collector)+'</td><td class="num">'+fmt(r.linkages)+'</td><td class="num">'+ugx(r.loan)+'</td></tr>';
      }).join('') || '<tr><td colspan="3" class="text-[var(--muted)]">No data</td></tr>';

      document.querySelector('#detailTbl tbody').innerHTML = (d.rows||[]).map(function(r){
        return '<tr>'+
          '<td>'+prettyDate(r.linkage_date)+'</td>'+
          '<td class="prettyFI">'+esc(pretty(r.financial_institution))+'</td>'+
          '<td>'+esc(r.data_collector)+'</td>'+
          '<td>'+esc(r.participant_name)+'</td>'+
          '<td class="prettyFI">'+esc(pretty(r.participant_type))+'</td>'+
          '<td>'+esc(r.gender)+'</td>'+
          '<td>'+esc(r.pwd_status)+'</td>'+
          '<td>'+esc(r.district)+'</td>'+
          '<td class="prettyFI">'+esc(pretty(r.financial_service))+'</td>'+
          '<td class="num">'+fmt(r.loan_amount)+'</td>'+
          '<td>'+esc(pretty(r.loan_purpose))+'</td>'+
        '</tr>';
      }).join('') || '<tr><td colspan="11" class="text-[var(--muted)]">No linkages match the filters</td></tr>';

      document.getElementById('stamp').textContent = fmt((d.rows||[]).length)+' of '+fmt(d.total_linkages)+' shown';
    }

    function fillSelect(id, arr, allLabel){
      var sel = document.getElementById(id);
      sel.innerHTML = '<option value="">'+allLabel+'</option>' + arr.map(function(v){ return '<option value="'+esc(v)+'">'+esc(pretty(v))+'</option>'; }).join('');
    }

    function init(){
      districts = BOOT.districts || [];
      renderDistricts();
      fillSelect('fiSel', BOOT.institutions||[], 'All institutions');
      fillSelect('typeSel', BOOT.types||[], 'All participant types');

      var _d = new Date();
      document.getElementById('toDate').value = _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
      if(BOOT.date_bounds && BOOT.date_bounds.min) document.getElementById('fromDate').value = BOOT.date_bounds.min;

      document.getElementById('applyBtn').addEventListener('click', load);
      document.getElementById('resetBtn').addEventListener('click', function(){
        selected.clear(); renderDistricts();
        document.getElementById('fiSel').value=''; document.getElementById('typeSel').value='';
        if(BOOT.date_bounds && BOOT.date_bounds.min) document.getElementById('fromDate').value = BOOT.date_bounds.min;
        var _d=new Date(); document.getElementById('toDate').value = _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
        load();
      });
      document.getElementById('fiSel').addEventListener('change', load);
      document.getElementById('typeSel').addEventListener('change', load);
      document.getElementById('fromDate').addEventListener('change', load);
      document.getElementById('toDate').addEventListener('change', load);
      document.getElementById('selAll').addEventListener('click', function(){ selected = new Set(districts); renderDistricts(); load(); });
      document.getElementById('clrAll').addEventListener('click', function(){ selected.clear(); renderDistricts(); load(); });
      document.getElementById('xlsBtn').addEventListener('click', function(){ DashTools.exportExcel('#detailTbl','Youth_Linked_To_Banks'); });

      if(!districts.length){
        fetch('/api/bank-linkage/options').then(function(r){return r.json();}).then(function(o){
          BOOT = o || BOOT; districts = o.districts||[]; renderDistricts();
          fillSelect('fiSel', o.institutions||[], 'All institutions');
          fillSelect('typeSel', o.types||[], 'All participant types');
          if(o.date_bounds && o.date_bounds.min && !document.getElementById('fromDate').value) document.getElementById('fromDate').value = o.date_bounds.min;
          load();
        });
      } else {
        load();
      }
    }
    init();
  </script>
</body>
</html>`;
}
