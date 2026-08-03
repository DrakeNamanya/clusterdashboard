// ---------------------------------------------------------------------------
// Shared right-side navigation sidebar, injected into every page.
//
// Style follows the Heifer International reference: a dark-navy header strip
// with a white hamburger + logo, a white body with one row per item, each item
// an icon inside a rounded square, and a navy left-edge bar + tint on the
// active item. It lives on the RIGHT of the window and every item is a plain
// <a href> so clicking navigates in the SAME window/tab.
//
// Usage: call navSidebar(activeKey) to get the markup, and place navShift()'s
// output <style> once. renderPage / each dashboard injects navHtml(active).
// ---------------------------------------------------------------------------

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: string; // Font Awesome class
  // Optional group id: items sharing a group id are rendered under a single
  // collapsible category header (see NAV_GROUPS). Ungrouped items render
  // stand-alone in their position in the list.
  group?: string;
}

// Category headers for grouped items. `key` matches NavItem.group.
export interface NavGroup {
  key: string;
  label: string;
  icon: string; // Font Awesome class for the group header
}

export const NAV_GROUPS: NavGroup[] = [
  { key: 'grp-distribution', label: 'Distribution', icon: 'fa-boxes-stacked' },
  { key: 'grp-sales', label: 'Sales', icon: 'fa-sack-dollar' },
];

// The single source of truth for the dashboard menu. Order matches the header
// we had before, with Home first. Items carrying a `group` are collapsed under
// the matching category header (Distribution, Sales); the group renders at the
// position of its FIRST member. Everything else stays independent.
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', href: '/', label: 'Home', icon: 'fa-house' },
  { key: 'report', href: '/report', label: 'Report Dashboard', icon: 'fa-bullseye' },
  { key: 'weekly', href: '/weekly-report', label: 'Weekly Report', icon: 'fa-calendar-week' },
  { key: 'cfreport', href: '/cf-report', label: 'CF Report Card', icon: 'fa-id-badge' },
  { key: 'cfleague', href: '/cf-premier-league', label: 'CF Premier League', icon: 'fa-ranking-star' },
  { key: 'programme', href: '/programme-report', label: 'Programme Report', icon: 'fa-file-word' },
  { key: 'aiobservation', href: '/ai-observation', label: 'AI Observation', icon: 'fa-wand-magic-sparkles' },
  { key: 'youthinwork', href: '/youth-in-work', label: 'Youth in Work', icon: 'fa-briefcase' },
  { key: 'cluster', href: '/cluster-trainings', label: 'Cluster Trainings', icon: 'fa-chart-simple' },
  { key: 'newyouth', href: '/monthly-new-youth', label: 'Monthly New Youth', icon: 'fa-user-plus' },
  { key: 'traineesv2', href: '/trainees-v2', label: 'Trainees (Attendance) · NEW', icon: 'fa-user-check' },
  { key: 'trainingdetails', href: '/trainees-v2/details', label: 'Training Deep-Dive (PSRP…)', icon: 'fa-layer-group' },
  { key: 'frontliners', href: '/frontliners', label: 'Trainings by Frontliners', icon: 'fa-table' },
  // ── Distribution group ──
  { key: 'distribution', href: '/distribution', label: 'Distribution to Participants', icon: 'fa-boxes-stacked', group: 'grp-distribution' },
  { key: 'shgdistribution', href: '/shg-distribution', label: 'Distribution to SHGs', icon: 'fa-people-group', group: 'grp-distribution' },
  { key: 'shgprofiling', href: '/shg-profiling', label: 'SHG Profiling', icon: 'fa-address-card' },
  { key: 'isla', href: '/isla', label: 'ISLA Savings', icon: 'fa-piggy-bank' },
  { key: 'production', href: '/production', label: 'Production (Horticulture)', icon: 'fa-seedling' },
  // ── Sales group ──
  { key: 'sales', href: '/sales', label: 'Sales (Horticulture/Oilseeds)', icon: 'fa-sack-dollar', group: 'grp-sales' },
  { key: 'poultrysales', href: '/poultry-sales', label: 'Poultry Sales', icon: 'fa-kiwi-bird', group: 'grp-sales' },
  { key: 'itemsnotsold', href: '/items-not-sold', label: 'Items Not Sold', icon: 'fa-triangle-exclamation', group: 'grp-sales' },
  { key: 'localleverage', href: '/local-leverage', label: 'Local Leverage', icon: 'fa-hand-holding-dollar' },
  { key: 'tools', href: '/tools', label: 'Data Tools & OData', icon: 'fa-broom' },
];

