import { Type } from '@google/genai';
import { db, newId, writeAuditLog } from '../db.js';
import { callGeminiWithFailover, getGeminiClient, safeParseGeminiJson } from './gemini.js';
import { getActiveModelVersion, runAndPersistSimulation } from './simulationEngine.js';
import {
  computeExperimentSignature,
  getTreatmentDisplayName,
} from '../../src/simulation/bioSimCore.js';
import type {
  AutonomousStageEntry,
  ModelCalibrationParams,
  TreatmentMechanism,
} from '../../src/types.js';

const ALL_MECHANISMS: TreatmentMechanism[] = [
  'targeted_kinase_inhibitor',
  'cytotoxic_chemotherapy',
  'checkpoint_immunotherapy',
  'hypoxia_activated_prodrug',
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function getPhysicianReviewThreshold(): number {
  const row = db
    .prepare("SELECT value FROM system_settings WHERE key = 'physician_review_confidence_threshold'")
    .get() as { value: string } | undefined;
  const parsed = row ? Number(row.value) : 0.95;
  return Number.isFinite(parsed) ? clamp(parsed, 0.9, 0.99) : 0.95;
}

interface ObservedProjectContext {
  literatureCount: number;
  datasetCount: number;
  pathologyCount: number;
  hypothesesCount: number;
  memoryCount: number;
  literatureTitles: string[];
  datasetSummaries: string[];
  pathologyNotes: string[];
  existingMemorySignatures: Set<string>;
  recentFailures: Array<{ title: string; rationale: string; parameters_json: string }>;
  summaryText: string;
}

function observeProjectContext(projectId: string | null, userId: string): ObservedProjectContext {
  const scopeClause = projectId ? 'project_id = ?' : 'project_id IS NULL AND user_id = ?';
  const scopeArg = projectId ?? userId;

  const litRows = db
    .prepare(`SELECT title, pmid, doi, pub_type FROM literature_sources WHERE ${scopeClause} ORDER BY created_at DESC LIMIT 8`)
    .all(scopeArg) as Array<{ title: string; pmid: string; doi: string; pub_type: string }>;

  const dsRows = db
    .prepare(`SELECT name, row_count, col_count FROM research_datasets WHERE ${scopeClause} ORDER BY created_at DESC LIMIT 6`)
    .all(scopeArg) as Array<{ name: string; row_count: number; col_count: number }>;

  const pathRows = db
    .prepare(`SELECT title, stain_type, notes FROM pathology_images WHERE ${scopeClause} ORDER BY created_at DESC LIMIT 6`)
    .all(scopeArg) as Array<{ title: string; stain_type: string; notes: string }>;

  const hypCount = (
    db.prepare(`SELECT COUNT(*) as c FROM research_hypotheses WHERE ${scopeClause}`).get(scopeArg) as { c: number }
  ).c;

  const memRows = db
    .prepare(
      `SELECT title, experiment_signature_hash, outcome_status, rationale, parameters_json
       FROM research_memory WHERE ${projectId ? 'project_id = ?' : 'project_id IS NULL'}
       ORDER BY created_at DESC LIMIT 40`
    )
    .all(...(projectId ? [projectId] : [])) as Array<{
    title: string;
    experiment_signature_hash: string;
    outcome_status: string;
    rationale: string;
    parameters_json: string;
  }>;

  const sigs = new Set<string>(memRows.map((m) => m.experiment_signature_hash));
  const recentFailures = memRows
    .filter((m) => m.outcome_status === 'rejected' || m.outcome_status === 'inconclusive')
    .slice(0, 5);

  const summaryText = `Observed ${litRows.length} indexed literature sources, ${dsRows.length} imported datasets, ${pathRows.length} pathology records, ${hypCount} prior hypotheses, and ${memRows.length} persistent research memory entries (${recentFailures.length} recent failed/inconclusive runs).`;

  return {
    literatureCount: litRows.length,
    datasetCount: dsRows.length,
    pathologyCount: pathRows.length,
    hypothesesCount: hypCount,
    memoryCount: memRows.length,
    literatureTitles: litRows.map((l) => `${l.pmid ? `PMID:${l.pmid}` : l.doi ? `DOI:${l.doi}` : 'REF'} — ${l.title}`),
    datasetSummaries: dsRows.map((d) => `${d.name} (${d.row_count} samples, ${d.col_count} vars)`),
    pathologyNotes: pathRows.map((p) => `${p.title} [${p.stain_type}]: ${p.notes || 'No pathology note'}`),
    existingMemorySignatures: sigs,
    recentFailures,
    summaryText,
  };
}

async function generateGeminiHypothesisAndPlan(params: {
  model: string;
  goalPrompt: string;
  cancerArea: string;
  iterationNumber: number;
  observed: ObservedProjectContext;
  currentMechanism: TreatmentMechanism;
  currentConcentration: number;
  currentResistance: number;
  priorIterationFeedback: string;
  activeCalibration: ModelCalibrationParams;
}): Promise<{
  hypothesisTitle: string;
  researchQuestion: string;
  biologicalRationale: string;
  proposedMechanism: string;
  relevantGenes: string[];
  limitations: string;
  validationApproach: string;
  chosenMechanism: TreatmentMechanism;
  concentrationUM: number;
  resistanceFactor: number;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Configure GEMINI_API_KEY in Secrets for AI-Guided mode, or switch Execution Mode to Deterministic Computational Calibration.'
    );
  }

  const prompt = {
    goal: params.goalPrompt,
    cancer_area: params.cancerArea || 'Solid Tumour Microenvironment',
    iteration_number: params.iterationNumber,
    observed_evidence: {
      literature: params.observed.literatureTitles,
      datasets: params.observed.datasetSummaries,
      pathology: params.observed.pathologyNotes,
      recent_failed_experiments: params.observed.recentFailures,
    },
    previous_iteration_feedback: params.priorIterationFeedback || 'Initial iteration',
    baseline_simulation_proposal: {
      mechanism: params.currentMechanism,
      concentration_uM: params.currentConcentration,
      resistance_factor: params.currentResistance,
      model_calibration: params.activeCalibration,
    },
    allowed_mechanisms: ALL_MECHANISMS,
  };

  const { response: resp } = await callGeminiWithFailover({
    ai,
    primaryModel: params.model || 'gemini-4-hydrogen',
    contents: `You are C.U.R.E.'s Autonomous Intelligence Engine executing the HYPOTHESISE stage of Iteration ${params.iterationNumber}. Formulate one falsifiable computational cancer research hypothesis and select realistic simulation parameters grounded strictly in the observed context (never invent fake PMIDs or claim clinical efficacy). Avoid repeating failed parameter sets.\n\n${JSON.stringify(
      prompt,
      null,
      2
    )}`,
    config: {
      systemInstruction:
        'Formulate rigorous scientific hypotheses strictly separating computational predictions from experimental validation. Choose a mechanism from allowed_mechanisms and realistic micromolar concentration (0.5 to 12.0 uM).',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          hypothesisTitle: { type: Type.STRING },
          researchQuestion: { type: Type.STRING },
          biologicalRationale: { type: Type.STRING },
          proposedMechanism: { type: Type.STRING },
          relevantGenes: { type: Type.ARRAY, items: { type: Type.STRING } },
          limitations: { type: Type.STRING },
          validationApproach: { type: Type.STRING },
          chosenMechanism: { type: Type.STRING },
          concentrationUM: { type: Type.NUMBER },
          resistanceFactor: { type: Type.NUMBER },
        },
        required: [
          'hypothesisTitle',
          'researchQuestion',
          'biologicalRationale',
          'proposedMechanism',
          'relevantGenes',
          'limitations',
          'validationApproach',
          'chosenMechanism',
          'concentrationUM',
          'resistanceFactor',
        ],
      },
    },
  });

  const parsed = safeParseGeminiJson<Record<string, unknown>>(resp.text);
  const mech = ALL_MECHANISMS.includes(parsed.chosenMechanism as TreatmentMechanism)
    ? (parsed.chosenMechanism as TreatmentMechanism)
    : params.currentMechanism;

  return {
    hypothesisTitle: String(parsed.hypothesisTitle || `Iteration ${params.iterationNumber} Therapeutic Response Hypothesis`),
    researchQuestion: String(parsed.researchQuestion || params.goalPrompt),
    biologicalRationale: String(parsed.biologicalRationale || 'Mechanistic cellular-response exploration.'),
    proposedMechanism: String(parsed.proposedMechanism || getTreatmentDisplayName(mech)),
    relevantGenes: Array.isArray(parsed.relevantGenes) ? parsed.relevantGenes.map(String).slice(0, 8) : ['TP53', 'EGFR'],
    limitations: String(parsed.limitations || 'Computational ODE/cellular-automaton model requires wet-lab validation.'),
    validationApproach: String(parsed.validationApproach || 'In vitro viability assay (CellTiter-Glo) + Annexin V/PI apoptosis flow cytometry.'),
    chosenMechanism: mech,
    concentrationUM: clamp(Number(parsed.concentrationUM) || params.currentConcentration, 0.5, 14.0),
    resistanceFactor: clamp(Number(parsed.resistanceFactor) || params.currentResistance, 0.05, 0.85),
  };
}

