import React, { useEffect, useMemo, useState } from 'react';
import { BookmarkCheck, BookmarkPlus, Check, Copy, Download, ExternalLink, FlaskConical, Search, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { LiteratureResult, ModuleId, User } from '../types';

interface LiteratureIntelligenceProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
  onNavigate: (mod: ModuleId) => void;
}

interface CorpusSynthesis {
  recurring_findings: string[];
  conflicting_findings: string[];
  overall_limitations: string[];
  per_article_notes: Array<{
    identifier: string;
    methodology: string;
    main_findings: string;
    limitations: string;
  }>;
}

export const LiteratureIntelligence: React.FC<LiteratureIntelligenceProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
  onNavigate,
}) => {
  const [query, setQuery] = useState('');
  const [cancerType, setCancerType] = useState('');
  const [pathway, setPathway] = useState('');
  const [methodology, setMethodology] = useState('');
  const [pubType, setPubType] = useState('all');
  const [yearFrom, setYearFrom] = useState('');
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Array<'pubmed' | 'europepmc' | 'crossref' | 'clinicaltrials'>>([
    'pubmed',
    'europepmc',
    'clinicaltrials',
  ]);

  const [results, setResults] = useState<LiteratureResult[]>([]);
  const [errors, setErrors] = useState<Array<{ source: string; message: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [synthesis, setSynthesis] = useState<CorpusSynthesis | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastExecutedQuery, setLastExecutedQuery] = useState<string>('');

  const prismaStats = useMemo(() => {
    const bySource: Record<string, number> = {};
    for (const r of results) {
      bySource[r.source_db] = (bySource[r.source_db] || 0) + 1;
    }
    const seenIds = new Set<string>();
    let duplicatesRemoved = 0;
    for (const r of results) {
      const canonicalKey = r.doi
        ? `doi:${r.doi.toLowerCase()}`
        : r.pmid
        ? `pmid:${r.pmid}`
        : `${r.source_db}:${r.external_id}`;
      if (seenIds.has(canonicalKey)) duplicatesRemoved++;
      else seenIds.add(canonicalKey);
    }
    const uniqueScreened = results.length - duplicatesRemoved;
    const fullTextEligible = results.filter((r) => r.full_text_available).length;
    const savedInSession = results.filter((r) => savedKeys.includes(`${r.source_db}:${r.external_id}`)).length;
    return {
      identifiedTotal: results.length,
      bySource,
      duplicatesRemoved,
      recordsScreened: uniqueScreened,
      fullTextEligible,
      savedInSession,
      preprintsFlagged: results.filter((r) => r.is_preprint).length,
    };
  }, [results, savedKeys]);

  const exportPrismaFlow = (format: 'json' | 'markdown') => {
    const dateStr = new Date().toISOString();
    const sourcesStr = Object.entries(prismaStats.bySource)
      .map(([db, count]) => `${db.toUpperCase()}: n=${count}`)
      .join(', ');
    if (format === 'json') {
      const payload = {
        schema: 'PRISMA_2020_Literature_Flow',
        generatedAt: dateStr,
        query: lastExecutedQuery || query,
        filters: { cancerType, pathway, methodology, pubType, yearFrom, openAccessOnly },
        identification: {
          databasesQueried: selectedSources,
          totalRecordsIdentified: prismaStats.identifiedTotal,
          breakdownByDatabase: prismaStats.bySource,
          duplicatesRemovedByCanonicalId: prismaStats.duplicatesRemoved,
        },
        screening: {
          recordsScreened: prismaStats.recordsScreened,
          preprintsFlaggedNotPeerReviewed: prismaStats.preprintsFlagged,
        },
        eligibility: {
          openAccessFullTextEligible: prismaStats.fullTextEligible,
          abstractOnlyRecords: prismaStats.identifiedTotal - prismaStats.fullTextEligible,
        },
        included: {
          savedToProjectLibrary: prismaStats.savedInSession,
          totalLibrarySaved: savedKeys.length,
        },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prisma_2020_flow.json`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const md = [
      `# PRISMA 2020 Literature Discovery Flow Summary`,
      `- **Generated:** ${dateStr}`,
      `- **Primary Query:** ${lastExecutedQuery || query}`,
      `- **Filters:** Cancer=${cancerType || 'All'} | Pathway=${pathway || 'All'} | Methodology=${methodology || 'All'} | PubType=${pubType} | Year>=${yearFrom || 'Any'} | OpenAccessOnly=${openAccessOnly}`,
      ``,
      `## Flow Stages`,
      `1. **Identification:** ${prismaStats.identifiedTotal} records identified (${sourcesStr || 'None'})`,
      `2. **Deduplication:** ${prismaStats.duplicatesRemoved} cross-database duplicates detected (PMID/DOI match)`,
      `3. **Title & Abstract Screening:** ${prismaStats.recordsScreened} unique records screened (${prismaStats.preprintsFlagged} preprints flagged non-peer-reviewed)`,
      `4. **Full-Text Eligibility:** ${prismaStats.fullTextEligible} open-access full-text eligible (${prismaStats.identifiedTotal - prismaStats.fullTextEligible} abstract-only)`,
      `5. **Included in Research Library:** ${prismaStats.savedInSession} saved from active search (${savedKeys.length} total project records)`,
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prisma_2020_flow.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!user) {
      setSavedKeys([]);
      return;
    }
    const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
    apiFetch<{ items: Array<{ source_db: string; external_id: string }> }>(`/api/literature/saved${q}`)
      .then((res) => setSavedKeys(res.items.map((i) => `${i.source_db}:${i.external_id}`)))
      .catch(() => {});
  }, [user?.id, activeProjectId]);

  const toggleSource = (src: 'pubmed' | 'europepmc' | 'crossref' | 'clinicaltrials') => {
    setSelectedSources((prev) =>
      prev.includes(src) ? (prev.length > 1 ? prev.filter((s) => s !== src) : prev) : [...prev, src]
    );
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setErrorMsg('');
    setStatusMsg('');
    setSynthesis(null);
    setLastExecutedQuery(query.trim());
    try {
      const res = await apiFetch<{
        results: LiteratureResult[];
        errors: Array<{ source: string; message: string }>;
      }>('/api/literature/search', {
        method: 'POST',
        body: JSON.stringify({
          query: query.trim(),
          cancerType: cancerType.trim(),
          pathway: pathway.trim(),
          methodology: methodology.trim(),
          pubType,
          yearFrom: yearFrom.trim(),
          openAccessOnly,
          sources: selectedSources,
        }),
      });
      setResults(res.results);
      setErrors(res.errors);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Literature query failed');
    } finally {
      setSearching(false);
    }
  };

  const handleAnalyzeCorpus = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (results.length === 0) return;
    setAnalyzing(true);
    setErrorMsg('');
    try {
      const articles = results.slice(0, 8).map((r) => ({
        identifier: r.pmid ? `PMID:${r.pmid}` : r.doi ? `DOI:${r.doi}` : r.nct_id || r.external_id,
        title: r.title,
        abstract: r.abstract,
        pub_type: r.pub_type,
        pub_date: r.pub_date,
      }));
      const res = await apiFetch<{ analysis: CorpusSynthesis }>('/api/literature/analyze', {
        method: 'POST',
        body: JSON.stringify({ articles, focusQuestion: query }),
      });
      setSynthesis(res.analysis);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Literature analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const saveToLibrary = async (r: LiteratureResult) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setErrorMsg('');
    try {
      const note = synthesis?.per_article_notes.find((n) =>
        n.identifier.includes(r.pmid || r.doi || r.external_id)
      );
      await apiFetch('/api/literature/save', {
        method: 'POST',
        body: JSON.stringify({
          ...r,
          project_id: activeProjectId,
          methodology_summary: note?.methodology || '',
          main_findings: note?.main_findings || '',
          limitations: note?.limitations || (r.full_text_available ? '' : 'Analysis based on abstract/metadata only.'),
          tags: [r.source_db, cancerType].filter(Boolean),
        }),
      });
      setSavedKeys((prev) =>
        prev.includes(`${r.source_db}:${r.external_id}`) ? prev : [...prev, `${r.source_db}:${r.external_id}`]
      );
      setStatusMsg(`Saved "${r.title.slice(0, 60)}..." to Research Library.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save publication');
    }
  };

  const copyBibtex = async (r: LiteratureResult) => {
    const key = (r.pmid || r.doi || r.nct_id || r.external_id).replace(/[^a-zA-Z0-9]/g, '_');
    const year = (r.pub_date || '').match(/\d{4}/)?.[0] || 'n.d.';
    const bibtex = `@article{cure_${key},\n  title = {${r.title}},\n  author = {${r.authors.join(' and ') || 'Unknown'}},\n  journal = {${r.journal || r.source_db}},\n  year = {${year}}${r.doi ? `,\n  doi = {${r.doi}}` : ''}${r.url ? `,\n  url = {${r.url}}` : ''}\n}`;
    try {
      await navigator.clipboard?.writeText(bibtex);
      setCopiedId(`${r.source_db}:${r.external_id}`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setStatusMsg(`BibTeX ready: ${bibtex}`);
    }
  };

  const sendToHypothesisLab = async (r: LiteratureResult) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    try {
      const idLabel = r.pmid ? `PMID:${r.pmid}` : r.doi ? `DOI:${r.doi}` : r.nct_id || r.external_id;
      await apiFetch('/api/hypotheses', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          title: `Hypothesis from ${idLabel}: ${r.title.slice(0, 72)}`,
          research_question: `Does the mechanism reported in ${idLabel} generalise across ${cancerType || 'target oncology cohorts'}?`,
          biological_rationale: r.abstract.slice(0, 500),
          assumptions: r.full_text_available
            ? 'Derived from open-access literature record; requires dataset verification.'
            : 'Based on abstract metadata only (full text not parsed).',
          limitations: 'Single-source literature origin; requires cross-study and experimental validation.',
          confidence_level: 'low_preliminary',
          validation_approach: 'Cross-reference with project molecular dataset and design controlled perturbation assay.',
          initial_evidence: [
            {
              evidence_type: 'literature',
              polarity: 'supporting',
              source_type: r.source_db,
              source_id: r.external_id,
              citation_label: `${idLabel} · ${r.title}`,
              summary: r.abstract.slice(0, 320),
            },
          ],
        }),
      });
      setStatusMsg(`Created draft hypothesis linked to ${idLabel} in Hypothesis Lab.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create hypothesis');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Literature Intelligence</h1>
          <p className="text-xs text-slate-400 mt-1">
            Live federated discovery across NCBI PubMed, Europe PMC, Crossref, and ClinicalTrials.gov
          </p>
        </div>
        {results.length > 0 && (
          <button
            onClick={handleAnalyzeCorpus}
            disabled={analyzing}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-cyan-700/70 text-cyan-300 hover:bg-cyan-950/40 rounded disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {analyzing ? 'Synthesising Abstracts...' : 'Synthesise Findings & Conflicts'}
          </button>
        )}
      </div>

      {/* Search & Filters */}
      <form onSubmit={handleSearch} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <input
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search genes, pathways, therapies, or mechanisms (e.g., KRAS G12C resistance, PD-L1 hypoxia)..."
              className="w-full px-3.5 py-2 text-sm bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="flex items-center justify-center gap-2 px-5 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded transition-colors disabled:opacity-50 shrink-0"
          >
            <Search className="w-3.5 h-3.5" /> {searching ? 'Querying APIs...' : 'Search Literature'}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          <input
            value={cancerType}
            onChange={(e) => setCancerType(e.target.value)}
            placeholder="Cancer type filter"
            className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          />
          <input
            value={pathway}
            onChange={(e) => setPathway(e.target.value)}
            placeholder="Molecular pathway"
            className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          />
          <input
            value={methodology}
            onChange={(e) => setMethodology(e.target.value)}
            placeholder="Methodology (e.g., scRNA-seq)"
            className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          />
          <select
            value={pubType}
            onChange={(e) => setPubType(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Publication Types</option>
            <option value="Clinical Trial">Clinical Trial</option>
            <option value="Review">Review</option>
            <option value="Meta-Analysis">Meta-Analysis</option>
          </select>
          <input
            value={yearFrom}
            onChange={(e) => setYearFrom(e.target.value)}
            placeholder="Year from (e.g., 2021)"
            className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {(['pubmed', 'europepmc', 'crossref', 'clinicaltrials'] as const).map((src) => (
              <label key={src} className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSources.includes(src)}
                  onChange={() => toggleSource(src)}
                  className="accent-cyan-500"
                />
                <span className="font-mono text-[11px] uppercase">{src}</span>
              </label>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={openAccessOnly}
              onChange={(e) => setOpenAccessOnly(e.target.checked)}
              className="accent-cyan-500"
            />
            Open-Access Full-Text Filter (Europe PMC)
          </label>
        </div>
      </form>

      {errorMsg && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{errorMsg}</div>
      )}
      {statusMsg && (
        <div className="p-3 border border-emerald-800/60 bg-emerald-950/30 rounded text-xs text-emerald-300 flex items-center justify-between">
          <span>{statusMsg}</span>
          <div className="flex gap-3">
            <button onClick={() => onNavigate('research_library')} className="underline">
              Research Library
            </button>
            <button onClick={() => onNavigate('hypothesis_lab')} className="underline">
              Hypothesis Lab
            </button>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="p-3 border border-amber-800/60 bg-amber-950/30 rounded text-xs text-amber-200">
          Connector Warnings: {errors.map((e) => `${e.source} (${e.message})`).join(' · ')}
        </div>
      )}

      {/* PRISMA 2020 Flow Summary */}
      {results.length > 0 && (
        <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-wider text-cyan-400">
                PRISMA 2020 Discovery Flow Summary
              </span>
              <span className="ml-2 text-[11px] text-slate-500">
                ({Object.entries(prismaStats.bySource)
                  .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
                  .join(' · ')})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportPrismaFlow('markdown')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono border border-slate-700 hover:border-cyan-500 rounded text-slate-300"
              >
                <Download className="w-3 h-3 text-cyan-400" /> Export PRISMA MD
              </button>
              <button
                type="button"
                onClick={() => exportPrismaFlow('json')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono border border-slate-700 hover:border-cyan-500 rounded text-slate-300"
              >
                <Download className="w-3 h-3 text-teal-400" /> Export PRISMA JSON
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono">
            <div className="p-2.5 bg-[#070B12] border border-slate-800 rounded">
              <div className="text-[10px] text-slate-500">1. IDENTIFIED</div>
              <div className="text-base font-semibold text-slate-100 mt-0.5 tabular-nums">{prismaStats.identifiedTotal}</div>
            </div>
            <div className="p-2.5 bg-[#070B12] border border-slate-800 rounded">
              <div className="text-[10px] text-slate-500">2. DEDUPLICATED</div>
              <div className="text-base font-semibold text-amber-300 mt-0.5 tabular-nums">-{prismaStats.duplicatesRemoved}</div>
            </div>
            <div className="p-2.5 bg-[#070B12] border border-slate-800 rounded">
              <div className="text-[10px] text-slate-500">3. SCREENED UNIQUE</div>
              <div className="text-base font-semibold text-cyan-300 mt-0.5 tabular-nums">{prismaStats.recordsScreened}</div>
            </div>
            <div className="p-2.5 bg-[#070B12] border border-slate-800 rounded">
              <div className="text-[10px] text-slate-500">4. FULL-TEXT ELIGIBLE</div>
              <div className="text-base font-semibold text-teal-300 mt-0.5 tabular-nums">{prismaStats.fullTextEligible}</div>
            </div>
            <div className="p-2.5 bg-[#070B12] border border-slate-800 rounded">
              <div className="text-[10px] text-slate-500">5. LIBRARY SAVED</div>
              <div className="text-base font-semibold text-emerald-300 mt-0.5 tabular-nums">{prismaStats.savedInSession}</div>
            </div>
          </div>
        </div>
      )}

      {/* AI Literature Synthesis Panel */}
      {synthesis && (
        <div className="border border-cyan-900/50 bg-[#0B121F] rounded-md p-5 space-y-3 text-xs">
          <div className="font-mono text-[11px] text-cyan-400">
            ABSTRACT-BASED EVIDENCE SYNTHESIS (Full text not parsed unless explicitly open-access)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="font-semibold text-slate-200 mb-1">Recurring Findings</div>
              <ul className="list-disc list-inside text-slate-300 space-y-1">
                {synthesis.recurring_findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-amber-300 mb-1">Conflicting Evidence</div>
              <ul className="list-disc list-inside text-slate-300 space-y-1">
                {synthesis.conflicting_findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-200 mb-1">Methodological Limitations</div>
              <ul className="list-disc list-inside text-slate-400 space-y-1">
                {synthesis.overall_limitations.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Results List */}
      <div className="space-y-3">
        {results.length === 0 && !searching && (
          <div className="border border-slate-800 bg-[#0D131F] rounded-md p-6 text-xs text-slate-400">
            Enter a biological or clinical oncology query above to retrieve real publications and clinical trial records.
          </div>
        )}

        {results.map((r, idx) => {
          const note = synthesis?.per_article_notes.find((n) =>
            n.identifier.includes(r.pmid || r.doi || r.external_id)
          );
          return (
            <article key={`${r.source_db}-${r.external_id}-${idx}`} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="text-[11px] font-mono text-slate-400 flex flex-wrap items-center gap-1.5">
                    <span className="text-cyan-400 uppercase">{r.source_db}</span>
                    <span>·</span>
                    <span>{r.pub_type}</span>
                    {r.is_preprint && (
                      <>
                        <span>·</span>
                        <span className="text-amber-400">PREPRINT (NOT PEER-REVIEWED)</span>
                      </>
                    )}
                    {r.correction_status !== 'none' && (
                      <>
                        <span>·</span>
                        <span className="text-rose-400">NOTICE: {r.correction_status}</span>
                      </>
                    )}
                    {r.pmid && (
                      <>
                        <span>·</span>
                        <span>PMID:{r.pmid}</span>
                      </>
                    )}
                    {r.doi && (
                      <>
                        <span>·</span>
                        <span>DOI:{r.doi}</span>
                      </>
                    )}
                    {r.nct_id && (
                      <>
                        <span>·</span>
                        <span>{r.nct_id}</span>
                      </>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-100 leading-snug">{r.title}</h3>
                  <div className="text-xs text-slate-400">
                    {r.authors.slice(0, 5).join(', ')}
                    {r.authors.length > 5 ? ' et al.' : ''} · {r.journal} · {r.pub_date || 'Date N/A'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {(() => {
                    const key = `${r.source_db}:${r.external_id}`;
                    const isSaved = savedKeys.includes(key);
                    return (
                      <button
                        onClick={() => saveToLibrary(r)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs border rounded ${
                          isSaved
                            ? 'border-emerald-700/70 bg-emerald-950/30 text-emerald-300'
                            : 'border-slate-700 hover:border-cyan-500 text-slate-200'
                        }`}
                      >
                        {isSaved ? (
                          <>
                            <BookmarkCheck className="w-3.5 h-3.5 text-emerald-400" /> Saved
                          </>
                        ) : (
                          <>
                            <BookmarkPlus className="w-3.5 h-3.5 text-cyan-400" /> Save
                          </>
                        )}
                      </button>
                    );
                  })()}
                  <button
                    onClick={() => sendToHypothesisLab(r)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-700 hover:border-teal-500 text-slate-200 rounded"
                  >
                    <FlaskConical className="w-3.5 h-3.5 text-teal-400" /> To Hypothesis
                  </button>
                  <button
                    onClick={() => copyBibtex(r)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-800 hover:border-slate-600 text-slate-300 rounded"
                  >
                    {copiedId === `${r.source_db}:${r.external_id}` ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-slate-400" /> BibTeX
                      </>
                    )}
                  </button>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-800 hover:border-slate-600 text-cyan-400 rounded"
                  >
                    Source <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">{r.abstract}</p>

              <div className="text-[11px] font-mono text-slate-500">
                {r.full_text_available
                  ? 'Full-text / Open-access identifier available at source URL.'
                  : 'Full text unavailable via API; displayed analysis is restricted to abstract and metadata.'}
              </div>

              {note && (
                <div className="pt-2 border-t border-slate-800/70 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <span className="text-slate-400 font-mono">Methodology:</span>{' '}
                    <span className="text-slate-300">{note.methodology}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-mono">Main Findings:</span>{' '}
                    <span className="text-slate-300">{note.main_findings}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-mono">Limitations:</span>{' '}
                    <span className="text-amber-300/90">{note.limitations}</span>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};
