import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Cpu,
  Database,
  Dna,
  FlaskConical,
  FolderKanban,
  Info,
  LayoutDashboard,
  Library,
  Microscope,
  Network,
  Orbit,
  Settings,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Users,
} from 'lucide-react';
import type { ModuleId } from '../types';

interface AboutModuleProps {
  onNavigate: (mod: ModuleId) => void;
}

type DomainFilter = 'all' | 'autonomous' | 'simulation' | 'data' | 'translational';

interface CapabilityItem {
  id: ModuleId;
  domain: Exclude<DomainFilter, 'all'>;
  name: string;
  summary: string;
  icon: React.FC<{ className?: string }>;
}

const CAPABILITIES: CapabilityItem[] = [
  {
    id: 'command_centre',
    domain: 'autonomous',
    name: 'Command Centre',
    summary:
      'Unified situational workspace displaying active investigations, indexed publications, datasets, hypotheses, simulation runs, validation queues, and live model governance settings.',
    icon: LayoutDashboard,
  },
  {
    id: 'autonomous_intelligence',
    domain: 'autonomous',
    name: 'Autonomous Intelligence Engine',
    summary:
      'Executes the 9-stage self-improving loop (OBSERVE to REPEAT) with Server-Sent Events progress streaming, persistent Research Memory, reproducibility checks, and reversible model calibrations.',
    icon: Sparkles,
  },
  {
    id: 'ai_research_engine',
    domain: 'autonomous',
    name: 'AI Research Engine',
    summary:
      'Runs 10-step structured oncology synthesis backed by live PubMed, Europe PMC, and ClinicalTrials.gov queries, automatic model failover, and a post-generation Citation Audit Guard.',
    icon: Cpu,
  },
  {
    id: 'biological_simulation',
    domain: 'simulation',
    name: '3D Biological Simulation Studio',
    summary:
      'Interactive 3D cellular solver with calibrated optical magnification up to 10,000x, membrane cutaway mode, ChEMBL/PubChem IC50 dose grounding, PK/PD dosing schedules, Bliss/Loewe dual-drug synergy, and resistant subclone modeling.',
    icon: Orbit,
  },
  {
    id: 'tumour_microenvironment',
    domain: 'simulation',
    name: 'Volumetric Tumour Microenvironment',
    summary:
      '3D spatial tissue topology with lineage classification, continuous spatial transcriptomics gene heatmaps (CD8A, PDCD1, HIF1A, VEGFA, FAP), and nearest-neighbor CD8+ T-cell immune-exclusion metrics.',
    icon: Activity,
  },
  {
    id: 'literature_intelligence',
    domain: 'data',
    name: 'Literature Intelligence',
    summary:
      'Real-time multi-database biomedical search across PubMed, Europe PMC, Crossref, and ClinicalTrials.gov with automated PRISMA 2020 discovery flow reports and Markdown/JSON export.',
    icon: BookOpen,
  },
  {
    id: 'molecular_intelligence',
    domain: 'data',
    name: 'Molecular Intelligence',
    summary:
      'Queries live cBioPortal / TCGA somatic mutation frequencies and NCI GDC case counts alongside uploaded CSV, TSV, JSON, and VCF multi-omics cohorts.',
    icon: Dna,
  },
  {
    id: 'cancer_biology',
    domain: 'data',
    name: 'Cancer Biology Knowledge Graph',
    summary:
      'Structured repository of genes, pathways, therapeutic mechanisms, and curated molecular interaction relationships with supporting evidence classification.',
    icon: Network,
  },
  {
    id: 'pathology_intelligence',
    domain: 'data',
    name: 'Pathology Intelligence',
    summary:
      'Histopathology specimen workspace supporting PNG, JPEG, and TIFF slide ingestion linked directly to project research records.',
    icon: Microscope,
  },
  {
    id: 'data_analytics',
    domain: 'data',
    name: 'Data & Statistical Analytics',
    summary:
      'Computes differential expression, Kaplan-Meier survival analyses, gene correlation matrices, and live Enrichr Reactome_2022 and KEGG_2021_Human pathway enrichment.',
    icon: BarChart3,
  },
  {
    id: 'hypothesis_lab',
    domain: 'translational',
    name: 'Hypothesis Lab',
    summary:
      'Tracks testable oncology hypotheses with supporting and contradictory evidence polarity, mechanistic assumptions, and direct handoff to 3D simulation or experiment planning.',
    icon: FlaskConical,
  },
  {
    id: 'experiment_design',
    domain: 'translational',
    name: 'Experiment Design & 96-Well ELN Export',
    summary:
      'Designs wet-lab validation protocols with statistical power estimates and interactive 96-well blinded plate layouts (PBS moats, DMSO controls, serial dilutions, BLK codes) exportable as CSV and ELN JSON.',
    icon: TestTube2,
  },
  {
    id: 'research_library',
    domain: 'translational',
    name: 'Research Library',
    summary:
      'Project-scoped archive of indexed papers, methodology summaries, clinical trial metadata, and traceable external identifiers.',
    icon: Library,
  },
  {
    id: 'research_projects',
    domain: 'translational',
    name: 'Research Projects & Dossiers',
    summary:
      'Organizes cancer research programs by therapeutic objective and exports full reproducible project dossiers across hypotheses, datasets, and simulations.',
    icon: FolderKanban,
  },
  {
    id: 'research_collaboration',
    domain: 'translational',
    name: 'Live Research Collaboration',
    summary:
      'Role-based project access control (Administrator, PI, Researcher, Reviewer, Read-Only) paired with live WebSocket investigator presence and real-time peer-review annotations.',
    icon: Users,
  },
  {
    id: 'system_intelligence',
    domain: 'autonomous',
    name: 'System Intelligence & Physician Validation',
    summary:
      'Inspects persistent Research Memory, model version lineage, rollback controls, immutable guardrail verification, and the physician validation queue.',
    icon: Database,
  },
  {
    id: 'settings',
    domain: 'translational',
    name: 'Settings & Governance',
    summary:
      'Configures server-side AI models, data retention periods, autonomous iteration caps, physician confidence review thresholds (>= 90%), personal data export, and security audit logs.',
    icon: Settings,
  },
];

