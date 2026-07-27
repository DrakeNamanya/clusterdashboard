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
        <button id="dlBtn" class="btn btn-primary"><i class="fas fa-download"></i> Download Word</button>
      </div>
    </div>
    <div id="status" class="status"></div>
    <p class="hint">
      Tip: month + quarter both fill in the same document — the report shows a monthly column and a
      quarterly (cumulative) column side-by-side, exactly like the template.
    </p>
  </section>

  <div class="note">
    <b><i class="fas fa-highlighter"></i> Yellow-highlighted tables</b> — a few tables in the template have
    no clean matching data source in the system yet, so they are left blank and
    <span class="yellowchip">highlighted yellow</span> for you to fill by hand:
    <ul class="tight">
      <li><b>PSRP</b> (psychosocial referral pathway)</li>
      <li><b>Re-booking / restocking</b> table</li>
      <li><b>SACCO</b> table</li>
    </ul>
    Any other value we could not match will also appear highlighted. Tell us where that data lives and we
    will wire it in.
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
})();
</script>
</body>
</html>`;
}
