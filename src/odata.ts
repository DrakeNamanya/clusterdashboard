// ---------------------------------------------------------------------------
// Minimal OData v4 layer compatible with Power BI's OData feed connector.
// - Service document:      GET /odata/
// - Metadata document:     GET /odata/$metadata
// - Entity set (feed):     GET /odata/<EntitySet>?$top&$skip&$orderby
// Power BI's "OData feed" connector needs the service doc + $metadata + JSON
// value arrays with @odata.context. We expose one entity set per template.
// ---------------------------------------------------------------------------

import { SCHEMAS, SheetSchema, ColType } from './schemas';

/** OData entity set name for a schema (must be a valid identifier). */
export function entitySetName(schema: SheetSchema): string {
  return schema.key; // already safe: letters/underscores/digits
}

/** Map our column type to an EDM type. */
function edmType(t: ColType): string {
  switch (t) {
    case 'int': return 'Edm.Int64';
    case 'number': return 'Edm.Double';
    case 'seq': return 'Edm.Int64';
    // Dates standardized to ISO strings, but keep as String so Power BI can
    // parse without timezone surprises; users can set type in PBI if desired.
    default: return 'Edm.String';
  }
}

/** Sanitize a target column name into a valid OData/EDM property name. */
export function edmProp(name: string): string {
  let p = name
    .replace(/@odata_navigationLink/gi, '_navLink')
    .replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(p)) p = '_' + p;
  return p;
}

/** Build a map target column name -> EDM property name for a schema. */
export function edmPropMap(schema: SheetSchema): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};
  for (const c of schema.columns) {
    let p = edmProp(c.name);
    let base = p, k = 2;
    while (used.has(p)) { p = `${base}_${k++}`; }
    used.add(p);
    map[c.name] = p;
  }
  return map;
}

/** OData service document (JSON). */
export function serviceDocument(baseUrl: string): object {
  return {
    '@odata.context': `${baseUrl}/odata/$metadata`,
    value: SCHEMAS.map((s) => ({
      name: entitySetName(s),
      kind: 'EntitySet',
      url: entitySetName(s),
    })),
  };
}

/** OData CSDL XML metadata document ($metadata). */
export function metadataDocument(): string {
  const entityTypes = SCHEMAS.map((s) => {
    const pmap = edmPropMap(s);
    const props = s.columns
      .map((c) => `        <Property Name="${pmap[c.name]}" Type="${edmType(c.type)}" />`)
      .join('\n');
    return `      <EntityType Name="${s.key}_type">
        <Key><PropertyRef Name="_rowid" /></Key>
        <Property Name="_rowid" Type="Edm.String" Nullable="false" />
${props}
      </EntityType>`;
  }).join('\n');

  const entitySets = SCHEMAS.map(
    (s) => `        <EntitySet Name="${entitySetName(s)}" EntityType="Default.${s.key}_type" />`
  ).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Default" xmlns="http://docs.oasis-open.org/odata/ns/edm">
${entityTypes}
      <EntityContainer Name="Container">
${entitySets}
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;
}

/** Wrap rows into an OData entity-set JSON response. */
export function entitySetResponse(
  baseUrl: string,
  schema: SheetSchema,
  rows: Record<string, string>[],
  totalCount: number,
  includeCount: boolean,
  nextLink?: string
): object {
  const pmap = edmPropMap(schema);
  const value = rows.map((r, i) => {
    const o: Record<string, unknown> = { _rowid: r[schema.dedupKey] || String(i) };
    for (const c of schema.columns) {
      let v: unknown = r[c.name] ?? '';
      if ((c.type === 'int' || c.type === 'seq') && v !== '') v = Number(v);
      else if (c.type === 'number' && v !== '') v = Number(v);
      o[pmap[c.name]] = v === '' ? null : v;
    }
    return o;
  });
  const body: Record<string, unknown> = {
    '@odata.context': `${baseUrl}/odata/$metadata#${entitySetName(schema)}`,
    value,
  };
  if (includeCount) body['@odata.count'] = totalCount;
  if (nextLink) body['@odata.nextLink'] = nextLink;
  return body;
}
