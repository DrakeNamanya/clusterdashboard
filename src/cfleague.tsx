import { clusterOptions } from './clusters';
import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// CF PREMIER LEAGUE TABLE  —  "Everton" print-first design (Royal Blue #003399)
//   Football-standings styled A4 sheet: full-bleed blue masthead, champion
//   callout, 5-column meta strip, standings table with promotion/relegation
//   zones, initials avatars, mono figures, boxed grade letters, grading scale
//   + verification note. Ranks every CF in a cluster #1 → last by an overall
//   grade = average of 7 CF-report metrics (period-filtered). Live-updating.
//   Data from /api/cf-premier-league (mel_cf_premier_league RPC).
// ---------------------------------------------------------------------------

export function renderCfPremierLeague(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CF Premier League — SAYE Uganda MEL</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* ===== "Everton" design system — Royal Blue #003399 on white paper =====
       Cloned from the Lovable reference: A4 sheet on a light desk, full-bleed
       royal-blue masthead, standings zones, mono figures, small radii.
       Prints ink-accurate on white A4.                                     */
    :root{
      --primary:#003399; --primary-deep:#001f5c; --primary-tint:#eef2fb;
      --pf:#ffffff;
      --fg:#1b2437; --muted-fg:#5a6480; --card:#ffffff;
      --muted:#f1f3f9; --border:#d7deee; --rule:#b9c4e4;
      --good:#1f8a4c; --warn:#c07d12; --bad:#c62f2f;
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
    .fld select:focus, .fld input:focus{ outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(0,51,153,.12); }
    .btn{ background:var(--primary); color:#fff; border:0; border-radius:2px; padding:9px 16px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.12em; cursor:pointer; font-family:var(--sans); }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); border:1px solid var(--border); }
    .toolnote{ margin-left:auto; font-size:11px; color:var(--muted-fg); align-self:center; }

    /* A4 sheet */
    .sheet{ width:210mm; min-height:297mm; background:var(--pf); margin:0 auto 28px; box-shadow:0 1px 2px rgba(0,0,0,.08), 0 24px 48px -24px rgba(0,0,0,.25); display:flex; flex-direction:column; }
    .pad{ padding:0 14mm; }

    /* masthead (blue band) */
    .mast{ background:var(--primary); color:#fff; padding:28px 14mm 24px; }
    .brand{ display:flex; align-items:center; gap:12px; }
    .brand .mark{ width:44px; height:44px; display:grid; place-items:center; background:#fff; }
    .brand .mark span{ font-family:var(--mono); font-size:13px; font-weight:700; letter-spacing:-.02em; color:var(--primary); }
    .brand .bn{ font-size:13px; font-weight:600; letter-spacing:.22em; }
    .brand .bt{ font-size:9px; letter-spacing:.3em; opacity:.72; margin-top:2px; }
    .mastrow{ margin-top:30px; display:flex; align-items:flex-end; justify-content:space-between; gap:24px; }
    .mastrow .eyebrow{ font-size:10px; letter-spacing:.34em; opacity:.72; }
    .mastrow h1{ margin:8px 0 0; font-size:42px; font-weight:600; line-height:1.03; letter-spacing:-.03em; }
    .champbox{ border-left:1px solid rgba(255,255,255,.3); padding-left:20px; text-align:right; margin-bottom:4px; }
    .champbox .cl{ font-size:9px; letter-spacing:.24em; opacity:.62; }
    .champbox .cn{ margin-top:4px; font-size:19px; font-weight:600; line-height:1.1; }
    .champbox .cs{ font-family:var(--mono); margin-top:4px; font-size:10px; letter-spacing:.16em; opacity:.82; }

    /* meta strip */
    .metastrip{ display:grid; grid-template-columns:repeat(5,1fr); border-bottom:1px solid var(--border); background:var(--primary-tint); }
    .metastrip .cell{ border-right:1px solid rgba(0,51,153,.12); padding:11px 12px; }
    .metastrip .cell:last-child{ border-right:0; }
    .metastrip .k{ font-family:var(--mono); font-size:8px; text-transform:uppercase; letter-spacing:.18em; color:var(--muted-fg); }
    .metastrip .v{ margin-top:4px; font-size:10.5px; font-weight:600; line-height:1.3; color:var(--primary-deep); }

    /* section head */
    .body{ padding:22px 14mm; flex:1; }
    .secthead{ display:flex; align-items:baseline; gap:12px; border-bottom:2px solid var(--primary); padding-bottom:5px; margin-bottom:12px; }
    .secthead .no{ font-family:var(--mono); font-size:10px; font-weight:700; color:var(--primary); }
    .secthead h2{ margin:0; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.16em; color:var(--primary); }
    .secthead .rng{ margin-left:auto; font-size:9px; color:var(--muted-fg); }

    /* standings table */
    table.lg{ width:100%; border-collapse:collapse; }
    table.lg thead th{ background:var(--primary-deep); color:rgba(255,255,255,.86); font-size:7.5px; text-transform:uppercase; letter-spacing:.12em; font-weight:600; text-align:left; padding:6px 8px; line-height:1.15; }
    table.lg thead th.c{ text-align:center; }
    table.lg tbody td{ padding:7px 8px; border-bottom:1px solid var(--border); font-size:9px; vertical-align:middle; }
    table.lg tbody tr:nth-child(odd){ background:rgba(238,242,251,.45); }
    /* zone row tints — colour-code the standings for quick reading:
       champions (top 3) royal-blue wash, contenders (4–6) green wash,
       support-needed (bottom 3) red wash. These override the zebra. */
    table.lg tbody tr.row-champ{ background:rgba(0,51,153,.075); }
    table.lg tbody tr.row-champ:hover{ background:rgba(0,51,153,.12); }
    table.lg tbody tr.row-cont{ background:rgba(31,138,76,.075); }
    table.lg tbody tr.row-releg{ background:rgba(198,47,47,.06); }
    /* leading medal accent on the #1–#3 position numbers */
    .posn.gold{ color:#b8860b; } .posn.silver{ color:#7d8794; } .posn.bronze{ color:#a5682a; }
    .poscell{ position:relative; text-align:center; }
    .zonebar{ position:absolute; inset:0 auto 0 0; width:3px; }
    .z-champ{ background:var(--primary); } .z-cont{ background:var(--good); } .z-releg{ background:var(--bad); }
    .posn{ font-family:var(--mono); font-size:11px; font-weight:700; color:var(--primary-deep); }
    .cf{ display:flex; align-items:center; gap:8px; }
    .avatar{ width:18px; height:18px; display:grid; place-items:center; background:var(--primary); color:#fff; font-family:var(--mono); font-size:7.5px; font-weight:700; flex:none; }
    .cfname{ font-size:10px; font-weight:600; letter-spacing:-.01em; white-space:nowrap; }
    .ovc{ display:flex; align-items:center; gap:8px; }
    .ovbar{ height:6px; flex:1; background:var(--muted); min-width:44px; }
    .ovbar-f{ height:100%; background:var(--primary); }
    .ovpct{ font-family:var(--mono); font-size:10px; font-weight:700; color:var(--primary-deep); width:30px; text-align:right; }
    .gbox{ display:inline-grid; place-items:center; width:18px; height:18px; border:1px solid; font-family:var(--mono); font-size:9px; font-weight:700; }
    td.mnum{ font-family:var(--mono); font-size:9px; }
    td.mnum.dim{ color:var(--muted-fg); }

    /* grading scale + verification */
    .footgrid{ margin-top:26px; display:grid; grid-template-columns:1.5fr 1fr; gap:32px; }
    .scaletitle, .vtitle{ border-bottom:2px solid var(--primary); padding-bottom:5px; margin-bottom:10px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.16em; color:var(--primary); }
    .scalegrid{ display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:var(--border); }
    .scalecell{ background:var(--card); padding:10px 6px; text-align:center; }
    .scalecell .g{ font-family:var(--mono); font-size:19px; font-weight:700; color:var(--primary); line-height:1; }
    .scalecell .l{ margin-top:6px; font-size:7.5px; font-weight:500; line-height:1.15; }
    .scalecell .r{ font-family:var(--mono); margin-top:3px; font-size:8px; color:var(--muted-fg); }
    .legend{ margin-top:12px; display:flex; flex-wrap:wrap; gap:6px 20px; font-size:8.5px; color:var(--muted-fg); }
    .legend span{ display:inline-flex; align-items:center; gap:6px; }
    .legend i{ width:3px; height:10px; display:inline-block; }
    .verif{ border-left:2px solid var(--primary); background:var(--primary-tint); padding:14px 20px; }
    .verif .vk{ font-size:8px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted-fg); }
    .verif p{ margin:8px 0 0; font-size:10px; line-height:1.5; color:var(--primary-deep); }

    /* footer */
    .foot{ margin-top:auto; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding:10px 14mm; font-size:8px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted-fg); }

    /* continuation header for pages 2+ */
    .conthead{ display:flex; align-items:center; justify-content:space-between; border-bottom:4px solid var(--primary); padding:16px 14mm; }
    .conthead .ce{ font-size:9px; letter-spacing:.3em; color:var(--muted-fg); }
    .conthead .ct{ font-size:15px; font-weight:600; color:var(--primary); letter-spacing:-.01em; }
    .conthead .cm{ text-align:right; font-size:9px; text-transform:uppercase; letter-spacing:.18em; color:var(--muted-fg); line-height:1.5; }

    .loading{ text-align:center; color:var(--muted-fg); padding:60px 0; font-size:13px; }

    @media print{
      /* Real page margin so nothing is clipped at the physical edge, and the
         sheet flows to the printable width instead of a hard 210mm overflow. */
      @page{ size:A4; margin:8mm; }
      html,body{ background:#fff; }
      .toolbar, .shg-nav, .shg-nav-open, .no-print{ display:none !important; }
      body.shg-has-nav{ padding-right:0 !important; }
      .sheet{ box-shadow:none !important; margin:0 !important; width:100% !important; min-height:0 !important; page-break-after:always; break-after:page; }
      .sheet:last-of-type{ page-break-after:auto; break-after:auto; }
      /* internal padding relative to the (already-margined) page edge */
      .mast{ padding-left:10mm; padding-right:10mm; }
      .metastrip, .body, .foot, .conthead{ padding-left:10mm; padding-right:10mm; }
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
    <button class="btn" id="print"><i class="fas fa-print"></i> Print league table</button>
    <span class="toolnote">A4 · print-ready · royal blue / white</span>
  </div>

  <div id="sheets">
    <div class="sheet"><div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading league table…</div></div>
  </div>

  ${navSidebar('cfleague')}

  <script>
    var PAGE_SIZE = 16;
    var CLUSTER_LABELS = { all:'All clusters', iganga:'Iganga Cluster', kamuli:'Kamuli Cluster', bugiri:'Bugiri Cluster', central:'Central Cluster' };

    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function fmt(n){ n=Number(n)||0; return n.toLocaleString('en-US'); }
    function prettyDate(s){ if(!s) return ''; try{ return new Date(s+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }catch(e){ return s; } }
    function initials(name){ return String(name||'').trim().split(/\\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase(); }
    function gradeLetter(p){ p=Number(p)||0; if(p>=80)return'A'; if(p>=60)return'B'; if(p>=40)return'C'; if(p>=20)return'D'; return'E'; }
    function gradeTone(g){ if(g==='A'||g==='B')return '#1f8a4c'; if(g==='C'||g==='D')return '#c07d12'; return '#c62f2f'; }
    function gradeTint(g){ if(g==='A'||g==='B')return '#eaf6ef'; if(g==='C'||g==='D')return '#fbf2e3'; return '#fbe9e9'; }

    // Build one standings row. n = total CFs (for relegation zone).
    function leagueRow(r, n){
      var rank=r.rank;
      var zone = rank<=3 ? 'z-champ' : (rank<=6 ? 'z-cont' : (rank>n-3 ? 'z-releg' : ''));
      var rowCls = rank<=3 ? 'row-champ' : (rank<=6 ? 'row-cont' : (rank>n-3 ? 'row-releg' : ''));
      var medal = rank===1 ? 'gold' : (rank===2 ? 'silver' : (rank===3 ? 'bronze' : ''));
      var g=gradeLetter(r.overall), tone=gradeTone(g), tint=gradeTint(g);
      var ov=Math.min(100,Number(r.overall)||0);
      // avatar colour follows the zone so the leaderboard reads at a glance
      var avColor = rank<=3 ? '#003399' : (rank<=6 ? '#1f8a4c' : (rank>n-3 ? '#c62f2f' : '#5a6480'));
      // 7 metric string cells + dim styling when zero / dash
      var cells=[
        fmt(r.shgs_saving)+'/'+fmt(r.shgs_profiled)+' SHGs',
        fmt(r.youth_production)+' youth',
        fmt(r.groups_trained)+' groups',
        fmt(r.employed_youth)+' in work',
        fmt(r.birds_sold)+' birds',
        (Number(r.hs_value)>0?'UGX '+fmt(r.hs_value):'—'),
        fmt(r.lev_count)+' contrib.'
      ];
      var cellHtml=cells.map(function(v){
        var dim = (v==='—' || /^0[^0-9]/.test(v) || v==='0');
        return '<td class="mnum'+(dim?' dim':'')+'">'+esc(v)+'</td>';
      }).join('');
      return '<tr class="'+rowCls+'">'+
        '<td class="poscell">'+(zone?'<span class="zonebar '+zone+'"></span>':'')+'<span class="posn '+medal+'">'+rank+'</span></td>'+
        '<td><div class="cf"><span class="avatar" style="background:'+avColor+'">'+esc(initials(r.name))+'</span><span class="cfname">'+esc(r.name)+'</span></div></td>'+
        '<td><div class="ovc"><div class="ovbar"><div class="ovbar-f" style="width:'+ov+'%;background:'+tone+'"></div></div><span class="ovpct" style="color:'+tone+'">'+(Number(r.overall)||0)+'%</span></div></td>'+
        '<td style="text-align:center"><span class="gbox" style="color:'+tone+';border-color:'+tone+';background:'+tint+'">'+g+'</span></td>'+
        cellHtml+
      '</tr>';
    }

    function tableHead(){
      return '<thead><tr>'+
        '<th class="c" style="width:30px">Pos</th>'+
        '<th style="width:17%">Community Facilitator</th>'+
        '<th style="width:13%">Overall</th>'+
        '<th class="c" style="width:34px">Gr</th>'+
        '<th>SHGs<br/>saving/profiled</th>'+
        '<th>Youth<br/>production</th>'+
        '<th>Trainings<br/>first</th>'+
        '<th>Youth<br/>in work</th>'+
        '<th>Sales<br/>poultry</th>'+
        '<th>Sales<br/>horticulture</th>'+
        '<th>Local<br/>leverage</th>'+
      '</tr></thead>';
    }

    var SCALE=[['A','Excellent','80–100%'],['B','Very Good','60–79%'],['C','Good','40–59%'],['D','Fair','20–39%'],['E','Needs Improvement','0–19%']];

    function build(rows, clusterLabel, from, to){
      var n=rows.length;
      var period=(from&&to)?(prettyDate(from)+' – '+prettyDate(to)):'All available data';
      var genDate=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
      var avg=n?Math.round(rows.reduce(function(a,r){return a+(Number(r.overall)||0);},0)/n):0;
      var champ=n?rows[0]:null;
      // assign ranks
      rows.forEach(function(r,i){ r.rank=i+1; });

      // paginate
      var pages=[]; for(var i=0;i<Math.max(1,Math.ceil(n/PAGE_SIZE));i++){ pages.push(rows.slice(i*PAGE_SIZE,(i+1)*PAGE_SIZE)); }

      var html='';
      pages.forEach(function(page, p){
        var isFirst=(p===0), isLast=(p===pages.length-1);
        html+='<section class="sheet">';

        // header
        if(isFirst){
          html+='<div class="mast">'+
            '<div class="brand"><div class="mark"><span>SAYE</span></div>'+
              '<div><div class="bn">SAYE UGANDA</div><div class="bt">MONITORING · EVALUATION · LEARNING</div></div></div>'+
            '<div class="mastrow"><div><div class="eyebrow">COMMUNITY FACILITATORS · STANDINGS</div>'+
              '<h1>CF Premier<br/>League</h1></div>'+
              (champ?('<div class="champbox"><div class="cl">CHAMPION</div><div class="cn">'+esc(champ.name)+'</div>'+
                '<div class="cs">'+(Number(champ.overall)||0)+'% · GRADE '+gradeLetter(champ.overall)+'</div></div>'):'')+
            '</div></div>'+
            '<div class="metastrip">'+
              '<div class="cell"><div class="k">Cluster</div><div class="v">'+esc(clusterLabel)+'</div></div>'+
              '<div class="cell"><div class="k">Report period</div><div class="v">'+esc(period)+'</div></div>'+
              '<div class="cell"><div class="k">CFs ranked</div><div class="v num">'+n+'</div></div>'+
              '<div class="cell"><div class="k">Average grade</div><div class="v num">'+avg+'%</div></div>'+
              '<div class="cell"><div class="k">Generated</div><div class="v">'+esc(genDate)+'</div></div>'+
            '</div>';
        } else {
          html+='<div class="conthead"><div><div class="ce">SAYE UGANDA · MEL</div>'+
            '<div class="ct">CF Premier League · Standings continued</div></div>'+
            '<div class="cm">'+esc(clusterLabel)+'<br/>'+esc(period)+'</div></div>';
        }

        html+='<div class="body">';
        html+='<div class="secthead"><span class="no">'+String(p+1).padStart(2,'0')+'</span>'+
          '<h2>League Table</h2>'+
          (page.length?('<span class="rng">Positions '+page[0].rank+'–'+page[page.length-1].rank+' of '+n+'</span>'):'')+
        '</div>';

        if(!page.length){
          html+='<div class="loading">No CF data for this cluster / period.</div>';
        } else {
          html+='<table class="lg">'+tableHead()+'<tbody>'+page.map(function(r){return leagueRow(r,n);}).join('')+'</tbody></table>';
        }

        // grading scale + verification on last page
        if(isLast && n){
          html+='<div class="footgrid"><div>'+
            '<div class="scaletitle">Grading Scale</div>'+
            '<div class="scalegrid">'+SCALE.map(function(s){return '<div class="scalecell"><div class="g">'+s[0]+'</div><div class="l">'+s[1]+'</div><div class="r">'+s[2]+'</div></div>';}).join('')+'</div>'+
            '<div class="legend">'+
              '<span><i class="z-champ"></i> Top 3 · Champions zone</span>'+
              '<span><i class="z-cont"></i> 4–6 · Contenders</span>'+
              '<span><i class="z-releg"></i> Bottom 3 · Support needed</span>'+
            '</div></div>'+
            '<div><div class="vtitle" style="visibility:hidden">.</div>'+
              '<div class="verif"><div class="vk">Verification</div>'+
              '<p>Standings verified by SAYE Uganda M&amp;E on '+esc(genDate)+'. Overall score is the mean of the seven target areas, capped at 100% per area.</p></div>'+
            '</div></div>';
        }
        html+='</div>'; // body

        html+='<div class="foot"><span>SAYE Uganda · MEL</span><span>CF Premier League · '+esc(clusterLabel)+'</span>'+
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
      host.innerHTML='<div class="sheet"><div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading league table…</div></div>';
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

    load();
  </script>
</body>
</html>`;
}
