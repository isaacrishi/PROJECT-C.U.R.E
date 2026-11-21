import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Download, Edit3, Grid, Plus, Save, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ResearchHypothesis, User } from '../types';

interface ExperimentPlanRow {
  id: string;
  hypothesis_id: string | null;
  title: string;
  objectives: string;
  scientific_question: string;
  study_design: string;
  independent_vars_json: string;
  dependent_vars_json: string;
  control_groups: string;
  sample_characteristics: string;
  sample_size_assumptions: string;
  statistical_methods: string;
  expected_outcomes: string;
  potential_confounders: string;
  limitations: string;
  validation_requirements: string;
  reproducibility_checklist_json: string;
  ethics_checklist_json: string;
  version: number;
  status: string;
  updated_at: string;
}

const DEFAULT_REPRO_CHECKLIST = [
  'Randomisation & blinding protocol documented',
  'Biological & technical replicates specified (n >= 3 independent)',
  'Raw data & analysis script archiving plan defined',
  'Reagent RRID / cell-line STR authentication planned',
];

const DEFAULT_ETHICS_CHECKLIST = [
  'Requires Principal Investigator & institutional ethics/IRB/IACUC approval prior to execution',
  'De-identified biospecimen governance verified',
  'No autonomous clinical intervention recommended',
];

interface ExperimentDesignProps {
  user: User | null;
  activeProjectId: string | null;
  preloadHypothesisId?: string | null;
  onConsumePreload?: () => void;
  onOpenAuth: () => void;
}

