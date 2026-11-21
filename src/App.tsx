import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Cpu,
  Database,
  Dna,
  FileDown,
  FlaskConical,
  FolderKanban,
  Info,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Microscope,
  Network,
  Orbit,
  Settings,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from './lib/api';
import type { ModuleId, ResearchProject, User } from './types';
import { AuthModal } from './components/AuthModal';
import { ReportModal } from './components/ReportModal';
import { CommandCentre } from './modules/CommandCentre';
import { AiResearchEngine } from './modules/AiResearchEngine';
import { LiteratureIntelligence } from './modules/LiteratureIntelligence';
import { CancerBiology } from './modules/CancerBiology';
import { MolecularIntelligence } from './modules/MolecularIntelligence';
import { PathologyIntelligence } from './modules/PathologyIntelligence';
import { TumourMicroenvironment } from './modules/TumourMicroenvironment';
import { HypothesisLab } from './modules/HypothesisLab';
import { ExperimentDesign } from './modules/ExperimentDesign';
import { DataAnalytics } from './modules/DataAnalytics';
import { ResearchLibrary } from './modules/ResearchLibrary';
import { ResearchProjects } from './modules/ResearchProjects';
import { ResearchCollaboration } from './modules/ResearchCollaboration';
import { SystemIntelligence } from './modules/SystemIntelligence';
import { SettingsModule } from './modules/SettingsModule';
import { AboutModule } from './modules/AboutModule';
import { AutonomousIntelligence } from './modules/AutonomousIntelligence';
import { BiologicalSimulation } from './modules/BiologicalSimulation';

