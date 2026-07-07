// ---------------------------------------------------------------------------
// Inbound OData import: pull rows FROM an external OData feed (with HTTP Basic
// auth) and ingest them into a master table.
//
// Cloudflare Workers have tight CPU/time limits, so we fetch ONE page per
// request. The browser drives the loop: it calls the import route repeatedly,
// passing the returned `skip` back until `done` is true. Each page is cleaned
// and appended (append-only, dedup) exactly like an uploaded file.
// ---------------------------------------------------------------------------

import type { SheetSchema } from './schemas';

export interface OdataSource {
  /** Base data URL of the entity set (without $top/$skip). */
  url: string;
  /** Basic-auth username. */
  user: string;
  /** Basic-auth password. */
  pass: string;
}

export interface OdataPage {
  /** Column names (union of keys across the page, minus @odata.* control keys). */
  headers: string[];
  /** Row values aligned to `headers`. */
  rows: string[][];
  /** Total row count reported by the feed (`@odata.count`), if available. */
  total: number | null;
  /** True when there are no more rows after this page. */
  done: boolean;
}

/** Registry of external OData sources keyed by schema key. */
export const ODATA_SOURCES: Record<
  string,
  { url: string; userEnv: string; passEnv: string }
> = {
  shg_profiling_form: {
    url:
      'https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view/' +
      'shg_profiling_form_odata_view/shg_profiling_form_odata_view',
    userEnv: 'ODATA_PROFILING_USER',
    passEnv: 'ODATA_PROFILING_PASS',
  },
  // ISLA masters — same Heifer OData gateway, same basic-auth credentials.
  isla_form: {
    url:
      'https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view/' +
      'isla_form_odata_view/isla_form_odata_view',
    userEnv: 'ODATA_PROFILING_USER',
    passEnv: 'ODATA_PROFILING_PASS',
  },
  isla_participants: {
    url:
      'https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view/' +
      'isla_form.shg_participants_odata_view/isla_form.shg_participants_odata_view',
    userEnv: 'ODATA_PROFILING_USER',
    passEnv: 'ODATA_PROFILING_PASS',
  },
  participants: {
    url:
      'https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view/' +
      'participants_odata_view/participants_odata_view',
    userEnv: 'ODATA_PROFILING_USER',
    passEnv: 'ODATA_PROFILING_PASS',
  },
  youth_profiling: {
    url:
      'https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view/' +
      'youth_profiling_form_odata_view/youth_profiling_form_odata_view',
    userEnv: 'ODATA_PROFILING_USER',
    passEnv: 'ODATA_PROFILING_PASS',
  },
};

function basicAuth(user: string, pass: string): string {
  // btoa is available in the Workers runtime.
  return 'Basic ' + btoa(`${user}:${pass}`);
}

function isControlKey(k: string): boolean {
  return k.startsWith('@') || k === '@odata.etag';
}

/**
 * Fetch a single page of the external feed starting at `skip`.
 * Returns headers+rows shaped for `cleanRecords`, plus pagination info.
 */
export async function fetchOdataPage(
  src: OdataSource,
  skip: number,
  top: number
): Promise<OdataPage> {
  const u = new URL(src.url);
  u.searchParams.set('$top', String(top));
  u.searchParams.set('$skip', String(skip));
  if (skip === 0) u.searchParams.set('$count', 'true');

  const resp = await fetch(u.toString(), {
    headers: {
      Authorization: basicAuth(src.user, src.pass),
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (SHG-Data-Cleaner OData importer)',
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `OData feed responded ${resp.status} ${resp.statusText}` +
        (body ? `: ${body.slice(0, 300)}` : '')
    );
  }

  const doc: any = await resp.json();
  const value: any[] = Array.isArray(doc?.value) ? doc.value : [];
  const total =
    typeof doc?.['@odata.count'] === 'number' ? doc['@odata.count'] : null;

  // Build a stable header list: union of all non-control keys in page order.
  const headerSet: string[] = [];
  const seen = new Set<string>();
  for (const rec of value) {
    for (const k of Object.keys(rec)) {
      if (isControlKey(k)) continue;
      if (!seen.has(k)) {
        seen.add(k);
        headerSet.push(k);
      }
    }
  }

  const rows: string[][] = value.map((rec) =>
    headerSet.map((h) => {
      const v = rec[h];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    })
  );

  // Done when the feed returns no next link, OR when we got fewer than a full page.
  const hasNext = typeof doc?.['@odata.nextLink'] === 'string' && value.length > 0;
  const done = !hasNext || value.length < top;

  return { headers: headerSet, rows, total, done };
}

/** Resolve the configured source for a schema, reading creds from the Worker env. */
export function resolveSource(
  schema: SheetSchema,
  env: Record<string, string | undefined>
): OdataSource | null {
  const cfg = ODATA_SOURCES[schema.key];
  if (!cfg) return null;
  const user = env[cfg.userEnv];
  const pass = env[cfg.passEnv];
  if (!user || !pass) {
    throw new Error(
      `OData credentials are not configured (${cfg.userEnv} / ${cfg.passEnv} missing).`
    );
  }
  return { url: cfg.url, user, pass };
}
