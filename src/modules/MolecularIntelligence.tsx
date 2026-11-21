import React, { useEffect, useState } from 'react';
import { Upload, Beaker, AlertTriangle, Trash2, Globe, ExternalLink } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { User } from '../types';

interface DatasetRow {
  id: string;
  name: string;
  format: string;
  original_filename: string;
  row_count: number;
  col_count: number;
  missing_count: number;
  is_synthetic: number;
  validation_summary_json: string;
  created_at: string;
}

interface VariableStat {
  name: string;
  dataType: 'numeric' | 'categorical';
  missingCount: number;
  nonMissingCount: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  ci95Low: number | null;
  ci95High: number | null;
}

interface PathwayResult {
  methodology: string;
  inputGeneCount: number;
  limitation: string;
  results: Array<{
    pathwayId: string;
    pathwayName: string;
    pathwaySize: number;
    overlapCount: number;
    overlappingGenes: string[];
    pValue: number;
    fdrAdjustedP: number;
  }>;
  livePathways?: Array<{
    pathwayId: string;
    pathwayName: string;
    sourceDb: string;
    overlapCount: number;
    overlappingGenes: string[];
    pValue: number;
    fdrAdjustedP: number;
    combinedScore: number;
  }>;
  liveErrors?: Array<{ source: string; message: string }>;
}

interface OmicsConnectorResponse {
  cancerArea: string;
  genesQueried: string[];
  studies: Array<{
    studyId: string;
    name: string;
    cancerType: string;
    sampleCount: number | null;
    pmid: string;
    url: string;
    source: string;
  }>;
  mutations: Array<{
    ssmId: string;
    gene: string;
    aaChange: string;
    consequenceType: string;
    genomicChange: string;
    caseCount: number;
    url: string;
  }>;
  errors: Array<{ source: string; message: string }>;
}

interface MolecularIntelligenceProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
}

