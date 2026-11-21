import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Cpu,
  Download,
  ExternalLink,
  FlaskConical,
  Pill,
  Save,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  CombinationSynergyMetrics,
  DosingSchedule,
  ModuleId,
  ResearchHypothesis,
  SimTimePoint,
  SimulationRunRecord,
  TreatmentMechanism,
  User,
} from '../types';
import {
  DEFAULT_CALIBRATION_PARAMS,
  getTreatmentDisplayName,
  initBioSimRuntime,
  runDeterministicBioSimulation,
  stepBioSimRuntime,
  type BioSimConfig,
  type BioSimRuntime,
  type SimCell,
} from '../simulation/bioSimCore';
import { ThreeBioViewport } from '../simulation/ThreeBioViewport';

interface PharmaLookupResponse {
  query: string;
  chemblId: string | null;
  prefName: string;
  pubchemCid: number | null;
  formula: string;
  molecularWeight: string;
  mechanisms: Array<{
    mechanismOfAction: string;
    actionType: string;
    targetName: string;
    targetChEMBLId: string;
  }>;
  bioactivities: Array<{
    targetName: string;
    standardType: string;
    standardValue: number | null;
    standardUnits: string;
    pchemblValue: number | null;
  }>;
  medianPotencyUM: number | null;
  suggestedConcentrationUM: number | null;
  suggestedMechanism: TreatmentMechanism;
  chemblUrl: string | null;
  pubchemUrl: string | null;
  errors: Array<{ source: string; message: string }>;
}

interface BiologicalSimulationProps {
  user: User | null;
  activeProjectId: string | null;
  preloadSimulationId?: string | null;
  preloadHypothesisId?: string | null;
  onConsumePreload?: () => void;
  onOpenAuth: () => void;
  onNavigate: (mod: ModuleId) => void;
}

const MECHANISM_OPTIONS: Array<{ value: TreatmentMechanism; label: string }> = [
  { value: 'targeted_kinase_inhibitor', label: 'Targeted Kinase Inhibitor (Small Molecule)' },
  { value: 'cytotoxic_chemotherapy', label: 'Cytotoxic DNA-Damaging Agent' },
  { value: 'checkpoint_immunotherapy', label: 'Immune Checkpoint Blockade' },
  { value: 'hypoxia_activated_prodrug', label: 'Hypoxia-Activated Tumour Prodrug' },
  { value: 'untreated_control', label: 'Vehicle / Untreated Control' },
];

