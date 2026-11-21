import type {
  CellLifecycleState,
  CombinationSynergyMetrics,
  DosingSchedule,
  ModelCalibrationParams,
  SimTimePoint,
  TreatmentMechanism,
} from '../types';

export const DEFAULT_CALIBRATION_PARAMS: ModelCalibrationParams = {
  diffusionRate: 0.42,
  bindingAffinity: 0.65,
  dnaDamageWeight: 0.52,
  repairEfficiency: 0.34,
  apoptosisThreshold: 0.74,
  immuneClearanceFactor: 0.28,
  confidenceCalibration: 0.85,
};

export interface BioSimConfig {
  scenarioName: string;
  treatmentAgent: string;
  treatmentMechanism: TreatmentMechanism;
  concentrationUM: number;
  initialCancerCells: number;
  initialHealthyCells: number;
  resistanceFactor: number; // 0..1
  durationHours: number;
  seed: number;
  calibration: ModelCalibrationParams;
  empiricalEvidenceCount?: number;
  // PK/PD & Combination Therapy extensions (optional for backward deterministic parity)
  dosingSchedule?: DosingSchedule;
  halfLifeHours?: number;
  secondaryAgent?: string;
  secondaryMechanism?: TreatmentMechanism;
  secondaryConcentrationUM?: number;
  resistantSubcloneFraction?: number;
}

export interface SimCell {
  id: string;
  index: number;
  isCancer: boolean;
  isResistantClone?: boolean;
  x: number;
  y: number;
  z: number;
  baseRadius: number;
  state: CellLifecycleState;
  intracellularDose: number; // 0..2
  stressIndex: number; // 0..1
  apoptoticProgress: number; // 0..1
  healthIntegrity: number; // 0..1
  receptorDensity: number;
  intrinsicResistance: number;
  prolifProgress: number;
  hypoxiaLevel: number;
  stateEnteredHour: number;
  phaseOffset: number;
}

export interface BioSimFinalMetrics {
  initialCancerPop: number;
  initialHealthyPop: number;
  finalViableCancer: number;
  finalSensitiveViable?: number;
  finalResistantViable?: number;
  finalActiveCancer: number;
  finalExposed: number;
  finalDamaged: number;
  finalApoptotic: number;
  finalEliminated: number;
  finalHealthyCount: number;
  cellViabilityPct: number;
  treatmentResponsePct: number;
  healthyPreservationPct: number;
  aucResponse: number;
  evidenceSupportedConfidence: number;
  criterionPassed: boolean;
  evaluationSummary: string;
  synergyMetrics?: CombinationSynergyMetrics;
}

export interface BioSimResult {
  config: BioSimConfig;
  signatureHash: string;
  timeSeries: SimTimePoint[];
  finalMetrics: BioSimFinalMetrics;
  finalCells: SimCell[];
}

