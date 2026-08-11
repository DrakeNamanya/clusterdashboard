import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// CF PRODUCTION PREMIER LEAGUE  —  focused single-metric leaderboard.
//   A padlocked (admin-only) variant of the CF Premier League that ranks every
//   CF in a cluster SOLELY by "Youth production" (youth_production). All the
//   other Premier-League columns (Overall, Grade, SHGs, Trainings, Youth in
//   work, Sales, Leverage) are hidden — only Pos, CF name and Youth prod. show.
//   The #1 CF (most youth put into production) is highlighted as the CF who
//   receives the monthly gift. Shares the SAME data feed as the Premier League
//   (/api/cf-premier-league → mel_cf_premier_league RPC); we simply re-sort by
//   youth_production here and render the slim table. Live-updating, A4 print.
// ---------------------------------------------------------------------------

export function renderCfProductionLeague(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF Production Premier League — SAYE Uganda MEL</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* ===== "Everton" design system — Royal Green #0f7a3d on white paper =====
       Cloned from the CF Premier League sheet but recoloured green (production /
       growth) and reduced to a single ranked metric: Youth production.        */
    :root{
      --primary:#0f7a3d; --primary-deep:#0a5a2c; --primary-tint:#eaf6ef;
      --pf:#ffffff;
      --fg:#1b2437; --muted-fg:#5a6480; --card:#ffffff;
      --muted:#f1f3f9; --border:#d7e6db; --rule:#b9dcc6;
      --good:#1f8a4c; --warn:#c07d12; --bad:#c62f2f; --gold:#b8860b;
      --desk:#eceff6;
      --sans:"Inter Tight",ui-sans-serif,system-ui,sans-serif;
      --mono:"IBM Plex Mono",ui-monospace,monospace;
    }
    *{ box-sizing:border-box; }
    body{ background:var(--desk); color:var(--fg); font-family:var(--sans); margin:0; -webkit-font-smoothing:antialiased; }
    .num{ font-family:var(--mono); font-variant-numeric:tabular-nums; letter-spacing:-.02em; }

    /* toolbar (screen only) */
    .toolbar{ max-width:210mm; margin:0 auto 14px; padding:16px 0 0; display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted-fg); }
    .fld select, .fld input{ border:1px solid var(--border); border-radius:2px; padding:8px 10px; font-size:13px; background:#fff; min-width:150px; color:var(--fg); font-family:inherit; }
    .fld select:focus, .fld input:focus{ outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(15,122,61,.14); }
    .btn{ background:var(--primary); color:#fff; border:0; border-radius:2px; padding:9px 16px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.12em; cursor:pointer; font-family:var(--sans); }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); border:1px solid var(--border); }
    .toolnote{ margin-left:auto; font-size:11px; color:var(--muted-fg); align-self:center; }

    /* A4 sheet */
    .sheet{ width:210mm; min-height:297mm; background:var(--pf); margin:0 auto 28px; box-shadow:0 1px 2px rgba(0,0,0,.08), 0 24px 48px -24px rgba(0,0,0,.25); display:flex; flex-direction:column; }
    .pad{ padding:0 14mm; }

    /* masthead (green band) */
    .mast{ background:var(--primary); color:#fff; padding:28px 14mm 24px; }
    .brand{ display:flex; align-items:center; gap:12px; }
    .brand .mark{ width:44px; height:44px; display:grid; place-items:center; background:#fff; }
    .brand .mark span{ font-family:var(--mono); font-size:13px; font-weight:700; letter-spacing:-.02em; color:var(--primary); }
    .brand .bn{ font-size:13px; font-weight:600; letter-spacing:.22em; }
    .brand .bt{ font-size:9px; letter-spacing:.3em; opacity:.72; margin-top:2px; }
    .mastrow{ margin-top:30px; display:flex; align-items:flex-end; justify-content:space-between; gap:24px; }
    .mastrow .eyebrow{ font-size:10px; letter-spacing:.34em; opacity:.72; }
    .mastrow h1{ margin:8px 0 0; font-size:40px; font-weight:600; line-height:1.03; letter-spacing:-.03em; }
    .champbox{ border-left:1px solid rgba(255,255,255,.3); padding-left:20px; text-align:right; margin-bottom:4px; }
    .champbox .cl{ font-size:9px; letter-spacing:.2em; opacity:.75; display:flex; align-items:center; gap:6px; justify-content:flex-end; }
    .champbox .cn{ margin-top:4px; font-size:19px; font-weight:600; line-height:1.1; }
    .champbox .cs{ font-family:var(--mono); margin-top:4px; font-size:10px; letter-spacing:.16em; opacity:.9; }

    /* meta strip */
    .metastrip{ display:grid; grid-template-columns:repeat(5,1fr); border-bottom:1px solid var(--border); background:var(--primary-tint); }
    .metastrip .cell{ border-right:1px solid rgba(15,122,61,.12); padding:11px 12px; }
    .metastrip .cell:last-child{ border-right:0; }
    .metastrip .k{ font-family:var(--mono); font-size:8px; text-transform:uppercase; letter-spacing:.18em; color:var(--muted-fg); }
    .metastrip .v{ margin-top:4px; font-size:10.5px; font-weight:600; line-height:1.3; color:var(--primary-deep); }

    /* gift banner — the monthly prize note */
    .giftbar{ display:flex; align-items:center; gap:12px; background:#fff7e6; border:1px solid #f0d999; border-left:4px solid var(--gold); margin:16px 14mm 0; padding:12px 16px; border-radius:3px; }
    .giftbar .gift-ico{ width:34px; height:34px; border-radius:8px; background:var(--gold); color:#fff; display:grid; place-items:center; font-size:16px; flex:none; }
    .giftbar .gift-t{ font-size:12px; font-weight:700; color:#8a6400; letter-spacing:.02em; }
    .giftbar .gift-s{ font-size:10.5px; color:#96703a; margin-top:2px; }

    /* section head */
    .body{ padding:20px 14mm; flex:1; }
    .secthead{ display:flex; align-items:baseline; gap:12px; border-bottom:2px solid var(--primary); padding-bottom:5px; margin-bottom:12px; }
    .secthead .no{ font-family:var(--mono); font-size:10px; font-weight:700; color:var(--primary); }
    .secthead h2{ margin:0; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.16em; color:var(--primary); }
    .secthead .rng{ margin-left:auto; font-size:9px; color:var(--muted-fg); }

    /* standings table — only 3 columns: Pos, CF, Youth production */
    table.lg{ width:100%; border-collapse:collapse; table-layout:fixed; }
    table.lg thead th{ background:var(--primary-deep); color:rgba(255,255,255,.9); font-size:8px; text-transform:uppercase; letter-spacing:.08em; font-weight:600; text-align:left; padding:8px 8px; line-height:1.15; }
    table.lg thead th.c{ text-align:center; }
    table.lg thead th.r{ text-align:right; }
    table.lg tbody td{ padding:9px 8px; border-bottom:1px solid var(--border); font-size:11px; vertical-align:middle; }
    table.lg tbody tr:nth-child(odd){ background:rgba(234,246,239,.5); }
    table.lg tbody tr.row-champ{ background:rgba(184,134,11,.12); }
    table.lg tbody tr.row-champ:hover{ background:rgba(184,134,11,.18); }
    table.lg tbody tr.row-top{ background:rgba(15,122,61,.08); }
    /* position cell + medal accents */
    .poscell{ position:relative; text-align:center; }
    .zonebar{ position:absolute; inset:0 auto 0 0; width:3px; }
    .z-champ{ background:var(--gold); } .z-top{ background:var(--primary); }
    .posn{ font-family:var(--mono); font-size:13px; font-weight:700; color:var(--primary-deep); }
    .posn.gold{ color:var(--gold); } .posn.silver{ color:#7d8794; } .posn.bronze{ color:#a5682a; }
    .cf{ display:flex; align-items:center; gap:10px; min-width:0; }
    .avatar{ width:22px; height:22px; display:grid; place-items:center; background:var(--primary); color:#fff; font-family:var(--mono); font-size:9px; font-weight:700; flex:none; }
    .cfname{ font-size:12px; font-weight:600; letter-spacing:-.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .giftpill{ display:inline-flex; align-items:center; gap:5px; margin-left:8px; background:var(--gold); color:#fff; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; padding:2px 7px; border-radius:10px; flex:none; }
    /* youth production figure — big, right-aligned, with a proportional bar */
    td.prod{ text-align:right; }
    .prodwrap{ display:flex; align-items:center; gap:10px; justify-content:flex-end; }
    .prodbar{ height:8px; flex:1; max-width:150px; background:var(--muted); min-width:30px; }
    .prodbar-f{ height:100%; background:var(--primary); }
    .prodval{ font-family:var(--mono); font-size:13px; font-weight:700; color:var(--primary-deep); width:60px; text-align:right; flex:none; }
    .prodval.zero{ color:var(--muted-fg); font-weight:500; }

    /* footer note */
    .footnote{ margin-top:24px; border-left:2px solid var(--primary); background:var(--primary-tint); padding:14px 20px; }
    .footnote .vk{ font-size:8px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted-fg); }
    .footnote p{ margin:8px 0 0; font-size:10px; line-height:1.5; color:var(--primary-deep); }

    /* footer */
    .foot{ margin-top:auto; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding:10px 14mm; font-size:8px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted-fg); }

    /* continuation header for pages 2+ */
    .conthead{ display:flex; align-items:center; justify-content:space-between; border-bottom:4px solid var(--primary); padding:16px 14mm; }
    .conthead .ce{ font-size:9px; letter-spacing:.3em; color:var(--muted-fg); }
    .conthead .ct{ font-size:15px; font-weight:600; color:var(--primary); letter-spacing:-.01em; }
    .conthead .cm{ text-align:right; font-size:9px; text-transform:uppercase; letter-spacing:.18em; color:var(--muted-fg); line-height:1.5; }

    .loading{ text-align:center; color:var(--muted-fg); padding:60px 0; font-size:13px; }

    @media print{
      @page{ size:A4; margin:8mm; }
      html,body{ background:#fff; }
      .toolbar, .shg-nav, .shg-nav-open, .no-print{ display:none !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .sheet{ box-shadow:none !important; margin:0 !important; width:100% !important; min-height:0 !important; page-break-after:always; break-after:page; }
      .sheet:last-of-type{ page-break-after:auto; break-after:auto; }
      .mast{ padding-left:10mm; padding-right:10mm; }
      .metastrip, .body, .foot, .conthead{ padding-left:10mm; padding-right:10mm; }
      .giftbar{ margin-left:10mm; margin-right:10mm; }
      *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <div class="fld"><label>Cluster</label><select id="cluster">${clusterOptions('iganga')}</select></div>
    <div class="fld"><label>From</label><input type="date" id="from" /></div>
    <div class="fld"><label>To</label><input type="date" id="to" /></div>
    <button class="btn" id="apply"><i class="fas fa-rotate"></i> Update</button>
    <button class="btn ghost" id="clearDates">Clear dates</button>
    <button class="btn" id="print"><i class="fas fa-print"></i> Print production league</button>
    <button class="btn ghost" id="refreshCf" title="Rebuild the CF list from the latest MIS data. Runs automatically every 15 minutes."><i class="fas fa-users-rays"></i> Refresh CF list</button>
    <span class="toolnote">Ranked by Youth production · #1 wins the monthly gift · CF list auto-refreshes every 15 min</span>
  </div>

  <div id="sheets">
    <div class="sheet"><div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading production league…</div></div>
  </div>

  ${navSidebar('cfprodleague')}

  <script>
    var PAGE_SIZE = 20;
    var CLUSTER_LABELS = { all:'All clusters', iganga:'Iganga Cluster', kamuli:'Kamuli Cluster', bugiri:'Bugiri Cluster', central:'Central Cluster' };

    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function fmt(n){ n=Number(n)||0; return n.toLocaleString('en-US'); }
    function prettyDate(s){ if(!s) return ''; try{ return new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return s; } }
    function initials(name){ return String(name||'').trim().split(/\\\\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase(); }

    // Build one standings row. maxProd = the top youth_production (for the bar
    // scale). rank 1 = the gift winner.
    function leagueRow(r, maxProd){
      var rank=r.rank;
      var prod=Number(r.youth_production)||0;
      var isChamp=(rank===1 && prod>0);
      var rowCls = isChamp ? 'row-champ' : (rank<=3 ? 'row-top' : '');
      var medal = rank===1 ? 'gold' : (rank===2 ? 'silver' : (rank===3 ? 'bronze' : ''));
      var zone = isChamp ? 'z-champ' : (rank<=3 ? 'z-top' : '');
      var avColor = rank===1 ? '#b8860b' : (rank<=3 ? '#0f7a3d' : '#5a6480');
      var barPct = maxProd>0 ? Math.round(prod/maxProd*100) : 0;
      var gift = isChamp ? '<span class="giftpill"><i class="fas fa-gift"></i> Monthly gift</span>' : '';
      return '<tr class="'+rowCls+'">'+
        '<td class="poscell">'+(zone?'<span class="zonebar '+zone+'"></span>':'')+'<span class="posn '+medal+'">'+rank+'</span></td>'+
        '<td><div class="cf"><span class="avatar" style="background:'+avColor+'">'+esc(initials(r.name))+'</span><span class="cfname">'+esc(r.name)+'</span>'+gift+'</div></td>'+
        '<td class="prod"><div class="prodwrap">'+
          '<div class="prodbar"><div class="prodbar-f" style="width:'+barPct+'%;background:'+(isChamp?'#b8860b':'#0f7a3d')+'"></div></div>'+
          '<span class="prodval'+(prod===0?' zero':'')+'">'+fmt(prod)+'</span>'+
        '</div></td>'+
      '</tr>';
    }

    function tableHead(){
      return '<colgroup>'+
          '<col style="width:8%"/>'+     // Pos
          '<col style="width:56%"/>'+    // Community Facilitator
          '<col style="width:36%"/>'+    // Youth production
        '</colgroup>'+
        '<thead><tr>'+
        '<th class="c">Pos</th>'+
        '<th>Community Facilitator</th>'+
        '<th class="r">Youth production (youth put into production)</th>'+
      '</tr></thead>';
    }

    function build(rows, clusterLabel, from, to){
      // Rank SOLELY by youth production (desc). Ties broken by name for stability.
      rows = rows.slice().sort(function(a,b){
        var d=(Number(b.youth_production)||0)-(Number(a.youth_production)||0);
        if(d!==0) return d;
        return String(a.name||'').localeCompare(String(b.name||''));
      });
      rows.forEach(function(r,i){ r.rank=i+1; });

      var n=rows.length;
      var period=(from&&to)?(prettyDate(from)+' – '+prettyDate(to)):'All available data';
      var genDate=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      var totalProd=rows.reduce(function(a,r){return a+(Number(r.youth_production)||0);},0);
      var maxProd=n?Math.max.apply(null, rows.map(function(r){return Number(r.youth_production)||0;})):0;
      var champ=(n && (Number(rows[0].youth_production)||0)>0) ? rows[0] : null;

      var pages=[]; for(var i=0;i<Math.max(1,Math.ceil(n/PAGE_SIZE));i++){ pages.push(rows.slice(i*PAGE_SIZE,(i+1)*PAGE_SIZE)); }

      var html='';
      pages.forEach(function(page, p){
        var isFirst=(p===0), isLast=(p===pages.length-1);
        html+='<section class="sheet">';

        if(isFirst){
          html+='<div class="mast">'+
            '<div class="brand"><div class="mark"><span>SAYE</span></div>'+
              '<div><div class="bn">SAYE UGANDA</div><div class="bt">MONITORING · EVALUATION · LEARNING</div></div></div>'+
            '<div class="mastrow"><div><div class="eyebrow">COMMUNITY FACILITATORS · YOUTH PRODUCTION</div>'+
              '<h1>CF Production<br/>Premier League</h1></div>'+
              (champ?('<div class="champbox"><div class="cl"><i class="fas fa-gift"></i> MONTHLY GIFT WINNER</div><div class="cn">'+esc(champ.name)+'</div>'+
                '<div class="cs">'+fmt(champ.youth_production)+' YOUTH IN PRODUCTION</div></div>'):'')+
            '</div></div>'+
            '<div class="metastrip">'+
              '<div class="cell"><div class="k">Cluster</div><div class="v">'+esc(clusterLabel)+'</div></div>'+
              '<div class="cell"><div class="k">Report period</div><div class="v">'+esc(period)+'</div></div>'+
              '<div class="cell"><div class="k">CFs ranked</div><div class="v num">'+n+'</div></div>'+
              '<div class="cell"><div class="k">Total youth in production</div><div class="v num">'+fmt(totalProd)+'</div></div>'+
              '<div class="cell"><div class="k">Generated</div><div class="v">'+esc(genDate)+'</div></div>'+
            '</div>';
          // gift note banner
          html+='<div class="giftbar"><div class="gift-ico"><i class="fas fa-gift"></i></div>'+
            '<div><div class="gift-t">'+(champ?('This month\\'s gift goes to '+esc(champ.name)):'Monthly gift — awarded to the #1 CF')+'</div>'+
            '<div class="gift-s">The Community Facilitator who puts the most youth into production each month receives a gift.</div></div></div>';
        } else {
          html+='<div class="conthead"><div><div class="ce">SAYE UGANDA · MEL</div>'+
            '<div class="ct">CF Production Premier League · continued</div></div>'+
            '<div class="cm">'+esc(clusterLabel)+'<br/>'+esc(period)+'</div></div>';
        }

        html+='<div class="body">';
        html+='<div class="secthead"><span class="no">'+String(p+1).padStart(2,'0')+'</span>'+
          '<h2>Youth Production Standings</h2>'+
          (page.length?('<span class="rng">Positions '+page[0].rank+'–'+page[page.length-1].rank+' of '+n+'</span>'):'')+
        '</div>';

        if(!page.length){
          html+='<div class="loading">No CF data for this cluster / period.</div>';
        } else {
          html+='<table class="lg">'+tableHead()+'<tbody>'+page.map(function(r){return leagueRow(r,maxProd);}).join('')+'</tbody></table>';
        }

        if(isLast && n){
          html+='<div class="footnote"><div class="vk">Verification &amp; award note</div>'+
            '<p>Ranking is by <strong>youth production</strong> only — the number of youth each Community Facilitator has put into production in the selected period. '+
            'The CF in position&nbsp;#1 at each month-end receives the monthly gift. Compiled by SAYE Uganda M&amp;E on '+esc(genDate)+'.</p></div>';
        }
        html+='</div>'; // body

        html+='<div class="foot"><span>SAYE Uganda · MEL</span><span>CF Production Premier League · '+esc(clusterLabel)+'</span>'+
          '<span class="num">Page '+(p+1)+' / '+pages.length+'</span></div>';

        html+='</section>';
      });

      return html;
    }

    async function load(){
      var cl=document.getElementById('cluster').value;
      var from=document.getElementById('from').value;
      var to=document.getElementById('to').value;
      var host=document.getElementById('sheets');
      host.innerHTML='<div class="sheet"><div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading production league…</div></div>';
      var qs=new URLSearchParams();
      if(cl && cl!=='all') qs.set('cluster', cl);
      if(from) qs.set('from', from);
      if(to) qs.set('to', to);
      try{
        var res=await fetch('/api/cf-premier-league?'+qs.toString());
        if(!res.ok) throw new Error('HTTP '+res.status);
        var rows=await res.json();
        if(!Array.isArray(rows)) rows=[];
        host.innerHTML=build(rows, CLUSTER_LABELS[cl]||'All clusters', from, to);
      }catch(e){
        host.innerHTML='<div class="sheet"><div class="loading" style="color:var(--bad)">Failed to load: '+(e&&e.message||e)+'</div></div>';
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

    document.getElementById('refreshCf').addEventListener('click', async function(){
      var b=this, old=b.innerHTML;
      b.disabled=true; b.innerHTML='<i class="fas fa-spinner fa-spin"></i> Refreshing…';
      try{
        var r=await fetch('/api/cf-universe/refresh',{method:'POST'});
        var j=await r.json();
        if(!j.ok) throw new Error(j.error||'refresh failed');
        b.innerHTML='<i class="fas fa-check"></i> '+j.cfs+' CFs';
        await load();
        setTimeout(function(){ b.innerHTML=old; b.disabled=false; }, 2500);
      }catch(e){
        b.innerHTML='<i class="fas fa-triangle-exclamation"></i> Failed';
        setTimeout(function(){ b.innerHTML=old; b.disabled=false; }, 3000);
      }
    });

    load();
  </script>
</body>
</html>`;
}