const USE_CASES = [
  {
    title: 'Preclinical Drug & Combination Synergy Screening',
    detail:
      'Ground compound concentrations in published ChEMBL IC50 assays, test cyclic clinical dosing schedules (Q24h, Q48h, Q7d on/off holidays), quantify Bliss Independence and Loewe Combination Index synergy, and stress-test resistant cancer subclones before entering wet-lab assays.',
  },
  {
    title: 'Target Discovery & Multi-Omics Cohort Profiling',
    detail:
      'Cross-reference live cBioPortal/TCGA somatic alteration frequencies and NCI GDC cohorts with private RNA-seq or variant datasets, followed by live Reactome and KEGG pathway enrichment.',
  },
  {
    title: 'Spatial Immuno-Oncology & Hypoxia Mapping',
    detail:
      'Import Visium/Xenium-style spatial matrices to measure CD8+ T-cell infiltration versus immune-exclusion distances, calculate HIF1A-CD8A hypoxia correlations, and inspect continuous 3D gene expression heatmaps.',
  },
  {
    title: 'Automated Literature Synthesis & Hypothesis Falsification',
    detail:
      'Run multi-database searches across PubMed, Europe PMC, and ClinicalTrials.gov, export PRISMA 2020 flow records, and let the Autonomous Intelligence Engine generate, simulate, evaluate, and refine hypotheses without repeating uninformative experiments.',
  },
  {
    title: 'Reproducible Wet-Lab Handoff & Team Peer Review',
    detail:
      'Convert validated computational hypotheses directly into blinded 96-well serial-dilution plate layouts and ELN-compatible SOP JSON packages while collaborating live with PIs and reviewers over WebSocket-backed annotation rooms.',
  },
];

