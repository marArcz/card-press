import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Grid3X3,
  Image as ImageIcon,
  Layers,
  Loader2,
  Magnet,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Trash2,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  AssetLayer,
  BorderStyle,
  CardDesign,
  ContentBlock,
  ContentMode,
  DesignUpdateOptions,
  EntryRow,
  ImageFit,
  PrintSheetConfig,
  RulerGuide,
  SelectedLayerItem,
} from '../types';
import { CARD_SIZE_PRESETS } from '../utils/sampleData';
import {
  computeSheetMetrics,
  formatDimension,
  inToMm,
  mmToIn,
} from '../utils/cardRenderer';
import { CardPreview } from './CardPreview';
import { CanvasRulerFrame } from './CanvasRulerFrame';
import { DesignInspector, GroupAlignmentAction } from './DesignInspector';

type RailTab = 'format' | 'reference' | 'assets' | 'contents';

interface DesignViewProps {
  design: CardDesign;
  entries: EntryRow[];
  columns: string[];
  sheetConfig: PrintSheetConfig;
  activeEntryIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBeginDesignTransaction: () => void;
  onEndDesignTransaction: (didChange: boolean) => void;
  onChangeActiveEntryIndex: (index: number) => void;
  onUpdateDesign: (
    updater: (prev: CardDesign) => CardDesign,
    options?: DesignUpdateOptions
  ) => void;
  onResetDesign: () => void;
}

const PAPER_SWATCHES = ['#FFFFFF', '#FAF9F6', '#F4F4F5', '#EFF6FF', '#FEFCE8', '#18181B'];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

