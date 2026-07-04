// ---------------------------------------------------------------------------
// Frontend HTML (single page). Uses Tailwind + Font Awesome via CDN.
// ---------------------------------------------------------------------------

export function renderPage(base: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SHG Data Cleaner &amp; Power BI Feed</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <link href="/static/style.css" rel="stylesheet" />
</head>
<body class="bg-slate-100 text-slate-800">
  <header class="bg-slate-900 text-white">
    <div class="max-w-7xl mx-auto px-6 py-5 flex items-center gap-3">
      <i class="fas fa-broom text-2xl text-emerald-400"></i>
      <div class="flex-1">
        <h1 class="text-xl font-bold">SHG Data Cleaner &amp; Consolidator</h1>
        <p class="text-slate-300 text-sm">Clean &amp; standardize sheets, append to master tables, publish an OData feed for Power BI.</p>
      </div>
      <a href="/cluster-trainings" class="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold">
        <i class="fas fa-chart-simple"></i> Cluster Trainings
      </a>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">

    <!-- Upload -->
    <section id="upload-section" class="bg-white rounded-xl shadow p-6">
      <h2 class="text-lg font-semibold mb-4"><i class="fas fa-upload text-emerald-500 mr-2"></i>Upload a sheet</h2>
      <div id="dropzone" class="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-emerald-400 transition">
        <i class="fas fa-file-csv text-4xl text-slate-400 mb-3"></i>
        <p class="text-slate-600">Drag &amp; drop a CSV/XLSX file here, or <span class="text-emerald-600 font-semibold">browse</span></p>
        <p class="text-xs text-slate-400 mt-1">Supported templates: shg_groups_view, all_trainees_view, agrihubs, distribution_form_v2, participants_shg, shg_group</p>
        <input id="fileInput" type="file" accept=".csv,.xlsx,.xls,text/csv,text/plain" class="hidden" />
      </div>
      <div id="fileMeta" class="hidden mt-4 text-sm"></div>
      <div id="detectResult" class="hidden mt-4"></div>
      <div id="uploadActions" class="hidden mt-4 flex gap-3">
        <button id="confirmBtn" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg font-semibold">
          <i class="fas fa-database mr-1"></i> Clean &amp; Append to Master
        </button>
        <button id="cancelBtn" class="bg-slate-200 hover:bg-slate-300 px-5 py-2 rounded-lg">Cancel</button>
      </div>
      <div id="uploadStatus" class="hidden mt-4"></div>
    </section>

    <!-- Master tables -->
    <section class="bg-white rounded-xl shadow p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold"><i class="fas fa-table text-emerald-500 mr-2"></i>Master tables</h2>
        <div class="flex items-center gap-4">
          <button id="backfillBtn" class="text-sm text-indigo-600 hover:underline" title="Fill any empty docId columns from __Submissions-id / unique_id on existing rows"><i class="fas fa-wand-magic-sparkles mr-1"></i>Fill docId</button>
          <button id="refreshBtn" class="text-sm text-emerald-600 hover:underline"><i class="fas fa-rotate mr-1"></i>Refresh</button>
        </div>
      </div>
      <div id="backfillStatus" class="hidden mb-3 text-sm"></div>
      <div id="statsGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
    </section>

    <!-- OData feed info -->
    <section class="bg-white rounded-xl shadow p-6">
      <h2 class="text-lg font-semibold mb-3"><i class="fas fa-plug text-emerald-500 mr-2"></i>Power BI / OData feed</h2>
      <p class="text-sm text-slate-600 mb-3">In Power BI Desktop: <b>Get Data &rarr; OData feed</b>, then paste the service URL below. All master tables appear as selectable entity sets and refresh automatically.</p>
      <div class="space-y-2 text-sm">
        <div class="flex items-center gap-2">
          <span class="font-semibold w-40">Service URL</span>
          <code id="odataService" class="flex-1 bg-slate-100 px-3 py-2 rounded break-all"></code>
          <button class="copyBtn text-emerald-600" data-target="odataService"><i class="fas fa-copy"></i></button>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-semibold w-40">Metadata ($metadata)</span>
          <code id="odataMeta" class="flex-1 bg-slate-100 px-3 py-2 rounded break-all"></code>
          <button class="copyBtn text-emerald-600" data-target="odataMeta"><i class="fas fa-copy"></i></button>
        </div>
      </div>
    </section>

    <!-- Data preview -->
    <section id="previewSection" class="bg-white rounded-xl shadow p-6 hidden">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-semibold"><i class="fas fa-eye text-emerald-500 mr-2"></i><span id="previewTitle">Preview</span></h2>
        <button id="closePreview" class="text-slate-400 hover:text-slate-700"><i class="fas fa-times"></i></button>
      </div>
      <div class="overflow-auto max-h-[500px] border rounded">
        <table class="text-xs w-full"><thead id="previewHead" class="bg-slate-100 sticky top-0"></thead><tbody id="previewBody"></tbody></table>
      </div>
    </section>
  </main>

  <footer class="text-center text-xs text-slate-400 py-6">SHG Data Cleaner &bull; Cloudflare Pages + Hono + D1 &bull; OData v4 feed for Power BI</footer>

  <script>window.__BASE__ = ${JSON.stringify(base)};</script>
  <script src="/static/app.js"></script>
</body>
</html>`;
}