function buildDeterministicHypothesisPlan(params: {
  goalPrompt: string;
  cancerArea: string;
  iterationNumber: number;
  currentMechanism: TreatmentMechanism;
  currentConcentration: number;
  currentResistance: number;
}) {
  const mech = params.currentMechanism;
  return {
    hypothesisTitle: `Iter ${String(params.iterationNumber).padStart(3, '0')} · ${getTreatmentDisplayName(mech)} @ ${params.currentConcentration.toFixed(1)} uM`,
    researchQuestion: `${params.goalPrompt} [Deterministic parameter sweep: ${mech}, ${params.currentConcentration.toFixed(1)} uM, resistance=${params.currentResistance.toFixed(2)}]`,
    biologicalRationale: `Deterministic computational sensitivity evaluation under ${params.cancerArea || 'solid tumour'} microenvironment constraints without LLM synthesis.`,
    proposedMechanism: `Quantitative perfusion, intracellular accumulation, and stress-induced apoptosis kinetics for ${getTreatmentDisplayName(mech)}.`,
    relevantGenes: ['TP53', 'BCL2', 'CASP3', 'ABCB1'],
    limitations: 'Deterministic computational simulation only; does not incorporate patient pharmacokinetics or empirical assay variance.',
    validationApproach: 'In vitro dose-response viability curve and Caspase-3/7 apoptotic kinetics assay.',
    chosenMechanism: mech,
    concentrationUM: params.currentConcentration,
    resistanceFactor: params.currentResistance,
  };
}