const BENEFITS = [
  {
    title: 'Citation-Audited Scientific Rigor',
    detail:
      'Every AI-synthesized investigation passes through a Citation Audit Guard that verifies emitted PMID, PMCID, DOI, and NCT identifiers against the retrieved literature corpus, stripping or flagging ungrounded references.',
  },
  {
    title: 'Continuous Learning from Negative Results',
    detail:
      'Unlike single-shot tools that discard failed hypotheses, Project C.U.R.E. stores unsuccessful simulations, failure diagnoses, and strategy revisions in persistent Research Memory to prevent duplicate experiments and accelerate convergence.',
  },
  {
    title: 'Unified Dry-Lab to Wet-Lab Continuity',
    detail:
      'Researchers move in one cohesive workspace from literature discovery and genomic frequency lookup to 3D cellular PK/PD simulation and blinded 96-well experimental plate generation.',
  },
  {
    title: 'Deterministic Reproducibility & Traceability',
    detail:
      'Configurable simulation seeds, version-controlled model parameters, rollback history, and full SQLite audit trails ensure every computational claim can be independently reproduced and verified.',
  },
  {
    title: 'Human-in-the-Loop Governance & Safety Floors',
    detail:
      'Server-enforced safety guardrails keep physician validation thresholds at >= 90%, restrict sensitive actions via project-level RBAC, and separate computational modeling from clinical decision-making.',
  },
];