// CSS + toggle script for the sidebar. Include ONCE per page (navSidebar puts
// it inline for simplicity). The sidebar is fixed on the right; the page body
// gets right padding so content is not hidden behind it on wide screens.
export function navSidebar(activeKey: string): string {
  const itemLink = (it: NavItem, inGroup: boolean): string => {
    const active = it.key === activeKey;
    return `<a href="${it.href}" class="shg-nav-item${inGroup ? ' shg-nav-sub' : ''}${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>
        <span class="shg-nav-ico"><i class="fas ${it.icon}"></i></span>
        <span class="shg-nav-label">${it.label}</span>
      </a>`;
  };

  const groupMap = new Map(NAV_GROUPS.map((g) => [g.key, g]));
  const parts: string[] = [];
  const rendered = new Set<string>();

  for (const it of NAV_ITEMS) {
    if (!it.group) {
      parts.push(itemLink(it, false));
      continue;
    }
    // Render the whole group once, at the position of its first member.
    if (rendered.has(it.group)) continue;
    rendered.add(it.group);
    const g = groupMap.get(it.group);
    if (!g) { parts.push(itemLink(it, false)); continue; }
    const members = NAV_ITEMS.filter((m) => m.group === it.group);
    const hasActive = members.some((m) => m.key === activeKey);
    // A group starts OPEN when it contains the active page, else closed.
    parts.push(
      `<div class="shg-nav-group${hasActive ? ' open' : ''}" data-group="${g.key}">
        <button type="button" class="shg-nav-grouphead" aria-expanded="${hasActive ? 'true' : 'false'}">
          <span class="shg-nav-ico"><i class="fas ${g.icon}"></i></span>
          <span class="shg-nav-label">${g.label}</span>
          <i class="fas fa-chevron-down shg-nav-caret"></i>
        </button>
        <div class="shg-nav-groupbody">
          ${members.map((m) => itemLink(m, true)).join('\n          ')}
        </div>
      </div>`
    );
  }
  const items = parts.join('\n      ');

  return `
  <style>
    :root{ --shg-navy:#0B3C5D; --shg-navy-2:#0e4a72; }
    .shg-nav{
      position:fixed; top:0; right:0; height:100vh; width:264px; z-index:9000;
      background:#ffffff; box-shadow:-2px 0 14px rgba(15,30,50,.12);
      display:flex; flex-direction:column;
      transform:translateX(0); transition:transform .25s ease;
      font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
    }
    .shg-nav.collapsed{ transform:translateX(100%); }
    .shg-nav-head{
      background:var(--shg-navy); color:#fff; height:64px; flex:none;
      display:flex; align-items:center; gap:10px; padding:0 14px;
    }
    .shg-nav-head .brand{
      background:#fff; color:var(--shg-navy); font-weight:800; letter-spacing:.02em;
      border-radius:8px; padding:6px 12px; font-size:13px; display:flex; align-items:center; gap:8px;
    }
    .shg-nav-head .brand i{ color:#0B3C5D; }
    .shg-burger{
      background:transparent; border:0; color:#fff; font-size:20px; cursor:pointer;
      width:34px; height:34px; border-radius:6px; display:flex; align-items:center; justify-content:center;
    }
    .shg-burger:hover{ background:rgba(255,255,255,.12); }
    .shg-nav-body{ overflow-y:auto; flex:1; }
    .shg-nav-item{
      display:flex; align-items:center; gap:12px; padding:13px 16px 13px 18px;
      border-bottom:1px solid #eef1f4; color:#243b53; text-decoration:none;
      font-size:14px; font-weight:600; position:relative; transition:background .12s;
    }
    .shg-nav-item:hover{ background:#f4f7fa; }
    .shg-nav-item.active{ background:#eaf1f7; color:var(--shg-navy); }
    .shg-nav-item.active::before{
      content:""; position:absolute; left:0; top:0; bottom:0; width:5px; background:var(--shg-navy);
    }
    .shg-nav-ico{
      width:34px; height:34px; border-radius:9px; background:#f1f3f6; color:#41576e;
      display:flex; align-items:center; justify-content:center; font-size:15px; flex:none;
    }
    .shg-nav-item.active .shg-nav-ico{ background:#dbe7f1; color:var(--shg-navy); }
    .shg-nav-label{ line-height:1.15; }
    /* ---- Collapsible category groups (Distribution, Sales) ---- */
    .shg-nav-group{ border-bottom:1px solid #eef1f4; }
    .shg-nav-grouphead{
      width:100%; display:flex; align-items:center; gap:12px;
      padding:13px 16px 13px 18px; border:0; background:transparent; cursor:pointer;
      color:#243b53; font-size:14px; font-weight:700; text-align:left;
      font-family:inherit; transition:background .12s;
    }
    .shg-nav-grouphead:hover{ background:#f4f7fa; }
    .shg-nav-caret{ margin-left:auto; font-size:12px; color:#7c8da0; transition:transform .2s ease; }
    .shg-nav-group.open > .shg-nav-grouphead .shg-nav-caret{ transform:rotate(180deg); }
    .shg-nav-groupbody{
      display:none; background:#f8fafc;
      border-top:1px solid #eef1f4;
    }
    .shg-nav-group.open > .shg-nav-groupbody{ display:block; }
    /* indented sub-items so the hierarchy reads clearly */
    .shg-nav-item.shg-nav-sub{ padding-left:30px; font-weight:600; }
    .shg-nav-item.shg-nav-sub .shg-nav-ico{ width:28px; height:28px; font-size:13px; border-radius:8px; }
    .shg-nav-item.shg-nav-sub:last-child{ border-bottom:0; }
    /* highlight the group header when one of its children is active */
    .shg-nav-group.open > .shg-nav-grouphead{ color:var(--shg-navy); }
    /* Floating opener shown when the sidebar is collapsed */
    .shg-nav-open{
      position:fixed; top:14px; right:14px; z-index:9001;
      background:var(--shg-navy); color:#fff; border:0; cursor:pointer;
      width:44px; height:44px; border-radius:10px; font-size:18px;
      box-shadow:0 2px 8px rgba(15,30,50,.25); display:none;
      align-items:center; justify-content:center;
    }
    .shg-nav-open.show{ display:flex; }
    /* Reserve space so page content isn't hidden behind the sidebar on wide screens */
    @media (min-width:1024px){
      body.shg-has-nav{ padding-right:264px; }
      body.shg-has-nav.shg-nav-collapsed{ padding-right:0; }
    }
    @media (max-width:1023px){
      .shg-nav{ width:82vw; max-width:320px; }
      body.shg-has-nav{ padding-right:0; }
    }
  </style>

  <button id="shgNavOpen" class="shg-nav-open" title="Open dashboards menu" aria-label="Open menu">
    <i class="fas fa-bars"></i>
  </button>

  <nav id="shgNav" class="shg-nav" aria-label="Dashboards">
    <div class="shg-nav-head">
      <button id="shgNavClose" class="shg-burger" title="Hide menu" aria-label="Hide menu"><i class="fas fa-bars"></i></button>
      <span class="brand"><i class="fas fa-broom"></i> HEIFER SHG</span>
    </div>
    <div class="shg-nav-body">
      ${items}
    </div>
  </nav>

  <script>
    (function(){
      var body = document.body;
      body.classList.add('shg-has-nav');
      var nav  = document.getElementById('shgNav');
      var open = document.getElementById('shgNavOpen');
      var close= document.getElementById('shgNavClose');
      function setCollapsed(c){
        nav.classList.toggle('collapsed', c);
        open.classList.toggle('show', c);
        body.classList.toggle('shg-nav-collapsed', c);
        try{ localStorage.setItem('shgNavCollapsed', c ? '1':'0'); }catch(e){}
      }
      // Restore prior state; default open on desktop, collapsed on narrow screens.
      var saved = null; try{ saved = localStorage.getItem('shgNavCollapsed'); }catch(e){}
      var startCollapsed = saved === '1' || (saved === null && window.innerWidth < 1024);
      setCollapsed(startCollapsed);
      close.addEventListener('click', function(){ setCollapsed(true); });
      open.addEventListener('click',  function(){ setCollapsed(false); });

      // Collapsible category groups (Distribution, Sales). A group is open by
      // default when it holds the active page; the user can toggle any group,
      // and the open/closed state per group is remembered.
      var groups = nav.querySelectorAll('.shg-nav-group');
      Array.prototype.forEach.call(groups, function(grp){
        var gid = grp.getAttribute('data-group');
        var head = grp.querySelector('.shg-nav-grouphead');
        // Restore saved state (falls back to the server-rendered default).
        try{
          var s = localStorage.getItem('shgNavGrp:'+gid);
          if(s==='1') grp.classList.add('open');
          else if(s==='0') grp.classList.remove('open');
        }catch(e){}
        head.setAttribute('aria-expanded', grp.classList.contains('open') ? 'true':'false');
        head.addEventListener('click', function(){
          var isOpen = grp.classList.toggle('open');
          head.setAttribute('aria-expanded', isOpen ? 'true':'false');
          try{ localStorage.setItem('shgNavGrp:'+gid, isOpen ? '1':'0'); }catch(e){}
        });
      });
    })();
  </script>`;
}