async function prepareImageForVision(dataUrl: string): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxEdge = 1280;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxEdge || h > maxEdge) {
        const ratio = Math.min(maxEdge / w, maxEdge / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process reference image.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const jpegUrl = canvas.toDataURL('image/jpeg', 0.88);
      const base64 = jpegUrl.split(',')[1] ?? '';
      resolve({ base64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Unable to decode image file.'));
    img.src = dataUrl;
  });
}

export function DesignView({
  design,
  entries,
  columns,
  sheetConfig,
  activeEntryIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBeginDesignTransaction,
  onEndDesignTransaction,
  onChangeActiveEntryIndex,
  onUpdateDesign,
  onResetDesign,
}: DesignViewProps) {
  const [railTab, setRailTab] = useState<RailTab>('format');
  const [selectedLayers, setSelectedLayers] = useState<SelectedLayerItem[]>([]);
  const [zoomPct, setZoomPct] = useState<number>(100);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showRulers, setShowRulers] = useState<boolean>(true);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [gridSpacingMm, setGridSpacingMm] = useState<number>(5);
  const [guides, setGuides] = useState<RulerGuide[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const handleAddGuide = useCallback((guide: RulerGuide) => {
    setGuides((prev) => [...prev, guide]);
  }, []);

  const handleUpdateGuide = useCallback((id: string, positionMm: number) => {
    setGuides((prev) => prev.map((g) => (g.id === id ? { ...g, positionMm } : g)));
  }, []);

  const handleRemoveGuide = useCallback((id: string) => {
    setGuides((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const handleClearGuides = useCallback(() => {
    setGuides([]);
  }, []);

  const gridSpacingOptions =
    design.unit === 'in'
      ? [
          { label: '0.1 in', mm: 2.54 },
          { label: '0.25 in', mm: 6.35 },
          { label: '0.5 in', mm: 12.7 },
        ]
      : [
          { label: '2 mm', mm: 2 },
          { label: '5 mm', mm: 5 },
          { label: '10 mm', mm: 10 },
        ];

  const activeGridOptionMm = gridSpacingOptions.reduce((closest, opt) =>
    Math.abs(opt.mm - gridSpacingMm) < Math.abs(closest.mm - gridSpacingMm) ? opt : closest
  ).mm;

  const refInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const exactZoomRef = useRef<number>(100);

  const setZoomClamped = useCallback((nextZoom: number) => {
    const clamped = Math.min(300, Math.max(25, nextZoom));
    exactZoomRef.current = clamped;
    setZoomPct(Math.round(clamped));
  }, []);

  // Scroll-wheel & trackpad pinch zooming over the drafting canvas
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      // Allow Shift+scroll to pan horizontally if the user wants
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      const normalizedDelta =
        e.deltaMode === 1
          ? e.deltaY * 16
          : e.deltaMode === 2
          ? e.deltaY * 400
          : e.deltaY;

      if (normalizedDelta === 0) return;

      const sensitivity = e.ctrlKey || e.metaKey ? 0.008 : 0.0014;
      const prevExact = exactZoomRef.current;
      const nextExact = Math.min(300, Math.max(25, prevExact * Math.exp(-normalizedDelta * sensitivity)));
      exactZoomRef.current = nextExact;

      const prevRounded = Math.round(prevExact);
      const nextRounded = Math.round(nextExact);

      if (nextRounded === prevRounded) return;

      // Capture pointer position relative to scrollable content to keep zoom anchored around cursor
      const rect = viewport.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const contentX = viewport.scrollLeft + pointerX;
      const contentY = viewport.scrollTop + pointerY;
      const ratio = nextRounded / prevRounded;

      setZoomPct(nextRounded);

      requestAnimationFrame(() => {
        if (viewport.scrollWidth > viewport.clientWidth) {
          viewport.scrollLeft = contentX * ratio - pointerX;
        }
        if (viewport.scrollHeight > viewport.clientHeight) {
          viewport.scrollTop = contentY * ratio - pointerY;
        }
      });
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, []);

  const safeEntryIndex = entries.length > 0 ? Math.min(activeEntryIndex, entries.length - 1) : 0;
  const activeEntry = entries[safeEntryIndex];

  const sheetMetrics = computeSheetMetrics(design, sheetConfig, Math.max(1, entries.length));

  const baseCanvasWidthPx = Math.min(580, Math.max(320, design.widthMm * 3.8));
  const renderedWidthPx = Math.round((baseCanvasWidthPx * zoomPct) / 100);

  // Prune any selected IDs that no longer exist (e.g. after Undo/Redo)
  useEffect(() => {
    setSelectedLayers((prev) => {
      const next = prev.filter((item) =>
        item.type === 'content'
          ? design.contentBlocks.some((b) => b.id === item.id)
          : design.assets.some((a) => a.id === item.id)
      );
      return next.length === prev.length ? prev : next;
    });
  }, [design.contentBlocks, design.assets]);

  const deleteSelectedLayers = useCallback(() => {
    if (selectedLayers.length === 0) return;
    const contentIds = new Set(
      selectedLayers.filter((l) => l.type === 'content').map((l) => l.id)
    );
    const assetIds = new Set(
      selectedLayers.filter((l) => l.type === 'asset').map((l) => l.id)
    );
    onUpdateDesign((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.filter((b) => !contentIds.has(b.id)),
      assets: prev.assets.filter((a) => !assetIds.has(a.id)),
    }));
    setSelectedLayers([]);
  }, [selectedLayers, onUpdateDesign]);

  const duplicateSelectedLayers = useCallback(() => {
    if (selectedLayers.length === 0) return;
    const stamp = Date.now();
    const newSelection: SelectedLayerItem[] = [];
    const newBlocks: ContentBlock[] = [];
    const newAssets: AssetLayer[] = [];

    selectedLayers.forEach((item, idx) => {
      if (item.type === 'content') {
        const orig = design.contentBlocks.find((b) => b.id === item.id);
        if (!orig) return;
        const copyId = `blk-${stamp}-${idx}`;
        newBlocks.push({
          ...orig,
          id: copyId,
          label: `${orig.label} Copy`,
          yPct: Math.min(92, orig.yPct + 5),
        });
        newSelection.push({ type: 'content', id: copyId });
      } else {
        const orig = design.assets.find((a) => a.id === item.id);
        if (!orig) return;
        const copyId = `asset-${stamp}-${idx}`;
        newAssets.push({
          ...orig,
          id: copyId,
          name: `${orig.name} Copy`,
          xPct: Math.min(92, orig.xPct + 4),
          yPct: Math.min(92, orig.yPct + 5),
        });
        newSelection.push({ type: 'asset', id: copyId });
      }
    });

    if (newBlocks.length === 0 && newAssets.length === 0) return;

    onUpdateDesign((prev) => ({
      ...prev,
      contentBlocks: [...prev.contentBlocks, ...newBlocks],
      assets: [...prev.assets, ...newAssets],
    }));
    setSelectedLayers(newSelection);
  }, [selectedLayers, design.contentBlocks, design.assets, onUpdateDesign]);

  const alignSelectedLayers = useCallback(
    (alignment: GroupAlignmentAction) => {
      if (selectedLayers.length < 2) return;

      const contentIds = new Set(
        selectedLayers.filter((l) => l.type === 'content').map((l) => l.id)
      );
      const assetIds = new Set(
        selectedLayers.filter((l) => l.type === 'asset').map((l) => l.id)
      );

      onUpdateDesign((prev) => {
        const items: Array<{
          type: 'content' | 'asset';
          id: string;
          x: number;
          y: number;
          w: number;
          h: number;
        }> = [];

        prev.contentBlocks.forEach((b) => {
          if (contentIds.has(b.id)) {
            items.push({ type: 'content', id: b.id, x: b.xPct, y: b.yPct, w: b.widthPct, h: 10 });
          }
        });
        prev.assets.forEach((a) => {
          if (assetIds.has(a.id)) {
            items.push({
              type: 'asset',
              id: a.id,
              x: a.xPct,
              y: a.yPct,
              w: a.widthPct,
              h: a.heightPct,
            });
          }
        });

        if (items.length < 2) return prev;

        const minX = Math.min(...items.map((i) => i.x));
        const maxRight = Math.max(...items.map((i) => i.x + i.w));
        const centerX = (minX + maxRight) / 2;
        const minY = Math.min(...items.map((i) => i.y));
        const maxBottom = Math.max(...items.map((i) => i.y + i.h));
        const centerY = (minY + maxBottom) / 2;

        const distributedY = new Map<string, number>();
        if (alignment === 'distribute-v' && items.length >= 3) {
          const sorted = [...items].sort((a, b) => a.y - b.y);
          const firstY = sorted[0].y;
          const lastY = sorted[sorted.length - 1].y;
          const step = (lastY - firstY) / (sorted.length - 1);
          sorted.forEach((item, idx) => {
            distributedY.set(`${item.type}:${item.id}`, Math.round((firstY + idx * step) * 2) / 2);
          });
        }

        const applyPos = (
          type: 'content' | 'asset',
          id: string,
          x: number,
          y: number,
          w: number,
          h: number
        ) => {
          let nextX = x;
          let nextY = y;
          if (alignment === 'left') nextX = minX;
          if (alignment === 'center-h') nextX = Math.max(0, Math.min(100 - w, centerX - w / 2));
          if (alignment === 'right') nextX = Math.max(0, maxRight - w);
          if (alignment === 'top') nextY = minY;
          if (alignment === 'middle-v') nextY = Math.max(0, Math.min(94, centerY - h / 2));
          if (alignment === 'bottom') nextY = Math.max(0, Math.min(94, maxBottom - h));
          if (alignment === 'distribute-v') {
            nextY = distributedY.get(`${type}:${id}`) ?? y;
          }
          return {
            xPct: Math.round(nextX * 2) / 2,
            yPct: Math.round(nextY * 2) / 2,
          };
        };

        return {
          ...prev,
          contentBlocks: prev.contentBlocks.map((b) =>
            contentIds.has(b.id)
              ? { ...b, ...applyPos('content', b.id, b.xPct, b.yPct, b.widthPct, 10) }
              : b
          ),
          assets: prev.assets.map((a) =>
            assetIds.has(a.id)
              ? { ...a, ...applyPos('asset', a.id, a.xPct, a.yPct, a.widthPct, a.heightPct) }
              : a
          ),
        };
      });
    },
    [selectedLayers, onUpdateDesign]
  );

  // Keyboard shortcuts: Undo/Redo, Select All, Delete, Escape, and Group Arrow Nudging
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isEditingText) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo();
        } else {
          onUndo();
        }
        return;
      }

      if (mod && key === 'y') {
        e.preventDefault();
        onRedo();
        return;
      }

      if (mod && key === 'a') {
        e.preventDefault();
        setSelectedLayers([
          ...design.contentBlocks.map((b) => ({ type: 'content' as const, id: b.id })),
          ...design.assets.map((a) => ({ type: 'asset' as const, id: a.id })),
        ]);
        return;
      }

      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoomClamped(exactZoomRef.current + 15);
        return;
      }

      if (mod && e.key === '-') {
        e.preventDefault();
        setZoomClamped(exactZoomRef.current - 15);
        return;
      }

      if (mod && e.key === '0') {
        e.preventDefault();
        setZoomClamped(100);
        return;
      }

      if (selectedLayers.length === 0) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedLayers();
        return;
      }

      if (e.key === 'Escape') {
        setSelectedLayers([]);
        return;
      }

      const step = e.shiftKey ? 2 : 0.5;
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

        const contentIds = new Set(
          selectedLayers.filter((l) => l.type === 'content').map((l) => l.id)
        );
        const assetIds = new Set(
          selectedLayers.filter((l) => l.type === 'asset').map((l) => l.id)
        );

        onUpdateDesign(
          (prev) => ({
            ...prev,
            contentBlocks: prev.contentBlocks.map((b) =>
              contentIds.has(b.id)
                ? {
                    ...b,
                    xPct: Math.max(0, Math.min(100 - b.widthPct, Math.round((b.xPct + dx) * 2) / 2)),
                    yPct: Math.max(0, Math.min(95, Math.round((b.yPct + dy) * 2) / 2)),
                  }
                : b
            ),
            assets: prev.assets.map((a) =>
              assetIds.has(a.id)
                ? {
                    ...a,
                    xPct: Math.max(0, Math.min(100 - a.widthPct, Math.round((a.xPct + dx) * 2) / 2)),
                    yPct: Math.max(0, Math.min(100 - a.heightPct, Math.round((a.yPct + dy) * 2) / 2)),
                  }
                : a
            ),
          }),
          { coalesceKey: 'nudge' }
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedLayers,
    design.contentBlocks,
    design.assets,
    onUpdateDesign,
    onUndo,
    onRedo,
    deleteSelectedLayers,
  ]);

  const toggleSelectFromRail = (
    e: React.MouseEvent,
    type: 'content' | 'asset',
    id: string
  ) => {
    const isAdditive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!isAdditive) {
      setSelectedLayers([{ type, id }]);
      return;
    }
    setSelectedLayers((prev) => {
      const exists = prev.some((l) => l.type === type && l.id === id);
      if (exists) {
        return prev.filter((l) => !(l.type === type && l.id === id));
      }
      return [...prev, { type, id }];
    });
  };

  const updateContentBlock = (
    id: string,
    patch: Partial<ContentBlock>,
    options?: DesignUpdateOptions
  ) => {
    onUpdateDesign(
      (prev) => ({
        ...prev,
        contentBlocks: prev.contentBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }),
      options
    );
  };

  const batchUpdateContentBlocks = (
    ids: string[],
    patch: Partial<ContentBlock>,
    options?: DesignUpdateOptions
  ) => {
    const idSet = new Set(ids);
    onUpdateDesign(
      (prev) => ({
        ...prev,
        contentBlocks: prev.contentBlocks.map((b) => (idSet.has(b.id) ? { ...b, ...patch } : b)),
      }),
      options
    );
  };

  const addContentBlock = (mode: ContentMode) => {
    const id = `blk-${Date.now()}`;
    const defaultCol = columns[0] ?? '__ROW_NUMBER__';
    const newBlock: ContentBlock = {
      id,
      label: mode === 'column' ? defaultCol : mode === 'template' ? 'Custom Field' : 'Text Label',
      mode,
      text:
        mode === 'static'
          ? 'Event Title or Note'
          : mode === 'template'
          ? `{{${defaultCol === '__ROW_NUMBER__' ? 'RowNumber' : defaultCol}}}`
          : '',
      columnKey: defaultCol,
      prefix: '',
      suffix: '',
      xPct: 10,
      yPct: Math.min(82, 16 + (design.contentBlocks.length % 5) * 14),
      widthPct: 50,
      fontFamily: 'Plus Jakarta Sans',
      fontSizePt: 11,
      fontWeight: 600,
      color: '#09090B',
      align: 'left',
      letterSpacingEm: 0,
      uppercase: false,
      backgroundColor: '',
      borderColor: '',
      paddingMm: 0,
    };

    onUpdateDesign((prev) => ({
      ...prev,
      contentBlocks: [...prev.contentBlocks, newBlock],
    }));
    setSelectedLayers([{ type: 'content', id }]);
    setRailTab('contents');
  };

  const duplicateContentBlock = (id: string) => {
    const orig = design.contentBlocks.find((b) => b.id === id);
    if (!orig) return;
    const copyId = `blk-${Date.now()}`;
    const copy: ContentBlock = {
      ...orig,
      id: copyId,
      label: `${orig.label} Copy`,
      yPct: Math.min(90, orig.yPct + 8),
    };
    onUpdateDesign((prev) => ({
      ...prev,
      contentBlocks: [...prev.contentBlocks, copy],
    }));
    setSelectedLayers([{ type: 'content', id: copyId }]);
  };

  const deleteContentBlock = (id: string) => {
    onUpdateDesign((prev) => ({
      ...prev,
      contentBlocks: prev.contentBlocks.filter((b) => b.id !== id),
    }));
    setSelectedLayers((prev) => prev.filter((l) => !(l.type === 'content' && l.id === id)));
  };

  const updateAssetLayer = (
    id: string,
    patch: Partial<AssetLayer>,
    options?: DesignUpdateOptions
  ) => {
    onUpdateDesign(
      (prev) => ({
        ...prev,
        assets: prev.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }),
      options
    );
  };

  const moveAssetLayer = (id: string, direction: 'up' | 'down') => {
    onUpdateDesign((prev) => {
      const idx = prev.assets.findIndex((a) => a.id === id);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= prev.assets.length) return prev;
      const next = [...prev.assets];
      const [item] = next.splice(idx, 1);
      next.splice(targetIdx, 0, item);
      return { ...prev, assets: next };
    });
  };

  const deleteAssetLayer = (id: string) => {
    onUpdateDesign((prev) => ({
      ...prev,
      assets: prev.assets.filter((a) => a.id !== id),
    }));
    setSelectedLayers((prev) => prev.filter((l) => !(l.type === 'asset' && l.id === id)));
  };

  const handleReferenceUpload = async (file: File | undefined) => {
    if (!file) return;
    setAnalysisError(null);
    setAnalysisSummary(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onUpdateDesign((prev) => ({
        ...prev,
        referenceImage: {
          ...prev.referenceImage,
          dataUrl,
          fileName: file.name,
        },
      }));
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : 'Failed to load reference image.');
    } finally {
      if (refInputRef.current) refInputRef.current.value = '';
    }
  };

  const handleBackgroundUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onUpdateDesign((prev) => ({
        ...prev,
        backgroundImage: {
          ...prev.backgroundImage,
          dataUrl,
          fileName: file.name,
          enabled: true,
        },
      }));
    } finally {
      if (bgInputRef.current) bgInputRef.current.value = '';
    }
  };

  const handleAssetUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newLayers: AssetLayer[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await readFileAsDataUrl(file);
      newLayers.push({
        id: `asset-${Date.now()}-${i}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        dataUrl,
        xPct: 6 + ((design.assets.length + i) % 4) * 6,
        yPct: 10 + ((design.assets.length + i) % 3) * 8,
        widthPct: 18,
        heightPct: 28,
        opacity: 1,
        fit: 'contain',
        borderRadiusMm: 0,
      });
    }

    onUpdateDesign((prev) => ({
      ...prev,
      assets: [...prev.assets, ...newLayers],
    }));
    if (newLayers.length > 0) {
      setSelectedLayers(newLayers.map((a) => ({ type: 'asset' as const, id: a.id })));
    }
    if (assetInputRef.current) assetInputRef.current.value = '';
  };

  const handleAnalyzeReference = async () => {
    if (!design.referenceImage.dataUrl) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisSummary(null);

    try {
      const { base64, mimeType } = await prepareImageForVision(design.referenceImage.dataUrl);
      const response = await fetch('/api/analyze-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          columns,
        }),
      });

      const rawBody = await response.text();
      let payload: { error?: string; summary?: string; design?: Partial<CardDesign> } | null = null;
      try {
        payload = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload?.error ||
          (response.status === 404
            ? 'The /api/analyze-reference endpoint was not found on this host. Redeploy with API routes enabled and GEMINI_API_KEY configured.'
            : `Reference analysis failed (HTTP ${response.status}).`);
        throw new Error(message);
      }

      const extracted = payload?.design;
      if (!extracted) {
        throw new Error('No card design data was returned from the analysis endpoint.');
      }

      onUpdateDesign((prev) => ({
        ...prev,
        widthMm: extracted.widthMm ?? prev.widthMm,
        heightMm: extracted.heightMm ?? prev.heightMm,
        backgroundColor: extracted.backgroundColor ?? prev.backgroundColor,
        accentColor: extracted.accentColor ?? prev.accentColor,
        borderStyle: extracted.borderStyle ?? prev.borderStyle,
        borderColor: extracted.borderColor ?? prev.borderColor,
        borderWidthMm: extracted.borderWidthMm ?? prev.borderWidthMm,
        borderInsetMm: extracted.borderInsetMm ?? prev.borderInsetMm,
        cornerRadiusMm: extracted.cornerRadiusMm ?? prev.cornerRadiusMm,
        dividerEnabled: Boolean(extracted.dividerEnabled),
        dividerPositionPct: extracted.dividerPositionPct ?? prev.dividerPositionPct,
        dividerStyle: extracted.dividerStyle ?? prev.dividerStyle,
        dividerColor: extracted.dividerColor ?? prev.dividerColor,
        contentBlocks:
          Array.isArray(extracted.contentBlocks) && extracted.contentBlocks.length > 0
            ? extracted.contentBlocks
            : prev.contentBlocks,
      }));
      setSelectedLayers([]);
      setAnalysisSummary(payload?.summary || 'Card style and layout extracted from reference image.');
    } catch (err: unknown) {
      setAnalysisError(
        err instanceof Error ? err.message : 'Unable to extract layout from reference image.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const isReferenceUsedAsBackground =
    design.backgroundImage.enabled &&
    design.referenceImage.dataUrl !== null &&
    design.backgroundImage.dataUrl === design.referenceImage.dataUrl;

  const toggleUseReferenceAsBackground = (checked: boolean) => {
    if (!design.referenceImage.dataUrl) return;
    if (checked) {
      onUpdateDesign((prev) => ({
        ...prev,
        backgroundImage: {
          ...prev.backgroundImage,
          dataUrl: prev.referenceImage.dataUrl,
          fileName: prev.referenceImage.fileName,
          enabled: true,
        },
      }));
    } else {
      onUpdateDesign((prev) => ({
        ...prev,
        backgroundImage: {
          ...prev.backgroundImage,
          enabled: false,
        },
      }));
    }
  };

  const displayDimValue = (mm: number) =>
    design.unit === 'in' ? Number(mmToIn(mm).toFixed(2)) : Math.round(mm * 10) / 10;

  const parseDimInput = (val: string, minMm: number, maxMm: number) => {
    const parsed = Number(val);
    if (Number.isNaN(parsed)) return minMm;
    const mm = design.unit === 'in' ? inToMm(parsed) : parsed;
    return Math.max(minMm, Math.min(maxMm, Math.round(mm * 10) / 10));
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#F8F9FA]">
      {/* Left Configuration Rail */}
      <aside className="w-[310px] shrink-0 bg-white border-r border-[#E4E4E7] flex flex-col overflow-hidden">
        {/* Segmented Rail Tabs */}
        <div className="p-2.5 border-b border-[#E4E4E7]">
          <div className="grid grid-cols-4 gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
            {(
              [
                { id: 'format', label: 'Format' },
                { id: 'reference', label: 'Reference' },
                { id: 'assets', label: 'Assets' },
                { id: 'contents', label: 'Contents' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRailTab(tab.id)}
                className={`py-1.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  railTab === tab.id
                    ? 'bg-white text-[#09090B] shadow-xs'
                    : 'text-[#52525B] hover:text-[#09090B]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hidden File Inputs */}
        <input
          ref={refInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void handleReferenceUpload(e.target.files?.[0])}
          className="hidden"
        />
        <input
          ref={bgInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void handleBackgroundUpload(e.target.files?.[0])}
          className="hidden"
        />
        <input
          ref={assetInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          multiple
          onChange={(e) => void handleAssetUpload(e.target.files)}
          className="hidden"
        />

        {/* Rail Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {railTab === 'format' && (
            <>
              {/* Card Size Presets */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold text-[#09090B]">Card Size</h2>
                  <div className="flex items-center gap-0.5 p-0.5 bg-[#F4F4F5] rounded">
                    {(['mm', 'in'] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => onUpdateDesign((prev) => ({ ...prev, unit }), { skipHistory: true })}
                        className={`px-2 py-0.5 text-[10px] font-mono-tabular font-medium rounded transition-colors ${
                          design.unit === unit
                            ? 'bg-white text-[#09090B] shadow-xs'
                            : 'text-[#71717A] hover:text-[#09090B]'
                        }`}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {CARD_SIZE_PRESETS.map((preset) => {
                    const isSelected =
                      Math.abs(design.widthMm - preset.widthMm) < 0.5 &&
                      Math.abs(design.heightMm - preset.heightMm) < 0.5;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          onUpdateDesign((prev) => ({
                            ...prev,
                            widthMm: preset.widthMm,
                            heightMm: preset.heightMm,
                          }))
                        }
                        className={`text-left px-2.5 py-2 rounded-md border transition-colors ${
                          isSelected
                            ? 'border-[#18181B] bg-[#FAFAFA]'
                            : 'border-[#E4E4E7] hover:border-[#A1A1AA]'
                        }`}
                      >
                        <div className="text-[11px] font-medium text-[#09090B] truncate">
                          {preset.name}
                        </div>
                        <div className="text-[10px] text-[#71717A] font-mono-tabular mt-0.5">
                          {preset.widthMm} × {preset.heightMm} mm
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] text-[#71717A] mb-1">
                      Width ({design.unit})
                    </label>
                    <input
                      type="number"
                      step={design.unit === 'in' ? 0.1 : 1}
                      value={displayDimValue(design.widthMm)}
                      onChange={(e) =>
                        onUpdateDesign(
                          (prev) => ({
                            ...prev,
                            widthMm: parseDimInput(e.target.value, 35, 250),
                          }),
                          { coalesceKey: 'dim-w' }
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#71717A] mb-1">
                      Height ({design.unit})
                    </label>
                    <input
                      type="number"
                      step={design.unit === 'in' ? 0.1 : 1}
                      value={displayDimValue(design.heightMm)}
                      onChange={(e) =>
                        onUpdateDesign(
                          (prev) => ({
                            ...prev,
                            heightMm: parseDimInput(e.target.value, 25, 200),
                          }),
                          { coalesceKey: 'dim-h' }
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] focus:bg-white"
                    />
                  </div>
                </div>
              </div>

              <hr className="border-[#F4F4F5]" />

              {/* Card Background Color & Image Shortcut */}
              <div className="space-y-2.5">
                <h2 className="text-[11px] font-semibold text-[#09090B]">Background</h2>
                <div className="flex items-center gap-1.5">
                  {PAPER_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() =>
                        onUpdateDesign((prev) => ({ ...prev, backgroundColor: swatch }))
                      }
                      aria-label={`Paper color ${swatch}`}
                      style={{ backgroundColor: swatch }}
                      className={`w-6 h-6 rounded border transition-transform ${
                        design.backgroundColor.toLowerCase() === swatch.toLowerCase()
                          ? 'border-[#2563EB] ring-1 ring-[#2563EB] scale-105'
                          : 'border-[#D4D4D8]'
                      }`}
                    />
                  ))}
                  <div className="flex-1 flex items-center gap-1.5 border border-[#E4E4E7] rounded-md px-2 py-1 bg-[#FAFAFA]">
                    <input
                      type="color"
                      value={design.backgroundColor}
                      onChange={(e) =>
                        onUpdateDesign(
                          (prev) => ({ ...prev, backgroundColor: e.target.value }),
                          { coalesceKey: 'bg-color' }
                        )
                      }
                      className="w-4 h-4 bg-transparent cursor-pointer shrink-0"
                    />
                    <input
                      type="text"
                      value={design.backgroundColor}
                      onChange={(e) =>
                        onUpdateDesign(
                          (prev) => ({ ...prev, backgroundColor: e.target.value }),
                          { coalesceKey: 'bg-color' }
                        )
                      }
                      className="w-full text-[11px] font-mono-tabular bg-transparent focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => bgInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#18181B] hover:text-[#2563EB] transition-colors"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    {design.backgroundImage.dataUrl
                      ? 'Replace background image'
                      : 'Upload background image'}
                  </button>
                  {design.backgroundImage.dataUrl && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-[#52525B] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={design.backgroundImage.enabled}
                        onChange={(e) =>
                          onUpdateDesign((prev) => ({
                            ...prev,
                            backgroundImage: {
                              ...prev.backgroundImage,
                              enabled: e.target.checked,
                            },
                          }))
                        }
                        className="accent-[#18181B]"
                      />
                      Show
                    </label>
                  )}
                </div>
              </div>

              <hr className="border-[#F4F4F5]" />

              {/* Border & Corner Framing */}
              <div className="space-y-3">
                <h2 className="text-[11px] font-semibold text-[#09090B]">Border & Frame</h2>
                <div className="grid grid-cols-4 gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
                  {(['none', 'solid', 'double', 'dashed'] as BorderStyle[]).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() =>
                        onUpdateDesign((prev) => ({ ...prev, borderStyle: style }))
                      }
                      className={`py-1 text-[11px] font-medium capitalize rounded transition-colors ${
                        design.borderStyle === style
                          ? 'bg-white text-[#09090B] shadow-xs'
                          : 'text-[#52525B] hover:text-[#09090B]'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>

                {design.borderStyle !== 'none' && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-[#71717A] mb-1">Border Color</label>
                      <div className="flex items-center gap-1.5 border border-[#E4E4E7] rounded-md px-2 py-1 bg-[#FAFAFA]">
                        <input
                          type="color"
                          value={design.borderColor}
                          onChange={(e) =>
                            onUpdateDesign(
                              (prev) => ({ ...prev, borderColor: e.target.value }),
                              { coalesceKey: 'border-color' }
                            )
                          }
                          className="w-4 h-4 bg-transparent cursor-pointer shrink-0"
                        />
                        <span className="text-[11px] font-mono-tabular text-[#52525B]">
                          {design.borderColor}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#71717A] mb-1">
                        Inset ({design.borderInsetMm} mm)
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={8}
                        step={0.5}
                        value={design.borderInsetMm}
                        onChange={(e) =>
                          onUpdateDesign(
                            (prev) => ({
                              ...prev,
                              borderInsetMm: Number(e.target.value),
                            }),
                            { coalesceKey: 'border-inset' }
                          )
                        }
                        className="w-full mt-2 accent-[#18181B]"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] text-[#71717A] mb-1">
                    Corner Radius ({design.cornerRadiusMm.toFixed(1)} mm)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    step={0.5}
                    value={design.cornerRadiusMm}
                    onChange={(e) =>
                      onUpdateDesign(
                        (prev) => ({
                          ...prev,
                          cornerRadiusMm: Number(e.target.value),
                        }),
                        { coalesceKey: 'corner-radius' }
                      )
                    }
                    className="w-full accent-[#18181B]"
                  />
                </div>
              </div>

              <hr className="border-[#F4F4F5]" />

              {/* Stub Divider */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold text-[#09090B]">Stub Divider Line</h2>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-[#52525B] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={design.dividerEnabled}
                      onChange={(e) =>
                        onUpdateDesign((prev) => ({
                          ...prev,
                          dividerEnabled: e.target.checked,
                        }))
                      }
                      className="accent-[#18181B]"
                    />
                    Enable
                  </label>
                </div>

                {design.dividerEnabled && (
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] text-[#71717A] mb-1">
                        Position ({design.dividerPositionPct}%)
                      </label>
                      <input
                        type="range"
                        min={50}
                        max={86}
                        step={1}
                        value={design.dividerPositionPct}
                        onChange={(e) =>
                          onUpdateDesign(
                            (prev) => ({
                              ...prev,
                              dividerPositionPct: Number(e.target.value),
                            }),
                            { coalesceKey: 'divider-pos' }
                          )
                        }
                        className="w-full accent-[#18181B]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={design.dividerStyle}
                        onChange={(e) =>
                          onUpdateDesign((prev) => ({
                            ...prev,
                            dividerStyle: e.target.value as 'dashed' | 'solid',
                          }))
                        }
                        className="px-2 py-1.5 text-xs bg-white border border-[#E4E4E7] rounded-md"
                      >
                        <option value="dashed">Dashed</option>
                        <option value="solid">Solid</option>
                      </select>
                      <div className="flex items-center gap-1.5 border border-[#E4E4E7] rounded-md px-2 py-1 bg-[#FAFAFA]">
                        <input
                          type="color"
                          value={design.dividerColor}
                          onChange={(e) =>
                            onUpdateDesign(
                              (prev) => ({ ...prev, dividerColor: e.target.value }),
                              { coalesceKey: 'divider-color' }
                            )
                          }
                          className="w-4 h-4 bg-transparent cursor-pointer shrink-0"
                        />
                        <span className="text-[11px] font-mono-tabular text-[#52525B]">
                          {design.dividerColor}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-[#F4F4F5]">
                <button
                  type="button"
                  onClick={onResetDesign}
                  className="inline-flex items-center gap-1.5 text-xs text-[#71717A] hover:text-[#09090B] transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to default template
                </button>
              </div>
            </>
          )}

          {railTab === 'reference' && (
            <>
              <div className="space-y-3">
                <div>
                  <h2 className="text-xs font-semibold text-[#09090B]">Reference Card Image</h2>
                  <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">
                    Upload an example ticket to extract its layout and colors, use it directly as a card background, or align assets over it.
                  </p>
                </div>

                {!design.referenceImage.dataUrl ? (
                  <button
                    type="button"
                    onClick={() => refInputRef.current?.click()}
                    className="w-full py-7 px-4 border border-dashed border-[#D4D4D8] hover:border-[#71717A] rounded-lg bg-[#FAFAFA] flex flex-col items-center justify-center gap-2 transition-colors"
                  >
                    <Upload className="w-4 h-4 text-[#52525B]" />
                    <span className="text-xs font-medium text-[#09090B]">
                      Upload Reference Image
                    </span>
                    <span className="text-[11px] text-[#71717A]">PNG, JPG, or WEBP</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="relative rounded-md border border-[#E4E4E7] bg-[#FAFAFA] p-2">
                      <img
                        src={design.referenceImage.dataUrl}
                        alt="Uploaded reference"
                        referrerPolicy="no-referrer"
                        className="w-full max-h-36 object-contain rounded"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-[#52525B] truncate">
                          {design.referenceImage.fileName}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => refInputRef.current?.click()}
                            className="text-[#2563EB] hover:underline"
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onUpdateDesign((prev) => ({
                                ...prev,
                                referenceImage: {
                                  dataUrl: null,
                                  fileName: '',
                                  showGhostOverlay: false,
                                  ghostOpacity: 0.35,
                                },
                              }));
                              setAnalysisSummary(null);
                              setAnalysisError(null);
                            }}
                            className="text-[#71717A] hover:text-[#DC2626]"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Action 1: AI Layout Extraction */}
                    <button
                      type="button"
                      onClick={() => void handleAnalyzeReference()}
                      disabled={isAnalyzing}
                      className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#18181B] hover:bg-[#27272A] disabled:opacity-50 rounded-md transition-colors"
                    >
                      {isAnalyzing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="w-3.5 h-3.5" />
                      )}
                      {isAnalyzing ? 'Analyzing Reference...' : 'Extract Editable Layout'}
                    </button>

                    {analysisSummary && (
                      <div className="p-2.5 rounded-md bg-[#F4F4F5] text-[11px] text-[#18181B] space-y-2">
                        <p>{analysisSummary}</p>
                        {canUndo && (
                          <button
                            type="button"
                            onClick={() => {
                              onUndo();
                              setAnalysisSummary(null);
                            }}
                            className="inline-flex items-center gap-1 font-medium text-[#2563EB] hover:underline"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Undo extracted layout
                          </button>
                        )}
                      </div>
                    )}

                    {analysisError && (
                      <div
                        role="alert"
                        className="p-2.5 rounded-md bg-[#FEF2F2] border border-[#FECACA] text-[11px] text-[#B91C1C]"
                      >
                        {analysisError}
                      </div>
                    )}

                    <hr className="border-[#F4F4F5]" />

                    {/* Action 2: Reference Usage Options */}
                    <div className="space-y-3">
                      <h3 className="text-[11px] font-semibold text-[#09090B]">
                        How to Use This Image
                      </h3>

                      <label className="flex items-start gap-2.5 text-xs text-[#09090B] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isReferenceUsedAsBackground}
                          onChange={(e) => toggleUseReferenceAsBackground(e.target.checked)}
                          className="mt-0.5 accent-[#18181B]"
                        />
                        <span>
                          <span className="font-medium block">Use directly as card background</span>
                          <span className="text-[11px] text-[#71717A]">
                            Prints this image behind your dynamic Excel fields
                          </span>
                        </span>
                      </label>

                      <label className="flex items-start gap-2.5 text-xs text-[#09090B] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={design.referenceImage.showGhostOverlay}
                          onChange={(e) =>
                            onUpdateDesign(
                              (prev) => ({
                                ...prev,
                                referenceImage: {
                                  ...prev.referenceImage,
                                  showGhostOverlay: e.target.checked,
                                },
                              }),
                              { skipHistory: true }
                            )
                          }
                          className="mt-0.5 accent-[#18181B]"
                        />
                        <span>
                          <span className="font-medium block">Show alignment ghost on canvas</span>
                          <span className="text-[11px] text-[#71717A]">
                            Editor guide only — hidden when exporting PDF
                          </span>
                        </span>
                      </label>

                      {design.referenceImage.showGhostOverlay && (
                        <div className="pl-6">
                          <label className="block text-[11px] text-[#71717A] mb-1">
                            Guide Opacity ({Math.round(design.referenceImage.ghostOpacity * 100)}%)
                          </label>
                          <input
                            type="range"
                            min={0.1}
                            max={0.8}
                            step={0.05}
                            value={design.referenceImage.ghostOpacity}
                            onChange={(e) =>
                              onUpdateDesign(
                                (prev) => ({
                                  ...prev,
                                  referenceImage: {
                                    ...prev.referenceImage,
                                    ghostOpacity: Number(e.target.value),
                                  },
                                }),
                                { skipHistory: true }
                              )
                            }
                            className="w-full accent-[#18181B]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <hr className="border-[#F4F4F5]" />

              {/* Dedicated Background Image Controls */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold text-[#09090B]">
                    Card Background Image
                  </h3>
                  <button
                    type="button"
                    onClick={() => bgInputRef.current?.click()}
                    className="text-[11px] font-medium text-[#2563EB] hover:underline"
                  >
                    Upload separate
                  </button>
                </div>

                {design.backgroundImage.dataUrl ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#52525B] truncate max-w-[160px]">
                        {design.backgroundImage.fileName || 'Background image'}
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1 text-[#09090B] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={design.backgroundImage.enabled}
                            onChange={(e) =>
                              onUpdateDesign((prev) => ({
                                ...prev,
                                backgroundImage: {
                                  ...prev.backgroundImage,
                                  enabled: e.target.checked,
                                },
                              }))
                            }
                            className="accent-[#18181B]"
                          />
                          Active
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateDesign((prev) => ({
                              ...prev,
                              backgroundImage: {
                                ...prev.backgroundImage,
                                dataUrl: null,
                                fileName: '',
                                enabled: false,
                              },
                            }))
                          }
                          className="text-[#71717A] hover:text-[#DC2626]"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {design.backgroundImage.enabled && (
                      <>
                        <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
                          {(['cover', 'contain', 'stretch'] as ImageFit[]).map((fit) => (
                            <button
                              key={fit}
                              type="button"
                              onClick={() =>
                                onUpdateDesign((prev) => ({
                                  ...prev,
                                  backgroundImage: { ...prev.backgroundImage, fit },
                                }))
                              }
                              className={`py-1 text-[11px] font-medium capitalize rounded transition-colors ${
                                design.backgroundImage.fit === fit
                                  ? 'bg-white text-[#09090B] shadow-xs'
                                  : 'text-[#52525B] hover:text-[#09090B]'
                              }`}
                            >
                              {fit}
                            </button>
                          ))}
                        </div>

                        <div>
                          <label className="block text-[11px] text-[#71717A] mb-1">
                            Image Opacity ({Math.round(design.backgroundImage.opacity * 100)}%)
                          </label>
                          <input
                            type="range"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={design.backgroundImage.opacity}
                            onChange={(e) =>
                              onUpdateDesign(
                                (prev) => ({
                                  ...prev,
                                  backgroundImage: {
                                    ...prev.backgroundImage,
                                    opacity: Number(e.target.value),
                                  },
                                }),
                                { coalesceKey: 'bg-op' }
                              )
                            }
                            className="w-full accent-[#18181B]"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2 items-center">
                          <div>
                            <label className="block text-[11px] text-[#71717A] mb-1">
                              Readability Tint
                            </label>
                            <div className="flex items-center gap-1.5 border border-[#E4E4E7] rounded-md px-2 py-1 bg-[#FAFAFA]">
                              <input
                                type="color"
                                value={design.backgroundImage.overlayColor}
                                onChange={(e) =>
                                  onUpdateDesign(
                                    (prev) => ({
                                      ...prev,
                                      backgroundImage: {
                                        ...prev.backgroundImage,
                                        overlayColor: e.target.value,
                                      },
                                    }),
                                    { coalesceKey: 'tint-color' }
                                  )
                                }
                                className="w-4 h-4 bg-transparent cursor-pointer shrink-0"
                              />
                              <span className="text-[11px] font-mono-tabular text-[#52525B]">
                                {design.backgroundImage.overlayColor}
                              </span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] text-[#71717A] mb-1">
                              Tint ({Math.round(design.backgroundImage.overlayOpacity * 100)}%)
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={0.85}
                              step={0.05}
                              value={design.backgroundImage.overlayOpacity}
                              onChange={(e) =>
                                onUpdateDesign(
                                  (prev) => ({
                                    ...prev,
                                    backgroundImage: {
                                      ...prev.backgroundImage,
                                      overlayOpacity: Number(e.target.value),
                                    },
                                  }),
                                  { coalesceKey: 'tint-op' }
                                )
                              }
                              className="w-full accent-[#18181B]"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-[#71717A]">
                    No background image active. Enable the reference toggle above or upload a custom artwork image.
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-[#F4F4F5]">
                <button
                  type="button"
                  onClick={() => setRailTab('assets')}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded-md transition-colors"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Upload Logos & Design Assets
                </button>
              </div>
            </>
          )}

          {railTab === 'assets' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xs font-semibold text-[#09090B]">Design Assets</h2>
                <p className="text-[11px] text-[#71717A] mt-0.5">
                  Upload logos or graphics. Shift+click items to multi-select.
                </p>
              </div>

              <button
                type="button"
                onClick={() => assetInputRef.current?.click()}
                className="w-full py-5 px-4 border border-dashed border-[#D4D4D8] hover:border-[#71717A] rounded-lg bg-[#FAFAFA] flex flex-col items-center justify-center gap-1.5 transition-colors"
              >
                <Upload className="w-4 h-4 text-[#52525B]" />
                <span className="text-xs font-medium text-[#09090B]">Upload Graphic Assets</span>
                <span className="text-[11px] text-[#71717A]">PNG, SVG, JPG, or WEBP</span>
              </button>

              {design.assets.length === 0 ? (
                <p className="text-xs text-[#71717A] text-center py-6">
                  No graphic assets added yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {design.assets.map((asset) => {
                    const isSelected = selectedLayers.some(
                      (l) => l.type === 'asset' && l.id === asset.id
                    );
                    return (
                      <div
                        key={asset.id}
                        onClick={(e) => toggleSelectFromRail(e, 'asset', asset.id)}
                        className={`flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-[#2563EB] bg-[#EFF6FF]/40'
                            : 'border-[#E4E4E7] hover:border-[#A1A1AA]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={asset.dataUrl}
                            alt={asset.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded border border-[#E4E4E7] object-contain bg-white p-0.5 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[#09090B] truncate">
                              {asset.name}
                            </div>
                            <div className="text-[10px] text-[#71717A] font-mono-tabular">
                              {Math.round(asset.widthPct)}% × {Math.round(asset.heightPct)}%
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteAssetLayer(asset.id);
                          }}
                          aria-label={`Remove ${asset.name}`}
                          className="p-1 text-[#A1A1AA] hover:text-[#DC2626] rounded shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {railTab === 'contents' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-[#09090B]">Card Content Fields</h2>
                  <span className="text-[10px] text-[#71717A]">Shift+click to multi-select</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => addContentBlock('column')}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-medium text-white bg-[#18181B] hover:bg-[#27272A] rounded-md transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3" />
                    Excel Field
                  </button>
                  <button
                    type="button"
                    onClick={() => addContentBlock('static')}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-[11px] font-medium text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded-md transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3" />
                    Static Text
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                {design.contentBlocks.map((block) => {
                  const isSelected = selectedLayers.some(
                    (l) => l.type === 'content' && l.id === block.id
                  );
                  const sourceMeta =
                    block.mode === 'column'
                      ? block.columnKey === '__ROW_NUMBER__'
                        ? 'Row #'
                        : `Col: ${block.columnKey}`
                      : block.mode === 'template'
                      ? 'Template'
                      : 'Static';

                  return (
                    <div
                      key={block.id}
                      onClick={(e) => toggleSelectFromRail(e, 'content', block.id)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-[#2563EB] bg-[#EFF6FF]/40'
                          : 'border-[#E4E4E7] hover:border-[#A1A1AA]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#09090B] truncate">
                          {block.label}
                        </div>
                        <div className="text-[10px] text-[#71717A] truncate mt-0.5">
                          {sourceMeta} · {block.fontSizePt}pt
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateContentBlock(block.id);
                          }}
                          aria-label={`Duplicate ${block.label}`}
                          className="p-1 text-[#A1A1AA] hover:text-[#09090B] rounded"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteContentBlock(block.id);
                          }}
                          aria-label={`Delete ${block.label}`}
                          className="p-1 text-[#A1A1AA] hover:text-[#DC2626] rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Center Interactive Drafting Canvas */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Canvas Toolbar */}
        <div className="h-11 shrink-0 px-4 bg-white/80 backdrop-blur-xs border-b border-[#E4E4E7] flex items-center justify-between gap-3 overflow-x-auto">
          {/* Left: Entry Stepper + Undo/Redo + Dimensions */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="inline-flex items-center border border-[#E4E4E7] rounded-md bg-white">
              <button
                type="button"
                onClick={() => onChangeActiveEntryIndex(Math.max(0, safeEntryIndex - 1))}
                disabled={safeEntryIndex <= 0}
                aria-label="Previous entry"
                className="p-1 text-[#52525B] hover:text-[#09090B] disabled:opacity-35"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-[11px] font-mono-tabular text-[#09090B] whitespace-nowrap">
                {entries.length > 0 ? `Entry ${safeEntryIndex + 1} / ${entries.length}` : 'No entries'}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChangeActiveEntryIndex(Math.min(entries.length - 1, safeEntryIndex + 1))
                }
                disabled={safeEntryIndex >= entries.length - 1}
                aria-label="Next entry"
                className="p-1 text-[#52525B] hover:text-[#09090B] disabled:opacity-35"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Undo / Redo Controls */}
            <div className="inline-flex items-center border border-[#E4E4E7] rounded-md bg-white divide-x divide-[#E4E4E7]">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                className="px-2 py-1 text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] disabled:opacity-35 disabled:hover:bg-transparent transition-colors rounded-l-md"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
                aria-label="Redo"
                className="px-2 py-1 text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] disabled:opacity-35 disabled:hover:bg-transparent transition-colors rounded-r-md"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="hidden 2xl:flex items-center gap-2 text-[11px] text-[#71717A] font-mono-tabular whitespace-nowrap">
              <span>
                {formatDimension(design.widthMm, design.unit)} ×{' '}
                {formatDimension(design.heightMm, design.unit)}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {sheetMetrics.fitsOnPage
                  ? `${sheetMetrics.cardsPerPage} per ${sheetConfig.paperSize.toUpperCase()}`
                  : 'Exceeds sheet'}
              </span>
            </div>
          </div>

          {/* Center-Right: Grid, Ruler Guides & Snap Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="inline-flex items-center border border-[#E4E4E7] rounded-md bg-white divide-x divide-[#E4E4E7]">
              <button
                type="button"
                onClick={() => setShowGrid((prev) => !prev)}
                aria-pressed={showGrid}
                title="Toggle canvas grid overlay"
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap rounded-l-md ${
                  showGrid
                    ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                    : 'text-[#52525B] hover:bg-[#F4F4F5] hover:text-[#09090B]'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>

              <button
                type="button"
                onClick={() => setShowRulers((prev) => !prev)}
                aria-pressed={showRulers}
                title="Toggle rulers & draggable guides"
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showRulers
                    ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                    : 'text-[#52525B] hover:bg-[#F4F4F5] hover:text-[#09090B]'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
                <span>Rulers</span>
              </button>

              <button
                type="button"
                onClick={() => setSnapToGrid((prev) => !prev)}
                aria-pressed={snapToGrid}
                title="Toggle snapping to grid and ruler guides (hold Alt while dragging to bypass)"
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap rounded-r-md ${
                  snapToGrid
                    ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                    : 'text-[#52525B] hover:bg-[#F4F4F5] hover:text-[#09090B]'
                }`}
              >
                <Magnet className="w-3.5 h-3.5" />
                <span>Snap</span>
              </button>
            </div>

            <select
              aria-label="Grid spacing"
              value={activeGridOptionMm}
              onChange={(e) => setGridSpacingMm(Number(e.target.value))}
              title="Grid spacing"
              className="h-[26px] px-1.5 text-[11px] font-mono-tabular text-[#52525B] bg-white border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] cursor-pointer"
            >
              {gridSpacingOptions.map((opt) => (
                <option key={opt.label} value={opt.mm}>
                  {opt.label}
                </option>
              ))}
            </select>

            {guides.length > 0 && (
              <button
                type="button"
                onClick={handleClearGuides}
                title={`Remove all ${guides.length} ruler guide${guides.length === 1 ? '' : 's'}`}
                className="px-2 py-1 text-[11px] font-medium text-[#52525B] hover:text-[#DC2626] hover:bg-[#FEF2F2] border border-[#E4E4E7] rounded-md transition-colors whitespace-nowrap"
              >
                Clear guides ({guides.length})
              </button>
            )}
          </div>

          {/* Right: Zoom Controls */}
          <div className="inline-flex items-center border border-[#E4E4E7] rounded-md bg-white divide-x divide-[#E4E4E7] shrink-0">
            <button
              type="button"
              onClick={() => setZoomClamped(zoomPct - 15)}
              disabled={zoomPct <= 25}
              title="Zoom out (Scroll down or Ctrl+-)"
              aria-label="Zoom out"
              className="px-1.5 py-1 text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] disabled:opacity-35 transition-colors rounded-l-md"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomClamped(100)}
              title="Reset zoom to 100% (Ctrl+0) · Scroll over canvas to zoom"
              className="min-w-[46px] px-2 py-1 text-[11px] font-mono-tabular text-[#09090B] hover:bg-[#F4F4F5] transition-colors whitespace-nowrap text-center"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              onClick={() => setZoomClamped(zoomPct + 15)}
              disabled={zoomPct >= 300}
              title="Zoom in (Scroll up or Ctrl++)"
              aria-label="Zoom in"
              className="px-1.5 py-1 text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] disabled:opacity-35 transition-colors rounded-r-md"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Drafting Field */}
        <div
          ref={canvasViewportRef}
          onClick={() => setSelectedLayers([])}
          style={{
            backgroundImage: 'radial-gradient(#D4D4D8 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
          className="flex-1 overflow-auto flex p-10"
        >
          <div className="m-auto flex flex-col items-center">
            <CanvasRulerFrame
              widthMm={design.widthMm}
              heightMm={design.heightMm}
              widthPx={renderedWidthPx}
              unit={design.unit}
              showRulers={showRulers}
              guides={guides}
              snapToGrid={snapToGrid}
              gridSpacingMm={activeGridOptionMm}
              onAddGuide={handleAddGuide}
              onUpdateGuide={handleUpdateGuide}
              onRemoveGuide={handleRemoveGuide}
            >
              <CardPreview
                design={design}
                entry={activeEntry}
                rowIndex={safeEntryIndex}
                widthPx={renderedWidthPx}
                interactive
                selectedLayers={selectedLayers}
                onSelectLayers={setSelectedLayers}
                onUpdateDesign={onUpdateDesign}
                onUpdateContentBlock={updateContentBlock}
                onUpdateAssetLayer={updateAssetLayer}
                onBeginDragTransaction={onBeginDesignTransaction}
                onEndDragTransaction={onEndDesignTransaction}
                showReferenceGhost
                showGrid={showGrid}
                gridSpacingMm={activeGridOptionMm}
                snapToGrid={snapToGrid}
                guides={guides}
                showGuides={showRulers}
                onUpdateGuide={handleUpdateGuide}
                onRemoveGuide={handleRemoveGuide}
              />
            </CanvasRulerFrame>

            <p className="mt-6 text-[11px] text-[#71717A] text-center whitespace-nowrap">
              Scroll to zoom ·{' '}
              {showRulers
                ? 'Drag from rulers for guides (double-click to remove) · '
                : ''}
              {snapToGrid ? 'Hold Alt to bypass snap · ' : ''}
              Shift+click or drag box to multi-select
            </p>
          </div>
        </div>
      </main>

      {/* Right Contextual Inspector */}
      <DesignInspector
        design={design}
        columns={columns}
        activeEntry={activeEntry}
        activeEntryIndex={safeEntryIndex}
        selectedLayers={selectedLayers}
        onSelectLayers={setSelectedLayers}
        onUpdateContentBlock={updateContentBlock}
        onBatchUpdateContentBlocks={batchUpdateContentBlocks}
        onAlignSelectedLayers={alignSelectedLayers}
        onDuplicateSelectedLayers={duplicateSelectedLayers}
        onDeleteSelectedLayers={deleteSelectedLayers}
        onDuplicateContentBlock={duplicateContentBlock}
        onDeleteContentBlock={deleteContentBlock}
        onUpdateAssetLayer={updateAssetLayer}
        onMoveAssetLayer={moveAssetLayer}
        onDeleteAssetLayer={deleteAssetLayer}
        onAddContentBlock={addContentBlock}
        onOpenAssetsTab={() => setRailTab('assets')}
      />
    </div>
  );
}
