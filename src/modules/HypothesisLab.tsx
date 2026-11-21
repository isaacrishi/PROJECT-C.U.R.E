import React, { useEffect, useState } from 'react';
import { Columns, FlaskConical, Orbit, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ModuleId, ResearchHypothesis, User } from '../types';

const HYPOTHESIS_STATUSES = [
  'generated',
  'under_review',
  'evidence_gathering',
  'computationally_evaluated',
  'experimentally_proposed',
  'experimentally_tested',
  'supported',
  'refuted',
  'inconclusive',
];

const CONFIDENCE_LEVELS = [
  'insufficient_evidence',
  'low_preliminary',
  'moderate_emerging',
  'moderate_peer_reviewed',
  'high_computational',
  'experimentally_verified',
];

interface HypothesisLabProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
  onNavigate: (mod: ModuleId) => void;
  onSimulateHypothesis?: (hypothesisId: string) => void;
  onPlanExperiment?: (hypothesisId: string) => void;
}

export const HypothesisLab: React.FC<HypothesisLabProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
  onNavigate,
  onSimulateHypothesis,
  onPlanExperiment,
}) => {
  const [hypotheses, setHypotheses] = useState<ResearchHypothesis[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [rationale, setRationale] = useState('');
  const [mechanism, setMechanism] = useState('');
  const [genes, setGenes] = useState('');
  const [assumptions, setAssumptions] = useState('');
  const [limitations, setLimitations] = useState('');
  const [validationApproach, setValidationApproach] = useState('');

  // Add evidence form state
  const [evTargetId, setEvTargetId] = useState<string | null>(null);
  const [evPolarity, setEvPolarity] = useState<'supporting' | 'contradictory' | 'neutral'>('supporting');
  const [evType, setEvType] = useState('literature');
  const [evCitation, setEvCitation] = useState('');
  const [evSummary, setEvSummary] = useState('');

  const [error, setError] = useState('');

  const load = async () => {
    if (!user) {
      setHypotheses([]);
      setCompareIds([]);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const res = await apiFetch<{ hypotheses: ResearchHypothesis[] }>(`/api/hypotheses${q}`);
      setHypotheses(res.hypotheses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load hypotheses');
    }
  };

  useEffect(() => {
    load();
  }, [user?.id, activeProjectId]);

  const createHypothesis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setError('');
    try {
      await apiFetch('/api/hypotheses', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          title,
          research_question: question,
          biological_rationale: rationale,
          proposed_mechanism: mechanism,
          relevant_genes: genes.split(',').map((g) => g.trim()).filter(Boolean),
          assumptions,
          limitations,
          validation_approach: validationApproach,
        }),
      });
      setTitle('');
      setQuestion('');
      setRationale('');
      setMechanism('');
      setGenes('');
      setAssumptions('');
      setLimitations('');
      setValidationApproach('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save hypothesis');
    }
  };

  const updateStatus = async (id: string, status: string, confidence_level?: string) => {
    try {
      await apiFetch(`/api/hypotheses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, confidence_level }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update hypothesis');
    }
  };

  const deleteHypothesis = async (id: string) => {
    try {
      await apiFetch(`/api/hypotheses/${id}`, { method: 'DELETE' });
      setCompareIds((prev) => prev.filter((x) => x !== id));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete hypothesis');
    }
  };

  const addEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evTargetId) return;
    try {
      await apiFetch(`/api/hypotheses/${evTargetId}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          evidence_type: evType,
          polarity: evPolarity,
          citation_label: evCitation,
          summary: evSummary,
        }),
      });
      setEvTargetId(null);
      setEvCitation('');
      setEvSummary('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to link evidence');
    }
  };

  const deleteEvidence = async (hypothesisId: string, evidenceId: string) => {
    try {
      await apiFetch(`/api/hypotheses/${hypothesisId}/evidence/${evidenceId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove evidence record');
    }
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-3)));
  };

  const compared = hypotheses.filter((h) => compareIds.includes(h.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Hypothesis Lab</h1>
          <p className="text-xs text-slate-400 mt-1">
            Structured hypothesis lifecycle, supporting vs contradictory evidence tracking, and side-by-side comparison
          </p>
        </div>
        {compareIds.length >= 2 && (
          <button
            onClick={() => setShowCompare((v) => !v)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-slate-950 rounded"
          >
            <Columns className="w-3.5 h-3.5" /> {showCompare ? 'Hide Comparison' : `Compare Selected (${compareIds.length})`}
          </button>
        )}
      </div>

      <div className="p-2.5 border border-amber-800/50 bg-amber-950/20 rounded text-xs font-mono text-amber-300">
        SCIENTIFIC GUARDRAIL: Computational support does not equal experimental validation. A hypothesis never automatically becomes an established discovery.
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      {/* Side-by-Side Comparison Matrix */}
      {showCompare && compared.length >= 2 && (
        <section className="border border-cyan-800/60 bg-[#0B121F] rounded-md p-5 overflow-x-auto">
          <h2 className="text-sm font-semibold text-slate-100 mb-3">Side-by-Side Hypothesis Evaluation</h2>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono">
                <th className="py-2 pr-3 w-36">Dimension</th>
                {compared.map((h) => (
                  <th key={h.id} className="py-2 px-3 text-slate-100">
                    {h.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              <tr>
                <td className="py-2 pr-3 font-mono text-slate-400">Status</td>
                {compared.map((h) => (
                  <td key={h.id} className="py-2 px-3 font-mono text-cyan-300">
                    {h.status}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-3 font-mono text-slate-400">Confidence</td>
                {compared.map((h) => (
                  <td key={h.id} className="py-2 px-3 font-mono text-slate-200">
                    {h.confidence_level}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-3 font-mono text-slate-400">Proposed Mechanism</td>
                {compared.map((h) => (
                  <td key={h.id} className="py-2 px-3 text-slate-300">
                    {h.proposed_mechanism || '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2 pr-3 font-mono text-slate-400">Supporting vs Contradictory</td>
                {compared.map((h) => {
                  const sup = h.evidence.filter((e) => e.polarity === 'supporting').length;
                  const con = h.evidence.filter((e) => e.polarity === 'contradictory').length;
                  return (
                    <td key={h.id} className="py-2 px-3 font-mono tabular-nums">
                      <span className="text-emerald-400">{sup} supporting</span> ·{' '}
                      <span className="text-amber-400">{con} contradictory</span>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="py-2 pr-3 font-mono text-slate-400">Limitations</td>
                {compared.map((h) => (
                  <td key={h.id} className="py-2 px-3 text-slate-400">
                    {h.limitations || '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Hypothesis Form */}
        <form onSubmit={createHypothesis} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2.5 text-xs h-fit">
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase border-b border-slate-800 pb-2">
            Formulate New Hypothesis
          </h2>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Hypothesis title *"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <textarea
            required
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Testable scientific question *"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <textarea
            rows={2}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Biological rationale"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <textarea
            rows={2}
            value={mechanism}
            onChange={(e) => setMechanism(e.target.value)}
            placeholder="Proposed molecular/cellular mechanism"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <input
            value={genes}
            onChange={(e) => setGenes(e.target.value)}
            placeholder="Relevant genes/proteins (comma-separated)"
            className="w-full px-3 py-1.5 font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <input
            value={assumptions}
            onChange={(e) => setAssumptions(e.target.value)}
            placeholder="Explicit assumptions"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <input
            value={limitations}
            onChange={(e) => setLimitations(e.target.value)}
            placeholder="Known limitations"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <input
            value={validationApproach}
            onChange={(e) => setValidationApproach(e.target.value)}
            placeholder="Suggested experimental validation approach"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
          >
            <Plus className="w-3.5 h-3.5" /> Record Hypothesis
          </button>
        </form>

        {/* Hypotheses List */}
        <div className="lg:col-span-2 space-y-4">
          {hypotheses.length === 0 ? (
            <div className="border border-slate-800 bg-[#0D131F] rounded-md p-6 text-xs text-slate-400">
              No hypotheses recorded yet. Create one manually or promote candidates from AI Research Engine or Literature Intelligence.
            </div>
          ) : (
            hypotheses.map((h) => {
              let parsedGenes: string[] = [];
              try {
                parsedGenes = JSON.parse(h.relevant_genes_json);
              } catch {
                parsedGenes = [];
              }
              return (
                <div key={h.id} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={compareIds.includes(h.id)}
                          onChange={() => toggleCompare(h.id)}
                          title="Select for side-by-side comparison"
                          className="accent-teal-500"
                        />
                        <h3 className="text-sm font-semibold text-slate-100">{h.title}</h3>
                      </div>
                      <p className="text-slate-300">{h.research_question}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={h.status}
                        aria-label="Hypothesis status"
                        onChange={(e) => updateStatus(h.id, e.target.value, h.confidence_level)}
                        className="px-2 py-1 text-[11px] font-mono bg-[#070B12] border border-slate-700 rounded text-cyan-300"
                      >
                        {HYPOTHESIS_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                      <select
                        value={h.confidence_level}
                        aria-label="Hypothesis confidence level"
                        onChange={(e) => updateStatus(h.id, h.status, e.target.value)}
                        className="px-2 py-1 text-[11px] font-mono bg-[#070B12] border border-slate-700 rounded text-teal-300"
                      >
                        {CONFIDENCE_LEVELS.map((cl) => (
                          <option key={cl} value={cl}>
                            {cl}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          onSimulateHypothesis ? onSimulateHypothesis(h.id) : onNavigate('biological_simulation')
                        }
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-cyan-700/70 text-cyan-300 hover:bg-cyan-950/40 rounded"
                      >
                        <Orbit className="w-3 h-3" /> Simulate in 3D
                      </button>
                      <button
                        onClick={() =>
                          onPlanExperiment ? onPlanExperiment(h.id) : onNavigate('experiment_design')
                        }
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-teal-700/70 text-teal-300 hover:bg-teal-950/40 rounded"
                      >
                        <FlaskConical className="w-3 h-3" /> Plan Experiment
                      </button>
                      <button
                        onClick={() => deleteHypothesis(h.id)}
                        title="Delete hypothesis"
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="font-mono text-slate-400">Proposed Mechanism:</span>{' '}
                      <span className="text-slate-300">{h.proposed_mechanism || 'Not specified'}</span>
                    </div>
                    <div>
                      <span className="font-mono text-slate-400">Genes / Proteins:</span>{' '}
                      <span className="font-mono text-cyan-300">{parsedGenes.join(', ') || 'None specified'}</span>
                    </div>
                    <div>
                      <span className="font-mono text-slate-400">Limitations:</span>{' '}
                      <span className="text-slate-400">{h.limitations || 'Not documented'}</span>
                    </div>
                    <div>
                      <span className="font-mono text-slate-400">Validation Approach:</span>{' '}
                      <span className="text-slate-300">{h.validation_approach || 'Not specified'}</span>
                    </div>
                  </div>

                  {/* Evidence Links */}
                  <div className="pt-2 border-t border-slate-800/70 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-slate-400">
                        Linked Evidence Records ({h.evidence.length})
                      </span>
                      <button
                        onClick={() => setEvTargetId(evTargetId === h.id ? null : h.id)}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300"
                      >
                        + Link Supporting / Contradictory Evidence
                      </button>
                    </div>

                    {evTargetId === h.id && (
                      <form onSubmit={addEvidence} className="border border-slate-800 bg-[#070B12] p-3 rounded space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={evPolarity}
                            onChange={(e) => setEvPolarity(e.target.value as typeof evPolarity)}
                            className="px-2 py-1 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                          >
                            <option value="supporting">Supporting Evidence</option>
                            <option value="contradictory">Contradictory Evidence</option>
                            <option value="neutral">Neutral / Contextual</option>
                          </select>
                          <select
                            value={evType}
                            onChange={(e) => setEvType(e.target.value)}
                            className="px-2 py-1 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                          >
                            <option value="literature">Literature</option>
                            <option value="molecular_dataset">Molecular Dataset</option>
                            <option value="pathology_observation">Pathology Observation</option>
                            <option value="experimental_result">Experimental Result</option>
                          </select>
                        </div>
                        <input
                          required
                          value={evCitation}
                          onChange={(e) => setEvCitation(e.target.value)}
                          placeholder="Citation / Dataset identifier (e.g., PMID:36543210 or Cohort Welch t-test)"
                          className="w-full px-2.5 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-100"
                        />
                        <textarea
                          required
                          rows={2}
                          value={evSummary}
                          onChange={(e) => setEvSummary(e.target.value)}
                          placeholder="Empirical observation summary..."
                          className="w-full px-2.5 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-100"
                        />
                        <button type="submit" className="px-3 py-1 bg-cyan-600 text-slate-950 font-semibold rounded">
                          Attach Evidence
                        </button>
                      </form>
                    )}

                    {h.evidence.map((ev) => (
                      <div key={ev.id} className="p-2 border border-slate-800/70 bg-[#070B12] rounded flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-[11px]">
                            <span
                              className={
                                ev.polarity === 'contradictory'
                                  ? 'text-amber-400'
                                  : ev.polarity === 'supporting'
                                  ? 'text-emerald-400'
                                  : 'text-slate-400'
                              }
                            >
                              [{ev.polarity.toUpperCase()} · {ev.evidence_type}]
                            </span>{' '}
                            <span className="text-slate-200">{ev.citation_label}</span>
                          </div>
                          <div className="text-slate-400 mt-0.5">{ev.summary}</div>
                        </div>
                        <button
                          onClick={() => deleteEvidence(h.id, ev.id)}
                          title="Remove linked evidence"
                          className="p-1 text-slate-600 hover:text-rose-400 shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
