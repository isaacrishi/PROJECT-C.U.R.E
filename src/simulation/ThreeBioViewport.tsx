import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  X,
  ZoomIn,
} from 'lucide-react';
import type { CellLifecycleState, TreatmentMechanism } from '../types';
import type { SimCell } from './bioSimCore';

interface ThreeBioViewportProps {
  cells: SimCell[];
  currentHour: number;
  durationHours: number;
  treatmentMechanism: TreatmentMechanism;
  concentrationUM: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onTogglePlay: () => void;
  onStepHour: () => void;
  onReset: () => void;
  onChangeSpeed: (speed: number) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  selectedCellId: string | null;
  onSelectCell: (cell: SimCell | null) => void;
  secondaryMechanism?: TreatmentMechanism | 'none';
  secondaryConcentrationUM?: number;
}

const STATE_VISUALS: Record<
  CellLifecycleState,
  {
    label: string;
    ultrastructureNote: string;
    membraneHex: number;
    nucleusHex: number;
    nucleolusHex: number;
    chromatinHex: number;
    mitoHex: number;
    erHex: number;
    emissiveHex: number;
    dotClass: string;
  }
> = {
  healthy: {
    label: 'Healthy / Unaffected',
    ultrastructureNote: 'Intact phospholipid bilayer, polarized cristae, smooth nuclear lamina & euchromatin',
    membraneHex: 0x14b8a6,
    nucleusHex: 0x0f766e,
    nucleolusHex: 0x5eead4,
    chromatinHex: 0x2dd4bf,
    mitoHex: 0x10b981,
    erHex: 0x0d9488,
    emissiveHex: 0x042f2e,
    dotClass: 'bg-teal-400',
  },
  cancer_active: {
    label: 'Active Cancer Cell',
    ultrastructureNote: 'Pleomorphic microvilli membrane, hypertrophic nucleolus, hyper-proliferative chromatin',
    membraneHex: 0xf97316,
    nucleusHex: 0x9a3412,
    nucleolusHex: 0xfdba74,
    chromatinHex: 0xfb923c,
    mitoHex: 0xf59e0b,
    erHex: 0xea580c,
    emissiveHex: 0x431407,
    dotClass: 'bg-orange-500',
  },
  treatment_exposed: {
    label: 'Treatment-Exposed',
    ultrastructureNote: 'Ligand-bound transmembrane receptors, endocytic uptake vesicles, early nuclear stress',
    membraneHex: 0x22d3ee,
    nucleusHex: 0x0369a1,
    nucleolusHex: 0x7dd3fc,
    chromatinHex: 0x38bdf8,
    mitoHex: 0x0ea5e9,
    erHex: 0x0284c7,
    emissiveHex: 0x083344,
    dotClass: 'bg-cyan-400',
  },
  stressed_damaged: {
    label: 'Cellular Stress / Damage',
    ultrastructureNote: 'Mitochondrial membrane depolarization, ER dilation, gamma-H2AX DNA break foci',
    membraneHex: 0xeab308,
    nucleusHex: 0x854d0e,
    nucleolusHex: 0xfde047,
    chromatinHex: 0xfacc15,
    mitoHex: 0xf97316,
    erHex: 0xca8a04,
    emissiveHex: 0x422006,
    dotClass: 'bg-yellow-400',
  },
  apoptotic: {
    label: 'Apoptotic / Cell Death',
    ultrastructureNote: 'Zeiosis membrane blebbing, chromatin pyknosis/karyorrhexis, mitochondrial collapse',
    membraneHex: 0xf43f5e,
    nucleusHex: 0x881337,
    nucleolusHex: 0xfda4af,
    chromatinHex: 0xfb7185,
    mitoHex: 0xe11d48,
    erHex: 0xbe123c,
    emissiveHex: 0x4c0519,
    dotClass: 'bg-rose-500',
  },
  eliminated: {
    label: 'Eliminated / Inactive',
    ultrastructureNote: 'Cleared apoptotic bodies & collapsed cytoskeletal ghost remnant',
    membraneHex: 0x475569,
    nucleusHex: 0x1e293b,
    nucleolusHex: 0x64748b,
    chromatinHex: 0x334155,
    mitoHex: 0x334155,
    erHex: 0x1e293b,
    emissiveHex: 0x020617,
    dotClass: 'bg-slate-600',
  },
};

/**
 * Generates adaptive UHD biological membrane maps:
 * - Multi-octave lipid bilayer micro-domains + caveolae pits + cytoskeleton striations
 * - Tangent-space Sobel normal map for crisp ultrastructural surface relief at 10,000x zoom
 * - Roughness map differentiating glossy lipid rafts from rough glycoprotein glycocalyx
 * Safely downscales to 512px on software WebGL so headless/VDI remains responsive.
 */
