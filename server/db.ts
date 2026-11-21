import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const dbPath = process.env.CURE_DB_PATH || path.resolve(process.cwd(), 'data', 'cure.db');
const uploadDir = process.env.CURE_UPLOAD_DIR || path.resolve(process.cwd(), 'data', 'uploads');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(path.join(uploadDir, 'datasets'), { recursive: true });
fs.mkdirSync(path.join(uploadDir, 'pathology'), { recursive: true });

export const UPLOAD_DIR = uploadDir;
export const DB_PATH = dbPath;

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organisations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      retention_days INTEGER NOT NULL DEFAULT 365,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES organisations(id) ON DELETE SET NULL,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'researcher' CHECK(role IN ('administrator','principal_investigator','researcher','reviewer','read_only')),
      title TEXT DEFAULT 'Biomedical Researcher',
      institution TEXT DEFAULT 'CURE Research Consortium',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_projects (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES organisations(id) ON DELETE SET NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cancer_area TEXT NOT NULL DEFAULT 'General Oncology',
      primary_objective TEXT NOT NULL DEFAULT '',
      research_questions_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','archived')),
      visibility TEXT NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('restricted','organisation','public_read')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('administrator','principal_investigator','researcher','reviewer','read_only')),
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS research_conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      research_question TEXT NOT NULL,
      objectives TEXT NOT NULL DEFAULT '',
      cancer_type TEXT NOT NULL DEFAULT '',
      mechanisms_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES research_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      structured_json TEXT,
      model_used TEXT,
      tokens_used INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS literature_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_db TEXT NOT NULL,
      external_id TEXT NOT NULL,
      pmid TEXT,
      pmcid TEXT,
      doi TEXT,
      nct_id TEXT,
      title TEXT NOT NULL,
      authors_json TEXT NOT NULL DEFAULT '[]',
      journal TEXT DEFAULT '',
      pub_date TEXT DEFAULT '',
      pub_type TEXT DEFAULT 'research-article',
      is_preprint INTEGER NOT NULL DEFAULT 0,
      correction_status TEXT DEFAULT 'none',
      url TEXT DEFAULT '',
      abstract TEXT DEFAULT '',
      full_text_available INTEGER NOT NULL DEFAULT 0,
      methodology_summary TEXT DEFAULT '',
      main_findings TEXT DEFAULT '',
      limitations TEXT DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('note','report','pathway_ref','protocol','finding_summary')),
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      folder TEXT NOT NULL DEFAULT 'Root',
      tags_json TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      source_ref TEXT DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      edited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_datasets (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      format TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      col_count INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      is_synthetic INTEGER NOT NULL DEFAULT 0,
      validation_summary_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dataset_samples (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE CASCADE,
      sample_identifier TEXT NOT NULL,
      group_label TEXT DEFAULT '',
      survival_time REAL,
      event_status INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS dataset_variables (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE CASCADE,
      variable_name TEXT NOT NULL,
      data_type TEXT NOT NULL,
      missing_count INTEGER NOT NULL DEFAULT 0,
      mean_val REAL,
      median_val REAL,
      std_val REAL,
      min_val REAL,
      max_val REAL
    );

    CREATE TABLE IF NOT EXISTS pathology_images (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      stain_type TEXT DEFAULT 'H&E',
      magnification TEXT DEFAULT '20x',
      tissue_origin TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      model_connected TEXT DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS image_annotations (
      id TEXT PRIMARY KEY,
      image_id TEXT NOT NULL REFERENCES pathology_images(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      annotation_type TEXT NOT NULL DEFAULT 'manual_roi',
      label TEXT NOT NULL,
      region_json TEXT NOT NULL DEFAULT '{}',
      measurement_source TEXT NOT NULL DEFAULT 'manual_annotation',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS biological_entities (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      mechanism_category TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      processes_json TEXT NOT NULL DEFAULT '[]',
      genes_json TEXT NOT NULL DEFAULT '[]',
      pathways_json TEXT NOT NULL DEFAULT '[]',
      unresolved_questions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS molecular_relationships (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE CASCADE,
      source_entity_id TEXT NOT NULL REFERENCES biological_entities(id) ON DELETE CASCADE,
      target_entity_id TEXT NOT NULL REFERENCES biological_entities(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      evidence_level TEXT NOT NULL DEFAULT 'observational',
      supporting_ref TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_hypotheses (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      research_question TEXT NOT NULL,
      biological_rationale TEXT NOT NULL DEFAULT '',
      proposed_mechanism TEXT NOT NULL DEFAULT '',
      relevant_genes_json TEXT NOT NULL DEFAULT '[]',
      assumptions TEXT NOT NULL DEFAULT '',
      limitations TEXT NOT NULL DEFAULT '',
      confidence_level TEXT NOT NULL DEFAULT 'low_preliminary',
      validation_approach TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN (
        'generated','under_review','evidence_gathering','computationally_evaluated',
        'experimentally_proposed','experimentally_tested','supported','refuted','inconclusive'
      )),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hypothesis_evidence (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL REFERENCES research_hypotheses(id) ON DELETE CASCADE,
      evidence_type TEXT NOT NULL CHECK(evidence_type IN (
        'literature','molecular_dataset','pathology_observation','biological_mechanism','ai_synthesis','experimental_result'
      )),
      polarity TEXT NOT NULL DEFAULT 'supporting' CHECK(polarity IN ('supporting','contradictory','neutral')),
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT DEFAULT '',
      citation_label TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS experiment_plans (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      hypothesis_id TEXT REFERENCES research_hypotheses(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      objectives TEXT NOT NULL DEFAULT '',
      scientific_question TEXT NOT NULL DEFAULT '',
      study_design TEXT NOT NULL DEFAULT '',
      independent_vars_json TEXT NOT NULL DEFAULT '[]',
      dependent_vars_json TEXT NOT NULL DEFAULT '[]',
      control_groups TEXT NOT NULL DEFAULT '',
      sample_characteristics TEXT NOT NULL DEFAULT '',
      sample_size_assumptions TEXT NOT NULL DEFAULT '',
      statistical_methods TEXT NOT NULL DEFAULT '',
      expected_outcomes TEXT NOT NULL DEFAULT '',
      potential_confounders TEXT NOT NULL DEFAULT '',
      limitations TEXT NOT NULL DEFAULT '',
      validation_requirements TEXT NOT NULL DEFAULT '',
      reproducibility_checklist_json TEXT NOT NULL DEFAULT '[]',
      ethics_checklist_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'proposal_draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_findings (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      finding_type TEXT NOT NULL CHECK(finding_type IN (
        'established_knowledge','peer_reviewed','preliminary_research','observational_association',
        'computational_prediction','ai_hypothesis','experimentally_validated'
      )),
      classification TEXT NOT NULL DEFAULT 'observational',
      summary TEXT NOT NULL,
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('queued','running','completed','failed')),
      parameters_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT DEFAULT '',
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_evaluations (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      message_id TEXT REFERENCES research_messages(id) ON DELETE SET NULL,
      evaluation_type TEXT NOT NULL,
      citation_verified INTEGER NOT NULL DEFAULT 0,
      consistency_score REAL,
      unsupported_claims_json TEXT NOT NULL DEFAULT '[]',
      contradictory_notes TEXT DEFAULT '',
      evaluator_notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collaboration_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_versions (
      id TEXT PRIMARY KEY,
      version_tag TEXT NOT NULL UNIQUE,
      parent_version_id TEXT REFERENCES model_versions(id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '',
      parameters_json TEXT NOT NULL,
      benchmark_metrics_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 0,
      protected_guardrails_intact INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      rolled_back_at TEXT
    );

    CREATE TABLE IF NOT EXISTS autonomous_cycles (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      goal_prompt TEXT NOT NULL,
      cancer_area TEXT NOT NULL DEFAULT '',
      treatment_focus TEXT NOT NULL DEFAULT 'targeted_kinase_inhibitor',
      execution_mode TEXT NOT NULL DEFAULT 'ai_guided' CHECK(execution_mode IN ('ai_guided','computational_calibration')),
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','stopped_max_iterations','stopped_converged','failed')),
      current_stage TEXT NOT NULL DEFAULT 'OBSERVE',
      max_iterations INTEGER NOT NULL DEFAULT 3,
      completed_iterations INTEGER NOT NULL DEFAULT 0,
      stopping_condition TEXT NOT NULL DEFAULT 'target_viability_and_confidence',
      target_confidence REAL NOT NULL DEFAULT 0.90,
      config_json TEXT NOT NULL DEFAULT '{}',
      model_version_id TEXT REFERENCES model_versions(id) ON DELETE SET NULL,
      error_message TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS simulation_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hypothesis_id TEXT REFERENCES research_hypotheses(id) ON DELETE SET NULL,
      autonomous_iteration_id TEXT,
      scenario_name TEXT NOT NULL,
      treatment_agent TEXT NOT NULL,
      treatment_mechanism TEXT NOT NULL,
      concentration_uM REAL NOT NULL DEFAULT 2.5,
      initial_cancer_cells INTEGER NOT NULL DEFAULT 42,
      initial_healthy_cells INTEGER NOT NULL DEFAULT 16,
      resistance_factor REAL NOT NULL DEFAULT 0.25,
      duration_hours INTEGER NOT NULL DEFAULT 72,
      seed INTEGER NOT NULL DEFAULT 104729,
      model_version_id TEXT REFERENCES model_versions(id) ON DELETE SET NULL,
      parameters_json TEXT NOT NULL DEFAULT '{}',
      time_series_json TEXT NOT NULL DEFAULT '[]',
      final_metrics_json TEXT NOT NULL DEFAULT '{}',
      summary_confidence REAL NOT NULL DEFAULT 0,
      is_computational_only INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS autonomous_iterations (
      id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL REFERENCES autonomous_cycles(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      stage_log_json TEXT NOT NULL DEFAULT '[]',
      observed_summary TEXT NOT NULL DEFAULT '',
      hypothesis_id TEXT REFERENCES research_hypotheses(id) ON DELETE SET NULL,
      simulation_run_id TEXT REFERENCES simulation_runs(id) ON DELETE SET NULL,
      predicted_viability_end REAL,
      auc_response REAL,
      confidence_score REAL NOT NULL DEFAULT 0,
      criterion_passed INTEGER NOT NULL DEFAULT 0,
      evaluation_notes TEXT NOT NULL DEFAULT '',
      failure_diagnosis TEXT NOT NULL DEFAULT '',
      strategy_revision TEXT NOT NULL DEFAULT '',
      duplicate_check_hash TEXT NOT NULL DEFAULT '',
      is_reproducibility_test INTEGER NOT NULL DEFAULT 0,
      model_version_id TEXT REFERENCES model_versions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_memory (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      memory_type TEXT NOT NULL CHECK(memory_type IN (
        'hypothesis_outcome','simulation_pattern','model_calibration','failure_diagnosis','evidence_gap'
      )),
      experiment_signature_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      parameters_json TEXT NOT NULL DEFAULT '{}',
      outcome_status TEXT NOT NULL CHECK(outcome_status IN (
        'accepted','rejected','inconclusive','reproducibility_test'
      )),
      confidence_score REAL NOT NULL DEFAULT 0,
      rationale TEXT NOT NULL DEFAULT '',
      references_json TEXT NOT NULL DEFAULT '[]',
      model_version TEXT NOT NULL DEFAULT 'baseline',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS physician_validation_queue (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
      hypothesis_id TEXT REFERENCES research_hypotheses(id) ON DELETE SET NULL,
      iteration_id TEXT REFERENCES autonomous_iterations(id) ON DELETE SET NULL,
      simulation_run_id TEXT REFERENCES simulation_runs(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      modelled_confidence REAL NOT NULL,
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      validation_status TEXT NOT NULL DEFAULT 'pending_physician_review' CHECK(validation_status IN (
        'pending_physician_review','physician_approved','physician_rejected','revision_requested'
      )),
      reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewer_name TEXT DEFAULT '',
      reviewer_credentials TEXT DEFAULT '',
      review_notes TEXT DEFAULT '',
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_projects_owner ON research_projects(owner_id);
    CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_conv_project ON research_conversations(project_id);
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON research_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_lit_project ON literature_sources(project_id);
    CREATE INDEX IF NOT EXISTS idx_doc_project ON research_documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_ds_project ON research_datasets(project_id);
    CREATE INDEX IF NOT EXISTS idx_hyp_project ON research_hypotheses(project_id);
    CREATE INDEX IF NOT EXISTS idx_exp_project ON experiment_plans(project_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cycles_project ON autonomous_cycles(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_iter_cycle ON autonomous_iterations(cycle_id, iteration_number);
    CREATE INDEX IF NOT EXISTS idx_mem_project ON research_memory(project_id, experiment_signature_hash);
    CREATE INDEX IF NOT EXISTS idx_sim_project ON simulation_runs(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_val_status ON physician_validation_queue(validation_status, created_at DESC);
  `);

  // Seed default organisation & default system settings ONLY (no fake research data!)
  const orgCount = (db.prepare('SELECT COUNT(*) as c FROM organisations').get() as { c: number }).c;
  if (orgCount === 0) {
    db.prepare('INSERT INTO organisations (id, name, domain, retention_days) VALUES (?, ?, ?, ?)').run(
      'org_cure_default',
      'CURE Computational Oncology Lab',
      'cure.research.local',
      365
    );
  }

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    // Create local PI account and a secondary reviewer account for RBAC verification;
    // zero projects/datasets/hypotheses are created so dashboard starts genuinely at zero.
    const piHash = bcrypt.hashSync('cure-pi-local', 10);
    const revHash = bcrypt.hashSync('cure-reviewer-local', 10);
    db.prepare(
      'INSERT INTO users (id, org_id, email, name, password_hash, role, title, institution) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'usr_pi_default',
      'org_cure_default',
      'pi@cure.local',
      'Dr. Elena Vance',
      piHash,
      'principal_investigator',
      'Principal Investigator, Computational Oncology',
      'CURE Computational Oncology Lab'
    );
    db.prepare(
      'INSERT INTO users (id, org_id, email, name, password_hash, role, title, institution) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'usr_reviewer_default',
      'org_cure_default',
      'reviewer@cure.local',
      'Dr. Marcus Chen',
      revHash,
      'reviewer',
      'Independent Methodology Reviewer',
      'External Oncology Review Board'
    );
  }

  // Seed initial deterministic simulation calibration model version (configuration, not fake data)
  const mvCount = (db.prepare('SELECT COUNT(*) as c FROM model_versions').get() as { c: number }).c;
  if (mvCount === 0) {
    db.prepare(
      `INSERT INTO model_versions (id, version_tag, parent_version_id, description, parameters_json, benchmark_metrics_json, is_active, protected_guardrails_intact, created_by)
       VALUES (?, ?, NULL, ?, ?, ?, 1, 1, ?)`
    ).run(
      'mod_v1_baseline',
      'baseline',
      'Baseline ODE-coupled cellular automaton calibration for extracellular diffusion, receptor uptake, repair capacity, and apoptotic commitment.',
      JSON.stringify({
        diffusionRate: 0.42,
        bindingAffinity: 0.65,
        dnaDamageWeight: 0.52,
        repairEfficiency: 0.34,
        apoptosisThreshold: 0.74,
        immuneClearanceFactor: 0.28,
        confidenceCalibration: 0.85,
      }),
      JSON.stringify({
        meanViabilityReductionPct: 0,
        healthyPreservationPct: 100,
        calibrationNote: 'Initial baseline prior to autonomous calibration iterations',
      }),
      'usr_pi_default'
    );
  } else {
    db.prepare("UPDATE model_versions SET version_tag = 'baseline' WHERE version_tag = 'v1.0.0-baseline'").run();
    db.prepare("UPDATE research_memory SET model_version = 'baseline' WHERE model_version = 'v1.0.0-baseline'").run();
  }

  const upsertSetting = db.prepare(
    'INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)'
  );
  upsertSetting.run('gemini_model', 'gemini-4-hydrogen');
  upsertSetting.run('data_retention_days', '365');
  upsertSetting.run('allow_external_literature_grounding', 'true');
  upsertSetting.run('require_explicit_deidentification_ack', 'true');
  upsertSetting.run('autonomous_max_iterations_cap', '6');
  upsertSetting.run('physician_review_confidence_threshold', '0.95');
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function writeAuditLog(params: {
  userId?: string | null;
  projectId?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (id, user_id, project_id, action, entity_type, entity_id, details_json, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId('aud'),
      params.userId ?? null,
      params.projectId ?? null,
      params.action,
      params.entityType,
      params.entityId ?? '',
      JSON.stringify(params.details ?? {}),
      params.ipAddress ?? ''
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}