function buildPolylinePoints(
  series: SimTimePoint[],
  accessor: (p: SimTimePoint) => number,
  maxY: number,
  width: number,
  height: number,
  pad = 24
): string {
  if (series.length === 0) return '';
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const denomX = Math.max(1, series.length - 1);
  return series
    .map((pt, idx) => {
      const x = pad + (idx / denomX) * innerW;
      const val = Math.max(0, Math.min(maxY, accessor(pt)));
      const y = pad + innerH - (val / Math.max(1e-6, maxY)) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const BiologicalSimulation: React.FC<BiologicalSimulationProps> = ({
  user,
  activeProjectId,
  preloadSimulationId,
  preloadHypothesisId,
  onConsumePreload,
  onOpenAuth,
  onNavigate,
}) => {
  const [treatmentMechanism, setTreatmentMechanism] = useState<TreatmentMechanism>('targeted_kinase_inhibitor');
  const [concentrationUM, setConcentrationUM] = useState<number>(3.2);
  const [dosingSchedule, setDosingSchedule] = useState<DosingSchedule>('continuous');
  const [halfLifeHours, setHalfLifeHours] = useState<number>(18);
  const [resistantSubcloneFraction, setResistantSubcloneFraction] = useState<number>(0.2);
  const [secondaryMechanism, setSecondaryMechanism] = useState<TreatmentMechanism | 'none'>('none');
  const [secondaryConcentrationUM, setSecondaryConcentrationUM] = useState<number>(2.0);
  const [pharmaQuery, setPharmaQuery] = useState<string>('osimertinib');
  const [pharmaLoading, setPharmaLoading] = useState(false);
  const [pharmaResult, setPharmaResult] = useState<PharmaLookupResponse | null>(null);
  const [initialCancerCells, setInitialCancerCells] = useState<number>(42);
  const [initialHealthyCells, setInitialHealthyCells] = useState<number>(16);
  const [resistanceFactor, setResistanceFactor] = useState<number>(0.25);
  const [durationHours, setDurationHours] = useState<number>(72);
  const [seed, setSeed] = useState<number>(104729);
  const [scenarioName, setScenarioName] = useState<string>('');
  const [linkedHypothesisId, setLinkedHypothesisId] = useState<string>('');

  const [savedRuns, setSavedRuns] = useState<SimulationRunRecord[]>([]);
  const [hypotheses, setHypotheses] = useState<ResearchHypothesis[]>([]);
  const [activeModel, setActiveModel] = useState<{
    id: string;
    version_tag: string;
    parameters: typeof DEFAULT_CALIBRATION_PARAMS;
  }>({
    id: 'mod_v1_baseline',
    version_tag: 'baseline',
    parameters: DEFAULT_CALIBRATION_PARAMS,
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SimCell | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  // Live simulation runtime
  const runtimeRef = useRef<BioSimRuntime | null>(null);
  const [tickVersion, setTickVersion] = useState(0);

  const buildConfig = (overrideCalibration?: typeof DEFAULT_CALIBRATION_PARAMS): BioSimConfig => ({
    scenarioName:
      scenarioName.trim() ||
      `${getTreatmentDisplayName(treatmentMechanism)} · ${concentrationUM} uM${
        secondaryMechanism !== 'none' ? ` + ${getTreatmentDisplayName(secondaryMechanism)}` : ''
      }`,
    treatmentAgent: getTreatmentDisplayName(treatmentMechanism),
    treatmentMechanism,
    concentrationUM,
    initialCancerCells,
    initialHealthyCells,
    resistanceFactor,
    durationHours,
    seed: Number(seed) || 104729,
    calibration: overrideCalibration ?? activeModel.parameters,
    dosingSchedule,
    halfLifeHours,
    resistantSubcloneFraction,
    secondaryMechanism: secondaryMechanism !== 'none' ? secondaryMechanism : undefined,
    secondaryAgent: secondaryMechanism !== 'none' ? getTreatmentDisplayName(secondaryMechanism) : undefined,
    secondaryConcentrationUM: secondaryMechanism !== 'none' ? secondaryConcentrationUM : 0,
  });

  const resetRuntime = (cfg?: BioSimConfig) => {
    setIsPlaying(false);
    setSelectedCell(null);
    runtimeRef.current = initBioSimRuntime(cfg ?? buildConfig());
    setTickVersion((v) => v + 1);
  };

  // Initialize on mount
  if (!runtimeRef.current) {
    runtimeRef.current = initBioSimRuntime(buildConfig());
  }

  const loadPersisted = async () => {
    if (!user) {
      setSavedRuns([]);
      setHypotheses([]);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const [simRes, hypRes] = await Promise.all([
        apiFetch<{
          simulations: SimulationRunRecord[];
          activeModel: { id: string; version_tag: string; parameters: typeof DEFAULT_CALIBRATION_PARAMS };
        }>(`/api/simulations${q}`),
        apiFetch<{ hypotheses: ResearchHypothesis[] }>(`/api/hypotheses${q}`),
      ]);
      setSavedRuns(simRes.simulations);
      if (simRes.activeModel) setActiveModel(simRes.activeModel);
      setHypotheses(hypRes.hypotheses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load persisted simulations');
    }
  };

  useEffect(() => {
    loadPersisted();
  }, [user?.id, activeProjectId]);

  // If navigated here from an Autonomous Iteration to inspect a specific saved run:
  useEffect(() => {
    if (!preloadSimulationId || !user) return;
    apiFetch<{ simulation: SimulationRunRecord }>(`/api/simulations/${preloadSimulationId}`)
      .then((res) => {
        const s = res.simulation;
        let parsedCfg: BioSimConfig | null = null;
        try {
          parsedCfg = JSON.parse(s.parameters_json) as BioSimConfig;
        } catch {
          parsedCfg = null;
        }
        setTreatmentMechanism(s.treatment_mechanism);
        setConcentrationUM(s.concentration_uM);
        setInitialCancerCells(s.initial_cancer_cells);
        setInitialHealthyCells(s.initial_healthy_cells);
        setResistanceFactor(s.resistance_factor);
        setDurationHours(s.duration_hours);
        setSeed(s.seed || 104729);
        setScenarioName(s.scenario_name);
        setLinkedHypothesisId(s.hypothesis_id || '');
        if (parsedCfg) {
          setDosingSchedule(parsedCfg.dosingSchedule ?? 'continuous');
          setHalfLifeHours(parsedCfg.halfLifeHours ?? 18);
          setResistantSubcloneFraction(parsedCfg.resistantSubcloneFraction ?? 0.2);
          setSecondaryMechanism(parsedCfg.secondaryMechanism ?? 'none');
          setSecondaryConcentrationUM(parsedCfg.secondaryConcentrationUM ?? 2.0);
          resetRuntime(parsedCfg);
          setIsPlaying(true);
        }
        onConsumePreload?.();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unable to preload simulation run');
      });
  }, [preloadSimulationId, user?.id]);

  // If navigated here from Hypothesis Lab via "Simulate in 3D":
  useEffect(() => {
    if (!preloadHypothesisId || hypotheses.length === 0) return;
    const hyp = hypotheses.find((h) => h.id === preloadHypothesisId);
    if (!hyp) return;
    const blob = `${hyp.title} ${hyp.proposed_mechanism} ${hyp.relevant_genes_json}`.toLowerCase();
    let inferredMech: TreatmentMechanism = 'targeted_kinase_inhibitor';
    if (/hypox|hif1|prodrug|tirapazamine|evofosfamide/.test(blob)) {
      inferredMech = 'hypoxia_activated_prodrug';
    } else if (/pd-l1|pd1|cd274|immune|checkpoint|ctla|t-cell/.test(blob)) {
      inferredMech = 'checkpoint_immunotherapy';
    } else if (/cisplatin|doxorubicin|dna damage|chemo|alkylat/.test(blob)) {
      inferredMech = 'cytotoxic_chemotherapy';
    }
    setLinkedHypothesisId(hyp.id);
    setTreatmentMechanism(inferredMech);
    setScenarioName(`Hypothesis Sim · ${hyp.title.slice(0, 48)}`);
    setStatusMsg(`Loaded linked hypothesis "${hyp.title}" with inferred ${inferredMech} kinetics.`);
    const cfg: BioSimConfig = {
      scenarioName: `Hypothesis Sim · ${hyp.title.slice(0, 48)}`,
      treatmentAgent: getTreatmentDisplayName(inferredMech),
      treatmentMechanism: inferredMech,
      concentrationUM: 3.4,
      initialCancerCells,
      initialHealthyCells,
      resistanceFactor,
      durationHours,
      seed: Number(seed) || 104729,
      calibration: activeModel.parameters,
    };
    setConcentrationUM(3.4);
    resetRuntime(cfg);
    setIsPlaying(true);
    onConsumePreload?.();
  }, [preloadHypothesisId, hypotheses]);

  // Real-time simulation stepper loop
  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = playbackSpeed === 4 ? 120 : playbackSpeed === 2 ? 220 : 400;
    const timer = setInterval(() => {
      const rt = runtimeRef.current;
      if (!rt) return;
      if (rt.currentHour >= rt.config.durationHours) {
        setIsPlaying(false);
        return;
      }
      stepBioSimRuntime(rt, 1);
      setTickVersion((v) => v + 1);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed]);

  const rt = runtimeRef.current!;
  const latestPoint = rt.timeSeries[rt.timeSeries.length - 1];

  const lookupPharmacology = async () => {
    if (!pharmaQuery.trim()) return;
    if (!user) return onOpenAuth();
    setPharmaLoading(true);
    setError('');
    try {
      const res = await apiFetch<PharmaLookupResponse>(
        `/api/connectors/pharmacology?q=${encodeURIComponent(pharmaQuery.trim())}`
      );
      setPharmaResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ChEMBL/PubChem pharmacology lookup failed.');
    } finally {
      setPharmaLoading(false);
    }
  };

  const applyPharmaToSimulation = () => {
    if (!pharmaResult) return;
    const conc = pharmaResult.suggestedConcentrationUM ?? 2.8;
    const mech = pharmaResult.suggestedMechanism;
    setTreatmentMechanism(mech);
    setConcentrationUM(conc);
    setScenarioName(
      `${pharmaResult.prefName} (${pharmaResult.chemblId || `CID:${pharmaResult.pubchemCid}`}) · ${conc} uM`
    );
    const nextCfg: BioSimConfig = {
      ...buildConfig(),
      scenarioName: `${pharmaResult.prefName} · ${conc} uM`,
      treatmentAgent: pharmaResult.prefName,
      treatmentMechanism: mech,
      concentrationUM: conc,
    };
    resetRuntime(nextCfg);
    setIsPlaying(true);
    setStatusMsg(
      `Grounded simulation parameters in ${pharmaResult.prefName} (${pharmaResult.chemblId || 'PubChem'}) bioassay data.`
    );
  };

  const handleSaveRun = async () => {
    if (!user) return onOpenAuth();
    setSaving(true);
    setError('');
    setStatusMsg('');
    try {
      const res = await apiFetch<{
        simulation: SimulationRunRecord;
        modelVersionTag: string;
        result?: { finalMetrics?: { synergyMetrics?: CombinationSynergyMetrics } };
      }>('/api/simulations/run', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          hypothesis_id: linkedHypothesisId || null,
          scenario_name: scenarioName.trim() || undefined,
          treatment_mechanism: treatmentMechanism,
          concentration_uM: concentrationUM,
          initial_cancer_cells: initialCancerCells,
          initial_healthy_cells: initialHealthyCells,
          resistance_factor: resistanceFactor,
          duration_hours: durationHours,
          seed: Number(seed) || 104729,
          dosing_schedule: dosingSchedule,
          half_life_hours: halfLifeHours,
          resistant_subclone_fraction: resistantSubcloneFraction,
          secondary_mechanism: secondaryMechanism,
          secondary_concentration_uM: secondaryMechanism !== 'none' ? secondaryConcentrationUM : 0,
        }),
      });
      setStatusMsg(`Persisted computational simulation ${res.simulation.id} under ${res.modelVersionTag}.`);
      await loadPersisted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to persist simulation run.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportTelemetryCsv = () => {
    const rt = runtimeRef.current;
    if (!rt || rt.timeSeries.length === 0) return;
    const header = [
      'time_hours',
      'initial_cancer_pop',
      'viable_cancer_count',
      'sensitive_viable',
      'resistant_viable',
      'damaged_count',
      'apoptotic_count',
      'eliminated_count',
      'healthy_count',
      'cell_viability_pct',
      'treatment_response_pct',
      'mean_intracellular_dose_uM',
      'plasma_conc_uM',
      'secondary_plasma_conc_uM',
      'confidence_level',
    ].join(',');
    const lines = rt.timeSeries.map((pt) =>
      [
        pt.timeHours,
        pt.initialCancerPop,
        pt.viableCancerCount,
        pt.sensitiveViableCount ?? pt.viableCancerCount,
        pt.resistantViableCount ?? 0,
        pt.damagedCount,
        pt.apoptoticCount,
        pt.eliminatedCount,
        pt.healthyCount,
        pt.cellViabilityPct.toFixed(3),
        pt.treatmentResponsePct.toFixed(3),
        pt.meanIntracellularDose.toFixed(4),
        (pt.plasmaConcUM ?? rt.config.concentrationUM).toFixed(4),
        (pt.secondaryPlasmaConcUM ?? 0).toFixed(4),
        pt.confidenceLevel.toFixed(4),
      ].join(',')
    );
    const metaComment = `# Project C.U.R.E. Computational Simulation Telemetry (NOT experimental proof) | mechanism=${rt.config.treatmentMechanism} | schedule=${rt.config.dosingSchedule ?? 'continuous'} | dose=${rt.config.concentrationUM}uM | secondary=${rt.config.secondaryMechanism ?? 'none'} | seed=${rt.config.seed} | model=${activeModel.version_tag}`;
    const blob = new Blob([[metaComment, header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulation_telemetry_seed_${rt.config.seed}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadSavedRunIntoViewport = (run: SimulationRunRecord) => {
    setTreatmentMechanism(run.treatment_mechanism);
    setConcentrationUM(run.concentration_uM);
    setInitialCancerCells(run.initial_cancer_cells);
    setInitialHealthyCells(run.initial_healthy_cells);
    setResistanceFactor(run.resistance_factor);
    setDurationHours(run.duration_hours);
    setSeed(run.seed || 104729);
    setScenarioName(run.scenario_name);
    setLinkedHypothesisId(run.hypothesis_id || '');
    let parsedCfg: BioSimConfig | undefined;
    try {
      parsedCfg = JSON.parse(run.parameters_json) as BioSimConfig;
    } catch {
      parsedCfg = undefined;
    }
    if (parsedCfg) {
      setDosingSchedule(parsedCfg.dosingSchedule ?? 'continuous');
      setHalfLifeHours(parsedCfg.halfLifeHours ?? 18);
      setResistantSubcloneFraction(parsedCfg.resistantSubcloneFraction ?? 0.2);
      setSecondaryMechanism(parsedCfg.secondaryMechanism ?? 'none');
      setSecondaryConcentrationUM(parsedCfg.secondaryConcentrationUM ?? 2.0);
    }
    resetRuntime(parsedCfg);
    setIsPlaying(true);
  };

  const deleteSavedRun = async (id: string) => {
    try {
      await apiFetch(`/api/simulations/${id}`, { method: 'DELETE' });
      await loadPersisted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete simulation run.');
    }
  };

  // Multi-iteration comparison overlay data (last 4 saved runs)
  const comparisonSeries = useMemo(() => {
    return savedRuns.slice(0, 4).map((run, idx) => {
      let pts: SimTimePoint[] = [];
      try {
        pts = JSON.parse(run.time_series_json) as SimTimePoint[];
      } catch {
        pts = [];
      }
      const colors = ['#22d3ee', '#f97316', '#14b8a6', '#a855f7'];
      return {
        id: run.id,
        label: run.scenario_name,
        pts,
        color: colors[idx % colors.length],
      };
    });
  }, [savedRuns]);

  const liveSynergyMetrics = useMemo(() => {
    if (
      !rt.config.secondaryMechanism ||
      rt.config.secondaryMechanism === 'untreated_control' ||
      (rt.config.secondaryConcentrationUM ?? 0) <= 0
    ) {
      return null;
    }
    return runDeterministicBioSimulation(rt.config).finalMetrics.synergyMetrics ?? null;
  }, [rt.config]);

  const analyticsCards = [
    { label: 'Initial Cell Population', value: latestPoint.initialCancerPop, unit: 'cancer cells' },
    { label: 'Viable Cancer Cells', value: latestPoint.viableCancerCount, unit: 'remaining' },
    { label: 'Damaged Cells', value: latestPoint.damagedCount, unit: 'stressed' },
    { label: 'Apoptotic Cells', value: latestPoint.apoptoticCount, unit: 'cell death' },
    { label: 'Eliminated Cells', value: latestPoint.eliminatedCount, unit: 'cleared' },
    { label: 'Cell Viability', value: `${latestPoint.cellViabilityPct.toFixed(1)}%`, unit: 'cancer' },
    { label: 'Simulation Time', value: `${latestPoint.timeHours}h`, unit: `/ ${rt.config.durationHours}h` },
    { label: 'Treatment Response', value: `${latestPoint.treatmentResponsePct.toFixed(1)}%`, unit: 'inhibition' },
    {
      label: 'Modelled Confidence',
      value: `${(latestPoint.confidenceLevel * 100).toFixed(1)}%`,
      unit: 'computational',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Interactive 3D Biological Simulation Engine</h1>
          <p className="text-xs text-slate-400 mt-1">
            Spatiotemporal cellular microenvironment · Vascular perfusion, extracellular diffusion, receptor uptake, cellular damage, and apoptosis kinetics
          </p>
        </div>
        <div className="flex items-center gap-2.5 text-xs">
          <span className="font-mono text-slate-400">
            Model: <span className="text-cyan-300">{activeModel.version_tag}</span>
          </span>
          <button
            onClick={() => onNavigate('autonomous_intelligence')}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-cyan-800/70 hover:border-cyan-500 rounded bg-[#0D131F] text-cyan-300"
          >
            <Sparkles className="w-3.5 h-3.5" /> Autonomous Engine
          </button>
        </div>
      </div>

      {/* Explicit Computational Epistemic Boundary */}
      <div className="p-2.5 border border-amber-800/50 bg-amber-950/20 rounded text-xs font-mono text-amber-300 flex flex-wrap items-center justify-between gap-2">
        <span>
          COMPUTATIONAL SIMULATION ONLY: Modelled 3D kinetics visualize theoretical hypotheses and calibrated parameters — NOT experimental proof of treatment efficacy.
        </span>
        <span className="text-slate-400">Seeded Deterministic Solver (seed={rt.config.seed})</span>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}
      {statusMsg && (
        <div className="p-3 border border-emerald-800/60 bg-emerald-950/30 rounded text-xs text-emerald-300">{statusMsg}</div>
      )}

      {/* Main Split: Substantial 3D Environment + Scenario Control Sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        <div className="xl:col-span-3">
          <ThreeBioViewport
            cells={rt.cells}
            currentHour={rt.currentHour}
            durationHours={rt.config.durationHours}
            treatmentMechanism={rt.config.treatmentMechanism}
            concentrationUM={rt.config.concentrationUM}
            secondaryMechanism={rt.config.secondaryMechanism ?? 'none'}
            secondaryConcentrationUM={rt.config.secondaryConcentrationUM ?? 0}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlay={() => {
              if (rt.currentHour >= rt.config.durationHours) {
                resetRuntime();
                setIsPlaying(true);
              } else {
                setIsPlaying((p) => !p);
              }
            }}
            onStepHour={() => {
              if (rt.currentHour < rt.config.durationHours) {
                stepBioSimRuntime(rt, 1);
                setTickVersion((v) => v + 1);
              }
            }}
            onReset={() => resetRuntime()}
            onChangeSpeed={setPlaybackSpeed}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((f) => !f)}
            selectedCellId={selectedCell?.id ?? null}
            onSelectCell={setSelectedCell}
          />
          {/* Hidden dependency anchor on tickVersion so metrics/canvas sync cleanly */}
          <span className="sr-only" data-tick={tickVersion} />
        </div>

        {/* Scenario Configuration & Persistence Controls */}
        <aside className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3 text-xs h-fit">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Treatment & Tissue Setup
            </h2>
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          </div>

          {/* ChEMBL / PubChem Live Pharmacology Grounding */}
          <div className="p-2.5 bg-[#070B12] border border-cyan-900/50 rounded space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400">
              <span className="flex items-center gap-1">
                <Pill className="w-3 h-3" /> ChEMBL / PubChem Assay Grounding
              </span>
            </div>
            <div className="flex gap-1.5">
              <input
                value={pharmaQuery}
                onChange={(e) => setPharmaQuery(e.target.value)}
                placeholder="Drug name (e.g., osimertinib)..."
                className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-[#0D131F] border border-slate-800 rounded text-slate-100"
              />
              <button
                type="button"
                onClick={lookupPharmacology}
                disabled={pharmaLoading}
                className="px-2 py-1 text-[11px] font-mono border border-cyan-700/70 hover:border-cyan-400 text-cyan-300 rounded flex items-center gap-1 shrink-0 disabled:opacity-50"
              >
                <Search className="w-3 h-3" /> {pharmaLoading ? '...' : 'Lookup'}
              </button>
            </div>
            {pharmaResult && (
              <div className="space-y-1.5 pt-1 border-t border-slate-800/80 text-[10px] font-mono">
                <div className="flex items-center justify-between text-slate-200">
                  <span className="font-semibold truncate">{pharmaResult.prefName}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {pharmaResult.chemblUrl && (
                      <a href={pharmaResult.chemblUrl} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline inline-flex items-center gap-0.5">
                        {pharmaResult.chemblId} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {pharmaResult.pubchemUrl && (
                      <a href={pharmaResult.pubchemUrl} target="_blank" rel="noreferrer" className="text-teal-400 hover:underline inline-flex items-center gap-0.5">
                        CID:{pharmaResult.pubchemCid} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="text-slate-400">
                  {pharmaResult.formula || 'N/A'} · MW {pharmaResult.molecularWeight || '—'} · Median IC50/Ki:{' '}
                  <span className="text-emerald-300">
                    {pharmaResult.medianPotencyUM !== null ? `${pharmaResult.medianPotencyUM} uM` : 'N/A'}
                  </span>
                </div>
                {pharmaResult.mechanisms[0] && (
                  <div className="text-slate-400 truncate" title={pharmaResult.mechanisms[0].mechanismOfAction}>
                    MOA: {pharmaResult.mechanisms[0].mechanismOfAction}
                  </div>
                )}
                {pharmaResult.errors.length > 0 && (
                  <div className="text-amber-300">
                    Warn: {pharmaResult.errors.map((e) => e.source).join(', ')}
                  </div>
                )}
                <button
                  type="button"
                  onClick={applyPharmaToSimulation}
                  className="w-full py-1 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/70 text-cyan-200 rounded text-[10px]"
                >
                  Apply Grounded Dose ({pharmaResult.suggestedConcentrationUM ?? 2.8} uM)
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-mono text-slate-400">Primary Treatment Mechanism</label>
            <select
              value={treatmentMechanism}
              onChange={(e) => setTreatmentMechanism(e.target.value as TreatmentMechanism)}
              className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            >
              {MECHANISM_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-slate-400">Primary Concentration</span>
              <span className="text-cyan-300 tabular-nums">{concentrationUM.toFixed(1)} uM</span>
            </div>
            <input
              type="range"
              min={0}
              max={12}
              step={0.2}
              value={concentrationUM}
              disabled={treatmentMechanism === 'untreated_control'}
              onChange={(e) => setConcentrationUM(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>

          {/* PK/PD Dosing Schedule & Combination Agent */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-mono text-slate-400">PK Schedule</label>
              <select
                value={dosingSchedule}
                onChange={(e) => setDosingSchedule(e.target.value as DosingSchedule)}
                className="w-full mt-1 px-2 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              >
                <option value="continuous">Continuous Infusion</option>
                <option value="q24h">Q24h Daily Bolus</option>
                <option value="q48h">Q48h Intermittent</option>
                <option value="q7d_holiday">5d On / 2d Holiday</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-mono text-slate-400">Plasma t1/2 (h)</label>
              <input
                type="number"
                min={2}
                max={96}
                value={halfLifeHours}
                disabled={dosingSchedule === 'continuous'}
                onChange={(e) => setHalfLifeHours(Math.max(2, Math.min(96, Number(e.target.value) || 18)))}
                className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 disabled:opacity-40"
              />
            </div>
          </div>

          <div className="p-2 bg-[#070B12] border border-slate-800/80 rounded space-y-1.5">
            <label className="text-[10px] font-mono text-purple-300 uppercase">2-Drug Combination Regimen</label>
            <select
              value={secondaryMechanism}
              onChange={(e) => setSecondaryMechanism(e.target.value as TreatmentMechanism | 'none')}
              className="w-full px-2 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-100"
            >
              <option value="none">Monotherapy (No Secondary Drug)</option>
              {MECHANISM_OPTIONS.filter((m) => m.value !== 'untreated_control').map((m) => (
                <option key={m.value} value={m.value}>
                  + {m.label}
                </option>
              ))}
            </select>
            {secondaryMechanism !== 'none' && (
              <div className="space-y-0.5">
                <div className="flex justify-between font-mono text-[10px]">
                  <span className="text-slate-400">Secondary Dose</span>
                  <span className="text-purple-300 tabular-nums">{secondaryConcentrationUM.toFixed(1)} uM</span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={10}
                  step={0.2}
                  value={secondaryConcentrationUM}
                  onChange={(e) => setSecondaryConcentrationUM(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex justify-between font-mono text-[10px]">
                <span className="text-slate-400">Base Resistance</span>
                <span className="text-amber-300 tabular-nums">{(resistanceFactor * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.85}
                step={0.05}
                value={resistanceFactor}
                onChange={(e) => setResistanceFactor(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between font-mono text-[10px]">
                <span className="text-slate-400">Resistant Clone %</span>
                <span className="text-rose-300 tabular-nums">{(resistantSubcloneFraction * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={0.6}
                step={0.05}
                value={resistantSubcloneFraction}
                onChange={(e) => setResistantSubcloneFraction(Number(e.target.value))}
                className="w-full accent-rose-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-mono text-slate-400">Cancer Cells</label>
              <input
                type="number"
                min={10}
                max={70}
                value={initialCancerCells}
                onChange={(e) =>
                  setInitialCancerCells(Math.min(70, Math.max(10, Number(e.target.value) || 42)))
                }
                className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-slate-400">Healthy Margin</label>
              <input
                type="number"
                min={6}
                max={32}
                value={initialHealthyCells}
                onChange={(e) =>
                  setInitialHealthyCells(Math.min(32, Math.max(6, Number(e.target.value) || 16)))
                }
                className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-mono text-slate-400">Horizon (hrs)</label>
              <input
                type="number"
                min={24}
                max={144}
                step={12}
                value={durationHours}
                onChange={(e) =>
                  setDurationHours(Math.min(144, Math.max(24, Number(e.target.value) || 72)))
                }
                className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-slate-400">Link Hypothesis</label>
              <select
                value={linkedHypothesisId}
                onChange={(e) => setLinkedHypothesisId(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-200 truncate"
              >
                <option value="">None</option>
                {hypotheses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[11px] font-mono text-slate-400">Stochastic Seed</label>
              <input
                type="number"
                min={1}
                value={seed}
                onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 104729))}
                className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={() => setSeed(Math.floor(100000 + Math.random() * 899999))}
              title="Randomise spatial seeding distribution"
              className="p-2 border border-slate-700 hover:border-cyan-500 rounded text-slate-300 hover:text-cyan-300"
            >
              <Shuffle className="w-3.5 h-3.5" />
            </button>
          </div>

          <input
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder="Optional scenario label..."
            className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => {
                resetRuntime();
                setIsPlaying(true);
              }}
              className="flex items-center justify-center gap-1.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
            >
              <Activity className="w-3.5 h-3.5" /> Apply & Run
            </button>
            <button
              onClick={handleSaveRun}
              disabled={saving}
              className="flex items-center justify-center gap-1.5 py-2 border border-teal-700 hover:border-teal-500 text-teal-300 rounded disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Persist Run'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportTelemetryCsv}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-slate-700 hover:border-cyan-500 text-slate-300 hover:text-cyan-200 rounded text-[11px] font-mono"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" /> Export Telemetry CSV
          </button>

          <div className="pt-2 border-t border-slate-800 text-[11px] font-mono text-slate-400 space-y-1">
            <div>Active Calibration ({activeModel.version_tag}):</div>
            <div className="grid grid-cols-2 gap-x-2 text-[10px] text-slate-500">
              <span>Diffusion: {activeModel.parameters.diffusionRate}</span>
              <span>Binding: {activeModel.parameters.bindingAffinity}</span>
              <span>Repair: {activeModel.parameters.repairEfficiency}</span>
              <span>Apop Thresh: {activeModel.parameters.apoptosisThreshold}</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Real-Time Scientific Analytics Panel */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
            Real-Time Scientific Simulation Analytics
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            Mean Intracellular Dose: <span className="text-cyan-300 tabular-nums">{latestPoint.meanIntracellularDose.toFixed(3)} uM</span> ·
            Mean Stress Index: <span className="text-amber-300 tabular-nums">{(latestPoint.meanStressIndex * 100).toFixed(1)}%</span>
          </span>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-9 gap-2.5">
          {analyticsCards.map((c) => (
            <div key={c.label} className="border border-slate-800/90 bg-[#0D131F] rounded p-3">
              <div className="text-[10px] text-slate-400 truncate">{c.label}</div>
              <div className="mt-1.5 text-lg font-mono font-semibold tabular-nums text-slate-100">{c.value}</div>
              <div className="text-[10px] font-mono text-slate-500 truncate">{c.unit}</div>
            </div>
          ))}
        </div>

        {/* Combination Bliss Independence & Loewe Synergy Panel */}
        {liveSynergyMetrics && (
          <div className="border border-purple-800/60 bg-[#0D131F] rounded-md p-4 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-purple-300">
                2-Drug Combination Pharmacology · Bliss Independence &amp; Loewe Combination Index
              </span>
              <span
                className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold uppercase ${
                  liveSynergyMetrics.classification === 'synergistic'
                    ? 'bg-emerald-950/60 border border-emerald-700/70 text-emerald-300'
                    : liveSynergyMetrics.classification === 'sub_additive'
                    ? 'bg-amber-950/60 border border-amber-700/70 text-amber-300'
                    : 'bg-cyan-950/60 border border-cyan-700/70 text-cyan-300'
                }`}
              >
                {liveSynergyMetrics.classification.replace('_', '-')} (CI = {liveSynergyMetrics.loeweCombinationIndex})
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-[11px]">
              <div>
                <div className="text-[10px] text-slate-500">Agent A Alone Viability</div>
                <div className="text-slate-200 font-semibold">{liveSynergyMetrics.primaryAloneViabilityPct}%</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">Agent B Alone Viability</div>
                <div className="text-slate-200 font-semibold">{liveSynergyMetrics.secondaryAloneViabilityPct}%</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">Bliss Expected Inhib</div>
                <div className="text-cyan-300 font-semibold">{liveSynergyMetrics.blissExpectedPct}%</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">Observed Combined Inhib</div>
                <div className="text-teal-300 font-semibold">{liveSynergyMetrics.observedInhibitionPct}%</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">Bliss Excess</div>
                <div
                  className={`font-semibold ${
                    liveSynergyMetrics.blissExcessPct >= 0 ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  {liveSynergyMetrics.blissExcessPct >= 0 ? '+' : ''}
                  {liveSynergyMetrics.blissExcessPct}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4 Dynamic Scientific Time-Series Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Chart 1: Viable Cell Population Over Time (with Clonal Subpopulations) */}
          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-200">Viable Population &amp; Clonal Resistance</span>
              <span className="font-mono text-[10px] text-slate-400">
                <span className="text-orange-400">■ Total</span> · <span className="text-rose-400">--- Resistant</span> ·{' '}
                <span className="text-teal-400">■ Healthy</span>
              </span>
            </div>
            <svg viewBox="0 0 420 160" className="w-full h-40 bg-[#070B12] border border-slate-800/70 rounded">
              <line x1="24" y1="24" x2="24" y2="136" stroke="#1e293b" strokeWidth="1" />
              <line x1="24" y1="136" x2="396" y2="136" stroke="#1e293b" strokeWidth="1" />
              <polyline
                fill="none"
                stroke="#f97316"
                strokeWidth="2"
                points={buildPolylinePoints(
                  rt.timeSeries,
                  (p) => p.viableCancerCount,
                  Math.max(rt.config.initialCancerCells * 1.25, 20),
                  420,
                  160
                )}
              />
              <polyline
                fill="none"
                stroke="#fb7185"
                strokeDasharray="4 3"
                strokeWidth="1.6"
                points={buildPolylinePoints(
                  rt.timeSeries,
                  (p) => p.resistantViableCount ?? 0,
                  Math.max(rt.config.initialCancerCells * 1.25, 20),
                  420,
                  160
                )}
              />
              <polyline
                fill="none"
                stroke="#14b8a6"
                strokeWidth="2"
                points={buildPolylinePoints(
                  rt.timeSeries,
                  (p) => p.healthyCount,
                  Math.max(rt.config.initialCancerCells * 1.25, 20),
                  420,
                  160
                )}
              />
            </svg>
          </div>

          {/* Chart 2: Cell-Death Progression */}
          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">Cell-Death & Stress Progression</span>
              <span className="font-mono text-[10px] text-slate-400">
                <span className="text-yellow-400">■ Damaged</span> · <span className="text-rose-400">■ Apoptotic</span> ·{' '}
                <span className="text-slate-400">■ Eliminated</span>
              </span>
            </div>
            <svg viewBox="0 0 420 160" className="w-full h-40 bg-[#070B12] border border-slate-800/70 rounded">
              <line x1="24" y1="24" x2="24" y2="136" stroke="#1e293b" strokeWidth="1" />
              <line x1="24" y1="136" x2="396" y2="136" stroke="#1e293b" strokeWidth="1" />
              <polyline
                fill="none"
                stroke="#eab308"
                strokeWidth="1.8"
                points={buildPolylinePoints(
                  rt.timeSeries,
                  (p) => p.damagedCount,
                  Math.max(rt.config.initialCancerCells, 20),
                  420,
                  160
                )}
              />
              <polyline
                fill="none"
                stroke="#f43f5e"
                strokeWidth="1.8"
                points={buildPolylinePoints(
                  rt.timeSeries,
                  (p) => p.apoptoticCount,
                  Math.max(rt.config.initialCancerCells, 20),
                  420,
                  160
                )}
              />
              <polyline
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2"
                points={buildPolylinePoints(
                  rt.timeSeries,
                  (p) => p.eliminatedCount,
                  Math.max(rt.config.initialCancerCells, 20),
                  420,
                  160
                )}
              />
            </svg>
          </div>

          {/* Chart 3: Treatment Response & Plasma PK Profile */}
          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-200">Treatment Response (%), Uptake &amp; Plasma PK</span>
              <span className="font-mono text-[10px] text-slate-400">
                <span className="text-cyan-400">■ Response %</span> · <span className="text-purple-400">■ Plasma PK</span> ·{' '}
                <span className="text-sky-300">--- Dose</span>
              </span>
            </div>
            <svg viewBox="0 0 420 160" className="w-full h-40 bg-[#070B12] border border-slate-800/70 rounded">
              <line x1="24" y1="24" x2="24" y2="136" stroke="#1e293b" strokeWidth="1" />
              <line x1="24" y1="136" x2="396" y2="136" stroke="#1e293b" strokeWidth="1" />
              <polyline
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2"
                points={buildPolylinePoints(rt.timeSeries, (p) => p.treatmentResponsePct, 100, 420, 160)}
              />
              <polyline
                fill="none"
                stroke="#c084fc"
                strokeWidth="1.6"
                points={buildPolylinePoints(
                  rt.timeSeries,
                  (p) => ((p.plasmaConcUM ?? rt.config.concentrationUM) / Math.max(0.5, rt.config.concentrationUM)) * 90,
                  100,
                  420,
                  160
                )}
              />
              <polyline
                fill="none"
                stroke="#7dd3fc"
                strokeDasharray="4 3"
                strokeWidth="1.6"
                points={buildPolylinePoints(rt.timeSeries, (p) => p.meanIntracellularDose * 50, 100, 420, 160)}
              />
            </svg>
          </div>

          {/* Chart 4: Comparison Across Saved / Autonomous Iterations */}
          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">Viability Comparison Across Iterations (%)</span>
              <span className="font-mono text-[10px] text-slate-400">
                {comparisonSeries.length} saved runs compared
              </span>
            </div>
            {comparisonSeries.length === 0 ? (
              <div className="h-40 bg-[#070B12] border border-slate-800/70 rounded flex items-center justify-center text-xs text-slate-500">
                Persist simulation runs or launch an Autonomous Cycle to overlay iteration trajectories.
              </div>
            ) : (
              <svg viewBox="0 0 420 160" className="w-full h-40 bg-[#070B12] border border-slate-800/70 rounded">
                <line x1="24" y1="24" x2="24" y2="136" stroke="#1e293b" strokeWidth="1" />
                <line x1="24" y1="136" x2="396" y2="136" stroke="#1e293b" strokeWidth="1" />
                {comparisonSeries.map((ser) => (
                  <polyline
                    key={ser.id}
                    fill="none"
                    stroke={ser.color}
                    strokeWidth="1.8"
                    points={buildPolylinePoints(ser.pts, (p) => p.cellViabilityPct, 110, 420, 160)}
                  />
                ))}
              </svg>
            )}
          </div>
        </div>
      </section>

      {/* Persisted Simulation History Table */}
      <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
            Persisted Computational Simulation Runs
          </h2>
          <span className="text-[11px] font-mono text-slate-500">{savedRuns.length} records</span>
        </div>

        {savedRuns.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">
            No simulation runs saved yet. Click "Persist Run" above or execute an Autonomous Research Cycle.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3">Scenario</th>
                  <th className="py-2 pr-3">Mechanism</th>
                  <th className="py-2 pr-3">Dose</th>
                  <th className="py-2 pr-3">Viability End</th>
                  <th className="py-2 pr-3">Confidence</th>
                  <th className="py-2 pr-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {savedRuns.slice(0, 10).map((r) => {
                  let fm: { cellViabilityPct?: number } = {};
                  try {
                    fm = JSON.parse(r.final_metrics_json);
                  } catch {
                    fm = {};
                  }
                  return (
                    <tr key={r.id} className="hover:bg-slate-900/40">
                      <td className="py-2 pr-3 text-slate-200 font-sans">{r.scenario_name}</td>
                      <td className="py-2 pr-3 text-slate-400">{r.treatment_mechanism}</td>
                      <td className="py-2 pr-3 text-cyan-300 tabular-nums">{r.concentration_uM.toFixed(1)} uM</td>
                      <td className="py-2 pr-3 text-amber-300 tabular-nums">
                        {fm.cellViabilityPct !== undefined ? `${fm.cellViabilityPct}%` : '—'}
                      </td>
                      <td className="py-2 pr-3 text-teal-300 tabular-nums">
                        {(r.summary_confidence * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => loadSavedRunIntoViewport(r)}
                            className="inline-flex items-center gap-1 px-2 py-1 border border-cyan-800/70 hover:border-cyan-500 rounded text-[11px] text-cyan-300"
                          >
                            <FlaskConical className="w-3 h-3" /> Load 3D
                          </button>
                          <button
                            onClick={() => deleteSavedRun(r.id)}
                            title="Delete simulation run"
                            className="p-1 text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