export const ExperimentDesign: React.FC<ExperimentDesignProps> = ({
  user,
  activeProjectId,
  preloadHypothesisId,
  onConsumePreload,
  onOpenAuth,
}) => {
  const [experiments, setExperiments] = useState<ExperimentPlanRow[]>([]);
  const [hypotheses, setHypotheses] = useState<ResearchHypothesis[]>([]);

  const [hypothesisId, setHypothesisId] = useState('');
  const [title, setTitle] = useState('');
  const [objectives, setObjectives] = useState('');
  const [scientificQuestion, setScientificQuestion] = useState('');
  const [studyDesign, setStudyDesign] = useState('');
  const [independentVars, setIndependentVars] = useState('');
  const [dependentVars, setDependentVars] = useState('');
  const [controlGroups, setControlGroups] = useState('');
  const [sampleChars, setSampleChars] = useState('');
  const [sampleSizeAssump, setSampleSizeAssump] = useState('');
  const [statMethods, setStatMethods] = useState('');
  const [expectedOutcomes, setExpectedOutcomes] = useState('');
  const [confounders, setConfounders] = useState('');
  const [limitations, setLimitations] = useState('');
  const [validationReq, setValidationReq] = useState('');
  const [reproChecks, setReproChecks] = useState<string[]>(DEFAULT_REPRO_CHECKLIST.slice(0, 2));
  const [ethicsChecks, setEthicsChecks] = useState<string[]>(DEFAULT_ETHICS_CHECKLIST);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesign, setEditDesign] = useState('');
  const [editStats, setEditStats] = useState('');
  const [editStatus, setEditStatus] = useState('peer_review_pending');
  const [error, setError] = useState('');

  // Wet-Lab 96-Well Assay Matrix & ELN Protocol Generator state
  const [plateAgentName, setPlateAgentName] = useState('Osimertinib');
  const [plateCellLine, setPlateCellLine] = useState('NCI-H1975');
  const [plateTopDoseUM, setPlateTopDoseUM] = useState(10);
  const [plateDilutionFactor, setPlateDilutionFactor] = useState(3);
  const [plateDosePoints, setPlateDosePoints] = useState(6);
  const [plateReplicates, setPlateReplicates] = useState(3);
  const [plateBlindingSeed, setPlateBlindingSeed] = useState(4091);

  const generatedPlate = useMemo(() => {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const doses: number[] = [];
    for (let d = 0; d < Math.min(8, Math.max(2, plateDosePoints)); d++) {
      doses.push(Number((plateTopDoseUM / Math.pow(Math.max(1.5, plateDilutionFactor), d)).toFixed(4)));
    }
    let rngState = (Number(plateBlindingSeed) || 4091) >>> 0;
    const nextRand = () => {
      rngState = (rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const innerTreatments: Array<{ kind: 'vehicle' | 'dose'; doseUM: number; label: string }> = [];
    const maxReps = Math.min(6, Math.max(2, plateReplicates));
    for (let r = 0; r < maxReps; r++) {
      innerTreatments.push({ kind: 'vehicle', doseUM: 0, label: '0.1% DMSO' });
      for (const dose of doses) {
        innerTreatments.push({ kind: 'dose', doseUM: dose, label: `${dose} uM` });
      }
    }
    // Deterministic Fisher-Yates randomization of inner wells for operator blinding
    for (let i = innerTreatments.length - 1; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      const tmp = innerTreatments[i];
      innerTreatments[i] = innerTreatments[j];
      innerTreatments[j] = tmp;
    }

    let cursor = 0;
    const wells: Array<{
      wellId: string;
      row: string;
      col: number;
      role: 'pbs_moat' | 'vehicle_dmso' | 'treatment' | 'media_blank';
      agent: string;
      concentrationUM: number;
      blindedCode: string;
    }> = [];

    for (let rIdx = 0; rIdx < 8; rIdx++) {
      for (let col = 1; col <= 12; col++) {
        const wellId = `${rows[rIdx]}${String(col).padStart(2, '0')}`;
        const isEdge = rIdx === 0 || rIdx === 7 || col === 1 || col === 12;
        if (isEdge) {
          wells.push({
            wellId,
            row: rows[rIdx],
            col,
            role: 'pbs_moat',
            agent: 'PBS Buffer (Evaporation Moat)',
            concentrationUM: 0,
            blindedCode: 'MOAT',
          });
        } else if (cursor < innerTreatments.length) {
          const item = innerTreatments[cursor++];
          const blkNum = Math.floor(1000 + nextRand() * 9000);
          wells.push({
            wellId,
            row: rows[rIdx],
            col,
            role: item.kind === 'vehicle' ? 'vehicle_dmso' : 'treatment',
            agent: item.kind === 'vehicle' ? 'Vehicle (0.1% DMSO)' : plateAgentName,
            concentrationUM: item.doseUM,
            blindedCode: `BLK-${blkNum}`,
          });
        } else {
          wells.push({
            wellId,
            row: rows[rIdx],
            col,
            role: 'media_blank',
            agent: 'Cell-Free Media Blank',
            concentrationUM: 0,
            blindedCode: 'BLANK',
          });
        }
      }
    }
    return { wells, doses, innerCapacity: 60 };
  }, [plateAgentName, plateTopDoseUM, plateDilutionFactor, plateDosePoints, plateReplicates, plateBlindingSeed]);

  const downloadPlateCsv = () => {
    const header = ['well_id', 'row', 'col', 'role', 'cell_line', 'agent', 'concentration_uM', 'blinded_aliquot_code'].join(',');
    const lines = generatedPlate.wells.map((w) =>
      [w.wellId, w.row, w.col, w.role, plateCellLine, `"${w.agent}"`, w.concentrationUM, w.blindedCode].join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plate_96well_${plateCellLine.replace(/[^a-zA-Z0-9_-]/g, '_')}_seed_${plateBlindingSeed}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadElnSopJson = () => {
    const linkedHyp = hypotheses.find((h) => h.id === hypothesisId);
    const payload = {
      schema: 'PROJECT_CURE_ELN_SOP_v1',
      generatedAt: new Date().toISOString(),
      protocolTitle: title.trim() || `${plateAgentName} Dose-Response Assay in ${plateCellLine}`,
      linkedHypothesis: linkedHyp ? { id: linkedHyp.id, title: linkedHyp.title } : null,
      governanceNotice: 'Requires PI & Institutional Compliance Approval Prior to Wet-Lab Execution',
      assayDesign: {
        plateFormat: '96-well clear-bottom tissue culture microplate (PBS edge moat)',
        cellLine: plateCellLine,
        agent: plateAgentName,
        serialDilutionSeriesUM: generatedPlate.doses,
        replicatesPerCondition: plateReplicates,
        statisticalPowerAssumption: `Two-sided alpha=0.05, 80% power (n=${plateReplicates} biological replicates)`,
        blindingSeed: plateBlindingSeed,
      },
      reproducibilityChecklist: reproChecks,
      ethicsChecklist: ethicsChecks,
      wells: generatedPlate.wells,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eln_sop_${plateCellLine.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const load = async () => {
    if (!user) {
      setExperiments([]);
      setHypotheses([]);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const [expRes, hypRes] = await Promise.all([
        apiFetch<{ experiments: ExperimentPlanRow[] }>(`/api/experiments${q}`),
        apiFetch<{ hypotheses: ResearchHypothesis[] }>(`/api/hypotheses${q}`),
      ]);
      setExperiments(expRes.experiments);
      setHypotheses(hypRes.hypotheses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load experimental protocols');
    }
  };

  useEffect(() => {
    load();
  }, [user?.id, activeProjectId]);

  useEffect(() => {
    if (!preloadHypothesisId || hypotheses.length === 0) return;
    const hyp = hypotheses.find((h) => h.id === preloadHypothesisId);
    if (hyp) {
      setHypothesisId(hyp.id);
      if (!title.trim()) setTitle(`Protocol · ${hyp.title.slice(0, 64)}`);
      if (!scientificQuestion.trim()) setScientificQuestion(hyp.research_question || '');
      onConsumePreload?.();
    }
  }, [preloadHypothesisId, hypotheses]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setError('');
    try {
      await apiFetch('/api/experiments', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          hypothesis_id: hypothesisId || null,
          title,
          objectives,
          scientific_question: scientificQuestion,
          study_design: studyDesign,
          independent_vars: independentVars.split(',').map((s) => s.trim()).filter(Boolean),
          dependent_vars: dependentVars.split(',').map((s) => s.trim()).filter(Boolean),
          control_groups: controlGroups,
          sample_characteristics: sampleChars,
          sample_size_assumptions: sampleSizeAssump,
          statistical_methods: statMethods,
          expected_outcomes: expectedOutcomes,
          potential_confounders: confounders,
          limitations,
          validation_requirements: validationReq,
          reproducibility_checklist: reproChecks,
          ethics_checklist: ethicsChecks,
        }),
      });
      setTitle('');
      setScientificQuestion('');
      setStudyDesign('');
      setObjectives('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save experiment plan');
    }
  };

  const saveRevision = async (expId: string) => {
    try {
      await apiFetch(`/api/experiments/${expId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          study_design: editDesign,
          statistical_methods: editStats,
          status: editStatus,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update experiment');
    }
  };

  const deleteExperiment = async (expId: string) => {
    try {
      await apiFetch(`/api/experiments/${expId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete experiment plan');
    }
  };

  const bumpVersion = async (exp: ExperimentPlanRow) => {
    try {
      await apiFetch(`/api/experiments/${exp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'peer_review_pending' }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update experiment');
    }
  };

  const toggleItem = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="text-xl font-semibold text-slate-100">Experiment Design</h1>
        <p className="text-xs text-slate-400 mt-1">
          Structured experimental proposals linked to hypotheses, statistical power assumptions, reproducibility & ethics checklists
        </p>
      </div>

      <div className="p-2.5 border border-amber-800/50 bg-amber-950/20 rounded text-xs font-mono text-amber-300">
        GOVERNANCE NOTICE: All experimental plans are research proposals requiring qualified human review and institutional approvals before execution.
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleCreate} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 text-xs">
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase border-b border-slate-800 pb-2">
            Draft Experiment Proposal
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Proposal Title *</label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., CRISPR HIF1A KO under 1% O2"
                className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Linked Hypothesis</label>
              <select
                value={hypothesisId}
                onChange={(e) => setHypothesisId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-200"
              >
                <option value="">Optional — link hypothesis...</option>
                {hypotheses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <input
            required
            value={scientificQuestion}
            onChange={(e) => setScientificQuestion(e.target.value)}
            placeholder="Primary scientific question tested *"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <textarea
            rows={2}
            value={studyDesign}
            onChange={(e) => setStudyDesign(e.target.value)}
            placeholder="Study design (e.g., factorial in vitro perturbation + RNA-seq)"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />

          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={independentVars}
              onChange={(e) => setIndependentVars(e.target.value)}
              placeholder="Independent variables (comma-sep)"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <input
              value={dependentVars}
              onChange={(e) => setDependentVars(e.target.value)}
              placeholder="Dependent endpoints (comma-sep)"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={controlGroups}
              onChange={(e) => setControlGroups(e.target.value)}
              placeholder="Control groups (isotype, normoxia, NT-sgRNA)"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <input
              value={sampleChars}
              onChange={(e) => setSampleChars(e.target.value)}
              placeholder="Sample characteristics / cell lines"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={sampleSizeAssump}
              onChange={(e) => setSampleSizeAssump(e.target.value)}
              placeholder="Sample size & power assumptions (alpha=0.05, 80% power)"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <input
              value={statMethods}
              onChange={(e) => setStatMethods(e.target.value)}
              placeholder="Statistical plan (ANOVA, Benjamini-Hochberg FDR)"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={expectedOutcomes}
              onChange={(e) => setExpectedOutcomes(e.target.value)}
              placeholder="Expected outcomes & falsification criteria"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <input
              value={confounders}
              onChange={(e) => setConfounders(e.target.value)}
              placeholder="Potential confounders & batch effects"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <input
              value={limitations}
              onChange={(e) => setLimitations(e.target.value)}
              placeholder="Model limitations"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <input
              value={validationReq}
              onChange={(e) => setValidationReq(e.target.value)}
              placeholder="Independent validation requirements"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>

          <div className="pt-2 border-t border-slate-800 space-y-1.5">
            <div className="font-mono text-[11px] text-cyan-400">Reproducibility Checklist</div>
            {DEFAULT_REPRO_CHECKLIST.map((item) => (
              <label key={item} className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reproChecks.includes(item)}
                  onChange={() => toggleItem(reproChecks, setReproChecks, item)}
                  className="accent-cyan-500"
                />
                {item}
              </label>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-800 space-y-1.5">
            <div className="font-mono text-[11px] text-teal-400">Research Ethics Checklist</div>
            {DEFAULT_ETHICS_CHECKLIST.map((item) => (
              <label key={item} className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ethicsChecks.includes(item)}
                  onChange={() => toggleItem(ethicsChecks, setEthicsChecks, item)}
                  className="accent-teal-500"
                />
                {item}
              </label>
            ))}
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
          >
            <Plus className="w-3.5 h-3.5" /> Save Experiment Proposal (v1)
          </button>
        </form>

        {/* Documented Experiment Plans */}
        <div className="space-y-3">
          {experiments.length === 0 ? (
            <div className="border border-slate-800 bg-[#0D131F] rounded-md p-6 text-xs text-slate-400">
              No experimental plans documented yet. Draft a study design linked to a hypothesis on the left.
            </div>
          ) : (
            experiments.map((exp) => {
              const linkedHyp = hypotheses.find((h) => h.id === exp.hypothesis_id);
              let reproCount = 0;
              try {
                reproCount = JSON.parse(exp.reproducibility_checklist_json).length;
              } catch {
                reproCount = 0;
              }
              return (
                <div key={exp.id} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-2.5">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{exp.title}</div>
                      <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                        Version {exp.version} · Status: {exp.status} · Reproducibility Items: {reproCount}/4
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (editingId === exp.id) {
                            setEditingId(null);
                          } else {
                            setEditingId(exp.id);
                            setEditDesign(exp.study_design || '');
                            setEditStats(exp.statistical_methods || '');
                            setEditStatus(exp.status || 'peer_review_pending');
                          }
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] border border-slate-700 hover:border-cyan-500 rounded text-cyan-300"
                      >
                        <Edit3 className="w-3 h-3" /> Edit Rev
                      </button>
                      <button
                        onClick={() => bumpVersion(exp)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-slate-700 hover:border-cyan-500 rounded text-slate-200"
                      >
                        <CheckSquare className="w-3 h-3 text-cyan-400" /> Submit Review
                      </button>
                      <button
                        onClick={() => deleteExperiment(exp.id)}
                        title="Delete experiment plan"
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {linkedHyp && (
                    <div className="text-[11px] font-mono text-teal-400">
                      Linked Hypothesis: {linkedHyp.title}
                    </div>
                  )}
                  <div className="text-slate-200">{exp.scientific_question}</div>
                  {editingId === exp.id ? (
                    <div className="space-y-2 pt-1 border-t border-slate-800">
                      <textarea
                        rows={2}
                        value={editDesign}
                        onChange={(e) => setEditDesign(e.target.value)}
                        placeholder="Revised study design..."
                        className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-700 rounded text-slate-100"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={editStats}
                          onChange={(e) => setEditStats(e.target.value)}
                          placeholder="Statistical methods..."
                          className="px-2.5 py-1.5 bg-[#070B12] border border-slate-700 rounded text-slate-100"
                        />
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          className="px-2.5 py-1.5 bg-[#070B12] border border-slate-700 rounded text-slate-200"
                        >
                          <option value="proposal_draft">proposal_draft</option>
                          <option value="peer_review_pending">peer_review_pending</option>
                          <option value="approved_for_protocol">approved_for_protocol</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveRevision(exp.id)}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-600 text-slate-950 font-semibold rounded"
                        >
                          <Save className="w-3 h-3" /> Save v{exp.version + 1}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="inline-flex items-center gap-1 px-3 py-1 border border-slate-700 text-slate-300 rounded"
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {exp.study_design && <div className="text-slate-400">Design: {exp.study_design}</div>}
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1">
                        <div>Controls: {exp.control_groups || 'Not specified'}</div>
                        <div>Statistics: {exp.statistical_methods || 'Not specified'}</div>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Wet-Lab 96-Well Blinded Plate & ELN SOP Protocol Generator */}
      <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Grid className="w-4 h-4 text-cyan-400" /> Wet-Lab 96-Well Blinded Plate Matrix &amp; ELN SOP Export
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Seeded randomized 8x12 microplate layout with PBS evaporation moat, vehicle controls, serial dilutions, and ELN JSON export
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadPlateCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] border border-cyan-700/70 hover:border-cyan-400 rounded text-cyan-300"
            >
              <Download className="w-3.5 h-3.5" /> Plate Map CSV
            </button>
            <button
              type="button"
              onClick={downloadElnSopJson}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] border border-teal-700/70 hover:border-teal-400 rounded text-teal-300"
            >
              <Download className="w-3.5 h-3.5" /> Export ELN SOP JSON
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div>
            <label className="text-[10px] font-mono text-slate-400">Test Agent</label>
            <input
              value={plateAgentName}
              onChange={(e) => setPlateAgentName(e.target.value)}
              className="w-full mt-1 px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-400">Cell Line</label>
            <input
              value={plateCellLine}
              onChange={(e) => setPlateCellLine(e.target.value)}
              className="w-full mt-1 px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-400">Top Dose (uM)</label>
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={plateTopDoseUM}
              onChange={(e) => setPlateTopDoseUM(Math.max(0.1, Number(e.target.value) || 10))}
              className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-400">Dilution Ratio</label>
            <input
              type="number"
              min={1.5}
              max={10}
              step={0.5}
              value={plateDilutionFactor}
              onChange={(e) => setPlateDilutionFactor(Math.max(1.5, Number(e.target.value) || 3))}
              className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-400">Dose Points / Reps</label>
            <div className="flex gap-1 mt-1">
              <input
                type="number"
                min={3}
                max={8}
                value={plateDosePoints}
                onChange={(e) => setPlateDosePoints(Math.min(8, Math.max(3, Number(e.target.value) || 6)))}
                className="w-1/2 px-2 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
              <input
                type="number"
                min={2}
                max={6}
                value={plateReplicates}
                onChange={(e) => setPlateReplicates(Math.min(6, Math.max(2, Number(e.target.value) || 3)))}
                className="w-1/2 px-2 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-400">Blinding Seed</label>
            <input
              type="number"
              min={1}
              value={plateBlindingSeed}
              onChange={(e) => setPlateBlindingSeed(Math.max(1, Number(e.target.value) || 4091))}
              className="w-full mt-1 px-2.5 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
          <span>
            Serial Dilutions (uM): <span className="text-cyan-300">{generatedPlate.doses.join(' · ')}</span>
          </span>
          <span>
            Power Basis: <span className="text-emerald-300">alpha=0.05, 80% power → n={plateReplicates} biological replicates</span>
          </span>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="min-w-[680px] grid grid-cols-[24px_repeat(12,minmax(0,1fr))] gap-1 font-mono text-[9.5px]">
            <div className="text-slate-500 text-center py-1" />
            {Array.from({ length: 12 }, (_, c) => (
              <div key={c} className="text-slate-500 text-center py-1">
                {c + 1}
              </div>
            ))}
            {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((rowChar) => (
              <React.Fragment key={rowChar}>
                <div className="text-slate-500 flex items-center justify-center font-semibold">{rowChar}</div>
                {generatedPlate.wells
                  .filter((w) => w.row === rowChar)
                  .map((w) => {
                    const cls =
                      w.role === 'pbs_moat'
                        ? 'bg-slate-900/70 border-slate-800 text-slate-500'
                        : w.role === 'vehicle_dmso'
                        ? 'bg-teal-950/50 border-teal-800/70 text-teal-300'
                        : w.role === 'treatment'
                        ? 'bg-cyan-950/60 border-cyan-700/70 text-cyan-200'
                        : 'bg-[#070B12] border-slate-800 text-slate-600';
                    return (
                      <div
                        key={w.wellId}
                        title={`${w.wellId} | ${w.agent} | ${w.concentrationUM} uM | ${w.blindedCode}`}
                        className={`p-1 rounded border text-center truncate ${cls}`}
                      >
                        <div className="font-semibold">
                          {w.role === 'pbs_moat'
                            ? 'PBS'
                            : w.role === 'vehicle_dmso'
                            ? 'DMSO'
                            : w.role === 'treatment'
                            ? `${w.concentrationUM}`
                            : '—'}
                        </div>
                        <div className="text-[8px] opacity-75 truncate">{w.blindedCode}</div>
                      </div>
                    );
                  })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
