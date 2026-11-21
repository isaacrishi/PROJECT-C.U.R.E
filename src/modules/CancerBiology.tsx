import React, { useEffect, useState } from 'react';
import { ExternalLink, Plus, Search, Trash2 } from 'lucide-react';
import { CANCER_BIOLOGY_MECHANISMS, type CancerMechanismSpec } from '../data/cancerBiologyCatalog';
import { apiFetch } from '../lib/api';
import type { LiteratureResult, User } from '../types';

interface BioEntity {
  id: string;
  name: string;
  entity_type: string;
  mechanism_category: string;
  summary: string;
}

interface MolRel {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  evidence_level: string;
  supporting_ref: string;
}

interface CancerBiologyProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
}

export const CancerBiology: React.FC<CancerBiologyProps> = ({ user, activeProjectId, onOpenAuth }) => {
  const [selectedMech, setSelectedMech] = useState<CancerMechanismSpec>(CANCER_BIOLOGY_MECHANISMS[0]);
  const [pubs, setPubs] = useState<LiteratureResult[]>([]);
  const [loadingPubs, setLoadingPubs] = useState(false);

  const [entities, setEntities] = useState<BioEntity[]>([]);
  const [relationships, setRelationships] = useState<MolRel[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState('');
  const [nodeType, setNodeType] = useState('Gene / Protein');
  const [srcId, setSrcId] = useState('');
  const [tgtId, setTgtId] = useState('');
  const [relType, setRelType] = useState('activates');
  const [relEvidence, setRelEvidence] = useState('peer_reviewed');
  const [relRef, setRelRef] = useState('');
  const [error, setError] = useState('');

  const loadGraph = async () => {
    if (!user) {
      setEntities([]);
      setRelationships([]);
      setSelectedEntityId(null);
      setSrcId('');
      setTgtId('');
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const res = await apiFetch<{ entities: BioEntity[]; relationships: MolRel[] }>(`/api/biology/graph${q}`);
      setEntities(res.entities);
      setRelationships(res.relationships);
      if (selectedEntityId && !res.entities.some((e) => e.id === selectedEntityId)) {
        setSelectedEntityId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load project knowledge graph');
    }
  };

  useEffect(() => {
    loadGraph();
  }, [user?.id, activeProjectId]);

  const queryMechanismLiterature = async (mech: CancerMechanismSpec) => {
    setLoadingPubs(true);
    setPubs([]);
    try {
      const res = await apiFetch<{ results: LiteratureResult[] }>('/api/literature/search', {
        method: 'POST',
        body: JSON.stringify({ query: mech.pubmedQuery, sources: ['pubmed'], maxPerSource: 4 }),
      });
      setPubs(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to query PubMed');
    } finally {
      setLoadingPubs(false);
    }
  };

  const handleAddEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    if (!nodeName.trim()) return;
    setError('');
    try {
      await apiFetch('/api/biology/entities', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          name: nodeName.trim(),
          entity_type: nodeType,
          mechanism_category: selectedMech.name,
          summary: `Linked to ${selectedMech.name}`,
        }),
      });
      setNodeName('');
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add biological entity');
    }
  };

  const handleAddRel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    if (!srcId || !tgtId || srcId === tgtId) return;
    try {
      await apiFetch('/api/biology/relationships', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          source_entity_id: srcId,
          target_entity_id: tgtId,
          relationship_type: relType,
          evidence_level: relEvidence,
          supporting_ref: relRef,
        }),
      });
      setRelRef('');
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add relationship');
    }
  };

  const handleDeleteEntity = async (id: string) => {
    try {
      await apiFetch(`/api/biology/entities/${id}`, { method: 'DELETE' });
      if (srcId === id) setSrcId('');
      if (tgtId === id) setTgtId('');
      if (selectedEntityId === id) setSelectedEntityId(null);
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete entity');
    }
  };

  const handleDeleteRel = async (id: string) => {
    try {
      await apiFetch(`/api/biology/relationships/${id}`, { method: 'DELETE' });
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete relationship');
    }
  };

  // Layout nodes in a clean deterministic SVG circle for interactive inspection
  const svgW = 540;
  const svgH = 290;
  const positioned = entities.map((ent, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(entities.length, 1) - Math.PI / 2;
    const rx = 185;
    const ry = 100;
    return {
      ...ent,
      x: svgW / 2 + rx * Math.cos(angle),
      y: svgH / 2 + ry * Math.sin(angle),
    };
  });

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="text-xl font-semibold text-slate-100">Cancer Biology Intelligence</h1>
        <p className="text-xs text-slate-400 mt-1">
          Explore 14 core oncogenic mechanisms, established pathways, unresolved questions, and build a project knowledge graph
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* 14 Biological Mechanisms Selector */}
        <aside className="lg:col-span-1 border border-slate-800/90 bg-[#0D131F] rounded-md p-3 space-y-1 max-h-[75vh] overflow-y-auto">
          <div className="px-2 py-1.5 text-[11px] font-mono text-slate-400 uppercase">
            Biological Mechanisms ({CANCER_BIOLOGY_MECHANISMS.length})
          </div>
          {CANCER_BIOLOGY_MECHANISMS.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSelectedMech(m);
                setPubs([]);
              }}
              className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                selectedMech.id === m.id
                  ? 'bg-cyan-950/50 text-cyan-300 border border-cyan-700/60'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <div className="font-medium">{m.name}</div>
              <div className="text-[11px] text-slate-500">{m.category}</div>
            </button>
          ))}
        </aside>

        {/* Mechanism Detail & Knowledge Graph */}
        <div className="lg:col-span-3 space-y-5">
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="text-[11px] font-mono text-cyan-400">{selectedMech.category}</div>
                <h2 className="text-lg font-semibold text-slate-100">{selectedMech.name}</h2>
              </div>
              <button
                onClick={() => queryMechanismLiterature(selectedMech)}
                disabled={loadingPubs}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-cyan-700/70 text-cyan-300 hover:bg-cyan-950/40 rounded"
              >
                <Search className="w-3.5 h-3.5" /> {loadingPubs ? 'Querying PubMed...' : 'Fetch Live PubMed Papers'}
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">{selectedMech.biologicalFunction}</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-2">
              <div className="border border-slate-800 bg-[#070B12] rounded p-3">
                <div className="font-mono text-[11px] text-slate-400 mb-1.5">Cellular Processes</div>
                <ul className="space-y-1 text-slate-300 list-disc list-inside">
                  {selectedMech.cellularProcesses.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="border border-slate-800 bg-[#070B12] rounded p-3">
                <div className="font-mono text-[11px] text-slate-400 mb-1.5">Associated Genes & Proteins</div>
                <div className="font-mono text-cyan-300 leading-relaxed">
                  {selectedMech.associatedGenes.join(' · ')}
                </div>
              </div>
              <div className="border border-slate-800 bg-[#070B12] rounded p-3">
                <div className="font-mono text-[11px] text-slate-400 mb-1.5">Known Molecular Pathways</div>
                <ul className="space-y-1 text-slate-300 list-disc list-inside">
                  {selectedMech.molecularPathways.map((pw) => (
                    <li key={pw}>{pw}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-2 border-t border-slate-800/70">
              <div>
                <div className="font-mono text-[11px] text-teal-400 mb-1">Established Scientific Findings</div>
                <p className="text-slate-300 leading-relaxed">{selectedMech.establishedFindings}</p>
              </div>
              <div>
                <div className="font-mono text-[11px] text-amber-400 mb-1">Unresolved Research Questions</div>
                <ul className="list-disc list-inside text-slate-300 space-y-1">
                  {selectedMech.unresolvedQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            </div>

            {pubs.length > 0 && (
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="font-mono text-[11px] text-cyan-400">Live PubMed Supporting Publications</div>
                {pubs.map((p) => (
                  <div key={p.external_id} className="flex items-center justify-between gap-3 text-xs border-b border-slate-800/50 pb-1.5">
                    <div className="min-w-0">
                      <span className="font-mono text-slate-400">PMID:{p.pmid}</span> ·{' '}
                      <span className="text-slate-200">{p.title}</span>{' '}
                      <span className="text-slate-500">({p.journal}, {p.pub_date})</span>
                    </div>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 shrink-0 inline-flex items-center gap-1"
                    >
                      PubMed <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Interactive Biological Knowledge Graph */}
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Interactive Biological Knowledge Graph</h3>
                <p className="text-xs text-slate-400">
                  Connect genes, pathways, and biological mechanisms persisted for your active project
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {entities.length} Nodes · {relationships.length} Edges
              </span>
            </div>

            {error && <div className="text-xs text-rose-400">{error}</div>}

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <div className="xl:col-span-3 space-y-3">
                <div className="border border-slate-800 bg-[#070B12] rounded overflow-hidden">
                  {entities.length === 0 ? (
                    <div className="h-[290px] flex items-center justify-center text-xs text-slate-500 p-4 text-center">
                      Add biological entities and mechanistic relationships on the right to populate your project knowledge graph.
                    </div>
                  ) : (
                    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-[290px]">
                      <defs>
                        <marker id="arrow" viewBox="0 0 10 10" refX="20" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4" />
                        </marker>
                        <marker id="arrow-inhibit" viewBox="0 0 10 10" refX="20" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                          <line x1="8" y1="1" x2="8" y2="9" stroke="#f59e0b" strokeWidth="2.5" />
                        </marker>
                      </defs>
                      {relationships.map((rel) => {
                        const s = positioned.find((n) => n.id === rel.source_entity_id);
                        const t = positioned.find((n) => n.id === rel.target_entity_id);
                        if (!s || !t) return null;
                        const mx = (s.x + t.x) / 2;
                        const my = (s.y + t.y) / 2;
                        const isInhibit = rel.relationship_type === 'inhibits';
                        return (
                          <g key={rel.id}>
                            <line
                              x1={s.x}
                              y1={s.y}
                              x2={t.x}
                              y2={t.y}
                              stroke={isInhibit ? '#f59e0b' : '#06b6d4'}
                              strokeWidth="1.5"
                              strokeOpacity="0.75"
                              markerEnd={isInhibit ? 'url(#arrow-inhibit)' : 'url(#arrow)'}
                            />
                            <text x={mx} y={my - 4} fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="IBM Plex Mono">
                              {rel.relationship_type}
                            </text>
                          </g>
                        );
                      })}
                      {positioned.map((node) => {
                        const active = selectedEntityId === node.id;
                        return (
                          <g
                            key={node.id}
                            transform={`translate(${node.x},${node.y})`}
                            onClick={() => setSelectedEntityId(active ? null : node.id)}
                            className="cursor-pointer"
                          >
                            <circle
                              r={active ? 20 : 18}
                              fill={active ? '#134e4a' : '#0f172a'}
                              stroke={active ? '#22d3ee' : '#14b8a6'}
                              strokeWidth={active ? 2.2 : 1.5}
                            />
                            <text y="3" fill="#e2e8f0" fontSize="9.5" fontWeight="600" textAnchor="middle" fontFamily="IBM Plex Mono">
                              {node.name.slice(0, 10)}
                            </text>
                            <text y="29" fill="#64748b" fontSize="8.5" textAnchor="middle">
                              {node.entity_type}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </div>

                {selectedEntityId && (() => {
                  const sel = entities.find((e) => e.id === selectedEntityId);
                  if (!sel) return null;
                  const incident = relationships.filter(
                    (r) => r.source_entity_id === sel.id || r.target_entity_id === sel.id
                  );
                  return (
                    <div className="border border-cyan-800/60 bg-[#070B12] rounded p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-mono">
                        <span className="text-cyan-300 font-semibold">
                          {sel.name} · {sel.entity_type}
                        </span>
                        <span className="text-slate-400">{sel.mechanism_category}</span>
                      </div>
                      <p className="text-slate-300">{sel.summary || 'No summary documented.'}</p>
                      {incident.length > 0 && (
                        <div className="pt-1 border-t border-slate-800 font-mono text-[11px] text-slate-400 space-y-0.5">
                          {incident.map((r) => {
                            const sName = entities.find((e) => e.id === r.source_entity_id)?.name || r.source_entity_id;
                            const tName = entities.find((e) => e.id === r.target_entity_id)?.name || r.target_entity_id;
                            return (
                              <div key={r.id}>
                                {sName} <span className="text-teal-300">{r.relationship_type}</span> {tName} ({r.evidence_level}
                                {r.supporting_ref ? ` · ${r.supporting_ref}` : ''})
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="xl:col-span-2 space-y-4 text-xs">
                <form onSubmit={handleAddEntity} className="space-y-2 border border-slate-800 bg-[#070B12] p-3 rounded">
                  <div className="font-mono text-[11px] text-cyan-400">Add Biological Entity</div>
                  <input
                    value={nodeName}
                    onChange={(e) => setNodeName(e.target.value)}
                    placeholder="Entity (e.g., HIF1A, CD274, CAF)"
                    className="w-full px-2.5 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-100"
                  />
                  <select
                    value={nodeType}
                    onChange={(e) => setNodeType(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                  >
                    <option value="Gene / Protein">Gene / Protein</option>
                    <option value="Pathway">Signalling Pathway</option>
                    <option value="Cell State">Cell State / Population</option>
                    <option value="Mechanism">Hallmark Mechanism</option>
                  </select>
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-1 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Node
                  </button>
                </form>

                <form onSubmit={handleAddRel} className="space-y-2 border border-slate-800 bg-[#070B12] p-3 rounded">
                  <div className="font-mono text-[11px] text-teal-400">Connect Mechanism Edge</div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={srcId}
                      onChange={(e) => setSrcId(e.target.value)}
                      className="px-2 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                    >
                      <option value="">Source node</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={tgtId}
                      onChange={(e) => setTgtId(e.target.value)}
                      className="px-2 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                    >
                      <option value="">Target node</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={relType}
                      onChange={(e) => setRelType(e.target.value)}
                      className="px-2 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                    >
                      <option value="activates">activates</option>
                      <option value="inhibits">inhibits</option>
                      <option value="correlates_with">correlates_with</option>
                      <option value="resists">confers_resistance_to</option>
                    </select>
                    <select
                      value={relEvidence}
                      onChange={(e) => setRelEvidence(e.target.value)}
                      className="px-2 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                    >
                      <option value="established">Established</option>
                      <option value="peer_reviewed">Peer-Reviewed</option>
                      <option value="observational">Observational</option>
                      <option value="hypothesis">Hypothesised</option>
                    </select>
                  </div>
                  <input
                    value={relRef}
                    onChange={(e) => setRelRef(e.target.value)}
                    placeholder="PMID / DOI supporting reference"
                    className="w-full px-2.5 py-1.5 bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                  />
                  <button
                    type="submit"
                    className="w-full py-1.5 border border-teal-700 text-teal-300 hover:bg-teal-950/40 font-medium rounded"
                  >
                    Link Nodes
                  </button>
                </form>

                {(entities.length > 0 || relationships.length > 0) && (
                  <div className="border border-slate-800 bg-[#070B12] p-3 rounded space-y-2 max-h-40 overflow-y-auto">
                    <div className="font-mono text-[10px] text-slate-400 uppercase">Manage Graph Nodes & Edges</div>
                    {entities.map((ent) => (
                      <div key={ent.id} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-slate-200 truncate">{ent.name} ({ent.entity_type})</span>
                        <button
                          type="button"
                          onClick={() => handleDeleteEntity(ent.id)}
                          title="Remove node"
                          className="text-slate-500 hover:text-rose-400 p-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {relationships.map((rel) => {
                      const sName = entities.find((e) => e.id === rel.source_entity_id)?.name || rel.source_entity_id;
                      const tName = entities.find((e) => e.id === rel.target_entity_id)?.name || rel.target_entity_id;
                      return (
                        <div key={rel.id} className="flex items-center justify-between text-[11px] font-mono text-cyan-300">
                          <span className="truncate">{sName} → {rel.relationship_type} → {tName}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteRel(rel.id)}
                            title="Remove edge"
                            className="text-slate-500 hover:text-rose-400 p-0.5"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
