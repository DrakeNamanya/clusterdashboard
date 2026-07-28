// ---------------------------------------------------------------------------
// Server-side Programme Report .docx generator.
//
// The browser JSZip path could not reliably re-zip the 4.18 MB template
// (3.9 MB of media forces a full DEFLATE recompression that stalls in the
// browser), so the tables/narratives never made it into the downloaded file.
//
// This module runs inside the Cloudflare Worker: it fetches the template,
// string-replaces every {{token}} in word/document.xml (tables + KPI summary +
// narrative paragraphs + meta labels), then re-zips with fflate copying every
// media entry as STORED (no recompression) so only document.xml changes.
// The result is a valid .docx returned as an attachment.
// ---------------------------------------------------------------------------
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

// ---- formatting helpers ------------------------------------------------------
const nf = (n: number) => Math.round(Number(n || 0)).toLocaleString('en-US');
const money = (n: number) => 'UGX ' + Math.round(Number(n || 0)).toLocaleString('en-US');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(d?: string): string {
  if (!d) return '';
  const parts = d.split('-');
  const mi = Number(parts[1]) - 1;
  return (mi >= 0 && mi < 12) ? MONTHS[mi] : '';
}
function monthLabel(d?: string): string {
  if (!d) return '';
  const parts = d.split('-');
  const mi = Number(parts[1]) - 1;
  const nm = (mi >= 0 && mi < 12) ? MONTHS[mi] : '';
  return nm ? nm + ' ' + parts[0] : d;
}
function quarterLabel(from?: string, to?: string): string {
  if (!from || !to) return '';
  return monthLabel(from) + ' – ' + monthLabel(to);
}

// cluster → the four template slots (iganga/jinja/mayuge/luuka in order)
export const CLUSTER_DISTRICTS: Record<string, string[]> = {
  all:     ['IGANGA', 'JINJA', 'MAYUGE', 'LUUKA'],
  iganga:  ['IGANGA', 'JINJA', 'MAYUGE', 'LUUKA'],
  kamuli:  ['KAMULI', 'KALIRO', 'BUYENDE'],
  bugiri:  ['BUGIRI', 'NAMAYINGO', 'MAYUGE'],
  central: ['KAMPALA', 'WAKISO', 'MUKONO'],
};

const slotKeys = ['iganga', 'jinja', 'mayuge', 'luuka'];

function cell(map: any, district: string, field: string): number {
  if (!map) return 0;
  const r = map[String(district || '').toUpperCase()];
  return r ? Number(r[field] || 0) : 0;
}

