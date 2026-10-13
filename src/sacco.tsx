import { navSidebar } from './nav';
import { dashToolsAssets } from './dashtools';
// ---------------------------------------------------------------------------
// SACCO LOAN TRACKING dashboard
//   Source: loan_portfolio_monitoring_tool OData feed -> sacco_loan_rows.
//   Tracks the SACCOs youth get loans through, participant name, gender, PWD
//   status, district, line of business, loan amount, purpose, interest rate,
//   submitter name and date of disbursement.
//   KPIs + by-SACCO summary + by-district + by-business-line + detail table.
//   Filters: District + SACCO + Business line + Disbursement date range.
//   Data from /api/sacco-loans (+ /options).
// ---------------------------------------------------------------------------

export function renderSacco(base: string, opts: any = {}): string {
  const bootOpts = JSON.stringify({
    districts: opts.districts || [],
    saccos: opts.saccos || [],
    biz_lines: opts.biz_lines || [],
    date_bounds: opts.date_bounds || { min: null, max: null },
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SACCO Loan Tracking</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{ --paper:#fff; --ink:#1f3a2e; --accent:#0B6E4F; --accent2:#13925f;
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
    thead th{ background:#e8f3ee; color:var(--ink); font-weight:700; font-size:10.5px;
              padding:6px 8px; text-align:left; position:sticky; top:0; z-index:2; white-space:nowrap; }
    thead th.num{ text-align:right; }
    tbody td{ padding:4px 8px; font-size:11px; vertical-align:top; border-bottom:1px solid #eef2f4; white-space:nowrap; }
    tbody td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    tbody tr:nth-child(even) td{ background:#fafbfc; }
    tbody tr:hover td{ background:#eef7f2; }
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
  </style>
</head>
<body>
  <main class="max-w-[1400px] mx-auto p-4">
    <header class="mb-4">
      <h1 class="text-2xl font-extrabold" style="color:var(--accent)">
        <i class="fas fa-hand-holding-dollar mr-2"></i>SACCO Loan Tracking
      </h1>
      <p class="text-sm text-[var(--muted)]">Loans SAYE youth receive through SACCOs — SACCO name, participant, gender, PWD, district, line of business, loan amount, purpose, interest rate, submitter and disbursement date.</p>
    </header>

    <section class="card p-3 mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="slbl mb-1">Disbursed from</div>
          <input id="fromDate" type="date" class="bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]" />
        </div>
        <div>
          <div class="slbl mb-1">Disbursed to</div>
          <input id="toDate" type="date" class="bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]" />
        </div>
        <div class="min-w-[180px]">
          <div class="slbl mb-1">SACCO</div>
          <select id="saccoSel" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]"><option value="">All SACCOs</option></select>
        </div>
        <div class="min-w-[160px]">
          <div class="slbl mb-1">Line of business</div>
          <select id="bizSel" class="w-full bg-white border border-[var(--line)] rounded px-2 py-1 text-[12px]"><option value="">All business lines</option></select>
        </div>
        <button id="applyBtn" class="btn"><i class="fas fa-filter mr-1"></i>Apply</button>
        <button id="resetBtn" class="btn ghost">Reset</button>
        <button id="xlsBtn" class="btn ghost"><i class="fas fa-file-excel mr-1"></i>Export</button>
        <span id="stamp" class="text-[11px] text-[var(--muted)] ml-auto"></span>
      </div>
    </section>

    <section class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      <div class="card kpi p-3"><div class="v" id="kLoans">–</div><div class="l">Loans</div></div>
      <div class="card kpi p-3"><div class="v" id="kAmount">–</div><div class="l">Total disbursed</div></div>
      <div class="card kpi p-3"><div class="v" id="kSaccos">–</div><div class="l">SACCOs</div></div>
      <div class="card kpi p-3"><div class="v" id="kDistricts">–</div><div class="l">Districts</div></div>
      <div class="card kpi p-3"><div class="v" id="kFemale">–</div><div class="l">Female</div></div>
      <div class="card kpi p-3"><div class="v" id="kPwd">–</div><div class="l">PWD</div></div>
      <div class="card kpi p-3"><div class="v" id="kInterest">–</div><div class="l">Avg interest</div></div>
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <section class="card p-3">
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-building-columns mr-1" style="color:var(--accent)"></i>By SACCO</h2>
        <div class="overflow-auto max-h-[320px] scrollbar-thin">
          <table id="saccoTbl"><thead><tr><th>SACCO</th><th class="num">Loans</th><th class="num">Amount</th><th class="num">Female</th><th class="num">PWD</th></tr></thead><tbody></tbody></table>
        </div>
      </section>
      <section class="card p-3">
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-location-dot mr-1" style="color:var(--accent)"></i>By district</h2>
        <div id="distBars" class="space-y-1 max-h-[320px] overflow-auto scrollbar-thin"></div>
      </section>
      <section class="card p-3">
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-briefcase mr-1" style="color:var(--accent)"></i>By line of business</h2>
        <div id="bizBars" class="space-y-1 max-h-[320px] overflow-auto scrollbar-thin"></div>
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
        <h2 class="font-bold text-[14px] mb-2"><i class="fas fa-table-list mr-1" style="color:var(--accent)"></i>Loan detail</h2>
        <div class="overflow-auto max-h-[460px] scrollbar-thin">
          <table id="detailTbl">
            <thead><tr>
              <th>Disbursed</th><th>SACCO</th><th>Participant</th><th>Gender</th><th>PWD</th>
              <th>District</th><th>Business line</th><th class="num">Loan amount</th><th>Purpose</th>
              <th class="num">Interest %</th><th>Submitter</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </section>
    </div>
  </main>

  ${navSidebar('sacco')}
  ${dashToolsAssets()}

  <script>
    var BOOT = ${bootOpts};
    var districts = [];
    var selected = new Set();

    function fmt(n){ return (n==null||isNaN(n)) ? '0' : Math.round(Number(n)).toLocaleString(); }
    function ugx(n){ n=Number(n)||0; if(n>=1e9) return 'UGX '+(n/1e9).toFixed(2)+'B'; if(n>=1e6) return 'UGX '+(n/1e6).toFixed(1)+'M'; if(n>=1e3) return 'UGX '+(n/1e3).toFixed(0)+'K'; return 'UGX '+fmt(n); }
    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function prettyDate(s){ if(!s) return ''; var d=new Date(String(s).slice(0,10)+'T00:00:00'); return isNaN(d)?'':d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }

    function renderDistricts(){
      var box = document.getElementById('districtList');
      box.innerHTML = districts.map(function(d){
        var on = selected.size===0 || selected.has(d);
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
      var sc = document.getElementById('saccoSel').value; if(sc) p.set('saccos', sc);
      var bz = document.getElementById('bizSel').value; if(bz) p.set('biz', bz);
      var f = document.getElementById('fromDate').value; if(f) p.set('from', f);
      var t = document.getElementById('toDate').value; if(t) p.set('to', t);
      return p;
    }

    function bars(el, arr, labelKey){
      var max = Math.max(1, ...arr.map(function(r){ return Number(r.amount)||0; }));
      el.innerHTML = arr.map(function(r){
        var w = Math.round((Number(r.amount)||0)/max*100);
        return '<div class="text-[11px]"><div class="flex justify-between"><span>'+esc(r[labelKey])+'</span><span class="font-semibold">'+ugx(r.amount)+' · '+fmt(r.loans)+'</span></div>'+
               '<div class="bar" style="width:'+w+'%"></div></div>';
      }).join('') || '<div class="text-[11px] text-[var(--muted)]">No data</div>';
    }

    async function load(){
      document.getElementById('stamp').textContent = 'Loading…';
      var res = await fetch('/api/sacco-loans?'+params().toString());
      var d = await res.json();
      if(d.error){ document.getElementById('stamp').textContent = 'Error: '+d.error; return; }

      document.getElementById('kLoans').textContent = fmt(d.total_loans);
      document.getElementById('kAmount').textContent = ugx(d.total_amount);
      document.getElementById('kSaccos').textContent = fmt(d.saccos_count);
      document.getElementById('kDistricts').textContent = fmt(d.districts_count);
      document.getElementById('kFemale').textContent = fmt(d.female_count);
      document.getElementById('kPwd').textContent = fmt(d.pwd_count);
      document.getElementById('kInterest').textContent = (d.avg_interest==null?'–':(Number(d.avg_interest).toFixed(1)+'%'));

      document.querySelector('#saccoTbl tbody').innerHTML = (d.by_sacco||[]).map(function(r){
        return '<tr><td>'+esc(r.sacco)+'</td><td class="num">'+fmt(r.loans)+'</td><td class="num">'+ugx(r.amount)+'</td><td class="num">'+fmt(r.female)+'</td><td class="num">'+fmt(r.pwd)+'</td></tr>';
      }).join('') || '<tr><td colspan="5" class="text-[var(--muted)]">No data</td></tr>';

      bars(document.getElementById('distBars'), d.by_district||[], 'district');
      bars(document.getElementById('bizBars'), d.by_biz||[], 'biz');

      document.querySelector('#detailTbl tbody').innerHTML = (d.rows||[]).map(function(r){
        return '<tr>'+
          '<td>'+prettyDate(r.disbursement_date)+'</td>'+
          '<td>'+esc(r.sacco_name)+'</td>'+
          '<td>'+esc(r.participant_name)+'</td>'+
          '<td>'+esc(r.gender)+'</td>'+
          '<td>'+esc(r.pwd_status)+'</td>'+
          '<td>'+esc(r.district)+'</td>'+
          '<td>'+esc(r.line_of_business)+'</td>'+
          '<td class="num">'+fmt(r.loan_amount)+'</td>'+
          '<td>'+esc(r.loan_purpose)+'</td>'+
          '<td class="num">'+(r.interest_rate==null?'':Number(r.interest_rate))+'</td>'+
          '<td>'+esc(r.submitter_name)+'</td>'+
        '</tr>';
      }).join('') || '<tr><td colspan="11" class="text-[var(--muted)]">No loans match the filters</td></tr>';

      document.getElementById('stamp').textContent = fmt((d.rows||[]).length)+' of '+fmt(d.total_loans)+' shown';
    }

    function fillSelect(id, arr, allLabel){
      var sel = document.getElementById(id);
      sel.innerHTML = '<option value="">'+allLabel+'</option>' + arr.map(function(v){ return '<option value="'+esc(v)+'">'+esc(v)+'</option>'; }).join('');
    }

    function init(){
      districts = BOOT.districts || [];
      renderDistricts();
      fillSelect('saccoSel', BOOT.saccos||[], 'All SACCOs');
      fillSelect('bizSel', BOOT.biz_lines||[], 'All business lines');

      // Date to = today (per dashboard standard); from = disbursement min bound.
      var _d = new Date();
      document.getElementById('toDate').value = _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
      if(BOOT.date_bounds && BOOT.date_bounds.min) document.getElementById('fromDate').value = BOOT.date_bounds.min;

      document.getElementById('applyBtn').addEventListener('click', load);
      document.getElementById('resetBtn').addEventListener('click', function(){
        selected.clear(); renderDistricts();
        document.getElementById('saccoSel').value=''; document.getElementById('bizSel').value='';
        if(BOOT.date_bounds && BOOT.date_bounds.min) document.getElementById('fromDate').value = BOOT.date_bounds.min;
        var _d=new Date(); document.getElementById('toDate').value = _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0');
        load();
      });
      document.getElementById('saccoSel').addEventListener('change', load);
      document.getElementById('bizSel').addEventListener('change', load);
      document.getElementById('fromDate').addEventListener('change', load);
      document.getElementById('toDate').addEventListener('change', load);
      document.getElementById('selAll').addEventListener('click', function(){ selected = new Set(districts); renderDistricts(); load(); });
      document.getElementById('clrAll').addEventListener('click', function(){ selected.clear(); renderDistricts(); load(); });
      document.getElementById('xlsBtn').addEventListener('click', function(){ DashTools.exportExcel('#detailTbl','SACCO_Loan_Tracking'); });

      // If the boot payload was empty (server fell back), fetch options client-side.
      if(!districts.length){
        fetch('/api/sacco-loans/options').then(function(r){return r.json();}).then(function(o){
          BOOT = o || BOOT; districts = o.districts||[]; renderDistricts();
          fillSelect('saccoSel', o.saccos||[], 'All SACCOs');
          fillSelect('bizSel', o.biz_lines||[], 'All business lines');
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
