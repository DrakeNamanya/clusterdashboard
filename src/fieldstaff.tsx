import { navSidebar } from './nav';
// ---------------------------------------------------------------------------
// FIELD STAFF (CF REGISTRY) — Task E backend admin tab
//
// The M&E team's control panel for the canonical CF-name registry. It lets them:
//   * SEARCH every canonical person (with account count, data-derived districts
//     and how much activity resolves to them).
//   * See ORPHAN profiler names (activity that resolved to NO person) and fold
//     each one into the right person (fixes "Abubakar doesn't appear").
//   * MERGE duplicate field_staff accounts ("the previous account didn't work").
//   * TRANSFER an SHG's owner to another person.
//   * RENAME a person's display name.
//   * Trigger a full identity refresh.
//
// All actions call JSON endpoints under /api/field-staff/* (see src/index.tsx)
// which wrap the mel_admin_* RPCs and re-run the Task-E refresh chain.
// Design language cloned from the CF Payment Report (Royal Blue #003399).
// ---------------------------------------------------------------------------

export function renderFieldStaff(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Field Staff · CF Registry — SAYE Uganda MEL</title>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
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
    .wrap{ max-width:1100px; margin:0 auto; padding:18px 14px 60px; }
    .masthead{ background:var(--primary); color:#fff; padding:20px 26px; border-radius:4px 4px 0 0; }
    .masthead .brand{ font-family:var(--mono); font-size:11px; letter-spacing:.2em; text-transform:uppercase; opacity:.85; }
    .masthead h1{ margin:4px 0 2px; font-size:24px; font-weight:700; }
    .masthead .sub{ font-size:13px; opacity:.9; }
    .panel{ background:#fff; border:1px solid var(--border); border-top:0; }
    .toolbar{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; padding:16px; border-bottom:1px solid var(--border); }
    .fld{ display:flex; flex-direction:column; gap:4px; }
    .fld label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted-fg); }
    .fld input, .fld select{ border:1px solid var(--border); border-radius:2px; padding:8px 10px; font-size:13px; background:#fff; min-width:160px; color:var(--fg); font-family:inherit; }
    .fld input:focus, .fld select:focus{ outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(0,51,153,.12); }
    .btn{ background:var(--primary); color:#fff; border:0; border-radius:2px; padding:9px 16px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.1em; cursor:pointer; font-family:var(--sans); }
    .btn:hover{ background:var(--primary-deep); }
    .btn.ghost{ background:#fff; color:var(--primary); border:1px solid var(--border); }
    .btn.sm{ padding:5px 10px; font-size:10px; }
    .btn.danger{ background:var(--bad); }
    .btn:disabled{ opacity:.5; cursor:not-allowed; }
    .tabs{ display:flex; gap:0; border-bottom:1px solid var(--border); background:var(--muted); }
    .tab{ padding:11px 18px; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; cursor:pointer; color:var(--muted-fg); border-bottom:3px solid transparent; background:transparent; border-top:0; border-left:0; border-right:0; font-family:inherit; }
    .tab.active{ color:var(--primary); border-bottom-color:var(--primary); background:#fff; }
    table{ width:100%; border-collapse:collapse; font-size:13px; }
    th,td{ padding:9px 12px; text-align:left; border-bottom:1px solid var(--muted); }
    th{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted-fg); background:#fafbfe; position:sticky; top:0; }
    tr:hover td{ background:#f7f9fe; }
    .chip{ display:inline-block; font-family:var(--mono); font-size:10px; padding:2px 7px; border-radius:10px; background:var(--primary-tint); color:var(--primary-deep); margin:1px 2px; }
    .chip.warn{ background:#fdf3e2; color:var(--warn); }
    .chip.dup{ background:#fde9e9; color:var(--bad); }
    .muted{ color:var(--muted-fg); }
    .msg{ margin:12px 16px; padding:9px 13px; border-radius:2px; font-size:13px; display:none; }
    .msg.ok{ display:block; background:#e9f6ee; border:1px solid #b6e0c4; color:var(--good); }
    .msg.err{ display:block; background:#fde9e9; border:1px solid #f2b8b8; color:var(--bad); }
    .empty{ padding:26px; text-align:center; color:var(--muted-fg); font-size:14px; }
    /* modal drawer */
    .drawer-bg{ position:fixed; inset:0; background:rgba(15,25,50,.4); display:none; z-index:9500; }
    .drawer-bg.show{ display:block; }
    .drawer{ position:fixed; top:0; right:0; height:100vh; width:min(560px,94vw); background:#fff; box-shadow:-3px 0 18px rgba(15,30,60,.2); z-index:9600; transform:translateX(100%); transition:transform .2s ease; overflow-y:auto; }
    .drawer.show{ transform:translateX(0); }
    .drawer-head{ background:var(--primary); color:#fff; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; }
    .drawer-head h2{ margin:0; font-size:18px; }
    .drawer-body{ padding:16px 20px 40px; }
    .sect{ margin:14px 0; }
    .sect h3{ font-family:var(--mono); font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted-fg); margin:0 0 6px; border-bottom:1px solid var(--muted); padding-bottom:4px; }
    .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:6px 0; }
    .row input, .row select{ border:1px solid var(--border); border-radius:2px; padding:7px 9px; font-size:13px; flex:1; min-width:120px; }
    .x{ background:transparent; border:0; color:#fff; font-size:20px; cursor:pointer; }
    .acct{ padding:7px 10px; border:1px solid var(--muted); border-radius:3px; margin:4px 0; font-size:12px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .spin{ display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,.4); border-top-color:#fff; border-radius:50%; animation:sp .7s linear infinite; vertical-align:-2px; }
    @keyframes sp{ to{ transform:rotate(360deg); } }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="masthead">
      <div class="brand">SAYE Uganda · Heifer International · MEL</div>
      <h1><i class="fas fa-users-gear"></i> Field Staff — CF Registry</h1>
      <div class="sub">The single source of truth for who-is-who. Fold duplicate accounts &amp; orphan names into one CF, transfer SHG ownership, and keep the reports in lock-step.</div>
    </header>
    <div class="panel">
      <div class="tabs">
        <button class="tab active" data-tab="people"><i class="fas fa-id-card"></i> People</button>
        <button class="tab" data-tab="orphans"><i class="fas fa-user-slash"></i> Unmatched names</button>
      </div>
      <div class="toolbar">
        <div class="fld">
          <label>Search name</label>
          <input id="q" placeholder="e.g. titus, abubakar" />
        </div>
        <div class="fld">
          <label>District</label>
          <input id="qd" placeholder="e.g. JINJA (people tab)" />
        </div>
        <button class="btn" id="search"><i class="fas fa-magnifying-glass"></i> Search</button>
        <button class="btn ghost" id="refresh" title="Rebuild the whole CF identity + universe cache">
          <i class="fas fa-rotate"></i> Refresh identities
        </button>
        <span id="count" class="muted num" style="margin-left:auto;font-size:12px;"></span>
      </div>
      <div id="msg" class="msg"></div>
      <div id="tableWrap"><div class="empty">Loading…</div></div>
    </div>
  </div>

  ${navSidebar('fieldstaff')}

  <!-- Person detail drawer -->
  <div class="drawer-bg" id="drawerBg"></div>
  <aside class="drawer" id="drawer" aria-hidden="true">
    <div class="drawer-head">
      <h2 id="dName">Person</h2>
      <button class="x" id="dClose" aria-label="Close">&times;</button>
    </div>
    <div class="drawer-body" id="dBody"></div>
  </aside>

  <script>
    const API = '${base}';
    let TAB = 'people';
    let PEOPLE = [];   // cache of current people list (for merge target dropdowns)

    const el = (id) => document.getElementById(id);
    const esc = (s) => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function flash(kind, text){ const m=el('msg'); m.className='msg '+kind; m.textContent=text; if(kind==='ok') setTimeout(()=>{ m.className='msg'; }, 4000); }
    async function jget(u){ const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
    async function jpost(u, body){ const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}); const j=await r.json().catch(()=>({})); if(!r.ok||j.ok===false) throw new Error(j.error||('HTTP '+r.status)); return j; }

    function setTab(t){
      TAB=t;
      document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===t));
      el('qd').style.display = (t==='people') ? '' : 'none';
      load();
    }

    async function load(){
      el('tableWrap').innerHTML='<div class="empty">Loading…</div>';
      const q=encodeURIComponent(el('q').value.trim());
      const qd=encodeURIComponent(el('qd').value.trim());
      try{
        if(TAB==='people'){
          const rows = await jget(API+'/api/field-staff/people?q='+q+'&district='+qd);
          PEOPLE = rows;                       // people tab: cache = the filtered view
          renderPeople(rows);
        }else{
          // orphans tab: make sure we hold the FULL people list for the fold picker
          // (independent of the search box), then load orphans.
          if(!PEOPLE.length){ try{ PEOPLE = await jget(API+'/api/field-staff/people?q='); }catch(e){} }
          const rows = await jget(API+'/api/field-staff/orphans?q='+q);
          renderOrphans(rows);
        }
      }catch(e){ el('tableWrap').innerHTML='<div class="empty">Error: '+esc(e.message)+'</div>'; }
    }

    function renderPeople(rows){
      el('count').textContent = rows.length + ' people';
      if(!rows.length){ el('tableWrap').innerHTML='<div class="empty">No people match.</div>'; return; }
      let h='<table><thead><tr><th>Name</th><th>Type</th><th>Accts</th><th>Districts</th><th>Activity</th><th></th></tr></thead><tbody>';
      for(const p of rows){
        const dup = p.accounts>1 ? '<span class="chip dup">'+p.accounts+' accounts</span>' : '<span class="num">'+p.accounts+'</span>';
        const dists = (p.districts||[]).map(d=>'<span class="chip">'+esc(d)+'</span>').join('') || '<span class="muted">—</span>';
        const en = p.enabled ? '' : '<span class="chip warn">disabled</span>';
        h+='<tr><td><strong>'+esc(titlecase(p.display_name))+'</strong> '+en+'<div class="muted num" style="font-size:10px">'+esc(p.person_id)+'</div></td>'
          +'<td class="muted">'+esc(p.user_type||'')+'</td>'
          +'<td>'+dup+'</td>'
          +'<td>'+dists+'</td>'
          +'<td class="num">'+(p.sources||0)+' src · '+(p.act_rows||0)+' rows</td>'
          +'<td><button class="btn sm ghost" onclick="openPerson(\\''+esc(p.person_id)+'\\')">Manage</button></td></tr>';
      }
      h+='</tbody></table>';
      el('tableWrap').innerHTML=h;
    }

    let ORPHAN_TOTAL = 0;
    function renderOrphans(rows){
      const capped = rows.length >= 400;
      el('count').textContent = rows.length + (capped ? '+ ' : ' ') + 'unmatched names';
      if(!rows.length){ el('tableWrap').innerHTML='<div class="empty">No unmatched profiler names match — everything resolves to a person. 🎉</div>'; return; }
      let h='';
      if(capped){ h+='<div class="msg ok" style="display:block">Showing the first 400 (most active). Use the search box to narrow down a specific name.</div>'; }
      h+='<table><thead><tr><th>Profiler name (key)</th><th>Sources</th><th>Districts</th><th>Rows</th><th style="width:320px">Fold into a CF…</th></tr></thead><tbody>';
      for(const o of rows){
        const srcs=(o.sources||[]).map(s=>'<span class="chip">'+esc(s)+'</span>').join('');
        const dists=(o.districts||[]).map(d=>'<span class="chip">'+esc(d)+'</span>').join('')||'<span class="muted">—</span>';
        const key=esc(o.name_key);
        h+='<tr id="orow_'+key+'"><td><strong class="num">'+key+'</strong></td>'
          +'<td>'+srcs+'</td><td>'+dists+'</td><td class="num">'+o.act_rows+'</td>'
          +'<td><div class="row"><input list="peoplelist" placeholder="type a CF name…" id="fold_'+key+'" style="flex:1" />'
          +'<button class="btn sm" onclick="foldOrphan(\\''+key+'\\')">Fold</button></div></td></tr>';
      }
      h+='</tbody></table>';
      h+=peopleDatalist();
      el('tableWrap').innerHTML=h;
    }

    // A datalist of "Name — person_id" so orphan-fold + merge can pick a target.
    function peopleDatalist(){
      const opts = (PEOPLE||[]).map(p=>'<option value="'+esc(titlecase(p.display_name))+' — '+esc(p.person_id)+'">').join('');
      return '<datalist id="peoplelist">'+opts+'</datalist>';
    }
    function pickPersonId(val){
      // accepts "Name — FSS-xxxx", a bare FSS id, an exact name, or a unique substring
      if(!val) return null;
      const s = String(val).trim();
      const m = s.match(/(FSS-\\d+)\\s*$/i);
      if(m) return m[1].toUpperCase();
      if(/^FSS-\\d+$/i.test(s)) return s.toUpperCase();
      const low = s.toLowerCase();
      // exact display-name match first
      let p=(PEOPLE||[]).find(x=>titlecase(x.display_name).toLowerCase()===low);
      if(p) return p.person_id;
      // otherwise a UNIQUE substring match (so "titus" resolves if only one Titus)
      const hits=(PEOPLE||[]).filter(x=>String(x.display_name||'').toLowerCase().includes(low));
      if(hits.length===1) return hits[0].person_id;
      return null;
    }
    function titlecase(s){ return String(s||'').replace(/\\b\\w/g,c=>c.toUpperCase()); }

    async function foldOrphan(key){
      // always ensure we have the FULL people cache for the picker/resolver
      try{ if(!PEOPLE.length) PEOPLE=await jget(API+'/api/field-staff/people?q='); }catch(e){}
      const inp = el('fold_'+key);
      const val = inp ? inp.value : '';
      const pid = pickPersonId(val);
      if(!pid){ flash('err','Type a CF name that matches exactly one person (or pick from the dropdown / paste their FSS-id).'); return; }
      try{
        const btnRow = el('orow_'+key);
        flash('ok','Folding "'+key+'" → '+pid+' … (rebuilding identities)');
        const j=await jpost(API+'/api/field-staff/add-alias', { person_id: pid, alias_key: key, note: 'admin fold from orphans' });
        // optimistic: drop the row from the table immediately so the change is visible
        if(btnRow){ btnRow.style.transition='opacity .3s'; btnRow.style.opacity='0'; setTimeout(()=>{ if(btnRow.parentNode) btnRow.parentNode.removeChild(btnRow); }, 320); }
        flash('ok','✓ Folded "'+key+'" into '+pid+'. That name now rolls up to the CF. Universe = '+j.universe+' CFs.');
        // refresh from server after the rebuild has settled (avoids showing the just-folded name again)
        setTimeout(load, 1200);
      }catch(e){ flash('err','Fold failed: '+e.message); }
    }

    async function openPerson(pid){
      el('drawerBg').classList.add('show'); el('drawer').classList.add('show');
      el('dName').textContent='Loading…'; el('dBody').innerHTML='<div class="empty">Loading…</div>';
      try{
        const d = await jget(API+'/api/field-staff/person?id='+encodeURIComponent(pid));
        const p = d.person||{};
        el('dName').textContent = titlecase(p.display_name||pid);
        el('dBody').innerHTML = personDrawer(d, pid);
      }catch(e){ el('dBody').innerHTML='<div class="empty">Error: '+esc(e.message)+'</div>'; }
    }

    function personDrawer(d, pid){
      const p=d.person||{};
      const accts=(d.accounts||[]);
      const aliases=(d.aliases||[]);
      const acts=(d.activity||[]);
      let h='';
      // rename
      h+='<div class="sect"><h3>Display name</h3><div class="row">'
        +'<input id="rn" value="'+esc(p.display_name||'')+'" />'
        +'<button class="btn sm" onclick="doRename(event,\\''+esc(pid)+'\\')">Rename</button></div></div>';
      // accounts
      h+='<div class="sect"><h3>Accounts ('+accts.length+')</h3>';
      if(accts.length<=1){ h+='<div class="muted" style="font-size:12px">Single account — no duplicates.</div>'; }
      for(const a of accts){
        const badge = a.is_primary ? '<span class="chip">primary</span>' : '<button class="btn sm danger" onclick="unmerge(event,\\''+esc(a.ref_id)+'\\')">unlink</button>';
        h+='<div class="acct"><div><strong class="num">'+esc(a.ref_id)+'</strong> — '+esc(a.first_name||'')+' '+esc(a.last_name||'')
          +'<div class="muted" style="font-size:11px">@'+esc(a.username||'')+' · '+esc(a.district||'')+(a.enabled?'':' · disabled')+'</div></div>'+badge+'</div>';
      }
      // merge another account into this one
      h+='<div class="row" style="margin-top:8px"><input list="peoplelist" id="mergeSel" placeholder="merge another CF into this one…" />'
        +'<button class="btn sm" onclick="mergeInto(event,\\''+esc(pid)+'\\')">Merge in</button></div>';
      h+=peopleDatalist();
      h+='</div>';
      // aliases
      h+='<div class="sect"><h3>Name keys ('+aliases.length+')</h3><div>';
      for(const al of aliases){
        const man = al.is_manual ? ' <button class="btn sm danger" onclick="delAlias(event,\\''+esc(pid)+'\\',\\''+esc(al.alias_key)+'\\')">×</button>' : '';
        const cls = al.is_manual ? 'chip warn' : 'chip';
        h+='<span class="'+cls+'">'+esc(al.alias_key)+' ('+esc(al.kind)+')'+man+'</span>';
      }
      h+='</div><div class="row" style="margin-top:8px"><input id="aliasIn" placeholder="add a name / variant this CF uses…" />'
        +'<button class="btn sm" onclick="addAliasManual(event,\\''+esc(pid)+'\\')">Add key</button></div></div>';
      // activity
      h+='<div class="sect"><h3>Activity resolved to this person</h3>';
      if(!acts.length){ h+='<div class="muted" style="font-size:12px">No activity yet.</div>'; }
      else { h+='<div>'+acts.map(a=>'<span class="chip">'+esc(a.src)+': '+a.rows+'</span>').join('')+'</div>'; }
      h+='</div>';
      // transfer SHG owner
      h+='<div class="sect"><h3>Transfer an SHG to this person</h3>'
        +'<div class="row"><input id="shgName" placeholder="SHG / group name…" />'
        +'<button class="btn sm" onclick="transferShg(event,\\''+esc(pid)+'\\')">Transfer</button></div>'
        +'<div class="muted" style="font-size:11px">Records an ownership override for that group.</div></div>';
      return h;
    }

    // ---- drawer actions ----
    // Small helper: run a drawer write, disable the button while it works,
    // then re-open the drawer (fresh data) and refresh the underlying list so
    // the change is always visible.
    async function drawerAction(ev, workingLabel, fn){
      const btn = ev && ev.target ? ev.target : null;
      let old;
      if(btn){ old=btn.innerHTML; btn.disabled=true; btn.innerHTML='<span class="spin"></span> '+workingLabel; }
      try{ await fn(); }
      catch(e){ flash('err', (e && e.message) ? e.message : String(e)); }
      finally{ if(btn){ btn.disabled=false; btn.innerHTML=old; } }
    }

    async function doRename(ev,pid){
      const nm=el('rn').value.trim();
      if(!nm){ flash('err','Type a display name first.'); return; }
      await drawerAction(ev,'Renaming…', async ()=>{
        const j=await jpost(API+'/api/field-staff/rename',{person_id:pid,display_name:nm});
        flash('ok','✓ Renamed to "'+nm+'". Universe = '+j.universe+' CFs.');
        el('dName').textContent = titlecase(nm);
        await openPerson(pid); load();
      });
    }
    async function mergeInto(ev,keepPid){
      const val=el('mergeSel').value;
      const loserPid=pickPersonId(val);
      if(!loserPid){ flash('err','Pick the CF to merge in (name that matches one person, or paste their FSS-id).'); return; }
      if(loserPid===keepPid){ flash('err','Cannot merge a person into themselves.'); return; }
      await drawerAction(ev,'Merging…', async ()=>{
        const j=await jpost(API+'/api/field-staff/merge',{loser_ref:loserPid,keep_ref:keepPid,note:'admin merge'});
        flash('ok','✓ Merged '+loserPid+' into this CF. Both now report as one. Universe = '+j.universe+' CFs.');
        PEOPLE=[]; // invalidate cache so merged-away CF disappears from pickers
        await openPerson(keepPid); load();
      });
    }
    async function unmerge(ev,ref){
      if(!confirm('Unlink account '+ref+' from this person? It becomes a separate CF again.')) return;
      await drawerAction(ev,'Unlinking…', async ()=>{
        const j=await jpost(API+'/api/field-staff/unmerge',{loser_ref:ref});
        flash('ok','✓ Unlinked '+ref+'. It is a separate CF again. Universe = '+j.universe+' CFs.');
        PEOPLE=[];
        closeDrawer(); load();
      });
    }
    async function addAliasManual(ev,pid){
      const k=el('aliasIn').value.trim();
      if(!k){ flash('err','Type a name / variant first.'); return; }
      await drawerAction(ev,'Adding…', async ()=>{
        const j=await jpost(API+'/api/field-staff/add-alias',{person_id:pid,alias_key:k,note:'admin manual'});
        flash('ok','✓ Added name key "'+k+'". Activity under that name now rolls up here. Universe = '+j.universe+' CFs.');
        await openPerson(pid); load();
      });
    }
    async function delAlias(ev,pid,k){
      if(!confirm('Remove the manual name key "'+k+'" from this person?')) return;
      await drawerAction(ev,'Removing…', async ()=>{
        const j=await jpost(API+'/api/field-staff/del-alias',{person_id:pid,alias_key:k});
        flash('ok','✓ Removed name key "'+k+'". Universe = '+j.universe+' CFs.');
        await openPerson(pid); load();
      });
    }
    async function transferShg(ev,pid){
      const g=el('shgName').value.trim();
      if(!g){ flash('err','Type an SHG / group name first.'); return; }
      await drawerAction(ev,'Transferring…', async ()=>{
        const j=await jpost(API+'/api/field-staff/transfer-shg',{group_name:g,person_id:pid,note:'admin transfer'});
        flash('ok','✓ SHG "'+g+'" now owned by this CF (key '+j.group_key+').');
        el('shgName').value='';
        await openPerson(pid); load();
      });
    }

    async function doRefresh(){ const b=el('refresh'); b.disabled=true; const old=b.innerHTML; b.innerHTML='<span class="spin"></span> Refreshing…'; try{ const j=await jpost(API+'/api/cf-universe/refresh',{}); flash('ok','Identity refresh done. '+ (j.cfs||0) +' CFs in universe.'); load(); }catch(e){ flash('err',e.message);} finally{ b.disabled=false; b.innerHTML=old; } }

    // wiring
    document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
    el('search').addEventListener('click', load);
    el('q').addEventListener('keydown', e=>{ if(e.key==='Enter') load(); });
    el('qd').addEventListener('keydown', e=>{ if(e.key==='Enter') load(); });
    el('refresh').addEventListener('click', doRefresh);
    function closeDrawer(){ el('drawerBg').classList.remove('show'); el('drawer').classList.remove('show'); }
    el('dClose').addEventListener('click', closeDrawer);
    el('drawerBg').addEventListener('click', closeDrawer);
    window.openPerson=openPerson; window.foldOrphan=foldOrphan; window.doRename=doRename;
    window.mergeInto=mergeInto; window.unmerge=unmerge; window.addAliasManual=addAliasManual;
    window.delAlias=delAlias; window.transferShg=transferShg;
    load();
  </script>
</body>
</html>`;
}