// ---------------------------------------------------------------------------
// Build the full token → value map (tables + KPI + narratives + meta).
// ---------------------------------------------------------------------------
export function buildTokens(data: any, clusterKey: string,
  mFrom?: string, qFrom?: string, qTo?: string): Record<string, string> {
  const T: Record<string, string> = {};
  const slots = CLUSTER_DISTRICTS[clusterKey] || CLUSTER_DISTRICTS.iganga;

  T['meta.month'] = monthLabel(mFrom);
  T['meta.monthname'] = monthName(mFrom);
  T['meta.quarter'] = quarterLabel(qFrom, qTo);

  // ---- training tables ----
  const trainKeys: Record<string, string> = {
    vbhcd: 'vbhcd', gender: 'gender', nutrition: 'nutrition', social: 'social',
    life: 'life', mental: 'mental', srh: 'srh', islatrain: 'isla',
  };
  Object.keys(trainKeys).forEach((tok) => {
    const src = data.training?.[trainKeys[tok]];
    if (!src) return;
    (['m', 'q'] as const).forEach((p) => {
      const map = p === 'm' ? src.month : src.quarter;
      const tot = { youth: 0, female: 0, pwd: 0 };
      slotKeys.forEach((sk, i) => {
        const du = slots[i];
        const y = du ? cell(map, du, 'youth') : 0;
        const f = du ? cell(map, du, 'female') : 0;
        const w = du ? cell(map, du, 'pwd') : 0;
        T[`${tok}.${p}.${sk}.youth`] = nf(y);
        T[`${tok}.${p}.${sk}.female`] = nf(f);
        T[`${tok}.${p}.${sk}.pwd`] = nf(w);
        tot.youth += y; tot.female += f; tot.pwd += w;
      });
      T[`${tok}.${p}.total.youth`] = nf(tot.youth);
      T[`${tok}.${p}.total.female`] = nf(tot.female);
      T[`${tok}.${p}.total.pwd`] = nf(tot.pwd);
    });
  });

  // aggregate holders for narrative derivation
  const agg: any = {
    prof: { m: {}, q: {} }, hort: { m: {}, q: {} },
    pdist: { m: {}, q: {} }, gdist: { m: {}, q: {} },
    psales: { m: {}, q: {} }, isla: { m: {}, q: {} },
  };

  // ---- profiling ----
  (['m', 'q'] as const).forEach((p) => {
    const map = p === 'm' ? data.profiling?.month : data.profiling?.quarter;
    const tot = { shgs: 0, youth: 0, female: 0, pwd: 0 };
    slotKeys.forEach((sk, i) => {
      const du = slots[i];
      const s = du ? cell(map, du, 'shgs') : 0, y = du ? cell(map, du, 'youth') : 0,
        f = du ? cell(map, du, 'female') : 0, w = du ? cell(map, du, 'pwd') : 0;
      T[`prof.${p}.${sk}.shgs`] = nf(s);
      T[`prof.${p}.${sk}.youth`] = nf(y);
      T[`prof.${p}.${sk}.female`] = nf(f);
      T[`prof.${p}.${sk}.pwd`] = nf(w);
      tot.shgs += s; tot.youth += y; tot.female += f; tot.pwd += w;
    });
    T[`prof.${p}.total.shgs`] = nf(tot.shgs);
    T[`prof.${p}.total.youth`] = nf(tot.youth);
    T[`prof.${p}.total.female`] = nf(tot.female);
    T[`prof.${p}.total.pwd`] = nf(tot.pwd);
    agg.prof[p] = tot;
  });

  // ---- horticulture ----
  (['m', 'q'] as const).forEach((p) => {
    const map = p === 'm' ? data.horticulture?.month : data.horticulture?.quarter;
    const tot = { tomatoes_kg: 0, watermelon_pcs: 0, sales: 0 };
    slotKeys.forEach((sk, i) => {
      const du = slots[i];
      const tk = du ? cell(map, du, 'tomatoes_kg') : 0, wm = du ? cell(map, du, 'watermelon_pcs') : 0, sl = du ? cell(map, du, 'sales') : 0;
      T[`hort.${p}.${sk}.tomatoes_kg`] = nf(tk);
      T[`hort.${p}.${sk}.watermelon_pcs`] = nf(wm);
      T[`hort.${p}.${sk}.sales`] = money(sl);
      tot.tomatoes_kg += tk; tot.watermelon_pcs += wm; tot.sales += sl;
    });
    T[`hort.${p}.total.tomatoes_kg`] = nf(tot.tomatoes_kg);
    T[`hort.${p}.total.watermelon_pcs`] = nf(tot.watermelon_pcs);
    T[`hort.${p}.total.sales`] = money(tot.sales);
    agg.hort[p] = tot;
  });

  // ---- poultry distribution ----
  (['m', 'q'] as const).forEach((p) => {
    const map = p === 'm' ? data.poultryDist?.month : data.poultryDist?.quarter;
    const tot = { animals: 0, shgs: 0, youth: 0 };
    slotKeys.forEach((sk, i) => {
      const du = slots[i];
      const a = du ? cell(map, du, 'animals') : 0, s = du ? cell(map, du, 'shgs') : 0, y = du ? cell(map, du, 'youth') : 0;
      T[`poultrydist.${p}.${sk}.animals`] = nf(a);
      T[`poultrydist.${p}.${sk}.shgs`] = nf(s);
      T[`poultrydist.${p}.${sk}.youth`] = nf(y);
      tot.animals += a; tot.shgs += s; tot.youth += y;
    });
    T[`poultrydist.${p}.total.animals`] = nf(tot.animals);
    T[`poultrydist.${p}.total.shgs`] = nf(tot.shgs);
    T[`poultrydist.${p}.total.youth`] = nf(tot.youth);
    agg.pdist[p] = tot;
  });

  // ---- goat distribution (Luuka + total only) ----
  (['m', 'q'] as const).forEach((p) => {
    const map = p === 'm' ? data.goatDist?.month : data.goatDist?.quarter;
    const tot = { animals: 0, shgs: 0, youth: 0 };
    slotKeys.forEach((sk, i) => {
      const du = slots[i];
      const a = du ? cell(map, du, 'animals') : 0, s = du ? cell(map, du, 'shgs') : 0, y = du ? cell(map, du, 'youth') : 0;
      tot.animals += a; tot.shgs += s; tot.youth += y;
      if (sk === 'luuka') {
        T[`goatdist.${p}.luuka.animals`] = nf(a);
        T[`goatdist.${p}.luuka.shgs`] = nf(s);
        T[`goatdist.${p}.luuka.youth`] = nf(y);
      }
    });
    T[`goatdist.${p}.total.animals`] = nf(tot.animals);
    T[`goatdist.${p}.total.shgs`] = nf(tot.shgs);
    T[`goatdist.${p}.total.youth`] = nf(tot.youth);
    agg.gdist[p] = tot;
  });

  // ---- poultry sales ----
  (['m', 'q'] as const).forEach((p) => {
    const map = p === 'm' ? data.poultrySales?.month : data.poultrySales?.quarter;
    const tot = { shgs: 0, youth: 0, birds: 0, amount: 0 };
    slotKeys.forEach((sk, i) => {
      const du = slots[i];
      const s = du ? cell(map, du, 'shgs') : 0, y = du ? cell(map, du, 'youth') : 0, b = du ? cell(map, du, 'birds') : 0, am = du ? cell(map, du, 'amount') : 0;
      T[`poultrysales.${p}.${sk}.shgs`] = nf(s);
      T[`poultrysales.${p}.${sk}.youth`] = nf(y);
      T[`poultrysales.${p}.${sk}.birds`] = nf(b);
      T[`poultrysales.${p}.${sk}.amount`] = money(am);
      tot.shgs += s; tot.youth += y; tot.birds += b; tot.amount += am;
    });
    T[`poultrysales.${p}.total.shgs`] = nf(tot.shgs);
    T[`poultrysales.${p}.total.youth`] = nf(tot.youth);
    T[`poultrysales.${p}.total.birds`] = nf(tot.birds);
    T[`poultrysales.${p}.total.amount`] = money(tot.amount);
    agg.psales[p] = tot;
  });

  // ---- poultry re-booking ----
  if (data.rebooking) {
    (['m', 'q'] as const).forEach((p) => {
      const map = p === 'm' ? data.rebooking.month : data.rebooking.quarter;
      const tot = { youth: 0, birds: 0 };
      slotKeys.forEach((sk, i) => {
        const du = slots[i];
        const y = du ? cell(map, du, 'youth') : 0, b = du ? cell(map, du, 'birds') : 0;
        T[`rebooking.${p}.${sk}.youth`] = nf(y);
        T[`rebooking.${p}.${sk}.birds`] = nf(b);
        tot.youth += y; tot.birds += b;
      });
      T[`rebooking.${p}.total.youth`] = nf(tot.youth);
      T[`rebooking.${p}.total.birds`] = nf(tot.birds);
    });
  }

  // ---- ISLA savings ----
  (['m', 'q'] as const).forEach((p) => {
    const map = p === 'm' ? data.isla?.month : data.isla?.quarter;
    const tot = { savers: 0, saved: 0, loans: 0 };
    slotKeys.forEach((sk, i) => {
      const du = slots[i];
      const sv = du ? cell(map, du, 'savers') : 0, sd = du ? cell(map, du, 'saved') : 0, ln = du ? cell(map, du, 'loans') : 0;
      T[`isla.${p}.${sk}.savers`] = nf(sv);
      T[`isla.${p}.${sk}.saved`] = money(sd);
      T[`isla.${p}.${sk}.loans`] = money(ln);
      tot.savers += sv; tot.saved += sd; tot.loans += ln;
    });
    T[`isla.${p}.total.savers`] = nf(tot.savers);
    T[`isla.${p}.total.saved`] = money(tot.saved);
    T[`isla.${p}.total.loans`] = money(tot.loans);
    agg.isla[p] = tot;
  });

  // ---- KPI summary (quarter cumulative) ----
  function sumField(block: any, field: string): number {
    const q = block?.quarter || {};
    let s = 0; Object.keys(q).forEach((k) => { s += Number(q[k][field] || 0); });
    return s;
  }
  const reachedQ = sumField(data.profiling, 'youth');
  const femaleQ = sumField(data.profiling, 'female');
  const pwdQ = sumField(data.profiling, 'pwd');
  const shgsQ = sumField(data.profiling, 'shgs');
  const hortProduce = sumField(data.horticulture, 'tomatoes_kg') + sumField(data.horticulture, 'watermelon_pcs');
  const hortSalesQ = sumField(data.horticulture, 'sales');
  const poultryProduce = sumField(data.poultryDist, 'animals');
  const poultrySalesQ = sumField(data.poultrySales, 'amount');
  const savedQ = sumField(data.isla, 'saved');
  const loansQ = sumField(data.isla, 'loans');
  const saversQ = sumField(data.isla, 'savers');
  const leverageQ = Number((data.leverage && data.leverage.quarter) || 0);

  T['kpi.reached'] = nf(reachedQ);
  T['kpi.female'] = nf(femaleQ);
  T['kpi.pwd'] = nf(pwdQ);
  T['kpi.shgs'] = nf(shgsQ);
  T['kpi.hort_produce'] = nf(hortProduce);
  T['kpi.hort_sales'] = money(hortSalesQ);
  T['kpi.poultry_produce'] = nf(poultryProduce);
  T['kpi.poultry_sales'] = money(poultrySalesQ);
  T['kpi.isla_groups'] = nf(shgsQ);
  T['kpi.saved'] = money(savedQ);
  T['kpi.loans'] = money(loansQ);
  T['kpi.loan_youth'] = nf(saversQ);
  T['kpi.leverage'] = money(leverageQ);

  // Youth in Work KPIs (quarter window). These only surface in the .docx when
  // the template contains the matching {{kpi.yiw_*}} placeholders; harmless otherwise.
  const yiwQ = (data.youthInWork && data.youthInWork.quarter) || {};
  T['kpi.yiw_target'] = nf(Number(yiwQ.yiwTarget) || 0);
  T['kpi.yiw_employed'] = nf(Number(yiwQ.employedYouth) || 0);
  T['kpi.yiw_female_target'] = nf(Number(yiwQ.femaleTarget) || 0);
  T['kpi.yiw_pwd_target'] = nf(Number(yiwQ.pwdTarget) || 0);
  T['kpi.yiw_self'] = nf(Number(yiwQ.selfEmployed) || 0);
  T['kpi.yiw_wage'] = nf(Number(yiwQ.wageEmployed) || 0);
  T['kpi.yiw_income'] = money(Number(yiwQ.totalIncome) || 0);

  // -------------------------------------------------------------------------
  // NARRATIVE tokens (monthly figures unless the para is explicitly quarterly).
  // These plug into the prose paragraphs so the text matches the tables.
  // -------------------------------------------------------------------------
  const pm = agg.prof.m, pq = agg.prof.q;
  const hm = agg.hort.m, pdm = agg.pdist.m, gdm = agg.gdist.m, psm = agg.psales.m, im = agg.isla.m;

  T['narr.profiled'] = nf(pm.youth);
  T['narr.shgs'] = nf(pm.shgs);
  T['narr.female'] = nf(pm.female);
  T['narr.male'] = nf(Math.max(0, pm.youth - pm.female));
  T['narr.pwd'] = nf(pm.pwd);
  T['narr.reached'] = nf(pm.youth);
  T['narr.reached_female'] = nf(pm.female);
  T['narr.reached_pwd'] = nf(pm.pwd);
  T['narr.reached_q'] = nf(pq.youth);

  // NB: the narrative prose already writes "UGX " before each money token, so
  // these monetary narr values are PLAIN numbers (no "UGX" prefix → no "UGX UGX").
  T['narr.hort_youth'] = nf(psm.youth || pm.youth);
  T['narr.hort_sales'] = nf(hm.sales);
  T['narr.tomatoes'] = nf(hm.tomatoes_kg);
  T['narr.watermelon'] = nf(hm.watermelon_pcs);
  T['narr.total_sales'] = nf(hm.sales + psm.amount);

  T['narr.birds_dist'] = nf(pdm.animals);
  T['narr.birds_youth'] = nf(pdm.youth);
  T['narr.birds_shgs'] = nf(pdm.shgs);
  T['narr.birds_sold'] = nf(psm.birds);
  T['narr.poultry_sales'] = nf(psm.amount);

  T['narr.goats'] = nf(gdm.animals);
  T['narr.goats_youth'] = nf(gdm.youth);
  T['narr.goats_shgs'] = nf(gdm.shgs);

  T['narr.savers'] = nf(im.savers);
  T['narr.saved'] = nf(im.saved);
  T['narr.loans'] = nf(im.loans);
  T['narr.leverage'] = nf(Number((data.leverage && data.leverage.month) || 0));

  return T;
}

