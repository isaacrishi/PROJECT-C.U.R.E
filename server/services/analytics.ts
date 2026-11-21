// Statistical & Genomics Parsing Engine for PROJECT CURE
// All calculations use deterministic mathematical formulas; no fabricated measurements.

export interface ParsedDatasetResult {
  format: 'csv' | 'tsv' | 'json' | 'vcf';
  headers: string[];
  rows: Record<string, string | number | null>[];
  rowCount: number;
  colCount: number;
  totalMissing: number;
  variables: VariableSummary[];
  warnings: string[];
  vcfSummary?: {
    fileFormat: string;
    sampleIds: string[];
    variantCount: number;
    chromCounts: Record<string, number>;
    filterPassCount: number;
  };
}

export interface VariableSummary {
  name: string;
  dataType: 'numeric' | 'categorical';
  missingCount: number;
  nonMissingCount: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  ci95Low: number | null;
  ci95High: number | null;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((s) => s.trim());
  }
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function isMissingToken(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === 'number') return Number.isNaN(val);
  const s = String(val).trim();
  return s === '' || s === 'NA' || s === 'N/A' || s === 'NaN' || s === 'null' || s === '.';
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

// Regularized incomplete beta approximation & Student-t / Normal survival p-value approximations
function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) x += p[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 100;
  const EPS = 3e-7;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betainc(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function twoTailedStudentPValue(tAbs: number, df: number): number {
  if (!Number.isFinite(tAbs) || df <= 0) return 1;
  if (tAbs === 0) return 1;
  const x = df / (df + tAbs * tAbs);
  return Math.min(1, Math.max(0, betainc(df / 2, 0.5, x)));
}

export function chiSquare1DfPValue(chi2: number): number {
  if (!Number.isFinite(chi2) || chi2 <= 0) return 1;
  // For 1 df, chi2 = z^2, two-tailed normal survival is erfc(sqrt(chi2 / 2))
  const z = Math.sqrt(chi2);
  // Abramowitz & Stegun 7.1.26 approximation for erfc(z/sqrt(2))
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.min(1, Math.max(0, poly * Math.exp(-x * x)));
}

export function parseDatasetContent(rawText: string, filename: string): ParsedDatasetResult {
  const lower = filename.toLowerCase();
  const warnings: string[] = [];

  if (lower.endsWith('.vcf') || rawText.trimStart().startsWith('##fileformat=VCF')) {
    const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let fileFormat = 'VCF';
    let headerCols: string[] = [];
    const variantRows: Record<string, string | number | null>[] = [];
    const chromCounts: Record<string, number> = {};
    let filterPassCount = 0;

    for (const line of lines) {
      if (line.startsWith('##fileformat=')) {
        fileFormat = line.split('=')[1]?.trim() || 'VCF';
        continue;
      }
      if (line.startsWith('##')) continue;
      if (line.startsWith('#CHROM')) {
        headerCols = line.slice(1).split('\t').map((s) => s.trim());
        continue;
      }
      const cols = line.split('\t');
      if (cols.length < 5) continue;
      const row: Record<string, string | number | null> = {};
      const activeHeaders = headerCols.length ? headerCols : ['CHROM', 'POS', 'ID', 'REF', 'ALT', 'QUAL', 'FILTER', 'INFO'];
      activeHeaders.forEach((h, idx) => {
        const val = cols[idx] ?? '.';
        if (h === 'POS' || h === 'QUAL') {
          const num = Number(val);
          row[h] = Number.isFinite(num) ? num : null;
        } else {
          row[h] = val === '.' ? null : val;
        }
      });
      const chrom = String(row['CHROM'] ?? 'UNKNOWN');
      chromCounts[chrom] = (chromCounts[chrom] || 0) + 1;
      if (row['FILTER'] === 'PASS') filterPassCount++;
      variantRows.push(row);
    }

    const headers = headerCols.length ? headerCols : ['CHROM', 'POS', 'ID', 'REF', 'ALT', 'QUAL', 'FILTER', 'INFO'];
    const sampleIds = headers.length > 9 ? headers.slice(9) : [];
    const { variables, totalMissing } = computeVariableSummaries(headers, variantRows);

    return {
      format: 'vcf',
      headers,
      rows: variantRows,
      rowCount: variantRows.length,
      colCount: headers.length,
      totalMissing,
      variables,
      warnings,
      vcfSummary: {
        fileFormat,
        sampleIds,
        variantCount: variantRows.length,
        chromCounts,
        filterPassCount,
      },
    };
  }

  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(rawText);
    const arr: Record<string, unknown>[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.rows)
      ? parsed.rows
      : [];
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('JSON dataset must contain a non-empty array of sample/observation objects.');
    }
    const headerSet = new Set<string>();
    for (const item of arr) {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach((k) => headerSet.add(k));
      }
    }
    const headers = Array.from(headerSet);
    const rows = arr.map((item) => {
      const r: Record<string, string | number | null> = {};
      for (const h of headers) {
        const raw = item?.[h];
        if (isMissingToken(raw)) r[h] = null;
        else if (typeof raw === 'number') r[h] = raw;
        else {
          const n = Number(raw);
          r[h] = String(raw).trim() !== '' && Number.isFinite(n) ? n : String(raw);
        }
      }
      return r;
    });
    const { variables, totalMissing } = computeVariableSummaries(headers, rows);
    return {
      format: 'json',
      headers,
      rows,
      rowCount: rows.length,
      colCount: headers.length,
      totalMissing,
      variables,
      warnings,
    };
  }

  // CSV or TSV
  const isTsv = lower.endsWith('.tsv') || lower.endsWith('.txt');
  const delimiter = isTsv ? '\t' : ',';
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Tabular dataset must contain a header row and at least one data row.');
  }
  const headers = splitDelimitedLine(lines[0], delimiter).map((h, i) => h || `col_${i + 1}`);
  const rows: Record<string, string | number | null>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = splitDelimitedLine(lines[i], delimiter);
    if (vals.length !== headers.length) {
      warnings.push(`Row ${i + 1} has ${vals.length} columns (expected ${headers.length}).`);
    }
    const row: Record<string, string | number | null> = {};
    headers.forEach((h, idx) => {
      const v = vals[idx];
      if (isMissingToken(v)) {
        row[h] = null;
      } else {
        const num = Number(v);
        row[h] = v !== '' && Number.isFinite(num) ? num : v;
      }
    });
    rows.push(row);
  }

  const { variables, totalMissing } = computeVariableSummaries(headers, rows);
  return {
    format: isTsv ? 'tsv' : 'csv',
    headers,
    rows,
    rowCount: rows.length,
    colCount: headers.length,
    totalMissing,
    variables,
    warnings: warnings.slice(0, 15),
  };
}