const NAV_ITEMS: Array<{ id: ModuleId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'command_centre', label: 'COMMAND CENTRE', icon: LayoutDashboard },
  { id: 'autonomous_intelligence', label: 'AUTONOMOUS ENGINE', icon: Sparkles },
  { id: 'biological_simulation', label: '3D BIO SIMULATION', icon: Orbit },
  { id: 'ai_research_engine', label: 'AI RESEARCH ENGINE', icon: Cpu },
  { id: 'literature_intelligence', label: 'LITERATURE INTELLIGENCE', icon: BookOpen },
  { id: 'cancer_biology', label: 'CANCER BIOLOGY', icon: Network },
  { id: 'molecular_intelligence', label: 'MOLECULAR INTELLIGENCE', icon: Dna },
  { id: 'pathology_intelligence', label: 'PATHOLOGY INTELLIGENCE', icon: Microscope },
  { id: 'tumour_microenvironment', label: 'TUMOUR MICROENVIRONMENT', icon: Activity },
  { id: 'hypothesis_lab', label: 'HYPOTHESIS LAB', icon: FlaskConical },
  { id: 'experiment_design', label: 'EXPERIMENT DESIGN', icon: TestTube2 },
  { id: 'data_analytics', label: 'DATA ANALYTICS', icon: BarChart3 },
  { id: 'research_library', label: 'RESEARCH LIBRARY', icon: Library },
  { id: 'research_projects', label: 'RESEARCH PROJECTS', icon: FolderKanban },
  { id: 'research_collaboration', label: 'RESEARCH COLLABORATION', icon: Users },
  { id: 'system_intelligence', label: 'SYSTEM INTELLIGENCE', icon: Database },
  { id: 'settings', label: 'SETTINGS', icon: Settings },
  { id: 'about', label: 'ABOUT', icon: Info },
];

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>(() => {
    const saved = localStorage.getItem('cure_active_module') as ModuleId | null;
    return saved && NAV_ITEMS.some((i) => i.id === saved) ? saved : 'command_centre';
  });
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    return localStorage.getItem('cure_active_project_id');
  });

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [reportModalProjectId, setReportModalProjectId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [preloadSimId, setPreloadSimId] = useState<string | null>(null);
  const [preloadHypothesisId, setPreloadHypothesisId] = useState<string | null>(null);
  const [preloadExpHypothesisId, setPreloadExpHypothesisId] = useState<string | null>(null);

  const navigate = (mod: ModuleId) => {
    setActiveModule(mod);
    localStorage.setItem('cure_active_module', mod);
    setMobileNavOpen(false);
  };

  const inspectSimulationIn3D = (simId: string) => {
    setPreloadHypothesisId(null);
    setPreloadSimId(simId);
    navigate('biological_simulation');
  };

  const simulateHypothesisIn3D = (hypothesisId: string) => {
    setPreloadSimId(null);
    setPreloadHypothesisId(hypothesisId);
    navigate('biological_simulation');
  };

  const planExperimentForHypothesis = (hypothesisId: string) => {
    setPreloadExpHypothesisId(hypothesisId);
    navigate('experiment_design');
  };

  const selectProject = (id: string | null) => {
    setActiveProjectId(id);
    if (id) localStorage.setItem('cure_active_project_id', id);
    else localStorage.removeItem('cure_active_project_id');
  };

  const loadSessionAndProjects = async () => {
    try {
      const me = await apiFetch<{ user: User | null }>('/api/auth/me');
      setUser(me.user);
      if (!me.user) {
        setProjects([]);
      }
      const prjRes = await apiFetch<{ projects: ResearchProject[] }>('/api/projects');
      setProjects(prjRes.projects);
      if (activeProjectId && !prjRes.projects.some((p) => p.id === activeProjectId)) {
        selectProject(prjRes.projects[0]?.id ?? null);
      } else if (!activeProjectId && prjRes.projects.length > 0) {
        selectProject(prjRes.projects[0].id);
      }
    } catch {
      setProjects([]);
    }
  };

  useEffect(() => {
    loadSessionAndProjects();
  }, []);

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setProjects([]);
    selectProject(null);
  };

  const renderModule = () => {
    switch (activeModule) {
      case 'command_centre':
        return <CommandCentre user={user} onNavigate={navigate} onOpenAuth={() => setAuthModalOpen(true)} />;
      case 'autonomous_intelligence':
        return (
          <AutonomousIntelligence
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
            onNavigate={navigate}
            onInspectSimulation={inspectSimulationIn3D}
            onPlanExperiment={planExperimentForHypothesis}
          />
        );
      case 'biological_simulation':
        return (
          <BiologicalSimulation
            user={user}
            activeProjectId={activeProjectId}
            preloadSimulationId={preloadSimId}
            preloadHypothesisId={preloadHypothesisId}
            onConsumePreload={() => {
              setPreloadSimId(null);
              setPreloadHypothesisId(null);
            }}
            onOpenAuth={() => setAuthModalOpen(true)}
            onNavigate={navigate}
          />
        );
      case 'ai_research_engine':
        return (
          <AiResearchEngine
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
            onNavigate={navigate}
          />
        );
      case 'literature_intelligence':
        return (
          <LiteratureIntelligence
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
            onNavigate={navigate}
          />
        );
      case 'cancer_biology':
        return (
          <CancerBiology
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'molecular_intelligence':
        return (
          <MolecularIntelligence
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'pathology_intelligence':
        return (
          <PathologyIntelligence
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'tumour_microenvironment':
        return <TumourMicroenvironment />;
      case 'hypothesis_lab':
        return (
          <HypothesisLab
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
            onNavigate={navigate}
            onSimulateHypothesis={simulateHypothesisIn3D}
            onPlanExperiment={planExperimentForHypothesis}
          />
        );
      case 'experiment_design':
        return (
          <ExperimentDesign
            user={user}
            activeProjectId={activeProjectId}
            preloadHypothesisId={preloadExpHypothesisId}
            onConsumePreload={() => setPreloadExpHypothesisId(null)}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'data_analytics':
        return (
          <DataAnalytics
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'research_library':
        return (
          <ResearchLibrary
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'research_projects':
        return (
          <ResearchProjects
            user={user}
            activeProjectId={activeProjectId}
            onSelectProject={selectProject}
            onNavigate={navigate}
            onOpenReport={(pid) => setReportModalProjectId(pid)}
            onOpenAuth={() => setAuthModalOpen(true)}
            onProjectsChanged={loadSessionAndProjects}
          />
        );
      case 'research_collaboration':
        return (
          <ResearchCollaboration
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'system_intelligence':
        return (
          <SystemIntelligence
            user={user}
            activeProjectId={activeProjectId}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        );
      case 'settings':
        return <SettingsModule user={user} onOpenAuth={() => setAuthModalOpen(true)} />;
      case 'about':
        return <AboutModule onNavigate={navigate} />;
    }
  };

  return (
    <div className="min-h-screen flex bg-[#070B12] text-slate-100">
      {/* Persistent Left Sidebar (Desktop) + Drawer (Mobile) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0A0F18] border-r border-slate-800/90 flex flex-col transition-transform lg:translate-x-0 lg:static lg:shrink-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-slate-800/90 flex items-center justify-between">
          <div>
            <div className="font-display text-sm font-bold tracking-wider text-slate-100 whitespace-nowrap">
              Project C.U.R.E.
            </div>
            <div className="text-[10px] font-mono text-cyan-400/90 tracking-wide mt-0.5">
              Research Intelligence Engine
            </div>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden text-slate-400 hover:text-slate-200 p-1"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-medium tracking-wide rounded transition-colors text-left whitespace-nowrap ${
                  active
                    ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-cyan-400' : 'text-slate-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-slate-800/90 bg-[#070B12]/60 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 font-mono">Created by</span>
            <span className="font-display font-semibold tracking-wider text-cyan-300">I.R.A.I Corp</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            Evidence-driven · Independent verification required
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Workstation Bar */}
        <header className="sticky top-0 z-30 h-14 px-4 lg:px-6 border-b border-slate-800/90 bg-[#0A0F18]/95 backdrop-blur flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-slate-300 hover:text-white border border-slate-800 rounded"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="lg:hidden font-display text-xs font-bold tracking-wider text-slate-100 whitespace-nowrap">
              Project C.U.R.E.
            </span>

            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline shrink-0">Active Project:</span>
              <select
                value={activeProjectId ?? ''}
                onChange={(e) => selectProject(e.target.value || null)}
                aria-label="Active research project"
                className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-200 max-w-[240px] truncate"
              >
                <option value="">Personal / Unassigned Scope</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeProjectId && (
              <button
                onClick={() => setReportModalProjectId(activeProjectId)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-slate-700 hover:border-cyan-500 rounded text-slate-200 whitespace-nowrap"
              >
                <FileDown className="w-3.5 h-3.5 text-cyan-400" /> Export Report
              </button>
            )}

            {user ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-slate-800 hover:border-slate-700 rounded bg-[#070B12] text-slate-200 whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
                  <span>{user.name}</span>
                  <span className="text-slate-500 hidden md:inline">· {user.role}</span>
                </button>
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="p-1.5 border border-slate-800 hover:border-rose-700 rounded text-slate-400 hover:text-rose-300"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAuthModalOpen(true)}
                className="px-3.5 py-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded whitespace-nowrap"
              >
                Sign In / Register
              </button>
            )}
          </div>
        </header>

        {/* Active Module Workspace */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {renderModule()}
        </main>

        <footer className="px-4 lg:px-6 py-3 border-t border-slate-800/70 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2 max-w-[1440px] w-full mx-auto">
          <span>
            <span className="text-slate-300 font-medium">Project C.U.R.E.</span> · Continuous Understanding and Research Engine
          </span>
          <span className="font-mono">
            Created by <span className="text-cyan-300 font-semibold tracking-wide">I.R.A.I Corp</span>
          </span>
        </footer>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(u) => {
          setUser(u);
          loadSessionAndProjects();
        }}
      />

      <ReportModal
        isOpen={Boolean(reportModalProjectId)}
        projectId={reportModalProjectId}
        onClose={() => setReportModalProjectId(null)}
      />
    </div>
  );
}
