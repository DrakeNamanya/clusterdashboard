import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// CF PAYMENT REPORT
//   ONE consolidated end-of-month report combining ALL Community Facilitators
//   (unlike the CF Report Card which prints a single CF at a time). It is the
//   month's payment-processing summary, FILTERED BY DATE + DISTRICT.
//
//   Structure mirrors the manual sample (Annex A1..A9 — one section per
//   indicator, each listing every CF with a concise Activity Summary and the
//   Groups/SHGs touched). The old manual "Status" column is REPLACED by the
//   GRADE (A..E) taken from the CF Performance Card (overall score).
//
//   Submitted by: Cluster M&E Officer   ·   Approved by: District Business Facilitator
//   Live data: /api/cf-payment-report (mel_cf_payment_report RPC).
//   Design language cloned from CF Report Card (Royal Blue #003399, A4 print).
// ---------------------------------------------------------------------------

export function renderCfPaymentReport(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF Payment Report — SAYE Uganda MEL</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root{
      --primary:#003399; --primary-deep:#001f5c; --primary-tint:#eef2fb;
      --fg:#1b2437; --muted-fg:#5a6480; --card:#ffffff;
      --muted:#f1f3f9; --border:#d7deee; --rule:#b9c4e4;
      --good:#1f8a4c; --warn:#c07d12; --bad:#c62f2f; --desk:#eceff6;
      --sans:"Inter Tight",ui-sans-serif,system-ui,sans-serif;
      --mono:"IBM Plex Mono",ui-monospace,monospace;
    }
    *{ box-sizing:border-box; }
    body{ background:var(--desk); color:var(--fg); font-family:var(--sans); margin:0; -webkit-font-smoothing:antialiased; }
    .num{ font-family:var(--mono); font-variant-numeric:tabular-nums; }

    /* toolbar (screen only) */
    .toolbar{ max-width:250mm; margin:0 auto 14px; padding:16px 12px 0; display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted-fg); }
    .fld select, .fld input{ border:1px solid var(--border); border-radius:2px; padding:8px 10px; font-size:13px; background:#fff; min-width:150px; color:var(--fg); font-family:inherit; }
    .fld select:focus, .fld input:focus{ outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(0,51,153,.12); }
    .btn{ background:var(--primary); color:#fff; border:0; border-radius:2px; padding:9px 16px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.12em; cursor:pointer; font-family:var(--sans); }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); border:1px solid var(--border); }
    .btn:disabled{ opacity:.5; cursor:not-allowed; }
    .note{ max-width:250mm; margin:0 auto 14px; background:var(--primary-tint); border:1px solid var(--rule); border-left:3px solid var(--primary); color:var(--primary-deep); font-size:12px; padding:9px 13px; border-radius:2px; }

    /* the printable sheet */
    .sheet{ max-width:250mm; margin:0 auto 24px; background:#fff; border:1px solid var(--border); box-shadow:0 4px 18px rgba(20,30,60,.08); }
    .masthead{ background:var(--primary); color:#fff; padding:20px 26px; }
    .masthead .brand{ font-family:var(--mono); font-size:11px; letter-spacing:.2em; text-transform:uppercase; opacity:.85; }
    .masthead h1{ margin:4px 0 2px; font-size:26px; font-weight:700; letter-spacing:-.01em; }
    .masthead .sub{ font-size:13px; opacity:.9; }
    .metastrip{ display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid var(--border); }
    .metastrip .m{ padding:11px 16px; border-right:1px solid var(--border); }
    .metastrip .m:last-child{ border-right:0; }
    .metastrip .k{ font-family:var(--mono); font-size:9.5px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted-fg); }
    .metastrip .v{ font-size:14px; font-weight:600; margin-top:2px; }

    .body{ padding:14px 22px 26px; }
    .sec{ margin-top:22px; break-inside:avoid; }
    .sec:first-child{ margin-top:6px; }
    .sec h2{ font-size:15px; font-weight:700; color:var(--primary-deep); margin:0 0 3px;
             padding-bottom:5px; border-bottom:2px solid var(--primary); display:flex; align-items:baseline; gap:8px; }
    .sec h2 .code{ font-family:var(--mono); font-size:12px; color:var(--primary); }
    .sec .desc{ font-size:11.5px; color:var(--muted-fg); margin:0 0 8px; }

    table{ border-collapse:collapse; width:100%; }
    thead th{ background:var(--primary-tint); color:var(--primary-deep); font-size:10.5px; font-weight:700;
              text-transform:uppercase; letter-spacing:.04em; text-align:left; padding:6px 8px; border:1px solid var(--border); white-space:nowrap; }
    tbody td{ padding:5px 8px; font-size:11.5px; border:1px solid var(--border); vertical-align:top; }
    tbody tr:nth-child(even) td{ background:#fafbfe; }
    td.grade{ text-align:center; white-space:nowrap; }
    .gbadge{ display:inline-block; min-width:20px; padding:1px 7px; border-radius:3px; font-weight:700; font-size:11px; font-family:var(--mono); }
    .g-A,.g-B{ background:#eaf6ef; color:var(--good); border:1px solid #bfe3cd; }
    .g-C,.g-D{ background:#fbf2e3; color:var(--warn); border:1px solid #ecd7ab; }
    .g-E{ background:#fbe9e9; color:var(--bad); border:1px solid #eec2c2; }
    .empty{ padding:10px 8px; font-size:11.5px; color:var(--muted-fg); font-style:italic; }
    .colcf{ min-width:150px; } .coldist{ min-width:70px; }

    /* grading scale + sign-off */
    .scale{ display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
    .scale .s{ font-size:10.5px; border:1px solid var(--border); border-radius:2px; padding:4px 8px; }
    .signoff{ display:grid; grid-template-columns:1fr 1fr; gap:26px; margin-top:26px; }
    .signoff .sg{ font-size:12px; }
    .signoff .sg{ position:relative; }
    .signoff .line{ border-bottom:1px solid var(--fg); height:56px; margin-bottom:0; }
    .signoff .sigimg{ display:block; height:56px; width:auto; max-width:230px; object-fit:contain;
                      object-position:left bottom; mix-blend-mode:multiply; }
    .signoff .role{ font-weight:700; border-top:1px solid var(--fg); padding-top:5px; margin-top:0; }
    .signoff .hint{ font-family:var(--mono); font-size:9.5px; color:var(--muted-fg); text-transform:uppercase; letter-spacing:.1em; margin-top:2px; }
    .disclaimer{ margin-top:18px; padding:9px 12px; font-size:10.5px; line-height:1.5;
                 color:var(--muted-fg); background:var(--primary-tint); border-left:3px solid var(--primary);
                 border-radius:3px; }
    .footer{ margin-top:20px; padding-top:10px; border-top:1px solid var(--border); font-size:10.5px; color:var(--muted-fg); display:flex; justify-content:space-between; }

    @media print{
      @page{ size:A4 landscape; margin:12mm; }
      body{ background:#fff; }
      .toolbar,.note,.shg-nav,.shg-nav-toggle{ display:none !important; }
      .sheet{ box-shadow:none; border:0; margin:0; max-width:none; }
      .sec{ break-inside:avoid; }
    }
  </style>
</head>
<body>
${navSidebar('cfpayment')}

  <!-- Controls (screen only) -->
  <div class="toolbar">
    <div class="fld">
      <label>Cluster</label>
      <select id="cluster">${clusterOptions('iganga')}</select>
    </div>
    <div class="fld">
      <label>District (optional)</label>
      <select id="district"><option value="">All in cluster</option></select>
    </div>
    <div class="fld">
      <label>From (activity date)</label>
      <input id="fromDate" type="date" />
    </div>
    <div class="fld">
      <label>To</label>
      <input id="toDate" type="date" />
    </div>
    <div class="fld">
      <label>Quick range</label>
      <select id="preset">
        <option value="">— choose —</option>
        <option value="thismonth">This month</option>
        <option value="lastmonth">Last month</option>
        <option value="clear">All time</option>
      </select>
    </div>
    <button id="runBtn" class="btn"><i class="fas fa-rotate mr-1"></i> Generate</button>
    <button id="printBtn" class="btn ghost"><i class="fas fa-print"></i> Print</button>
  </div>

  <div class="note">
    <i class="fas fa-circle-info mr-1"></i>
    One consolidated month-end payment report for <b>all Community Facilitators</b>, filtered by date &amp; district.
    Each indicator section lists every CF with a concise activity summary and the <b>GRADE</b> from the CF Performance Card.
    Print (landscape A4) to submit.
  </div>

  <!-- The printable report sheet -->
  <div class="sheet" id="sheet">
    <div class="masthead">
      <div class="brand">SAYE Uganda · Heifer International · MEL</div>
      <h1>CF Payment Report</h1>
      <div class="sub">Monthly Community Facilitator payment-processing summary by indicator</div>
    </div>
    <div class="metastrip">
      <div class="m"><div class="k">Cluster</div><div class="v" id="mCluster">—</div></div>
      <div class="m"><div class="k">District</div><div class="v" id="mDistrict">—</div></div>
      <div class="m"><div class="k">Reporting period</div><div class="v" id="mPeriod">—</div></div>
      <div class="m"><div class="k">Facilitators</div><div class="v num" id="mCount">—</div></div>
    </div>
    <div class="body" id="reportBody">
      <div class="empty">Choose a cluster / district and date range, then click <b>Generate</b>.</div>
    </div>
  </div>

  <script>
    var BASE = ${JSON.stringify(base)};
    var CLUSTER_LABELS = { iganga:'Iganga Cluster', kamuli:'Kamuli Cluster', bugiri:'Bugiri Cluster', central:'Central Cluster', all:'All clusters' };
    // cluster -> districts (mirror of src/clusters.ts, Title-cased for the dropdown)
    var CLUSTER_DISTRICTS = {
      iganga:['Iganga','Jinja','Jinja City','Mayuge','Luuka'],
      kamuli:['Kamuli','Kaliro','Buyende'],
      bugiri:['Bugiri','Namutumba','Namayingo','Bugweri'],
      central:['Mukono','Buikwe','Kayunga'],
      all:[]
    };

    function fmt(n){ n=Number(n)||0; return n.toLocaleString('en-US'); }
    function ugx(n){ n=Number(n)||0; return 'UGX '+n.toLocaleString('en-US'); }
    function gradeLetter(p){ p=Number(p)||0; if(p>=80)return'A'; if(p>=60)return'B'; if(p>=40)return'C'; if(p>=20)return'D'; return'E'; }

    // ---- The 9 indicator sections. Each has a code, title, description, the
    //      activity-summary builder, the "Groups/SHGs" summariser, and a filter
    //      to decide whether a CF appears in that section (only rows with work).
    var SECTIONS = [
      { code:'A1', title:'Profiling',
        desc:'Youth profiling into SHGs.',
        has:function(r){ return r.shgs_profiled>0 || r.youth_profiled>0; },
        summary:function(r){ return 'Profiled '+fmt(r.youth_profiled)+' youth ('+fmt(r.prof_female)+' F / '+fmt(r.prof_male)+' M) across '+fmt(r.shgs_profiled)+' SHGs.'; },
        groups:function(r){ return fmt(r.shgs_profiled)+' SHG(s)'; } },

      { code:'A2', title:'Horticulture Sales',
        desc:'Sales of horticulture / oilseeds.',
        has:function(r){ return r.hs_value>0 || r.hs_sellers>0; },
        summary:function(r){ return 'Supported '+fmt(r.hs_sellers)+' sellers; gross '+ugx(r.hs_value)+', net '+ugx(r.hs_net)+'.'; },
        groups:function(r){ return fmt(r.hs_sellers)+' seller(s)'; } },

      { code:'A3', title:'ISLA (Savings & Lending)',
        desc:'Savings and lending activity.',
        has:function(r){ return r.shgs_saving>0 || r.isla_savers>0; },
        summary:function(r){ return 'Facilitated ISLA in '+fmt(r.shgs_saving)+' SHGs; '+fmt(r.isla_savers)+' savers, savings '+ugx(r.isla_savings)+', '+fmt(r.isla_loans)+' loans worth '+ugx(r.isla_loans_value)+'.'; },
        groups:function(r){ return fmt(r.shgs_saving)+' SHG(s)'; } },

      { code:'A4', title:'Poultry Sales',
        desc:'Sales of poultry.',
        has:function(r){ return r.birds_sold>0 || r.ps_sellers>0; },
        summary:function(r){ return 'Supported '+fmt(r.ps_sellers)+' sellers; sold '+fmt(r.birds_sold)+' birds, gross '+ugx(r.ps_value)+'.'; },
        groups:function(r){ return fmt(r.ps_sellers)+' seller(s)'; } },

      { code:'A5', title:'Local Leverage',
        desc:'Leverage / co-contributions mobilised.',
        has:function(r){ return r.lev_count>0 || r.lev_amount>0; },
        summary:function(r){ return 'Mobilised leverage valued at '+ugx(r.lev_amount)+' across '+fmt(r.lev_count)+' record(s).'; },
        groups:function(r){ return fmt(r.lev_count)+' record(s)'; } },

      { code:'A6', title:'Production Data',
        desc:'Youth supported into horticulture production.',
        has:function(r){ return r.prod_youth_hort>0 || r.prod_shgs>0; },
        summary:function(r){ return 'Supported '+fmt(r.prod_youth_hort)+' participants in '+fmt(r.prod_shgs)+' groups (production).'; },
        groups:function(r){ return fmt(r.prod_shgs)+' group(s)'; } },

      { code:'A7', title:'Distribution of Birds',
        desc:'Birds distributed to participants (Livestock · unit = Number).',
        has:function(r){ return (r.dist_birds||0)>0 || r.dist_participants>0; },
        summary:function(r){ return 'Distributed '+fmt(r.dist_birds||0)+' birds to '+fmt(r.dist_participants)+' participants across '+fmt(r.dist_shgs)+' SHGs.'; },
        groups:function(r){ return fmt(r.dist_shgs)+' SHG(s)'; } },

      { code:'A8', title:'Distribution to SHG',
        desc:'Inputs distributed to groups.',
        has:function(r){ return r.distshg_shgs>0 || r.distshg_lines>0; },
        summary:function(r){ return 'Distributed inputs to '+fmt(r.distshg_shgs)+' SHGs ('+fmt(r.distshg_lines)+' line item(s)).'; },
        groups:function(r){ return fmt(r.distshg_shgs)+' SHG(s)'; } },

      { code:'A9', title:'Trainings',
        desc:'Training delivery.',
        has:function(r){ return r.groups_trained>0 || r.youth_trained>0; },
        summary:function(r){ return 'Trained '+fmt(r.youth_trained)+' youth across '+fmt(r.groups_trained)+' groups.'; },
        groups:function(r){ return fmt(r.groups_trained)+' group(s)'; } }
    ];

    var lastRows = [];

    function fillDistricts(){
      var cl = document.getElementById('cluster').value;
      var ds = CLUSTER_DISTRICTS[cl] || [];
      var sel = document.getElementById('district');
      var html = '<option value="">All in cluster</option>';
      ds.forEach(function(d){ html += '<option value="'+d+'">'+d+'</option>'; });
      sel.innerHTML = html;
    }

    function periodLabel(f,t){
      if(!f && !t) return 'All time';
      var a = f || '…', b = t || '…';
      return a+'  →  '+b;
    }

    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function renderSection(sec, rows){
      var body = rows.filter(sec.has);
      var h = '<section class="sec">'
        + '<h2><span class="code">'+sec.code+'.</span> '+sec.title+'</h2>'
        + '<p class="desc">'+sec.desc+'</p>';
      if(!body.length){
        h += '<div class="empty">No activity recorded for this indicator in the selected period.</div></section>';
        return h;
      }
      h += '<table><thead><tr>'
        + '<th class="coldist">District</th><th class="colcf">Field Staff</th>'
        + '<th>Activity Summary</th><th>Groups / SHGs</th><th style="text-align:center">Grade</th>'
        + '</tr></thead><tbody>';
      body.forEach(function(r){
        var g = gradeLetter(r.overall);
        h += '<tr>'
          + '<td>'+esc(r.district)+'</td>'
          + '<td>'+esc(r.name)+'</td>'
          + '<td>'+sec.summary(r)+'</td>'
          + '<td>'+sec.groups(r)+'</td>'
          + '<td class="grade"><span class="gbadge g-'+g+'">'+g+'</span></td>'
          + '</tr>';
      });
      h += '</tbody></table></section>';
      return h;
    }

    function renderReport(rows, meta){
      document.getElementById('mCluster').textContent  = meta.cluster;
      document.getElementById('mDistrict').textContent = meta.district;
      document.getElementById('mPeriod').textContent   = meta.period;
      document.getElementById('mCount').textContent    = fmt(rows.length);
      var body = document.getElementById('reportBody');
      if(!rows.length){
        body.innerHTML = '<div class="empty">No Community Facilitators with activity found for this selection.</div>';
        return;
      }
      var h = '';
      SECTIONS.forEach(function(sec){ h += renderSection(sec, rows); });
      // grading scale + sign-off
      h += '<section class="sec">'
        + '<h2><span class="code">■</span> Grading Scale &amp; Approval</h2>'
        + '<div class="scale">'
        +   '<span class="s"><b>A</b> Excellent · 80–100%</span>'
        +   '<span class="s"><b>B</b> Very Good · 60–79%</span>'
        +   '<span class="s"><b>C</b> Good · 40–59%</span>'
        +   '<span class="s"><b>D</b> Fair · 20–39%</span>'
        +   '<span class="s"><b>E</b> Needs Improvement · 0–19%</span>'
        + '</div>'
        + '<div class="signoff">'
        +   '<div class="sg">'
        +     (meta.clusterKey==='iganga'
              ? '<img class="sigimg" src="'+BASE+'/static/sig_iganga_mel.png" alt="Cluster M&amp;E Officer signature" />'
              : '<div class="line"></div>')
        +     '<div class="role">Submitted by — Cluster M&amp;E Officer</div><div class="hint">Name · Signature · Date</div></div>'
        +   '<div class="sg"><div class="line"></div><div class="role">Approved by — District Business Facilitator</div><div class="hint">Name · Signature · Date</div></div>'
        + '</div>'
        + '<p class="disclaimer"><b>Disclaimer:</b> This is a system-generated report. Please validate the information against the corresponding CF reports, as some recent updates or corrections may not yet be reflected.</p>'
        + '<div class="footer"><span>SAYE Uganda · Heifer International — CF Payment Report</span><span>Generated '+new Date().toLocaleDateString('en-GB')+'</span></div>'
        + '</section>';
      body.innerHTML = h;
    }

    async function generate(){
      var btn = document.getElementById('runBtn'); var old = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Generating…';
      var cl = document.getElementById('cluster').value;
      var dist = document.getElementById('district').value;
      var from = document.getElementById('fromDate').value;
      var to   = document.getElementById('toDate').value;
      var params = new URLSearchParams();
      if(cl && cl!=='all') params.set('cluster', cl);
      if(dist) params.set('districts', dist);   // explicit single district overrides cluster
      if(from) params.set('from', from);
      if(to)   params.set('to', to);
      var meta = {
        clusterKey: cl,
        cluster: CLUSTER_LABELS[cl] || 'All clusters',
        district: dist || 'All in cluster',
        period: periodLabel(from,to)
      };
      document.getElementById('reportBody').innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i> Loading CF data…</div>';
      try{
        var res = await fetch(BASE+'/api/cf-payment-report?'+params.toString());
        if(!res.ok) throw new Error('HTTP '+res.status);
        var d = await res.json();
        lastRows = Array.isArray(d) ? d : (d.rows || []);
        renderReport(lastRows, meta);
      }catch(err){
        document.getElementById('reportBody').innerHTML = '<div class="empty" style="color:var(--bad)">Failed to load: '+esc(err.message)+'</div>';
      }finally{ btn.disabled=false; btn.innerHTML=old; }
    }

    function applyPreset(kind){
      var from=document.getElementById('fromDate'), to=document.getElementById('toDate');
      if(kind==='clear'){ from.value=''; to.value=''; return; }
      var now=new Date(); var y=now.getFullYear(), m=now.getMonth();
      if(kind==='lastmonth'){ m=m-1; if(m<0){ m=11; y=y-1; } }
      var last=new Date(y,m+1,0).getDate();
      from.value=y+'-'+String(m+1).padStart(2,'0')+'-01';
      to.value=y+'-'+String(m+1).padStart(2,'0')+'-'+String(last).padStart(2,'0');
    }

    // wire up
    document.getElementById('cluster').addEventListener('change', fillDistricts);
    document.getElementById('preset').addEventListener('change', function(e){
      if(e.target.value){ applyPreset(e.target.value); }
    });
    document.getElementById('runBtn').addEventListener('click', generate);
    document.getElementById('printBtn').addEventListener('click', function(){ window.print(); });
    fillDistricts();
  </script>
</body>
</html>`;
}
