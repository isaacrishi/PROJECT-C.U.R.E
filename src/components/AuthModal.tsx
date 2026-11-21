import React, { useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { CureRole, User } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (user: User) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('Biomedical Researcher');
  const [institution, setInstitution] = useState('CURE Research Consortium');
  const [role, setRole] = useState<CureRole>('researcher');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { email, password, name, title, institution, role };
      const res = await apiFetch<{ user: User }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onAuthenticated(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const quickSignIn = async (presetEmail: string, presetPassword: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: presetEmail, password: presetPassword }),
      });
      onAuthenticated(res.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md border border-slate-800 bg-[#0D131F] rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-100">Researcher Session & Access Control</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close authentication dialog"
            className="text-slate-400 hover:text-slate-200 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex border border-slate-800 rounded-md p-0.5 bg-[#070B12]">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                mode === 'login' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                mode === 'register' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Register Researcher
            </button>
          </div>

          {error && (
            <div className="p-2.5 text-xs text-rose-300 bg-rose-950/40 border border-rose-800/60 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Full Name</label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr. Ada Lovelace"
                    className="w-full px-3 py-2 text-sm bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as CureRole)}
                      className="w-full px-2.5 py-2 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="researcher">Researcher</option>
                      <option value="principal_investigator">Principal Investigator</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="read_only">Read-Only Collaborator</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Title</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Institution</label>
                  <input
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1">Institutional Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="researcher@cure.local"
                className="w-full px-3 py-2 text-sm bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-3 py-2 text-sm bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded transition-colors disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In to Workstation' : 'Create Researcher Account'}
            </button>
          </form>

          <div className="pt-3 border-t border-slate-800/80 space-y-2">
            <p className="text-[11px] text-slate-400">
              Local Workstation Accounts (for RBAC & restricted project testing):
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => quickSignIn('pi@cure.local', 'cure-pi-local')}
                className="px-2.5 py-2 text-left border border-slate-800 hover:border-cyan-700 rounded bg-[#070B12] transition-colors"
              >
                <div className="text-xs font-medium text-slate-200">Dr. Elena Vance</div>
                <div className="text-[11px] text-slate-400 font-mono">PI · pi@cure.local</div>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => quickSignIn('reviewer@cure.local', 'cure-reviewer-local')}
                className="px-2.5 py-2 text-left border border-slate-800 hover:border-cyan-700 rounded bg-[#070B12] transition-colors"
              >
                <div className="text-xs font-medium text-slate-200">Dr. Marcus Chen</div>
                <div className="text-[11px] text-slate-400 font-mono">Reviewer · reviewer@cure.local</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
