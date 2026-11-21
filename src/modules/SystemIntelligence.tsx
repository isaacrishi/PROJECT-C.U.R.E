import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { User } from '../types';

interface SystemHealthPayload {
  gemini: {
    configured: boolean;
    activeModel: string;
    totalResponses: number;
    totalTokens: number;
    avgLatencyMs: number;
  };
  database: {
    engine: string;
    sizeBytes: number;
    status: string;
  };
  literatureApis: Array<{
    id: string;
    name: string;
    status: 'connected' | 'unreachable';
    latency_ms: number;
    detail: string;
  }>;
  jobs: Array<{
    id: string;
    job_type: string;
    status: string;
    latency_ms: number;
    error_message: string;
    created_at: string;
  }>;
  evaluations: Array<{
    id: string;
    evaluation_type: string;
    citation_verified: number;
    consistency_score: number | null;
    unsupported_claims_json: string;
    contradictory_notes: string;
    evaluator_notes: string;
    created_at: string;
  }>;
}

interface SystemIntelligenceProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
}

export const SystemIntelligence: React.FC<SystemIntelligenceProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
}) => {
  const [health, setHealth] = useState<SystemHealthPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimText, setClaimText] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState('');

  const loadHealth = async () => {
    if (!user) {
      setHealth(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<SystemHealthPayload>('/api/system/health');
      setHealth(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to probe system health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHealth();
  }, [user?.id]);

  const runEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    if (!claimText.trim()) return;
    setEvaluating(true);
    setError('');
    try {
      await apiFetch('/api/system/evaluate', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProjectId, claimText: claimText.trim() }),
      });
      setClaimText('');
      await loadHealth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">System Intelligence</h1>
          <p className="text-xs text-slate-400 mt-1">
            Live integration telemetry, database health, task execution history, and scientific claim verification workflows
          </p>
        </div>
        <button
          onClick={loadHealth}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-700 hover:border-cyan-500 rounded text-slate-200"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Run Live Health Probes
        </button>
      </div>

      {!user && (
        <div className="border border-slate-800 bg-[#0D131F] rounded-md p-5 text-xs text-slate-300 flex items-center justify-between">
          <span>Sign in to view system diagnostics and execute scientific consistency audits.</span>
          <button onClick={onOpenAuth} className="px-3.5 py-1.5 bg-cyan-600 text-slate-950 font-semibold rounded">
            Sign In
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      {health && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="border border-slate-800 bg-[#0D131F] rounded-md p-4 space-y-2">
              <div className="font-mono text-[11px] text-slate-400">AI Model & Token Telemetry</div>
              <div className="text-sm font-semibold text-slate-100">{health.gemini.activeModel}</div>
              <div className="font-mono tabular-nums space-y-1 text-slate-300">
                <div>
                  API Status:{' '}
                  <span className={health.gemini.configured ? 'text-emerald-400' : 'text-amber-400'}>
                    {health.gemini.configured ? '● Key Present' : '▲ Key Missing'}
                  </span>
                </div>
                <div>Responses Logged: {health.gemini.totalResponses}</div>
                <div>Total Tokens: {health.gemini.totalTokens}</div>
                <div>Mean Latency: {health.gemini.avgLatencyMs} ms</div>
              </div>
            </div>

            <div className="border border-slate-800 bg-[#0D131F] rounded-md p-4 space-y-2">
              <div className="font-mono text-[11px] text-slate-400">Database & Storage</div>
              <div className="text-sm font-semibold text-slate-100">{health.database.engine}</div>
              <div className="font-mono tabular-nums space-y-1 text-slate-300">
                <div>Status: <span className="text-emerald-400">● {health.database.status}</span></div>
                <div>DB File Size: {(health.database.sizeBytes / 1024).toFixed(1)} KB</div>
                <div>Autonomous Code/DB Edits: <span className="text-cyan-400">Disabled (Audited Only)</span></div>
              </div>
            </div>

            <div className="border border-slate-800 bg-[#0D131F] rounded-md p-4 space-y-2">
              <div className="font-mono text-[11px] text-slate-400">Live Literature API Probes</div>
              <div className="space-y-1.5 font-mono text-[11px]">
                {health.literatureApis.map((api) => (
                  <div key={api.id} className="flex justify-between gap-2">
                    <span className="text-slate-300 truncate">{api.name}</span>
                    <span className={api.status === 'connected' ? 'text-emerald-400 shrink-0' : 'text-rose-400 shrink-0'}>
                      {api.status === 'connected' ? `● ${api.latency_ms}ms` : `✖ ${api.detail}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Scientific Claim & Citation Evaluator */}
            <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 text-xs">
              <h2 className="font-semibold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-2">
                AI Output Evaluation Workflow
              </h2>
              <p className="text-slate-400">
                Audit a hypothesis or scientific summary against your project&apos;s saved literature for citation verification, unsupported claims, and correlation-vs-causation leaps.
              </p>
              <form onSubmit={runEvaluation} className="space-y-2.5">
                <textarea
                  required
                  rows={3}
                  value={claimText}
                  onChange={(e) => setClaimText(e.target.value)}
                  placeholder="Paste scientific statement or hypothesis text to audit..."
                  className="w-full px-3 py-2 bg-[#070B12] border border-slate-800 rounded text-slate-100"
                />
                <button
                  type="submit"
                  disabled={evaluating}
                  className="flex items-center gap-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded disabled:opacity-50"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {evaluating ? 'Auditing Claims...' : 'Run Citation & Consistency Audit'}
                </button>
              </form>

              <div className="space-y-2 pt-2 border-t border-slate-800 max-h-60 overflow-y-auto">
                {health.evaluations.map((ev) => {
                  let unsupported: string[] = [];
                  try {
                    unsupported = JSON.parse(ev.unsupported_claims_json);
                  } catch {
                    unsupported = [];
                  }
                  return (
                    <div key={ev.id} className="p-3 border border-slate-800 bg-[#070B12] rounded space-y-1">
                      <div className="flex justify-between font-mono text-[11px]">
                        <span className={ev.citation_verified ? 'text-emerald-400' : 'text-amber-400'}>
                          {ev.citation_verified ? '● Citations Verified' : '▲ Unverified / Partial Support'}
                        </span>
                        <span className="text-slate-400">Consistency: {ev.consistency_score ?? 'N/A'}</span>
                      </div>
                      {unsupported.length > 0 && (
                        <div className="text-amber-300 text-[11px]">Unsupported: {unsupported.join('; ')}</div>
                      )}
                      {ev.contradictory_notes && (
                        <div className="text-slate-300 text-[11px]">{ev.contradictory_notes}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Task & Failure History */}
            <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 text-xs">
              <h2 className="font-semibold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-2">
                Analysis Task & Failure History
              </h2>
              {health.jobs.length === 0 ? (
                <p className="text-slate-500">No computational or AI tasks executed yet.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto font-mono">
                  {health.jobs.map((j) => (
                    <div key={j.id} className="p-2.5 border border-slate-800 bg-[#070B12] rounded">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-200">{j.job_type}</span>
                        <span className={j.status === 'failed' ? 'text-rose-400' : 'text-emerald-400'}>
                          {j.status} · {j.latency_ms}ms
                        </span>
                      </div>
                      {j.error_message && <div className="text-[11px] text-rose-300 mt-1">{j.error_message}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
};
