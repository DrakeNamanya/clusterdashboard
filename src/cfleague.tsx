import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// CF PREMIER LEAGUE TABLE
//   Ranks every Community Facilitator in a cluster from #1 (best) to last by
//   their OVERALL CF-report performance grade. Live-updating: re-fetches on any
//   filter change and reflects whatever data has been submitted so far.
//   Filters: Cluster + Date range. Download: browser Print → Save as PDF
//   (monthly league table), matching the CF report / weekly report pattern.
//   Data from /api/cf-premier-league (mel_cf_premier_league RPC).
// ---------------------------------------------------------------------------

export function renderCfPremierLeague(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF Premier League — SAYE</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{
      --green:#0F4C3A; --green-2:#00A859; --lgreen:#e9f5ee; --ink:#25352c;
      --muted:#7f8c85; --line:#e2e9e4; --amber:#F6921E; --blue:#2E9BD6;
      --band:#0f5132; --gold:#d4af37; --silver:#9aa4ad; --bronze:#c48a3f;
    }
    body{ background:#eef3f0; color:var(--ink); font-family:"Segoe UI",Calibri,Arial,system-ui,sans-serif; margin:0; }
    .wrap{ max-width:1080px; margin:0 auto; padding:22px 20px 60px; }
    .filters{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:18px; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:700; }
    .fld select, .fld input{ border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; background:#fff; min-width:160px; }
    .btn{ background:var(--green); color:#fff; border:0; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:700; cursor:pointer; }
    .btn:hover{ background:var(--green-2); }
    .btn.ghost{ background:#fff; color:var(--green); border:1px solid var(--line); }

    .cardsheet{ background:#fff; border:1px solid var(--line); border-radius:16px; box-shadow:0 4px 18px rgba(30,50,40,.08); overflow:hidden; }
    .chead{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 26px; border-bottom:3px solid var(--green); }
    .chead .brandblock{ display:flex; align-items:center; gap:11px; min-width:150px; }
    .chead .logo{ width:46px; height:46px; border-radius:11px; background:linear-gradient(135deg,var(--green),var(--green-2)); color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 2px 6px rgba(0,104,55,.25); }
    .chead .brandtxt .bn{ font-size:16px; font-weight:800; color:var(--green); line-height:1.1; }
    .chead .brandtxt .bt{ font-size:9.5px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-top:2px; }
    .chead .mid{ flex:1; text-align:center; }
    .chead .mid .t{ font-size:20px; font-weight:800; color:var(--ink); letter-spacing:-.01em; }
    .chead .mid .s{ font-size:11px; color:var(--green-2); font-weight:800; text-transform:uppercase; letter-spacing:.14em; margin-bottom:1px; }
    .chead .meta{ font-size:10px; color:var(--muted); text-align:right; line-height:1.5; text-transform:uppercase; letter-spacing:.03em; font-weight:700; min-width:130px; }
    .chead .meta b{ color:var(--ink); font-size:12px; text-transform:none; letter-spacing:0; }

    .idrow{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:18px 26px; }
    @media(max-width:820px){ .idrow{ grid-template-columns:repeat(2,1fr); } }
    .idcard{ border:1px solid #cfe6d8; background:#f6fbf8; border-radius:12px; padding:12px 14px; display:flex; gap:11px; align-items:center; }
    .idcard .ic{ width:34px; height:34px; border-radius:9px; background:var(--green); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; }
    .idcard .lb{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); font-weight:700; }
    .idcard .vl{ font-size:14px; font-weight:800; color:var(--ink); }

    .tblwrap{ padding:0 26px 22px; }
    table.lg{ border-collapse:collapse; width:100%; }
    table.lg thead th{ background:var(--band); color:#fff; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; padding:10px 12px; text-align:left; position:sticky; top:0; }
    table.lg thead th.num{ text-align:right; }
    table.lg tbody td{ padding:10px 12px; font-size:13px; border-bottom:1px solid #eef2ef; vertical-align:middle; }
    table.lg tbody td.num{ text-align:right; font-variant-numeric:tabular-nums; }
    table.lg tbody tr:hover{ background:#f7fbf8; }
    .rankcell{ display:flex; align-items:center; gap:8px; font-weight:800; }
    .medal{ width:26px; height:26px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; color:#fff; font-size:12px; font-weight:800; flex:none; }
    .m1{ background:var(--gold); } .m2{ background:var(--silver); } .m3{ background:var(--bronze); }
    .rnum{ width:26px; text-align:center; color:var(--muted); }
    tr.top1 td{ background:#fffbe9; } tr.top2 td{ background:#f6f8fa; } tr.top3 td{ background:#fbf3ea; }
    .cfname{ font-weight:800; }
    .pbar{ display:inline-block; width:74px; height:8px; border-radius:6px; background:#eef2ef; vertical-align:middle; overflow:hidden; }
    .pbar-f{ height:100%; border-radius:6px; }
    .pval{ font-size:12px; font-weight:800; margin-left:8px; font-variant-numeric:tabular-nums; }
    .grade{ display:inline-block; padding:2px 9px; border-radius:20px; font-size:11px; font-weight:800; }

    .kpis{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:0 26px 18px; }
    @media(max-width:900px){ .kpis{ grid-template-columns:repeat(2,1fr); } }
    .kpi{ border:1px solid var(--line); border-radius:12px; padding:14px; text-align:center; }
    .kpi .ic{ font-size:16px; color:var(--green-2); }
    .kpi .v{ font-size:22px; font-weight:800; color:var(--ink); margin-top:6px; line-height:1; }
    .kpi .l{ font-size:10px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:700; margin-top:5px; }

    .loading{ text-align:center; color:var(--muted); padding:40px; font-size:14px; }
    .note{ background:#fff8e6; border:1px solid #f0e2b6; color:#7a6414; font-size:12px; padding:8px 12px; border-radius:8px; margin-bottom:16px; }
    .secttl{ font-size:13px; font-weight:800; color:var(--green); display:flex; align-items:center; gap:8px; margin:14px 0 10px; padding:0 26px; flex-wrap:wrap; }
    .secttl .secsub{ font-weight:600; color:var(--muted); font-size:11px; }

    @media print{
      @page{ size:A4 portrait; margin:12mm; }
      body{ background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .shg-nav, .shg-nav-open, .filters, .note, .noprint{ display:none !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .wrap{ max-width:none; padding:0; }
      .cardsheet{ box-shadow:none; border:0; }
      table.lg thead th{ position:static; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="note"><i class="fas fa-circle-info"></i> League ranks every CF in the cluster by their <b>overall CF-report performance grade</b> (average of the 7 client targets). It updates live as data is submitted. Use <b>Download PDF</b> for the monthly table.</div>

    <div class="filters">
      <div class="fld">
        <label>Cluster</label>
        <select id="cluster">${clusterOptions('iganga')}</select>
      </div>
      <div class="fld">
        <label>From</label>
        <input type="date" id="from" />
      </div>
      <div class="fld">
        <label>To</label>
        <input type="date" id="to" />
      </div>
      <button class="btn" id="apply"><i class="fas fa-rotate"></i> Update</button>
      <button class="btn ghost" id="clearDates"><i class="fas fa-eraser"></i> Clear dates</button>
      <button class="btn" id="print" style="margin-left:auto"><i class="fas fa-file-pdf"></i> Download PDF</button>
    </div>

    <div id="sheet" class="cardsheet">
      <div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading league table…</div>
    </div>
  </div>

  ${navSidebar('cfleague')}

  <script>
    // Use relative fetch paths so the browser inherits the page's scheme/host
    // (avoids mixed-content when the page is served over HTTPS).
    var CLUSTER_LABELS = { all:'All clusters', iganga:'Iganga Cluster', kamuli:'Kamuli Cluster', bugiri:'Bugiri Cluster', central:'Central Cluster' };

    function fmt(n){ n=Number(n)||0; return n.toLocaleString('en-US'); }
    function prettyDate(s){ if(!s) return ''; try{ return new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return s; } }
    function gradeFor(p){
      p=Number(p)||0;
      if(p>=80) return {g:'A',c:'#1a7a3d',bg:'#e4f4ea'};
      if(p>=60) return {g:'B',c:'#2E9BD6',bg:'#e3f2fb'};
      if(p>=40) return {g:'C',c:'#b46e0a',bg:'#fbf0dc'};
      if(p>=20) return {g:'D',c:'#c9791b',bg:'#fbeeda'};
      return {g:'E',c:'#c0392b',bg:'#fbe6e2'};
    }

    function buildTable(rows, clusterLabel, from, to){
      var period = (from&&to) ? (prettyDate(from)+' – '+prettyDate(to)) : 'All available data';
      var genDate = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      var n = rows.length;
      var avg = n ? Math.round(rows.reduce(function(a,r){return a+(Number(r.overall)||0);},0)/n) : 0;
      var topName = n ? rows[0].name : '—';
      var totalYouth = rows.reduce(function(a,r){return a+(Number(r.youth_mobilized)||0);},0);

      var body = rows.map(function(r,i){
        var rank=i+1;
        var g=gradeFor(r.overall);
        var barPct=Math.min(100,Number(r.overall)||0);
        var rankCell = rank<=3
          ? '<span class="medal m'+rank+'">'+rank+'</span>'
          : '<span class="rnum">'+rank+'</span>';
        var trCls = rank<=3 ? ' class="top'+rank+'"' : '';
        return '<tr'+trCls+'>'+
          '<td><div class="rankcell">'+rankCell+'</div></td>'+
          '<td><span class="cfname">'+r.name+'</span></td>'+
          '<td><div class="pbar"><div class="pbar-f" style="width:'+barPct+'%;background:'+g.c+'"></div></div><span class="pval" style="color:'+g.c+'">'+(Number(r.overall)||0)+'%</span></td>'+
          '<td><span class="grade" style="color:'+g.c+';background:'+g.bg+'">'+g.g+'</span></td>'+
          '<td class="num">'+fmt(r.shgs_profiled)+'</td>'+
          '<td class="num">'+fmt(r.youth_mobilized)+'</td>'+
          '<td class="num">'+(Number(r.female_pct)||0)+'%</td>'+
          '<td class="num">'+fmt(r.shgs_saving)+'</td>'+
          '<td class="num">'+fmt(r.youth_production)+'</td>'+
          '<td class="num">'+fmt(r.groups_trained)+'</td>'+
        '</tr>';
      }).join('');

      if(!n){
        body = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:30px">No CF data for this cluster / period.</td></tr>';
      }

      return '<div class="chead">'+
          '<div class="brandblock"><div class="logo"><i class="fas fa-ranking-star"></i></div>'+
            '<div class="brandtxt"><div class="bn">SAYE Uganda</div><div class="bt">MEL</div></div></div>'+
          '<div class="mid"><div class="s">Community Facilitators</div><div class="t">CF Premier League</div></div>'+
          '<div class="meta">Date Generated<br/><b>'+genDate+'</b><br/>Report Period<br/><b>'+period+'</b></div>'+
        '</div>'+
        '<div class="idrow">'+
          '<div class="idcard"><span class="ic"><i class="fas fa-map-pin"></i></span><div><div class="lb">Cluster</div><div class="vl">'+clusterLabel+'</div></div></div>'+
          '<div class="idcard"><span class="ic"><i class="fas fa-calendar"></i></span><div><div class="lb">Report Period</div><div class="vl">'+period+'</div></div></div>'+
          '<div class="idcard"><span class="ic"><i class="fas fa-users"></i></span><div><div class="lb">CFs Ranked</div><div class="vl">'+fmt(n)+'</div></div></div>'+
          '<div class="idcard"><span class="ic"><i class="fas fa-trophy"></i></span><div><div class="lb">Top CF</div><div class="vl">'+topName+'</div></div></div>'+
        '</div>'+
        '<div class="kpis">'+
          '<div class="kpi"><div class="ic"><i class="fas fa-users"></i></div><div class="v">'+fmt(n)+'</div><div class="l">CFs Ranked</div></div>'+
          '<div class="kpi"><div class="ic"><i class="fas fa-arrow-trend-up"></i></div><div class="v">'+avg+'%</div><div class="l">Average Grade</div></div>'+
          '<div class="kpi"><div class="ic"><i class="fas fa-crown"></i></div><div class="v" style="font-size:15px">'+topName+'</div><div class="l">Best Performer</div></div>'+
          '<div class="kpi"><div class="ic"><i class="fas fa-seedling"></i></div><div class="v">'+fmt(totalYouth)+'</div><div class="l">Youth Mobilized</div></div>'+
        '</div>'+
        '<div class="secttl"><i class="fas fa-list-ol"></i> League Table <span class="secsub">(ranked #1 → last by overall performance grade)</span></div>'+
        '<div class="tblwrap"><table class="lg"><thead><tr>'+
          '<th>Rank</th><th>Community Facilitator</th><th>Overall</th><th>Grade</th>'+
          '<th class="num">SHGs</th><th class="num">Youth</th><th class="num">Female %</th>'+
          '<th class="num">SHGs Saving</th><th class="num">Into Production</th><th class="num">Groups Trained</th>'+
        '</tr></thead><tbody>'+body+'</tbody></table></div>';
    }

    async function load(){
      var cl = document.getElementById('cluster').value;
      var from = document.getElementById('from').value;
      var to = document.getElementById('to').value;
      var sheet = document.getElementById('sheet');
      sheet.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading league table…</div>';
      var qs = new URLSearchParams();
      if(cl && cl!=='all') qs.set('cluster', cl);
      if(from) qs.set('from', from);
      if(to) qs.set('to', to);
      try{
        var res = await fetch('/api/cf-premier-league?' + qs.toString());
        if(!res.ok) throw new Error('HTTP '+res.status);
        var rows = await res.json();
        if(!Array.isArray(rows)) rows = [];
        sheet.innerHTML = buildTable(rows, CLUSTER_LABELS[cl]||'All clusters', from, to);
      }catch(e){
        sheet.innerHTML = '<div class="loading" style="color:#c0392b">Failed to load: '+(e&&e.message||e)+'</div>';
      }
    }

    document.getElementById('apply').addEventListener('click', load);
    document.getElementById('cluster').addEventListener('change', load);
    document.getElementById('from').addEventListener('change', load);
    document.getElementById('to').addEventListener('change', load);
    document.getElementById('clearDates').addEventListener('click', function(){
      document.getElementById('from').value=''; document.getElementById('to').value=''; load();
    });
    document.getElementById('print').addEventListener('click', function(){ window.print(); });

    load();
  </script>
</body>
</html>`;
}