export function computeVariableSummaries(
  headers: string[],
  rows: Record<string, string | number | null>[]
): { variables: VariableSummary[]; totalMissing: number } {
  let totalMissing = 0;
  const variables: VariableSummary[] = headers.map((name) => {
    const nums: number[] = [];
    let nonMissing = 0;
    let missing = 0;
    let nonNumericCount = 0;

    for (const row of rows) {
      const v = row[name];
      if (v === null || v === undefined || v === '') {
        missing++;
        totalMissing++;
      } else {
        nonMissing++;
        if (typeof v === 'number' && Number.isFinite(v)) {
          nums.push(v);
        } else {
          const parsed = Number(v);
          if (Number.isFinite(parsed) && String(v).trim() !== '') {
            nums.push(parsed);
          } else {
            nonNumericCount++;
          }
        }
      }
    }

    const isNumeric = nonMissing > 0 && nonNumericCount === 0 && nums.length > 0;
    if (!isNumeric) {
      return {
        name,
        dataType: 'categorical',
        missingCount: missing,
        nonMissingCount: nonMissing,
        mean: null,
        median: null,
        std: null,
        min: null,
        max: null,
        q1: null,
        q3: null,
        ci95Low: null,
        ci95High: null,
      };
    }

    const sorted = [...nums].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((acc, x) => acc + x, 0) / n;
    const variance = n > 1 ? sorted.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1) : 0;
    const std = Math.sqrt(variance);
    const se = n > 0 ? std / Math.sqrt(n) : 0;
    const z95 = n >= 30 ? 1.96 : 2.09; // conservative t-multiplier note in metadata

    return {
      name,
      dataType: 'numeric',
      missingCount: missing,
      nonMissingCount: nonMissing,
      mean: Number(mean.toFixed(4)),
      median: Number(quantile(sorted, 0.5).toFixed(4)),
      std: Number(std.toFixed(4)),
      min: Number(sorted[0].toFixed(4)),
      max: Number(sorted[n - 1].toFixed(4)),
      q1: Number(quantile(sorted, 0.25).toFixed(4)),
      q3: Number(quantile(sorted, 0.75).toFixed(4)),
      ci95Low: Number((mean - z95 * se).toFixed(4)),
      ci95High: Number((mean + z95 * se).toFixed(4)),
    };
  });

  return { variables, totalMissing };
}