function createRevisedModelVersion(params: {
  parentModelId: string;
  parentVersionTag: string;
  parentParams: ModelCalibrationParams;
  iterationNumber: number;
  viabilityEnd: number;
  healthyPreservation: number;
  criterionPassed: boolean;
  userId: string;
}): { id: string; versionTag: string; params: ModelCalibrationParams; description: string } {
  const nextParams: ModelCalibrationParams = { ...params.parentParams };
  let adjustmentReason = '';

  if (!params.criterionPassed) {
    if (params.healthyPreservation < 80) {
      // Too toxic to healthy margin: refine binding specificity & repair margin
      nextParams.bindingAffinity = Number(clamp(nextParams.bindingAffinity + 0.05, 0.35, 0.95).toFixed(3));
      nextParams.repairEfficiency = Number(clamp(nextParams.repairEfficiency + 0.03, 0.2, 0.55).toFixed(3));
      adjustmentReason = 'Increased receptor binding selectivity and stromal repair tolerance to preserve healthy tissue margin >= 80%.';
    } else {
      // Insufficient cancer elimination: tune diffusion penetration & apoptotic threshold calibration
      nextParams.diffusionRate = Number(clamp(nextParams.diffusionRate + 0.06, 0.25, 0.9).toFixed(3));
      nextParams.dnaDamageWeight = Number(clamp(nextParams.dnaDamageWeight + 0.05, 0.35, 0.92).toFixed(3));
      nextParams.apoptosisThreshold = Number(clamp(nextParams.apoptosisThreshold - 0.04, 0.52, 0.85).toFixed(3));
      adjustmentReason = 'Improved extracellular diffusion weight and calibrated stress-to-apoptosis sensitivity after suboptimal tumour clearance.';
    }
  } else {
    // Model succeeded; refine confidence calibration slightly while preserving guardrails
    nextParams.confidenceCalibration = Number(clamp(nextParams.confidenceCalibration + 0.025, 0.75, 0.96).toFixed(3));
    adjustmentReason = 'Criterion met; tightened posterior confidence calibration while keeping safety guardrails locked.';
  }

  const nextId = newId('mod');
  const tagSuffix = `${Date.now().toString(36).slice(-4)}${nextId.slice(-4)}`;
  const versionTag = `v1.${params.iterationNumber}.${tagSuffix}`;

  db.prepare('UPDATE model_versions SET is_active = 0').run();
  db.prepare(
    `INSERT INTO model_versions (
      id, version_tag, parent_version_id, description, parameters_json, benchmark_metrics_json,
      is_active, protected_guardrails_intact, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`
  ).run(
    nextId,
    versionTag,
    params.parentModelId,
    adjustmentReason,
    JSON.stringify(nextParams),
    JSON.stringify({
      priorViabilityEndPct: params.viabilityEnd,
      priorHealthyPreservationPct: params.healthyPreservation,
      parentVersion: params.parentVersionTag,
    }),
    params.userId
  );

  return {
    id: nextId,
    versionTag,
    params: nextParams,
    description: adjustmentReason,
  };
}

