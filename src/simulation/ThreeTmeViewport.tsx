import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { TME_CONCEPTUAL_EDGES, TME_CONCEPTUAL_NODES, type TmeNodeSpec } from '../data/cancerBiologyCatalog';

export interface SpatialCellPoint {
  cell_id: string;
  x_um: number;
  y_um: number;
  z_um: number;
  lineage_class: string;
  expression?: Record<string, number>;
}

interface ThreeTmeViewportProps {
  activeLayers: Array<'immune' | 'stromal' | 'angiogenesis' | 'hypoxia' | 'inflammatory'>;
  selectedNodeId: string;
  onSelectNode: (node: TmeNodeSpec) => void;
  spatialCells: SpatialCellPoint[];
  heatmapGene?: string;
}

const CATEGORY_HEX: Record<TmeNodeSpec['category'], number> = {
  cancer: 0x06b6d4,
  stroma: 0xf59e0b,
  immune: 0x14b8a6,
  vascular: 0xef4444,
  ecm: 0x64748b,
  factor: 0xa855f7,
};

function lineageColor(lineage: string): number {
  const s = lineage.toLowerCase();
  if (/tumou?r|cancer|epith|malign/.test(s)) return 0x06b6d4;
  if (/cd8|t_cell|nk|immune|macro|lymph/.test(s)) return 0x14b8a6;
  if (/caf|fibro|stroma/.test(s)) return 0xf59e0b;
  if (/endo|vasc|vessel/.test(s)) return 0xef4444;
  return 0xa855f7;
}

function expressionHeatmapHex(norm: number): number {
  const t = Math.max(0, Math.min(1, norm));
  const c = new THREE.Color();
  if (t < 0.33) {
    c.setRGB(0.08, 0.25 + t * 1.8, 0.65 + t * 0.8);
  } else if (t < 0.66) {
    const k = (t - 0.33) / 0.33;
    c.setRGB(0.15 + k * 0.8, 0.82 + k * 0.1, 0.9 - k * 0.72);
  } else {
    const k = (t - 0.66) / 0.34;
    c.setRGB(0.95, 0.86 - k * 0.62, 0.18 + k * 0.15);
  }
  return c.getHex();
}