export function computeCorrelationMatrix(
  rows: Record<string, string | number | null>[],
  variables: string[]
) {
  const matrix: Array<{
    varA: string;
    varB: string;
    r: number | null;
    pValue: number | null;
    n: number;
  }> = [];

  for (const a of variables) {
    for (const b of variables) {
      const pairs: Array<[number, number]> = [];
      for (const row of rows) {
        const va = row[a];
        const vb = row[b];
        if (typeof va === 'number' && typeof vb === 'number' && Number.isFinite(va) && Number.isFinite(vb)) {
          pairs.push([va, vb]);
        }
      }
      const n = pairs.length;
      if (n < 3) {
        matrix.push({ varA: a, varB: b, r: null, pValue: null, n });
        continue;
      }
      const meanA = pairs.reduce((s, p) => s + p[0], 0) / n;
      const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;
      let num = 0;
      let denA = 0;
      let denB = 0;
      for (const [xa, xb] of pairs) {
        const da = xa - meanA;
        const db = xb - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }
      const denom = Math.sqrt(denA * denB);
      if (denom === 0) {
        matrix.push({ varA: a, varB: b, r: null, pValue: null, n });
        continue;
      }
      const r = Math.max(-1, Math.min(1, num / denom));
      if (a === b) {
        matrix.push({ varA: a, varB: b, r: 1, pValue: 0, n });
      } else {
        const t = Math.abs(r) >= 1 ? 999 : (Math.abs(r) * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r);
        const pValue = twoTailedStudentPValue(t, n - 2);
        matrix.push({
          varA: a,
          varB: b,
          r: Number(r.toFixed(4)),
          pValue: Number(pValue.toExponential(3)),
          n,
        });
      }
    }
  }

  return {
    methodology: 'Pearson product-moment correlation with two-tailed Student t-test (df = n - 2)',
    limitation: 'Pairwise complete observations used. Correlation measures linear association only and does not imply causation.',
    variables,
    matrix,
  };
}

export function computeDifferentialExpression(
  rows: Record<string, string | number | null>[],
  groupCol: string,
  groupA: string,
  groupB: string,
  numericCols: string[]
) {
  const results: Array<{
    feature: string;
    nA: number;
    nB: number;
    meanA: number;
    meanB: number;
    log2FoldChange: number;
    tStat: number;
    df: number;
    pValue: number;
    fdrAdjustedP: number;
  }> = [];

  for (const col of numericCols) {
    if (col === groupCol) continue;
    const valsA: number[] = [];
    const valsB: number[] = [];
    for (const r of rows) {
      const g = String(r[groupCol] ?? '');
      const v = r[col];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (g === groupA) valsA.push(v);
      else if (g === groupB) valsB.push(v);
    }
    if (valsA.length < 2 || valsB.length < 2) continue;
    const meanA = valsA.reduce((s, x) => s + x, 0) / valsA.length;
    const meanB = valsB.reduce((s, x) => s + x, 0) / valsB.length;
    const varA = valsA.reduce((s, x) => s + (x - meanA) ** 2, 0) / (valsA.length - 1);
    const varB = valsB.reduce((s, x) => s + (x - meanB) ** 2, 0) / (valsB.length - 1);
    const se2 = varA / valsA.length + varB / valsB.length;
    if (se2 === 0) continue;
    const tStat = (meanB - meanA) / Math.sqrt(se2);
    const dfNum = se2 ** 2;
    const dfDen =
      (varA / valsA.length) ** 2 / (valsA.length - 1) + (varB / valsB.length) ** 2 / (valsB.length - 1);
    const df = dfDen > 0 ? dfNum / dfDen : valsA.length + valsB.length - 2;
    const pValue = twoTailedStudentPValue(Math.abs(tStat), df);
    const eps = 1e-6;
    const log2FoldChange =
      meanA > 0 && meanB > 0 ? Math.log2((meanB + eps) / (meanA + eps)) : meanB - meanA;

    results.push({
      feature: col,
      nA: valsA.length,
      nB: valsB.length,
      meanA: Number(meanA.toFixed(4)),
      meanB: Number(meanB.toFixed(4)),
      log2FoldChange: Number(log2FoldChange.toFixed(4)),
      tStat: Number(tStat.toFixed(4)),
      df: Number(df.toFixed(2)),
      pValue,
      fdrAdjustedP: pValue,
    });
  }

  // Benjamini-Hochberg FDR adjustment
  const m = results.length;
  const sortedIdx = results.map((_, idx) => idx).sort((i, j) => results[i].pValue - results[j].pValue);
  let prevMin = 1;
  for (let rank = m; rank >= 1; rank--) {
    const idx = sortedIdx[rank - 1];
    const adj = Math.min(prevMin, (results[idx].pValue * m) / rank);
    prevMin = adj;
    results[idx].fdrAdjustedP = Number(adj.toPrecision(4));
    results[idx].pValue = Number(results[idx].pValue.toPrecision(4));
  }

  results.sort((a, b) => a.fdrAdjustedP - b.fdrAdjustedP);

  return {
    methodology: "Welch's two-sample unequal-variance t-test with Benjamini-Hochberg FDR correction",
    comparison: `${groupB} vs ${groupA} (grouped by ${groupCol})`,
    limitation: 'Statistical significance (FDR < 0.05) does not establish biological causality or clinical utility.',
    featuresTested: results.length,
    results,
  };
}

