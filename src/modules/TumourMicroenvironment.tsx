import React, { useMemo, useState } from 'react';
import { Download, Sparkles, Trash2, Upload } from 'lucide-react';
import { TME_CONCEPTUAL_EDGES, TME_CONCEPTUAL_NODES, type TmeNodeSpec } from '../data/cancerBiologyCatalog';
import { ThreeTmeViewport, type SpatialCellPoint } from '../simulation/ThreeTmeViewport';

type LayerKey = 'immune' | 'stromal' | 'angiogenesis' | 'hypoxia' | 'inflammatory';

const LAYER_LABELS: Array<{ key: LayerKey; label: string }> = [
  { key: 'immune', label: 'Immune Interactions' },
  { key: 'stromal', label: 'Tumour-Stromal' },
  { key: 'angiogenesis', label: 'Angiogenesis' },
  { key: 'hypoxia', label: 'Hypoxia' },
  { key: 'inflammatory', label: 'Inflammatory Signalling' },
];

const CATEGORY_COLOR: Record<TmeNodeSpec['category'], string> = {
  cancer: '#06b6d4',
  stroma: '#f59e0b',
  immune: '#14b8a6',
  vascular: '#ef4444',
  ecm: '#64748b',
  factor: '#a855f7',
};

const CORE_RESERVED_COLS = new Set(['cell_id', 'id', 'x', 'x_um', 'y', 'y_um', 'z', 'z_um', 'lineage', 'lineage_class', 'class', 'type']);

function parseSpatialMatrix(raw: string): SpatialCellPoint[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cells) ? parsed.cells : [];
    return arr
      .map((r: Record<string, unknown>, i: number) => {
        const expr: Record<string, number> = {};
        if (r.expression && typeof r.expression === 'object') {
          for (const [k, v] of Object.entries(r.expression as Record<string, unknown>)) {
            const num = Number(v);
            if (Number.isFinite(num)) expr[k.toUpperCase()] = num;
          }
        }
        for (const [k, v] of Object.entries(r)) {
          if (!CORE_RESERVED_COLS.has(k.toLowerCase()) && k !== 'expression' && typeof v === 'number' && Number.isFinite(v)) {
            expr[k.toUpperCase()] = v;
          }
        }
        return {
          cell_id: String(r.cell_id ?? r.id ?? `cell_${i + 1}`),
          x_um: Number(r.x_um ?? r.x ?? 0),
          y_um: Number(r.y_um ?? r.y ?? 0),
          z_um: Number(r.z_um ?? r.z ?? 0),
          lineage_class: String(r.lineage_class ?? r.lineage ?? r.type ?? 'unknown'),
          expression: Object.keys(expr).length > 0 ? expr : undefined,
        };
      })
      .filter((c: SpatialCellPoint) => Number.isFinite(c.x_um) && Number.isFinite(c.y_um) && Number.isFinite(c.z_um));
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const rawHeaders = lines[0].split(delim).map((h) => h.trim());
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const idIdx = headers.findIndex((h) => /cell_id|id/.test(h));
  const xIdx = headers.findIndex((h) => h === 'x' || h === 'x_um');
  const yIdx = headers.findIndex((h) => h === 'y' || h === 'y_um');
  const zIdx = headers.findIndex((h) => h === 'z' || h === 'z_um');
  const linIdx = headers.findIndex((h) => /lineage|class|type/.test(h));
  if (xIdx < 0 || yIdx < 0) return [];

  const geneIndices: Array<{ idx: number; name: string }> = [];
  headers.forEach((h, idx) => {
    if (idx !== idIdx && idx !== xIdx && idx !== yIdx && idx !== zIdx && idx !== linIdx && h) {
      geneIndices.push({ idx, name: rawHeaders[idx].toUpperCase() });
    }
  });

  const points: SpatialCellPoint[] = [];
  for (let i = 1; i < Math.min(lines.length, 2500); i++) {
    const cols = lines[i].split(delim).map((c) => c.trim());
    const x_um = Number(cols[xIdx]);
    const y_um = Number(cols[yIdx]);
    const z_um = zIdx >= 0 ? Number(cols[zIdx]) : 0;
    if (Number.isFinite(x_um) && Number.isFinite(y_um) && Number.isFinite(z_um)) {
      const expr: Record<string, number> = {};
      for (const gi of geneIndices) {
        const val = Number(cols[gi.idx]);
        if (Number.isFinite(val)) expr[gi.name] = val;
      }
      points.push({
        cell_id: idIdx >= 0 ? cols[idIdx] || `cell_${i}` : `cell_${i}`,
        x_um,
        y_um,
        z_um,
        lineage_class: linIdx >= 0 ? cols[linIdx] || 'unclassified' : 'unclassified',
        expression: Object.keys(expr).length > 0 ? expr : undefined,
      });
    }
  }
  return points;
}