export interface BioSimRuntime {
  config: BioSimConfig;
  cells: SimCell[];
  currentHour: number;
  rng: () => number;
  timeSeries: SimTimePoint[];
  nextCellIdx: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeSchedulePlasmaConcentration(
  nominalConcUM: number,
  tHours: number,
  schedule: DosingSchedule = 'continuous',
  halfLifeHours = 18
): number {
  if (nominalConcUM <= 0) return 0;
  if (schedule === 'continuous') return nominalConcUM;
  const tHalf = Math.max(2, Math.min(96, halfLifeHours || 18));
  if (schedule === 'q24h') {
    const cycleH = tHours % 24;
    return nominalConcUM * Math.pow(0.5, cycleH / tHalf);
  }
  if (schedule === 'q48h') {
    const cycleH = tHours % 48;
    return nominalConcUM * Math.pow(0.5, cycleH / tHalf);
  }
  // q7d_holiday: 5 days active Q24h dosing (0..120h), then 48h washout holiday (120..168h)
  const weekH = tHours % 168;
  if (weekH < 120) {
    const dayH = weekH % 24;
    return nominalConcUM * Math.pow(0.5, dayH / tHalf);
  }
  const washoutH = weekH - 96; // continues decaying after day 5 dose (given at hour 96)
  return nominalConcUM * Math.pow(0.5, washoutH / tHalf);
}

export function computeExperimentSignature(config: {
  treatmentMechanism: TreatmentMechanism;
  concentrationUM: number;
  resistanceFactor: number;
  initialCancerCells: number;
  durationHours: number;
  calibration: ModelCalibrationParams;
  dosingSchedule?: DosingSchedule;
  secondaryMechanism?: TreatmentMechanism;
  secondaryConcentrationUM?: number;
}): string {
  const baseParts = [
    config.treatmentMechanism,
    config.concentrationUM.toFixed(2),
    config.resistanceFactor.toFixed(2),
    String(config.initialCancerCells),
    String(config.durationHours),
    config.calibration.diffusionRate.toFixed(3),
    config.calibration.bindingAffinity.toFixed(3),
    config.calibration.repairEfficiency.toFixed(3),
    config.calibration.apoptosisThreshold.toFixed(3),
  ];
  if (config.dosingSchedule && config.dosingSchedule !== 'continuous') {
    baseParts.push(config.dosingSchedule);
  }
  if (config.secondaryMechanism && config.secondaryMechanism !== 'untreated_control' && (config.secondaryConcentrationUM ?? 0) > 0) {
    baseParts.push(`${config.secondaryMechanism}@${(config.secondaryConcentrationUM ?? 0).toFixed(2)}`);
  }
  const canonical = baseParts.join('|');

  let h1 = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h1 ^= canonical.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `sig_${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export function getTreatmentDisplayName(mech: TreatmentMechanism): string {
  switch (mech) {
    case 'untreated_control':
      return 'Vehicle / Untreated Control';
    case 'targeted_kinase_inhibitor':
      return 'Targeted Kinase Inhibitor (Small Molecule)';
    case 'cytotoxic_chemotherapy':
      return 'Cytotoxic DNA-Damaging Agent';
    case 'checkpoint_immunotherapy':
      return 'Immune Checkpoint Blockade (T-Cell Effector)';
    case 'hypoxia_activated_prodrug':
      return 'Hypoxia-Activated Tumour Prodrug';
  }
}

function computeMechanismKinematics(
  mech: TreatmentMechanism,
  c: SimCell,
  t: number,
  cal: ModelCalibrationParams
): { selectivity: number; damageFactor: number } {
  if (mech === 'untreated_control') {
    return { selectivity: 0, damageFactor: 0 };
  }
  if (mech === 'targeted_kinase_inhibitor') {
    return {
      selectivity: c.isCancer ? c.receptorDensity * cal.bindingAffinity * 1.45 : 0.06,
      damageFactor: 1.05 * (1 - c.intrinsicResistance * 0.72),
    };
  }
  if (mech === 'cytotoxic_chemotherapy') {
    return {
      selectivity: c.isCancer ? 0.95 * cal.bindingAffinity * 1.2 : 0.28 * cal.bindingAffinity,
      damageFactor: 1.25 * (1 - c.intrinsicResistance * 0.45),
    };
  }
  if (mech === 'checkpoint_immunotherapy') {
    const immuneRamp = Math.max(0, Math.min(1, (t - 6) / 18));
    return {
      selectivity: c.isCancer
        ? cal.immuneClearanceFactor * 2.1 * immuneRamp * (0.85 + 0.3 * (1 - c.hypoxiaLevel))
        : 0.04,
      damageFactor: 1.15 * (1 - c.intrinsicResistance * 0.35),
    };
  }
  // hypoxia_activated_prodrug
  return {
    selectivity: c.isCancer ? (0.35 + 1.45 * c.hypoxiaLevel) * cal.bindingAffinity : 0.05,
    damageFactor: 1.2 * (1 - c.intrinsicResistance * 0.4),
  };
}

export function initBioSimRuntime(config: BioSimConfig): BioSimRuntime {
  const rng = mulberry32(config.seed);
  const cells: SimCell[] = [];
  const cancerCount = Math.max(6, Math.min(80, Math.round(config.initialCancerCells)));
  const healthyCount = Math.max(4, Math.min(40, Math.round(config.initialHealthyCells)));
  const cloneCutoffCount = Math.round(cancerCount * Math.max(0, Math.min(0.65, config.resistantSubcloneFraction ?? 0)));

  // Tumour spheroid core centered around (2.0, 0.0, 0.0)
  for (let i = 0; i < cancerCount; i++) {
    const u = rng();
    const v = rng();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = Math.cbrt(rng()) * 5.8;

    const x = 2.0 + r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta) * 0.78;
    const z = r * Math.cos(phi) * 0.85;
    const distFromCore = Math.sqrt((x - 2.0) ** 2 + y ** 2 + z ** 2);
    const hypoxiaLevel = Math.max(0.08, Math.min(1.0, 1.0 - distFromCore / 6.8));

    const baseRes = Math.max(0.02, Math.min(0.98, config.resistanceFactor + (rng() - 0.5) * 0.22));
    const isResistantClone = cloneCutoffCount > 0 ? i < cloneCutoffCount : baseRes >= 0.52;
    const finalRes =
      cloneCutoffCount > 0 && isResistantClone ? Math.max(baseRes, Math.min(0.95, baseRes + 0.28)) : baseRes;

    cells.push({
      id: `CELL-C${String(i + 1).padStart(3, '0')}`,
      index: i,
      isCancer: true,
      isResistantClone,
      x,
      y,
      z,
      baseRadius: 0.72 + rng() * 0.24,
      state: 'cancer_active',
      intracellularDose: 0,
      stressIndex: 0.04 * rng(),
      apoptoticProgress: 0,
      healthIntegrity: 1,
      receptorDensity: 0.78 + rng() * 0.44,
      intrinsicResistance: finalRes,
      prolifProgress: rng() * 0.7,
      hypoxiaLevel,
      stateEnteredHour: 0,
      phaseOffset: rng() * Math.PI * 2,
    });
  }

  // Healthy stromal & epithelial margin cells surrounding tumour + near microvessel (-9.5)
  for (let j = 0; j < healthyCount; j++) {
    const angle = (j / healthyCount) * Math.PI * 2 + rng() * 0.35;
    const radial = 7.4 + rng() * 4.2;
    const x = Math.max(-10.5, Math.min(11.5, 1.0 + Math.cos(angle) * radial));
    const y = Math.max(-6.2, Math.min(6.2, (rng() - 0.5) * 10.5));
    const z = Math.max(-7.5, Math.min(7.5, Math.sin(angle) * radial * 0.72));

    cells.push({
      id: `CELL-H${String(j + 1).padStart(3, '0')}`,
      index: cancerCount + j,
      isCancer: false,
      x,
      y,
      z,
      baseRadius: 0.64 + rng() * 0.14,
      state: 'healthy',
      intracellularDose: 0,
      stressIndex: 0.01 * rng(),
      apoptoticProgress: 0,
      healthIntegrity: 1,
      receptorDensity: 0.14 + rng() * 0.1,
      intrinsicResistance: 0.55 + rng() * 0.2,
      prolifProgress: 0,
      hypoxiaLevel: 0.08,
      stateEnteredHour: 0,
      phaseOffset: rng() * Math.PI * 2,
    });
  }

  const runtime: BioSimRuntime = {
    config: { ...config, initialCancerCells: cancerCount, initialHealthyCells: healthyCount },
    cells,
    currentHour: 0,
    rng,
    timeSeries: [],
    nextCellIdx: cancerCount + healthyCount,
  };

  runtime.timeSeries.push(computeTimePoint(runtime));
  return runtime;
}

function computeTimePoint(runtime: BioSimRuntime): SimTimePoint {
  const { config, cells, currentHour } = runtime;
  let activeCancerCount = 0;
  let exposedCount = 0;
  let damagedCount = 0;
  let apoptoticCount = 0;
  let eliminatedCount = 0;
  let healthyCount = 0;
  let sensitiveViableCount = 0;
  let resistantViableCount = 0;
  let doseSum = 0;
  let stressSum = 0;
  let cancerTotal = 0;

  for (const c of cells) {
    if (!c.isCancer) {
      if (c.state !== 'eliminated') healthyCount++;
      continue;
    }
    cancerTotal++;
    doseSum += c.intracellularDose;
    stressSum += c.stressIndex;
    const isViable = c.state === 'cancer_active' || c.state === 'treatment_exposed' || c.state === 'stressed_damaged';
    if (isViable) {
      if (c.isResistantClone) resistantViableCount++;
      else sensitiveViableCount++;
    }
    switch (c.state) {
      case 'cancer_active':
        activeCancerCount++;
        break;
      case 'treatment_exposed':
        exposedCount++;
        break;
      case 'stressed_damaged':
        damagedCount++;
        break;
      case 'apoptotic':
        apoptoticCount++;
        break;
      case 'eliminated':
        eliminatedCount++;
        break;
      default:
        break;
    }
  }

  const viableCancerCount = activeCancerCount + exposedCount + damagedCount;
  const denom = Math.max(1, config.initialCancerCells);
  const cellViabilityPct = Number(((viableCancerCount / denom) * 100).toFixed(2));
  const treatmentResponsePct = Number(
    Math.max(0, Math.min(100, ((denom - viableCancerCount) / denom) * 100)).toFixed(2)
  );
  const meanIntracellularDose = Number((doseSum / Math.max(1, cancerTotal)).toFixed(3));
  const meanStressIndex = Number((stressSum / Math.max(1, cancerTotal)).toFixed(3));

  const empiricalBonus = Math.min(0.08, (config.empiricalEvidenceCount ?? 0) * 0.012);
  const kineticSignal = Math.min(0.12, (treatmentResponsePct / 100) * 0.12);
  const rawConfidence =
    config.calibration.confidenceCalibration * 0.88 + kineticSignal + empiricalBonus;
  const confidenceLevel = Number(Math.max(0.25, Math.min(0.98, rawConfidence)).toFixed(3));

  const schedule = config.dosingSchedule ?? 'continuous';
  const tHalf = config.halfLifeHours ?? 18;
  const plasmaConcUM = Number(
    computeSchedulePlasmaConcentration(
      config.treatmentMechanism === 'untreated_control' ? 0 : Math.max(0, config.concentrationUM),
      currentHour,
      schedule,
      tHalf
    ).toFixed(3)
  );
  const secondaryPlasmaConcUM =
    config.secondaryMechanism &&
    config.secondaryMechanism !== 'untreated_control' &&
    (config.secondaryConcentrationUM ?? 0) > 0
      ? Number(
          computeSchedulePlasmaConcentration(
            config.secondaryConcentrationUM ?? 0,
            currentHour,
            schedule,
            tHalf
          ).toFixed(3)
        )
      : 0;

  return {
    step: runtime.timeSeries.length,
    timeHours: currentHour,
    initialCancerPop: config.initialCancerCells,
    viableCancerCount,
    sensitiveViableCount,
    resistantViableCount,
    activeCancerCount,
    exposedCount,
    damagedCount,
    apoptoticCount,
    eliminatedCount,
    healthyCount,
    cellViabilityPct,
    treatmentResponsePct,
    meanIntracellularDose,
    plasmaConcUM,
    secondaryPlasmaConcUM,
    meanStressIndex,
    confidenceLevel,
  };
}

export function stepBioSimRuntime(runtime: BioSimRuntime, dtHours = 1): SimTimePoint {
  const { config, cells, rng } = runtime;
  const cal = config.calibration;
  runtime.currentHour += dtHours;
  const t = runtime.currentHour;

  const schedule = config.dosingSchedule ?? 'continuous';
  const tHalf = config.halfLifeHours ?? 18;

  // Vascular perfusion boundary at x = -11.5; PK plasma clearance modulates effective exposure
  const nominalPrimary = config.treatmentMechanism === 'untreated_control' ? 0 : Math.max(0, config.concentrationUM);
  const effectiveConc = computeSchedulePlasmaConcentration(nominalPrimary, t, schedule, tHalf);
  const perfusionRamp = 1 - Math.exp(-t / 5.5);
  const doseSaturation = effectiveConc / (effectiveConc + 2.2);

  const hasSecondary =
    Boolean(config.secondaryMechanism) &&
    config.secondaryMechanism !== 'untreated_control' &&
    (config.secondaryConcentrationUM ?? 0) > 0;
  const effectiveSecondaryConc = hasSecondary
    ? computeSchedulePlasmaConcentration(config.secondaryConcentrationUM ?? 0, t, schedule, tHalf)
    : 0;
  const secDoseSat = effectiveSecondaryConc / (effectiveSecondaryConc + 2.2);

  const newProliferations: SimCell[] = [];

  for (const c of cells) {
    if (c.state === 'eliminated') continue;

    // Distance from perfusion capillary plane (x = -11.5)
    const distVessel = Math.max(0.5, c.x - -11.5);
    const diffusionFront = Math.max(0.06, Math.min(1, (t * cal.diffusionRate * 1.45) / (distVessel * 0.55 + 1.0)));
    const vesselAtten = Math.exp(-distVessel / (18 * (0.45 + cal.diffusionRate)));
    const spatialField = effectiveConc * perfusionRamp * doseSaturation * diffusionFront * vesselAtten;

    const { selectivity, damageFactor } = computeMechanismKinematics(config.treatmentMechanism, c, t, cal);

    let secondaryUptake = 0;
    let secondaryDamageFactor = 0;
    if (hasSecondary && config.secondaryMechanism) {
      const secField = effectiveSecondaryConc * perfusionRamp * secDoseSat * diffusionFront * vesselAtten;
      const secKin = computeMechanismKinematics(config.secondaryMechanism, c, t, cal);
      // Pathway complementarity synergy when two orthogonal mechanisms hit the same cancer cell
      const orthogonalSynergy =
        c.isCancer && config.secondaryMechanism !== config.treatmentMechanism ? 1.16 : 0.94;
      secondaryUptake = secField * secKin.selectivity * 0.16 * orthogonalSynergy * dtHours;
      secondaryDamageFactor = secKin.damageFactor;
    }

    // Intracellular dose dynamics (uptake vs efflux/clearance)
    const uptake = spatialField * selectivity * 0.16 * dtHours + secondaryUptake;
    const clearance = c.intracellularDose * (0.045 + c.intrinsicResistance * 0.04) * dtHours;
    c.intracellularDose = Math.max(0, Math.min(2.6, c.intracellularDose + uptake - clearance));

    const combinedDamageMult = hasSecondary
      ? (damageFactor * (effectiveConc / Math.max(1e-6, effectiveConc + effectiveSecondaryConc)) +
          secondaryDamageFactor * (effectiveSecondaryConc / Math.max(1e-6, effectiveConc + effectiveSecondaryConc))) *
        (c.isCancer && config.secondaryMechanism !== config.treatmentMechanism ? 1.12 : 1.0)
      : damageFactor;

    // Stress & DNA damage accumulation vs repair
    const damageGain = c.intracellularDose * cal.dnaDamageWeight * combinedDamageMult * 0.14 * dtHours;
    const repairLoss =
      (c.isCancer ? cal.repairEfficiency : cal.repairEfficiency * 1.65) *
      (0.05 + 0.04 * (1 - Math.min(1, c.stressIndex))) *
      dtHours;
    c.stressIndex = Math.max(0, Math.min(1.0, c.stressIndex + damageGain - repairLoss));

    if (!c.isCancer) {
      // Healthy tissue preservation vs excessive cytotoxic off-target toxicity
      if (c.stressIndex > 0.72) {
        c.state = 'stressed_damaged';
        c.healthIntegrity = Math.max(0.2, c.healthIntegrity - 0.04 * dtHours);
      } else if (c.stressIndex > 0.35) {
        c.state = 'treatment_exposed';
      } else {
        c.state = 'healthy';
        c.healthIntegrity = Math.min(1, c.healthIntegrity + 0.02 * dtHours);
      }
      continue;
    }

    // Cancer cell 6-state progression
    if (c.state === 'apoptotic') {
      c.apoptoticProgress = Math.min(1, c.apoptoticProgress + (0.11 + 0.04 * rng()) * dtHours);
      c.healthIntegrity = Math.max(0, 1 - c.apoptoticProgress);
      if (c.apoptoticProgress >= 1.0) {
        c.state = 'eliminated';
        c.stateEnteredHour = t;
      }
      continue;
    }

    if (c.stressIndex >= cal.apoptosisThreshold) {
      c.state = 'apoptotic';
      c.stateEnteredHour = t;
      c.apoptoticProgress = 0.08;
      continue;
    }

    if (c.stressIndex >= 0.35) {
      if (c.state !== 'stressed_damaged') c.stateEnteredHour = t;
      c.state = 'stressed_damaged';
      c.healthIntegrity = Math.max(0.25, 1 - c.stressIndex * 0.65);
    } else if (c.intracellularDose >= 0.14) {
      if (c.state !== 'treatment_exposed') c.stateEnteredHour = t;
      c.state = 'treatment_exposed';
    } else {
      c.state = 'cancer_active';
      c.healthIntegrity = Math.min(1, c.healthIntegrity + 0.015 * dtHours);
      // Active uninhibited cancer cells proliferate slowly (capped to keep 3D density tractable)
      if (cells.length + newProliferations.length < 96) {
        c.prolifProgress += (0.014 + 0.008 * rng()) * (1 - Math.min(0.9, c.intracellularDose * 2)) * dtHours;
        if (c.prolifProgress >= 1.0) {
          c.prolifProgress = 0;
          const jitter = () => (rng() - 0.5) * 1.4;
          const nx = Math.max(-7, Math.min(9.5, c.x + jitter()));
          const ny = Math.max(-6, Math.min(6, c.y + jitter()));
          const nz = Math.max(-7, Math.min(7, c.z + jitter()));
          const idx = runtime.nextCellIdx++;
          newProliferations.push({
            id: `CELL-C${String(idx + 1).padStart(3, '0')}`,
            index: idx,
            isCancer: true,
            isResistantClone: c.isResistantClone,
            x: nx,
            y: ny,
            z: nz,
            baseRadius: c.baseRadius * (0.92 + rng() * 0.14),
            state: 'cancer_active',
            intracellularDose: c.intracellularDose * 0.5,
            stressIndex: 0.02,
            apoptoticProgress: 0,
            healthIntegrity: 1,
            receptorDensity: Math.max(0.5, Math.min(1.25, c.receptorDensity + (rng() - 0.5) * 0.12)),
            intrinsicResistance: Math.min(0.98, c.intrinsicResistance + rng() * 0.04),
            prolifProgress: 0,
            hypoxiaLevel: c.hypoxiaLevel,
            stateEnteredHour: t,
            phaseOffset: rng() * Math.PI * 2,
          });
        }
      }
    }
  }

  for (const child of newProliferations) {
    cells.push(child);
  }

  const point = computeTimePoint(runtime);
  runtime.timeSeries.push(point);
  return point;
}

export function runDeterministicBioSimulation(
  config: BioSimConfig,
  options?: { skipSynergyEval?: boolean }
): BioSimResult {
  const runtime = initBioSimRuntime(config);
  const steps = Math.max(12, Math.min(240, Math.round(config.durationHours)));
  for (let h = 0; h < steps; h++) {
    stepBioSimRuntime(runtime, 1);
  }

  const last = runtime.timeSeries[runtime.timeSeries.length - 1];
  const aucResponse = Number(
    (
      runtime.timeSeries.reduce((acc, pt) => acc + pt.treatmentResponsePct, 0) /
      Math.max(1, runtime.timeSeries.length)
    ).toFixed(2)
  );
  const healthyPreservationPct = Number(
    ((last.healthyCount / Math.max(1, config.initialHealthyCells)) * 100).toFixed(1)
  );

  let synergyMetrics: CombinationSynergyMetrics | undefined;
  const hasSecondary =
    !options?.skipSynergyEval &&
    Boolean(config.secondaryMechanism) &&
    config.secondaryMechanism !== 'untreated_control' &&
    (config.secondaryConcentrationUM ?? 0) > 0;

  if (hasSecondary && config.secondaryMechanism) {
    const baseA = runDeterministicBioSimulation(
      {
        ...config,
        secondaryMechanism: undefined,
        secondaryAgent: undefined,
        secondaryConcentrationUM: 0,
      },
      { skipSynergyEval: true }
    );
    const baseB = runDeterministicBioSimulation(
      {
        ...config,
        treatmentMechanism: config.secondaryMechanism,
        treatmentAgent: config.secondaryAgent || getTreatmentDisplayName(config.secondaryMechanism),
        concentrationUM: config.secondaryConcentrationUM ?? 0,
        secondaryMechanism: undefined,
        secondaryAgent: undefined,
        secondaryConcentrationUM: 0,
      },
      { skipSynergyEval: true }
    );
    const ea = Math.max(0, Math.min(1, baseA.finalMetrics.treatmentResponsePct / 100));
    const eb = Math.max(0, Math.min(1, baseB.finalMetrics.treatmentResponsePct / 100));
    const eab = Math.max(0, Math.min(1, last.treatmentResponsePct / 100));
    const blissExp = ea + eb - ea * eb;
    const blissExpectedPct = Number((blissExp * 100).toFixed(2));
    const blissExcessPct = Number(((eab - blissExp) * 100).toFixed(2));
    const loeweCI = Number(
      Math.max(0.2, Math.min(2.5, blissExp > 0.02 ? blissExp / Math.max(0.02, eab + (blissExcessPct > 0 ? 0.08 : 0)) : 1.0)).toFixed(3)
    );
    const classification: CombinationSynergyMetrics['classification'] =
      blissExcessPct >= 3.0 ? 'synergistic' : blissExcessPct <= -3.0 ? 'sub_additive' : 'additive';

    synergyMetrics = {
      primaryAloneViabilityPct: baseA.finalMetrics.cellViabilityPct,
      secondaryAloneViabilityPct: baseB.finalMetrics.cellViabilityPct,
      combinedViabilityPct: last.cellViabilityPct,
      primaryInhibitionFrac: Number(ea.toFixed(3)),
      secondaryInhibitionFrac: Number(eb.toFixed(3)),
      observedInhibitionPct: last.treatmentResponsePct,
      blissExpectedPct,
      blissExcessPct,
      loeweCombinationIndex: loeweCI,
      classification,
    };
  }

  // Scientific acceptance criterion: meaningful viability reduction (< 35% viable cancer remaining)
  // while preserving healthy margin (>= 80%)
  const criterionPassed =
    config.treatmentMechanism !== 'untreated_control' &&
    last.cellViabilityPct <= 35 &&
    healthyPreservationPct >= 80;

  const finalMetrics: BioSimFinalMetrics = {
    initialCancerPop: config.initialCancerCells,
    initialHealthyPop: config.initialHealthyCells,
    finalViableCancer: last.viableCancerCount,
    finalSensitiveViable: last.sensitiveViableCount ?? last.viableCancerCount,
    finalResistantViable: last.resistantViableCount ?? 0,
    finalActiveCancer: last.activeCancerCount,
    finalExposed: last.exposedCount,
    finalDamaged: last.damagedCount,
    finalApoptotic: last.apoptoticCount,
    finalEliminated: last.eliminatedCount,
    finalHealthyCount: last.healthyCount,
    cellViabilityPct: last.cellViabilityPct,
    treatmentResponsePct: last.treatmentResponsePct,
    healthyPreservationPct,
    aucResponse,
    evidenceSupportedConfidence: last.confidenceLevel,
    criterionPassed,
    evaluationSummary: criterionPassed
      ? `Computational criterion satisfied: viable cancer fraction reduced to ${last.cellViabilityPct}% (AUC response ${aucResponse}%) with ${healthyPreservationPct}% healthy tissue preserved.`
      : config.treatmentMechanism === 'untreated_control'
      ? `Untreated vehicle baseline maintained ${last.cellViabilityPct}% tumour viability over ${steps}h.`
      : `Computational criterion unmet: residual viable cancer fraction ${last.cellViabilityPct}% (> 35% threshold) or healthy preservation ${healthyPreservationPct}% (< 80%).`,
    synergyMetrics,
  };

  return {
    config: runtime.config,
    signatureHash: computeExperimentSignature(runtime.config),
    timeSeries: runtime.timeSeries,
    finalMetrics,
    finalCells: runtime.cells,
  };
}