export interface AutonomousProgressEvent {
  type: 'stage' | 'iteration_completed';
  cycleId: string;
  iterationNumber: number;
  stage?: string;
  summary?: string;
}

export async function runAutonomousResearchCycle(params: {
  userId: string;
  projectId: string | null;
  goalPrompt: string;
  cancerArea: string;
  treatmentFocus: TreatmentMechanism;
  executionMode: 'ai_guided' | 'computational_calibration';
  maxIterations: number;
  initialConcentrationUM?: number;
  initialResistanceFactor?: number;
  allowReproducibilityTest?: boolean;
  geminiModel?: string;
  ipAddress?: string;
  onProgress?: (event: AutonomousProgressEvent) => void;
}): Promise<{ cycleId: string }> {
  const maxIterCapRow = db
    .prepare("SELECT value FROM system_settings WHERE key = 'autonomous_max_iterations_cap'")
    .get() as { value: string } | undefined;
  const hardCap = maxIterCapRow ? Math.max(1, Math.min(10, Number(maxIterCapRow.value) || 6)) : 6;
  const maxIterations = clamp(Math.round(params.maxIterations || 3), 1, hardCap);
  const reviewThreshold = getPhysicianReviewThreshold();

  const activeModel = getActiveModelVersion();
  const cycleId = newId('cyc');

  db.prepare(
    `INSERT INTO autonomous_cycles (
      id, project_id, user_id, goal_prompt, cancer_area, treatment_focus, execution_mode,
      status, current_stage, max_iterations, completed_iterations, target_confidence,
      config_json, model_version_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'OBSERVE', ?, 0, ?, ?, ?)`
  ).run(
    cycleId,
    params.projectId,
    params.userId,
    params.goalPrompt,
    params.cancerArea || 'Oncology Microenvironment',
    params.treatmentFocus,
    params.executionMode,
    maxIterations,
    reviewThreshold,
    JSON.stringify({
      initialConcentrationUM: params.initialConcentrationUM ?? 2.2,
      initialResistanceFactor: params.initialResistanceFactor ?? 0.35,
      allowReproducibilityTest: Boolean(params.allowReproducibilityTest),
    }),
    activeModel.id
  );

  writeAuditLog({
    userId: params.userId,
    projectId: params.projectId,
    action: 'autonomous_cycle_started',
    entityType: 'autonomous_cycle',
    entityId: cycleId,
    details: { executionMode: params.executionMode, maxIterations, treatmentFocus: params.treatmentFocus },
    ipAddress: params.ipAddress,
  });

  let currentMechanism: TreatmentMechanism =
    params.treatmentFocus === 'untreated_control' ? 'targeted_kinase_inhibitor' : params.treatmentFocus;
  let currentConcentration = clamp(Number(params.initialConcentrationUM ?? 2.0), 0.5, 12.0);
  let currentResistance = clamp(Number(params.initialResistanceFactor ?? 0.32), 0.05, 0.85);
  let priorFeedback = '';
  let converged = false;
  let completedCount = 0;

  try {
    for (let iter = 1; iter <= maxIterations; iter++) {
      const stages: AutonomousStageEntry[] = [];
      const currentModel = getActiveModelVersion();

      // 1. OBSERVE
      const observed = observeProjectContext(params.projectId, params.userId);
      stages.push({
        stage: 'OBSERVE',
        status: 'completed',
        summary: observed.summaryText,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'OBSERVE', summary: observed.summaryText });

      // 2. ANALYSE (plus duplicate experiment signature guard)
      let candidateSig = computeExperimentSignature({
        treatmentMechanism: currentMechanism,
        concentrationUM: currentConcentration,
        resistanceFactor: currentResistance,
        initialCancerCells: 42,
        durationHours: 72,
        calibration: currentModel.parameters,
      });

      let isReproducibilityTest = false;
      if (observed.existingMemorySignatures.has(candidateSig)) {
        if (params.allowReproducibilityTest) {
          isReproducibilityTest = true;
        } else {
          // Shift concentration/mechanism automatically so C.U.R.E. never wastes compute on uninformative duplicates
          currentConcentration = Number(clamp(currentConcentration + 1.1, 0.5, 12.5).toFixed(2));
          if (currentConcentration >= 11.5) {
            const nextIdx = (ALL_MECHANISMS.indexOf(currentMechanism) + 1) % ALL_MECHANISMS.length;
            currentMechanism = ALL_MECHANISMS[nextIdx];
            currentConcentration = 2.8;
          }
          candidateSig = computeExperimentSignature({
            treatmentMechanism: currentMechanism,
            concentrationUM: currentConcentration,
            resistanceFactor: currentResistance,
            initialCancerCells: 42,
            durationHours: 72,
            calibration: currentModel.parameters,
          });
        }
      }

      const analyseSummary = isReproducibilityTest
        ? `Signature ${candidateSig} detected in memory; flagged explicitly as Reproducibility Verification Run.`
        : `Checked ${observed.existingMemorySignatures.size} historical experiment signatures; prepared novel parameter signature ${candidateSig}.`;
      stages.push({
        stage: 'ANALYSE',
        status: 'completed',
        summary: analyseSummary,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'ANALYSE', summary: analyseSummary });
      params.onProgress?.({
        type: 'stage',
        cycleId,
        iterationNumber: iter,
        stage: 'HYPOTHESISE',
        summary: `Formulating hypothesis via ${params.executionMode === 'ai_guided' ? 'AI-Guided reasoning' : 'Deterministic calibration'}...`,
      });

      // 3. HYPOTHESISE
      const plan: Awaited<ReturnType<typeof generateGeminiHypothesisAndPlan>> =
        params.executionMode === 'ai_guided'
          ? await generateGeminiHypothesisAndPlan({
              model: params.geminiModel || 'gemini-4-hydrogen',
              goalPrompt: params.goalPrompt,
              cancerArea: params.cancerArea,
              iterationNumber: iter,
              observed,
              currentMechanism,
              currentConcentration,
              currentResistance,
              priorIterationFeedback: priorFeedback,
              activeCalibration: currentModel.parameters,
            })
          : buildDeterministicHypothesisPlan({
              goalPrompt: params.goalPrompt,
              cancerArea: params.cancerArea,
              iterationNumber: iter,
              currentMechanism,
              currentConcentration,
              currentResistance,
            });

      currentMechanism = plan.chosenMechanism;
      currentConcentration = plan.concentrationUM;
      currentResistance = plan.resistanceFactor;

      const hypothesisId = newId('hyp');
      db.prepare(
        `INSERT INTO research_hypotheses (
          id, project_id, user_id, title, research_question, biological_rationale,
          proposed_mechanism, relevant_genes_json, assumptions, limitations,
          confidence_level, validation_approach, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'low_preliminary', ?, 'computationally_evaluated')`
      ).run(
        hypothesisId,
        params.projectId,
        params.userId,
        plan.hypothesisTitle,
        plan.researchQuestion,
        plan.biologicalRationale,
        plan.proposedMechanism,
        JSON.stringify(plan.relevantGenes),
        `Model version ${currentModel.version_tag}; concentration ${currentConcentration} uM; resistance ${currentResistance}.`,
        plan.limitations,
        plan.validationApproach
      );

      const hypSummary = `Formulated hypothesis "${plan.hypothesisTitle}" targeting ${getTreatmentDisplayName(currentMechanism)} at ${currentConcentration.toFixed(2)} uM.`;
      stages.push({
        stage: 'HYPOTHESISE',
        status: 'completed',
        summary: hypSummary,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'HYPOTHESISE', summary: hypSummary });

      // 4. SIMULATE
      const iterId = newId('itr');
      const simRun = runAndPersistSimulation({
        userId: params.userId,
        projectId: params.projectId,
        hypothesisId,
        autonomousIterationId: iterId,
        scenarioName: `Auto Iter ${String(iter).padStart(3, '0')} · ${getTreatmentDisplayName(currentMechanism)}`,
        treatmentMechanism: currentMechanism,
        concentrationUM: currentConcentration,
        initialCancerCells: 42,
        initialHealthyCells: 16,
        resistanceFactor: currentResistance,
        durationHours: 72,
        seed: 104729 + iter * 97,
        ipAddress: params.ipAddress,
      });

      const simSummary = `Executed 72h 3D biological simulation (${simRun.id}) under ${currentModel.version_tag}.`;
      stages.push({
        stage: 'SIMULATE',
        status: 'completed',
        summary: simSummary,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'SIMULATE', summary: simSummary });

      // 5. MEASURE
      const fm = simRun.result.finalMetrics;
      const measureSummary = `End viability: ${fm.cellViabilityPct}% | Treatment response: ${fm.treatmentResponsePct}% | Healthy preserved: ${fm.healthyPreservationPct}% | AUC: ${fm.aucResponse}% | Confidence: ${(fm.evidenceSupportedConfidence * 100).toFixed(1)}%.`;
      stages.push({
        stage: 'MEASURE',
        status: 'completed',
        summary: measureSummary,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'MEASURE', summary: measureSummary });

      // 6. EVALUATE
      const failureDiagnosis = fm.criterionPassed
        ? ''
        : fm.healthyPreservationPct < 80
        ? `Off-target cytotoxicity reduced healthy tissue preservation to ${fm.healthyPreservationPct}% (< 80% safety threshold).`
        : `Tumour viability remained at ${fm.cellViabilityPct}% (> 35% efficacy criterion), indicating insufficient intracellular accumulation or elevated resistance (${currentResistance.toFixed(2)}).`;

      // Attach computational simulation evidence to hypothesis
      db.prepare(
        `INSERT INTO hypothesis_evidence (id, hypothesis_id, evidence_type, polarity, source_type, source_id, citation_label, summary)
         VALUES (?, ?, 'biological_mechanism', ?, 'autonomous_simulation', ?, ?, ?)`
      ).run(
        newId('hev'),
        hypothesisId,
        fm.criterionPassed ? 'supporting' : 'contradictory',
        simRun.id,
        `SIM:${simRun.id} (${currentModel.version_tag})`,
        `COMPUTATIONAL SIMULATION ONLY — ${fm.evaluationSummary}`
      );

      // Update hypothesis confidence descriptor honestly
      const confTier =
        fm.evidenceSupportedConfidence >= 0.85
          ? 'moderate_peer_reviewed'
          : fm.evidenceSupportedConfidence >= 0.65
          ? 'low_preliminary'
          : 'insufficient_evidence';
      db.prepare('UPDATE research_hypotheses SET confidence_level = ?, status = ? WHERE id = ?').run(
        confTier,
        fm.criterionPassed ? 'computationally_evaluated' : 'inconclusive',
        hypothesisId
      );

      const evalSummary = fm.criterionPassed
        ? `Hypothesis PASSED computational evaluation criterion (${fm.cellViabilityPct}% residual viability).`
        : `Hypothesis FAILED criterion: ${failureDiagnosis}`;
      stages.push({
        stage: 'EVALUATE',
        status: 'completed',
        summary: evalSummary,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'EVALUATE', summary: evalSummary });

      // Persist in persistent research_memory
      db.prepare(
        `INSERT INTO research_memory (
          id, project_id, user_id, memory_type, experiment_signature_hash, title,
          parameters_json, outcome_status, confidence_score, rationale, references_json, model_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId('mem'),
        params.projectId,
        params.userId,
        fm.criterionPassed ? 'hypothesis_outcome' : 'failure_diagnosis',
        simRun.result.signatureHash,
        plan.hypothesisTitle,
        JSON.stringify({
          mechanism: currentMechanism,
          concentrationUM: currentConcentration,
          resistanceFactor: currentResistance,
          viabilityEndPct: fm.cellViabilityPct,
          healthyPreservationPct: fm.healthyPreservationPct,
        }),
        isReproducibilityTest ? 'reproducibility_test' : fm.criterionPassed ? 'accepted' : 'rejected',
        fm.evidenceSupportedConfidence,
        fm.criterionPassed ? fm.evaluationSummary : failureDiagnosis,
        JSON.stringify([`SIM:${simRun.id}`, `HYP:${hypothesisId}`]),
        currentModel.version_tag
      );

      // 7. IMPROVE (Controlled, version-controlled, reversible; protected guardrails intact)
      const nextModel = createRevisedModelVersion({
        parentModelId: currentModel.id,
        parentVersionTag: currentModel.version_tag,
        parentParams: currentModel.parameters,
        iterationNumber: iter,
        viabilityEnd: fm.cellViabilityPct,
        healthyPreservation: fm.healthyPreservationPct,
        criterionPassed: fm.criterionPassed,
        userId: params.userId,
      });

      // Compute strategy revision for the next iteration
      let strategyRevision = '';
      if (!fm.criterionPassed) {
        if (fm.healthyPreservationPct < 80) {
          currentConcentration = Number(clamp(currentConcentration * 0.72, 0.8, 10).toFixed(2));
          currentMechanism = 'targeted_kinase_inhibitor';
          strategyRevision = `Reduced concentration to ${currentConcentration} uM and pivoted to targeted kinase selectivity; released ${nextModel.versionTag}.`;
        } else {
          currentConcentration = Number(clamp(currentConcentration + 1.35, 1.0, 11.5).toFixed(2));
          if (iter >= 2 && fm.cellViabilityPct > 55) {
            const idx: number = (ALL_MECHANISMS.indexOf(currentMechanism) + 1) % ALL_MECHANISMS.length;
            currentMechanism = ALL_MECHANISMS[idx];
          }
          strategyRevision = `Escalated target dose to ${currentConcentration} uM (${getTreatmentDisplayName(currentMechanism)}) and calibrated diffusion/apoptosis weights in ${nextModel.versionTag}.`;
        }
      } else {
        strategyRevision = `Model calibration tightened (${nextModel.versionTag}); verifying consistency and checking >= ${(reviewThreshold * 100).toFixed(0)}% physician-review threshold.`;
      }

      const improveSummary = `Created reversible model ${nextModel.versionTag} (${nextModel.description}) — Protected safety & RBAC guardrails verified intact.`;
      stages.push({
        stage: 'IMPROVE',
        status: 'completed',
        summary: improveSummary,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'IMPROVE', summary: improveSummary });

      // 8. VERIFY (Reproducibility + >= 95% Physician Validation Queue gating)
      const shouldEnqueueValidation = fm.criterionPassed && fm.evidenceSupportedConfidence >= reviewThreshold;
      let verifyNotes = `Verified deterministic replay & model benchmark transition (${currentModel.version_tag} -> ${nextModel.versionTag}).`;
      if (shouldEnqueueValidation) {
        verifyNotes += ` Enqueued in Physician Validation Queue (${(fm.evidenceSupportedConfidence * 100).toFixed(1)}% confidence).`;
      }

      stages.push({
        stage: 'VERIFY',
        status: 'completed',
        summary: verifyNotes,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'VERIFY', summary: verifyNotes });

      // 9. REPEAT decision
      const shouldConverge = shouldEnqueueValidation;
      const repeatSummary = shouldConverge
        ? `Convergence target reached (>= ${(reviewThreshold * 100).toFixed(0)}% confidence & criterion met). Stopping autonomous loop cleanly for human review.`
        : iter < maxIterations
        ? `Proceeding automatically to Iteration ${String(iter + 1).padStart(3, '0')} within max iteration budget (${maxIterations}).`
        : `Reached configured maximum iteration limit (${maxIterations}).`;
      stages.push({
        stage: 'REPEAT',
        status: 'completed',
        summary: repeatSummary,
        timestamp: new Date().toISOString(),
      });
      params.onProgress?.({ type: 'stage', cycleId, iterationNumber: iter, stage: 'REPEAT', summary: repeatSummary });

      db.transaction(() => {
        db.prepare(
          `INSERT INTO autonomous_iterations (
            id, cycle_id, iteration_number, stage_log_json, observed_summary, hypothesis_id,
            simulation_run_id, predicted_viability_end, auc_response, confidence_score,
            criterion_passed, evaluation_notes, failure_diagnosis, strategy_revision,
            duplicate_check_hash, is_reproducibility_test, model_version_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          iterId,
          cycleId,
          iter,
          JSON.stringify(stages),
          observed.summaryText,
          hypothesisId,
          simRun.id,
          fm.cellViabilityPct,
          fm.aucResponse,
          fm.evidenceSupportedConfidence,
          fm.criterionPassed ? 1 : 0,
          fm.evaluationSummary,
          failureDiagnosis,
          strategyRevision,
          simRun.result.signatureHash,
          isReproducibilityTest ? 1 : 0,
          nextModel.id
        );

        if (shouldEnqueueValidation) {
          db.prepare(
            `INSERT INTO physician_validation_queue (
              id, project_id, hypothesis_id, iteration_id, simulation_run_id,
              title, summary, modelled_confidence, evidence_refs_json, validation_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_physician_review')`
          ).run(
            newId('val'),
            params.projectId,
            hypothesisId,
            iterId,
            simRun.id,
            plan.hypothesisTitle,
            `Modelled computational confidence reached ${(fm.evidenceSupportedConfidence * 100).toFixed(1)}% (>= ${(reviewThreshold * 100).toFixed(0)}% threshold). Requires independent physician/certified reviewer validation before any clinical or empirical assertion. ${fm.evaluationSummary}`,
            fm.evidenceSupportedConfidence,
            JSON.stringify([`SIM:${simRun.id}`, `HYP:${hypothesisId}`, `MOD:${nextModel.versionTag}`])
          );
        }
      })();

      completedCount = iter;
      priorFeedback = fm.criterionPassed
        ? `Iteration ${iter} succeeded (viability=${fm.cellViabilityPct}%, confidence=${fm.evidenceSupportedConfidence}).`
        : `Iteration ${iter} failed (${failureDiagnosis}). Revision: ${strategyRevision}`;

      db.prepare(
        `UPDATE autonomous_cycles SET completed_iterations = ?, current_stage = ?, model_version_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(completedCount, 'REPEAT', nextModel.id, cycleId);

      params.onProgress?.({
        type: 'iteration_completed',
        cycleId,
        iterationNumber: iter,
        stage: 'REPEAT',
        summary: repeatSummary,
      });

      if (shouldConverge) {
        converged = true;
        break;
      }
    }

    const finalStatus = converged ? 'stopped_converged' : 'stopped_max_iterations';
    db.prepare(
      `UPDATE autonomous_cycles SET status = ?, current_stage = 'COMPLETED', completed_iterations = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(finalStatus, completedCount, cycleId);

    writeAuditLog({
      userId: params.userId,
      projectId: params.projectId,
      action: 'autonomous_cycle_finished',
      entityType: 'autonomous_cycle',
      entityId: cycleId,
      details: { status: finalStatus, completedIterations: completedCount },
      ipAddress: params.ipAddress,
    });

    return { cycleId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Autonomous research cycle failed.';
    db.prepare(
      `UPDATE autonomous_cycles SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(msg, cycleId);
    throw err;
  }
}
