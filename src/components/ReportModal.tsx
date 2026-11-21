import React, { useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, FileJson, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  exportReportCsv,
  exportReportDocx,
  exportReportJson,
  exportReportPdf,
  type CompiledReportPayload,
} from '../lib/reportExport';

interface ReportModalProps {
  isOpen: boolean;
  projectId: string | null;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({ isOpen, projectId, onClose }) => {
  const [payload, setPayload] = useState<CompiledReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleExport = async (format: 'PDF' | 'DOCX' | 'CSV' | 'JSON') => {
    if (!payload) return;
    setError('');
    setExportingFormat(format);
    try {
      if (format === 'PDF') exportReportPdf(payload);
      else if (format === 'DOCX') await exportReportDocx(payload);
      else if (format === 'CSV') exportReportCsv(payload);
      else exportReportJson(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to export ${format} report.`);
    } finally {
      setExportingFormat(null);
    }
  };

  useEffect(() => {
    if (!isOpen || !projectId) {
      setPayload(null);
      return;
    }
    setPayload(null);
    setLoading(true);
    setError('');
    apiFetch<CompiledReportPayload>(`/api/reports/project/${projectId}`)
      .then((res) => setPayload(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to compile report'))
      .finally(() => setLoading(false));
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col border border-slate-800 bg-[#0D131F] rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Scientific Research Report Generator</h2>
            <p className="text-xs text-slate-400">
              Separates computational results, literature evidence, manual observations, and AI interpretations
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1" aria-label="Close report dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {!projectId && (
            <div className="p-4 border border-amber-800/50 bg-amber-950/20 rounded text-xs text-amber-200">
              Select an active research project in the workspace header before compiling a report.
            </div>
          )}

          {loading && <div className="text-xs text-slate-400 font-mono">Compiling traceable project records...</div>}

          {error && (
            <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
          )}

          {payload && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  disabled={exportingFormat !== null}
                  onClick={() => handleExport('PDF')}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 rounded transition-colors"
                >
                  <FileDown className="w-4 h-4" /> {exportingFormat === 'PDF' ? 'Exporting...' : 'Export PDF'}
                </button>
                <button
                  disabled={exportingFormat !== null}
                  onClick={() => handleExport('DOCX')}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium border border-slate-700 hover:border-cyan-500 disabled:opacity-50 text-slate-100 bg-[#070B12] rounded transition-colors"
                >
                  <FileText className="w-4 h-4 text-cyan-400" /> {exportingFormat === 'DOCX' ? 'Exporting...' : 'Export DOCX'}
                </button>
                <button
                  disabled={exportingFormat !== null}
                  onClick={() => handleExport('CSV')}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium border border-slate-700 hover:border-cyan-500 disabled:opacity-50 text-slate-100 bg-[#070B12] rounded transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-teal-400" /> {exportingFormat === 'CSV' ? 'Exporting...' : 'Export CSV'}
                </button>
                <button
                  disabled={exportingFormat !== null}
                  onClick={() => handleExport('JSON')}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium border border-slate-700 hover:border-cyan-500 disabled:opacity-50 text-slate-100 bg-[#070B12] rounded transition-colors"
                >
                  <FileJson className="w-4 h-4 text-slate-300" /> {exportingFormat === 'JSON' ? 'Exporting...' : 'Export JSON'}
                </button>
              </div>

              <div className="border border-slate-800 rounded bg-[#070B12] p-5 space-y-4 text-xs">
                <div className="border-b border-slate-800 pb-3">
                  <div className="text-sm font-semibold text-slate-100">{payload.project.name}</div>
                  <div className="text-slate-400 mt-1">
                    {payload.project.cancer_area} · Compiled {new Date(payload.generatedAt).toLocaleString()} · Investigator:{' '}
                    {payload.generatedBy}
                  </div>
                </div>

                <div>
                  <div className="font-mono text-[11px] text-cyan-400 mb-1">
                    01. Objectives & Study Context [MANUAL OBSERVATION]
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {payload.project.primary_objective || payload.project.description || 'No primary objective recorded.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 pt-2 border-t border-slate-800/80 font-mono tabular-nums">
                  <div>
                    <div className="text-slate-400 text-[11px]">Literature</div>
                    <div className="text-lg font-semibold text-slate-100">{payload.literature.length}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Datasets</div>
                    <div className="text-lg font-semibold text-slate-100">{payload.datasets.length}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Hypotheses</div>
                    <div className="text-lg font-semibold text-slate-100">{payload.hypotheses.length}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Experiments</div>
                    <div className="text-lg font-semibold text-slate-100">{payload.experiments.length}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">3D Sims</div>
                    <div className="text-lg font-semibold text-cyan-300">{payload.simulations?.length ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Auto Cycles</div>
                    <div className="text-lg font-semibold text-teal-300">{payload.autonomousCycles?.length ?? 0}</div>
                  </div>
                </div>

                {payload.literature.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="font-mono text-[11px] text-teal-400 mb-1.5">
                      02. Traceable References [LITERATURE-DERIVED]
                    </div>
                    <ul className="space-y-1.5 text-slate-300">
                      {payload.literature.slice(0, 6).map((l, idx) => (
                        <li key={idx}>
                          <span className="font-mono text-slate-400">
                            [{l.pmid ? `PMID:${l.pmid}` : l.doi ? `DOI:${l.doi}` : l.nct_id || 'REF'}]
                          </span>{' '}
                          {l.title} <span className="text-slate-500">({l.journal}, {l.pub_date})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {payload.hypotheses.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="font-mono text-[11px] text-amber-400 mb-1.5">
                      03. Hypotheses [UNVALIDATED UNTIL EXPERIMENTALLY TESTED]
                    </div>
                    <ul className="space-y-1.5 text-slate-300">
                      {payload.hypotheses.map((h) => (
                        <li key={h.id}>
                          <span className="font-medium text-slate-100">{h.title}</span>{' '}
                          <span className="text-slate-400 font-mono">
                            · {h.status} · {h.confidence_level}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {((payload.simulations?.length ?? 0) > 0 || (payload.autonomousCycles?.length ?? 0) > 0) && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="font-mono text-[11px] text-cyan-400 mb-1.5">
                      04. 3D Simulations & Autonomous Cycles [COMPUTATIONAL SIMULATION — NOT EXPERIMENTAL PROOF]
                    </div>
                    <ul className="space-y-1 text-slate-300 font-mono text-[11px]">
                      {(payload.simulations ?? []).slice(0, 4).map((s) => (
                        <li key={s.id}>
                          [SIM] {s.scenario_name} · {s.treatment_mechanism} ({s.concentration_uM} uM, conf{' '}
                          {(s.summary_confidence * 100).toFixed(1)}%)
                        </li>
                      ))}
                      {(payload.autonomousCycles ?? []).slice(0, 3).map((c) => (
                        <li key={c.id}>
                          [AUTO] {c.goal_prompt.slice(0, 90)}… · {c.status} ({c.completed_iterations}/{c.max_iterations})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
