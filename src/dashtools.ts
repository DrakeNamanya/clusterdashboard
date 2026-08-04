// ---------------------------------------------------------------------------
// Shared dashboard table tools: per-column click-sort, Export-to-Excel and
// Print — all operating on the RENDERED DOM table, so they automatically act
// on exactly what the current filters/slicers have produced ("only export /
// print what has been filtered").
//
// Usage in a dashboard page:
//   1. Put `${dashToolsAssets()}` once inside <head> (adds styles) OR anywhere
//      in the body (it is a <style>+<script> blob; safe anywhere before use).
//   2. Add a toolbar button, e.g.
//        <button id="btnExcel" ...>Export Excel</button>
//        <button id="btnPrint" ...>Print</button>
//      and wire:
//        DashTools.wireExcel('btnExcel', '#tbl', 'ISLA');
//        DashTools.wirePrint('btnPrint', '#tbl', 'SHGs Saving (ISLA)');
//   3. Make every column header sortable AFTER each table (re)render:
//        DashTools.makeSortable('#tbl');
//      (Call it at the end of your renderTable(); it is idempotent.)
//
// The sort is a pure DOM reorder of <tbody> <tr> rows: first click sorts
// ascending, second toggles descending. It skips rows flagged .total-row / with
// data-nosort so summary rows stay pinned at the bottom. It auto-detects number
// vs text per column. No dependency on each dashboard's data model.
// ---------------------------------------------------------------------------