export const MolecularIntelligence: React.FC<MolecularIntelligenceProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
}) => {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [activeDataset, setActiveDataset] = useState<DatasetRow | null>(null);
  const [parsedVars, setParsedVars] = useState<VariableStat[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [vcfSummary, setVcfSummary] = useState<{
    fileFormat: string;
    sampleIds: string[];
    variantCount: number;
    chromCounts: Record<string, number>;
    filterPassCount: number;
  } | null>(null);

  const [datasetName, setDatasetName] = useState('');
  const [deidentifiedAck, setDeidentifiedAck] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [geneInput, setGeneInput] = useState('TP53, BRCA1, RAD51, PARP1, HIF1A, VEGFA, CD274');
  const [useLivePathways, setUseLivePathways] = useState(true);
  const [pathwayResult, setPathwayResult] = useState<PathwayResult | null>(null);
  const [pathwayLoading, setPathwayLoading] = useState(false);

  const [omicsCancerQuery, setOmicsCancerQuery] = useState('lung adenocarcinoma');
  const [omicsGenesQuery, setOmicsGenesQuery] = useState('TP53, EGFR, KRAS, PIK3CA, CD274');
  const [omicsLoading, setOmicsLoading] = useState(false);
  const [omicsData, setOmicsData] = useState<OmicsConnectorResponse | null>(null);

  const [error, setError] = useState('');

  const loadDatasets = async (clearSelection = false) => {
    if (!user) {
      setDatasets([]);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const res = await apiFetch<{ datasets: DatasetRow[] }>(`/api/datasets${q}`);
      setDatasets(res.datasets);
      if (res.datasets.length === 0) {
        setSelectedDatasetId(null);
        setActiveDataset(null);
        setParsedVars([]);
        setPreviewRows([]);
        setVcfSummary(null);
      } else if (clearSelection || !selectedDatasetId || !res.datasets.some((d) => d.id === selectedDatasetId)) {
        inspectDataset(res.datasets[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load datasets');
    }
  };

  useEffect(() => {
    setSelectedDatasetId(null);
    setActiveDataset(null);
    setParsedVars([]);
    setPreviewRows([]);
    setVcfSummary(null);
    loadDatasets(true);
  }, [user?.id, activeProjectId]);

  const inspectDataset = async (id: string) => {
    setSelectedDatasetId(id);
    try {
      const res = await apiFetch<{
        dataset: DatasetRow;
        parsedVariables: VariableStat[];
        rows: Record<string, unknown>[];
        vcfSummary: typeof vcfSummary;
      }>(`/api/datasets/${id}`);
      setActiveDataset(res.dataset);
      setParsedVars(res.parsedVariables);
      setPreviewRows(res.rows.slice(0, 20));
      setVcfSummary(res.vcfSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dataset');
    }
  };

  const deleteDataset = async (id: string) => {
    try {
      await apiFetch(`/api/datasets/${id}`, { method: 'DELETE' });
      if (selectedDatasetId === id) {
        setSelectedDatasetId(null);
        setActiveDataset(null);
        setParsedVars([]);
        setPreviewRows([]);
        setVcfSummary(null);
      }
      await loadDatasets(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete dataset');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user) {
      onOpenAuth();
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', datasetName.trim() || file.name);
      if (activeProjectId) form.append('projectId', activeProjectId);
      form.append('deidentified', String(deidentifiedAck));
      const res = await apiFetch<{ dataset: DatasetRow }>('/api/datasets/upload', {
        method: 'POST',
        body: form,
      });
      setDatasetName('');
      await loadDatasets();
      await inspectDataset(res.dataset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCreateSyntheticDemo = async () => {
    if (!user) return onOpenAuth();
    setUploading(true);
    setError('');
    try {
      const res = await apiFetch<{ dataset: DatasetRow }>('/api/datasets/synthetic-demo', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      await loadDatasets();
      await inspectDataset(res.dataset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate synthetic demo dataset');
    } finally {
      setUploading(false);
    }
  };

  const runPathwayEnrichment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setError('');
    setPathwayLoading(true);
    try {
      const res = await apiFetch<{ result: PathwayResult }>('/api/analytics/run', {
        method: 'POST',
        body: JSON.stringify({
          analysisType: 'pathway_enrichment',
          geneList: geneInput,
          projectId: activeProjectId,
          useLivePathways,
        }),
      });
      setPathwayResult(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pathway enrichment failed');
    } finally {
      setPathwayLoading(false);
    }
  };

  const queryPublicOmics = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setError('');
    setOmicsLoading(true);
    try {
      const qs = new URLSearchParams({
        cancerArea: omicsCancerQuery.trim() || 'lung adenocarcinoma',
        genes: omicsGenesQuery.trim(),
      });
      const res = await apiFetch<OmicsConnectorResponse>(`/api/connectors/omics?${qs.toString()}`);
      setOmicsData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to query cBioPortal / NCI GDC');
    } finally {
      setOmicsLoading(false);
    }
  };

  const numericVars = parsedVars.filter((v) => v.dataType === 'numeric' && v.mean !== null);
  const maxMean = Math.max(...numericVars.map((v) => Math.abs(v.mean ?? 0)), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Molecular Intelligence</h1>
          <p className="text-xs text-slate-400 mt-1">
            Import and validate CSV, TSV, JSON, or VCF genomics datasets · Descriptive statistics, missing-value detection, and pathway enrichment
          </p>
        </div>
        <button
          onClick={handleCreateSyntheticDemo}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-amber-700/70 text-amber-300 hover:bg-amber-950/30 rounded"
        >
          <Beaker className="w-3.5 h-3.5" /> Load Labelled SYNTHETIC DATA Demo
        </button>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload & Dataset Selector */}
        <div className="space-y-4">
          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
            <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">Import Dataset</h2>
            <input
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="Optional dataset label"
              className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <label className="flex items-start gap-2 text-[11px] text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={deidentifiedAck}
                onChange={(e) => setDeidentifiedAck(e.target.checked)}
                className="accent-cyan-500 mt-0.5"
              />
              Confirm dataset is de-identified for research use (de-identification is not assumed infallible).
            </label>
            <label className="flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              {uploading ? 'Validating & Parsing...' : 'Upload CSV / TSV / JSON / VCF'}
              <input
                type="file"
                accept=".csv,.tsv,.txt,.json,.vcf"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2">
            <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase mb-2">
              Imported Datasets ({datasets.length})
            </h2>
            {datasets.length === 0 ? (
              <p className="text-xs text-slate-500">No datasets imported yet.</p>
            ) : (
              datasets.map((d) => (
                <div
                  key={d.id}
                  className={`flex items-start justify-between gap-2 p-2.5 rounded border text-xs transition-colors ${
                    selectedDatasetId === d.id
                      ? 'border-cyan-600/80 bg-[#070B12] text-slate-100'
                      : 'border-slate-800/70 bg-[#0A0F18] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <button onClick={() => inspectDataset(d.id)} className="flex-1 text-left min-w-0">
                    <div className="font-medium truncate">
                      {d.is_synthetic ? 'SYNTHETIC DATA · ' : ''}
                      {d.name}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                      {d.format.toUpperCase()} · n={d.row_count} · {d.col_count} vars · missing={d.missing_count}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteDataset(d.id)}
                    title="Delete dataset"
                    aria-label={`Delete ${d.name}`}
                    className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Variable Statistics & Visualisation */}
        <div className="lg:col-span-2 space-y-5">
          {activeDataset && (
            <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
              {Boolean(activeDataset.is_synthetic) && (
                <div className="p-2.5 border border-amber-700/70 bg-amber-950/40 rounded text-xs font-mono text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  SYNTHETIC DATA — Simulated demonstration measurements for statistical workflow verification only.
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">{activeDataset.name}</h2>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                    Format: {activeDataset.format.toUpperCase()} · Observations (n)={activeDataset.row_count} · Variables={activeDataset.col_count} · Total Missing Cells={activeDataset.missing_count}
                  </div>
                </div>
              </div>

              {vcfSummary && (
                <div className="border border-slate-800 bg-[#070B12] rounded p-3 text-xs font-mono space-y-1">
                  <div className="text-cyan-400">VCF Variant Call Summary ({vcfSummary.fileFormat})</div>
                  <div className="text-slate-300">
                    Variants: {vcfSummary.variantCount} · FILTER=PASS: {vcfSummary.filterPassCount} · Samples: {vcfSummary.sampleIds.join(', ') || 'None'}
                  </div>
                </div>
              )}

              {/* Descriptive Statistics Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-mono text-slate-400">
                      <th className="py-2 pr-3">Variable</th>
                      <th className="py-2 px-2">Type</th>
                      <th className="py-2 px-2 text-right">n</th>
                      <th className="py-2 px-2 text-right">Missing</th>
                      <th className="py-2 px-2 text-right">Mean</th>
                      <th className="py-2 px-2 text-right">SD</th>
                      <th className="py-2 px-2 text-right">Median</th>
                      <th className="py-2 pl-2 text-right">95% CI (Mean)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                    {parsedVars.map((v) => (
                      <tr key={v.name} className="hover:bg-slate-800/20">
                        <td className="py-2 pr-3 font-sans font-medium text-slate-200">{v.name}</td>
                        <td className="py-2 px-2 text-slate-400">{v.dataType}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{v.nonMissingCount}</td>
                        <td className={`py-2 px-2 text-right ${v.missingCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                          {v.missingCount}
                        </td>
                        <td className="py-2 px-2 text-right text-cyan-300">{v.mean ?? '—'}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{v.std ?? '—'}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{v.median ?? '—'}</td>
                        <td className="py-2 pl-2 text-right text-slate-400">
                          {v.ci95Low !== null && v.ci95High !== null ? `[${v.ci95Low}, ${v.ci95High}]` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Expression / Feature Mean Visualisation */}
              {numericVars.length > 0 && (
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <div className="text-[11px] font-mono text-slate-400">
                    Numeric Variable Mean Distribution (n={activeDataset.row_count}) · Statistical distribution does not imply biological causality
                  </div>
                  <div className="space-y-1.5">
                    {numericVars.slice(0, 8).map((v) => {
                      const pct = Math.min(100, (Math.abs(v.mean ?? 0) / maxMean) * 100);
                      return (
                        <div key={v.name} className="flex items-center gap-3 text-xs">
                          <div className="w-32 truncate font-mono text-slate-300">{v.name}</div>
                          <div className="flex-1 h-4 bg-[#070B12] border border-slate-800 rounded-sm overflow-hidden">
                            <div className="h-full bg-cyan-600/80" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="w-20 text-right font-mono tabular-nums text-slate-300">{v.mean}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Preview Rows */}
              {previewRows.length > 0 && (
                <div className="pt-3 border-t border-slate-800/80">
                  <div className="text-[11px] font-mono text-slate-400 mb-2">Sample Matrix Preview (First 8 Rows)</div>
                  <div className="overflow-x-auto max-h-52">
                    <table className="w-full text-left text-[11px] font-mono tabular-nums border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          {Object.keys(previewRows[0]).map((k) => (
                            <th key={k} className="py-1.5 px-2 whitespace-nowrap">
                              {k}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {previewRows.slice(0, 8).map((row, i) => (
                          <tr key={i}>
                            {Object.values(row).map((val, j) => (
                              <td key={j} className="py-1 px-2 text-slate-300 whitespace-nowrap">
                                {val === null ? <span className="text-amber-500">NA</span> : String(val)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Live cBioPortal / TCGA & NCI GDC Multi-Omics Connector */}
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                Live Public Multi-Omics Explorer (cBioPortal / TCGA &amp; NCI GDC)
              </h2>
              <span className="text-[11px] font-mono text-slate-500">Live Public API Connector</span>
            </div>

            <form onSubmit={queryPublicOmics} className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
              <input
                value={omicsCancerQuery}
                onChange={(e) => setOmicsCancerQuery(e.target.value)}
                placeholder="Cancer subtype (e.g. lung adenocarcinoma, breast)"
                className="md:col-span-2 px-3 py-2 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
              <input
                value={omicsGenesQuery}
                onChange={(e) => setOmicsGenesQuery(e.target.value)}
                placeholder="HGNC symbols (e.g. TP53, EGFR, KRAS)"
                className="md:col-span-2 px-3 py-2 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
              <button
                type="submit"
                disabled={omicsLoading}
                className="px-3 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded disabled:opacity-50"
              >
                {omicsLoading ? 'Querying...' : 'Fetch TCGA / GDC'}
              </button>
            </form>

            {omicsData && (
              <div className="space-y-3 pt-2">
                {omicsData.errors.length > 0 && (
                  <div className="p-2.5 border border-amber-800/60 bg-amber-950/20 rounded text-[11px] font-mono text-amber-300">
                    Partial source notice: {omicsData.errors.map((e) => `${e.source}: ${e.message}`).join(' · ')}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-2">
                    <div className="text-[11px] font-mono text-cyan-400">
                      Cohort Studies ({omicsData.studies.length})
                    </div>
                    {omicsData.studies.length === 0 ? (
                      <p className="text-xs text-slate-500">No studies matched keyword.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto text-xs">
                        {omicsData.studies.map((st) => (
                          <div key={`${st.source}-${st.studyId}`} className="border-b border-slate-800/60 pb-1.5 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-slate-200 font-medium truncate">{st.name}</div>
                              <div className="text-[11px] font-mono text-slate-400">
                                {st.source} · {st.studyId} · {st.sampleCount ?? '—'} samples
                              </div>
                            </div>
                            <a
                              href={st.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-teal-400">
                        NCI GDC Somatic Variants ({omicsData.mutations.length})
                      </span>
                      {omicsData.mutations.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setGeneInput(Array.from(new Set(omicsData.mutations.map((m) => m.gene))).join(', '))
                          }
                          className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                        >
                          Send Genes to ORA →
                        </button>
                      )}
                    </div>
                    {omicsData.mutations.length === 0 ? (
                      <p className="text-xs text-slate-500">No GDC SSM hits for queried genes.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto text-xs">
                        {omicsData.mutations.map((m) => (
                          <div key={m.ssmId} className="border-b border-slate-800/60 pb-1.5 flex items-center justify-between gap-2 font-mono">
                            <div className="min-w-0">
                              <span className="text-cyan-300 font-semibold">{m.gene}</span>{' '}
                              <span className="text-slate-200">{m.aaChange}</span>
                              <div className="text-[10px] text-slate-500 truncate">{m.consequenceType}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 text-[11px]">
                              <span className="text-emerald-400 tabular-nums">{m.caseCount} cases</span>
                              <a href={m.url} target="_blank" rel="noreferrer" className="text-cyan-400">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Pathway Enrichment Interface */}
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
                Pathway Enrichment Workflow (Over-Representation Analysis)
              </h2>
              {numericVars.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setGeneInput(
                      numericVars
                        .map((v) => v.name.replace(/_expr$/i, '').toUpperCase())
                        .filter((s) => /^[A-Z0-9-]{2,12}$/.test(s))
                        .join(', ')
                    )
                  }
                  className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                >
                  Use Dataset Symbols
                </button>
              )}
            </div>
            <form onSubmit={runPathwayEnrichment} className="space-y-2.5">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  value={geneInput}
                  onChange={(e) => setGeneInput(e.target.value)}
                  placeholder="Enter HGNC gene symbols separated by commas (e.g., TP53, BRCA1, CD274)"
                  className="flex-1 px-3 py-2 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
                />
                <button
                  type="submit"
                  disabled={pathwayLoading}
                  className="px-4 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-slate-950 rounded shrink-0 disabled:opacity-50"
                >
                  {pathwayLoading ? 'Analyzing...' : 'Run Pathway ORA'}
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useLivePathways}
                  onChange={(e) => setUseLivePathways(e.target.checked)}
                  className="accent-teal-500"
                />
                Augment curated Hallmark ORA with live Reactome &amp; KEGG gene-set queries (Enrichr API)
              </label>
            </form>

            {pathwayResult && (
              <div className="space-y-3 pt-2">
                <div className="text-[11px] font-mono text-slate-400">
                  Method: {pathwayResult.methodology} · Input Genes: {pathwayResult.inputGeneCount}
                </div>
                {pathwayResult.results.length === 0 ? (
                  <p className="text-xs text-slate-400">No overlaps detected against curated hallmark cancer gene panels.</p>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] font-mono text-slate-400">
                        <th className="py-1.5">Curated Hallmark Pathway</th>
                        <th className="py-1.5 text-right">Overlap</th>
                        <th className="py-1.5 text-right">p-value</th>
                        <th className="py-1.5 text-right">FDR</th>
                        <th className="py-1.5 pl-3">Matched Genes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 font-mono tabular-nums">
                      {pathwayResult.results.map((r) => (
                        <tr key={r.pathwayId}>
                          <td className="py-1.5 font-sans text-slate-200">{r.pathwayName}</td>
                          <td className="py-1.5 text-right text-cyan-300">
                            {r.overlapCount}/{r.pathwaySize}
                          </td>
                          <td className="py-1.5 text-right text-slate-300">{r.pValue}</td>
                          <td className="py-1.5 text-right text-teal-300">{r.fdrAdjustedP}</td>
                          <td className="py-1.5 pl-3 text-slate-400">{r.overlappingGenes.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {pathwayResult.liveErrors && pathwayResult.liveErrors.length > 0 && (
                  <div className="p-2 border border-amber-800/60 bg-amber-950/20 rounded text-[11px] font-mono text-amber-300">
                    Live Enrichr connector note: {pathwayResult.liveErrors.map((e) => `${e.source}: ${e.message}`).join('; ')}
                  </div>
                )}

                {pathwayResult.livePathways && pathwayResult.livePathways.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="text-[11px] font-mono text-cyan-400">
                      Live Reactome 2022 &amp; KEGG 2021 Human Enrichment ({pathwayResult.livePathways.length} top pathways)
                    </div>
                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 text-[11px] font-mono text-slate-400">
                            <th className="py-1.5">Source</th>
                            <th className="py-1.5">Pathway Term</th>
                            <th className="py-1.5 text-right">Overlap</th>
                            <th className="py-1.5 text-right">FDR</th>
                            <th className="py-1.5 pl-3">Genes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 font-mono tabular-nums">
                          {pathwayResult.livePathways.map((lp, i) => (
                            <tr key={`${lp.sourceDb}-${lp.pathwayId}-${i}`}>
                              <td className="py-1.5 text-cyan-400 pr-2">{lp.sourceDb.replace('_2022', '').replace('_2021_Human', '')}</td>
                              <td className="py-1.5 font-sans text-slate-200 pr-2">{lp.pathwayName}</td>
                              <td className="py-1.5 text-right text-slate-300">{lp.overlapCount}</td>
                              <td className="py-1.5 text-right text-teal-300">{lp.fdrAdjustedP}</td>
                              <td className="py-1.5 pl-3 text-slate-400">{lp.overlappingGenes.join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-slate-500">{pathwayResult.limitation}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
