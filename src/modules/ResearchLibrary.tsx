import React, { useEffect, useState } from 'react';
import { Download, Edit3, ExternalLink, History, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { User } from '../types';

interface SavedLit {
  id: string;
  source_db: string;
  external_id: string;
  pmid: string | null;
  doi: string | null;
  title: string;
  journal: string;
  pub_date: string;
  pub_type: string;
  url: string;
  tags_json: string;
}

interface ResearchDoc {
  id: string;
  item_type: string;
  title: string;
  category: string;
  folder: string;
  tags_json: string;
  content: string;
  source_ref: string;
  version: number;
  updated_at: string;
}

interface DocVersion {
  id: string;
  version: number;
  content: string;
  editor_name: string | null;
  created_at: string;
}

interface ResearchLibraryProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
}

export const ResearchLibrary: React.FC<ResearchLibraryProps> = ({ user, activeProjectId, onOpenAuth }) => {
  const [tab, setTab] = useState<'all' | 'literature' | 'documents'>('all');
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('All');
  const [literature, setLiterature] = useState<SavedLit[]>([]);
  const [documents, setDocuments] = useState<ResearchDoc[]>([]);

  const [docType, setDocType] = useState<'note' | 'pathway_ref' | 'protocol' | 'finding_summary'>('note');
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState('Oncology');
  const [docFolder, setDocFolder] = useState('Root');
  const [docTags, setDocTags] = useState('');
  const [docSourceRef, setDocSourceRef] = useState('');
  const [docContent, setDocContent] = useState('');
  const [error, setError] = useState('');

  // Document editing & version history state
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);
  const [docVersions, setDocVersions] = useState<DocVersion[]>([]);

  const load = async () => {
    if (!user) {
      setLiterature([]);
      setDocuments([]);
      setHistoryDocId(null);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const [litRes, docRes] = await Promise.all([
        apiFetch<{ items: SavedLit[] }>(`/api/literature/saved${q}`),
        apiFetch<{ documents: ResearchDoc[] }>(`/api/library/documents${q}`),
      ]);
      setLiterature(litRes.items);
      setDocuments(docRes.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load research library');
    }
  };

  useEffect(() => {
    load();
  }, [user?.id, activeProjectId]);

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setError('');
    try {
      await apiFetch('/api/library/documents', {
        method: 'POST',
        body: JSON.stringify({
          project_id: activeProjectId,
          item_type: docType,
          title: docTitle,
          category: docCategory,
          folder: docFolder || 'Root',
          tags: docTags.split(',').map((s) => s.trim()).filter(Boolean),
          source_ref: docSourceRef,
          content: docContent,
        }),
      });
      setDocTitle('');
      setDocSourceRef('');
      setDocContent('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save document');
    }
  };

  const handleSaveEdit = async (docId: string) => {
    try {
      await apiFetch(`/api/library/documents/${docId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle.trim(), content: editContent }),
      });
      setEditingDocId(null);
      await load();
      if (historyDocId === docId) await loadVersions(docId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update document version');
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await apiFetch(`/api/library/documents/${docId}`, { method: 'DELETE' });
      if (historyDocId === docId) setHistoryDocId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete document');
    }
  };

  const handleDeleteLit = async (litId: string) => {
    try {
      await apiFetch(`/api/literature/${litId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove saved publication');
    }
  };

  const loadVersions = async (docId: string) => {
    if (historyDocId === docId) {
      setHistoryDocId(null);
      return;
    }
    try {
      const res = await apiFetch<{ versions: DocVersion[] }>(`/api/library/documents/${docId}/versions`);
      setDocVersions(res.versions);
      setHistoryDocId(docId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load version history');
    }
  };

  const exportLibraryJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), literature, documents }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CURE_Research_Library.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const folders = ['All', ...Array.from(new Set(documents.map((d) => d.folder)))];
  const qLower = search.toLowerCase();
  const filteredLit = literature.filter(
    (l) =>
      l.title.toLowerCase().includes(qLower) ||
      (l.pmid || '').toLowerCase().includes(qLower) ||
      (l.doi || '').toLowerCase().includes(qLower)
  );
  const filteredDocs = documents.filter(
    (d) =>
      (folderFilter === 'All' || d.folder === folderFilter) &&
      (d.title.toLowerCase().includes(qLower) || d.content.toLowerCase().includes(qLower) || d.category.toLowerCase().includes(qLower))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Research Library</h1>
          <p className="text-xs text-slate-400 mt-1">
            Persistent repository of indexed publications, research notes, pathway references, and versioned documents
          </p>
        </div>
        <button
          onClick={exportLibraryJson}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs border border-slate-700 hover:border-cyan-500 text-slate-200 rounded"
        >
          <Download className="w-3.5 h-3.5 text-cyan-400" /> Export Library JSON
        </button>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border border-slate-800/90 bg-[#0D131F] rounded-md p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search library titles, PMIDs, DOIs, categories, or notes..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
        </div>
        <select
          value={folderFilter}
          onChange={(e) => setFolderFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-200"
        >
          {folders.map((f) => (
            <option key={f} value={f}>
              Folder: {f}
            </option>
          ))}
        </select>
        <div className="flex border border-slate-800 rounded p-0.5 bg-[#070B12] text-xs">
          {(['all', 'literature', 'documents'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded capitalize ${
                tab === t ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Note / Reference */}
        <form onSubmit={handleCreateDoc} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2.5 text-xs h-fit">
          <div className="text-xs font-semibold tracking-wider text-slate-300 uppercase border-b border-slate-800 pb-2">
            Store Research Note / Reference
          </div>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as typeof docType)}
            className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-200"
          >
            <option value="note">Research Note</option>
            <option value="pathway_ref">Biological Pathway Reference</option>
            <option value="protocol">Protocol Summary</option>
            <option value="finding_summary">Finding Summary</option>
          </select>
          <input
            required
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            placeholder="Title *"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={docCategory}
              onChange={(e) => setDocCategory(e.target.value)}
              placeholder="Category"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <input
              value={docFolder}
              onChange={(e) => setDocFolder(e.target.value)}
              placeholder="Folder"
              className="px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <input
            value={docTags}
            onChange={(e) => setDocTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <input
            value={docSourceRef}
            onChange={(e) => setDocSourceRef(e.target.value)}
            placeholder="Original Source URL / PMID / DOI"
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <textarea
            required
            rows={4}
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
            placeholder="Scientific note content..."
            className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
          />
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
          >
            <Plus className="w-3.5 h-3.5" /> Save to Library
          </button>
        </form>

        {/* Repository Items */}
        <div className="lg:col-span-2 space-y-4">
          {(tab === 'all' || tab === 'literature') && (
            <section className="space-y-2.5">
              <div className="text-xs font-mono text-slate-400">
                Saved Literature Sources ({filteredLit.length})
              </div>
              {filteredLit.length === 0 ? (
                <div className="border border-slate-800 bg-[#0D131F] rounded p-4 text-xs text-slate-500">
                  No saved publications match your filter. Use Literature Intelligence to index publications.
                </div>
              ) : (
                filteredLit.map((l) => (
                  <div key={l.id} className="border border-slate-800/90 bg-[#0D131F] rounded p-3.5 flex items-start justify-between gap-3 text-xs">
                    <div className="space-y-1 min-w-0">
                      <div className="font-mono text-[11px] text-cyan-400">
                        {l.source_db.toUpperCase()} · {l.pmid ? `PMID:${l.pmid}` : l.doi ? `DOI:${l.doi}` : l.external_id} · {l.pub_type}
                      </div>
                      <div className="font-semibold text-slate-100">{l.title}</div>
                      <div className="text-slate-400">
                        {l.journal} · {l.pub_date}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {l.url && (
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDeleteLit(l.id)}
                        title="Remove saved publication"
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>
          )}

          {(tab === 'all' || tab === 'documents') && (
            <section className="space-y-2.5">
              <div className="text-xs font-mono text-slate-400">
                Stored Notes, Protocols & Pathway References ({filteredDocs.length})
              </div>
              {filteredDocs.length === 0 ? (
                <div className="border border-slate-800 bg-[#0D131F] rounded p-4 text-xs text-slate-500">
                  No documents stored yet.
                </div>
              ) : (
                filteredDocs.map((d) => (
                  <div key={d.id} className="border border-slate-800/90 bg-[#0D131F] rounded p-3.5 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
                      <span>
                        {d.item_type} · {d.category} · Folder: {d.folder} · v{d.version}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (editingDocId === d.id) {
                              setEditingDocId(null);
                            } else {
                              setEditingDocId(d.id);
                              setEditTitle(d.title);
                              setEditContent(d.content);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                        >
                          <Edit3 className="w-3 h-3" /> Edit / New Ver
                        </button>
                        <button
                          onClick={() => loadVersions(d.id)}
                          className="inline-flex items-center gap-1 text-teal-400 hover:text-teal-300"
                        >
                          <History className="w-3 h-3" /> History
                        </button>
                        <button
                          onClick={() => handleDeleteDoc(d.id)}
                          title="Delete document"
                          className="p-0.5 text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {editingDocId === d.id ? (
                      <div className="space-y-2 pt-1">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-700 rounded text-slate-100"
                        />
                        <textarea
                          rows={4}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-700 rounded text-slate-100"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEdit(d.id)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-600 text-slate-950 font-semibold rounded"
                          >
                            <Save className="w-3 h-3" /> Save v{d.version + 1}
                          </button>
                          <button
                            onClick={() => setEditingDocId(null)}
                            className="inline-flex items-center gap-1 px-3 py-1 border border-slate-700 text-slate-300 rounded"
                          >
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="font-semibold text-slate-100">{d.title}</div>
                        <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{d.content}</p>
                        {d.source_ref && <div className="text-[11px] font-mono text-cyan-400">Source: {d.source_ref}</div>}
                      </>
                    )}

                    {historyDocId === d.id && (
                      <div className="mt-2 pt-2 border-t border-slate-800 space-y-1.5">
                        <div className="font-mono text-[10px] text-teal-300 uppercase">Version History</div>
                        {docVersions.map((v) => (
                          <div key={v.id} className="p-2 border border-slate-800 bg-[#070B12] rounded text-[11px]">
                            <div className="font-mono text-slate-400">
                              v{v.version} · {v.editor_name || 'Researcher'} · {v.created_at}
                            </div>
                            <div className="text-slate-300 mt-0.5 whitespace-pre-wrap">{v.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
