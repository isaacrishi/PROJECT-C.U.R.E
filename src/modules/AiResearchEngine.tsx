import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, FlaskConical, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { apiFetch, streamSsePost } from '../lib/api';
import type {
  CitationAuditResult,
  LiteratureResult,
  ModuleId,
  StructuredInvestigationOutput,
  User,
} from '../types';

interface ConversationRow {
  id: string;
  project_id: string | null;
  title: string;
  research_question: string;
  objectives: string;
  cancer_type: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  structured_json: string | null;
  model_used: string | null;
  tokens_used: number;
  latency_ms: number;
  created_at: string;
}

interface AiResearchEngineProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
  onNavigate: (mod: ModuleId) => void;
}

export const AiResearchEngine: React.FC<AiResearchEngineProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
  onNavigate,
}) => {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [question, setQuestion] = useState('');
  const [objectives, setObjectives] = useState('');
  const [cancerType, setCancerType] = useState('');
  const [mechanismsInput, setMechanismsInput] = useState('');
  const [liveGrounding, setLiveGrounding] = useState(true);
  const [loading, setLoading] = useState(false);
  const [streamStage, setStreamStage] = useState<{ stage: string; detail: string } | null>(null);
  const [error, setError] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const loadConversations = async () => {
    if (!user) {
      setConversations([]);
      setActiveConvId(null);
      setMessages([]);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const res = await apiFetch<{ conversations: ConversationRow[] }>(`/api/research/conversations${q}`);
      setConversations(res.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load research investigation threads');
    }
  };

  useEffect(() => {
    loadConversations();
    setActiveConvId(null);
    setMessages([]);
  }, [user?.id, activeProjectId]);

  const loadConversationDetail = async (id: string) => {
    try {
      const res = await apiFetch<{ conversation: ConversationRow; messages: MessageRow[] }>(
        `/api/research/conversations/${id}`
      );
      setActiveConvId(id);
      setMessages(res.messages);
      setCancerType(res.conversation.cancer_type);
      setObjectives(res.conversation.objectives);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load investigation');
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await apiFetch(`/api/research/conversations/${id}`, { method: 'DELETE' });
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete investigation thread');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!question.trim()) return;
    setLoading(true);
    setError('');
    setStatusNote('');
    setStreamStage({ stage: 'connecting', detail: 'Opening live AI Research Engine stream...' });
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    try {
      const mechanisms = mechanismsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      let completedConvId: string | null = null;
      let streamErr = '';
      await streamSsePost(
        '/api/research/investigate-stream',
        {
          conversationId: activeConvId,
          projectId: activeProjectId,
          question: question.trim(),
          objectives: objectives.trim(),
          cancerType: cancerType.trim(),
          mechanisms,
          liveGrounding,
        },
        (event, data) => {
          if (event === 'stage') {
            setStreamStage({
              stage: String(data.stage || 'processing'),
              detail: String(data.detail || ''),
            });
          } else if (event === 'complete') {
            completedConvId = String(data.conversationId || '');
          } else if (event === 'error') {
            streamErr = String(data.message || 'Investigation failed');
          }
        },
        controller.signal
      );
      if (streamErr) {
        throw new Error(streamErr);
      }
      setQuestion('');
      await loadConversations();
      if (completedConvId) {
        await loadConversationDetail(completedConvId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Investigation failed');
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
      }
      setLoading(false);
      setStreamStage(null);
    }
  };

  const promoteToHypothesis = async (
    candidate: StructuredInvestigationOutput['step8_candidate_hypotheses'][number],
    parentQuestion: string,
    citations: StructuredInvestigationOutput['step10_findings_and_references']['traceable_citations']
  ) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setStatusNote('');
    try {
      await apiFetch('/api/hypotheses', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          title: candidate.title,
          research_question: parentQuestion,
          biological_rationale: 'Generated via CURE 10-step structured AI investigation workflow (requires independent verification).',
          proposed_mechanism: candidate.proposed_mechanism,
          relevant_genes: candidate.relevant_genes,
          assumptions: 'AI-synthesised mechanistic link derived from retrieved abstracts and project context.',
          limitations: 'Not experimentally validated; subject to abstract-level evidence limitations.',
          confidence_level: 'low_preliminary',
          validation_approach: candidate.validation_approach,
          initial_evidence: citations.slice(0, 4).map((c) => ({
            evidence_type: 'ai_synthesis',
            polarity: 'supporting',
            source_type: 'traceable_citation',
            source_id: c.identifier,
            citation_label: `${c.identifier} — ${c.title}`,
            summary: `Evidence class: ${c.evidence_class}`,
          })),
        }),
      });
      setStatusNote(`Saved candidate hypothesis "${candidate.title}" into Hypothesis Lab.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save hypothesis');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
      {/* Left Investigation Threads */}
      <aside className="lg:col-span-1 border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3 h-fit">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">Investigations</h2>
          <button
            onClick={() => {
              setActiveConvId(null);
              setMessages([]);
            }}
            className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
        </div>

        {!user ? (
          <p className="text-xs text-slate-400">Sign in to save and resume project investigations.</p>
        ) : conversations.length === 0 ? (
          <p className="text-xs text-slate-500">No investigations yet for this scope.</p>
        ) : (
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`flex items-start justify-between gap-2 p-2.5 rounded border text-xs transition-colors ${
                  activeConvId === c.id
                    ? 'border-cyan-600/80 bg-[#070B12] text-slate-100'
                    : 'border-slate-800/60 bg-[#0A0F18] text-slate-400 hover:text-slate-200'
                }`}
              >
                <button onClick={() => loadConversationDetail(c.id)} className="flex-1 text-left min-w-0">
                  <div className="font-medium truncate">{c.title}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                    {c.cancer_type || 'General'} · {new Date(c.updated_at + 'Z').toLocaleDateString()}
                  </div>
                </button>
                <button
                  onClick={() => deleteConversation(c.id)}
                  title="Delete investigation thread"
                  aria-label={`Delete ${c.title}`}
                  className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Main 10-Step Research Workspace */}
      <div className="lg:col-span-3 space-y-5">
        <div className="border-b border-slate-800/80 pb-4">
          <h1 className="text-xl font-semibold text-slate-100">AI Research Engine</h1>
          <p className="text-xs text-slate-400 mt-1">
            Structured 10-step scientific reasoning powered by Gemini API with live PubMed / Europe PMC citation grounding
          </p>
        </div>

        {/* Investigation Context Form */}
        <form onSubmit={handleSubmit} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Cancer Type / Subtype</label>
              <input
                value={cancerType}
                onChange={(e) => setCancerType(e.target.value)}
                placeholder="e.g., EGFR-mutant NSCLC, Triple-negative breast"
                className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Research Objectives</label>
              <input
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
                placeholder="e.g., Identify bypass resistance mechanisms"
                className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Biological Mechanisms (comma-separated)</label>
              <input
                value={mechanismsInput}
                onChange={(e) => setMechanismsInput(e.target.value)}
                placeholder="e.g., Immune evasion, Hypoxia, EMT"
                className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Scientific Research Question</label>
            <textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Formulate a testable biological or computational oncology question..."
              className="w-full px-3 py-2 text-sm bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={liveGrounding}
                onChange={(e) => setLiveGrounding(e.target.checked)}
                className="accent-cyan-500"
              />
              Ground investigation with live PubMed & Europe PMC queries
            </label>
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {loading ? 'Running 10-Step Analysis...' : 'Run Structured Investigation'}
            </button>
          </div>
        </form>

        {loading && streamStage && (
          <div className="p-3 border border-cyan-800/70 bg-[#0A1320] rounded text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-cyan-300">
              <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 uppercase text-[10px]">
                {streamStage.stage}
              </span>
              <span className="text-slate-300 font-sans">{streamStage.detail}</span>
            </div>
            <span className="font-mono text-[11px] text-slate-400">SSE Live Stream</span>
          </div>
        )}

        {error && (
          <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
        )}
        {statusNote && (
          <div className="p-3 border border-emerald-800/60 bg-emerald-950/30 rounded text-xs text-emerald-300 flex items-center justify-between">
            <span>{statusNote}</span>
            <button onClick={() => onNavigate('hypothesis_lab')} className="underline text-emerald-200">
              View in Hypothesis Lab
            </button>
          </div>
        )}

        {/* Messages & Structured 10-Step Outputs */}
        <div className="space-y-4">
          {messages.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="border border-slate-800 bg-[#0B111E] rounded-md p-4">
                  <div className="text-[11px] font-mono text-cyan-400 mb-1">Research Query</div>
                  <div className="text-sm text-slate-100">{m.content}</div>
                </div>
              );
            }

            let parsed: {
              structured?: StructuredInvestigationOutput;
              retrievedLiterature?: LiteratureResult[];
              literatureErrors?: Array<{ source: string; message: string }>;
              citationAudit?: CitationAuditResult;
              failoverTriggered?: boolean;
              failoverNote?: string;
            } | null = null;
            try {
              if (m.structured_json) parsed = JSON.parse(m.structured_json);
            } catch {
              parsed = null;
            }
            const s = parsed?.structured;
            const audit = parsed?.citationAudit;

            if (!s) {
              return (
                <div key={m.id} className="border border-slate-800 bg-[#0D131F] rounded-md p-4 text-xs text-slate-200">
                  {m.content}
                </div>
              );
            }

            return (
              <div key={m.id} className="border border-slate-800 bg-[#0D131F] rounded-md p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3 text-[11px] font-mono text-slate-400">
                  <span>
                    AI-Assisted Structured Investigation · Model: {m.model_used || 'gemini-4-hydrogen'} ·{' '}
                    {m.tokens_used} tokens · {m.latency_ms} ms
                  </span>
                  <div className="flex items-center gap-3">
                    {audit && (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Audit Guard: {audit.verifiedCount} verified
                        {audit.strippedCount > 0 ? ` · ${audit.strippedCount} ungrounded stripped` : ''}
                      </span>
                    )}
                    <span className={s.insufficient_evidence_flag ? 'text-amber-400' : 'text-teal-400'}>
                      Confidence: {s.step9_confidence_assessment.level}
                    </span>
                  </div>
                </div>

                {parsed?.failoverTriggered && parsed.failoverNote && (
                  <div className="p-2.5 border border-sky-800/60 bg-sky-950/30 rounded text-[11px] font-mono text-sky-300">
                    RESILIENCE FAILOVER: {parsed.failoverNote}
                  </div>
                )}

                {audit && audit.flaggedUngrounded.length > 0 && (
                  <div className="p-2.5 border border-amber-800/60 bg-amber-950/20 rounded text-[11px] font-mono text-amber-300">
                    Citation Audit Guard flagged &amp; excluded ungrounded identifier(s) not found in retrieved corpus:{' '}
                    {audit.flaggedUngrounded.join(', ')}
                  </div>
                )}

                {s.insufficient_evidence_flag && (
                  <div className="p-3 border border-amber-800/60 bg-amber-950/30 rounded text-xs text-amber-200 font-mono">
                    INSUFFICIENT SCIENTIFIC EVIDENCE — Retrieved sources do not support definitive mechanistic claims.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <div className="font-mono text-[11px] text-cyan-400">STEP 1 · Question Understanding</div>
                    <p className="text-slate-300 leading-relaxed">{s.step1_question_understanding}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="font-mono text-[11px] text-cyan-400">STEP 2 & 3 · Domain & Evidence Needed</div>
                    <p className="text-slate-300">
                      <span className="text-slate-400">Domains:</span> {s.step2_biological_domain.join(' · ')}
                    </p>
                    <p className="text-slate-300">
                      <span className="text-slate-400">Needed:</span> {s.step3_evidence_needed.join(' · ')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-3 border-t border-slate-800/70">
                  <div className="space-y-1.5">
                    <div className="font-mono text-[11px] text-cyan-400">STEP 4 & 5 · Retrieved Sources & Quality</div>
                    <p className="text-slate-300 leading-relaxed">{s.step4_retrieved_sources_summary}</p>
                    <p className="text-slate-400 leading-relaxed">{s.step5_source_quality_and_limitations}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="font-mono text-[11px] text-cyan-400">STEP 6 & 7 · Biological Relationships & Conflicts</div>
                    <p className="text-slate-300 leading-relaxed">{s.step6_biological_relationships}</p>
                    <p className="text-amber-300/90 leading-relaxed">{s.step7_conflicting_evidence_uncertainties}</p>
                  </div>
                </div>

                {/* STEP 8 Candidate Hypotheses */}
                {s.step8_candidate_hypotheses.length > 0 && (
                  <div className="pt-3 border-t border-slate-800/70 space-y-2.5">
                    <div className="font-mono text-[11px] text-amber-400">
                      STEP 8 · Candidate Hypotheses (AI-Generated — Unvalidated)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {s.step8_candidate_hypotheses.map((h, idx) => (
                        <div key={idx} className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-2 text-xs">
                          <div className="font-semibold text-slate-100">{h.title}</div>
                          <p className="text-slate-300 leading-relaxed">{h.proposed_mechanism}</p>
                          <div className="font-mono text-[11px] text-slate-400">
                            Genes: {h.relevant_genes.join(', ') || 'None specified'}
                          </div>
                          <div className="text-[11px] text-slate-400">Validation: {h.validation_approach}</div>
                          <button
                            onClick={() =>
                              promoteToHypothesis(
                                h,
                                s.step1_question_understanding,
                                s.step10_findings_and_references.traceable_citations
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border border-cyan-700/70 text-cyan-300 hover:bg-cyan-950/40 rounded"
                          >
                            <FlaskConical className="w-3 h-3" /> Send to Hypothesis Lab
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 9 & 10 Findings & Traceable Citations */}
                <div className="pt-3 border-t border-slate-800/70 space-y-2.5 text-xs">
                  <div className="font-mono text-[11px] text-teal-400">
                    STEP 9 & 10 · Confidence Rationale & Traceable Findings
                  </div>
                  <p className="text-slate-300 leading-relaxed">{s.step10_findings_and_references.summary}</p>
                  <p className="text-slate-400 text-[11px]">
                    Confidence Basis: {s.step9_confidence_assessment.rationale}
                  </p>

                  {s.step10_findings_and_references.traceable_citations.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[11px] font-mono text-slate-400">Traceable Citations</div>
                      {s.step10_findings_and_references.traceable_citations.map((c, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3 py-1 border-b border-slate-800/40">
                          <div className="min-w-0">
                            <span className="font-mono text-cyan-400">{c.identifier}</span>
                            <span className="text-slate-500 mx-1.5">·</span>
                            <span className="text-slate-200">{c.title}</span>
                            <span className="text-slate-500 mx-1.5">·</span>
                            <span className="text-slate-400">{c.evidence_class}</span>
                          </div>
                          {c.url && (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 shrink-0 inline-flex items-center gap-1"
                            >
                              Source <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {s.unresolved_questions.length > 0 && (
                    <div className="pt-2">
                      <div className="text-[11px] font-mono text-slate-400 mb-1">Unresolved Questions</div>
                      <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                        {s.unresolved_questions.map((uq, i) => (
                          <li key={i}>{uq}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {parsed?.literatureErrors && parsed.literatureErrors.length > 0 && (
                  <div className="text-[11px] text-amber-400 font-mono">
                    Note: Partial literature connector errors —{' '}
                    {parsed.literatureErrors.map((e) => `${e.source}: ${e.message}`).join('; ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