function createAdaptiveUhdBioTextures(texSize: number, maxAnisotropy: number) {
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = texSize;
  albedoCanvas.height = texSize;
  const aCtx = albedoCanvas.getContext('2d')!;
  const aImg = aCtx.createImageData(texSize, texSize);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = texSize;
  roughCanvas.height = texSize;
  const rCtx = roughCanvas.getContext('2d')!;
  const rImg = rCtx.createImageData(texSize, texSize);

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = texSize;
  normalCanvas.height = texSize;
  const nCtx = normalCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(texSize, texSize);

  // Heightfield float buffer for fast Sobel normal derivation
  const heightBuf = new Float32Array(texSize * texSize);
  const twoPi = Math.PI * 2;
  const invSize = 1 / texSize;

  for (let y = 0; y < texSize; y++) {
    const v = y * invSize;
    const ay = v * twoPi;
    for (let x = 0; x < texSize; x++) {
      const u = x * invSize;
      const ax = u * twoPi;

      // Multi-frequency tileable organic membrane patterns (lipid rafts + microvilli + cytoskeleton)
      const w1 = Math.sin(ax * 6 + Math.cos(ay * 5) * 1.1) * Math.cos(ay * 6 + Math.sin(ax * 4) * 1.1);
      const w2 = Math.sin(ax * 19 + ay * 13) * Math.cos(ax * 11 - ay * 17) * 0.55;
      const w3 = Math.sin(ax * 47 + Math.sin(ay * 43) * 1.6) * 0.25;
      const microGrain = Math.sin(ax * 97 + ay * 89) * Math.cos(ax * 83 - ay * 101) * 0.14;

      const h = Math.max(0, Math.min(1, 0.5 + w1 * 0.24 + w2 * 0.18 + w3 * 0.12 + microGrain));
      const idx = y * texSize + x;
      heightBuf[idx] = h;

      const p = idx * 4;
      // Albedo: pearlescent membrane highlight at lipid raft ridges
      const lum = Math.round(196 + h * 58);
      const blueShift = Math.round(212 + h * 43);
      aImg.data[p] = lum;
      aImg.data[p + 1] = Math.min(255, lum + 10);
      aImg.data[p + 2] = Math.min(255, blueShift);
      aImg.data[p + 3] = 255;

      // Roughness: hydrophobic lipid rafts smoother (darker) vs glycocalyx clefts rougher (brighter)
      const roughByte = Math.round(52 + (1 - h) * 155);
      rImg.data[p] = roughByte;
      rImg.data[p + 1] = roughByte;
      rImg.data[p + 2] = roughByte;
      rImg.data[p + 3] = 255;
    }
  }

  // Compute tileable Sobel normal map
  const strength = 3.2;
  for (let y = 0; y < texSize; y++) {
    const ym1 = (y - 1 + texSize) % texSize;
    const yp1 = (y + 1) % texSize;
    for (let x = 0; x < texSize; x++) {
      const xm1 = (x - 1 + texSize) % texSize;
      const xp1 = (x + 1) % texSize;

      const tl = heightBuf[ym1 * texSize + xm1];
      const t = heightBuf[ym1 * texSize + x];
      const tr = heightBuf[ym1 * texSize + xp1];
      const l = heightBuf[y * texSize + xm1];
      const r = heightBuf[y * texSize + xp1];
      const bl = heightBuf[yp1 * texSize + xm1];
      const b = heightBuf[yp1 * texSize + x];
      const br = heightBuf[yp1 * texSize + xp1];

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);

      const p = (y * texSize + x) * 4;
      nImg.data[p] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      nImg.data[p + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      nImg.data[p + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      nImg.data[p + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  nCtx.putImageData(nImg, 0, 0);

  const configureTex = (canvas: HTMLCanvasElement, isColor: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    albedoTex: configureTex(albedoCanvas, true),
    roughTex: configureTex(roughCanvas, false),
    normalTex: configureTex(normalCanvas, false),
  };
}

/**
 * Generates organic sculpted sphere geometries matching distinct pathological states:
 * - healthy: smooth physiological oblate spheroid
 * - cancer: ruffled microvilli / pseudopodial protrusions
 * - apoptotic: deep lobulated zeiosis apoptotic membrane blebbing
 */
function buildSculptedMembraneGeo(mode: 'healthy' | 'cancer' | 'apoptotic', detailSegments = 48): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, detailSegments, Math.round(detailSegments * 0.75));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let disp = 1.0;
    if (mode === 'healthy') {
      disp = 1.0 + Math.sin(x * 3.1 + y * 2.7) * 0.025;
      pos.setXYZ(i, x * disp * 1.04, y * disp * 0.92, z * disp * 1.04);
    } else if (mode === 'cancer') {
      const microvilli = Math.sin(x * 11 + y * 9) * Math.cos(z * 11 - x * 7) * 0.075;
      const lobe = Math.sin(x * 3.2 - z * 2.8) * 0.08;
      disp = 1.0 + lobe + microvilli;
      pos.setXYZ(i, x * disp, y * disp, z * disp);
    } else {
      // Apoptotic membrane blebbing
      const blebA = Math.max(0, Math.sin(x * 4.5 + y * 3.8) * Math.cos(z * 4.2));
      const blebB = Math.max(0, Math.cos(x * 6.0 - z * 5.2) * Math.sin(y * 5.4));
      disp = 0.84 + blebA * 0.34 + blebB * 0.22;
      pos.setXYZ(i, x * disp, y * disp, z * disp);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function buildErythrocyteGeo(): THREE.BufferGeometry {
  // Biconcave biconnected red blood cell profile rotated cleanly around Y
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = (i / 14) * Math.PI;
    const r = Math.sin(t) * 0.16;
    const yHalf = (0.022 + 0.045 * Math.pow(Math.sin(t), 2.2)) * Math.cos(t);
    pts.push(new THREE.Vector2(Math.max(0.001, r), yHalf));
  }
  const geo = new THREE.LatheGeometry(pts, 16);
  geo.computeVertexNormals();
  return geo;
}

interface CellMeshEntry {
  group: THREE.Group;
  membrane: THREE.Mesh;
  membraneMat: THREE.MeshPhysicalMaterial;
  nucleusGroup: THREE.Group;
  nucleusEnvelope: THREE.Mesh;
  nucleusMat: THREE.MeshPhysicalMaterial;
  nuclearPores: THREE.Mesh[];
  poreMat: THREE.MeshStandardMaterial;
  nucleolus: THREE.Mesh;
  nucleolusMat: THREE.MeshStandardMaterial;
  chromatinA: THREE.Mesh;
  chromatinB: THREE.Mesh;
  chromatinMat: THREE.MeshStandardMaterial;
  dnaBreakFoci: THREE.Mesh[];
  dnaBreakMat: THREE.MeshStandardMaterial;
  mitochondria: THREE.Group[];
  mitoMat: THREE.MeshStandardMaterial;
  erRibbon: THREE.Mesh;
  erMat: THREE.MeshStandardMaterial;
  golgiStack: THREE.Group;
  actinFibers: THREE.Mesh[];
  actinMat: THREE.MeshStandardMaterial;
  receptors: THREE.Group[];
  boundLigands: THREE.Mesh[];
  ligandMat: THREE.MeshStandardMaterial;
  cellId: string;
}

function distanceToMagnification(dist: number): number {
  // Smooth biomedical optical scale calibration:
  // dist >= 42   -> 100x (macroscopic tissue bed)
  // dist = 0.84  -> 5,000x (single-cell organelle cross section)
  // dist = 0.42  -> 10,000x (sub-cellular ultrastructure)
  const clamped = Math.max(0.42, Math.min(42, dist));
  const t = (Math.log(42) - Math.log(clamped)) / (Math.log(42) - Math.log(0.42));
  return Math.round(100 * Math.pow(100, t));
}

function magnificationToScaleLabel(mag: number): { label: string; barPx: number } {
  if (mag >= 7500) return { label: '500 nm', barPx: 64 };
  if (mag >= 3500) return { label: '1 µm', barPx: 56 };
  if (mag >= 1200) return { label: '5 µm', barPx: 52 };
  if (mag >= 450) return { label: '20 µm', barPx: 48 };
  return { label: '100 µm', barPx: 44 };
}

export const ThreeBioViewport: React.FC<ThreeBioViewportProps> = ({
  cells,
  currentHour,
  durationHours,
  treatmentMechanism,
  concentrationUM,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onStepHour,
  onReset,
  onChangeSpeed,
  isFullscreen,
  onToggleFullscreen,
  selectedCellId,
  onSelectCell,
  secondaryMechanism = 'none',
  secondaryConcentrationUM = 0,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [cutawayMode, setCutawayMode] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<'overview' | 'core' | 'vessel' | 'ultra'>('overview');
  const [magnificationX, setMagnificationX] = useState<number>(215);
  const [renderProfileLabel, setRenderProfileLabel] = useState<string>('UHD Hardware PBR');
  const [contextLost, setContextLost] = useState(false);

  const latestRef = useRef({
    cells,
    currentHour,
    treatmentMechanism,
    concentrationUM,
    secondaryMechanism,
    secondaryConcentrationUM,
    selectedCellId,
    onSelectCell,
    cutawayMode,
  });
  latestRef.current = {
    cells,
    currentHour,
    treatmentMechanism,
    concentrationUM,
    secondaryMechanism,
    secondaryConcentrationUM,
    selectedCellId,
    onSelectCell,
    cutawayMode,
  };

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const flyTargetRef = useRef<{ camPos: THREE.Vector3; targetPos: THREE.Vector3 } | null>(null);

  const startSmoothFly = (camPos: THREE.Vector3, targetPos: THREE.Vector3) => {
    flyTargetRef.current = { camPos: camPos.clone(), targetPos: targetPos.clone() };
  };

  const focusCellAtMagnification = (cell: SimCell, targetDist: number) => {
    setCameraPreset('ultra');
    const center = new THREE.Vector3(cell.x, cell.y, cell.z);
    const camPos = new THREE.Vector3(cell.x + targetDist * 0.42, cell.y + targetDist * 0.28, cell.z + targetDist * 0.86);
    startSmoothFly(camPos, center);
  };

  const applyCameraPreset = (preset: 'overview' | 'core' | 'vessel') => {
    setCameraPreset(preset);
    if (preset === 'overview') {
      startSmoothFly(new THREE.Vector3(0.5, 9.5, 22.5), new THREE.Vector3(0.5, 0, 0));
    } else if (preset === 'core') {
      startSmoothFly(new THREE.Vector3(2.2, 3.2, 11.5), new THREE.Vector3(2.0, 0, 0));
    } else {
      startSmoothFly(new THREE.Vector3(-7.5, 4.5, 13.5), new THREE.Vector3(-9.5, 0, 0));
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 560;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : '';
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);

    const maxTexSize = renderer.capabilities.maxTextureSize || 2048;
    const maxAniso = isSoftwareGl ? 1 : Math.min(16, renderer.capabilities.getMaxAnisotropy() || 4);
    const adaptiveTexSize = isSoftwareGl ? 512 : Math.min(4096, maxTexSize);

    setRenderProfileLabel(
      isSoftwareGl
        ? 'Software WebGL Balanced'
        : `8K-Ready UHD PBR (${adaptiveTexSize}px Normal/Rough · ${maxAniso}x AF)`
    );

    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050911);
    scene.fog = new THREE.FogExp2(0x050911, 0.014);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.65;
    roomEnv.dispose();

    // near=0.02 enables 10,000x sub-cellular zoom without clipping organelles
    const camera = new THREE.PerspectiveCamera(44, width / height, 0.02, 130);
    camera.position.set(0.5, 9.5, 22.5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.autoRotate = false;
    controls.minDistance = 0.42; // 10,000x optical ultrastructure magnification
    controls.maxDistance = 42;
    controls.zoomSpeed = 1.15;
    controls.target.set(0.5, 0, 0);
    controls.update();
    controlsRef.current = controls;

    // Never fight manual user dragging/zooming during scripted camera fly
    controls.addEventListener('start', () => {
      flyTargetRef.current = null;
    });

    // Studio Biomedical Chamber Lighting (Warm/Cool Key-Rim-Fill)
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x091322, 0.72);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.0);
    keyLight.position.set(14, 20, 16);
    keyLight.castShadow = !isSoftwareGl;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x2dd4bf, 1.05);
    rimLight.position.set(-16, 6, -14);
    scene.add(rimLight);

    const vesselLight = new THREE.PointLight(0xf43f5e, 1.6, 26);
    vesselLight.position.set(-12.0, 0, 0);
    scene.add(vesselLight);

    const gridHelper = new THREE.GridHelper(32, 32, 0x164e63, 0x0f172a);
    gridHelper.position.y = -7.2;
    scene.add(gridHelper);

    const { albedoTex, roughTex, normalTex } = createAdaptiveUhdBioTextures(adaptiveTexSize, maxAniso);

    // High-subdivision shared cell anatomy geometries
    const segDetail = isSoftwareGl ? 28 : 48;
    const healthyMembraneGeo = buildSculptedMembraneGeo('healthy', segDetail);
    const cancerMembraneGeo = buildSculptedMembraneGeo('cancer', segDetail);
    const apoptoticMembraneGeo = buildSculptedMembraneGeo('apoptotic', segDetail);

    const nucleusGeo = new THREE.IcosahedronGeometry(0.42, 3);
    const npcGeo = new THREE.TorusGeometry(0.036, 0.01, 6, 8);
    const nucleolusGeo = new THREE.SphereGeometry(0.145, 20, 16);
    const chromatinGeo = new THREE.TorusKnotGeometry(0.22, 0.024, 54, 8, 2, 3);
    const dnaFocusGeo = new THREE.OctahedronGeometry(0.042, 1);
    const mitoBodyGeo = new THREE.CapsuleGeometry(0.055, 0.13, 6, 12);
    const mitoCristaeGeo = new THREE.TorusGeometry(0.058, 0.008, 6, 16);
    const erRibbonGeo = new THREE.TorusGeometry(0.51, 0.025, 10, 28, Math.PI * 1.15);
    const golgiArcGeo = new THREE.TorusGeometry(0.2, 0.016, 6, 18, Math.PI * 0.72);
    const actinFiberGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.5, 5);
    const receptorStalkGeo = new THREE.CylinderGeometry(0.016, 0.022, 0.14, 8);
    const receptorHeadGeo = new THREE.SphereGeometry(0.036, 10, 8);
    const ligandGeo = new THREE.DodecahedronGeometry(0.038, 0);

    const receptorMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.35,
      metalness: 0.45,
    });

    const ringGeo = new THREE.TorusGeometry(1.3, 0.028, 12, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.visible = false;
    scene.add(selectionRing);

    // ECM Collagen Stroma Filaments
    const ecmGroup = new THREE.Group();
    const ecmMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a4c,
      roughness: 0.72,
      metalness: 0.06,
      normalMap: normalTex,
      transparent: true,
      opacity: 0.46,
    });
    const ecmGeos: THREE.BufferGeometry[] = [];
    for (let f = 0; f < 16; f++) {
      const zOff = -6.5 + (f / 15) * 13;
      const yOff = Math.sin(f * 1.3) * 4.8;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-12.5, yOff - 1.2, zOff),
        new THREE.Vector3(-4.0, yOff + Math.cos(f) * 2.1, zOff * 0.85),
        new THREE.Vector3(4.5, yOff - Math.sin(f) * 1.9, zOff * 0.9),
        new THREE.Vector3(12.2, yOff + 1.0, zOff),
      ]);
      const tGeo = new THREE.TubeGeometry(curve, 28, 0.036, 8, false);
      ecmGeos.push(tGeo);
      ecmGroup.add(new THREE.Mesh(tGeo, ecmMat));
    }
    scene.add(ecmGroup);

    // Perfusing Vascular Microvessel + Intraluminal Flowing Erythrocytes & Drug Tracers
    const vesselCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-12.2, -7.2, -5.0),
      new THREE.Vector3(-11.6, -2.5, -1.5),
      new THREE.Vector3(-12.0, 2.8, 1.8),
      new THREE.Vector3(-11.5, 7.2, 4.8),
    ]);
    const vesselGeo = new THREE.TubeGeometry(vesselCurve, 36, 0.54, 16, false);
    const vesselMat = new THREE.MeshPhysicalMaterial({
      color: 0xbe123c,
      emissive: 0x4c0519,
      emissiveIntensity: 0.55,
      normalMap: normalTex,
      roughness: 0.32,
      metalness: 0.05,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(vesselGeo, vesselMat));

    const RBC_COUNT = 28;
    const rbcGeo = buildErythrocyteGeo();
    const rbcMat = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      emissive: 0x881337,
      emissiveIntensity: 0.42,
      roughness: 0.34,
      metalness: 0.08,
    });
    const rbcMesh = new THREE.InstancedMesh(rbcGeo, rbcMat, RBC_COUNT);
    rbcMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(rbcMesh);

    const TRACER_COUNT = 20;
    const tracerGeo = new THREE.SphereGeometry(0.065, 8, 8);
    const tracerMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    const tracerMesh = new THREE.InstancedMesh(tracerGeo, tracerMat, TRACER_COUNT);
    tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(tracerMesh);

    // Extracellular Diffusion Wavefront Plane (propagating from vessel into tumour bed)
    const waveGeo = new THREE.CylinderGeometry(0.06, 0.06, 13.5, 16, 1, true);
    const waveMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const waveMesh = new THREE.Mesh(waveGeo, waveMat);
    waveMesh.rotation.x = Math.PI / 2;
    waveMesh.position.set(-11.5, 0, 0);
    waveMesh.visible = false;
    scene.add(waveMesh);

    // Therapeutic Agent Particle Field (InstancedMesh)
    const PARTICLE_COUNT = 260;
    const particleGeo = new THREE.OctahedronGeometry(0.1, 1);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.2,
      roughness: 0.22,
      metalness: 0.25,
    });
    const particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(particleMesh);

    const pSeeds = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      offset: (i / PARTICLE_COUNT) * Math.PI * 2,
      ySpread: (((i * 73) % 100) / 100 - 0.5) * 11.5,
      zSpread: (((i * 137) % 100) / 100 - 0.5) * 13.0,
      speed: 0.65 + ((i * 31) % 100) / 140,
    }));

    // Secondary Combination Agent Particle Field
    const SEC_PARTICLE_COUNT = 120;
    const secParticleGeo = new THREE.TetrahedronGeometry(0.085, 0);
    const secParticleMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      emissive: 0x9333ea,
      emissiveIntensity: 1.25,
      roughness: 0.24,
      metalness: 0.3,
    });
    const secParticleMesh = new THREE.InstancedMesh(secParticleGeo, secParticleMat, SEC_PARTICLE_COUNT);
    secParticleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(secParticleMesh);

    const secPSeeds = Array.from({ length: SEC_PARTICLE_COUNT }, (_, i) => ({
      offset: ((i + 0.5) / SEC_PARTICLE_COUNT) * Math.PI * 2,
      ySpread: (((i * 59) % 100) / 100 - 0.5) * 11.2,
      zSpread: (((i * 113) % 100) / 100 - 0.5) * 12.6,
      speed: 0.7 + ((i * 41) % 100) / 130,
    }));

    // Intracellular Drug Uptake & Endosomal Vesicles (Single InstancedMesh draw call across all cells)
    const MAX_VESICLES = 480;
    const vesicleGeo = new THREE.SphereGeometry(0.036, 8, 6);
    const vesicleMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.35,
      roughness: 0.25,
      metalness: 0.15,
    });
    const vesicleMesh = new THREE.InstancedMesh(vesicleGeo, vesicleMat, MAX_VESICLES);
    vesicleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(vesicleMesh);

    // Apoptotic Extracellular Debris Bodies (budding vesicles around apoptotic/eliminated cells)
    const MAX_DEBRIS = 240;
    const debrisGeo = new THREE.IcosahedronGeometry(0.068, 1);
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0x881337,
      emissiveIntensity: 0.6,
      roughness: 0.45,
    });
    const debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, MAX_DEBRIS);
    debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(debrisMesh);

    // Hypoxia Core Bioactivation Field (distal hypoxic tumour niche)
    const hypoxiaZoneGeo = new THREE.SphereGeometry(5.2, 24, 18);
    const hypoxiaZoneMat = new THREE.MeshBasicMaterial({
      color: 0x14b8a6,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    });
    const hypoxiaZoneMesh = new THREE.Mesh(hypoxiaZoneGeo, hypoxiaZoneMat);
    hypoxiaZoneMesh.position.set(4.5, 0, 0);
    hypoxiaZoneMesh.visible = false;
    scene.add(hypoxiaZoneMesh);

    const cellEntries = new Map<string, CellMeshEntry>();
    const cellsGroup = new THREE.Group();
    scene.add(cellsGroup);

    const getOrCreateCellEntry = (cell: SimCell): CellMeshEntry => {
      const existing = cellEntries.get(cell.id);
      if (existing) return existing;

      const vis = STATE_VISUALS[cell.state];
      const group = new THREE.Group();
      group.position.set(cell.x, cell.y, cell.z);
      group.userData = { cellId: cell.id };

      // Outer plasma membrane (Physical PBR with Normal + Roughness maps, semi-translucent so 10K zoom sees organelles)
      const membraneMat = new THREE.MeshPhysicalMaterial({
        color: vis.membraneHex,
        emissive: vis.emissiveHex,
        emissiveIntensity: 0.35,
        map: albedoTex,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: roughTex,
        roughness: 0.32,
        metalness: 0.04,
        transmission: isSoftwareGl ? 0 : 0.34,
        thickness: 0.65,
        ior: 1.38,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        clearcoat: 0.55,
        clearcoatRoughness: 0.22,
      });

      const initialGeo = !cell.isCancer
        ? healthyMembraneGeo
        : cell.state === 'apoptotic' || cell.state === 'eliminated'
        ? apoptoticMembraneGeo
        : cancerMembraneGeo;

      const membrane = new THREE.Mesh(initialGeo, membraneMat);
      membrane.renderOrder = 2;
      membrane.userData = { cellId: cell.id };
      group.add(membrane);

      // Nuclear envelope + Chromatin + Nucleolus + DNA Damage Foci
      const nucleusGroup = new THREE.Group();
      nucleusGroup.userData = { cellId: cell.id };

      const nucleusMat = new THREE.MeshPhysicalMaterial({
        color: vis.nucleusHex,
        emissive: vis.emissiveHex,
        emissiveIntensity: 0.3,
        normalMap: normalTex,
        roughness: 0.4,
        metalness: 0.06,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      });
      const nucleusEnvelope = new THREE.Mesh(nucleusGeo, nucleusMat);
      nucleusEnvelope.renderOrder = 1;
      nucleusEnvelope.userData = { cellId: cell.id };
      nucleusGroup.add(nucleusEnvelope);

      const nucleolusMat = new THREE.MeshStandardMaterial({
        color: vis.nucleolusHex,
        emissive: vis.emissiveHex,
        emissiveIntensity: 0.45,
        roughness: 0.5,
      });
      const nucleolus = new THREE.Mesh(nucleolusGeo, nucleolusMat);
      nucleolus.position.set(0.08, 0.05, 0.04);
      nucleusGroup.add(nucleolus);

      const chromatinMat = new THREE.MeshStandardMaterial({
        color: vis.chromatinHex,
        emissive: vis.chromatinHex,
        emissiveIntensity: 0.28,
        roughness: 0.42,
        metalness: 0.15,
      });
      const chromatinA = new THREE.Mesh(chromatinGeo, chromatinMat);
      const chromatinB = new THREE.Mesh(chromatinGeo, chromatinMat);
      chromatinB.rotation.set(Math.PI * 0.45, Math.PI * 0.35, 0);
      chromatinB.scale.setScalar(0.86);
      nucleusGroup.add(chromatinA);
      nucleusGroup.add(chromatinB);

      const dnaBreakMat = new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xf43f5e,
        emissiveIntensity: 1.8,
        roughness: 0.2,
      });
      const dnaBreakFoci: THREE.Mesh[] = [];
      for (let d = 0; d < 3; d++) {
        const focus = new THREE.Mesh(dnaFocusGeo, dnaBreakMat);
        const a = (d / 3) * Math.PI * 2 + cell.phaseOffset;
        focus.position.set(Math.cos(a) * 0.2, Math.sin(a * 1.7) * 0.15, Math.sin(a) * 0.2);
        focus.visible = false;
        nucleusGroup.add(focus);
        dnaBreakFoci.push(focus);
      }

      // Nuclear Pore Complexes (NPCs) anchored symmetrically across nuclear lamina
      const poreMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0891b2,
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.3,
      });
      const nuclearPores: THREE.Mesh[] = [];
      const npcDirs = [
        new THREE.Vector3(1, 0.35, 0.3).normalize(),
        new THREE.Vector3(-1, -0.2, 0.35).normalize(),
        new THREE.Vector3(0.2, 1, -0.3).normalize(),
        new THREE.Vector3(-0.35, -1, 0.2).normalize(),
        new THREE.Vector3(0.3, 0.2, 1).normalize(),
        new THREE.Vector3(-0.3, 0.25, -1).normalize(),
        new THREE.Vector3(0.7, -0.7, 0.2).normalize(),
        new THREE.Vector3(-0.7, 0.7, -0.2).normalize(),
      ];
      for (const dir of npcDirs) {
        const pore = new THREE.Mesh(npcGeo, poreMat);
        pore.position.copy(dir).multiplyScalar(0.422);
        pore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        nucleusGroup.add(pore);
        nuclearPores.push(pore);
      }

      group.add(nucleusGroup);

      // Endoplasmic Reticulum + Stacked Golgi Apparatus Cisternae
      const erMat = new THREE.MeshStandardMaterial({
        color: vis.erHex,
        roughness: 0.48,
        metalness: 0.12,
      });
      const erRibbon = new THREE.Mesh(erRibbonGeo, erMat);
      erRibbon.rotation.set(0.9, 0.4, cell.phaseOffset);
      group.add(erRibbon);

      const golgiStack = new THREE.Group();
      for (let g = 0; g < 3; g++) {
        const arc = new THREE.Mesh(golgiArcGeo, erMat);
        arc.scale.setScalar(1 + g * 0.22);
        arc.position.set(0.34 + g * 0.045, -0.22, 0.15);
        arc.rotation.set(0.5, 0.8, 0.4);
        golgiStack.add(arc);
      }
      group.add(golgiStack);

      // Cytoskeletal Actin Stress Filaments spanning perinuclear cytoplasm
      const actinMat = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        transparent: true,
        opacity: 0.42,
        roughness: 0.6,
      });
      const actinFibers: THREE.Mesh[] = [];
      const fiberDirs = [
        new THREE.Vector3(1, 0.4, 0.2).normalize(),
        new THREE.Vector3(-0.8, 0.6, -0.3).normalize(),
        new THREE.Vector3(0.2, -0.9, 0.5).normalize(),
        new THREE.Vector3(-0.4, -0.3, -0.88).normalize(),
      ];
      for (const fDir of fiberDirs) {
        const fiber = new THREE.Mesh(actinFiberGeo, actinMat);
        fiber.position.copy(fDir).multiplyScalar(0.64);
        fiber.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fDir);
        group.add(fiber);
        actinFibers.push(fiber);
      }

      // 4 Composite Mitochondria (Capsule + Cristae Rings)
      const mitoMat = new THREE.MeshStandardMaterial({
        color: vis.mitoHex,
        emissive: vis.emissiveHex,
        emissiveIntensity: 0.25,
        roughness: 0.38,
        metalness: 0.18,
      });
      const mitochondria: THREE.Group[] = [];
      for (let k = 0; k < 4; k++) {
        const mGrp = new THREE.Group();
        const body = new THREE.Mesh(mitoBodyGeo, mitoMat);
        const crista1 = new THREE.Mesh(mitoCristaeGeo, chromatinMat);
        crista1.rotation.x = Math.PI / 2;
        crista1.position.y = 0.04;
        const crista2 = new THREE.Mesh(mitoCristaeGeo, chromatinMat);
        crista2.rotation.x = Math.PI / 2;
        crista2.position.y = -0.04;
        mGrp.add(body, crista1, crista2);

        const ang = (k / 4) * Math.PI * 2 + cell.phaseOffset;
        mGrp.position.set(Math.cos(ang) * 0.64, Math.sin(ang * 1.4) * 0.34, Math.sin(ang) * 0.64);
        mGrp.rotation.set(ang, k * 0.8, ang * 0.5);
        group.add(mGrp);
        mitochondria.push(mGrp);
      }

      // Transmembrane Surface Receptors + Docked Therapeutic Ligand Complexes
      const ligandMat = new THREE.MeshStandardMaterial({
        color: 0x22d3ee,
        emissive: 0x06b6d4,
        emissiveIntensity: 1.4,
        roughness: 0.2,
      });
      const receptors: THREE.Group[] = [];
      const boundLigands: THREE.Mesh[] = [];
      const receptorDirs = [
        new THREE.Vector3(1, 0.25, 0.2).normalize(),
        new THREE.Vector3(-0.7, 0.55, 0.45).normalize(),
        new THREE.Vector3(0.2, -0.75, 0.62).normalize(),
        new THREE.Vector3(-0.35, -0.35, -0.87).normalize(),
      ];
      for (let r = 0; r < receptorDirs.length; r++) {
        const dir = receptorDirs[r];
        const rGrp = new THREE.Group();
        rGrp.position.copy(dir).multiplyScalar(0.95);
        rGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

        const stalk = new THREE.Mesh(receptorStalkGeo, receptorMat);
        stalk.position.y = 0.05;
        const head = new THREE.Mesh(receptorHeadGeo, receptorMat);
        head.position.y = 0.13;
        const ligand = new THREE.Mesh(ligandGeo, ligandMat);
        ligand.position.y = 0.19;
        ligand.visible = false;

        rGrp.add(stalk, head, ligand);
        group.add(rGrp);
        receptors.push(rGrp);
        boundLigands.push(ligand);
      }

      cellsGroup.add(group);

      const entry: CellMeshEntry = {
        group,
        membrane,
        membraneMat,
        nucleusGroup,
        nucleusEnvelope,
        nucleusMat,
        nuclearPores,
        poreMat,
        nucleolus,
        nucleolusMat,
        chromatinA,
        chromatinB,
        chromatinMat,
        dnaBreakFoci,
        dnaBreakMat,
        mitochondria,
        mitoMat,
        erRibbon,
        erMat,
        golgiStack,
        actinFibers,
        actinMat,
        receptors,
        boundLigands,
        ligandMat,
        cellId: cell.id,
      };
      cellEntries.set(cell.id, entry);
      return entry;
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const handlePointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const hits = raycaster.intersectObjects(cellsGroup.children, true);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData?.cellId) {
          obj = obj.parent;
        }
        const cid = obj?.userData?.cellId as string | undefined;
        if (cid) {
          const found = latestRef.current.cells.find((c) => c.id === cid) ?? null;
          latestRef.current.onSelectCell(found);
          return;
        }
      }
      latestRef.current.onSelectCell(null);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // Pre-allocated math helpers (zero GC inside animation loop)
    const _mat4 = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scale = new THREE.Vector3();
    const _yAxis = new THREE.Vector3(0, 1, 0);
    const _tan = new THREE.Vector3();
    const _euler = new THREE.Euler();

    let animTimer = 0;
    let lastClock = performance.now();
    let lastReportedMag = -1;
    let disposed = false;
    let rafId = 0;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    function afterDraw(cb: () => void) {
      const gl2 = renderer.getContext() as WebGL2RenderingContext;
      if (!isSoftwareGl || typeof gl2.fenceSync !== 'function') {
        rafId = requestAnimationFrame(cb);
        return;
      }
      const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        setTimeout(cb, 80);
        return;
      }
      gl2.flush();
      const deadline = performance.now() + 400;
      const poll = () => {
        if (disposed) return;
        const status = gl2.clientWaitSync(sync, 0, 0);
        if (status === gl2.TIMEOUT_EXPIRED && performance.now() < deadline) {
          setTimeout(poll, 5);
          return;
        }
        gl2.deleteSync(sync);
        setTimeout(cb, 16);
      };
      setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.08, (now - lastClock) / 1000);
      lastClock = now;
      animTimer += dt * 1.4;

      const {
        cells: liveCells,
        currentHour: hr,
        treatmentMechanism: mech,
        concentrationUM: conc,
        secondaryMechanism: secMech,
        secondaryConcentrationUM: secConc,
        selectedCellId: selId,
        cutawayMode: isCutaway,
      } = latestRef.current;

      // Exponential camera damping for smooth 10,000x ultrastructure fly-to
      if (flyTargetRef.current) {
        const lambda = 7.5;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, flyTargetRef.current.camPos.x, lambda, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, flyTargetRef.current.camPos.y, lambda, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, flyTargetRef.current.camPos.z, lambda, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, flyTargetRef.current.targetPos.x, lambda, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, flyTargetRef.current.targetPos.y, lambda, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, flyTargetRef.current.targetPos.z, lambda, dt);
        if (
          camera.position.distanceTo(flyTargetRef.current.camPos) < 0.02 &&
          controls.target.distanceTo(flyTargetRef.current.targetPos) < 0.02
        ) {
          camera.position.copy(flyTargetRef.current.camPos);
          controls.target.copy(flyTargetRef.current.targetPos);
          flyTargetRef.current = null;
        }
      }

      const camDist = camera.position.distanceTo(controls.target);
      const mag = distanceToMagnification(camDist);
      if (Math.abs(mag - lastReportedMag) >= (mag > 1500 ? 40 : 10)) {
        lastReportedMag = mag;
        setMagnificationX(mag);
      }

      // Adjust membrane translucency when zooming deep or using Membrane Cutaway mode
      const deepZoomReveal = THREE.MathUtils.clamp((mag - 900) / 4000, 0, 0.28);
      const cutawayDrop = isCutaway ? 0.34 : 0;

      const activeIds = new Set<string>();
      let selectedTarget: THREE.Vector3 | null = null;
      let selectedRadius = 1;
      let vesicleCursor = 0;
      let debrisCursor = 0;
      const showUltrastructure = mag >= 1800 || isCutaway;

      for (const cell of liveCells) {
        activeIds.add(cell.id);
        const entry = getOrCreateCellEntry(cell);
        const vis = STATE_VISUALS[cell.state];

        // Swap organic mesh profile when cancer cell transitions into apoptotic blebbing
        const desiredGeo = !cell.isCancer
          ? healthyMembraneGeo
          : cell.state === 'apoptotic' || cell.state === 'eliminated'
          ? apoptoticMembraneGeo
          : cancerMembraneGeo;
        if (entry.membrane.geometry !== desiredGeo) {
          entry.membrane.geometry = desiredGeo;
        }

        entry.membraneMat.color.setHex(
          cell.isResistantClone && cell.state === 'cancer_active' ? 0xfb7185 : vis.membraneHex
        );
        entry.membraneMat.emissive.setHex(
          cell.isResistantClone && cell.state === 'cancer_active' ? 0x881337 : vis.emissiveHex
        );
        entry.nucleusMat.color.setHex(vis.nucleusHex);
        entry.nucleolusMat.color.setHex(vis.nucleolusHex);
        entry.chromatinMat.color.setHex(vis.chromatinHex);
        entry.mitoMat.color.setHex(vis.mitoHex);
        entry.erMat.color.setHex(vis.erHex);

        const phase = animTimer * 1.4 + cell.phaseOffset;
        let sx = cell.baseRadius;
        let sy = cell.baseRadius;
        let sz = cell.baseRadius;

        if (cell.state === 'healthy') {
          const breath = 1 + Math.sin(phase) * 0.03;
          sx *= breath;
          sy *= breath;
          sz *= breath;
          entry.membraneMat.opacity = Math.max(0.14, 0.56 - deepZoomReveal - cutawayDrop);
          entry.membraneMat.roughness = 0.28;
          entry.nucleusGroup.scale.setScalar(0.92);
          entry.chromatinA.scale.setScalar(1.0);
          entry.chromatinB.scale.setScalar(0.86);
        } else if (cell.state === 'cancer_active') {
          const pulse = 1 + Math.sin(phase * 1.6) * 0.055;
          sx *= pulse * 1.07;
          sy *= (1 / Math.sqrt(pulse)) * 1.04;
          sz *= pulse * 1.07;
          entry.membraneMat.opacity = Math.max(0.15, 0.64 - deepZoomReveal - cutawayDrop);
          entry.membraneMat.roughness = 0.34;
          entry.nucleusGroup.scale.setScalar(1.16);
          entry.chromatinA.scale.setScalar(1.08);
          entry.chromatinB.scale.setScalar(0.95);
        } else if (cell.state === 'treatment_exposed') {
          sx *= 1.02 + Math.sin(phase * 2.2) * 0.04;
          sy *= 1.02 + Math.cos(phase * 2.2) * 0.04;
          sz *= 1.02;
          entry.membraneMat.opacity = Math.max(0.15, 0.62 - deepZoomReveal - cutawayDrop);
          entry.membraneMat.emissiveIntensity = 0.55;
          entry.nucleusGroup.scale.setScalar(1.05);
          entry.chromatinA.scale.setScalar(0.98);
          entry.chromatinB.scale.setScalar(0.86);
        } else if (cell.state === 'stressed_damaged') {
          sx *= 1 + Math.sin(phase * 4.5) * 0.11;
          sy *= 1 - Math.sin(phase * 4.5) * 0.09;
          sz *= 1 + Math.cos(phase * 3.8) * 0.1;
          entry.membraneMat.opacity = Math.max(0.16, 0.68 - deepZoomReveal - cutawayDrop);
          entry.membraneMat.roughness = 0.56;
          entry.nucleusGroup.scale.setScalar(0.88);
          entry.chromatinA.scale.setScalar(0.84);
          entry.chromatinB.scale.setScalar(0.72);
        } else if (cell.state === 'apoptotic') {
          const shrink = Math.max(0.45, 1 - cell.apoptoticProgress * 0.52);
          sx *= shrink + Math.sin(phase * 6) * 0.1;
          sy *= shrink + Math.cos(phase * 6) * 0.1;
          sz *= shrink;
          entry.membraneMat.opacity = Math.max(0.14, 0.66 - cell.apoptoticProgress * 0.42 - deepZoomReveal * 0.4 - cutawayDrop * 0.5);
          entry.membraneMat.roughness = 0.72;
          entry.nucleusGroup.scale.setScalar(Math.max(0.46, 0.9 - cell.apoptoticProgress * 0.42));
          entry.chromatinA.position.set(0.08 * cell.apoptoticProgress, 0.05, 0);
          entry.chromatinB.position.set(-0.08 * cell.apoptoticProgress, -0.05, 0);
        } else {
          sx *= 0.28;
          sy *= 0.24;
          sz *= 0.28;
          entry.membraneMat.opacity = 0.14;
          entry.nucleusGroup.scale.setScalar(0.32);
        }

        entry.group.position.set(cell.x, cell.y + Math.sin(phase * 0.7) * 0.045, cell.z);
        entry.membrane.scale.set(sx, sy, sz);
        entry.group.rotation.y = Math.sin(phase * 0.25) * 0.35;

        entry.chromatinA.rotation.y = animTimer * 0.25 + cell.phaseOffset;
        entry.chromatinB.rotation.z = -animTimer * 0.2;

        // Nuclear Pore Complexes scale smoothly at deep ultrastructure magnification
        for (let np = 0; np < entry.nuclearPores.length; np++) {
          entry.nuclearPores[np].visible = cell.state !== 'eliminated' && showUltrastructure;
        }

        // DNA double-strand break foci glow dynamically under cellular stress/treatment
        const showBreakFoci = cell.stressIndex > 0.22 && cell.state !== 'eliminated';
        for (let d = 0; d < entry.dnaBreakFoci.length; d++) {
          const focus = entry.dnaBreakFoci[d];
          focus.visible = showBreakFoci && d < Math.ceil(cell.stressIndex * 3);
          if (focus.visible) {
            focus.scale.setScalar(0.85 + Math.sin(phase * 3.5 + d) * 0.25);
          }
        }

        // ER, Golgi Stack, Actin Stress Fibers & Mitochondria dynamics
        const alive = cell.state !== 'eliminated';
        entry.erRibbon.visible = alive;
        entry.erRibbon.scale.setScalar(cell.baseRadius);
        entry.golgiStack.visible = alive;
        entry.golgiStack.scale.setScalar(cell.baseRadius);
        for (let af = 0; af < entry.actinFibers.length; af++) {
          entry.actinFibers[af].visible = alive && showUltrastructure;
          entry.actinFibers[af].scale.setScalar(cell.baseRadius);
        }
        for (let k = 0; k < entry.mitochondria.length; k++) {
          const mGrp = entry.mitochondria[k];
          const spread =
            cell.state === 'apoptotic'
              ? 0.72 + cell.apoptoticProgress * 0.48
              : cell.state === 'eliminated'
              ? 0.24
              : 0.6;
          const ang = (k / 4) * Math.PI * 2 + cell.phaseOffset + animTimer * 0.3;
          mGrp.position.set(
            Math.cos(ang) * spread * cell.baseRadius,
            Math.sin(ang * 1.4) * 0.32 * cell.baseRadius,
            Math.sin(ang) * spread * cell.baseRadius
          );
          mGrp.visible = alive;
        }

        // Transmembrane receptors & bound therapeutic ligand molecules
        const hasLigand = cell.intracellularDose > 0.08 && alive;
        if (mech === 'checkpoint_immunotherapy') {
          entry.ligandMat.color.setHex(0xc084fc);
          entry.ligandMat.emissive.setHex(0x9333ea);
        } else if (mech === 'cytotoxic_chemotherapy') {
          entry.ligandMat.color.setHex(0x38bdf8);
          entry.ligandMat.emissive.setHex(0x0284c7);
        } else if (mech === 'hypoxia_activated_prodrug') {
          entry.ligandMat.color.setHex(0x2dd4bf);
          entry.ligandMat.emissive.setHex(0x0f766e);
        } else {
          entry.ligandMat.color.setHex(0x22d3ee);
          entry.ligandMat.emissive.setHex(0x06b6d4);
        }
        for (let r = 0; r < entry.receptors.length; r++) {
          entry.receptors[r].visible = alive;
          entry.receptors[r].scale.setScalar(cell.baseRadius);
          entry.boundLigands[r].visible = hasLigand && r < Math.ceil(Math.min(4, cell.intracellularDose * 4));
        }

        if (selId === cell.id) {
          selectedTarget = entry.group.position;
          selectedRadius = Math.max(sx, sy, sz);
        }

        // Populate intracellular uptake vesicles / endosomes inside cytoplasm
        if (cell.intracellularDose > 0.06 && alive && vesicleCursor + 4 <= MAX_VESICLES) {
          const count = Math.min(4, Math.max(1, Math.round(cell.intracellularDose * 2.6)));
          for (let v = 0; v < count; v++) {
            const ang = phase * 0.9 + (v / 4) * Math.PI * 2;
            const rad = cell.baseRadius * 0.54;
            _pos.set(
              entry.group.position.x + Math.cos(ang) * rad,
              entry.group.position.y + Math.sin(ang * 1.7) * rad * 0.55,
              entry.group.position.z + Math.sin(ang) * rad
            );
            const vScale = (0.7 + Math.min(0.9, cell.intracellularDose * 0.45)) * cell.baseRadius;
            _quat.identity();
            _scale.set(vScale, vScale, vScale);
            _mat4.compose(_pos, _quat, _scale);
            vesicleMesh.setMatrixAt(vesicleCursor++, _mat4);
          }
        }

        // Apoptotic debris blebs budding outward from dying or eliminated cells
        if ((cell.state === 'apoptotic' || cell.state === 'eliminated') && debrisCursor + 4 <= MAX_DEBRIS) {
          for (let db = 0; db < 4; db++) {
            const dAng = phase * 0.5 + (db / 4) * Math.PI * 2;
            const dRad = cell.baseRadius * (0.78 + Math.sin(phase + db) * 0.25);
            _pos.set(
              entry.group.position.x + Math.cos(dAng) * dRad,
              entry.group.position.y + Math.sin(dAng * 1.3 + db) * dRad * 0.65,
              entry.group.position.z + Math.sin(dAng) * dRad
            );
            const dScale = cell.state === 'eliminated' ? 0.55 : 0.85;
            _quat.setFromEuler(_euler.set(animTimer + db, dAng, 0));
            _scale.set(dScale, dScale, dScale);
            _mat4.compose(_pos, _quat, _scale);
            debrisMesh.setMatrixAt(debrisCursor++, _mat4);
          }
        }
      }

      // Zero unused vesicle and debris instances cleanly
      for (let i = vesicleCursor; i < MAX_VESICLES; i++) {
        _scale.set(0, 0, 0);
        _mat4.compose(_pos.set(-50, -50, -50), _quat.identity(), _scale);
        vesicleMesh.setMatrixAt(i, _mat4);
      }
      vesicleMesh.instanceMatrix.needsUpdate = true;

      for (let i = debrisCursor; i < MAX_DEBRIS; i++) {
        _scale.set(0, 0, 0);
        _mat4.compose(_pos.set(-50, -50, -50), _quat.identity(), _scale);
        debrisMesh.setMatrixAt(i, _mat4);
      }
      debrisMesh.instanceMatrix.needsUpdate = true;

      for (const [cid, entry] of cellEntries.entries()) {
        if (!activeIds.has(cid)) {
          cellsGroup.remove(entry.group);
          entry.membraneMat.dispose();
          entry.nucleusMat.dispose();
          entry.poreMat.dispose();
          entry.nucleolusMat.dispose();
          entry.chromatinMat.dispose();
          entry.dnaBreakMat.dispose();
          entry.mitoMat.dispose();
          entry.erMat.dispose();
          entry.actinMat.dispose();
          entry.ligandMat.dispose();
          cellEntries.delete(cid);
        }
      }

      if (selectedTarget) {
        selectionRing.visible = true;
        selectionRing.position.copy(selectedTarget);
        selectionRing.scale.setScalar(selectedRadius * 1.16);
        selectionRing.rotation.x = animTimer * 0.7;
        selectionRing.rotation.y = animTimer * 0.9;
      } else {
        selectionRing.visible = false;
      }

      // Flowing intraluminal RBC erythrocytes & drug tracers along the microvessel
      const isControl = mech === 'untreated_control' || conc <= 0;
      for (let i = 0; i < RBC_COUNT; i++) {
        const u = ((animTimer * 0.14 + i / RBC_COUNT) % 1 + 1) % 1;
        vesselCurve.getPointAt(u, _pos);
        vesselCurve.getTangentAt(u, _tan);
        const radial = (i % 3) * 0.12 - 0.12;
        _pos.x += radial;
        _pos.z += Math.cos(i * 2.1 + animTimer) * 0.12;
        _quat.setFromUnitVectors(_yAxis, _tan);
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        rbcMesh.setMatrixAt(i, _mat4);
      }
      rbcMesh.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < TRACER_COUNT; i++) {
        if (isControl) {
          _scale.set(0, 0, 0);
          _mat4.compose(_pos.set(-50, -50, -50), _quat.identity(), _scale);
          tracerMesh.setMatrixAt(i, _mat4);
          continue;
        }
        const u = ((animTimer * 0.22 + i / TRACER_COUNT) % 1 + 1) % 1;
        vesselCurve.getPointAt(u, _pos);
        _pos.x += Math.sin(i * 1.7 + animTimer * 2) * 0.14;
        _pos.z += Math.cos(i * 2.3 + animTimer * 2) * 0.14;
        _quat.identity();
        _scale.set(1, 1, 1);
        _mat4.compose(_pos, _quat, _scale);
        tracerMesh.setMatrixAt(i, _mat4);
      }
      tracerMesh.instanceMatrix.needsUpdate = true;

      // Therapeutic agent particles diffusing from microvessel + modality-specific visuals
      const activeParticles = isControl ? 0 : Math.min(PARTICLE_COUNT, Math.round(35 + conc * 22));
      hypoxiaZoneMesh.visible = mech === 'hypoxia_activated_prodrug' && !isControl;
      if (hypoxiaZoneMesh.visible) {
        hypoxiaZoneMesh.rotation.y = animTimer * 0.12;
      }

      if (mech === 'checkpoint_immunotherapy') {
        particleMat.color.setHex(0xa855f7);
        particleMat.emissive.setHex(0x7e22ce);
        vesicleMat.color.setHex(0xc084fc);
        vesicleMat.emissive.setHex(0x9333ea);
        tracerMat.color.setHex(0xa855f7);
        tracerMat.emissive.setHex(0x7e22ce);
        waveMat.color.setHex(0xa855f7);
      } else if (mech === 'cytotoxic_chemotherapy') {
        particleMat.color.setHex(0x38bdf8);
        particleMat.emissive.setHex(0x0284c7);
        vesicleMat.color.setHex(0x7dd3fc);
        vesicleMat.emissive.setHex(0x0284c7);
        tracerMat.color.setHex(0x38bdf8);
        tracerMat.emissive.setHex(0x0284c7);
        waveMat.color.setHex(0x38bdf8);
      } else if (mech === 'hypoxia_activated_prodrug') {
        particleMat.color.setHex(0x2dd4bf);
        particleMat.emissive.setHex(0x0f766e);
        vesicleMat.color.setHex(0x5eead4);
        vesicleMat.emissive.setHex(0x0d9488);
        tracerMat.color.setHex(0x2dd4bf);
        tracerMat.emissive.setHex(0x0f766e);
        waveMat.color.setHex(0x2dd4bf);
      } else {
        particleMat.color.setHex(0x22d3ee);
        particleMat.emissive.setHex(0x06b6d4);
        vesicleMat.color.setHex(0x22d3ee);
        vesicleMat.emissive.setHex(0x06b6d4);
        tracerMat.color.setHex(0x22d3ee);
        tracerMat.emissive.setHex(0x06b6d4);
        waveMat.color.setHex(0x22d3ee);
      }

      const maxReachX = -11.5 + Math.min(24.0, (hr + 1.5) * 0.85);
      waveMesh.visible = !isControl && hr > 0;
      if (waveMesh.visible) {
        const waveCycle = ((animTimer * 0.18) % 1 + 1) % 1;
        waveMesh.position.x = -11.5 + waveCycle * Math.max(2.0, maxReachX - -11.5);
        waveMat.opacity = Math.max(0.03, (1 - waveCycle) * 0.18);
      }

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        if (i >= activeParticles) {
          _scale.set(0, 0, 0);
          _mat4.compose(_pos.set(-50, -50, -50), _quat.identity(), _scale);
          particleMesh.setMatrixAt(i, _mat4);
          continue;
        }
        const ps = pSeeds[i];
        const progress = ((animTimer * 0.2 * ps.speed + ps.offset) % 1 + 1) % 1;
        const px = -11.5 + progress * Math.max(2.0, maxReachX - -11.5);
        const py = ps.ySpread + Math.sin(animTimer * 1.8 + ps.offset) * 0.45;
        const pz = ps.zSpread + Math.cos(animTimer * 1.4 + ps.offset) * 0.45;

        const pScale = mech === 'checkpoint_immunotherapy' ? 1.3 : 0.9;
        _pos.set(px, py, pz);
        _euler.set(animTimer + i, animTimer * 0.7, 0);
        _quat.setFromEuler(_euler);
        _scale.set(pScale, pScale, pScale);
        _mat4.compose(_pos, _quat, _scale);
        particleMesh.setMatrixAt(i, _mat4);
      }
      particleMesh.instanceMatrix.needsUpdate = true;

      // Secondary combination drug diffusion wave & color coding
      const secActive =
        Boolean(secMech) && secMech !== 'none' && secMech !== 'untreated_control' && (secConc ?? 0) > 0;
      const activeSecParticles = secActive ? Math.min(SEC_PARTICLE_COUNT, Math.round(20 + (secConc ?? 0) * 12)) : 0;
      if (secMech === 'checkpoint_immunotherapy') {
        secParticleMat.color.setHex(0xc084fc);
        secParticleMat.emissive.setHex(0x9333ea);
      } else if (secMech === 'hypoxia_activated_prodrug') {
        secParticleMat.color.setHex(0x2dd4bf);
        secParticleMat.emissive.setHex(0x0f766e);
      } else if (secMech === 'cytotoxic_chemotherapy') {
        secParticleMat.color.setHex(0xfbbf24);
        secParticleMat.emissive.setHex(0xd97706);
      } else {
        secParticleMat.color.setHex(0x38bdf8);
        secParticleMat.emissive.setHex(0x0284c7);
      }

      for (let i = 0; i < SEC_PARTICLE_COUNT; i++) {
        if (i >= activeSecParticles) {
          _scale.set(0, 0, 0);
          _mat4.compose(_pos.set(-50, -50, -50), _quat.identity(), _scale);
          secParticleMesh.setMatrixAt(i, _mat4);
          continue;
        }
        const ps = secPSeeds[i];
        const progress = ((animTimer * 0.22 * ps.speed + ps.offset) % 1 + 1) % 1;
        const px = -11.5 + progress * Math.max(2.0, maxReachX - -11.5);
        const py = ps.ySpread + Math.cos(animTimer * 1.9 + ps.offset) * 0.42;
        const pz = ps.zSpread + Math.sin(animTimer * 1.5 + ps.offset) * 0.42;
        _pos.set(px, py, pz);
        _euler.set(animTimer * 1.2 + i, animTimer * 0.9, 0);
        _quat.setFromEuler(_euler);
        _scale.set(1.05, 1.05, 1.05);
        _mat4.compose(_pos, _quat, _scale);
        secParticleMesh.setMatrixAt(i, _mat4);
      }
      secParticleMesh.instanceMatrix.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);

      for (const entry of cellEntries.values()) {
        entry.membraneMat.dispose();
        entry.nucleusMat.dispose();
        entry.poreMat.dispose();
        entry.nucleolusMat.dispose();
        entry.chromatinMat.dispose();
        entry.dnaBreakMat.dispose();
        entry.mitoMat.dispose();
        entry.erMat.dispose();
        entry.actinMat.dispose();
        entry.ligandMat.dispose();
      }
      cellEntries.clear();

      healthyMembraneGeo.dispose();
      cancerMembraneGeo.dispose();
      apoptoticMembraneGeo.dispose();
      nucleusGeo.dispose();
      npcGeo.dispose();
      nucleolusGeo.dispose();
      chromatinGeo.dispose();
      dnaFocusGeo.dispose();
      mitoBodyGeo.dispose();
      mitoCristaeGeo.dispose();
      erRibbonGeo.dispose();
      golgiArcGeo.dispose();
      actinFiberGeo.dispose();
      receptorStalkGeo.dispose();
      receptorHeadGeo.dispose();
      ligandGeo.dispose();
      receptorMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      vesselGeo.dispose();
      vesselMat.dispose();
      rbcGeo.dispose();
      rbcMat.dispose();
      tracerGeo.dispose();
      tracerMat.dispose();
      waveGeo.dispose();
      waveMat.dispose();
      ecmMat.dispose();
      ecmGeos.forEach((g) => g.dispose());
      particleGeo.dispose();
      particleMat.dispose();
      secParticleGeo.dispose();
      secParticleMat.dispose();
      vesicleGeo.dispose();
      vesicleMat.dispose();
      debrisGeo.dispose();
      debrisMat.dispose();
      hypoxiaZoneGeo.dispose();
      hypoxiaZoneMat.dispose();
      albedoTex.dispose();
      roughTex.dispose();
      normalTex.dispose();
      envTarget.dispose();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  const selectedCell = cells.find((c) => c.id === selectedCellId) ?? null;
  const scaleInfo = magnificationToScaleLabel(magnificationX);

  const inspectActiveTarget = (targetDist: number) => {
    const target = selectedCell ?? cells.find((c) => c.isCancer) ?? cells[0];
    if (target) {
      if (!selectedCell) onSelectCell(target);
      focusCellAtMagnification(target, targetDist);
    }
  };

  return (
    <div
      className={`relative bg-[#050911] border border-slate-800/90 rounded-md overflow-hidden select-none ${
        isFullscreen ? 'fixed inset-3 z-50 shadow-2xl' : 'h-[560px] lg:h-[640px] w-full'
      }`}
    >
      {/* Isolated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#050911]/92 text-xs font-mono text-amber-300">
          WebGL rendering context interrupted — restoring ultrastructural geometry...
        </div>
      )}

      {/* Top-Left Minimal Legend, Live Optical Zoom & Scale Bar */}
      <div className="absolute top-3 left-3 bg-[#090E18]/95 border border-slate-800 rounded px-3 py-2 space-y-1.5 pointer-events-auto max-w-[290px]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">
            COMPUTATIONAL 3D BIO-SIM
          </span>
          <span className="text-[10px] font-mono text-emerald-300 tabular-nums font-semibold">
            {magnificationX.toLocaleString()}x Zoom
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
          <span>t = {currentHour}h / {durationHours}h</span>
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="inline-block h-1.5 border-b border-l border-r border-cyan-400" style={{ width: `${scaleInfo.barPx}px` }} />
            {scaleInfo.label}
          </span>
        </div>
        <div className="text-[9.5px] font-mono text-slate-500 truncate" title={renderProfileLabel}>
          {renderProfileLabel}
        </div>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 text-[10px] text-slate-300 pt-0.5">
          {(Object.keys(STATE_VISUALS) as CellLifecycleState[]).map((st) => (
            <div key={st} className="flex items-center gap-1.5 truncate">
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_VISUALS[st].dotClass}`} />
              <span className="truncate">{STATE_VISUALS[st].label}</span>
            </div>
          ))}
        </div>
        {(magnificationX >= 1800 || cutawayMode) && (
          <div className="pt-1.5 border-t border-slate-800/80 text-[9.5px] font-mono text-slate-300 space-y-0.5">
            <div className="text-cyan-400">10,000x Ultrastructure Layers Active:</div>
            <div className="text-slate-400">
              Lipid Bilayer · Receptors/Ligand · Nuclear Pore Complexes · Nucleolus · Chromatin · γ-H2AX Foci · Cristae Mito · ER &amp; Golgi Stack · Actin Fibers
            </div>
          </div>
        )}
      </div>

      {/* Top-Right Macro-to-10,000x Ultrastructure Presets + Cutaway */}
      <div className="absolute top-3 right-3 flex flex-wrap items-center gap-1 bg-[#090E18]/95 border border-slate-800 rounded p-1">
        <button
          onClick={() => applyCameraPreset('overview')}
          className={`px-2 py-1 text-[10px] font-mono rounded ${
            cameraPreset === 'overview' ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          200x Tissue
        </button>
        <button
          onClick={() => applyCameraPreset('core')}
          className={`px-2 py-1 text-[10px] font-mono rounded ${
            cameraPreset === 'core' ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Tumour Core
        </button>
        <button
          onClick={() => applyCameraPreset('vessel')}
          className={`px-2 py-1 text-[10px] font-mono rounded ${
            cameraPreset === 'vessel' ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Vessel Edge
        </button>
        <button
          onClick={() => inspectActiveTarget(0.84)}
          title="Zoom to exact 5,000x organelle scale"
          className={`px-2 py-1 text-[10px] font-mono rounded ${
            cameraPreset === 'ultra' && magnificationX < 8000
              ? 'bg-cyan-950 text-cyan-300'
              : 'text-slate-400 hover:text-cyan-300'
          }`}
        >
          5,000x Cell
        </button>
        <button
          onClick={() => inspectActiveTarget(0.425)}
          title="Dive into sub-cellular nucleus & chromatin ultrastructure (10,000x)"
          className={`px-2 py-1 text-[10px] font-mono rounded border border-cyan-800/70 ${
            magnificationX >= 8000 ? 'bg-cyan-600 text-slate-950 font-semibold' : 'text-cyan-300 hover:bg-cyan-950/60'
          }`}
        >
          10,000x Nucleus
        </button>
        <button
          onClick={() => setCutawayMode((m) => !m)}
          title="Toggle plasma membrane cutaway for crystal-clear organelle inspection"
          className={`flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border-l border-slate-800 pl-2 ${
            cutawayMode ? 'bg-teal-950 text-teal-300' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3 h-3" /> Cutaway
        </button>
        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit full-screen simulation' : 'Expand full-screen simulation'}
          className="p-1.5 text-slate-300 hover:text-cyan-300 border-l border-slate-800 pl-2"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Selected Single-Cell Ultrastructure Inspector */}
      {selectedCell && (
        <div className="absolute bottom-16 left-3 bg-[#090E18]/96 border border-cyan-800/70 rounded p-3 w-80 text-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5 font-mono text-cyan-300">
              <Eye className="w-3.5 h-3.5" />
              <span>{selectedCell.id}</span>
              <span className="text-slate-500">· {selectedCell.isCancer ? 'Malignant' : 'Normal Stroma'}</span>
            </div>
            <button onClick={() => onSelectCell(null)} className="text-slate-400 hover:text-slate-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
            <div className="text-slate-400">Lifecycle State</div>
            <div className="text-slate-100 text-right">{STATE_VISUALS[selectedCell.state].label}</div>
            {selectedCell.isCancer && (
              <>
                <div className="text-slate-400">Clone Lineage</div>
                <div
                  className={`text-right ${
                    selectedCell.isResistantClone ? 'text-rose-300 font-semibold' : 'text-cyan-300'
                  }`}
                >
                  {selectedCell.isResistantClone ? 'Resistant Subclone' : 'Treatment-Sensitive'}
                </div>
              </>
            )}
            <div className="text-slate-400">Intracellular Dose</div>
            <div className="text-cyan-300 text-right tabular-nums">{selectedCell.intracellularDose.toFixed(3)} uM</div>
            <div className="text-slate-400">DNA / Oxidative Stress</div>
            <div className="text-amber-300 text-right tabular-nums">{(selectedCell.stressIndex * 100).toFixed(1)}%</div>
            <div className="text-slate-400">Membrane Integrity</div>
            <div className="text-emerald-300 text-right tabular-nums">
              {(selectedCell.healthIntegrity * 100).toFixed(1)}%
            </div>
          </div>
          <div className="p-2 bg-[#050911] border border-slate-800/80 rounded text-[10px] text-slate-300 leading-relaxed">
            <span className="font-mono text-cyan-400">Ultrastructure: </span>
            {STATE_VISUALS[selectedCell.state].ultrastructureNote}
          </div>
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              onClick={() => focusCellAtMagnification(selectedCell, 0.84)}
              className="flex items-center justify-center gap-1 py-1 bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-700/70 text-cyan-200 rounded text-[10px] font-mono"
            >
              <Crosshair className="w-3 h-3" /> Focus @ 5,000x
            </button>
            <button
              onClick={() => focusCellAtMagnification(selectedCell, 0.425)}
              className="flex items-center justify-center gap-1 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded text-[10px] font-mono"
            >
              <ZoomIn className="w-3 h-3" /> 10,000x Interior
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 max-w-[95%]">
        <button
          onClick={() => setDockOpen((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-mono bg-[#090E18]/95 border border-slate-800 rounded text-slate-400 hover:text-slate-200"
        >
          {dockOpen ? (
            <>
              <ChevronDown className="w-3 h-3" /> Hide Controls
            </>
          ) : (
            <>
              <ChevronUp className="w-3 h-3" /> Show Controls
            </>
          )}
        </button>

        {dockOpen && (
          <div className="flex flex-wrap items-center gap-2 bg-[#090E18]/96 border border-slate-800 rounded px-3 py-1.5 text-xs">
            <button
              onClick={onTogglePlay}
              className="flex items-center gap-1.5 px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause' : currentHour >= durationHours ? 'Replay' : 'Simulate'}
            </button>
            <button
              onClick={onStepHour}
              disabled={isPlaying || currentHour >= durationHours}
              className="flex items-center gap-1 px-2.5 py-1 border border-slate-700 hover:border-slate-500 disabled:opacity-40 rounded text-slate-200"
            >
              <SkipForward className="w-3.5 h-3.5" /> +1h
            </button>
            <button
              onClick={onReset}
              className="flex items-center gap-1 px-2.5 py-1 border border-slate-700 hover:border-slate-500 rounded text-slate-300"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
            <div className="flex items-center gap-1 border-l border-slate-800 pl-2 font-mono text-[11px]">
              <span className="text-slate-500">Rate:</span>
              {[1, 2, 4].map((spd) => (
                <button
                  key={spd}
                  onClick={() => onChangeSpeed(spd)}
                  className={`px-1.5 py-0.5 rounded ${
                    playbackSpeed === spd ? 'bg-cyan-950 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
            <div className="hidden md:block border-l border-slate-800 pl-2 text-[10px] font-mono text-slate-400">
              Scroll/pinch up to 10,000x · Click any cell for ultrastructure inspection
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
