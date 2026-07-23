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
}

// The single source of truth for the dashboard menu. Order matches the header
// we had before, with Home first.
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', href: '/', label: 'Home', icon: 'fa-house' },
  { key: 'cluster', href: '/cluster-trainings', label: 'Cluster Trainings', icon: 'fa-chart-simple' },
  { key: 'newyouth', href: '/monthly-new-youth', label: 'Monthly New Youth', icon: 'fa-user-plus' },
  { key: 'frontliners', href: '/frontliners', label: 'Trainings by Frontliners', icon: 'fa-table' },
  { key: 'distribution', href: '/distribution', label: 'Distribution to Participants', icon: 'fa-boxes-stacked' },
  { key: 'shgdistribution', href: '/shg-distribution', label: 'Distribution to SHGs', icon: 'fa-people-group' },
  { key: 'shgprofiling', href: '/shg-profiling', label: 'SHG Profiling', icon: 'fa-address-card' },
  { key: 'isla', href: '/isla', label: 'ISLA Savings', icon: 'fa-piggy-bank' },
  { key: 'production', href: '/production', label: 'Production (Horticulture)', icon: 'fa-seedling' },
  { key: 'sales', href: '/sales', label: 'Sales (Horticulture/Oilseeds)', icon: 'fa-sack-dollar' },
  { key: 'tools', href: '/tools', label: 'Data Tools & OData', icon: 'fa-broom' },
];

// CSS + toggle script for the sidebar. Include ONCE per page (navSidebar puts
// it inline for simplicity). The sidebar is fixed on the right; the page body
// gets right padding so content is not hidden behind it on wide screens.
export function navSidebar(activeKey: string): string {
  const items = NAV_ITEMS.map((it) => {
    const active = it.key === activeKey;
    return `<a href="${it.href}" class="shg-nav-item${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>
        <span class="shg-nav-ico"><i class="fas ${it.icon}"></i></span>
        <span class="shg-nav-label">${it.label}</span>
      </a>`;
  }).join('\n      ');

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
    })();
  </script>`;
}
