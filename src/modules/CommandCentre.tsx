import React, { useEffect, useState } from 'react';
import { ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ModuleId, User } from '../types';

interface DashboardData {
  overview: {
    totalProjects: number;
    activeInvestigations: number;
    literatureIndexed: number;
    datasetsImported: number;
    hypothesesGenerated: number;
    hypothesesUnderEvaluation: number;
    experimentsDocumented: number;
    validatedFindings: number;
    simulationsExecuted?: number;
    autonomousIterations?: number;
    pendingPhysicianReviews?: number;
  };
  recentActivity: Array<{
    id: string;
    action: string;
    entity_type: string;
    actor_name: string | null;
    created_at: string;
  }>;
  recentInvestigations: Array<{
    id: string;
    title: string;
    cancer_type: string;
    project_id: string | null;
    updated_at: string;
  }>;
  intelligenceSummary: {
    activeCancerTypes: Array<{ cancer_area: string; count: number }>;
    knowledgeGapsCount: number;
  };
  systemStatus: {
    geminiApi: string;
    geminiModel: string;
    database: string;
    fileStorage: string;
    runningJobs: number;
    confidenceThreshold?: number;
    maxIterationsCap?: number;
  };
}

interface CommandCentreProps {
  user: User | null;
  onNavigate: (module: ModuleId) => void;
  onOpenAuth: () => void;
}