export function dashToolsAssets(): string {
  return `
  <style>
    .dt-btn{ font-size:12px; padding:6px 11px; border-radius:8px; border:1px solid var(--line,#d9e2e3);
             background:#fff; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-weight:700;
             color:#28343a; transition:.15s; }
    .dt-btn:hover{ filter:brightness(.97); background:#f4f7f7; }
    .dt-btn.excel{ background:#1d6f42; color:#fff; border-color:#1d6f42; }
    .dt-btn.print{ background:#2b5797; color:#fff; border-color:#2b5797; }
    .dt-btn:disabled{ opacity:.55; cursor:not-allowed; }
    th.dt-sortable{ cursor:pointer; user-select:none; }
    th.dt-sortable:hover{ filter:brightness(1.12); }
    th.dt-sortable .dt-arrow{ font-size:9px; margin-left:4px; opacity:.85; }
    @media print{
      body > *:not(#dt-print-root){ display:none !important; }
      #dt-print-root{ display:block !important; }
    }
    #dt-print-root{ display:none; }
  </style>
  <div id="dt-print-root"></div>
  <script>
  (function(){
    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function tableEl(sel){ return typeof sel==='string' ? document.querySelector(sel) : sel; }

    // Serialize a rendered table to an Excel-openable .xls (MSO HTML). Only the
    // currently-rendered rows (i.e. the filtered result) are included.
    function tableToXls(tbl, title){
      var clone = tbl.cloneNode(true);
      // strip the sort arrows so they don't pollute cells
      clone.querySelectorAll('.dt-arrow').forEach(function(a){ a.remove(); });
      var head = title ? '<h3 style="color:#006837">'+esc(title)+'</h3>' : '';
      return '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
        + 'xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">'
        + '<head><meta charset="utf-8">'
        + '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>'
        + '<x:Name>'+esc((title||'Data').slice(0,28))+'</x:Name>'
        + '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>'
        + '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->'
        + '<style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}'
        + 'th{background:#dbeadb;font-weight:bold;text-align:left}</style></head>'
        + '<body>'+head+clone.outerHTML+'</body></html>';
    }

    function downloadBlob(content, mime, name){
      var blob = new Blob([content], { type: mime });
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1500);
    }

    function today(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

    var DashTools = {
      exportExcel: function(sel, title){
        var tbl = tableEl(sel); if(!tbl) return;
        var fname = (title||'export').replace(/[^A-Za-z0-9]+/g,'_') + '_' + today() + '.xls';
        downloadBlob(tableToXls(tbl, title), 'application/vnd.ms-excel', fname);
      },
      print: function(sel, title){
        var tbl = tableEl(sel); if(!tbl) return;
        var root = document.getElementById('dt-print-root');
        var clone = tbl.cloneNode(true);
        clone.querySelectorAll('.dt-arrow').forEach(function(a){ a.remove(); });
        root.innerHTML =
          '<h2 style="font-family:Segoe UI,system-ui,sans-serif;color:#006837;margin:0 0 4px">'+esc(title||'Report')+'</h2>'
          + '<div style="font-family:Segoe UI,sans-serif;font-size:11px;color:#666;margin:0 0 10px">Generated '+today()+' — filtered view</div>'
          + '<style>#dt-print-root table{border-collapse:collapse;width:100%;font-family:Segoe UI,sans-serif;font-size:11px}'
          + '#dt-print-root td,#dt-print-root th{border:1px solid #bbb;padding:4px 7px;text-align:left}'
          + '#dt-print-root th{background:#2f5d6b;color:#fff}</style>'
          + clone.outerHTML;
        var prev = document.title;
        document.title = (title||'Report') + ' ' + today();
        window.print();
        setTimeout(function(){ document.title = prev; root.innerHTML=''; }, 800);
      },
      wireExcel: function(btnId, sel, title){ var b=document.getElementById(btnId); if(b) b.addEventListener('click', function(){ DashTools.exportExcel(sel, title); }); },
      wirePrint: function(btnId, sel, title){ var b=document.getElementById(btnId); if(b) b.addEventListener('click', function(){ DashTools.print(sel, title); }); },

      // Make every <thead> header of a table click-sortable (DOM reorder).
      makeSortable: function(sel){
        var tbl = tableEl(sel); if(!tbl) return;
        var head = tbl.tHead; if(!head) return;
        // Use the LAST header row (grouped tables put real column labels there).
        var hr = head.rows[head.rows.length-1]; if(!hr) return;
        Array.prototype.forEach.call(hr.cells, function(th, idx){
          if (th.getAttribute('data-nosort') === '1') return;
          if (th.__dtWired) { return; }
          th.__dtWired = true;
          th.classList.add('dt-sortable');
          if (!th.querySelector('.dt-arrow')){
            var s=document.createElement('span'); s.className='dt-arrow'; th.appendChild(s);
          }
          th.addEventListener('click', function(){
            var asc = th.__dtAsc = !th.__dtAsc;
            // clear other arrows
            Array.prototype.forEach.call(hr.cells, function(o){ var a=o.querySelector('.dt-arrow'); if(a && o!==th){ a.textContent=''; o.__dtAsc=undefined; } });
            var a=th.querySelector('.dt-arrow'); if(a) a.textContent = asc ? '▲' : '▼';
            DashTools.sortByColumn(tbl, idx, asc);
          });
        });
      },

      sortByColumn: function(tbl, colIdx, asc){
        var body = tbl.tBodies[0]; if(!body) return;
        var rows = Array.prototype.slice.call(body.rows);
        // keep pinned rows (totals) at the bottom, in original order
        var pinned = [], data = [];
        rows.forEach(function(r){
          if (r.classList.contains('total-row') || r.getAttribute('data-nosort')==='1' || r.getAttribute('data-pin')==='bottom') pinned.push(r);
          else data.push(r);
        });
        var cellText = function(r){
          var c = r.cells[colIdx]; if(!c) return '';
          return (c.getAttribute('data-sort') != null) ? c.getAttribute('data-sort') : c.textContent.trim();
        };
        var toNum = function(t){ var n = parseFloat(String(t).replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n; };
        // decide numeric if the majority of non-empty cells parse as numbers
        var numeric = 0, nonEmpty = 0;
        data.forEach(function(r){ var t=cellText(r); if(t!==''){ nonEmpty++; if(toNum(t)!=null) numeric++; } });
        var isNum = nonEmpty>0 && numeric >= nonEmpty*0.6;
        data.sort(function(a,b){
          var ta=cellText(a), tb=cellText(b);
          if (isNum){ var na=toNum(ta), nb=toNum(tb); na=(na==null?-Infinity:na); nb=(nb==null?-Infinity:nb); return asc ? na-nb : nb-na; }
          return asc ? String(ta).localeCompare(String(tb)) : String(tb).localeCompare(String(ta));
        });
        data.forEach(function(r){ body.appendChild(r); });
        pinned.forEach(function(r){ body.appendChild(r); });
      }
    };
    window.DashTools = DashTools;
  })();
  </script>`;
}
