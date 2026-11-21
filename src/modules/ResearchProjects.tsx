import React, { useEffect, useState } from 'react';
import { Edit3, FileDown, FolderOpen, Plus, Save, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ModuleId, ResearchProject, User } from '../types';

interface ResearchProjectsProps {
  user: User | null;
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNavigate: (mod: ModuleId) => void;
  onOpenReport: (projectId: string) => void;
  onOpenAuth: () => void;
  onProjectsChanged: () => void;
}

export const ResearchProjects: React.FC<ResearchProjectsProps> = ({
  user,
  activeProjectId,
  onSelectProject,
  onNavigate,
  onOpenReport,
  onOpenAuth,
  onProjectsChanged,
}) => {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [cancerArea, setCancerArea] = useState('');
  const [primaryObjective, setPrimaryObjective] = useState('');
  const [description, setDescription] = useState('');
  const [questionsText, setQuestionsText] = useState('');
  const [visibility, setVisibility] = useState<'restricted' | 'organisation' | 'public_read'>('restricted');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCancerArea, setEditCancerArea] = useState('');
  const [editObjective, setEditObjective] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<'restricted' | 'organisation' | 'public_read'>('restricted');
  const [editStatus, setEditStatus] = useState<'active' | 'paused' | 'completed' | 'archived'>('active');
  const [savingEdit, setSavingEdit] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ projects: ResearchProject[] }>('/api/projects');
      setProjects(res.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onOpenAuth();
      return;
    }
    setCreating(true);
    setError('');
    try {
      const questions = questionsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiFetch<{ project: ResearchProject }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          cancer_area: cancerArea || 'General Oncology',
          primary_objective: primaryObjective,
          description,
          research_questions: questions,
          visibility,
        }),
      });
      setName('');
      setCancerArea('');
      setPrimaryObjective('');
      setDescription('');
      setQuestionsText('');
      onSelectProject(res.project.id);
      await load();
      onProjectsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
      await load();
      onProjectsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const startEdit = (p: ResearchProject) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditCancerArea(p.cancer_area);
    setEditObjective(p.primary_objective || '');
    setEditDescription(p.description || '');
    setEditVisibility((p.visibility as 'restricted' | 'organisation' | 'public_read') || 'restricted');
    setEditStatus((p.status as 'active' | 'paused' | 'completed' | 'archived') || 'active');
    setError('');
  };

  const handleSaveEdit = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    setSavingEdit(true);
    setError('');
    try {
      await apiFetch(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName,
          cancer_area: editCancerArea,
          primary_objective: editObjective,
          description: editDescription,
          visibility: editVisibility,
          status: editStatus,
        }),
      });
      setEditingId(null);
      await load();
      onProjectsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update project');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="text-xl font-semibold text-slate-100">Research Projects</h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage access-controlled cancer research projects, linked evidence, and investigation context
        </p>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Project Form */}
        <form onSubmit={handleCreate} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 h-fit">
          <h2 className="text-xs font-semibold tracking-wider text-slate-300 uppercase border-b border-slate-800 pb-2.5">
            Create Research Project
          </h2>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Project Name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Pancreatic PDAC Stromal Resistance"
              className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Cancer Research Area</label>
              <input
                value={cancerArea}
                onChange={(e) => setCancerArea(e.target.value)}
                placeholder="e.g., PDAC, Glioblastoma"
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Access Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'restricted' | 'organisation' | 'public_read')}
                className="w-full px-2 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="restricted">Restricted (Members Only)</option>
                <option value="organisation">Organisation Shared</option>
                <option value="public_read">Public Read-Only</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Primary Research Objective</label>
            <input
              value={primaryObjective}
              onChange={(e) => setPrimaryObjective(e.target.value)}
              placeholder="e.g., Characterise CAF-mediated CD8+ T-cell exclusion"
              className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Research Questions (one per line)</label>
            <textarea
              rows={2}
              value={questionsText}
              onChange={(e) => setQuestionsText(e.target.value)}
              placeholder="Does HIF1A upregulation correlate with CD274?"
              className="w-full px-3 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            type="submit"
            disabled={creating}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> {creating ? 'Saving...' : 'Create Persistent Project'}
          </button>
        </form>

        {/* Accessible Projects List */}
        <div className="lg:col-span-2 space-y-3">
          {loading ? (
            <div className="text-xs font-mono text-slate-400">Loading accessible research projects...</div>
          ) : projects.length === 0 ? (
            <div className="border border-slate-800 bg-[#0D131F] rounded-md p-6 text-xs text-slate-400">
              No accessible research projects found. Create a project on the left or sign in to view restricted projects.
            </div>
          ) : (
            projects.map((p) => {
              const isSelected = p.id === activeProjectId;
              return (
                <div
                  key={p.id}
                  className={`border rounded-md p-4 space-y-3 transition-colors ${
                    isSelected ? 'border-cyan-600/80 bg-[#0B1321]' : 'border-slate-800/90 bg-[#0D131F]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-100">{p.name}</span>
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${
                            p.status === 'completed'
                              ? 'border-emerald-700/70 text-emerald-300 bg-emerald-950/30'
                              : p.status === 'paused'
                              ? 'border-amber-700/70 text-amber-300 bg-amber-950/30'
                              : p.status === 'archived'
                              ? 'border-slate-700 text-slate-400 bg-slate-900/50'
                              : 'border-cyan-700/70 text-cyan-300 bg-cyan-950/30'
                          }`}
                        >
                          {p.status || 'active'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {p.cancer_area} · Visibility: <span className="font-mono">{p.visibility}</span> · Owner:{' '}
                        {p.owner_name || 'Principal Investigator'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          onSelectProject(p.id);
                          onNavigate('ai_research_engine');
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> Resume Investigation
                      </button>
                      <button
                        onClick={() => onOpenReport(p.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-700 hover:border-cyan-500 text-slate-200 rounded"
                      >
                        <FileDown className="w-3.5 h-3.5" /> Report
                      </button>
                      {user && (user.id === p.owner_id || user.role === 'administrator') && (
                        <>
                          <button
                            type="button"
                            onClick={() => (editingId === p.id ? setEditingId(null) : startEdit(p))}
                            aria-label="Edit project"
                            className="p-1.5 text-slate-400 hover:text-cyan-300 border border-slate-800 rounded"
                          >
                            {editingId === p.id ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p.id)}
                            aria-label="Delete project"
                            className="p-1.5 text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {editingId === p.id ? (
                    <form
                      onSubmit={(e) => handleSaveEdit(e, p.id)}
                      className="p-3 border border-slate-800 bg-[#070B12] rounded space-y-2.5 text-xs"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Project Name *</label>
                          <input
                            required
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-[#0B101A] border border-slate-800 rounded text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Cancer Area</label>
                          <input
                            value={editCancerArea}
                            onChange={(e) => setEditCancerArea(e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-[#0B101A] border border-slate-800 rounded text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Visibility</label>
                          <select
                            value={editVisibility}
                            onChange={(e) =>
                              setEditVisibility(e.target.value as 'restricted' | 'organisation' | 'public_read')
                            }
                            className="w-full px-2.5 py-1.5 bg-[#0B101A] border border-slate-800 rounded text-slate-100"
                          >
                            <option value="restricted">Restricted</option>
                            <option value="organisation">Organisation</option>
                            <option value="public_read">Public Read-Only</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Lifecycle Status</label>
                          <select
                            value={editStatus}
                            onChange={(e) =>
                              setEditStatus(e.target.value as 'active' | 'paused' | 'completed' | 'archived')
                            }
                            className="w-full px-2.5 py-1.5 bg-[#0B101A] border border-slate-800 rounded text-slate-100"
                          >
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            <option value="completed">Completed</option>
                            <option value="archived">Archived</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Primary Objective</label>
                        <input
                          value={editObjective}
                          onChange={(e) => setEditObjective(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#0B101A] border border-slate-800 rounded text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Description</label>
                        <textarea
                          rows={2}
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-[#0B101A] border border-slate-800 rounded text-slate-100"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 border border-slate-700 text-slate-300 rounded"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingEdit}
                          className="flex items-center gap-1 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded disabled:opacity-50"
                        >
                          <Save className="w-3 h-3" /> {savingEdit ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    p.primary_objective && (
                      <p className="text-xs text-slate-300 leading-relaxed">{p.primary_objective}</p>
                    )
                  )}

                  <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800/70 text-[11px] font-mono tabular-nums text-slate-400">
                    <span>Literature: {p.literature_count ?? 0}</span>
                    <span>Datasets: {p.dataset_count ?? 0}</span>
                    <span>Hypotheses: {p.hypothesis_count ?? 0}</span>
                    <span>Experiments: {p.experiment_count ?? 0}</span>
                    <span>Pathology: {p.pathology_count ?? 0}</span>
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
