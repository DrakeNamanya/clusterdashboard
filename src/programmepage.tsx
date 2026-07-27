import { clusterOptions } from './clusters';
import { navSidebar } from './nav';

// ---------------------------------------------------------------------------
// PROGRAMME REPORT — Word (.docx) generator
//   Filters: Cluster/District + Month (from/to) + Quarter (qFrom/qTo).
//   Fetches /api/programme-report, then fills the tokenized Word template
//   (/static/programme_template.docx) entirely in the browser with JSZip:
//     - every data cell in the template is a {{SECTION.PERIOD.DISTRICT.FIELD}}
//       token (PERIOD = m|q, DISTRICT = iganga|jinja|mayuge|luuka|total).
//     - Overall-total rows are summed client-side from the four districts.
//     - {{meta.month}} / {{meta.quarter}} carry the reporting period labels.
//     - {{kpi.*}} carry the KPI-summary table actuals.
//     - {{unknown}} (tables with no clean data source) + any leftover token
//       are HIGHLIGHTED YELLOW so the user can fill them by hand later.
//   The filled document is re-zipped and downloaded as a real .docx.
// ---------------------------------------------------------------------------

export function renderProgrammeReport(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Programme Report — Word Generator</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
  <style>
    :root{
      --green:#006837; --green-2:#00A859; --lgreen:#e9f5ee; --ink:#25352c;
      --muted:#7f8c85; --line:#e2e9e4; --amber:#F6921E; --blue:#2E9BD6;
    }
    body{ background:#eef2ef; color:var(--ink); font-family:"Segoe UI",Calibri,Arial,system-ui,sans-serif; margin:0; }
    .wrap{ max-width:1080px; margin:0 auto; padding:22px 20px 60px; }
    .masthead{ background:#fff; border:1px solid var(--line); border-top:5px solid var(--green); border-radius:12px 12px 0 0; padding:20px 26px; display:flex; align-items:center; gap:24px; flex-wrap:wrap; box-shadow:0 1px 3px rgba(40,60,50,.05); }
    .mh-logo{ width:48px; height:48px; border-radius:10px; background:linear-gradient(135deg,var(--green),var(--green-2)); color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; box-shadow:0 2px 6px rgba(0,104,55,.25); }
    .mh-titleblock{ flex:1; min-width:180px; }
    .mh-doctype{ font-size:10.5px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--green-2); }
    .mh-title{ font-size:23px; font-weight:800; color:var(--ink); margin:2px 0 0; letter-spacing:-.01em; }
    .sub{ color:var(--muted); font-size:12.5px; line-height:1.6; margin:0 0 18px; background:#fff; border:1px solid var(--line); border-top:0; border-radius:0 0 12px 12px; padding:12px 26px; box-shadow:0 1px 3px rgba(40,60,50,.05); }
    .card{ background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 1px 3px rgba(40,60,50,.05); padding:22px 26px; }
    .filters{ display:flex; flex-wrap:wrap; gap:16px; align-items:flex-end; }
    .fld{ display:flex; flex-direction:column; gap:5px; }
    .fld label{ font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
    .fld select, .fld input{ border:1px solid var(--line); border-radius:9px; padding:9px 12px; font-size:13.5px; background:#fff; color:var(--ink); min-width:150px; }
    .grp{ border:1px solid var(--line); border-radius:11px; padding:12px 14px 14px; background:#fafcfb; }
    .grp-lbl{ font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:var(--green); margin-bottom:8px; display:flex; align-items:center; gap:6px; }
    .row2{ display:flex; gap:12px; flex-wrap:wrap; }
    .btn{ border:0; border-radius:10px; padding:12px 22px; font-size:14px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:9px; transition:.15s; }
    .btn-primary{ background:linear-gradient(135deg,var(--green),var(--green-2)); color:#fff; box-shadow:0 3px 9px rgba(0,104,55,.28); }
    .btn-primary:hover{ filter:brightness(1.06); }
    .btn-primary:disabled{ opacity:.55; cursor:not-allowed; filter:none; }
    .status{ margin-top:16px; font-size:13px; min-height:22px; }
    .status.ok{ color:var(--green); font-weight:700; }
    .status.err{ color:#c0392b; font-weight:700; }
    .status.busy{ color:var(--muted); }
    .hint{ font-size:12px; color:var(--muted); line-height:1.6; margin-top:6px; }
    .note{ background:var(--lgreen); border:1px solid #cfe8da; border-radius:11px; padding:14px 16px; font-size:12.5px; color:#1c4a34; line-height:1.65; margin-top:20px; }
    .note b{ color:var(--green); }
    .yellowchip{ display:inline-block; background:#fff3b0; border:1px solid #e6d15a; border-radius:4px; padding:0 6px; font-weight:700; color:#6b5a00; }
    ul.tight{ margin:6px 0 0; padding-left:20px; }
    ul.tight li{ margin:2px 0; }
    .btn-ghost{ background:#fff; color:var(--green); border:1.5px solid var(--green); }
    .btn-ghost:hover{ background:var(--lgreen); }

    /* ---- Preview modal ---- */
    .pv-overlay{ position:fixed; inset:0; background:rgba(20,35,28,.55); display:none; z-index:2000; }
    .pv-overlay.open{ display:block; }
    .pv-modal{ position:fixed; top:3vh; left:50%; transform:translateX(-50%); width:min(1000px,94vw); height:94vh; background:#fff; border-radius:14px; box-shadow:0 18px 60px rgba(0,0,0,.35); z-index:2001; display:none; flex-direction:column; overflow:hidden; }
    .pv-modal.open{ display:flex; }
    .pv-head{ display:flex; align-items:center; gap:14px; padding:14px 20px; border-bottom:1px solid var(--line); background:var(--lgreen); }
    .pv-head h2{ margin:0; font-size:16px; font-weight:800; color:var(--green); flex:1; }
    .pv-head .meta{ font-size:12px; color:var(--muted); font-weight:700; }
    .pv-close{ border:0; background:#fff; border:1px solid var(--line); border-radius:8px; width:34px; height:34px; cursor:pointer; font-size:16px; color:var(--ink); }
    .pv-close:hover{ background:#f2f2f2; }
    .pv-body{ overflow:auto; padding:22px 26px 40px; background:#f6f8f7; }
    .pv-legend{ display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted); margin:0 0 18px; }
    .pv-doc{ background:#fff; max-width:900px; margin:0 auto; border:1px solid var(--line); border-radius:8px; padding:30px 34px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
    .pv-doc h3{ font-size:15px; font-weight:800; color:var(--green); margin:26px 0 8px; border-bottom:2px solid var(--lgreen); padding-bottom:5px; }
    .pv-doc h3:first-child{ margin-top:0; }
    .pv-doc .cap{ font-size:12.5px; color:var(--ink); font-weight:700; margin:0 0 8px; }
    .pv-doc table{ width:100%; border-collapse:collapse; font-size:11.5px; margin:0 0 6px; }
    .pv-doc th, .pv-doc td{ border:1px solid #cfd8d2; padding:5px 8px; text-align:right; }
    .pv-doc th{ background:var(--green); color:#fff; font-weight:700; text-align:center; font-size:10.5px; }
    .pv-doc td.dist{ text-align:left; font-weight:700; color:var(--ink); background:#fafcfb; }
    .pv-doc tr.total td{ background:#eef5f0; font-weight:800; }
    .pv-doc td.yl{ background:#fff3b0; }
    .pv-doc .grp-head th{ background:var(--green-2); }
    .pv-meta{ display:flex; gap:26px; flex-wrap:wrap; font-size:12.5px; margin:0 0 14px; padding:12px 16px; background:var(--lgreen); border-radius:8px; }
    .pv-meta b{ color:var(--green); }
    .pv-coord{ font-size:12px; color:var(--ink); margin:0 0 18px; line-height:1.6; }
    .pv-note{ font-size:11.5px; color:#6b5a00; background:#fff8d6; border:1px solid #e6d15a; border-radius:6px; padding:8px 12px; margin:6px 0 0; }
  </style>
</head>
<body>
${navSidebar('programme')}
<div class="wrap">
  <header class="masthead">
    <div class="mh-logo"><i class="fas fa-file-word"></i></div>
    <div class="mh-titleblock">
      <div class="mh-doctype">Heifer SAYE Programme</div>
      <h1 class="mh-title">Programme Report — Word Generator</h1>
    </div>
  </header>
  <p class="sub">
    Pick the reporting <b>month</b> and <b>quarter</b> windows, choose the cluster, then download the
    monthly / quarterly SAYE Progress Report as an editable <b>Word (.docx)</b> document with the data
    tables auto-filled from live programme data.
  </p>

  <section class="card" id="filter-card">
    <div class="filters">
      <div class="fld">
        <label>Cluster</label>
        <select id="cluster">${clusterOptions('iganga')}</select>
      </div>

      <div class="grp">
        <div class="grp-lbl"><i class="fas fa-calendar-day"></i> Reporting Month</div>
        <div class="row2">
          <div class="fld"><label>From</label><input type="date" id="mFrom" value="2026-06-01" /></div>
          <div class="fld"><label>To</label><input type="date" id="mTo" value="2026-06-30" /></div>
        </div>
      </div>

      <div class="grp">
        <div class="grp-lbl"><i class="fas fa-calendar-week"></i> Reporting Quarter</div>
        <div class="row2">
          <div class="fld"><label>From</label><input type="date" id="qFrom" value="2026-04-01" /></div>
          <div class="fld"><label>To</label><input type="date" id="qTo" value="2026-06-30" /></div>
        </div>
      </div>

      <div class="fld">
        <label>&nbsp;</label>
        <button id="pvBtn" class="btn btn-ghost"><i class="fas fa-eye"></i> Preview Report</button>
      </div>
      <div class="fld">
        <label>&nbsp;</label>
        <button id="dlBtn" class="btn btn-primary"><i class="fas fa-download"></i> Download Word</button>
      </div>
    </div>
    <div id="status" class="status"></div>
    <p class="hint">
      Tip: month + quarter both fill in the same document — the report shows a monthly column and a
      quarterly (cumulative) column side-by-side, exactly like the template. Use
      <b>Preview Report</b> to read the auto-filled tables on screen before you download.
    </p>
  </section>

  <div class="note">
    <b><i class="fas fa-highlighter"></i> Yellow-highlighted cells</b> — a couple of tables still have
    no data source in the system, so they are left blank and
    <span class="yellowchip">highlighted yellow</span> for you to fill by hand:
    <ul class="tight">
      <li><b>PSRP</b> (psychosocial referral pathway) — <i>"we shall add later"</i></li>
      <li><b>SACCO</b> table</li>
    </ul>
    Any other value we could not match will also appear highlighted. Everything else — including the
    <b>poultry re-booking</b> and <b>goat distribution (Luuka &amp; Kamuli)</b> tables described in your
    guiding document — is auto-filled from live data.
  </div>
</div>

<!-- ===== Preview modal ===== -->
<div class="pv-overlay" id="pvOverlay"></div>
<div class="pv-modal" id="pvModal" role="dialog" aria-modal="true" aria-label="Programme report preview">
  <div class="pv-head">
    <h2><i class="fas fa-file-lines"></i> Programme Report — Preview</h2>
    <span class="meta" id="pvMeta"></span>
    <button class="pv-close" id="pvClose" title="Close">&times;</button>
  </div>
  <div class="pv-body">
    <p class="pv-legend">
      <span class="yellowchip">&nbsp;&nbsp;&nbsp;</span> = blank cell you fill by hand (no data source yet).
      This preview shows exactly the numbers that will be written into the Word document.
    </p>
    <div class="pv-doc" id="pvDoc"></div>
  </div>
</div>

<script>
(function(){
  var TEMPLATE_URL = '/static/programme_template.docx';
  var DISTRICTS = ['iganga','jinja','mayuge','luuka'];
  var statusEl = document.getElementById('status');
  var btn = document.getElementById('dlBtn');

  function setStatus(msg, cls){ statusEl.textContent = msg; statusEl.className = 'status ' + (cls||''); }

  // ---- cluster -> the four district keys the template expects ----------------
  // The template is hard-wired for the Iganga cluster (Iganga/Jinja/Mayuge/Luuka).
  // For other clusters we still fill using whatever districts the API returns,
  // mapped onto the four template slots in order.
  var CLUSTER_DISTRICTS = {
    all:     ['IGANGA','JINJA','MAYUGE','LUUKA'],
    iganga:  ['IGANGA','JINJA','MAYUGE','LUUKA'],
    kamuli:  ['KAMULI','KALIRO','BUYENDE'],
    bugiri:  ['BUGIRI','NAMUTUMBA','NAMAYINGO','BUGWERI'],
    central: ['MUKONO','BUIKWE','KAYUNGA']
  };

  function fmtNum(v){
    var n = Number(v||0);
    if (!isFinite(n)) return '0';
    // integers with thousands separators; decimals kept to 0 for counts
    return Math.round(n).toLocaleString('en-US');
  }
  function fmtMoney(v){ return fmtNum(v); } // UGX label already in the template

  // safe getter into indexByDistrict maps (keys are UPPERCASE district)
  function cell(map, districtUpper, field){
    var r = map && map[districtUpper];
    if (!r) return 0;
    return Number(r[field]||0);
  }

  // month label like "June 2026" from an ISO from-date
  function monthLabel(iso){
    if(!iso) return '';
    var d = new Date(iso+'T00:00:00');
    return d.toLocaleString('en-US',{month:'long', year:'numeric'});
  }
  function quarterLabel(f,t){
    if(!f||!t) return '';
    var df=new Date(f+'T00:00:00'), dt=new Date(t+'T00:00:00');
    var m = df.getMonth();
    var q = Math.floor(m/3)+1;
    var suffix = ['1st','2nd','3rd','4th'][q-1] || (q+'th');
    return suffix + ' Quarter (' + df.toLocaleString('en-US',{month:'short'}) + '–' +
           dt.toLocaleString('en-US',{month:'short'}) + ' ' + dt.getFullYear() + ')';
  }

  // Build the full token -> value dictionary from the API payload.
  function buildTokens(data, clusterKey, mFrom, qFrom, qTo){
    var T = {};
    var slots = CLUSTER_DISTRICTS[clusterKey] || CLUSTER_DISTRICTS.iganga;
    // template always has 4 named slots; map cluster districts onto them in order
    var slotKeys = ['iganga','jinja','mayuge','luuka'];

    T['meta.month'] = monthLabel(mFrom) || '';
    T['meta.quarter'] = quarterLabel(qFrom, qTo) || '';

    // ---- training tables: SECTION.(m|q).(district|total).(youth|female|pwd) ----
    var trainKeys = {
      vbhcd:'vbhcd', gender:'gender', nutrition:'nutrition', social:'social',
      life:'life', mental:'mental', srh:'srh', islatrain:'isla'
    };
    Object.keys(trainKeys).forEach(function(tok){
      var src = data.training[trainKeys[tok]];
      if(!src) return;
      ['m','q'].forEach(function(p){
        var map = (p==='m') ? src.month : src.quarter;
        var tot = {youth:0,female:0,pwd:0};
        slotKeys.forEach(function(sk, i){
          var du = slots[i];
          var y = du ? cell(map,du,'youth') : 0;
          var f = du ? cell(map,du,'female') : 0;
          var w = du ? cell(map,du,'pwd') : 0;
          T[tok+'.'+p+'.'+sk+'.youth']  = fmtNum(y);
          T[tok+'.'+p+'.'+sk+'.female'] = fmtNum(f);
          T[tok+'.'+p+'.'+sk+'.pwd']    = fmtNum(w);
          tot.youth+=y; tot.female+=f; tot.pwd+=w;
        });
        T[tok+'.'+p+'.total.youth']  = fmtNum(tot.youth);
        T[tok+'.'+p+'.total.female'] = fmtNum(tot.female);
        T[tok+'.'+p+'.total.pwd']    = fmtNum(tot.pwd);
      });
    });

    // ---- profiling: prof.(m|q).(district).(shgs|youth|female|pwd) --------------
    ['m','q'].forEach(function(p){
      var map = (p==='m') ? data.profiling.month : data.profiling.quarter;
      var tot={shgs:0,youth:0,female:0,pwd:0};
      slotKeys.forEach(function(sk,i){
        var du = slots[i];
        var s=du?cell(map,du,'shgs'):0, y=du?cell(map,du,'youth'):0,
            f=du?cell(map,du,'female'):0, w=du?cell(map,du,'pwd'):0;
        T['prof.'+p+'.'+sk+'.shgs']=fmtNum(s);
        T['prof.'+p+'.'+sk+'.youth']=fmtNum(y);
        T['prof.'+p+'.'+sk+'.female']=fmtNum(f);
        T['prof.'+p+'.'+sk+'.pwd']=fmtNum(w);
        tot.shgs+=s; tot.youth+=y; tot.female+=f; tot.pwd+=w;
      });
      T['prof.'+p+'.total.shgs']=fmtNum(tot.shgs);
      T['prof.'+p+'.total.youth']=fmtNum(tot.youth);
      T['prof.'+p+'.total.female']=fmtNum(tot.female);
      T['prof.'+p+'.total.pwd']=fmtNum(tot.pwd);
    });

    // ---- horticulture: hort.(m|q).(district).(tomatoes_kg|watermelon_pcs|sales)-
    ['m','q'].forEach(function(p){
      var map=(p==='m')?data.horticulture.month:data.horticulture.quarter;
      var tot={tomatoes_kg:0,watermelon_pcs:0,sales:0};
      slotKeys.forEach(function(sk,i){
        var du=slots[i];
        var tk=du?cell(map,du,'tomatoes_kg'):0, wm=du?cell(map,du,'watermelon_pcs'):0, sl=du?cell(map,du,'sales'):0;
        T['hort.'+p+'.'+sk+'.tomatoes_kg']=fmtNum(tk);
        T['hort.'+p+'.'+sk+'.watermelon_pcs']=fmtNum(wm);
        T['hort.'+p+'.'+sk+'.sales']=fmtMoney(sl);
        tot.tomatoes_kg+=tk; tot.watermelon_pcs+=wm; tot.sales+=sl;
      });
      T['hort.'+p+'.total.tomatoes_kg']=fmtNum(tot.tomatoes_kg);
      T['hort.'+p+'.total.watermelon_pcs']=fmtNum(tot.watermelon_pcs);
      T['hort.'+p+'.total.sales']=fmtMoney(tot.sales);
    });

    // ---- poultry distribution: poultrydist.(m|q).(district).(animals|shgs|youth)
    ['m','q'].forEach(function(p){
      var map=(p==='m')?data.poultryDist.month:data.poultryDist.quarter;
      var tot={animals:0,shgs:0,youth:0};
      slotKeys.forEach(function(sk,i){
        var du=slots[i];
        var a=du?cell(map,du,'animals'):0, s=du?cell(map,du,'shgs'):0, y=du?cell(map,du,'youth'):0;
        T['poultrydist.'+p+'.'+sk+'.animals']=fmtNum(a);
        T['poultrydist.'+p+'.'+sk+'.shgs']=fmtNum(s);
        T['poultrydist.'+p+'.'+sk+'.youth']=fmtNum(y);
        tot.animals+=a; tot.shgs+=s; tot.youth+=y;
      });
      T['poultrydist.'+p+'.total.animals']=fmtNum(tot.animals);
      T['poultrydist.'+p+'.total.shgs']=fmtNum(tot.shgs);
      T['poultrydist.'+p+'.total.youth']=fmtNum(tot.youth);
    });

    // ---- goat distribution: goatdist.(m|q).(luuka|total).(animals|shgs|youth) --
    // Template only carries Luuka + total for goats.
    ['m','q'].forEach(function(p){
      var map=(p==='m')?data.goatDist.month:data.goatDist.quarter;
      var tot={animals:0,shgs:0,youth:0};
      slotKeys.forEach(function(sk,i){
        var du=slots[i];
        var a=du?cell(map,du,'animals'):0, s=du?cell(map,du,'shgs'):0, y=du?cell(map,du,'youth'):0;
        tot.animals+=a; tot.shgs+=s; tot.youth+=y;
        if(sk==='luuka'){
          T['goatdist.'+p+'.luuka.animals']=fmtNum(a);
          T['goatdist.'+p+'.luuka.shgs']=fmtNum(s);
          T['goatdist.'+p+'.luuka.youth']=fmtNum(y);
        }
      });
      T['goatdist.'+p+'.total.animals']=fmtNum(tot.animals);
      T['goatdist.'+p+'.total.shgs']=fmtNum(tot.shgs);
      T['goatdist.'+p+'.total.youth']=fmtNum(tot.youth);
    });

    // ---- poultry sales: poultrysales.(m|q).(district).(shgs|youth|birds|amount)-
    ['m','q'].forEach(function(p){
      var map=(p==='m')?data.poultrySales.month:data.poultrySales.quarter;
      var tot={shgs:0,youth:0,birds:0,amount:0};
      slotKeys.forEach(function(sk,i){
        var du=slots[i];
        var s=du?cell(map,du,'shgs'):0, y=du?cell(map,du,'youth'):0, b=du?cell(map,du,'birds'):0, am=du?cell(map,du,'amount'):0;
        T['poultrysales.'+p+'.'+sk+'.shgs']=fmtNum(s);
        T['poultrysales.'+p+'.'+sk+'.youth']=fmtNum(y);
        T['poultrysales.'+p+'.'+sk+'.birds']=fmtNum(b);
        T['poultrysales.'+p+'.'+sk+'.amount']=fmtMoney(am);
        tot.shgs+=s; tot.youth+=y; tot.birds+=b; tot.amount+=am;
      });
      T['poultrysales.'+p+'.total.shgs']=fmtNum(tot.shgs);
      T['poultrysales.'+p+'.total.youth']=fmtNum(tot.youth);
      T['poultrysales.'+p+'.total.birds']=fmtNum(tot.birds);
      T['poultrysales.'+p+'.total.amount']=fmtMoney(tot.amount);
    });

    // ---- poultry re-booking: rebooking.(m|q).(district).(youth|birds) ----------
    // (repeat bird recipients; computed by the backend per the guiding document)
    if (data.rebooking) {
      ['m','q'].forEach(function(p){
        var map=(p==='m')?data.rebooking.month:data.rebooking.quarter;
        var tot={youth:0,birds:0};
        slotKeys.forEach(function(sk,i){
          var du=slots[i];
          var y=du?cell(map,du,'youth'):0, b=du?cell(map,du,'birds'):0;
          T['rebooking.'+p+'.'+sk+'.youth']=fmtNum(y);
          T['rebooking.'+p+'.'+sk+'.birds']=fmtNum(b);
          tot.youth+=y; tot.birds+=b;
        });
        T['rebooking.'+p+'.total.youth']=fmtNum(tot.youth);
        T['rebooking.'+p+'.total.birds']=fmtNum(tot.birds);
      });
    }

    // ---- ISLA savings: isla.(m|q).(district).(savers|saved|loans) --------------
    ['m','q'].forEach(function(p){
      var map=(p==='m')?data.isla.month:data.isla.quarter;
      var tot={savers:0,saved:0,loans:0};
      slotKeys.forEach(function(sk,i){
        var du=slots[i];
        var sv=du?cell(map,du,'savers'):0, sd=du?cell(map,du,'saved'):0, ln=du?cell(map,du,'loans'):0;
        T['isla.'+p+'.'+sk+'.savers']=fmtNum(sv);
        T['isla.'+p+'.'+sk+'.saved']=fmtMoney(sd);
        T['isla.'+p+'.'+sk+'.loans']=fmtMoney(ln);
        tot.savers+=sv; tot.saved+=sd; tot.loans+=ln;
      });
      T['isla.'+p+'.total.savers']=fmtNum(tot.savers);
      T['isla.'+p+'.total.saved']=fmtMoney(tot.saved);
      T['isla.'+p+'.total.loans']=fmtMoney(tot.loans);
    });

    // ---- KPI summary table (quarterly cumulative actuals) ----------------------
    function sumField(block, field){
      var q = block.quarter || {};
      var s=0; Object.keys(q).forEach(function(k){ s += Number(q[k][field]||0); });
      return s;
    }
    // reached = distinct-ish sum of profiling youth (quarter)
    var reached = sumField(data.profiling,'youth');
    var female  = sumField(data.profiling,'female');
    var pwd     = sumField(data.profiling,'pwd');
    var shgs    = sumField(data.profiling,'shgs');
    var hortProduce = sumField(data.horticulture,'tomatoes_kg') + sumField(data.horticulture,'watermelon_pcs');
    var hortSales   = sumField(data.horticulture,'sales');
    var poultryProduce = sumField(data.poultryDist,'animals');
    var poultrySales   = sumField(data.poultrySales,'amount');
    var islaGroups = sumField(data.profiling,'shgs'); // proxy: profiled SHGs
    var saved   = sumField(data.isla,'saved');
    var loans   = sumField(data.isla,'loans');
    var loanYouth = sumField(data.isla,'savers');
    var leverage = Number((data.leverage && data.leverage.quarter) || 0);

    T['kpi.reached']=fmtNum(reached);
    T['kpi.female']=fmtNum(female);
    T['kpi.pwd']=fmtNum(pwd);
    T['kpi.shgs']=fmtNum(shgs);
    T['kpi.hort_produce']=fmtNum(hortProduce);
    T['kpi.hort_sales']=fmtMoney(hortSales);
    T['kpi.poultry_produce']=fmtNum(poultryProduce);
    T['kpi.poultry_sales']=fmtMoney(poultrySales);
    T['kpi.isla_groups']=fmtNum(islaGroups);
    T['kpi.saved']=fmtMoney(saved);
    T['kpi.loans']=fmtMoney(loans);
    T['kpi.loan_youth']=fmtNum(loanYouth);
    T['kpi.leverage']=fmtMoney(leverage);

    return T;
  }

  // XML-escape a value so it is safe inside document.xml text nodes
  function xmlEsc(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Replace tokens in document.xml. Any leftover {{...}} (incl {{unknown}})
  // gets its enclosing run highlighted yellow.
  function fillXml(xml, tokens){
    // 1) replace known tokens
    xml = xml.replace(/\\{\\{([a-z0-9._]+)\\}\\}/g, function(m, key){
      if (Object.prototype.hasOwnProperty.call(tokens, key)) {
        return xmlEsc(tokens[key]);
      }
      return m; // leave unknown/leftover for highlight pass
    });

    // 2) highlight any run that still contains a {{...}} token (unknown / unmatched).
    //    A run looks like <w:r> ... <w:t ...>text {{tok}}</w:t> </w:r>.
    //    We inject a yellow highlight into that run's <w:rPr>, then blank the token text.
    xml = xml.replace(/<w:r\\b[^>]*>[\\s\\S]*?<\\/w:r>/g, function(run){
      if (run.indexOf('{{') === -1) return run;
      // blank out the token text so the doc looks empty (highlighted) not literal {{..}}
      var cleaned = run.replace(/\\{\\{[a-z0-9._]+\\}\\}/g, '');
      // add highlight to rPr
      if (/<w:rPr>/.test(cleaned)) {
        if (!/<w:highlight\\b/.test(cleaned)) {
          cleaned = cleaned.replace('<w:rPr>', '<w:rPr><w:highlight w:val="yellow"/>');
        }
      } else {
        // insert an rPr right after the opening <w:r ...>
        cleaned = cleaned.replace(/(<w:r\\b[^>]*>)/, '$1<w:rPr><w:highlight w:val="yellow"/></w:rPr>');
      }
      return cleaned;
    });

    return xml;
  }

  function download(blob, name){
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  btn.addEventListener('click', async function(){
    var cluster = document.getElementById('cluster').value;
    var mFrom = document.getElementById('mFrom').value;
    var mTo   = document.getElementById('mTo').value;
    var qFrom = document.getElementById('qFrom').value;
    var qTo   = document.getElementById('qTo').value;
    if(!mFrom||!mTo||!qFrom||!qTo){ setStatus('Please set both the month and quarter date ranges.','err'); return; }

    btn.disabled = true;
    try {
      setStatus('Fetching programme data…','busy');
      var slots = CLUSTER_DISTRICTS[cluster] || CLUSTER_DISTRICTS.iganga;
      var qs = new URLSearchParams({
        districts: slots.join(','),
        from: mFrom, to: mTo, qFrom: qFrom, qTo: qTo
      });
      var apiRes = await fetch('/api/programme-report?' + qs.toString());
      if(!apiRes.ok) throw new Error('API returned ' + apiRes.status);
      var data = await apiRes.json();

      setStatus('Loading Word template…','busy');
      var tplRes = await fetch(TEMPLATE_URL);
      if(!tplRes.ok) throw new Error('Template load failed (' + tplRes.status + ')');
      var tplBuf = await tplRes.arrayBuffer();

      setStatus('Filling document…','busy');
      var zip = await JSZip.loadAsync(tplBuf);
      var docFile = zip.file('word/document.xml');
      if(!docFile) throw new Error('document.xml missing from template');
      var xml = await docFile.async('string');

      var tokens = buildTokens(data, cluster, mFrom, qFrom, qTo);
      xml = fillXml(xml, tokens);
      zip.file('word/document.xml', xml);

      setStatus('Packaging .docx…','busy');
      var out = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        compression: 'DEFLATE'
      });

      var fname = 'SAYE_Programme_Report_' + (mFrom||'report') + '.docx';
      download(out, fname);
      setStatus('Downloaded ' + fname + ' — tables auto-filled; yellow cells need manual input.','ok');
    } catch(err){
      console.error(err);
      setStatus('Error: ' + (err && err.message ? err.message : err), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  // =========================================================================
  //  PREVIEW  — render the auto-filled tables as HTML so the user can read the
  //  report on screen before downloading. Uses the SAME buildTokens() values
  //  that get written into the .docx, so the preview matches the download.
  // =========================================================================
  var pvOverlay = document.getElementById('pvOverlay');
  var pvModal   = document.getElementById('pvModal');
  var pvDoc     = document.getElementById('pvDoc');
  var pvMeta    = document.getElementById('pvMeta');
  var pvBtn     = document.getElementById('pvBtn');
  var pvClose   = document.getElementById('pvClose');

  var COORDINATORS = {
    iganga:  'Francis Arinaitwe · Francis.Arinaitwe@heifer.org · +256 788 748461',
    bugiri:  'Ojok Ronald · Ojok.ronald@heifer.org · +256 776 913909',
    kamuli:  'Ruth Nabbanja · Ruth.Nabbanja@heifer.org · +256 778 948759',
    central: '—',
    all:     'Francis Arinaitwe (Iganga) · Ojok Ronald (Bugiri) · Ruth Nabbanja (Kamuli)'
  };

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function t(tokens, key){ return Object.prototype.hasOwnProperty.call(tokens,key) ? tokens[key] : ''; }

  // Build a two-block (Month | Quarter) district table from token prefixes.
  //   section  = token section (e.g. 'gender')
  //   fields   = [{key, label}]  (per-column fields, in order)
  //   distList = ['iganga','jinja','mayuge','luuka','total'] slots to show
  function districtTable(tokens, section, fields, distList, distLabels){
    var nf = fields.length;
    var h = '<table>';
    // group header
    h += '<tr class="grp-head"><th rowspan="2">District</th>'
       + '<th colspan="'+nf+'">Month</th>'
       + '<th colspan="'+nf+'">Quarter (cumulative)</th></tr>';
    h += '<tr>';
    for(var b=0;b<2;b++){ fields.forEach(function(f){ h += '<th>'+esc(f.label)+'</th>'; }); }
    h += '</tr>';
    distList.forEach(function(d){
      var isTot = (d==='total');
      h += '<tr'+(isTot?' class="total"':'')+'>';
      h += '<td class="dist">'+esc(distLabels[d]||d)+'</td>';
      ['m','q'].forEach(function(p){
        fields.forEach(function(f){
          var v = t(tokens, section+'.'+p+'.'+d+'.'+f.key);
          h += '<td>'+ (v===''? '—' : esc(v)) +'</td>';
        });
      });
      h += '</tr>';
    });
    h += '</table>';
    return h;
  }

  // A blank (manual-entry) table rendered with yellow cells.
  function blankTable(cols, rows){
    var h='<table><tr class="grp-head">';
    cols.forEach(function(c){ h+='<th>'+esc(c)+'</th>'; });
    h+='</tr>';
    for(var r=0;r<rows;r++){
      h+='<tr>';
      cols.forEach(function(c,ci){ h+= ci===0 ? '<td class="dist yl">&nbsp;</td>' : '<td class="yl">&nbsp;</td>'; });
      h+='</tr>';
    }
    h+='</table>';
    return h;
  }

  function buildPreviewHTML(tokens, data, cluster, mFrom, qFrom, qTo){
    var slots = CLUSTER_DISTRICTS[cluster] || CLUSTER_DISTRICTS.iganga;
    var slotKeys = ['iganga','jinja','mayuge','luuka'];
    var labels = { iganga:'Iganga', jinja:'Jinja', mayuge:'Mayuge', luuka:'Luuka', total:'Overall total' };
    // real district names for this cluster (fall back to slot labels)
    slotKeys.forEach(function(sk,i){ if(slots[i]) labels[sk] = slots[i].charAt(0)+slots[i].slice(1).toLowerCase(); });
    var dl = slotKeys.filter(function(sk,i){ return !!slots[i]; }).concat(['total']);

    var monthLbl = t(tokens,'meta.month') || (mFrom||'');
    var qtrLbl   = t(tokens,'meta.quarter') || '';
    var coord = COORDINATORS[cluster] || COORDINATORS.iganga;

    var youthFields = [{key:'youth',label:'No of Youth'},{key:'female',label:'Female'},{key:'pwd',label:'PWD'}];

    var h = '';
    h += '<h3>Report meta</h3>';
    h += '<div class="pv-meta">'
       + '<div><b>Cluster:</b> '+esc(cluster.charAt(0).toUpperCase()+cluster.slice(1))+'</div>'
       + '<div><b>Reporting month:</b> '+esc(monthLbl)+'</div>'
       + '<div><b>Reporting quarter:</b> '+esc(qtrLbl)+'</div>'
       + '</div>';
    h += '<p class="pv-coord"><b>Cluster Coordinator:</b> '+esc(coord)+'</p>';

    // --- Summary of Outreach Actuals (derived per guiding document) ----------
    (function(){
      function qsum(block, field){ var q=(block&&block.quarter)||{}; var s=0; Object.keys(q).forEach(function(k){ s+=Number(q[k][field]||0); }); return s; }
      function msum(block, field){ var m=(block&&block.month)||{}; var s=0; Object.keys(m).forEach(function(k){ s+=Number(m[k][field]||0); }); return s; }
      function pct(a,b){ return b>0 ? (Math.round(a/b*1000)/10)+'%' : '—'; }
      function n(x){ return Math.round(Number(x||0)).toLocaleString('en-US'); }
      // Outreach = new youth reached; we proxy "reached" with profiling youth.
      var mReached=msum(data.profiling,'youth'), qReached=qsum(data.profiling,'youth');
      var mFemale =msum(data.profiling,'female'),qFemale =qsum(data.profiling,'female');
      var mPwd    =msum(data.profiling,'pwd'),   qPwd    =qsum(data.profiling,'pwd');
      var mProf   =msum(data.profiling,'shgs'),  qProf   =qsum(data.profiling,'shgs');
      h += '<h3>Summary of Outreach Actuals</h3>';
      h += '<table>';
      h += '<tr class="grp-head"><th style="text-align:left">Indicator</th><th>Month</th><th>Quarter</th></tr>';
      function row(lbl,mv,qv,yl){ return '<tr><td class="dist">'+esc(lbl)+'</td>'
        + '<td'+(yl?' class="yl"':'')+'>'+(yl?'&nbsp;':mv)+'</td>'
        + '<td'+(yl?' class="yl"':'')+'>'+(yl?'&nbsp;':qv)+'</td></tr>'; }
      h += row('Total Profiled (groups)', n(mProf), n(qProf));
      h += row('Total Outreach (new youth reached)', n(mReached), n(qReached));
      h += row('Total Female (70%)', n(mFemale)+' ('+pct(mFemale,mReached)+')', n(qFemale)+' ('+pct(qFemale,qReached)+')');
      h += row('Total Youth 16–35', n(mReached), n(qReached));
      h += row('Total Youth with Disabilities (3%)', n(mPwd)+' ('+pct(mPwd,mReached)+')', n(qPwd)+' ('+pct(qPwd,qReached)+')');
      h += row('Total Refugees / Displaced', '0', '0');
      h += row('Total Rural', n(mReached), n(qReached));
      h += '</table>';
      h += '<p class="pv-note">Female %, PWD % and "Youth 16–35 / Rural = same as reached" follow the guiding document. '
         + 'Work-primary / enterprise rows are marked "add later" in the guiding document and stay blank in the Word file.</p>';
    })();

    // --- Group formation & profiling -----------------------------------------
    h += '<h3>Group formation &amp; participant profiling</h3>';
    h += '<p class="cap">SHGs formed and participants profiled — per district.</p>';
    h += districtTable(tokens,'prof',
          [{key:'shgs',label:'No of SHGs'},{key:'youth',label:'No of Youth'},{key:'female',label:'Female'},{key:'pwd',label:'PWD'}],
          dl, labels);

    // --- Training tables -------------------------------------------------------
    var trainTables = [
      ['vbhcd','Heifer cornerstones / group dynamics &amp; leadership (VBHCD Model)'],
      ['gender','Gender &amp; safeguarding training'],
      ['nutrition','Nutrition training'],
      ['social','Social perception change training'],
      ['life','Life skills training'],
      ['mental','Mental health &amp; wellness training'],
      ['srh','Sexual &amp; reproductive health (SRHR) training'],
      ['islatrain','ISLA training']
    ];
    h += '<h3>Training breakdown per district</h3>';
    trainTables.forEach(function(tt){
      h += '<p class="cap">'+tt[1]+'</p>';
      h += districtTable(tokens, tt[0], youthFields, dl, labels);
    });

    // --- PSRP (blank / manual) -------------------------------------------------
    h += '<h3>PSRP</h3>';
    h += '<p class="cap">No data source yet — <b>"we shall add later"</b>. Fill by hand.</p>';
    h += blankTable(['District','Month','Quarter'], dl.length);

    // --- Horticulture ----------------------------------------------------------
    h += '<h3>Harvest &amp; sales (Horticulture / oil seeds)</h3>';
    h += '<p class="cap">From the marketing &amp; production form.</p>';
    h += districtTable(tokens,'hort',
          [{key:'tomatoes_kg',label:'Tomatoes (Kgs)'},{key:'watermelon_pcs',label:'Watermelon (Pcs)'},{key:'sales',label:'Sales (UGX)'}],
          dl, labels);

    // --- Poultry distribution --------------------------------------------------
    h += '<h3>Poultry birds distribution</h3>';
    h += districtTable(tokens,'poultrydist',
          [{key:'animals',label:'Birds'},{key:'shgs',label:'SHGs'},{key:'youth',label:'Youth'}],
          dl, labels);

    // --- Poultry re-booking (derived: rebooked = repeat recipients) ------------
    h += '<h3>Poultry birds re-booking</h3>';
    h += '<p class="cap">Youth who received birds more than once (repeat distributions) — per the guiding document.</p>';
    (function(){
      var rb = data.rebooking || null;
      if(!rb){
        h += blankTable(['District','Youth re-booked (M)','Birds (M)','Youth re-booked (Q)','Birds (Q)'], dl.length);
        h += '<p class="pv-note">Re-booking figures load with the report — showing blank only if this build predates the re-booking query.</p>';
        return;
      }
      h += '<table><tr class="grp-head"><th rowspan="2">District</th><th colspan="2">Month</th><th colspan="2">Quarter</th></tr>'
         + '<tr><th>Youth re-booked</th><th>Birds</th><th>Youth re-booked</th><th>Birds</th></tr>';
      dl.forEach(function(d){
        var isTot=(d==='total');
        h += '<tr'+(isTot?' class="total"':'')+'><td class="dist">'+esc(labels[d]||d)+'</td>';
        ['m','q'].forEach(function(p){
          var v1=t(tokens,'rebooking.'+p+'.'+d+'.youth'), v2=t(tokens,'rebooking.'+p+'.'+d+'.birds');
          h += '<td>'+(v1===''?'—':esc(v1))+'</td><td>'+(v2===''?'—':esc(v2))+'</td>';
        });
        h += '</tr>';
      });
      h += '</table>';
    })();

    // --- Poultry sales ---------------------------------------------------------
    h += '<h3>Poultry birds sales</h3>';
    h += districtTable(tokens,'poultrysales',
          [{key:'shgs',label:'SHGs'},{key:'youth',label:'Youth'},{key:'birds',label:'Birds sold'},{key:'amount',label:'Amount (UGX)'}],
          dl, labels);

    // --- Goat distribution (Luuka & Kamuli only per guiding doc) ---------------
    h += '<h3>Goats distribution</h3>';
    h += '<p class="cap">Livestock distribution — Luuka &amp; Kamuli districts (per the guiding document).</p>';
    h += districtTable(tokens,'goatdist',
          [{key:'animals',label:'Goats'},{key:'shgs',label:'SHGs'},{key:'youth',label:'Youth'}],
          ['luuka','total'], labels);

    // --- ISLA savings ----------------------------------------------------------
    h += '<h3>ISLA savings</h3>';
    h += districtTable(tokens,'isla',
          [{key:'savers',label:'No of Youth'},{key:'saved',label:'Amount saved (UGX)'},{key:'loans',label:'Loan amount (UGX)'}],
          dl, labels);

    // --- Leverage --------------------------------------------------------------
    (function(){
      var lm = (data.leverage&&data.leverage.month)||0, lq=(data.leverage&&data.leverage.quarter)||0;
      h += '<h3>Local leverage</h3>';
      h += '<table><tr class="grp-head"><th style="text-align:left">Indicator</th><th>Month</th><th>Quarter</th></tr>'
         + '<tr><td class="dist">Local leverage (UGX)</td><td>'+Math.round(Number(lm)).toLocaleString('en-US')
         + '</td><td>'+Math.round(Number(lq)).toLocaleString('en-US')+'</td></tr></table>';
    })();

    return h;
  }

  function openPreview(){ pvOverlay.classList.add('open'); pvModal.classList.add('open'); document.body.style.overflow='hidden'; }
  function closePreview(){ pvOverlay.classList.remove('open'); pvModal.classList.remove('open'); document.body.style.overflow=''; }
  pvOverlay.addEventListener('click', closePreview);
  pvClose.addEventListener('click', closePreview);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closePreview(); });

  pvBtn.addEventListener('click', async function(){
    var cluster = document.getElementById('cluster').value;
    var mFrom = document.getElementById('mFrom').value;
    var mTo   = document.getElementById('mTo').value;
    var qFrom = document.getElementById('qFrom').value;
    var qTo   = document.getElementById('qTo').value;
    if(!mFrom||!mTo||!qFrom||!qTo){ setStatus('Please set both the month and quarter date ranges.','err'); return; }

    pvBtn.disabled = true;
    try {
      setStatus('Building preview…','busy');
      var slots = CLUSTER_DISTRICTS[cluster] || CLUSTER_DISTRICTS.iganga;
      var qs = new URLSearchParams({ districts: slots.join(','), from: mFrom, to: mTo, qFrom: qFrom, qTo: qTo });
      var apiRes = await fetch('/api/programme-report?' + qs.toString());
      if(!apiRes.ok) throw new Error('API returned ' + apiRes.status);
      var data = await apiRes.json();

      var tokens = buildTokens(data, cluster, mFrom, qFrom, qTo);
      pvDoc.innerHTML = buildPreviewHTML(tokens, data, cluster, mFrom, qFrom, qTo);
      pvMeta.textContent = (t(tokens,'meta.month')||'') + '  ·  ' + (t(tokens,'meta.quarter')||'');
      openPreview();
      setStatus('Preview ready — review the tables, then Download Word.','ok');
    } catch(err){
      console.error(err);
      setStatus('Preview error: ' + (err && err.message ? err.message : err), 'err');
    } finally {
      pvBtn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}