export interface KaplanMeierPoint {
  time: number;
  survival: number;
  ciLow: number;
  ciHigh: number;
  atRisk: number;
  events: number;
}

export function computeKaplanMeier(
  rows: Record<string, string | number | null>[],
  timeCol: string,
  eventCol: string,
  groupCol?: string
) {
  const cohorts: Record<string, Array<{ time: number; event: number }>> = {};
  for (const r of rows) {
    const t = Number(r[timeCol]);
    const eRaw = r[eventCol];
    const e = eRaw === 1 || eRaw === '1' || eRaw === 'true' || eRaw === 'deceased' || eRaw === 'EVENT' ? 1 : 0;
    if (!Number.isFinite(t) || t < 0) continue;
    const g = groupCol && r[groupCol] !== null && r[groupCol] !== undefined ? String(r[groupCol]) : 'All Samples';
    if (!cohorts[g]) cohorts[g] = [];
    cohorts[g].push({ time: t, event: e });
  }

  const curves: Record<string, { n: number; events: number; medianSurvival: number | null; points: KaplanMeierPoint[] }> = {};

  for (const [cohortName, obs] of Object.entries(cohorts)) {
    const sorted = [...obs].sort((a, b) => a.time - b.time);
    const uniqueTimes = Array.from(new Set(sorted.map((o) => o.time))).sort((a, b) => a - b);
    let nRisk = sorted.length;
    let survival = 1.0;
    let greenwoodSum = 0;
    const points: KaplanMeierPoint[] = [{ time: 0, survival: 1, ciLow: 1, ciHigh: 1, atRisk: nRisk, events: 0 }];
    let medianSurvival: number | null = null;
    let totalEvents = 0;

    for (const t of uniqueTimes) {
      const atTime = sorted.filter((o) => o.time === t);
      const events = atTime.filter((o) => o.event === 1).length;
      const censored = atTime.length - events;
      totalEvents += events;

      if (events > 0 && nRisk > 0) {
        survival *= 1 - events / nRisk;
        if (nRisk - events > 0) {
          greenwoodSum += events / (nRisk * (nRisk - events));
        }
        const se = survival * Math.sqrt(greenwoodSum);
        const ciLow = Math.max(0, survival - 1.96 * se);
        const ciHigh = Math.min(1, survival + 1.96 * se);
        points.push({
          time: Number(t.toFixed(3)),
          survival: Number(survival.toFixed(4)),
          ciLow: Number(ciLow.toFixed(4)),
          ciHigh: Number(ciHigh.toFixed(4)),
          atRisk: nRisk,
          events,
        });
        if (medianSurvival === null && survival <= 0.5) {
          medianSurvival = Number(t.toFixed(3));
        }
      }
      nRisk -= events + censored;
    }

    curves[cohortName] = {
      n: sorted.length,
      events: totalEvents,
      medianSurvival,
      points,
    };
  }

  // Two-group Log-Rank test if exactly 2 cohorts
  let logRank: { chi2: number; pValue: number; comparison: string } | null = null;
  const names = Object.keys(cohorts);
  if (names.length === 2) {
    const [g1, g2] = names;
    const allObs = [
      ...cohorts[g1].map((o) => ({ ...o, g: 1 })),
      ...cohorts[g2].map((o) => ({ ...o, g: 2 })),
    ].sort((a, b) => a.time - b.time);

    const eventTimes = Array.from(new Set(allObs.filter((o) => o.event === 1).map((o) => o.time))).sort((a, b) => a - b);
    let O1 = 0;
    let E1 = 0;
    let V1 = 0;

    for (const t of eventTimes) {
      const atRisk1 = allObs.filter((o) => o.g === 1 && o.time >= t).length;
      const atRisk2 = allObs.filter((o) => o.g === 2 && o.time >= t).length;
      const N = atRisk1 + atRisk2;
      const d1 = allObs.filter((o) => o.g === 1 && o.time === t && o.event === 1).length;
      const d2 = allObs.filter((o) => o.g === 2 && o.time === t && o.event === 1).length;
      const d = d1 + d2;
      if (N > 1) {
        O1 += d1;
        E1 += (atRisk1 * d) / N;
        V1 += (atRisk1 * atRisk2 * d * (N - d)) / (N * N * (N - 1));
      }
    }
    if (V1 > 0) {
      const chi2 = ((O1 - E1) ** 2) / V1;
      logRank = {
        chi2: Number(chi2.toFixed(4)),
        pValue: Number(chiSquare1DfPValue(chi2).toPrecision(4)),
        comparison: `${g1} vs ${g2}`,
      };
    }
  }

  return {
    methodology: 'Non-parametric Kaplan-Meier product-limit survival estimator with Greenwood 95% confidence intervals and Mantel-Cox Log-Rank test',
    limitation: 'Unadjusted univariate survival curve; does not control for clinical covariates or confounding stages.',
    curves,
    logRank,
  };
}