// ---- XML fill ---------------------------------------------------------------
function xmlEsc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fillXml(xml: string, tokens: Record<string, string>): string {
  // 1) replace known tokens
  xml = xml.replace(/\{\{([a-z0-9._]+)\}\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(tokens, key)) return xmlEsc(tokens[key]);
    return m;
  });
  // 2) highlight any run still carrying an unmatched {{...}}
  xml = xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    if (run.indexOf('{{') === -1) return run;
    let cleaned = run.replace(/\{\{[a-z0-9._]+\}\}/g, '');
    if (/<w:rPr>/.test(cleaned)) {
      if (!/<w:highlight\b/.test(cleaned)) {
        cleaned = cleaned.replace('<w:rPr>', '<w:rPr><w:highlight w:val="yellow"/>');
      }
    } else {
      cleaned = cleaned.replace(/(<w:r\b[^>]*>)/, '$1<w:rPr><w:highlight w:val="yellow"/></w:rPr>');
    }
    return cleaned;
  });
  return xml;
}

// ---------------------------------------------------------------------------
// Generate the filled .docx. Media entries are copied STORED (level 0) so we
// never recompress the 3.9 MB of images — only document.xml is rewritten.
// ---------------------------------------------------------------------------
export function generateDocx(templateBytes: Uint8Array, tokens: Record<string, string>): Uint8Array {
  const files = unzipSync(templateBytes);
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {} as any;
  const zipInput: Record<string, [Uint8Array, any]> = {};

  for (const name of Object.keys(files)) {
    let bytes = files[name];
    if (name === 'word/document.xml') {
      const xml = strFromU8(bytes);
      bytes = strToU8(fillXml(xml, tokens));
      zipInput[name] = [bytes, { level: 6 }];
    } else {
      // copy everything else verbatim, STORED (no recompression) → fast
      zipInput[name] = [bytes, { level: 0 }];
    }
  }
  return zipSync(zipInput, {});
}
