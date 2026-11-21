import { db, newId, writeAuditLog } from '../db.js';
import {
  DEFAULT_CALIBRATION_PARAMS,
  getTreatmentDisplayName,
  runDeterministicBioSimulation,
  type BioSimConfig,
  type BioSimResult,
} from '../../src/simulation/bioSimCore.js';
import type { DosingSchedule, ModelCalibrationParams, TreatmentMechanism } from '../../src/types.js';

export function getActiveModelVersion(): {
  id: string;
  version_tag: string;
  parameters: ModelCalibrationParams;
} {
  const row = db
    .prepare('SELECT id, version_tag, parameters_json FROM model_versions WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1')
    .get() as { id: string; version_tag: string; parameters_json: string } | undefined;

  if (!row) {
    return {
      id: 'mod_v1_baseline',
      version_tag: 'baseline',
      parameters: DEFAULT_CALIBRATION_PARAMS,
    };
  }
  try {
    return {
      id: row.id,
      version_tag: row.version_tag,
      parameters: { ...DEFAULT_CALIBRATION_PARAMS, ...JSON.parse(row.parameters_json) },
    };
  } catch {
    return {
      id: row.id,
      version_tag: row.version_tag,
      parameters: DEFAULT_CALIBRATION_PARAMS,
    };
  }
}

export function runAndPersistSimulation(params: {
  userId: string;
  projectId: string | null;
  hypothesisId?: string | null;
  autonomousIterationId?: string | null;
  scenarioName?: string;
  treatmentMechanism: TreatmentMechanism;
  treatmentAgent?: string;
  concentrationUM: number;
  initialCancerCells?: number;
  initialHealthyCells?: number;
  resistanceFactor?: number;
  durationHours?: number;
  seed?: number;
  dosingSchedule?: DosingSchedule;
  halfLifeHours?: number;
  secondaryAgent?: string;
  secondaryMechanism?: TreatmentMechanism | 'none';
  secondaryConcentrationUM?: number;
  resistantSubcloneFraction?: number;
  calibrationOverride?: Partial<ModelCalibrationParams>;
  modelVersionIdOverride?: string;
  ipAddress?: string;
}): { id: string; result: BioSimResult; modelVersionId: string; modelVersionTag: string } {
  const activeModel = getActiveModelVersion();
  const calibration: ModelCalibrationParams = {
    ...activeModel.parameters,
    ...(params.calibrationOverride ?? {}),
  };

  let empiricalEvidenceCount = 0;
  if (params.projectId) {
    const litC = (
      db.prepare('SELECT COUNT(*) as c FROM literature_sources WHERE project_id = ?').get(params.projectId) as { c: number }
    ).c;
    const dsC = (
      db.prepare('SELECT COUNT(*) as c FROM research_datasets WHERE project_id = ?').get(params.projectId) as { c: number }
    ).c;
    empiricalEvidenceCount = litC + dsC;
  }

  const secondaryMech =
    params.secondaryMechanism && params.secondaryMechanism !== 'none' ? params.secondaryMechanism : 'none';
  const secondaryConc = secondaryMech !== 'none' ? Math.max(0, Number(params.secondaryConcentrationUM ?? 0)) : 0;

  const config: BioSimConfig = {
    scenarioName:
      params.scenarioName?.trim() ||
      `${getTreatmentDisplayName(params.treatmentMechanism)} · ${params.concentrationUM.toFixed(1)} uM${
        secondaryMech !== 'none' && secondaryConc > 0
          ? ` + ${getTreatmentDisplayName(secondaryMech)} (${secondaryConc.toFixed(1)} uM)`
          : ''
      }`,
    treatmentAgent: params.treatmentAgent?.trim() || getTreatmentDisplayName(params.treatmentMechanism),
    treatmentMechanism: params.treatmentMechanism,
    concentrationUM: Number(params.concentrationUM),
    initialCancerCells: Number(params.initialCancerCells ?? 42),
    initialHealthyCells: Number(params.initialHealthyCells ?? 16),
    resistanceFactor: Number(params.resistanceFactor ?? 0.25),
    durationHours: Number(params.durationHours ?? 72),
    seed: Number(params.seed ?? 104729),
    calibration,
    empiricalEvidenceCount,
    dosingSchedule: params.dosingSchedule ?? 'continuous',
    halfLifeHours: Number(params.halfLifeHours ?? 18),
    secondaryAgent: params.secondaryAgent?.trim() || (secondaryMech !== 'none' ? getTreatmentDisplayName(secondaryMech) : ''),
    secondaryMechanism: secondaryMech !== 'none' ? secondaryMech : undefined,
    secondaryConcentrationUM: secondaryConc,
    resistantSubcloneFraction: Number(params.resistantSubcloneFraction ?? 0.2),
  };

  const result = runDeterministicBioSimulation(config);
  const simId = newId('sim');
  const modelVersionId = params.modelVersionIdOverride || activeModel.id;

  db.prepare(
    `INSERT INTO simulation_runs (
      id, project_id, user_id, hypothesis_id, autonomous_iteration_id,
      scenario_name, treatment_agent, treatment_mechanism, concentration_uM,
      initial_cancer_cells, initial_healthy_cells, resistance_factor, duration_hours, seed,
      model_version_id, parameters_json, time_series_json, final_metrics_json,
      summary_confidence, is_computational_only
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    simId,
    params.projectId,
    params.userId,
    params.hypothesisId ?? null,
    params.autonomousIterationId ?? null,
    config.scenarioName,
    config.treatmentAgent,
    config.treatmentMechanism,
    config.concentrationUM,
    config.initialCancerCells,
    config.initialHealthyCells,
    config.resistanceFactor,
    config.durationHours,
    config.seed,
    modelVersionId,
    JSON.stringify(config),
    JSON.stringify(result.timeSeries),
    JSON.stringify(result.finalMetrics),
    result.finalMetrics.evidenceSupportedConfidence
  );

  writeAuditLog({
    userId: params.userId,
    projectId: params.projectId,
    action: 'biological_simulation_executed',
    entityType: 'simulation_run',
    entityId: simId,
    details: {
      treatmentMechanism: config.treatmentMechanism,
      concentrationUM: config.concentrationUM,
      dosingSchedule: config.dosingSchedule,
      secondaryMechanism: config.secondaryMechanism,
      finalViabilityPct: result.finalMetrics.cellViabilityPct,
      signatureHash: result.signatureHash,
      computationalOnly: true,
    },
    ipAddress: params.ipAddress,
  });

  return {
    id: simId,
    result,
    modelVersionId,
    modelVersionTag: activeModel.version_tag,
  };
}