// Curated reference cancer biology gene sets for Over-Representation Analysis (ORA)
const CURATED_PATHWAYS: Array<{ id: string; name: string; genes: string[] }> = [
  { id: 'HALLMARK_TP53_DDR', name: 'TP53 & DNA Damage Response', genes: ['TP53', 'ATM', 'ATR', 'CHEK1', 'CHEK2', 'BRCA1', 'BRCA2', 'MDM2', 'CDKN1A', 'RAD51', 'PARP1'] },
  { id: 'HALLMARK_PI3K_AKT_MTOR', name: 'PI3K-AKT-mTOR Growth Signalling', genes: ['PIK3CA', 'PIK3R1', 'AKT1', 'AKT2', 'PTEN', 'MTOR', 'TSC1', 'TSC2', 'RICTOR', 'RPTOR'] },
  { id: 'HALLMARK_MAPK_RAS', name: 'RAS-RAF-MEK-ERK Proliferation', genes: ['KRAS', 'NRAS', 'HRAS', 'BRAF', 'RAF1', 'MAP2K1', 'MAP2K2', 'MAPK1', 'MAPK3', 'EGFR', 'ERBB2'] },
  { id: 'HALLMARK_IMMUNE_CHECKPOINT', name: 'Immune Evasion & T-Cell Exhaustion', genes: ['CD274', 'PDCD1', 'CTLA4', 'LAG3', 'TIGIT', 'HAVCR2', 'IDO1', 'B2M', 'HLA-A', 'IFNG', 'STAT1'] },
  { id: 'HALLMARK_ANGIOGENESIS_HYPOXIA', name: 'HIF-1α Hypoxia & Angiogenesis', genes: ['HIF1A', 'EPAS1', 'VHL', 'VEGFA', 'KDR', 'FLT1', 'ANGPT1', 'ANGPT2', 'PDGFB', 'CA9'] },
  { id: 'HALLMARK_EMT_METASTASIS', name: 'Epithelial-Mesenchymal Transition', genes: ['CDH1', 'CDH2', 'VIM', 'SNAI1', 'SNAI2', 'TWIST1', 'ZEB1', 'ZEB2', 'MMP2', 'MMP9', 'TGFB1'] },
  { id: 'HALLMARK_EPIGENETIC_CHROMATIN', name: 'Chromatin & Epigenetic Regulation', genes: ['ARID1A', 'SMARCA4', 'EZH2', 'KMT2D', 'KDM6A', 'DNMT3A', 'TET2', 'IDH1', 'IDH2', 'HDAC1'] },
];

