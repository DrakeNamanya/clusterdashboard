import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// AI OBSERVATION  — the dashboard's AI hub (Cloudflare Workers AI).
//   Two panels:
//     1. Anomaly digest — week-over-week movements across trainings, profiling,
//        distribution, sales, leverage, ISLA, jobs (computed in SQL, narrated
//        by the model). Auto-loads from /api/ai/observation.
//     2. Ask your data — a chat-style console: the user types a plain-English
//        question, the model writes SQL, we run it on the VM, and the model
//        answers in prose (+ the SQL and result table are shown for trust).
//        POSTs to /api/ai/ask.
//   All model calls run on Cloudflare's edge (no external API key).
// ---------------------------------------------------------------------------

export function renderAiObservation(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Observation — SAYE Uganda MEL</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <style>
    :root{ --navy:#0B3C5D; --navy2:#0e4a72; --line:#e2e7ea; --ink:#243b53; --muted:#5a6480; }
    body{ background:#f6f8f9; color:var(--ink); font-family:"Segoe UI",system-ui,-apple-system,sans-serif; }
    .card{ background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 1px 3px rgba(40,60,60,.05); }
    .hd{ background:linear-gradient(120deg,var(--navy),var(--navy2)); color:#fff; }
    .pill{ font-size:11px; padding:2px 9px; border-radius:999px; font-weight:700; }
    .up{ color:#1f8a4c; } .down{ color:#c62f2f; } .flat{ color:#5a6480; }
    .sig-up{ border-left:4px solid #1f8a4c; }
    .sig-down{ border-left:4px solid #c62f2f; }
    .sig-flat{ border-left:4px solid #b9c4e4; }
    .sig-new{ border-left:4px solid #c07d12; }
    .num{ font-variant-numeric:tabular-nums; }
    .prose-ai{ font-size:14px; line-height:1.6; }
    .prose-ai p{ margin:0 0 10px; }
    table.res{ border-collapse:collapse; width:100%; font-size:12px; }
    table.res th{ background:#eef2f4; text-align:left; padding:5px 8px; font-weight:700; white-space:nowrap; }
    table.res td{ padding:4px 8px; border-bottom:1px solid #eef2f4; white-space:nowrap; }
    table.res tr:nth-child(even) td{ background:#fafbfc; }
    .sql{ font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11.5px; background:#0b1f33; color:#d7e3f0; border-radius:8px; padding:10px 12px; overflow-x:auto; white-space:pre-wrap; }
    .chip{ font-size:12px; padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:#fff; cursor:pointer; }
    .chip:hover{ background:#eef2f7; border-color:#c7d4e2; }
    .qmsg{ background:#eef2f7; border-radius:12px 12px 2px 12px; padding:8px 12px; }
    .amsg{ background:#fff; border:1px solid var(--line); border-radius:12px 12px 12px 2px; padding:10px 12px; }
    .spin{ animation:spin 1s linear infinite; } @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body class="min-h-screen">
  <div class="max-w-5xl mx-auto px-4 py-6">

    <!-- Masthead -->
    <div class="card hd p-5 mb-5">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-xl bg-white/15 grid place-items-center text-2xl"><i class="fas fa-wand-magic-sparkles"></i></div>
        <div>
          <div class="text-xl font-bold leading-tight">AI Observation</div>
          <div class="text-xs opacity-80">Anomaly digest &amp; natural-language data queries · powered by Cloudflare Workers AI</div>
        </div>
      </div>
    </div>

    <!-- Panel 1: Anomaly digest -->
    <div class="card p-5 mb-5">
      <div class="flex items-center justify-between mb-3">
        <div class="font-bold text-lg"><i class="fas fa-triangle-exclamation text-amber-500 mr-2"></i>Anomaly Flags</div>
        <div class="flex items-center gap-3">
          <span id="obsWindow" class="text-xs text-slate-500"></span>
          <button id="obsRefresh" class="text-xs font-semibold text-white bg-[--navy] px-3 py-1.5 rounded-lg hover:opacity-90"><i class="fas fa-rotate mr-1"></i>Refresh</button>
        </div>
      </div>
      <div id="obsDigest" class="prose-ai text-slate-700 mb-4">
        <div class="text-slate-400 text-sm"><i class="fas fa-spinner spin mr-2"></i>Scanning the last two weeks…</div>
      </div>
      <div id="obsSignals" class="grid sm:grid-cols-2 gap-2"></div>
      <div class="text-[11px] text-slate-400 mt-3">Movements are computed directly from the database (last 7 days vs the previous 7); the AI only writes the narrative — it never changes the numbers.</div>
    </div>

    <!-- Panel 2: Ask your data -->
    <div class="card p-5">
      <div class="font-bold text-lg mb-1"><i class="fas fa-comments text-[--navy] mr-2"></i>Ask your data</div>
      <div class="text-xs text-slate-500 mb-3">Ask a question in plain English. The AI writes SQL, runs it on the live database, and answers with the numbers.</div>

      <div class="flex flex-wrap gap-2 mb-3" id="examples">
        <span class="chip">Which CF trained the most youth in Mayuge?</span>
        <span class="chip">Total local leverage contributions by district</span>
        <span class="chip">How many SHGs were profiled in Jinja?</span>
        <span class="chip">Top 5 CFs by horticulture sales value</span>
      </div>

      <div id="chat" class="space-y-3 mb-3"></div>

      <div class="flex gap-2">
        <input id="q" type="text" placeholder="e.g. which district trained the most youth last month?"
          class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--navy]/30" />
        <button id="askBtn" class="bg-[--navy] text-white font-semibold px-4 py-2 rounded-lg text-sm hover:opacity-90"><i class="fas fa-paper-plane mr-1"></i>Ask</button>
      </div>
      <div class="text-[11px] text-slate-400 mt-2">Read-only: the assistant can only run SELECT queries against the reporting tables.</div>
    </div>

  </div>

  ${navSidebar('aiobservation')}

  <script>
    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function fmt(n){ if(n==null||n==='') return ''; var v=Number(n); return isNaN(v)? esc(n) : v.toLocaleString('en-US'); }

    // ---------- Panel 1: anomaly digest ----------
    function arrow(pct, cur, prev){
      if(prev===0 && cur>0) return {cls:'sig-new', ico:'fa-star', tone:'flat', label:'NEW'};
      if(pct===null) return {cls:'sig-flat', ico:'fa-minus', tone:'flat', label:'—'};
      if(pct>=8) return {cls:'sig-up', ico:'fa-arrow-trend-up', tone:'up', label:'+'+pct+'%'};
      if(pct<=-8) return {cls:'sig-down', ico:'fa-arrow-trend-down', tone:'down', label:pct+'%'};
      return {cls:'sig-flat', ico:'fa-arrows-left-right', tone:'flat', label:(pct>0?'+':'')+pct+'%'};
    }
    function renderDigest(text){
      // turn simple bullet/newline text into paragraphs
      var lines=String(text||'').split(/\\n+/).filter(function(l){return l.trim();});
      document.getElementById('obsDigest').innerHTML = lines.map(function(l){
        return '<p>'+esc(l.replace(/^[-*•]\\s*/,'• '))+'</p>';
      }).join('') || '<p class="text-slate-400">No digest.</p>';
    }
    function renderSignals(sigs){
      var host=document.getElementById('obsSignals');
      if(!sigs||!sigs.length){ host.innerHTML=''; return; }
      host.innerHTML = sigs.map(function(s){
        var a=arrow(s.delta_pct, s.current, s.previous);
        return '<div class="'+a.cls+' bg-slate-50 rounded-lg px-3 py-2 flex items-center justify-between">'+
          '<div><div class="text-sm font-semibold">'+esc(s.metric)+'</div>'+
          '<div class="text-[11px] text-slate-500">'+esc(s.scope)+' · '+fmt(s.current)+' vs '+fmt(s.previous)+'</div></div>'+
          '<div class="'+a.tone+' font-bold num text-sm whitespace-nowrap"><i class="fas '+a.ico+' mr-1"></i>'+a.label+'</div>'+
        '</div>';
      }).join('');
    }
    async function loadObservation(){
      document.getElementById('obsDigest').innerHTML='<div class="text-slate-400 text-sm"><i class="fas fa-spinner spin mr-2"></i>Scanning the last two weeks…</div>';
      document.getElementById('obsSignals').innerHTML='';
      try{
        var r=await fetch('/api/ai/observation?nocache='+Date.now());
        var d=await r.json();
        if(d.error){ renderDigest('Could not generate observations: '+d.error); return; }
        document.getElementById('obsWindow').textContent=d.window||'';
        renderDigest(d.digest);
        renderSignals(d.signals);
      }catch(e){ renderDigest('Failed to load: '+(e&&e.message||e)); }
    }

    // ---------- Panel 2: ask your data ----------
    var chat=document.getElementById('chat');
    function addQ(q){ var el=document.createElement('div'); el.className='flex justify-end'; el.innerHTML='<div class="qmsg max-w-[80%] text-sm">'+esc(q)+'</div>'; chat.appendChild(el); el.scrollIntoView({behavior:'smooth',block:'nearest'}); }
    function addA(html){ var el=document.createElement('div'); el.className='flex justify-start'; el.innerHTML='<div class="amsg max-w-[92%] w-full text-sm">'+html+'</div>'; chat.appendChild(el); el.scrollIntoView({behavior:'smooth',block:'nearest'}); return el; }

    function resultTable(rows){
      if(!rows||!rows.length) return '<div class="text-slate-400 text-xs">No rows.</div>';
      var cols=Object.keys(rows[0]);
      var head='<tr>'+cols.map(function(c){return '<th>'+esc(c)+'</th>';}).join('')+'</tr>';
      var body=rows.slice(0,25).map(function(r){ return '<tr>'+cols.map(function(c){return '<td>'+fmt(r[c])+'</td>';}).join('')+'</tr>'; }).join('');
      var more=rows.length>25?'<div class="text-[11px] text-slate-400 mt-1">Showing 25 of '+rows.length+' rows.</div>':'';
      return '<div class="overflow-x-auto"><table class="res">'+head+body+'</table></div>'+more;
    }

    async function ask(q){
      if(!q||!q.trim()) return;
      addQ(q);
      var el=addA('<i class="fas fa-spinner spin mr-2"></i>Thinking…');
      try{
        var r=await fetch('/api/ai/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
        var d=await r.json();
        if(d.error){
          el.querySelector('div,*'); el.innerHTML='<div class="text-red-600 text-sm"><i class="fas fa-circle-exclamation mr-1"></i>'+esc(d.error)+'</div>'+(d.sql?'<details class="mt-2"><summary class="text-xs text-slate-500 cursor-pointer">Show attempted SQL</summary><div class="sql mt-1">'+esc(d.sql)+'</div></details>':'');
          return;
        }
        var html='<div class="prose-ai mb-2">'+esc(d.answer).replace(/\\n/g,'<br/>')+'</div>';
        html+='<details class="mb-2"><summary class="text-xs text-slate-500 cursor-pointer"><i class="fas fa-database mr-1"></i>SQL &amp; results ('+(d.rows?d.rows.length:0)+' rows)</summary>';
        html+='<div class="sql mt-2">'+esc(d.sql)+'</div><div class="mt-2">'+resultTable(d.rows)+'</div></details>';
        el.innerHTML=html;
      }catch(e){ el.innerHTML='<div class="text-red-600 text-sm">Failed: '+esc(e&&e.message||e)+'</div>'; }
    }

    document.getElementById('askBtn').addEventListener('click', function(){ var q=document.getElementById('q').value; document.getElementById('q').value=''; ask(q); });
    document.getElementById('q').addEventListener('keydown', function(e){ if(e.key==='Enter'){ var q=this.value; this.value=''; ask(q); } });
    document.querySelectorAll('#examples .chip').forEach(function(ch){ ch.addEventListener('click', function(){ ask(ch.textContent); }); });
    document.getElementById('obsRefresh').addEventListener('click', loadObservation);

    loadObservation();
  </script>
</body>
</html>`;
}
