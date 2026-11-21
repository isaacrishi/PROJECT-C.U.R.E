import React, { useEffect, useState } from 'react';
import { MessageSquare, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { CureRole, User } from '../types';

interface OnlinePresenceUser {
  id: string;
  name: string;
  role: string;
  title: string;
}

interface MemberRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: CureRole;
  title: string;
  institution: string;
}

interface CommentRow {
  id: string;
  user_id?: string;
  target_type: string;
  target_id: string;
  content: string;
  author_name: string;
  author_role: string;
  created_at: string;
}

interface ResearchCollaborationProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
}

export const ResearchCollaboration: React.FC<ResearchCollaborationProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
}) => {
  const [directory, setDirectory] = useState<User[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [effectiveRole, setEffectiveRole] = useState<string>('');
  const [projectOwnerId, setProjectOwnerId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CureRole>('researcher');
  const [commentText, setCommentText] = useState('');
  const [targetType, setTargetType] = useState('project');
  const [onlineUsers, setOnlineUsers] = useState<OnlinePresenceUser[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = async () => {
    if (!user) {
      setDirectory([]);
      setMembers([]);
      setComments([]);
      setEffectiveRole('');
      setProjectOwnerId(null);
      return;
    }
    setError('');
    try {
      const dirRes = await apiFetch<{ users: User[] }>('/api/collaboration/users');
      setDirectory(dirRes.users);
      if (activeProjectId) {
        const [projRes, cmtRes] = await Promise.all([
          apiFetch<{ project?: { owner_id?: string }; members: MemberRow[]; effectiveRole: string }>(
            `/api/projects/${activeProjectId}`,
          ),
          apiFetch<{ comments: CommentRow[] }>(`/api/collaboration/projects/${activeProjectId}/comments`),
        ]);
        setMembers(projRes.members);
        setEffectiveRole(projRes.effectiveRole);
        setProjectOwnerId(projRes.project?.owner_id ?? null);
        setComments(cmtRes.comments);
      } else {
        setMembers([]);
        setProjectOwnerId(null);
        setComments([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load collaboration workspace');
    }
  };

  useEffect(() => {
    load();
  }, [user?.id, activeProjectId]);

  useEffect(() => {
    if (!user || !activeProjectId) {
      setOnlineUsers([]);
      setWsConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByCleanup = false;
    let attempt = 0;

    const connect = () => {
      if (closedByCleanup) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/collaboration?projectId=${encodeURIComponent(activeProjectId)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'presence:state' && Array.isArray(msg.users)) {
            setOnlineUsers(msg.users);
          } else if (msg.type === 'comment:created' && msg.comment) {
            const incoming = msg.comment as CommentRow;
            setComments((prev) =>
              prev.some((c) => c.id === incoming.id) ? prev : [incoming, ...prev]
            );
          } else if (msg.type === 'comment:deleted' && msg.commentId) {
            const removedId = String(msg.commentId);
            setComments((prev) => prev.filter((c) => c.id !== removedId));
          }
        } catch {
          // ignore non-JSON frames
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          const delay = Math.min(8000, 1200 * Math.pow(1.5, attempt++));
          reconnectTimer = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      setWsConnected(false);
      setOnlineUsers([]);
    };
  }, [user?.id, activeProjectId]);

  const handleAssignMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    if (!activeProjectId) return;
    setError('');
    setStatus('');
    try {
      await apiFetch(`/api/collaboration/projects/${activeProjectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteEmail('');
      setStatus('Project membership and RBAC permissions updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to assign collaborator');
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!user || !activeProjectId) return;
    setError('');
    setStatus('');
    try {
      await apiFetch(`/api/collaboration/projects/${activeProjectId}/members/${memberUserId}`, {
        method: 'DELETE',
      });
      setStatus('Collaborator removed from project RBAC membership.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove collaborator');
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return onOpenAuth();
    if (!activeProjectId || !commentText.trim()) return;
    setError('');
    try {
      await apiFetch(`/api/collaboration/projects/${activeProjectId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ target_type: targetType, content: commentText.trim() }),
      });
      setCommentText('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post review comment');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!user || !activeProjectId) return;
    setError('');
    try {
      await apiFetch(`/api/collaboration/projects/${activeProjectId}/comments/${commentId}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete review comment');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Research Collaboration</h1>
          <p className="text-xs text-slate-400 mt-1">
            Role-based project access control (Administrator, PI, Researcher, Reviewer, Read-Only), live investigator presence, and real-time peer review annotations
          </p>
        </div>
        {user && activeProjectId && (
          <div className="flex flex-wrap items-center gap-2 border border-slate-800 bg-[#0D131F] rounded px-3 py-1.5 text-[11px] font-mono">
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            <span className={wsConnected ? 'text-emerald-400' : 'text-slate-400'}>
              {wsConnected ? 'WS Room Live' : 'Connecting...'}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-300">
              {onlineUsers.length} active investigator{onlineUsers.length === 1 ? '' : 's'}
            </span>
            {onlineUsers.map((ou) => (
              <span
                key={ou.id}
                title={`${ou.name} (${ou.role})`}
                className="px-1.5 py-0.5 rounded bg-[#070B12] border border-cyan-900/60 text-cyan-300"
              >
                {ou.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {!user && (
        <div className="border border-slate-800 bg-[#0D131F] rounded-md p-5 text-xs text-slate-300 flex items-center justify-between">
          <span>Sign in to manage project collaborators and review annotations.</span>
          <button onClick={onOpenAuth} className="px-3.5 py-1.5 bg-cyan-600 text-slate-950 font-semibold rounded">
            Sign In
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}
      {status && (
        <div className="p-3 border border-emerald-800/60 bg-emerald-950/30 rounded text-xs text-emerald-300">{status}</div>
      )}

      {user && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Project Members & RBAC */}
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4 text-xs">
            <div className="border-b border-slate-800 pb-2.5 flex items-center justify-between">
              <h2 className="font-semibold text-slate-200 uppercase tracking-wider">Project RBAC Membership</h2>
              {effectiveRole && <span className="font-mono text-cyan-400">Your role: {effectiveRole}</span>}
            </div>

            {!activeProjectId ? (
              <p className="text-slate-400">Select an active project in the top header to manage project members.</p>
            ) : (
              <>
                <form onSubmit={handleAssignMember} className="space-y-2">
                  <input
                    required
                    type="email"
                    list="researcher-emails"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Collaborator email (e.g., reviewer@cure.local)"
                    className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
                  />
                  <datalist id="researcher-emails">
                    {directory.map((u) => (
                      <option key={u.id} value={u.email}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </datalist>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as CureRole)}
                    className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-200"
                  >
                    <option value="principal_investigator">Principal Investigator</option>
                    <option value="researcher">Researcher</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="read_only">Read-Only Collaborator</option>
                    <option value="administrator">Administrator</option>
                  </select>
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> Grant / Update Project Access
                  </button>
                </form>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  {members.map((m) => {
                    const canManageMembers =
                      effectiveRole === 'principal_investigator' ||
                      effectiveRole === 'administrator' ||
                      user.role === 'administrator';
                    const isOwner = projectOwnerId === m.user_id;
                    return (
                      <div key={m.id} className="p-2.5 border border-slate-800 bg-[#070B12] rounded">
                        <div className="flex justify-between items-center font-medium text-slate-200 gap-2">
                          <span>
                            {m.name}
                            {isOwner && (
                              <span className="ml-1.5 text-[10px] font-mono text-amber-400">(Owner)</span>
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-teal-400">{m.role}</span>
                            {canManageMembers && !isOwner && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(m.user_id)}
                                title="Remove collaborator"
                                aria-label={`Remove ${m.name}`}
                                className="p-1 text-slate-500 hover:text-rose-400"
                              >
                                <UserMinus className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {m.email} · {m.institution}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* Review Comments & Annotations */}
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4 text-xs">
            <h2 className="font-semibold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-2.5">
              Hypothesis & Protocol Review Notes
            </h2>
            {!activeProjectId ? (
              <p className="text-slate-400">Select an active project to view or add review comments.</p>
            ) : (
              <>
                <form onSubmit={handleAddComment} className="space-y-2">
                  <select
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-200"
                  >
                    <option value="project">Project General Review</option>
                    <option value="hypothesis">Hypothesis Review</option>
                    <option value="experiment">Experiment Proposal Review</option>
                    <option value="dataset">Dataset Quality Note</option>
                  </select>
                  <textarea
                    required
                    rows={3}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Record peer-review critique, confounding variables, or methodological feedback..."
                    className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
                  />
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-1.5 py-2 border border-cyan-700 text-cyan-300 hover:bg-cyan-950/40 font-medium rounded"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Post Review Annotation
                  </button>
                </form>

                <div className="space-y-2 pt-2 border-t border-slate-800 max-h-72 overflow-y-auto">
                  {comments.length === 0 ? (
                    <p className="text-slate-500">No review notes posted yet.</p>
                  ) : (
                    comments.map((c) => {
                      const canDeleteComment =
                        c.user_id === user.id ||
                        effectiveRole === 'principal_investigator' ||
                        effectiveRole === 'administrator' ||
                        user.role === 'administrator';
                      return (
                        <div key={c.id} className="p-2.5 border border-slate-800 bg-[#070B12] rounded space-y-1">
                          <div className="flex justify-between items-center font-mono text-[11px] text-slate-400 gap-2">
                            <span className="text-cyan-400">
                              {c.author_name} ({c.author_role})
                            </span>
                            <div className="flex items-center gap-2">
                              <span>{c.target_type}</span>
                              {canDeleteComment && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(c.id)}
                                  title="Delete review comment"
                                  className="text-slate-500 hover:text-rose-400"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-slate-200">{c.content}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </section>

          {/* Researcher Directory */}
          <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 text-xs">
            <h2 className="font-semibold text-slate-200 uppercase tracking-wider border-b border-slate-800 pb-2.5">
              Registered Researchers ({directory.length})
            </h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {directory.map((u) => (
                <div key={u.id} className="p-2.5 border border-slate-800 bg-[#070B12] rounded">
                  <div className="font-medium text-slate-100">{u.name}</div>
                  <div className="text-[11px] text-slate-400">{u.title}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {u.email} · {u.role}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
