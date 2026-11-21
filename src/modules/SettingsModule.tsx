import React, { useEffect, useState } from 'react';
import { Download, Save } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { User } from '../types';

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  created_at: string;
}

interface SettingsModuleProps {
  user: User | null;
  onOpenAuth: () => void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({ user, onOpenAuth }) => {
  const [model, setModel] = useState('gemini-4-hydrogen');
  const [retentionDays, setRetentionDays] = useState('365');
  const [allowExternalGrounding, setAllowExternalGrounding] = useState(true);
  const [maxIterationsCap, setMaxIterationsCap] = useState('6');
  const [confidenceThreshold, setConfidenceThreshold] = useState('0.95');
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const loadSettings = async () => {
    if (!user) {
      setAuditLogs([]);
      return;
    }
    try {
      const res = await apiFetch<{ settings: Array<{ key: string; value: string }>; auditLogs: AuditRow[] }>('/api/settings');
      for (const s of res.settings) {
        if (s.key === 'gemini_model') setModel(s.value);
        if (s.key === 'data_retention_days') setRetentionDays(s.value);
        if (s.key === 'allow_external_literature_grounding') setAllowExternalGrounding(s.value === 'true');
        if (s.key === 'autonomous_max_iterations_cap') setMaxIterationsCap(s.value);
        if (s.key === 'physician_review_confidence_threshold') setConfidenceThreshold(s.value);
      }
      setAuditLogs(res.auditLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workstation configuration');
    }
  };

  useEffect(() => {
    loadSettings();
  }, [user?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setStatus('');
    setError('');
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          gemini_model: model,
          data_retention_days: Number(retentionDays) || 365,
          allow_external_literature_grounding: allowExternalGrounding,
          autonomous_max_iterations_cap: Math.max(1, Math.min(10, Number(maxIterationsCap) || 6)),
          physician_review_confidence_threshold: Math.max(
            0.9,
            Math.min(0.99, Number(confidenceThreshold) || 0.95),
          ),
        }),
      });
      setStatus('Workstation configuration saved.');
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings');
    }
  };

  const handleExportUserData = async () => {
    if (!user) return onOpenAuth();
    try {
      const res = await apiFetch('/api/settings/export-user-data');
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CURE_User_Data_${user.email}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="text-xl font-semibold text-slate-100">Settings & Research Governance</h1>
        <p className="text-xs text-slate-400 mt-1">
          Model selection, data retention policy, privacy documentation, personal data export, and security audit trail
        </p>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}
      {status && (
        <div className="p-3 border border-emerald-800/60 bg-emerald-950/30 rounded text-xs text-emerald-300">{status}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSave} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4 text-xs">
          <h2 className="font-semibold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-2">
            AI Engine & Data Retention Configuration
          </h2>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Gemini Model Selection (Server-Side)</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            >
              <option value="gemini-4-hydrogen">gemini-4-hydrogen (Default Balanced Research Model)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Low-Latency Summarisation)</option>
              <option value="gemini-4-argon">gemini-4-argon (Complex STEM Reasoning — Requires Paid Key)</option>
              <option value="gemini-4-carbon">gemini-4-carbon (Deep Scientific Synthesis — Requires Paid Key)</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              API keys are managed strictly on the server via Secrets / environment variables and are never exposed in browser code.
            </p>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Data Retention Period (Days)</label>
            <input
              type="number"
              min={30}
              max={3650}
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              className="w-full px-3 py-2 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Autonomous Max Iterations Cap (1–10)</label>
              <input
                type="number"
                min={1}
                max={10}
                step={1}
                value={maxIterationsCap}
                onChange={(e) => setMaxIterationsCap(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Physician Validation Threshold (0.90–0.99)
              </label>
              <input
                type="number"
                min={0.9}
                max={0.99}
                step={0.01}
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Immutable safety floor enforced at ≥ 90% on server.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allowExternalGrounding}
              onChange={(e) => setAllowExternalGrounding(e.target.checked)}
              className="accent-cyan-500"
            />
            Allow automated queries to public PubMed / Europe PMC endpoints during AI investigations
          </label>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
            >
              <Save className="w-3.5 h-3.5" /> Save Configuration
            </button>
            <button
              type="button"
              onClick={handleExportUserData}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-700 hover:border-cyan-500 text-slate-200 rounded"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" /> Export My Research Data
            </button>
          </div>
        </form>

        {/* Privacy, Security & Ethics Documentation */}
        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 text-xs">
          <h2 className="font-semibold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-2">
            Privacy, Security & Research Ethics Policy
          </h2>
          <ul className="space-y-2 text-slate-300 list-disc list-inside leading-relaxed">
            <li>Treat all uploaded biomedical datasets and histopathology images as potentially sensitive research data.</li>
            <li>De-identification is never assumed infallible; avoid uploading direct patient identifiers (PHI).</li>
            <li>Uploaded datasets are NOT used to train or fine-tune external AI models.</li>
            <li>Do not transmit sensitive clinical records to external services without institutional data-sharing approval.</li>
            <li>
              <strong>Regulatory Notice:</strong> Implementation of authentication, RBAC, and audit logging does NOT constitute HIPAA, GDPR, or FDA regulatory certification.
            </li>
            <li>
              <strong>Scientific Policy:</strong> Project C.U.R.E. is a research intelligence system, not a medical device or clinical decision tool.
            </li>
          </ul>
        </section>
      </div>

      {/* Audit Log Viewer */}
      {user && (
        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 text-xs">
          <h2 className="font-semibold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-2">
            Security & Access Audit Log
          </h2>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-left border-collapse font-mono text-[11px] tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-1.5">Timestamp (UTC)</th>
                  <th className="py-1.5">Actor</th>
                  <th className="py-1.5">Action</th>
                  <th className="py-1.5">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {auditLogs.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5 text-slate-400">{a.created_at}</td>
                    <td className="py-1.5 text-slate-200">{a.actor_name || 'System'}</td>
                    <td className="py-1.5 text-cyan-300">{a.action}</td>
                    <td className="py-1.5 text-slate-400">
                      {a.entity_type} {a.entity_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