function createOrganicTmeMaps(size: number) {
  const nCanvas = document.createElement('canvas');
  nCanvas.width = size;
  nCanvas.height = size;
  const nCtx = nCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(size, size);
  const hBuf = new Float32Array(size * size);
  const twoPi = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const ay = (y / size) * twoPi;
    for (let x = 0; x < size; x++) {
      const ax = (x / size) * twoPi;
      const h =
        0.5 +
        0.25 * Math.sin(ax * 5 + Math.cos(ay * 4)) * Math.cos(ay * 5) +
        0.15 * Math.sin(ax * 13 - ay * 11);
      hBuf[y * size + x] = h;
    }
  }
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (hBuf[y * size + xp] - hBuf[y * size + xm]) * 2.8;
      const dy = (hBuf[yp * size + x] - hBuf[ym * size + x]) * 2.8;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const p = (y * size + x) * 4;
      nImg.data[p] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      nImg.data[p + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      nImg.data[p + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      nImg.data[p + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);
  const normalTex = new THREE.CanvasTexture(nCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(2, 2);
  normalTex.needsUpdate = true;
  return { normalTex };
}

export const ThreeTmeViewport: React.FC<ThreeTmeViewportProps> = ({
  activeLayers,
  selectedNodeId,
  onSelectNode,
  spatialCells,
  heatmapGene = '',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [contextLost, setContextLost] = useState(false);
  const [pickedSpatialCell, setPickedSpatialCell] = useState<SpatialCellPoint | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const propsRef = useRef({ activeLayers, selectedNodeId, onSelectNode, spatialCells });
  propsRef.current = { activeLayers, selectedNodeId, onSelectNode, spatialCells };

  // Dynamic sync refs updated outside initialization
  const edgeEntriesRef = useRef<
    Array<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; layer: string; color: number }>
  >([]);
  const nodeRingsRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const hypoxiaCloudRef = useRef<THREE.Mesh | null>(null);
  const spatialGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 720;
    const height = container.clientHeight || 460;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : '';
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);

    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a11);
    scene.fog = new THREE.FogExp2(0x060a11, 0.018);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 120);
    camera.position.set(0, 10, 18);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.2;
    controls.maxDistance = 42;
    controls.update();
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0x88ccff, 0x091322, 0.72));
    const key = new THREE.DirectionalLight(0xfff7ed, 1.85);
    key.position.set(10, 16, 12);
    scene.add(key);

    const grid = new THREE.GridHelper(22, 22, 0x164e63, 0x0f172a);
    grid.position.y = -4.2;
    scene.add(grid);

    const { normalTex } = createOrganicTmeMaps(isSoftwareGl ? 256 : 512);

    // Map 2D TME coordinates -> volumetric 3D coordinates cleanly
    const nodePos = new Map<string, THREE.Vector3>();
    TME_CONCEPTUAL_NODES.forEach((n, idx) => {
      const x = ((n.x - 325) / 280) * 8.5;
      const y = -((n.y - 215) / 180) * 4.2;
      const z = ((idx % 3) - 1) * 2.4 + Math.sin(idx * 1.4) * 0.9;
      nodePos.set(n.id, new THREE.Vector3(x, y, z));
    });

    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);

    const nodeCoreGeo = new THREE.IcosahedronGeometry(0.68, 3);
    const nodeHaloGeo = new THREE.SphereGeometry(0.95, 24, 18);
    const ringGeo = new THREE.TorusGeometry(1.08, 0.045, 10, 36);
    const disposables: Array<{ dispose: () => void }> = [nodeCoreGeo, nodeHaloGeo, ringGeo, normalTex];

    nodeRingsRef.current.clear();

    TME_CONCEPTUAL_NODES.forEach((node) => {
      const p = nodePos.get(node.id)!;
      const col = CATEGORY_HEX[node.category];
      const grp = new THREE.Group();
      grp.position.copy(p);
      grp.userData = { nodeId: node.id };

      const scaleFactor = Math.max(0.75, node.radius / 26);

      const coreMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.45,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.75, 0.75),
        roughness: 0.34,
        metalness: 0.14,
      });
      const haloMat = new THREE.MeshPhysicalMaterial({
        color: col,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        roughness: 0.2,
      });
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

      const core = new THREE.Mesh(nodeCoreGeo, coreMat);
      core.scale.setScalar(scaleFactor);
      core.userData = { nodeId: node.id };
      const halo = new THREE.Mesh(nodeHaloGeo, haloMat);
      halo.scale.setScalar(scaleFactor);
      halo.userData = { nodeId: node.id };

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.scale.setScalar(scaleFactor);
      ring.visible = node.id === propsRef.current.selectedNodeId;

      grp.add(core, halo, ring);
      nodeGroup.add(grp);
      nodeRingsRef.current.set(node.id, ring);
      disposables.push(coreMat, haloMat, ringMat);
    });

    // Hypoxia volumetric diffusion core around HIF1A / cancer compartment
    const hypoxiaGeo = new THREE.SphereGeometry(4.4, 24, 18);
    const hypoxiaMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    const hypoxiaCloud = new THREE.Mesh(hypoxiaGeo, hypoxiaMat);
    hypoxiaCloud.position.set(-1.5, 0.8, 0);
    scene.add(hypoxiaCloud);
    hypoxiaCloudRef.current = hypoxiaCloud;
    disposables.push(hypoxiaGeo, hypoxiaMat);

    // Signalling Pathway Tubes + Animated Paracrine Signal Pulses
    edgeEntriesRef.current = [];
    TME_CONCEPTUAL_EDGES.forEach((edge) => {
      const a = nodePos.get(edge.from);
      const b = nodePos.get(edge.to);
      if (!a || !b) return;
      const mid = a.clone().lerp(b, 0.5);
      mid.y += 0.55;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tGeo = new THREE.TubeGeometry(curve, 18, 0.04, 8, false);
      const col = edge.polarity === 'inhibitory' ? 0xf59e0b : edge.polarity === 'remodelling' ? 0x94a3b8 : 0x06b6d4;
      const tMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.72,
      });
      const mesh = new THREE.Mesh(tGeo, tMat);
      scene.add(mesh);
      edgeEntriesRef.current.push({ mesh, curve, layer: edge.layer, color: col });
      disposables.push(tGeo, tMat);
    });

    const PULSE_COUNT = Math.max(1, edgeEntriesRef.current.length * 2);
    const pulseGeo = new THREE.SphereGeometry(0.09, 8, 8);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pulseMesh = new THREE.InstancedMesh(pulseGeo, pulseMat, PULSE_COUNT);
    pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(pulseMesh);
    disposables.push(pulseGeo, pulseMat);

    // Container for optional user-imported 3D spatial proteomics coordinates
    const spatialGroup = new THREE.Group();
    scene.add(spatialGroup);
    spatialGroupRef.current = spatialGroup;

    // Click picking (compartment spheres + imported spatial InstancedMesh cells)
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const spatialHits = raycaster.intersectObjects(spatialGroup.children, false);
      if (spatialHits.length > 0 && typeof spatialHits[0].instanceId === 'number') {
        const picked = propsRef.current.spatialCells[spatialHits[0].instanceId];
        if (picked) {
          setPickedSpatialCell(picked);
          return;
        }
      }

      const hits = raycaster.intersectObjects(nodeGroup.children, true);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData?.nodeId) obj = obj.parent;
        const nid = obj?.userData?.nodeId;
        const found = TME_CONCEPTUAL_NODES.find((n) => n.id === nid);
        if (found) {
          setPickedSpatialCell(null);
          propsRef.current.onSelectNode(found);
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    ro.observe(container);

    const _mat4 = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scale = new THREE.Vector3(1, 1, 1);
    const _col = new THREE.Color();

    let disposed = false;
    let rafId = 0;
    let t = 0;

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
        if (gl2.clientWaitSync(sync, 0, 0) === gl2.TIMEOUT_EXPIRED && performance.now() < deadline) {
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
      t += 0.02;
      const { activeLayers: layers, selectedNodeId: sel } = propsRef.current;

      let pulseIdx = 0;
      for (let ei = 0; ei < edgeEntriesRef.current.length; ei++) {
        const em = edgeEntriesRef.current[ei];
        const visible = layers.includes(em.layer as typeof layers[number]);
        em.mesh.visible = visible;
        for (let k = 0; k < 2; k++) {
          if (pulseIdx >= PULSE_COUNT) break;
          if (!visible) {
            _scale.set(0, 0, 0);
            _mat4.compose(_pos.set(-50, -50, -50), _quat, _scale);
            pulseMesh.setMatrixAt(pulseIdx++, _mat4);
          } else {
            const u = ((t * 0.28 + ei * 0.17 + k * 0.5) % 1 + 1) % 1;
            em.curve.getPointAt(u, _pos);
            _scale.set(1, 1, 1);
            _mat4.compose(_pos, _quat, _scale);
            pulseMesh.setMatrixAt(pulseIdx, _mat4);
            pulseMesh.setColorAt(pulseIdx, _col.setHex(em.color));
            pulseIdx++;
          }
        }
      }
      pulseMesh.instanceMatrix.needsUpdate = true;
      if (pulseMesh.instanceColor) pulseMesh.instanceColor.needsUpdate = true;

      if (hypoxiaCloudRef.current) {
        hypoxiaCloudRef.current.visible = layers.includes('hypoxia');
        hypoxiaCloudRef.current.rotation.y = t * 0.15;
      }
      for (const [nid, ring] of nodeRingsRef.current.entries()) {
        ring.visible = nid === sel;
        if (ring.visible) {
          ring.rotation.x = t * 0.8;
          ring.rotation.y = t * 1.1;
        }
      }

      controls.update();
      renderer.render(scene, camera);
      if (isSoftwareGl) afterDraw(tick);
      else rafId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      disposables.forEach((d) => d.dispose());
      envTarget.dispose();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Update InstancedMesh whenever imported spatial coordinates change
  useEffect(() => {
    setPickedSpatialCell(null);
    const grp = spatialGroupRef.current;
    if (!grp) return;
    while (grp.children.length > 0) {
      const child = grp.children[0] as THREE.InstancedMesh;
      grp.remove(child);
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
    if (spatialCells.length === 0) return;

    // Normalize spatial coordinates around centroid into [-6.5, 6.5] scene box
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const c of spatialCells) {
      cx += c.x_um;
      cy += c.y_um;
      cz += c.z_um;
    }
    cx /= spatialCells.length;
    cy /= spatialCells.length;
    cz /= spatialCells.length;

    let maxSpan = 1;
    for (const c of spatialCells) {
      maxSpan = Math.max(maxSpan, Math.abs(c.x_um - cx), Math.abs(c.y_um - cy), Math.abs(c.z_um - cz));
    }
    const scale = 6.5 / maxSpan;

    let minExpr = Infinity;
    let maxExpr = -Infinity;
    if (heatmapGene) {
      for (const c of spatialCells) {
        const val = c.expression?.[heatmapGene];
        if (typeof val === 'number' && Number.isFinite(val)) {
          if (val < minExpr) minExpr = val;
          if (val > maxExpr) maxExpr = val;
        }
      }
    }
    const exprSpan = Number.isFinite(minExpr) && maxExpr > minExpr ? maxExpr - minExpr : 1;

    const geo = new THREE.SphereGeometry(0.18, 12, 10);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
    const inst = new THREE.InstancedMesh(geo, mat, spatialCells.length);
    const mat4 = new THREE.Matrix4();
    const col = new THREE.Color();

    spatialCells.forEach((c, i) => {
      mat4.makeTranslation((c.x_um - cx) * scale, (c.y_um - cy) * scale, (c.z_um - cz) * scale);
      inst.setMatrixAt(i, mat4);
      if (heatmapGene && typeof c.expression?.[heatmapGene] === 'number') {
        const norm = (c.expression[heatmapGene] - minExpr) / exprSpan;
        inst.setColorAt(i, col.setHex(expressionHeatmapHex(norm)));
      } else {
        inst.setColorAt(i, col.setHex(lineageColor(c.lineage_class)));
      }
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    grp.add(inst);
  }, [spatialCells, heatmapGene]);

  return (
    <div className="relative h-[460px] w-full bg-[#060A11] border border-slate-800 rounded overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#060A11]/92 text-xs font-mono text-amber-300">
          WebGL rendering context interrupted — restoring TME volumetric compartment mesh...
        </div>
      )}

      <div className="absolute top-3 left-3 bg-[#090E18]/95 border border-slate-800 rounded px-2.5 py-1.5 text-[10px] font-mono text-cyan-300 space-y-1">
        <div>
          3D VOLUMETRIC TME COMPARTMENTS
          {spatialCells.length > 0 && (
            <span className="text-emerald-300 ml-2">· {spatialCells.length} Spatial Cells Mapped</span>
          )}
        </div>
        {spatialCells.length > 0 && !heatmapGene && (
          <div className="flex flex-wrap items-center gap-2 text-[9.5px] text-slate-300">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-cyan-500" /> Tumour
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-teal-500" /> Immune
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> CAF/Stroma
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Vessel
            </span>
          </div>
        )}
        {spatialCells.length > 0 && heatmapGene && (
          <div className="flex items-center gap-2 text-[9.5px] text-slate-300">
            <span className="text-amber-300">{heatmapGene} Heatmap:</span>
            <span>Low</span>
            <span className="h-2 w-20 rounded bg-gradient-to-r from-sky-700 via-teal-300 via-yellow-300 to-rose-500" />
            <span>High</span>
          </div>
        )}
        {pickedSpatialCell && (
          <div className="pt-1 border-t border-slate-800 text-[9.5px] text-emerald-300 space-y-0.5">
            <div>
              Selected Spatial Cell: {pickedSpatialCell.cell_id} · {pickedSpatialCell.lineage_class} (
              {pickedSpatialCell.x_um}, {pickedSpatialCell.y_um}, {pickedSpatialCell.z_um} µm)
            </div>
            {pickedSpatialCell.expression && Object.keys(pickedSpatialCell.expression).length > 0 && (
              <div className="text-cyan-300">
                {Object.entries(pickedSpatialCell.expression)
                  .slice(0, 6)
                  .map(([g, v]) => `${g}:${v}`)
                  .join(' · ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collapsible Bottom Dock */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
        <button
          onClick={() => setDockOpen((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-mono bg-[#090E18]/95 border border-slate-800 rounded text-slate-400 hover:text-slate-200"
        >
          {dockOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          {dockOpen ? 'Hide Controls' : 'Show Controls'}
        </button>
        {dockOpen && (
          <div className="flex items-center gap-2 bg-[#090E18]/95 border border-slate-800 rounded px-3 py-1.5 text-[11px] font-mono text-slate-300">
            <button
              onClick={() => {
                if (cameraRef.current && controlsRef.current) {
                  cameraRef.current.position.set(0, 10, 18);
                  controlsRef.current.target.set(0, 0, 0);
                  controlsRef.current.update();
                }
              }}
              className="flex items-center gap-1 px-2 py-0.5 border border-slate-700 hover:border-cyan-500 rounded text-cyan-300"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
            <button
              onClick={() => {
                if (cameraRef.current && controlsRef.current) {
                  cameraRef.current.position.set(0, 4.2, 8.8);
                  controlsRef.current.target.set(-1.2, 0.4, 0);
                  controlsRef.current.update();
                }
              }}
              className="px-2 py-0.5 border border-slate-700 hover:border-cyan-500 rounded text-slate-200"
            >
              Core Niche
            </button>
            <span className="text-slate-500 hidden sm:inline">
              Click any compartment sphere or imported spatial cell
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
