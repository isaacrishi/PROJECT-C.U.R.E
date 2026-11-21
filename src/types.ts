export type ModuleId =
  | 'command_centre'
  | 'autonomous_intelligence'
  | 'biological_simulation'
  | 'ai_research_engine'
  | 'literature_intelligence'
  | 'cancer_biology'
  | 'molecular_intelligence'
  | 'pathology_intelligence'
  | 'tumour_microenvironment'
  | 'hypothesis_lab'
  | 'experiment_design'
  | 'data_analytics'
  | 'research_library'
  | 'research_projects'
  | 'research_collaboration'
  | 'system_intelligence'
  | 'settings'
  | 'about';

export type CureRole =
  | 'administrator'
  | 'principal_investigator'
  | 'researcher'
  | 'reviewer'
  | 'read_only';

export interface User {
  id: string;
  org_id: string | null;
  email: string;
  name: string;
  role: CureRole;
  title: string;
  institution: string;
}

export interface ResearchProject {
  id: string;
  org_id: string | null;
  owner_id: string;
  owner_name?: string;
  name: string;
  description: string;
  cancer_area: string;
  primary_objective: string;
  research_questions_json: string;
  status: string;
  visibility: 'restricted' | 'organisation' | 'public_read';
  created_at: string;
  updated_at: string;
  literature_count?: number;
  dataset_count?: number;
  hypothesis_count?: number;
  experiment_count?: number;
  pathology_count?: number;
}

export interface LiteratureResult {
  source_db: 'pubmed' | 'europepmc' | 'crossref' | 'clinicaltrials';
  external_id: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  nct_id?: string;
  title: string;
  authors: string[];
  journal: string;
  pub_date: string;
  pub_type: string;
  is_preprint: boolean;
  correction_status: string;
  url: string;
  abstract: string;
  full_text_available: boolean;
  citation_count?: number;
  study_status?: string;
  phase?: string;
}

export interface StructuredInvestigationOutput {
  step1_question_understanding: string;
  step2_biological_domain: string[];
  step3_evidence_needed: string[];
  step4_retrieved_sources_summary: string;
  step5_source_quality_and_limitations: string;
  step6_biological_relationships: string;
  step7_conflicting_evidence_uncertainties: string;
  step8_candidate_hypotheses: Array<{
    title: string;
    proposed_mechanism: string;
    relevant_genes: string[];
    validation_approach: string;
  }>;
  step9_confidence_assessment: {
    level: string;
    rationale: string;
  };
  step10_findings_and_references: {
    summary: string;
    traceable_citations: Array<{
      identifier: string;
      title: string;
      evidence_class: string;
      url: string;
    }>;
  };
  unresolved_questions: string[];
  insufficient_evidence_flag: boolean;
}

export interface HypothesisEvidence {
  id: string;
  hypothesis_id: string;
  evidence_type: string;
  polarity: 'supporting' | 'contradictory' | 'neutral';
  source_type: string;
  source_id: string;
  citation_label: string;
  summary: string;
  created_at: string;
}

export interface ResearchHypothesis {
  id: string;
  project_id: string | null;
  user_id: string;
  title: string;
  research_question: string;
  biological_rationale: string;
  proposed_mechanism: string;
  relevant_genes_json: string;
  assumptions: string;
  limitations: string;
  confidence_level: string;
  validation_approach: string;
  status: string;
  created_at: string;
  updated_at: string;
  evidence: HypothesisEvidence[];
}

export type CellLifecycleState =
  | 'healthy'
  | 'cancer_active'
  | 'treatment_exposed'
  | 'stressed_damaged'
  | 'apoptotic'
  | 'eliminated';

export type TreatmentMechanism =
  | 'untreated_control'
  | 'targeted_kinase_inhibitor'
  | 'cytotoxic_chemotherapy'
  | 'checkpoint_immunotherapy'
  | 'hypoxia_activated_prodrug';

export interface ModelCalibrationParams {
  diffusionRate: number;
  bindingAffinity: number;
  dnaDamageWeight: number;
  repairEfficiency: number;
  apoptosisThreshold: number;
  immuneClearanceFactor: number;
  confidenceCalibration: number;
}

export interface ModelVersionRecord {
  id: string;
  version_tag: string;
  parent_version_id: string | null;
  description: string;
  parameters_json: string;
  benchmark_metrics_json: string;
  is_active: number;
  protected_guardrails_intact: number;
  created_by: string | null;
  created_at: string;
  rolled_back_at: string | null;
}

export type DosingSchedule = 'continuous' | 'q24h' | 'q48h' | 'q7d_holiday';