export const AboutModule: React.FC<AboutModuleProps> = ({ onNavigate }) => {
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');

  const visibleCapabilities =
    domainFilter === 'all'
      ? CAPABILITIES
      : CAPABILITIES.filter((cap) => cap.domain === domainFilter);

  return (
    <div className="space-y-8">
      {/* Header & Identity */}
      <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
              <Info className="w-4 h-4 shrink-0" />
              <span>Platform Overview · Created by I.R.A.I Corp</span>
            </div>
            <h1 className="text-2xl font-display font-semibold text-slate-100 text-balance">
              Project C.U.R.E. — Continuous Understanding and Research Engine
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Project C.U.R.E. is an integrated computational oncology and autonomous scientific discovery workstation
              engineered by <span className="text-cyan-300 font-semibold">I.R.A.I Corp</span>. It unifies literature
              intelligence, live multi-omics and pharmacology connectors, an interactive 3D biological and
              tumour-microenvironment simulation engine, an autonomous self-improving research cycle, wet-lab assay
              design, and multi-investigator governance inside a single auditable platform.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('autonomous_intelligence')}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded transition-colors whitespace-nowrap"
            >
              Open Autonomous Engine <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('biological_simulation')}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs border border-slate-700 hover:border-cyan-500 text-slate-200 rounded transition-colors whitespace-nowrap"
            >
              Launch 3D Simulation
            </button>
          </div>
        </div>

        {/* Quantitative Platform Scope Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
          <div className="border border-slate-800 bg-[#070B12] rounded p-3.5">
            <div className="text-[11px] font-mono text-slate-400">Platform Architecture</div>
            <div className="text-xl font-mono font-semibold text-slate-100 tabular-nums mt-1">17 Modules</div>
            <div className="text-[11px] text-slate-500 mt-0.5">End-to-end oncology pipeline</div>
          </div>
          <div className="border border-slate-800 bg-[#070B12] rounded p-3.5">
            <div className="text-[11px] font-mono text-slate-400">Autonomous Loop</div>
            <div className="text-xl font-mono font-semibold text-cyan-300 tabular-nums mt-1">9 Stages</div>
            <div className="text-[11px] text-slate-500 mt-0.5">OBSERVE through REPEAT</div>
          </div>
          <div className="border border-slate-800 bg-[#070B12] rounded p-3.5">
            <div className="text-[11px] font-mono text-slate-400">3D Optical Calibration</div>
            <div className="text-xl font-mono font-semibold text-slate-100 tabular-nums mt-1">10,000x Zoom</div>
            <div className="text-[11px] text-slate-500 mt-0.5">100 um down to 500 nm scale</div>
          </div>
          <div className="border border-slate-800 bg-[#070B12] rounded p-3.5">
            <div className="text-[11px] font-mono text-slate-400">Live Public Connectors</div>
            <div className="text-xl font-mono font-semibold text-teal-300 tabular-nums mt-1">8+ Databases</div>
            <div className="text-[11px] text-slate-500 mt-0.5">PubMed, TCGA, ChEMBL, Reactome</div>
          </div>
        </div>
      </section>

      {/* What It Can Be Used For & Core Benefits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
          <div className="border-b border-slate-800 pb-2.5">
            <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wider">
              What Project C.U.R.E. Is Used For
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Primary scientific, translational, and preclinical oncology workflows
            </p>
          </div>
          <div className="space-y-3">
            {USE_CASES.map((item, idx) => (
              <div key={item.title} className="p-3.5 border border-slate-800 bg-[#070B12] rounded space-y-1">
                <div className="text-xs font-semibold text-cyan-300">
                  0{idx + 1}. {item.title}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
          <div className="border-b border-slate-800 pb-2.5">
            <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wider">
              How Researchers & Institutions Benefit
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Measurable advantages in speed, rigor, reproducibility, and safety governance
            </p>
          </div>
          <div className="space-y-3">
            {BENEFITS.map((item, idx) => (
              <div key={item.title} className="p-3.5 border border-slate-800 bg-[#070B12] rounded space-y-1">
                <div className="text-xs font-semibold text-teal-300">
                  0{idx + 1}. {item.title}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Interactive Platform Directory */}
      <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wider">
              Complete Architecture & Module Directory
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Filter by capability domain or launch any workspace directly
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#070B12] border border-slate-800 rounded">
            {(
              [
                { id: 'all', label: 'All Modules' },
                { id: 'autonomous', label: 'Autonomous & AI' },
                { id: 'simulation', label: '3D & Spatial Bio' },
                { id: 'data', label: 'Literature & Omics' },
                { id: 'translational', label: 'Lab & Governance' },
              ] as Array<{ id: DomainFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDomainFilter(tab.id)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  domainFilter === tab.id
                    ? 'bg-cyan-600 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleCapabilities.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.id}
                className="border border-slate-800 bg-[#070B12] rounded p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                      <Icon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>{cap.name}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{cap.summary}</p>
                </div>
                <div className="pt-2 border-t border-slate-800/70 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onNavigate(cap.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-300 hover:text-cyan-200 transition-colors whitespace-nowrap"
                  >
                    Open Workspace <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* External Data Sources & Scientific Governance Boundary */}
      <section className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-3 text-xs">
        <div className="flex items-center gap-2 font-semibold text-slate-100 uppercase tracking-wider border-b border-slate-800 pb-2">
          <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
          <span>Data Provenance, Epistemic Boundaries & Attribution</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-slate-300 leading-relaxed">
          <div className="space-y-1.5">
            <div className="font-semibold text-slate-100">Connected Scientific Infrastructure</div>
            <p className="text-slate-400">
              Live connectors integrate directly with NCBI PubMed, Europe PMC, Crossref, ClinicalTrials.gov, cBioPortal /
              TCGA, NCI Genomic Data Commons (GDC), EBI ChEMBL, NCBI PubChem, and Enrichr (Reactome 2022 &amp; KEGG
              2021 Human) without fabricated fallback citations.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-semibold text-slate-100">Research &amp; Clinical Boundaries</div>
            <p className="text-slate-400">
              Developed by <span className="text-cyan-300 font-semibold">I.R.A.I Corp</span>, Project C.U.R.E. is a
              computational oncology research environment and is not a medical device, diagnostic product, or clinical
              prescribing tool. All computational findings and simulated responses require independent wet-lab
              validation and certified physician oversight.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