export const TumourMicroenvironment: React.FC = () => {
  const [activeLayers, setActiveLayers] = useState<LayerKey[]>([
    'immune',
    'stromal',
    'angiogenesis',
    'hypoxia',
    'inflammatory',
  ]);
  const [selectedNode, setSelectedNode] = useState<TmeNodeSpec>(TME_CONCEPTUAL_NODES[0]);
  const [viewMode, setViewMode] = useState<'2d' | '3d_ext'>('2d');
  const [spatialCells, setSpatialCells] = useState<SpatialCellPoint[]>([]);
  const [heatmapGene, setHeatmapGene] = useState<string>('');
  const [spatialFilename, setSpatialFilename] = useState<string>('');
  const [spatialError, setSpatialError] = useState<string>('');

  const toggleLayer = (k: LayerKey) => {
    setActiveLayers((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  const handleSpatialUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSpatialError('');
    try {
      const text = await file.text();
      const parsed = parseSpatialMatrix(text);
      if (parsed.length === 0) {
        setSpatialError('No valid rows found. Include columns: cell_id, x_um, y_um, z_um, lineage_class.');
      } else {
        setSpatialCells(parsed);
        setSpatialFilename(file.name);
      }
    } catch {
      setSpatialError('Unable to parse spatial coordinate file (expected CSV, TSV, or JSON).');
    } finally {
      e.target.value = '';
    }
  };

  const loadSyntheticSpatialSample = () => {
    setSpatialError('');
    setHeatmapGene('');
    const sample: SpatialCellPoint[] = [];
    const lineages = ['tumour', 'tumour', 'cd8_immune', 'caf_stroma', 'endothelial_vessel'];
    for (let i = 0; i < 64; i++) {
      const ang = i * 2.39996;
      const rad = 18 + Math.sqrt(i + 1) * 14;
      const z = ((i * 37) % 90) - 45;
      const lin = i < 24 ? 'tumour' : lineages[i % lineages.length];
      const coreFactor = Math.max(0.05, 1 - rad / 140);
      const isImmune = lin === 'cd8_immune';
      const isStroma = lin === 'caf_stroma';
      const isVessel = lin === 'endothelial_vessel';
      sample.push({
        cell_id: `SYNTH_${String(i + 1).padStart(3, '0')}`,
        x_um: Number((Math.cos(ang) * rad).toFixed(2)),
        y_um: Number((Math.sin(ang) * rad).toFixed(2)),
        z_um: Number(z.toFixed(2)),
        lineage_class: lin,
        expression: {
          HIF1A: Number((coreFactor * 8.4 + (i % 5) * 0.3).toFixed(2)),
          VEGFA: Number((coreFactor * 6.5 + (isVessel ? 2.4 : 0.4)).toFixed(2)),
          CD8A: Number((isImmune ? 7.8 + (1 - coreFactor) * 1.4 : 0.25).toFixed(2)),
          PDCD1: Number((isImmune ? 4.2 + coreFactor * 3.1 : 0.15).toFixed(2)),
          FAP: Number((isStroma ? 7.6 + (i % 4) * 0.4 : 0.35).toFixed(2)),
        },
      });
    }
    setSpatialCells(sample);
    setSpatialFilename('SYNTHETIC_DEMO_TME_64_CELLS.csv');
  };

  const handleExportTmeSnapshot = () => {
    const payload = {
      notice:
        spatialCells.length > 0
          ? 'CONCEPTUAL TME SIGNALLING + IMPORTED/DEMO SPATIAL COORDINATES'
          : 'CONCEPTUAL BIOLOGICAL TME SIGNALLING SNAPSHOT',
      exportedAt: new Date().toISOString(),
      viewMode,
      activeLayers,
      selectedCompartment: selectedNode,
      visibleInteractions: visibleEdges,
      spatialFilename: spatialFilename || null,
      spatialCellCount: spatialCells.length,
      spatialCells,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tme_compartment_snapshot.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleEdges = TME_CONCEPTUAL_EDGES.filter((e) => activeLayers.includes(e.layer));

  const availableGenes = useMemo(() => {
    const set = new Set<string>();
    for (const c of spatialCells) {
      if (c.expression) {
        Object.keys(c.expression).forEach((g) => set.add(g));
      }
    }
    return Array.from(set);
  }, [spatialCells]);

  const spatialAnalytics = useMemo(() => {
    if (spatialCells.length === 0) return null;
    const tumours = spatialCells.filter((c) => /tumou?r|cancer|epith|malign/i.test(c.lineage_class));
    const immunes = spatialCells.filter((c) => /cd8|t_cell|nk|immune|lymph/i.test(c.lineage_class));

    let meanNearestDistUm: number | null = null;
    let infiltratedPct: number | null = null;
    let excludedPct: number | null = null;

    if (tumours.length > 0 && immunes.length > 0) {
      const dists = immunes.map((im) => {
        let best = Infinity;
        for (const tm of tumours) {
          const d = Math.hypot(im.x_um - tm.x_um, im.y_um - tm.y_um, im.z_um - tm.z_um);
          if (d < best) best = d;
        }
        return best;
      });
      meanNearestDistUm = Number((dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(1));
      infiltratedPct = Number(((dists.filter((d) => d <= 25).length / dists.length) * 100).toFixed(1));
      excludedPct = Number(((dists.filter((d) => d >= 50).length / dists.length) * 100).toFixed(1));
    }

    let hifCd8Corr: number | null = null;
    const paired = spatialCells.filter(
      (c) => typeof c.expression?.HIF1A === 'number' && typeof c.expression?.CD8A === 'number'
    );
    if (paired.length >= 4) {
      const xs = paired.map((c) => c.expression!.HIF1A);
      const ys = paired.map((c) => c.expression!.CD8A);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0;
      let dx2 = 0;
      let dy2 = 0;
      for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        dx2 += (xs[i] - mx) ** 2;
        dy2 += (ys[i] - my) ** 2;
      }
      if (dx2 > 0 && dy2 > 0) {
        hifCd8Corr = Number((num / Math.sqrt(dx2 * dy2)).toFixed(3));
      }
    }

    return {
      tumourCount: tumours.length,
      immuneCount: immunes.length,
      meanNearestDistUm,
      infiltratedPct,
      excludedPct,
      hifCd8Corr,
    };
  }, [spatialCells]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Tumour Microenvironment</h1>
          <p className="text-xs text-slate-400 mt-1">
            Interactive 2D spatial signalling diagram & 3D volumetric compartment renderer with spatial coordinate import
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 border border-slate-800 bg-[#0D131F] rounded">
          <button
            onClick={() => setViewMode('2d')}
            className={`px-3 py-1 text-xs rounded ${
              viewMode === '2d' ? 'bg-cyan-600 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            2D Spatial Model
          </button>
          <button
            onClick={() => setViewMode('3d_ext')}
            className={`px-3 py-1 text-xs rounded ${
              viewMode === '3d_ext' ? 'bg-cyan-600 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            3D Volumetric Model
          </button>
        </div>
      </div>

      <div className="p-2.5 border border-cyan-900/50 bg-[#0B121F] rounded text-xs font-mono text-cyan-300">
        {spatialCells.length > 0
          ? `SPATIAL COORDINATES LOADED (${spatialFilename} · ${spatialCells.length} cells) + CONCEPTUAL SIGNALLING OVERLAY`
          : 'CONCEPTUAL BIOLOGICAL DIAGRAM — Represents established literature-level cellular relationships unless a validated spatial transcriptomics/proteomics matrix is loaded.'}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main Spatial Canvas (2D SVG OR 3D WebGL Volumetric Renderer) */}
        <div className="lg:col-span-2 border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div className="flex flex-wrap gap-2">
              {LAYER_LABELS.map((l) => {
                const active = activeLayers.includes(l.key);
                return (
                  <button
                    key={l.key}
                    onClick={() => toggleLayer(l.key)}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                      active
                        ? 'border-cyan-600/80 bg-cyan-950/40 text-cyan-300'
                        : 'border-slate-800 bg-[#070B12] text-slate-500'
                    }`}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {viewMode === '3d_ext' && (
                <>
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border border-cyan-700/70 hover:border-cyan-400 text-cyan-300 rounded cursor-pointer">
                    <Upload className="w-3 h-3" /> Import Coordinates (CSV/JSON)
                    <input type="file" accept=".csv,.tsv,.json" onChange={handleSpatialUpload} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={loadSyntheticSpatialSample}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono border border-amber-700/70 hover:border-amber-500 text-amber-300 rounded"
                  >
                    <Sparkles className="w-3 h-3" /> Load Demo Spatial Sample
                  </button>
                  {spatialCells.length > 0 && (
                    <button
                      onClick={() => {
                        setSpatialCells([]);
                        setHeatmapGene('');
                        setSpatialFilename('');
                      }}
                      title="Clear imported spatial points"
                      className="p-1 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
              {viewMode === '3d_ext' && availableGenes.length > 0 && (
                <select
                  value={heatmapGene}
                  onChange={(e) => setHeatmapGene(e.target.value)}
                  className="px-2 py-1 text-[11px] font-mono bg-[#070B12] border border-cyan-800/70 rounded text-cyan-300"
                >
                  <option value="">3D Color: Lineage Class</option>
                  {availableGenes.map((g) => (
                    <option key={g} value={g}>
                      3D Heatmap: {g}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={handleExportTmeSnapshot}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono border border-slate-700 hover:border-cyan-500 text-slate-300 rounded"
              >
                <Download className="w-3 h-3 text-cyan-400" /> Export JSON
              </button>
            </div>
          </div>

          {spatialError && (
            <div className="p-2 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{spatialError}</div>
          )}

          {viewMode === '3d_ext' && spatialAnalytics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 border border-slate-800 bg-[#070B12] rounded text-[11px] font-mono">
              <div>
                <div className="text-[10px] text-slate-500">CD8+ → Tumour NN Dist</div>
                <div className="text-cyan-300 font-semibold">
                  {spatialAnalytics.meanNearestDistUm !== null ? `${spatialAnalytics.meanNearestDistUm} µm` : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">Infiltrated (≤25 µm)</div>
                <div className="text-emerald-300 font-semibold">
                  {spatialAnalytics.infiltratedPct !== null ? `${spatialAnalytics.infiltratedPct}%` : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">Immune-Excluded (≥50 µm)</div>
                <div className="text-amber-300 font-semibold">
                  {spatialAnalytics.excludedPct !== null ? `${spatialAnalytics.excludedPct}%` : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500">Spatial r(HIF1A, CD8A)</div>
                <div className="text-rose-300 font-semibold">
                  {spatialAnalytics.hifCd8Corr !== null ? spatialAnalytics.hifCd8Corr : 'N/A'}
                </div>
              </div>
            </div>
          )}

          {viewMode === '3d_ext' ? (
            <ThreeTmeViewport
              activeLayers={activeLayers}
              selectedNodeId={selectedNode.id}
              onSelectNode={setSelectedNode}
              spatialCells={spatialCells}
              heatmapGene={heatmapGene}
            />
          ) : (
            <div className="border border-slate-800 bg-[#060A11] rounded overflow-hidden">
              <svg viewBox="0 0 650 430" className="w-full h-auto">
                <defs>
                  <radialGradient id="hypoxiaGrad" cx="38%" cy="32%" r="35%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#060A11" stopOpacity="0" />
                  </radialGradient>
                  <marker id="tmeArrow" viewBox="0 0 10 10" refX="26" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4" />
                  </marker>
                  <marker id="tmeInhibit" viewBox="0 0 10 10" refX="24" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <rect x="7" y="1" width="2" height="8" fill="#f59e0b" />
                  </marker>
                </defs>

                {activeLayers.includes('hypoxia') && (
                  <rect x="0" y="0" width="650" height="430" fill="url(#hypoxiaGrad)" />
                )}

                {visibleEdges.map((edge, idx) => {
                  const s = TME_CONCEPTUAL_NODES.find((n) => n.id === edge.from);
                  const t = TME_CONCEPTUAL_NODES.find((n) => n.id === edge.to);
                  if (!s || !t) return null;
                  const mx = (s.x + t.x) / 2;
                  const my = (s.y + t.y) / 2;
                  const stroke =
                    edge.polarity === 'inhibitory'
                      ? '#f59e0b'
                      : edge.polarity === 'remodelling'
                      ? '#94a3b8'
                      : '#06b6d4';
                  return (
                    <g key={idx}>
                      <line
                        x1={s.x}
                        y1={s.y}
                        x2={t.x}
                        y2={t.y}
                        stroke={stroke}
                        strokeWidth="1.4"
                        strokeDasharray={edge.polarity === 'inhibitory' ? '4 3' : undefined}
                        strokeOpacity="0.75"
                        markerEnd={edge.polarity === 'inhibitory' ? 'url(#tmeInhibit)' : 'url(#tmeArrow)'}
                      />
                      <text x={mx} y={my - 4} fill="#cbd5e1" fontSize="8.5" textAnchor="middle" fontFamily="IBM Plex Mono">
                        {edge.label}
                      </text>
                    </g>
                  );
                })}

                {TME_CONCEPTUAL_NODES.map((node) => {
                  const isSel = selectedNode.id === node.id;
                  const color = CATEGORY_COLOR[node.category];
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      onClick={() => setSelectedNode(node)}
                      className="cursor-pointer"
                    >
                      <circle
                        r={node.radius}
                        fill="#0D131F"
                        stroke={color}
                        strokeWidth={isSel ? 2.8 : 1.5}
                        fillOpacity="0.92"
                      />
                      <text y="3" fill="#f1f5f9" fontSize="9" fontWeight="600" textAnchor="middle">
                        {node.label.split(' ')[0]}
                      </text>
                      <text y={node.radius + 13} fill="#94a3b8" fontSize="8.5" textAnchor="middle">
                        {node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>

        {/* Selected Compartment Inspector */}
        <aside className="border border-slate-800/90 bg-[#0D131F] rounded-md p-5 space-y-4 text-xs">
          <div className="border-b border-slate-800 pb-3">
            <div className="font-mono text-[11px] uppercase" style={{ color: CATEGORY_COLOR[selectedNode.category] }}>
              {selectedNode.category} compartment · {selectedNode.layer}
            </div>
            <h2 className="text-base font-semibold text-slate-100 mt-0.5">{selectedNode.label}</h2>
          </div>

          <p className="text-slate-300 leading-relaxed">{selectedNode.roleSummary}</p>

          <div>
            <div className="font-mono text-[11px] text-slate-400 mb-1">Canonical Markers</div>
            <div className="font-mono text-cyan-300">{selectedNode.keyMarkers.join(' · ')}</div>
          </div>

          <div>
            <div className="font-mono text-[11px] text-slate-400 mb-1">Soluble & Matrix Signalling Outputs</div>
            <div className="font-mono text-teal-300">{selectedNode.signallingOutputs.join(' · ')}</div>
          </div>

          <div className="pt-3 border-t border-slate-800 space-y-1.5">
            <div className="font-mono text-[11px] text-slate-400">Active Interactions</div>
            {visibleEdges
              .filter((e) => e.from === selectedNode.id || e.to === selectedNode.id)
              .map((e, i) => (
                <div key={i} className="p-2 border border-slate-800 bg-[#070B12] rounded font-mono text-[11px]">
                  <span className="text-slate-200">{e.from}</span> → <span className="text-slate-200">{e.to}</span>
                  <div className="text-slate-400 mt-0.5">
                    {e.label} ({e.polarity})
                  </div>
                </div>
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
};
