// ---------------------------------------------------------------------------
// Cluster → district mapping (single source of truth for all report pages).
// District names are stored UPPER-CASED in the fact tables, so we match on
// upper-cased values. A cluster's `districts` are the raw district labels; the
// dashboards upper() both sides when filtering.
// ---------------------------------------------------------------------------

export interface Cluster {
  key: string;
  label: string;
  districts: string[]; // district names (any case); matched case-insensitively
}

export const CLUSTERS: Cluster[] = [
  { key: 'iganga',  label: 'Iganga Cluster',  districts: ['IGANGA', 'JINJA', 'JINJA CITY', 'MAYUGE', 'LUUKA'] },
  { key: 'kamuli',  label: 'Kamuli Cluster',  districts: ['KAMULI', 'KALIRO', 'BUYENDE'] },
  { key: 'bugiri',  label: 'Bugiri Cluster',  districts: ['BUGIRI', 'NAMUTUMBA', 'NAMAYINGO', 'BUGWERI'] },
  { key: 'central', label: 'Central Cluster', districts: ['MUKONO', 'BUIKWE', 'KAYUNGA'] },
];

/** Return the UPPER-cased district list for a cluster key (empty = all). */
export function clusterDistricts(key: string | undefined | null): string[] {
  if (!key || key === 'all') return [];
  const c = CLUSTERS.find((x) => x.key === key);
  return c ? c.districts.map((d) => d.toUpperCase()) : [];
}

/** HTML <option> list for a cluster <select> (includes "All clusters"). */
export function clusterOptions(selected?: string): string {
  const opts = [`<option value="all"${!selected || selected === 'all' ? ' selected' : ''}>All clusters</option>`];
  for (const c of CLUSTERS) {
    opts.push(`<option value="${c.key}"${selected === c.key ? ' selected' : ''}>${c.label}</option>`);
  }
  return opts.join('');
}
