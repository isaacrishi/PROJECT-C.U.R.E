import React, { useEffect, useState } from 'react';
import { BarChart3, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { User } from '../types';

interface DatasetSummary {
  id: string;
  name: string;
  row_count: number;
  is_synthetic: number;
}

interface CorrelationOutput {
  methodology: string;
  limitation: string;
  variables: string[];
  matrix: Array<{ varA: string; varB: string; r: number | null; pValue: number | null; n: number }>;
}

interface DiffExprOutput {
  methodology: string;
  comparison: string;
  limitation: string;
  featuresTested: number;
  results: Array<{
    feature: string;
    nA: number;
    nB: number;
    meanA: number;
    meanB: number;
    log2FoldChange: number;
    tStat: number;
    pValue: number;
    fdrAdjustedP: number;
  }>;
}

interface KaplanMeierOutput {
  methodology: string;
  limitation: string;
  curves: Record<
    string,
    {
      n: number;
      events: number;
      medianSurvival: number | null;
      points: Array<{ time: number; survival: number; ciLow: number; ciHigh: number; atRisk: number; events: number }>;
    }
  >;
  logRank: { chi2: number; pValue: number; comparison: string } | null;
}

interface DataAnalyticsProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
}

export const DataAnalytics: React.FC<DataAnalyticsProps> = ({ user, activeProjectId, onOpenAuth }) => {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowsCache, setRowsCache] = useState<Record<string, unknown>[]>([]);
  const [analysisType, setAnalysisType] = useState<'correlation' | 'differential_expression' | 'kaplan_meier'>('correlation');
  const [groupCol, setGroupCol] = useState('');
  const [groupA, setGroupA] = useState('');
  const [groupB, setGroupB] = useState('');
  const [distinctGroups, setDistinctGroups] = useState<string[]>([]);
  const [timeCol, setTimeCol] = useState('');
  const [eventCol, setEventCol] = useState('');

  const [isSynthetic, setIsSynthetic] = useState(false);
  const [corrResult, setCorrResult] = useState<CorrelationOutput | null>(null);
  const [deResult, setDeResult] = useState<DiffExprOutput | null>(null);
  const [kmResult, setKmResult] = useState<KaplanMeierOutput | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const recomputeDistinctGroups = (col: string, rows: Record<string, unknown>[]) => {
    if (!col || rows.length === 0) {
      setDistinctGroups([]);
      setGroupA('');
      setGroupB('');
      return;
    }
    const vals = Array.from(new Set(rows.map((r) => String(r[col] ?? '')).filter(Boolean)));
    setDistinctGroups(vals);
    setGroupA(vals[0] || '');
    setGroupB(vals[1] || '');
  };

  useEffect(() => {
    setDatasetId('');
    setHeaders([]);
    setRowsCache([]);
    setDistinctGroups([]);
    setGroupCol('');
    setGroupA('');
    setGroupB('');
    setCorrResult(null);
    setDeResult(null);
    setKmResult(null);
    setIsSynthetic(false);
    if (!user) {
      setDatasets([]);
      return;
    }
    const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
    apiFetch<{ datasets: DatasetSummary[] }>(`/api/datasets${q}`)
      .then((res) => {
        setDatasets(res.datasets);
        if (res.datasets.length > 0) {
          selectDataset(res.datasets[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unable to load datasets');
      });
  }, [user?.id, activeProjectId]);

  const selectDataset = async (id: string) => {
    setDatasetId(id);
    setCorrResult(null);
    setDeResult(null);
    setKmResult(null);
    setRowsCache([]);
    if (!id) return;
    try {
      const res = await apiFetch<{
        dataset: DatasetSummary;
        headers: string[];
        rows: Record<string, unknown>[];
      }>(`/api/datasets/${id}`);
      setHeaders(res.headers);
      setRowsCache(res.rows);
      setIsSynthetic(Boolean(res.dataset.is_synthetic));
      const gCol = res.headers.find((h) => /cohort|group|condition|arm/i.test(h)) || '';
      const tCol = res.headers.find((h) => /survival|time|months|days/i.test(h)) || '';
      const eCol = res.headers.find((h) => /event|status|vital/i.test(h)) || '';
      setGroupCol(gCol);
      setTimeCol(tCol);
      setEventCol(eCol);
      recomputeDistinctGroups(gCol, res.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to inspect dataset');
    }
  };

  const runAnalysis = async () => {
    if (!user) return onOpenAuth();
    if (!datasetId) return;
    setRunning(true);
    setError('');
    try {
      const res = await apiFetch<{ isSynthetic: boolean; result: unknown }>('/api/analytics/run', {
        method: 'POST',
        body: JSON.stringify({
          datasetId,
          analysisType,
          groupCol,
          groupA,
          groupB,
          timeCol,
          eventCol,
        }),
      });
      setIsSynthetic(res.isSynthetic);
      if (analysisType === 'correlation') {
        setCorrResult(res.result as CorrelationOutput);
        setDeResult(null);
        setKmResult(null);
      } else if (analysisType === 'differential_expression') {
        setDeResult(res.result as DiffExprOutput);
        setCorrResult(null);
        setKmResult(null);
      } else {
        setKmResult(res.result as KaplanMeierOutput);
        setCorrResult(null);
        setDeResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis execution failed');
    } finally {
      setRunning(false);
    }
  };

  const kmColors = ['#06b6d4', '#f59e0b', '#14b8a6', '#e879f9'];

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="text-xl font-semibold text-slate-100">Data Analytics</h1>
        <p className="text-xs text-slate-400 mt-1">
          Correlation matrices, Welch two-sample differential expression with FDR, and Kaplan-Meier survival estimation
        </p>
      </div>

      {/* Analysis Config Bar */}
      <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Source Dataset</label>
            <select
              value={datasetId}
              onChange={(e) => selectDataset(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
            >
              <option value="">Select imported dataset...</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.is_synthetic ? '[SYNTHETIC DATA] ' : ''}
                  {d.name} (n={d.row_count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Statistical Workflow</label>
            <select
              value={analysisType}
              onChange={(e) => setAnalysisType(e.target.value as typeof analysisType)}
              className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
            >
              <option value="correlation">Pearson Correlation Matrix</option>
              <option value="differential_expression">Differential Expression (Welch t-test + BH FDR)</option>
              <option value="kaplan_meier">Kaplan-Meier Survival & Log-Rank Test</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={runAnalysis}
              disabled={!datasetId || running}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded disabled:opacity-50"
            >
              <BarChart3 className="w-3.5 h-3.5" /> {running ? 'Computing...' : 'Run Statistical Analysis'}
            </button>
          </div>
        </div>

        {analysisType === 'differential_expression' && (
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800/70">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Grouping Column</label>
              <select
                value={groupCol}
                onChange={(e) => {
                  const col = e.target.value;
                  setGroupCol(col);
                  recomputeDistinctGroups(col, rowsCache);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              >
                <option value="">Select grouping column...</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Baseline Group (A)</label>
              <input
                value={groupA}
                onChange={(e) => setGroupA(e.target.value)}
                list="group-options"
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Comparison Group (B)</label>
              <input
                value={groupB}
                onChange={(e) => setGroupB(e.target.value)}
                list="group-options"
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <datalist id="group-options">
              {distinctGroups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        )}

        {analysisType === 'kaplan_meier' && (
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800/70">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Time Variable</label>
              <select
                value={timeCol}
                onChange={(e) => setTimeCol(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              >
                <option value="">Select time column</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Event Status (1=event, 0=censored)</label>
              <select
                value={eventCol}
                onChange={(e) => setEventCol(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              >
                <option value="">Select event column</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Stratification Column (Optional)</label>
              <select
                value={groupCol}
                onChange={(e) => setGroupCol(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              >
                <option value="">None (Single Cohort)</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      {isSynthetic && (corrResult || deResult || kmResult) && (
        <div className="p-3 border border-amber-700/70 bg-amber-950/40 rounded text-xs font-mono text-amber-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          SYNTHETIC DATA — Charts and statistics below are computed from a simulated demonstration dataset, not patient measurements.
        </div>
      )}

      {/* Correlation Heatmap Matrix */}
      {corrResult && (
        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Pearson Correlation Matrix</h2>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Method: {corrResult.methodology}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="border-collapse text-[11px] font-mono tabular-nums">
              <thead>
                <tr>
                  <th className="p-2 text-left text-slate-400">Variable</th>
                  {corrResult.variables.map((v) => (
                    <th key={v} className="p-2 text-center text-slate-300 max-w-[96px] truncate">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {corrResult.variables.map((rowVar) => (
                  <tr key={rowVar}>
                    <td className="p-2 text-slate-300 font-medium whitespace-nowrap">{rowVar}</td>
                    {corrResult.variables.map((colVar) => {
                      const cell = corrResult.matrix.find((m) => m.varA === rowVar && m.varB === colVar);
                      const r = cell?.r ?? 0;
                      const bg =
                        r >= 0
                          ? `rgba(6, 182, 212, ${Math.abs(r) * 0.55})`
                          : `rgba(245, 158, 11, ${Math.abs(r) * 0.55})`;
                      return (
                        <td
                          key={colVar}
                          style={{ backgroundColor: bg }}
                          title={`n=${cell?.n}, p=${cell?.pValue}`}
                          className="p-2 text-center border border-slate-900 text-slate-100"
                        >
                          <div>{cell?.r !== null && cell?.r !== undefined ? cell.r.toFixed(2) : 'NA'}</div>
                          {rowVar !== colVar && cell?.pValue !== null && (
                            <div className="text-[9px] text-slate-300/80">p={cell?.pValue}</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">{corrResult.limitation}</p>
        </section>
      )}

      {/* Differential Expression Table */}
      {deResult && (
        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Differential Feature Analysis: {deResult.comparison}</h2>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              {deResult.methodology} · Features Tested: {deResult.featuresTested}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2">Feature</th>
                  <th className="py-2 text-right">n (A / B)</th>
                  <th className="py-2 text-right">Mean A</th>
                  <th className="py-2 text-right">Mean B</th>
                  <th className="py-2 text-right">log2 FC</th>
                  <th className="py-2 text-right">Welch t</th>
                  <th className="py-2 text-right">p-value</th>
                  <th className="py-2 text-right">FDR (BH)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {deResult.results.map((r) => (
                  <tr key={r.feature} className="hover:bg-slate-800/20">
                    <td className="py-2 font-semibold text-slate-100">{r.feature}</td>
                    <td className="py-2 text-right text-slate-400">
                      {r.nA} / {r.nB}
                    </td>
                    <td className="py-2 text-right text-slate-300">{r.meanA}</td>
                    <td className="py-2 text-right text-slate-300">{r.meanB}</td>
                    <td className={`py-2 text-right ${r.log2FoldChange >= 0 ? 'text-cyan-400' : 'text-amber-400'}`}>
                      {r.log2FoldChange}
                    </td>
                    <td className="py-2 text-right text-slate-300">{r.tStat}</td>
                    <td className="py-2 text-right text-slate-300">{r.pValue}</td>
                    <td className={`py-2 text-right font-semibold ${r.fdrAdjustedP < 0.05 ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {r.fdrAdjustedP}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">{deResult.limitation}</p>
        </section>
      )}

      {/* Kaplan-Meier Survival Curve */}
      {kmResult && (
        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Kaplan-Meier Survival Estimation</h2>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">{kmResult.methodology}</p>
            </div>
            {kmResult.logRank && (
              <div className="text-xs font-mono border border-slate-800 bg-[#070B12] px-3 py-1.5 rounded">
                Log-Rank ({kmResult.logRank.comparison}): χ²={kmResult.logRank.chi2} · p={kmResult.logRank.pValue}
              </div>
            )}
          </div>

          {(() => {
            const entries = Object.entries(kmResult.curves);
            const maxTime = Math.max(
              ...entries.flatMap(([, c]) => c.points.map((p) => p.time)),
              1
            );
            const W = 680;
            const H = 280;
            const pad = { top: 20, right: 24, bottom: 42, left: 52 };
            const plotW = W - pad.left - pad.right;
            const plotH = H - pad.top - pad.bottom;
            const sx = (t: number) => pad.left + (t / maxTime) * plotW;
            const sy = (s: number) => pad.top + (1 - s) * plotH;

            return (
              <div className="border border-slate-800 bg-[#070B12] rounded p-3 overflow-x-auto">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[740px] h-auto">
                  {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
                    <g key={tick}>
                      <line
                        x1={pad.left}
                        y1={sy(tick)}
                        x2={W - pad.right}
                        y2={sy(tick)}
                        stroke="#1e293b"
                        strokeDasharray="3 3"
                      />
                      <text x={pad.left - 8} y={sy(tick) + 3} fill="#64748b" fontSize="10" textAnchor="end" fontFamily="IBM Plex Mono">
                        {(tick * 100).toFixed(0)}%
                      </text>
                    </g>
                  ))}
                  <line x1={pad.left} y1={pad.top} x2={pad.left} y2={H - pad.bottom} stroke="#475569" />
                  <line x1={pad.left} y1={H - pad.bottom} x2={W - pad.right} y2={H - pad.bottom} stroke="#475569" />
                  <text x={W / 2} y={H - 8} fill="#94a3b8" fontSize="10" textAnchor="middle" fontFamily="IBM Plex Mono">
                    Time ({timeCol || 'units'})
                  </text>
                  <text
                    x={14}
                    y={H / 2}
                    fill="#94a3b8"
                    fontSize="10"
                    textAnchor="middle"
                    transform={`rotate(-90 14 ${H / 2})`}
                    fontFamily="IBM Plex Mono"
                  >
                    Survival Probability S(t)
                  </text>

                  {entries.map(([name, curve], idx) => {
                    const color = kmColors[idx % kmColors.length];
                    // Step-function SVG path
                    let d = '';
                    curve.points.forEach((pt, i) => {
                      const x = sx(pt.time);
                      const y = sy(pt.survival);
                      if (i === 0) d += `M ${x} ${y}`;
                      else {
                        const prevY = sy(curve.points[i - 1].survival);
                        d += ` L ${x} ${prevY} L ${x} ${y}`;
                      }
                    });
                    return <path key={name} d={d} fill="none" stroke={color} strokeWidth="2" />;
                  })}
                </svg>

                <div className="flex flex-wrap gap-5 mt-2 pt-2 border-t border-slate-800/80 text-xs font-mono">
                  {entries.map(([name, curve], idx) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: kmColors[idx % kmColors.length] }} />
                      <span className="text-slate-200">{name}</span>
                      <span className="text-slate-400">
                        (n={curve.n}, events={curve.events}, median={curve.medianSurvival ?? 'NR'})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <p className="text-[11px] text-slate-500">{kmResult.limitation}</p>
        </section>
      )}
    </div>
  );
};
