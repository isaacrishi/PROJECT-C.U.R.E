import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  GitBranch,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { apiFetch, streamSsePost } from '../lib/api';
import type {
  AutonomousCycleRecord,
  AutonomousStageEntry,
  ModelVersionRecord,
  ModuleId,
  PhysicianValidationItem,
  ResearchMemoryRecord,
  TreatmentMechanism,
  User,
} from '../types';

interface AutonomousIntelligenceProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
  onNavigate: (mod: ModuleId) => void;
  onInspectSimulation: (simulationId: string) => void;
  onPlanExperiment?: (hypothesisId: string) => void;
}

const PIPELINE_STAGES = [
  'OBSERVE',
  'ANALYSE',
  'HYPOTHESISE',
  'SIMULATE',
  'MEASURE',
  'EVALUATE',
  'IMPROVE',
  'VERIFY',
  'REPEAT',
] as const;

export const AutonomousIntelligence: React.FC<AutonomousIntelligenceProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
  onNavigate,
  onInspectSimulation,
  onPlanExperiment,
}) => {
  const [activeTab, setActiveTab] = useState<'cycles' | 'memory' | 'models' | 'validation'>('cycles');
  const [cycles, setCycles] = useState<AutonomousCycleRecord[]>([]);
  const [memory, setMemory] = useState<ResearchMemoryRecord[]>([]);
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [queueItems, setQueueItems] = useState<PhysicianValidationItem[]>([]);

  // Cycle launch form
  const [goalPrompt, setGoalPrompt] = useState(
    'Identify therapeutic mechanism and concentration minimizing residual tumour viability while preserving >= 80% normal stromal tissue.'
  );
  const [cancerArea, setCancerArea] = useState('Non-Small Cell Lung Adenocarcinoma');
  const [treatmentFocus, setTreatmentFocus] = useState<TreatmentMechanism>('targeted_kinase_inhibitor');
  const [executionMode, setExecutionMode] = useState<'ai_guided' | 'computational_calibration'>('ai_guided');
  const [maxIterations, setMaxIterations] = useState(3);
  const [initialConc, setInitialConc] = useState(1.8);
  const [initialResistance, setInitialResistance] = useState(0.35);
  const [allowRepro, setAllowRepro] = useState(false);

  // Physician validation adjudication state
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewerCreds, setReviewerCreds] = useState('MD, PhD · Board-Certified Medical Oncologist');
  const [reviewNotes, setReviewNotes] = useState('');

  const [maxIterationsCap, setMaxIterationsCap] = useState(6);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.95);
  const [running, setRunning] = useState(false);
  const [liveProgress, setLiveProgress] = useState<{
    iterationNumber: number;
    stage: string;
    summary: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const loadAll = async () => {
    if (!user) {
      setCycles([]);
      setMemory([]);
      setModels([]);
      setQueueItems([]);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const [cRes, mRes, modRes, valRes, setRes] = await Promise.all([
        apiFetch<{ cycles: AutonomousCycleRecord[] }>(`/api/autonomous/cycles${q}`),
        apiFetch<{ memory: ResearchMemoryRecord[] }>(`/api/autonomous/memory${q}`),
        apiFetch<{ models: ModelVersionRecord[] }>('/api/autonomous/models'),
        apiFetch<{ items: PhysicianValidationItem[] }>(`/api/validation/queue${q}`),
        apiFetch<{ settings: Array<{ key: string; value: string }> }>('/api/settings'),
      ]);
      setCycles(cRes.cycles);
      setMemory(mRes.memory);
      setModels(modRes.models);
      setQueueItems(valRes.items);
      const capSetting = setRes.settings.find((s) => s.key === 'autonomous_max_iterations_cap')?.value;
      const thrSetting = setRes.settings.find((s) => s.key === 'physician_review_confidence_threshold')?.value;
      if (capSetting) {
        const parsedCap = Math.max(1, Math.min(10, Number(capSetting) || 6));
        setMaxIterationsCap(parsedCap);
        setMaxIterations((prev) => Math.min(prev, parsedCap));
      }
      if (thrSetting) {
        setConfidenceThreshold(Math.max(0.9, Math.min(0.99, Number(thrSetting) || 0.95)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to synchronize autonomous engine state.');
    }
  };

  useEffect(() => {
    loadAll();
  }, [user?.id, activeProjectId]);

  const startCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setRunning(true);
    setError('');
    setNotice('');
    setLiveProgress({ iterationNumber: 1, stage: 'OBSERVE', summary: 'Connecting to autonomous loop stream...' });
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    try {
      const outcome: { cycle: AutonomousCycleRecord | null; err: string } = { cycle: null, err: '' };
      await streamSsePost(
        '/api/autonomous/cycles/stream',
        {
          project_id: activeProjectId,
          goal_prompt: goalPrompt,
          cancer_area: cancerArea,
          treatment_focus: treatmentFocus,
          execution_mode: executionMode,
          max_iterations: maxIterations,
          initial_concentration_uM: initialConc,
          initial_resistance_factor: initialResistance,
          allow_reproducibility_test: allowRepro,
        },
        (event, data) => {
          if (event === 'stage' || event === 'iteration_completed') {
            setLiveProgress({
              iterationNumber: Number(data.iterationNumber || 1),
              stage: String(data.stage || 'OBSERVE'),
              summary: String(data.summary || ''),
            });
            if (event === 'iteration_completed') {
              loadAll();
            }
          } else if (event === 'complete') {
            outcome.cycle = (data.cycle as AutonomousCycleRecord) ?? null;
          } else if (event === 'error') {
            outcome.err = String(data.message || 'Unable to execute autonomous research cycle.');
          }
        },
        controller.signal
      );
      if (outcome.err) {
        throw new Error(outcome.err);
      }
      if (outcome.cycle) {
        setNotice(
          `Completed autonomous research cycle (${outcome.cycle.completed_iterations} iterations · status: ${outcome.cycle.status}).`
        );
      } else {
        setNotice('Completed autonomous research cycle.');
      }
      await loadAll();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unable to execute autonomous research cycle.');
      await loadAll();
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
      }
      setRunning(false);
      setLiveProgress(null);
    }
  };

  const handleRollbackModel = async (modelId: string, versionTag: string) => {
    if (!user) return onOpenAuth();
    setError('');
    setNotice('');
    try {
      const res = await apiFetch<{ ok: boolean; models: ModelVersionRecord[] }>(
        `/api/autonomous/models/${modelId}/rollback`,
        { method: 'POST' }
      );
      setModels(res.models);
      setNotice(`Rolled back active simulation model to ${versionTag}. Protected safety and RBAC controls intact.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed.');
    }
  };

  const handleReproduceIteration = async (iterId: string, iterNum: number) => {
    if (!user) return onOpenAuth();
    setError('');
    setNotice('');
    try {
      const res = await apiFetch<{
        deterministicMatch: boolean;
        deltaViabilityPct: number;
        reproducedViabilityEnd: number;
      }>(`/api/autonomous/iterations/${iterId}/reproduce`, { method: 'POST' });
      setNotice(
        `Reproducibility test on Iter ${iterNum}: End viability=${res.reproducedViabilityEnd}% (delta=${res.deltaViabilityPct}%, ${
          res.deterministicMatch ? 'EXACT DETERMINISTIC MATCH' : 'MODEL VERSION DIVERGENCE LOGGED'
        }). Recorded in Persistent Research Memory.`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reproducibility test failed.');
    }
  };

  const handleDeleteCycle = async (cycleId: string) => {
    if (!user) return onOpenAuth();
    setError('');
    try {
      await apiFetch(`/api/autonomous/cycles/${cycleId}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete autonomous cycle.');
    }
  };

  const handleAdjudicate = async (
    itemId: string,
    status: 'physician_approved' | 'physician_rejected' | 'revision_requested'
  ) => {
    if (!user) return onOpenAuth();
    setError('');
    setNotice('');
    try {
      await apiFetch(`/api/validation/queue/${itemId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          validation_status: status,
          reviewer_credentials: reviewerCreds,
          review_notes: reviewNotes,
        }),
      });
      setReviewingId(null);
      setReviewNotes('');
      setNotice(`Validation item ${itemId} updated to ${status}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation adjudication failed.');
    }
  };

  const pendingCount = queueItems.filter((q) => q.validation_status === 'pending_physician_review').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">C.U.R.E. Autonomous Intelligence Engine</h1>
          <p className="text-xs text-slate-400 mt-1">
            Closed-loop iterative hypothesis generation, 3D computational simulation, failure diagnosis, persistent research memory, and physician review gating
          </p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-800 hover:border-slate-700 rounded bg-[#0D131F] text-slate-300"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh State
        </button>
      </div>

      {/* Operational 9-Stage Cycle Strip */}
      <div className="border border-slate-800/90 bg-[#0A0F18] rounded-md p-3 overflow-x-auto space-y-2">
        <div className="flex items-center justify-between gap-2 min-w-[740px]">
          {PIPELINE_STAGES.map((st, idx) => {
            const isActiveStage = liveProgress?.stage === st;
            return (
              <React.Fragment key={st}>
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[11px] font-mono transition-colors ${
                    isActiveStage
                      ? 'border-cyan-400 bg-cyan-950/70 text-cyan-200'
                      : 'border-cyan-900/60 bg-[#070B12] text-cyan-300'
                  }`}
                >
                  <span className="text-slate-500">{String(idx + 1).padStart(2, '0')}</span>
                  <span>{st}</span>
                </div>
                {idx < PIPELINE_STAGES.length - 1 && <span className="text-slate-600 font-mono text-xs">→</span>}
              </React.Fragment>
            );
          })}
        </div>
        {running && liveProgress && (
          <div className="text-[11px] font-mono text-cyan-300 border-t border-slate-800/80 pt-2 flex items-center justify-between gap-3">
            <span>
              LIVE ITER {String(liveProgress.iterationNumber).padStart(3, '0')} · {liveProgress.stage}:{' '}
              <span className="text-slate-300 font-sans">{liveProgress.summary}</span>
            </span>
            <span className="text-slate-400 shrink-0">SSE Stream Active</span>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2 text-xs">
        <button
          onClick={() => setActiveTab('cycles')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono ${
            activeTab === 'cycles' ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/70' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" /> Autonomous Cycles ({cycles.length})
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono ${
            activeTab === 'memory' ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/70' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" /> Persistent Research Memory ({memory.length})
        </button>
        <button
          onClick={() => setActiveTab('models')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono ${
            activeTab === 'models' ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/70' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" /> Model Versions ({models.length})
        </button>
        <button
          onClick={() => setActiveTab('validation')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-mono ${
            activeTab === 'validation' ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-800/70' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" /> Physician Validation Queue ({pendingCount} pending)
        </button>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="p-3 border border-emerald-800/60 bg-emerald-950/30 rounded text-xs text-emerald-300">{notice}</div>
      )}

      {/* TAB 1: AUTONOMOUS CYCLES */}
      {activeTab === 'cycles' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Launcher Form */}
          <form onSubmit={startCycle} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3 text-xs h-fit">
            <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase border-b border-slate-800 pb-2">
              Initiate Autonomous Research Cycle
            </h2>

            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-400">Research Goal</label>
              <textarea
                required
                rows={3}
                value={goalPrompt}
                onChange={(e) => setGoalPrompt(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-400">Cancer Area / Tissue Context</label>
              <input
                value={cancerArea}
                onChange={(e) => setCancerArea(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-400">Execution Mode</label>
              <select
                value={executionMode}
                onChange={(e) => setExecutionMode(e.target.value as typeof executionMode)}
                className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              >
                <option value="ai_guided">AI-Guided Reasoning (Gemini + Memory + Simulation)</option>
                <option value="computational_calibration">Deterministic Computational Calibration (No LLM)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-mono text-slate-400">Initial Therapeutic Class</label>
              <select
                value={treatmentFocus}
                onChange={(e) => setTreatmentFocus(e.target.value as TreatmentMechanism)}
                className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              >
                <option value="targeted_kinase_inhibitor">Targeted Kinase Inhibitor</option>
                <option value="cytotoxic_chemotherapy">Cytotoxic Chemotherapy</option>
                <option value="checkpoint_immunotherapy">Immune Checkpoint Blockade</option>
                <option value="hypoxia_activated_prodrug">Hypoxia-Activated Prodrug</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-mono text-slate-400">Max Iters (≤{maxIterationsCap})</label>
                <input
                  type="number"
                  min={1}
                  max={maxIterationsCap}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Math.max(1, Math.min(maxIterationsCap, Number(e.target.value) || 1)))}
                  className="w-full mt-1 px-2 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
                />
              </div>
              <div>
                <label className="text-[11px] font-mono text-slate-400">Conc (uM)</label>
                <input
                  type="number"
                  step={0.2}
                  min={0.5}
                  max={10}
                  value={initialConc}
                  onChange={(e) => setInitialConc(Number(e.target.value))}
                  className="w-full mt-1 px-2 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
                />
              </div>
              <div>
                <label className="text-[11px] font-mono text-slate-400">Resistance</label>
                <input
                  type="number"
                  step={0.05}
                  min={0.05}
                  max={0.85}
                  value={initialResistance}
                  onChange={(e) => setInitialResistance(Number(e.target.value))}
                  className="w-full mt-1 px-2 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-slate-300 pt-1">
              <input
                type="checkbox"
                checked={allowRepro}
                onChange={(e) => setAllowRepro(e.target.checked)}
                className="accent-cyan-500"
              />
              Allow duplicate parameter sets for reproducibility testing
            </label>

            <button
              type="submit"
              disabled={running}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-semibold rounded"
            >
              <Play className="w-3.5 h-3.5" />
              {running ? 'Executing Autonomous Loop...' : 'Run Autonomous Improvement Cycle'}
            </button>
          </form>

          {/* Visual Iteration History */}
          <div className="lg:col-span-2 space-y-4">
            {cycles.length === 0 ? (
              <div className="border border-slate-800 bg-[#0D131F] rounded-md p-6 text-xs text-slate-400">
                No autonomous research cycles executed yet. Launch a bounded cycle to observe C.U.R.E. formulate hypotheses, run 3D simulations, diagnose failures, revise calibration parameters, and escalate &ge;{(confidenceThreshold * 100).toFixed(1)}% confidence findings for physician review.
              </div>
            ) : (
              cycles.map((cyc) => (
                <div key={cyc.id} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-4 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2 font-mono text-[11px] text-cyan-400">
                        <span>{cyc.id}</span>
                        <span className="text-slate-600">·</span>
                        <span>{cyc.execution_mode}</span>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-300">
                          {cyc.completed_iterations}/{cyc.max_iterations} iterations
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100 mt-1">{cyc.goal_prompt}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                          cyc.status === 'stopped_converged'
                            ? 'border-emerald-800/70 text-emerald-300 bg-emerald-950/30'
                            : cyc.status === 'failed'
                            ? 'border-rose-800/70 text-rose-300 bg-rose-950/30'
                            : 'border-cyan-800/70 text-cyan-300 bg-cyan-950/30'
                        }`}
                      >
                        {cyc.status}
                      </span>
                      <button
                        onClick={() => handleDeleteCycle(cyc.id)}
                        title="Delete cycle record"
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {cyc.error_message && (
                    <div className="p-2.5 border border-rose-800/60 bg-rose-950/30 rounded text-rose-300 font-mono text-[11px]">
                      {cyc.error_message}
                    </div>
                  )}

                  {(cyc.iterations ?? []).length >= 2 && (() => {
                    const iters = cyc.iterations ?? [];
                    const W = 560;
                    const H = 132;
                    const padX = 34;
                    const padY = 18;
                    const innerW = W - padX * 2;
                    const innerH = H - padY * 2;
                    const denom = Math.max(1, iters.length - 1);
                    const xAt = (i: number) => padX + (i / denom) * innerW;
                    const yAt = (pct: number) => padY + innerH - (Math.max(0, Math.min(100, pct)) / 100) * innerH;
                    const viabPts = iters
                      .map((it, idx) => `${xAt(idx).toFixed(1)},${yAt(it.predicted_viability_end ?? 100).toFixed(1)}`)
                      .join(' ');
                    const confPts = iters
                      .map((it, idx) => `${xAt(idx).toFixed(1)},${yAt(it.confidence_score * 100).toFixed(1)}`)
                      .join(' ');
                    return (
                      <div className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-300">Successive Iteration Trajectory Comparison</span>
                          <span className="text-slate-400">
                            <span className="text-orange-400">■ End Viability %</span> ·{' '}
                            <span className="text-cyan-400">■ Confidence %</span>
                          </span>
                        </div>
                        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28">
                          {[0, 50, 100].map((tick) => (
                            <line
                              key={tick}
                              x1={padX}
                              y1={yAt(tick)}
                              x2={W - padX}
                              y2={yAt(tick)}
                              stroke="#1e293b"
                              strokeDasharray="3 3"
                            />
                          ))}
                          <polyline fill="none" stroke="#f97316" strokeWidth="2" points={viabPts} />
                          <polyline fill="none" stroke="#22d3ee" strokeWidth="2" points={confPts} />
                          {iters.map((it, idx) => (
                            <g key={it.id}>
                              <circle
                                cx={xAt(idx)}
                                cy={yAt(it.predicted_viability_end ?? 100)}
                                r="3.5"
                                fill={it.criterion_passed ? '#10b981' : '#f59e0b'}
                              />
                              <circle cx={xAt(idx)} cy={yAt(it.confidence_score * 100)} r="3" fill="#22d3ee" />
                              <text
                                x={xAt(idx)}
                                y={H - 3}
                                fill="#64748b"
                                fontSize="9"
                                textAnchor="middle"
                                fontFamily="IBM Plex Mono"
                              >
                                Iter {String(it.iteration_number).padStart(2, '0')}
                              </text>
                            </g>
                          ))}
                        </svg>
                      </div>
                    );
                  })()}

                  <div className="space-y-3">
                    {(cyc.iterations ?? []).map((it) => {
                      let stageLog: AutonomousStageEntry[] = [];
                      try {
                        stageLog = JSON.parse(it.stage_log_json);
                      } catch {
                        stageLog = [];
                      }
                      return (
                        <div key={it.id} className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                            <div className="flex items-center gap-2 font-mono">
                              <span className="text-cyan-300 font-semibold">
                                Iteration {String(it.iteration_number).padStart(3, '0')}
                              </span>
                              <span
                                className={
                                  it.criterion_passed ? 'text-emerald-400' : 'text-amber-400'
                                }
                              >
                                {it.criterion_passed ? '● CRITERION PASSED' : '▲ REVISED AFTER FAILURE'}
                              </span>
                              {it.is_reproducibility_test === 1 && (
                                <span className="text-sky-400">[Reproducibility Run]</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 font-mono text-[11px]">
                              <span className="text-slate-300 tabular-nums">
                                End Viability: {it.predicted_viability_end ?? '—'}%
                              </span>
                              <span className="text-teal-300 tabular-nums">
                                Confidence: {(it.confidence_score * 100).toFixed(1)}%
                              </span>
                              {it.simulation_run_id && (
                                <>
                                  <button
                                    onClick={() => handleReproduceIteration(it.id, it.iteration_number)}
                                    title="Execute deterministic reproducibility verification test"
                                    className="inline-flex items-center gap-1 px-2 py-0.5 border border-teal-800 hover:border-teal-500 rounded text-teal-300"
                                  >
                                    <RefreshCw className="w-3 h-3" /> Reproduce
                                  </button>
                                  <button
                                    onClick={() => onInspectSimulation(it.simulation_run_id!)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 border border-cyan-800 hover:border-cyan-500 rounded text-cyan-300"
                                  >
                                    <Activity className="w-3 h-3" /> 3D View
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="text-slate-300">{it.evaluation_notes}</div>
                          {it.failure_diagnosis && (
                            <div className="text-amber-300 font-mono text-[11px]">
                              Failure Diagnosis: {it.failure_diagnosis}
                            </div>
                          )}
                          {it.strategy_revision && (
                            <div className="text-cyan-300 font-mono text-[11px]">
                              Strategy Revision: {it.strategy_revision}
                            </div>
                          )}

                          <details className="text-[11px] text-slate-400">
                            <summary className="cursor-pointer font-mono text-slate-500 hover:text-slate-300">
                              Inspect 9-Stage Operational Log ({stageLog.length} stages · hash {it.duplicate_check_hash})
                            </summary>
                            <div className="mt-2 space-y-1 pl-2 border-l border-slate-800">
                              {stageLog.map((s) => (
                                <div key={s.stage} className="font-mono">
                                  <span className="text-cyan-400">{s.stage}:</span>{' '}
                                  <span className="text-slate-300 font-sans">{s.summary}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: PERSISTENT RESEARCH MEMORY */}
      {activeTab === 'memory' && (
        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Persistent Research Memory & Duplicate-Experiment Prevention Index
            </h2>
            <span className="text-[11px] font-mono text-slate-500">{memory.length} indexed records</span>
          </div>

          {memory.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              Research memory is empty. Every autonomous hypothesis outcome, failure diagnosis, and experiment signature is stored here automatically.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-mono">
                    <th className="py-2 pr-3">Signature</th>
                    <th className="py-2 pr-3">Title / Hypothesis</th>
                    <th className="py-2 pr-3">Outcome</th>
                    <th className="py-2 pr-3">Model</th>
                    <th className="py-2 pr-3">Confidence</th>
                    <th className="py-2 pr-3">Rationale / Diagnosis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {memory.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2 pr-3 font-mono text-[11px] text-cyan-400">{m.experiment_signature_hash}</td>
                      <td className="py-2 pr-3 text-slate-200">{m.title}</td>
                      <td className="py-2 pr-3 font-mono text-[11px]">
                        <span
                          className={
                            m.outcome_status === 'accepted'
                              ? 'text-emerald-400'
                              : m.outcome_status === 'rejected'
                              ? 'text-amber-400'
                              : 'text-sky-400'
                          }
                        >
                          {m.outcome_status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-slate-400">{m.model_version}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-slate-200">
                        {(m.confidence_score * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 pr-3 text-slate-400 max-w-md">{m.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: CONTROLLED SELF-IMPROVEMENT & MODEL VERSIONS */}
      {activeTab === 'models' && (
        <section className="space-y-4">
          <div className="p-3 border border-cyan-900/50 bg-[#0B121F] rounded text-xs text-slate-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              Controlled Self-Improvement: C.U.R.E. may calibrate biological solver weights across versioned releases, but protected safety guardrails, RBAC access controls, and the {(confidenceThreshold * 100).toFixed(1)}% physician validation threshold are immutable.
            </span>
          </div>

          <div className="space-y-3">
            {models.map((mod) => {
              let paramsObj: Record<string, number> = {};
              try {
                paramsObj = JSON.parse(mod.parameters_json);
              } catch {
                paramsObj = {};
              }
              return (
                <div
                  key={mod.id}
                  className={`border rounded-md p-4 text-xs space-y-2 ${
                    mod.is_active ? 'border-cyan-700/80 bg-[#0D1626]' : 'border-slate-800/90 bg-[#0D131F]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-sm font-semibold text-slate-100">{mod.version_tag}</span>
                      {mod.is_active === 1 && <span className="text-emerald-400">● ACTIVE</span>}
                      {mod.protected_guardrails_intact === 1 && (
                        <span className="text-slate-400">· Guardrails Locked</span>
                      )}
                    </div>
                    {mod.is_active === 0 && (
                      <button
                        onClick={() => handleRollbackModel(mod.id, mod.version_tag)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-amber-700/70 hover:border-amber-500 rounded text-amber-300 font-mono text-[11px]"
                      >
                        <RotateCcw className="w-3 h-3" /> Rollback to Version
                      </button>
                    )}
                  </div>
                  <p className="text-slate-300">{mod.description}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-1 font-mono text-[11px] text-slate-400">
                    {Object.entries(paramsObj).map(([k, v]) => (
                      <div key={k} className="bg-[#070B12] border border-slate-800/80 rounded px-2 py-1">
                        <div className="text-[10px] text-slate-500 truncate">{k}</div>
                        <div className="text-cyan-300 tabular-nums">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 4: PHYSICIAN VALIDATION QUEUE (>= 95% CONFIDENCE GATE) */}
      {activeTab === 'validation' && (
        <section className="space-y-4">
          <div className="p-3 border border-amber-800/50 bg-amber-950/20 rounded text-xs font-mono text-amber-300">
            HUMAN VALIDATION GATE: Modelled findings reaching &ge;{(confidenceThreshold * 100).toFixed(1)}% computational confidence never auto-publish as clinical conclusions. Independent review and credentialed adjudication are mandatory.
          </div>

          {queueItems.length === 0 ? (
            <div className="border border-slate-800 bg-[#0D131F] rounded-md p-6 text-xs text-slate-400">
              No findings currently queued for physician review. When an autonomous cycle achieves &ge;{(confidenceThreshold * 100).toFixed(1)}% modelled confidence alongside criterion passage, it enters this queue automatically.
            </div>
          ) : (
            <div className="space-y-3">
              {queueItems.map((item) => (
                <div key={item.id} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div>
                      <div className="font-mono text-[11px] text-cyan-400">
                        {item.id} · Modelled Confidence: {(item.modelled_confidence * 100).toFixed(1)}%
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100 mt-0.5">{item.title}</h3>
                    </div>
                    <span
                      className={`font-mono text-[11px] ${
                        item.validation_status === 'physician_approved'
                          ? 'text-emerald-400'
                          : item.validation_status === 'physician_rejected'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {item.validation_status}
                    </span>
                  </div>

                  <p className="text-slate-300">{item.summary}</p>

                  {item.reviewed_at ? (
                    <div className="space-y-2">
                      <div className="p-2.5 bg-[#070B12] border border-slate-800 rounded font-mono text-[11px] text-slate-300">
                        Adjudicated by {item.reviewer_name} ({item.reviewer_credentials}) on{' '}
                        {new Date(item.reviewed_at + 'Z').toLocaleString()} — {item.review_notes || 'No additional notes'}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {item.simulation_run_id && (
                          <button
                            onClick={() => onInspectSimulation(item.simulation_run_id!)}
                            className="px-3 py-1.5 border border-slate-700 hover:border-cyan-500 text-cyan-300 rounded"
                          >
                            Inspect 3D Simulation
                          </button>
                        )}
                        {item.hypothesis_id && onPlanExperiment && (
                          <button
                            onClick={() => onPlanExperiment(item.hypothesis_id!)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold ${
                              item.validation_status === 'physician_approved'
                                ? 'bg-teal-600 hover:bg-teal-500 text-slate-950'
                                : 'border border-slate-700 hover:border-teal-500 text-teal-300'
                            }`}
                          >
                            <TestTube2 className="w-3.5 h-3.5" /> Plan Lab Experiment
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {reviewingId === item.id ? (
                        <div className="p-3 bg-[#070B12] border border-slate-800 rounded space-y-2">
                          <input
                            value={reviewerCreds}
                            onChange={(e) => setReviewerCreds(e.target.value)}
                            placeholder="Reviewer Credentials (e.g., MD, PhD Medical Oncology)"
                            className="w-full px-2.5 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-100"
                          />
                          <textarea
                            rows={2}
                            value={reviewNotes}
                            onChange={(e) => setReviewNotes(e.target.value)}
                            placeholder="Clinical/experimental review notes & wet-lab verification conditions..."
                            className="w-full px-2.5 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-100"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleAdjudicate(item.id, 'physician_approved')}
                              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold rounded"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Approve for Lab Validation
                            </button>
                            <button
                              onClick={() => handleAdjudicate(item.id, 'revision_requested')}
                              className="px-3 py-1.5 border border-amber-700 text-amber-300 rounded"
                            >
                              Request Revision
                            </button>
                            <button
                              onClick={() => handleAdjudicate(item.id, 'physician_rejected')}
                              className="flex items-center gap-1 px-3 py-1.5 border border-rose-700 text-rose-300 rounded"
                            >
                              <XCircle className="w-3.5 h-3.5" /> Reject
                            </button>
                            <button
                              onClick={() => setReviewingId(null)}
                              className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setReviewingId(item.id)}
                            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
                          >
                            Review & Adjudicate Finding
                          </button>
                          {item.simulation_run_id && (
                            <button
                              onClick={() => onInspectSimulation(item.simulation_run_id!)}
                              className="px-3 py-1.5 border border-slate-700 hover:border-cyan-500 text-cyan-300 rounded"
                            >
                              Inspect 3D Simulation
                            </button>
                          )}
                          {item.hypothesis_id && onPlanExperiment && (
                            <button
                              onClick={() => onPlanExperiment(item.hypothesis_id!)}
                              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-700 hover:border-teal-500 text-teal-300 rounded"
                            >
                              <TestTube2 className="w-3.5 h-3.5" /> Plan Lab Experiment
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
