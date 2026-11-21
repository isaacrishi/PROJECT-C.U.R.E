import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Columns,
  Maximize2,
  MousePointerSquareDashed,
  RotateCcw,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { User } from '../types';

interface PathologyImageRow {
  id: string;
  title: string;
  filename: string;
  mime_type: string;
  file_size: number;
  stain_type: string;
  magnification: string;
  tissue_origin: string;
  notes: string;
  model_connected: string;
  created_at: string;
}

interface ImageAnnotationRow {
  id: string;
  label: string;
  annotation_type: string;
  region_json: string;
  measurement_source: string;
  notes: string;
  author_name: string;
  created_at: string;
}

interface RoiOpticalMetrics {
  pixelsSampled: number;
  meanLuminance: number;
  hematoxylinIndex: number;
  eosinIndex: number;
  darkNucleiPixelPct: number;
  regionLabel: string;
}

interface PathologyIntelligenceProps {
  user: User | null;
  activeProjectId: string | null;
  onOpenAuth: () => void;
}

export const PathologyIntelligence: React.FC<PathologyIntelligenceProps> = ({
  user,
  activeProjectId,
  onOpenAuth,
}) => {
  const [images, setImages] = useState<PathologyImageRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [annotations, setAnnotations] = useState<ImageAnnotationRow[]>([]);

  const [title, setTitle] = useState('');
  const [stainType, setStainType] = useState('H&E');
  const [magnification, setMagnification] = useState('20x');
  const [tissueOrigin, setTissueOrigin] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Viewer pan/zoom & manual ROI state (up to 40x optical inspection)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [drawRoiMode, setDrawRoiMode] = useState(false);
  const [roiDraft, setRoiDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const roiStart = useRef<{ x: number; y: number } | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const imgElementRef = useRef<HTMLImageElement | null>(null);
  const [opticalMetrics, setOpticalMetrics] = useState<RoiOpticalMetrics | null>(null);

  const [roiLabel, setRoiLabel] = useState('');
  const [roiNotes, setRoiNotes] = useState('');

  const loadImages = async () => {
    if (!user) {
      setImages([]);
      setSelectedId(null);
      setCompareId(null);
      setAnnotations([]);
      return;
    }
    try {
      const q = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
      const res = await apiFetch<{ images: PathologyImageRow[] }>(`/api/pathology/images${q}`);
      setImages(res.images);
      if (res.images.length > 0 && (!selectedId || !res.images.some((i) => i.id === selectedId))) {
        setSelectedId(res.images[0].id);
      } else if (res.images.length === 0) {
        setSelectedId(null);
      }
      if (compareId && !res.images.some((i) => i.id === compareId)) {
        setCompareId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load histopathology slides');
    }
  };

  useEffect(() => {
    loadImages();
  }, [user?.id, activeProjectId]);

  useEffect(() => {
    setOpticalMetrics(null);
    if (!selectedId || !user) {
      setAnnotations([]);
      return;
    }
    apiFetch<{ annotations: ImageAnnotationRow[] }>(`/api/pathology/images/${selectedId}/annotations`)
      .then((res) => setAnnotations(res.annotations))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Unable to load ROI annotations');
      });
  }, [selectedId, user?.id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user) return onOpenAuth();
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('title', title.trim() || file.name);
      form.append('stainType', stainType);
      form.append('magnification', magnification);
      form.append('tissueOrigin', tissueOrigin);
      if (activeProjectId) form.append('projectId', activeProjectId);
      const res = await apiFetch<{ image: PathologyImageRow }>('/api/pathology/upload', {
        method: 'POST',
        body: form,
      });
      setTitle('');
      setTissueOrigin('');
      await loadImages();
      setSelectedId(res.image.id);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteImage = async (id: string) => {
    try {
      await apiFetch(`/api/pathology/images/${id}`, { method: 'DELETE' });
      if (compareId === id) setCompareId(null);
      await loadImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete slide');
    }
  };

  const handleDeleteAnnotation = async (annId: string) => {
    if (!selectedId) return;
    try {
      await apiFetch(`/api/pathology/annotations/${annId}`, { method: 'DELETE' });
      const res = await apiFetch<{ annotations: ImageAnnotationRow[] }>(`/api/pathology/images/${selectedId}/annotations`);
      setAnnotations(res.annotations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete annotation');
    }
  };

  const measureOpticalStainDensity = () => {
    const imgEl = imgElementRef.current;
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) {
      setError('Wait for the PNG/JPEG slide image to finish loading before measuring pixel density.');
      return;
    }
    setError('');
    const canvas = document.createElement('canvas');
    const w = Math.min(512, imgEl.naturalWidth);
    const h = Math.min(512, imgEl.naturalHeight);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(imgEl, 0, 0, w, h);

    // Map optional ROI box (percent of container) or sample full slide
    const sx = roiDraft && roiDraft.w > 2 ? Math.floor((roiDraft.x / 100) * w) : 0;
    const sy = roiDraft && roiDraft.h > 2 ? Math.floor((roiDraft.y / 100) * h) : 0;
    const sw = roiDraft && roiDraft.w > 2 ? Math.max(4, Math.floor((roiDraft.w / 100) * w)) : w;
    const sh = roiDraft && roiDraft.h > 2 ? Math.max(4, Math.floor((roiDraft.h / 100) * h)) : h;

    const data = ctx.getImageData(sx, sy, Math.min(w - sx, sw), Math.min(h - sy, sh)).data;
    const totalPixels = data.length / 4;
    if (totalPixels === 0) return;

    let lumSum = 0;
    let blueDominantSum = 0;
    let pinkDominantSum = 0;
    let darkNucleiCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      lumSum += lum;
      // Hematoxylin basophilia tends to elevate blue vs green/red in darker chromatin pixels
      if (b > g && lum < 0.65) blueDominantSum += (b - g) / 255;
      // Eosin eosinophilia elevates red relative to green
      if (r > g) pinkDominantSum += (r - g) / 255;
      if (lum < 0.42) darkNucleiCount++;
    }

    setOpticalMetrics({
      pixelsSampled: totalPixels,
      meanLuminance: Number(((lumSum / totalPixels) * 100).toFixed(1)),
      hematoxylinIndex: Number((blueDominantSum / totalPixels).toFixed(3)),
      eosinIndex: Number((pinkDominantSum / totalPixels).toFixed(3)),
      darkNucleiPixelPct: Number(((darkNucleiCount / totalPixels) * 100).toFixed(1)),
      regionLabel: roiDraft && roiDraft.w > 2 ? 'Drawn ROI Box' : 'Full Visible Slide',
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (drawRoiMode && viewerRef.current) {
      const rect = viewerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      roiStart.current = { x, y };
      setRoiDraft({ x, y, w: 0, h: 0 });
    } else {
      setDragging(true);
      dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (drawRoiMode && roiStart.current && viewerRef.current) {
      const rect = viewerRef.current.getBoundingClientRect();
      const cx = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const cy = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      setRoiDraft({
        x: Math.min(roiStart.current.x, cx),
        y: Math.min(roiStart.current.y, cy),
        w: Math.abs(cx - roiStart.current.x),
        h: Math.abs(cy - roiStart.current.y),
      });
    } else if (dragging) {
      setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
    roiStart.current = null;
  };

  const handleWheelZoom = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 0.84;
    setZoom((z) => Math.max(0.25, Math.min(40, Number((z * factor).toFixed(2)))));
  };

  const saveAnnotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedId) return;
    if (!roiLabel.trim()) return;
    try {
      await apiFetch(`/api/pathology/images/${selectedId}/annotations`, {
        method: 'POST',
        body: JSON.stringify({
          label: roiLabel.trim(),
          annotation_type: roiDraft ? 'manual_roi_box' : 'manual_observation',
          region: roiDraft ?? { noteOnly: true },
          notes: roiNotes.trim(),
        }),
      });
      setRoiLabel('');
      setRoiNotes('');
      setRoiDraft(null);
      setDrawRoiMode(false);
      const res = await apiFetch<{ annotations: ImageAnnotationRow[] }>(`/api/pathology/images/${selectedId}/annotations`);
      setAnnotations(res.annotations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save annotation');
    }
  };

  const selectedImg = images.find((i) => i.id === selectedId) || null;
  const compareImg = images.find((i) => i.id === compareId) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Pathology Intelligence</h1>
          <p className="text-xs text-slate-400 mt-1">
            High-resolution histopathology viewer (up to 40x wheel zoom), pixel stain optical-density tool, ROI annotations & side-by-side slide comparison
          </p>
        </div>
        <div className="text-[11px] font-mono text-amber-300 border border-amber-800/60 bg-amber-950/30 px-3 py-1.5 rounded">
          Exploratory Research Only — Not for diagnostic, malignancy, or clinical treatment decisions
        </div>
      </div>

      {error && (
        <div className="p-3 border border-rose-800/60 bg-rose-950/30 rounded text-xs text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Upload & Slide List */}
        <aside className="lg:col-span-1 space-y-4">
          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2.5">
            <div className="text-xs font-semibold text-slate-200">Upload Histopathology Image</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Slide title / sample ID"
              className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={stainType}
                onChange={(e) => setStainType(e.target.value)}
                placeholder="Stain (H&E, IHC)"
                className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
              <input
                value={magnification}
                onChange={(e) => setMagnification(e.target.value)}
                placeholder="Mag (20x, 40x)"
                className="px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
            </div>
            <input
              value={tissueOrigin}
              onChange={(e) => setTissueOrigin(e.target.value)}
              placeholder="Tissue origin (e.g., Lung adenocarcinoma)"
              className="w-full px-2.5 py-1.5 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
            />
            <label className="flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded cursor-pointer">
              <Upload className="w-3.5 h-3.5" /> {uploading ? 'Uploading...' : 'Select PNG / JPEG / TIFF'}
              <input type="file" accept="image/png,image/jpeg,image/tiff" onChange={handleUpload} className="hidden" />
            </label>
          </div>

          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Uploaded Slides ({images.length})
            </div>
            {images.length === 0 ? (
              <p className="text-xs text-slate-500">No histopathology images uploaded.</p>
            ) : (
              images.map((img) => (
                <div
                  key={img.id}
                  className={`flex items-start justify-between gap-2 p-2.5 rounded border text-xs ${
                    selectedId === img.id
                      ? 'border-cyan-600/80 bg-[#070B12] text-slate-100'
                      : 'border-slate-800/70 bg-[#0A0F18] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <button
                    onClick={() => {
                      setSelectedId(img.id);
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="font-medium truncate">{img.title}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                      {img.stain_type} · {img.magnification} · {(img.file_size / 1024).toFixed(1)} KB
                    </div>
                  </button>
                  <button
                    onClick={() => handleDeleteImage(img.id)}
                    title="Delete slide"
                    className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main High-Res Viewer & ROI Annotator */}
        <div className="lg:col-span-3 space-y-4">
          <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setZoom((z) => Math.min(40, Number((z * 1.4).toFixed(2))))}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-700 rounded text-slate-200 hover:border-cyan-500"
                >
                  <ZoomIn className="w-3.5 h-3.5" /> Zoom +
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(0.25, Number((z / 1.4).toFixed(2))))}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-700 rounded text-slate-200 hover:border-cyan-500"
                >
                  <ZoomOut className="w-3.5 h-3.5" /> Zoom -
                </button>
                <button
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-700 rounded text-slate-200 hover:border-cyan-500"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset ({zoom.toFixed(1)}x)
                </button>
                <button
                  onClick={() => setDrawRoiMode((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs border rounded ${
                    drawRoiMode
                      ? 'border-cyan-500 bg-cyan-950/50 text-cyan-300'
                      : 'border-slate-700 text-slate-200 hover:border-cyan-500'
                  }`}
                >
                  <MousePointerSquareDashed className="w-3.5 h-3.5" /> {drawRoiMode ? 'Drawing ROI Box...' : 'Select Tissue ROI'}
                </button>
                <button
                  onClick={measureOpticalStainDensity}
                  disabled={!selectedImg || selectedImg.mime_type === 'image/tiff'}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-teal-700 text-teal-300 hover:bg-teal-950/40 rounded disabled:opacity-40"
                >
                  <Activity className="w-3.5 h-3.5" /> Measure Stain Optical Density
                </button>
                <button
                  onClick={() => setCompareMode((v) => !v)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs border rounded ${
                    compareMode
                      ? 'border-teal-500 bg-teal-950/50 text-teal-300'
                      : 'border-slate-700 text-slate-200 hover:border-teal-500'
                  }`}
                >
                  <Columns className="w-3.5 h-3.5" /> Compare Slides
                </button>
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                {selectedImg ? `${selectedImg.filename} · ${selectedImg.tissue_origin || 'Origin N/A'}` : 'No slide selected'}
              </div>
            </div>

            {/* Viewport */}
            <div className={`grid gap-3 ${compareMode ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
              <div
                ref={viewerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheelZoom}
                className={`relative h-[400px] border border-slate-800 bg-[#05080E] rounded overflow-hidden select-none ${
                  drawRoiMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
                }`}
              >
                {!selectedImg ? (
                  <div className="h-full flex flex-col items-center justify-center text-xs text-slate-500 gap-2">
                    <Maximize2 className="w-6 h-6 text-slate-600" />
                    <span>Upload a PNG, JPEG, or TIFF histopathology image to inspect tissue regions.</span>
                  </div>
                ) : selectedImg.mime_type === 'image/tiff' ? (
                  <div className="h-full flex flex-col items-center justify-center text-xs text-slate-300 p-4 text-center space-y-2">
                    <div className="font-mono text-cyan-400">TIFF Archive Stored ({selectedImg.filename})</div>
                    <p className="text-slate-400 max-w-md">
                      Native browser rendering for uncompressed multi-page TIFF requires server tile conversion. Convert to PNG/JPEG for interactive canvas zoom/pan, or record metadata & annotations below.
                    </p>
                  </div>
                ) : (
                  <img
                    ref={imgElementRef}
                    src={`/api/pathology/images/${selectedImg.id}/file`}
                    alt={selectedImg.title}
                    draggable={false}
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      transformOrigin: 'center center',
                      imageRendering: zoom > 6 ? 'pixelated' : 'auto',
                    }}
                    className="w-full h-full object-contain pointer-events-none"
                  />
                )}

                {annotations.map((ann) => {
                  try {
                    const r = JSON.parse(ann.region_json);
                    if (typeof r.x !== 'number' || typeof r.w !== 'number' || r.w <= 0) return null;
                    return (
                      <div
                        key={ann.id}
                        style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
                        className="absolute border border-cyan-400 bg-cyan-500/10 pointer-events-none"
                      >
                        <span className="bg-[#070B12]/90 text-cyan-300 text-[10px] font-mono px-1">
                          {ann.label}
                        </span>
                      </div>
                    );
                  } catch {
                    return null;
                  }
                })}

                {roiDraft && roiDraft.w > 0 && (
                  <div
                    style={{ left: `${roiDraft.x}%`, top: `${roiDraft.y}%`, width: `${roiDraft.w}%`, height: `${roiDraft.h}%` }}
                    className="absolute border border-dashed border-amber-400 bg-amber-400/10 pointer-events-none"
                  />
                )}
              </div>

              {compareMode && (
                <div className="h-[400px] border border-slate-800 bg-[#05080E] rounded flex flex-col">
                  <div className="p-2 border-b border-slate-800">
                    <select
                      value={compareId || ''}
                      onChange={(e) => setCompareId(e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-[#0D131F] border border-slate-800 rounded text-slate-200"
                    >
                      <option value="">Select comparison slide...</option>
                      {images.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.title} ({i.stain_type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 flex items-center justify-center overflow-hidden">
                    {compareImg ? (
                      compareImg.mime_type === 'image/tiff' ? (
                        <div className="p-4 text-center text-xs space-y-1">
                          <div className="font-mono text-cyan-400">TIFF Archive ({compareImg.filename})</div>
                          <p className="text-slate-400">
                            Uncompressed TIFF slides require PNG/JPEG conversion for browser side-by-side preview.
                          </p>
                        </div>
                      ) : (
                        <img
                          src={`/api/pathology/images/${compareImg.id}/file`}
                          alt={compareImg.title}
                          className="w-full h-full object-contain"
                        />
                      )
                    ) : (
                      <span className="text-xs text-slate-500">Choose a second slide to compare morphology</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Manual ROI Annotation Form */}
            <form onSubmit={saveAnnotation} className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2.5 text-xs">
              <div className="font-mono text-[11px] text-cyan-400">
                Manual Tissue-Region Annotation (Human-Entered)
              </div>
              <input
                value={roiLabel}
                onChange={(e) => setRoiLabel(e.target.value)}
                placeholder="Region label (e.g., Stromal lymphocytic infiltrate)"
                className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
              <textarea
                rows={2}
                value={roiNotes}
                onChange={(e) => setRoiNotes(e.target.value)}
                placeholder="Morphological notes..."
                className="w-full px-3 py-1.5 bg-[#070B12] border border-slate-800 rounded text-slate-100"
              />
              <button
                type="submit"
                disabled={!selectedId || !roiLabel.trim()}
                className="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold rounded disabled:opacity-50"
              >
                Save Manual Annotation
              </button>

              {annotations.length > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-1.5 max-h-36 overflow-y-auto">
                  {annotations.map((a) => (
                    <div key={a.id} className="border border-slate-800 bg-[#070B12] p-2 rounded flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-200">
                          {a.label}{' '}
                          <span className="text-[10px] font-mono text-slate-500">· {a.measurement_source}</span>
                        </div>
                        {a.notes && <div className="text-slate-400 mt-0.5">{a.notes}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteAnnotation(a.id)}
                        title="Delete annotation"
                        className="text-slate-500 hover:text-rose-400 p-0.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </form>

            {/* Pixel Optical Density Results + Honest External Model Connector Status */}
            <div className="border border-slate-800/90 bg-[#0D131F] rounded-md p-4 space-y-2.5 text-xs">
              <div className="font-mono text-[11px] text-amber-400">
                Pixel Stain Optical-Density & External Model Connector
              </div>
              {opticalMetrics ? (
                <div className="border border-teal-800/70 bg-[#070B12] rounded p-3 space-y-2 font-mono text-[11px]">
                  <div className="text-teal-300 flex justify-between">
                    <span>Measured Region: {opticalMetrics.regionLabel}</span>
                    <span>{opticalMetrics.pixelsSampled.toLocaleString()} px</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-200">
                    <div>Basophilia (Hematoxylin): <span className="text-cyan-300">{opticalMetrics.hematoxylinIndex}</span></div>
                    <div>Eosinophilia (Eosin): <span className="text-rose-300">{opticalMetrics.eosinIndex}</span></div>
                    <div>Mean Luminance: <span className="text-slate-100">{opticalMetrics.meanLuminance}%</span></div>
                    <div>Dark Chromatin Area: <span className="text-amber-300">{opticalMetrics.darkNucleiPixelPct}%</span></div>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Client-side raw RGB pixel optical measurement only — NOT diagnostic nuclei classification.
                  </div>
                </div>
              ) : (
                <div className="p-2.5 border border-slate-800 bg-[#070B12] rounded font-mono text-[11px] text-slate-300">
                  External ML Pathology Server: None connected (use &quot;Measure Stain Optical Density&quot; above for deterministic RGB stain quantification on PNG/JPEG slides).
                </div>
              )}
              <p className="text-slate-400 leading-relaxed">
                Automated clinical nuclei segmentation or malignancy scoring requires an externally validated inference service (e.g., MONAI / HoverNet). CURE never synthesizes diagnostic cell counts.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