function logFactorial(n: number): number {
  let res = 0;
  for (let i = 2; i <= n; i++) res += Math.log(i);
  return res;
}

function hypergeometricP(k: number, K: number, n: number, N: number): number {
  // P(X >= k)
  let pSum = 0;
  const maxK = Math.min(K, n);
  for (let i = k; i <= maxK; i++) {
    const logP =
      logFactorial(K) -
      logFactorial(i) -
      logFactorial(K - i) +
      logFactorial(N - K) -
      logFactorial(n - i) -
      logFactorial(N - K - (n - i)) -
      (logFactorial(N) - logFactorial(n) - logFactorial(N - n));
    pSum += Math.exp(logP);
  }
  return Math.min(1, Math.max(0, pSum));
}

export function computePathwayEnrichment(inputGenes: string[]) {
  const cleaned = Array.from(new Set(inputGenes.map((g) => g.trim().toUpperCase()).filter(Boolean)));
  const backgroundSize = 20000; // Standard human protein-coding gene universe size
  const results = CURATED_PATHWAYS.map((pw) => {
    const overlap = pw.genes.filter((g) => cleaned.includes(g));
    const pValue =
      overlap.length > 0 ? hypergeometricP(overlap.length, pw.genes.length, cleaned.length, backgroundSize) : 1;
    return {
      pathwayId: pw.id,
      pathwayName: pw.name,
      pathwaySize: pw.genes.length,
      overlapCount: overlap.length,
      overlappingGenes: overlap,
      pValue,
      fdrAdjustedP: pValue,
    };
  })
    .filter((r) => r.overlapCount > 0)
    .sort((a, b) => a.pValue - b.pValue);

  const m = results.length;
  let prev = 1;
  for (let i = m - 1; i >= 0; i--) {
    const adj = Math.min(prev, (results[i].pValue * m) / (i + 1));
    prev = adj;
    results[i].fdrAdjustedP = Number(adj.toPrecision(4));
    results[i].pValue = Number(results[i].pValue.toPrecision(4));
  }

  return {
    methodology: 'One-sided Fisher Exact / Hypergeometric Over-Representation Analysis (background universe N = 20,000 protein-coding genes) with Benjamini-Hochberg FDR',
    inputGeneCount: cleaned.length,
    limitation: 'Evaluated against 7 curated hallmark cancer signalling panels; exploratory pathway enrichment only.',
    results,
  };
}

// Explicitly labelled SYNTHETIC DATA generator for workflow testing only
export function generateExplicitSyntheticDemoCsv(): { filename: string; content: string } {
  const header = 'sample_id,cohort,TP53_expr,EGFR_expr,VEGFA_expr,CD274_expr,HIF1A_expr,survival_months,event_status';
  const lines = [header];
  // Deterministic pseudo-random generator (Mulberry32) so it's reproducible
  let seed = 20261116;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 1; i <= 40; i++) {
    const isHighRisk = i > 20;
    const cohort = isHighRisk ? 'SYNTH_Group_B_Hypoxic' : 'SYNTH_Group_A_Normoxic';
    const tp53 = (isHighRisk ? 4.2 + rand() * 2.1 : 7.1 + rand() * 1.8).toFixed(3);
    const egfr = (isHighRisk ? 8.4 + rand() * 2.4 : 5.3 + rand() * 1.5).toFixed(3);
    const vegfa = (isHighRisk ? 9.1 + rand() * 2.2 : 4.8 + rand() * 1.4).toFixed(3);
    const cd274 = (isHighRisk ? 7.8 + rand() * 2.0 : 4.1 + rand() * 1.3).toFixed(3);
    const hif1a = (isHighRisk ? 8.9 + rand() * 1.9 : 4.4 + rand() * 1.1).toFixed(3);
    const surv = (isHighRisk ? 6 + rand() * 26 : 16 + rand() * 38).toFixed(1);
    const ev = isHighRisk ? (rand() > 0.25 ? 1 : 0) : rand() > 0.65 ? 1 : 0;
    lines.push(`SYNTH_${String(i).padStart(3, '0')},${cohort},${tp53},${egfr},${vegfa},${cd274},${hif1a},${surv},${ev}`);
  }
  return {
    filename: 'SYNTHETIC_DEMO_ONCOLOGY_COHORT.csv',
    content: lines.join('\n'),
  };
}