export interface CombinationSynergyMetrics {
  primaryAloneViabilityPct: number;
  secondaryAloneViabilityPct: number;
  combinedViabilityPct: number;
  primaryInhibitionFrac: number;
  secondaryInhibitionFrac: number;
  observedInhibitionPct: number;
  blissExpectedPct: number;
  blissExcessPct: number;
  loeweCombinationIndex: number;
  classification: 'synergistic' | 'additive' | 'sub_additive';
}

export interface CitationAuditResult {
  verifiedCount: number;
  strippedCount: number;
  flaggedUngrounded: string[];
  corpusSize: number;
  auditPassed: boolean;
}

export interface SimTimePoint {
  step: number;
  timeHours: number;
  initialCancerPop: number;
  viableCancerCount: number;
  sensitiveViableCount?: number;
  resistantViableCount?: number;
  activeCancerCount: number;
  exposedCount: number;
  damagedCount: number;
  apoptoticCount: number;
  eliminatedCount: number;
  healthyCount: number;
  cellViabilityPct: number;
  treatmentResponsePct: number;
  meanIntracellularDose: number;
  plasmaConcUM?: number;
  secondaryPlasmaConcUM?: number;
  meanStressIndex: number;
  confidenceLevel: number;
}

export interface SimulationRunRecord {
  id: string;
  project_id: string | null;
  user_id: string;
  hypothesis_id: string | null;
  autonomous_iteration_id: string | null;
  scenario_name: string;
  treatment_agent: string;
  treatment_mechanism: TreatmentMechanism;
  concentration_uM: number;
  initial_cancer_cells: number;
  initial_healthy_cells: number;
  resistance_factor: number;
  duration_hours: number;
  seed: number;
  model_version_id: string | null;
  parameters_json: string;
  time_series_json: string;
  final_metrics_json: string;
  summary_confidence: number;
  is_computational_only: number;
  created_at: string;
}

export interface AutonomousStageEntry {
  stage: 'OBSERVE' | 'ANALYSE' | 'HYPOTHESISE' | 'SIMULATE' | 'MEASURE' | 'EVALUATE' | 'IMPROVE' | 'VERIFY' | 'REPEAT';
  status: 'completed' | 'skipped' | 'failed';
  summary: string;
  timestamp: string;
}

export interface AutonomousIterationRecord {
  id: string;
  cycle_id: string;
  iteration_number: number;
  stage_log_json: string;
  observed_summary: string;
  hypothesis_id: string | null;
  simulation_run_id: string | null;
  predicted_viability_end: number | null;
  auc_response: number | null;
  confidence_score: number;
  criterion_passed: number;
  evaluation_notes: string;
  failure_diagnosis: string;
  strategy_revision: string;
  duplicate_check_hash: string;
  is_reproducibility_test: number;
  model_version_id: string | null;
  created_at: string;
}

export interface AutonomousCycleRecord {
  id: string;
  project_id: string | null;
  user_id: string;
  goal_prompt: string;
  cancer_area: string;
  treatment_focus: TreatmentMechanism;
  execution_mode: 'ai_guided' | 'computational_calibration';
  status: 'running' | 'completed' | 'stopped_max_iterations' | 'stopped_converged' | 'failed';
  current_stage: string;
  max_iterations: number;
  completed_iterations: number;
  stopping_condition: string;
  target_confidence: number;
  config_json: string;
  model_version_id: string | null;
  error_message: string;
  created_at: string;
  updated_at: string;
  iterations?: AutonomousIterationRecord[];
}

export interface ResearchMemoryRecord {
  id: string;
  project_id: string | null;
  user_id: string | null;
  memory_type: 'hypothesis_outcome' | 'simulation_pattern' | 'model_calibration' | 'failure_diagnosis' | 'evidence_gap';
  experiment_signature_hash: string;
  title: string;
  parameters_json: string;
  outcome_status: 'accepted' | 'rejected' | 'inconclusive' | 'reproducibility_test';
  confidence_score: number;
  rationale: string;
  references_json: string;
  model_version: string;
  created_at: string;
}

export interface PhysicianValidationItem {
  id: string;
  project_id: string | null;
  hypothesis_id: string | null;
  iteration_id: string | null;
  simulation_run_id: string | null;
  title: string;
  summary: string;
  modelled_confidence: number;
  evidence_refs_json: string;
  validation_status: 'pending_physician_review' | 'physician_approved' | 'physician_rejected' | 'revision_requested';
  reviewer_user_id: string | null;
  reviewer_name: string;
  reviewer_credentials: string;
  review_notes: string;
  reviewed_at: string | null;
  created_at: string;
}