export const CommandCentre: React.FC<CommandCentreProps> = ({ user, onNavigate, onOpenAuth }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<DashboardData>('/api/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const ov = data?.overview ?? {
    totalProjects: 0,
    activeInvestigations: 0,
    literatureIndexed: 0,
    datasetsImported: 0,
    hypothesesGenerated: 0,
    hypothesesUnderEvaluation: 0,
    experimentsDocumented: 0,
    validatedFindings: 0,
  };

  const isEmpty =
    ov.totalProjects === 0 &&
    ov.activeInvestigations === 0 &&
    ov.literatureIndexed === 0 &&
    ov.datasetsImported === 0 &&
    ov.hypothesesGenerated === 0;

  const metrics = [
    { label: 'Total Research Projects', value: ov.totalProjects, unit: 'projects' },
    { label: 'Active Investigations', value: ov.activeInvestigations, unit: 'threads' },
    { label: 'Literature Sources Indexed', value: ov.literatureIndexed, unit: 'records' },
    { label: 'Research Datasets Imported', value: ov.datasetsImported, unit: 'datasets' },
    { label: 'Hypotheses Generated', value: ov.hypothesesGenerated, unit: 'total' },
    { label: 'Hypotheses Under Evaluation', value: ov.hypothesesUnderEvaluation, unit: 'active' },
    { label: 'Experiments Documented', value: ov.experimentsDocumented, unit: 'proposals' },
    { label: 'Validated Research Findings', value: ov.validatedFindings, unit: 'verified' },
    { label: 'Autonomous Iterations', value: ov.autonomousIterations ?? 0, unit: 'cycles' },
    { label: '3D Biological Simulations', value: ov.simulationsExecuted ?? 0, unit: 'runs' },
    { label: 'Physician Review Queue', value: ov.pendingPhysicianReviews ?? 0, unit: 'pending' },
    {
      label: 'Confidence Validation Gate',
      value: `${((data?.systemStatus.confidenceThreshold ?? 0.95) * 100).toFixed(1)}%`,
      unit: 'threshold',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Command Centre</h1>
          <p className="text-xs text-slate-400 mt-1">
            Continuous Understanding and Research Engine · Live database telemetry and active oncology research overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-800 hover:border-slate-700 rounded bg-[#0D131F] text-slate-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={() => onNavigate('biological_simulation')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-cyan-800/70 hover:border-cyan-500 rounded bg-[#0D131F] text-cyan-300 transition-colors"
          >
            Open 3D Bio Simulation
          </button>
          <button
            onClick={() => (user ? onNavigate('research_projects') : onOpenAuth())}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {user ? 'New Research Project' : 'Sign In to Start'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      {/* A. RESEARCH OVERVIEW */}
      <section>
        <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase mb-3">
          A. Research Overview
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4">
              <div className="text-xs text-slate-400 truncate">{m.label}</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold font-mono tabular-nums text-slate-100">{m.value}</span>
                <span className="text-[11px] font-mono text-slate-500">{m.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* EMPTY DATABASE ONBOARDING WORKFLOW */}
      {isEmpty && (
        <section className="border border-cyan-900/50 bg-[#0B121F] rounded-md p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Research Database Initialised — Zero Stored Records
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                All Command Centre counters strictly reflect persisted records. Follow the structured workflow below to
                begin an empirical cancer research investigation.
              </p>
            </div>
            {!user && (
              <button
                onClick={onOpenAuth}
                className="px-3.5 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded"
              >
                Sign In / Register Researcher
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-800/70">
            <div className="space-y-2">
              <div className="text-xs font-mono text-cyan-400">01. Establish Research Project</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Create a persistent, access-controlled workspace specifying cancer area, primary objective, and research questions.
              </p>
              <button
                onClick={() => (user ? onNavigate('research_projects') : onOpenAuth())}
                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
              >
                Open Research Projects <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-mono text-cyan-400">02. Query Live Literature & Import Data</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Search live PubMed, Europe PMC, Crossref, and ClinicalTrials.gov endpoints or import CSV/TSV/VCF datasets.
              </p>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => onNavigate('literature_intelligence')}
                  className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  Literature Search <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onNavigate('molecular_intelligence')}
                  className="inline-flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 font-medium"
                >
                  Import Dataset <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-mono text-cyan-400">03. Launch 10-Step AI Investigation</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Run Gemini-assisted multi-step synthesis grounded in retrieved citations, then evaluate candidate hypotheses.
              </p>
              <button
                onClick={() => onNavigate('ai_research_engine')}
                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium"
              >
                Open AI Research Engine <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* B. RESEARCH ACTIVITY */}
        <section className="lg:col-span-2 border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
              B. Recent Research Activity
            </h2>
            <span className="text-[11px] font-mono text-slate-500">Audit Trail</span>
          </div>

          {!data?.recentActivity?.length ? (
            <p className="text-xs text-slate-500 py-6">
              No activity events recorded for the current session yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {data.recentActivity.map((act) => (
                <div key={act.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <span className="font-mono text-cyan-300">{act.action}</span>
                    <span className="text-slate-500 mx-1.5">·</span>
                    <span className="text-slate-300">{act.entity_type}</span>
                    {act.actor_name && (
                      <>
                        <span className="text-slate-500 mx-1.5">·</span>
                        <span className="text-slate-400">{act.actor_name}</span>
                      </>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                    {new Date(act.created_at + 'Z').toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {data && data.recentInvestigations.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80">
              <div className="text-[11px] font-mono text-slate-400 mb-2">Recent Investigations</div>
              <div className="space-y-1.5">
                {data.recentInvestigations.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => onNavigate('ai_research_engine')}
                    className="w-full text-left px-3 py-2 rounded border border-slate-800/80 hover:border-cyan-700/70 bg-[#070B12] flex items-center justify-between text-xs"
                  >
                    <span className="text-slate-200 truncate">{inv.title}</span>
                    <span className="font-mono text-[11px] text-slate-500 ml-3 shrink-0">
                      {inv.cancer_type || 'General'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* C & D. RESEARCH INTELLIGENCE & SYSTEM STATUS */}
        <div className="space-y-6">
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3">
            <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase border-b border-slate-800/80 pb-2.5">
              C. Research Intelligence
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Open Knowledge Gaps / Inconclusive</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {data?.intelligenceSummary.knowledgeGapsCount ?? 0}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                <div className="text-slate-400 mb-1.5">Investigated Cancer Areas</div>
                {data?.intelligenceSummary.activeCancerTypes?.length ? (
                  <div className="space-y-1">
                    {data.intelligenceSummary.activeCancerTypes.map((ct) => (
                      <div key={ct.cancer_area} className="flex justify-between font-mono text-[11px]">
                        <span className="text-slate-300">{ct.cancer_area}</span>
                        <span className="text-cyan-400 tabular-nums">{ct.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">No cancer areas indexed yet.</p>
                )}
              </div>
            </div>
          </section>

          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-2.5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">D. System Status</h2>
              <button
                onClick={() => onNavigate('system_intelligence')}
                className="text-[11px] text-cyan-400 hover:text-cyan-300"
              >
                Diagnostics
              </button>
            </div>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Gemini API</span>
                <span className={data?.systemStatus.geminiApi === 'configured' ? 'text-emerald-400' : 'text-amber-400'}>
                  {data?.systemStatus.geminiApi === 'configured' ? '● Configured' : '▲ Key Missing'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Active Model</span>
                <span className="text-slate-200">{data?.systemStatus.geminiModel ?? 'gemini-4-hydrogen'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Database</span>
                <span className="text-emerald-400">● SQLite WAL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">File Storage</span>
                <span className={data?.systemStatus.fileStorage === 'online' ? 'text-emerald-400' : 'text-rose-400'}>
                  {data?.systemStatus.fileStorage === 'online' ? '● Online' : '✖ Unavailable'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Active Jobs</span>
                <span className="text-slate-200 tabular-nums">{data?.systemStatus.runningJobs ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Autonomous Max Cap</span>
                <span className="text-cyan-300 tabular-nums">{data?.systemStatus.maxIterationsCap ?? 6} iter</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
