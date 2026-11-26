import React, { useRef, useState } from 'react';
import {
  AssetLayer,
  CardDesign,
  ContentBlock,
  DesignUpdateOptions,
  EntryRow,
  RulerGuide,
  SelectedLayerItem,
} from '../types';
import { formatDimension, resolveBlockText } from '../utils/cardRenderer';

interface CardPreviewProps {
  design: CardDesign;
  entry: EntryRow | undefined;
  rowIndex: number;
  widthPx: number;
  interactive?: boolean;
  selectedLayers?: SelectedLayerItem[];
  onSelectLayers?: (layers: SelectedLayerItem[]) => void;
  onUpdateDesign?: (
    updater: (prev: CardDesign) => CardDesign,
    options?: DesignUpdateOptions
  ) => void;
  onUpdateContentBlock?: (
    id: string,
    patch: Partial<ContentBlock>,
    options?: DesignUpdateOptions
  ) => void;
  onUpdateAssetLayer?: (
    id: string,
    patch: Partial<AssetLayer>,
    options?: DesignUpdateOptions
  ) => void;
  onBeginDragTransaction?: () => void;
  onEndDragTransaction?: (didChange: boolean) => void;
  showReferenceGhost?: boolean;
  showGrid?: boolean;
  gridSpacingMm?: number;
  snapToGrid?: boolean;
  guides?: RulerGuide[];
  showGuides?: boolean;
  onUpdateGuide?: (id: string, positionMm: number) => void;
  onRemoveGuide?: (id: string) => void;
}

interface MarqueeBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface ActiveSnapLines {
  xMm: number | null;
  yMm: number | null;
}

function isLayerSelected(
  layers: SelectedLayerItem[],
  type: 'content' | 'asset',
  id: string
): boolean {
  return layers.some((l) => l.type === type && l.id === id);
}

function snapCoordinateMm(
  candidateMm: number,
  spanMm: number,
  cardSpanMm: number,
  guidesMm: number[],
  gridSpacingMm: number
): { snappedMm: number; snapLineMm: number | null } {
  const guideThresholdMm = 1.8;

  // 1. Check user ruler guides & card center (left/top edge, center, or right/bottom edge)
  const targets = [...guidesMm, cardSpanMm / 2];
  let bestDelta = Infinity;
  let bestSnapped = candidateMm;
  let bestLine: number | null = null;

  for (const target of targets) {
    // Leading edge
    const dStart = Math.abs(candidateMm - target);
    if (dStart < guideThresholdMm && dStart < bestDelta) {
      bestDelta = dStart;
      bestSnapped = target;
      bestLine = target;
    }
    // Center of element/group
    const center = candidateMm + spanMm / 2;
    const dCenter = Math.abs(center - target);
    if (dCenter < guideThresholdMm && dCenter < bestDelta) {
      bestDelta = dCenter;
      bestSnapped = target - spanMm / 2;
      bestLine = target;
    }
    // Trailing edge
    const end = candidateMm + spanMm;
    const dEnd = Math.abs(end - target);
    if (dEnd < guideThresholdMm && dEnd < bestDelta) {
      bestDelta = dEnd;
      bestSnapped = target - spanMm;
      bestLine = target;
    }
  }

  if (bestLine !== null) {
    return { snappedMm: bestSnapped, snapLineMm: bestLine };
  }

  // 2. Snap to grid spacing
  if (gridSpacingMm > 0) {
    const snapped = Math.round(candidateMm / gridSpacingMm) * gridSpacingMm;
    return { snappedMm: snapped, snapLineMm: null };
  }

  return { snappedMm: candidateMm, snapLineMm: null };
}

export function CardPreview({
  design,
  entry,
  rowIndex,
  widthPx,
  interactive = false,
  selectedLayers = [],
  onSelectLayers,
  onUpdateDesign,
  onUpdateContentBlock,
  onUpdateAssetLayer,
  onBeginDragTransaction,
  onEndDragTransaction,
  showReferenceGhost = false,
  showGrid = false,
  gridSpacingMm = 5,
  snapToGrid = false,
  guides = [],
  showGuides = false,
  onUpdateGuide,
  onRemoveGuide,
}: CardPreviewProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const [activeSnapLines, setActiveSnapLines] = useState<ActiveSnapLines>({
    xMm: null,
    yMm: null,
  });
  const [draggingGuideId, setDraggingGuideId] = useState<string | null>(null);
  const suppressNextCardClickRef = useRef(false);

  const pxPerMm = widthPx / Math.max(10, design.widthMm);
  const heightPx = design.heightMm * pxPerMm;
  const ptToPx = (pt: number) => (pt * pxPerMm * 25.4) / 72;

  const verticalGuidesMm = showGuides
    ? guides.filter((g) => g.axis === 'x').map((g) => g.positionMm)
    : [];
  const horizontalGuidesMm = showGuides
    ? guides.filter((g) => g.axis === 'y').map((g) => g.positionMm)
    : [];

  const startGuideDrag = (e: React.PointerEvent, guide: RulerGuide) => {
    if (!interactive || !cardRef.current || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = cardRef.current.getBoundingClientRect();
    const maxMm = guide.axis === 'x' ? design.widthMm : design.heightMm;
    setDraggingGuideId(guide.id);

    const onMove = (ev: PointerEvent) => {
      const rawPx =
        guide.axis === 'x' ? ev.clientX - rect.left : ev.clientY - rect.top;
      const rawMm = rawPx / pxPerMm;

      if (rawMm < -2 || rawMm > maxMm + 2) {
        onRemoveGuide?.(guide.id);
        setDraggingGuideId(null);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        return;
      }

      const clamped = Math.max(0, Math.min(maxMm, rawMm));
      let nextMm = Math.round(clamped * 2) / 2;
      if (snapToGrid && gridSpacingMm > 0) {
        const snapped = Math.round(clamped / gridSpacingMm) * gridSpacingMm;
        if (Math.abs(snapped - clamped) <= Math.min(2, gridSpacingMm * 0.35)) {
          nextMm = Math.round(snapped * 10) / 10;
        }
      }
      onUpdateGuide?.(guide.id, nextMm);
    };

    const onUp = () => {
      setDraggingGuideId(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startMarqueeSelection = (e: React.PointerEvent) => {
    if (!interactive || !cardRef.current || e.button !== 0) return;
    if (e.target !== e.currentTarget) return;

    e.preventDefault();
    const rect = cardRef.current.getBoundingClientRect();
    const startX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const startY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const baseSelection = additive ? [...selectedLayers] : [];

    let didDrag = false;
    setMarquee({ startX, startY, currentX: startX, currentY: startY });

    const computeIntersectedLayers = (box: MarqueeBox): SelectedLayerItem[] => {
      const left = Math.min(box.startX, box.currentX);
      const right = Math.max(box.startX, box.currentX);
      const top = Math.min(box.startY, box.currentY);
      const bottom = Math.max(box.startY, box.currentY);

      const hits: SelectedLayerItem[] = [...baseSelection];
      const nodes = cardRef.current?.querySelectorAll<HTMLElement>(
        '[data-layer-type][data-layer-id]'
      );
      if (!nodes) return hits;

      nodes.forEach((node) => {
        const nr = node.getBoundingClientRect();
        const nl = nr.left - rect.left;
        const nrRight = nr.right - rect.left;
        const nt = nr.top - rect.top;
        const nb = nr.bottom - rect.top;

        const intersects = !(nrRight < left || nl > right || nb < top || nt > bottom);
        if (intersects) {
          const type = node.dataset.layerType as 'content' | 'asset';
          const id = node.dataset.layerId ?? '';
          if (id && !isLayerSelected(hits, type, id)) {
            hits.push({ type, id });
          }
        }
      });

      return hits;
    };

    const onMove = (ev: PointerEvent) => {
      const currentX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const currentY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      if (Math.abs(currentX - startX) > 4 || Math.abs(currentY - startY) > 4) {
        didDrag = true;
      }
      const nextBox = { startX, startY, currentX, currentY };
      setMarquee(nextBox);
      if (didDrag) {
        onSelectLayers?.(computeIntersectedLayers(nextBox));
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (didDrag) {
        suppressNextCardClickRef.current = true;
      } else if (!additive) {
        onSelectLayers?.([]);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startElementDrag = (
    e: React.PointerEvent,
    type: 'content' | 'asset',
    id: string,
    mode: 'move' | 'resize'
  ) => {
    if (!interactive || !cardRef.current || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const isAdditive = e.shiftKey || e.metaKey || e.ctrlKey;
    const alreadySelected = isLayerSelected(selectedLayers, type, id);

    let activeGroup: SelectedLayerItem[] = selectedLayers;

    if (mode === 'move') {
      if (isAdditive) {
        if (alreadySelected) {
          const next = selectedLayers.filter((l) => !(l.type === type && l.id === id));
          onSelectLayers?.(next);
          return;
        } else {
          activeGroup = [...selectedLayers, { type, id }];
          onSelectLayers?.(activeGroup);
        }
      } else if (!alreadySelected) {
        activeGroup = [{ type, id }];
        onSelectLayers?.(activeGroup);
      }
    } else {
      activeGroup = [{ type, id }];
      onSelectLayers?.(activeGroup);
    }

    const rect = cardRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let didChange = false;

    onBeginDragTransaction?.();

    if (mode === 'move') {
      const selectedContentIds = new Set(
        activeGroup.filter((l) => l.type === 'content').map((l) => l.id)
      );
      const selectedAssetIds = new Set(
        activeGroup.filter((l) => l.type === 'asset').map((l) => l.id)
      );

      const initialBlocks = new Map<string, { xPct: number; yPct: number; widthPct: number }>();
      design.contentBlocks.forEach((b) => {
        if (selectedContentIds.has(b.id)) {
          initialBlocks.set(b.id, { xPct: b.xPct, yPct: b.yPct, widthPct: b.widthPct });
        }
      });

      const initialAssets = new Map<
        string,
        { xPct: number; yPct: number; widthPct: number; heightPct: number }
      >();
      design.assets.forEach((a) => {
        if (selectedAssetIds.has(a.id)) {
          initialAssets.set(a.id, {
            xPct: a.xPct,
            yPct: a.yPct,
            widthPct: a.widthPct,
            heightPct: a.heightPct,
          });
        }
      });

      let minDx = -Infinity;
      let maxDx = Infinity;
      let minDy = -Infinity;
      let maxDy = Infinity;
      let groupMinX = Infinity;
      let groupMaxRight = -Infinity;
      let groupMinY = Infinity;
      let groupMaxBottom = -Infinity;

      initialBlocks.forEach((b) => {
        minDx = Math.max(minDx, -b.xPct);
        maxDx = Math.min(maxDx, 100 - b.widthPct - b.xPct);
        minDy = Math.max(minDy, -b.yPct);
        maxDy = Math.min(maxDy, 94 - b.yPct);
        groupMinX = Math.min(groupMinX, b.xPct);
        groupMaxRight = Math.max(groupMaxRight, b.xPct + b.widthPct);
        groupMinY = Math.min(groupMinY, b.yPct);
        groupMaxBottom = Math.max(groupMaxBottom, b.yPct + 10);
      });
      initialAssets.forEach((a) => {
        minDx = Math.max(minDx, -a.xPct);
        maxDx = Math.min(maxDx, 100 - a.widthPct - a.xPct);
        minDy = Math.max(minDy, -a.yPct);
        maxDy = Math.min(maxDy, 100 - a.heightPct - a.yPct);
        groupMinX = Math.min(groupMinX, a.xPct);
        groupMaxRight = Math.max(groupMaxRight, a.xPct + a.widthPct);
        groupMinY = Math.min(groupMinY, a.yPct);
        groupMaxBottom = Math.max(groupMaxBottom, a.yPct + a.heightPct);
      });

      const groupWidthMm = ((groupMaxRight - groupMinX) / 100) * design.widthMm;
      const groupHeightMm = ((groupMaxBottom - groupMinY) / 100) * design.heightMm;

      const onMove = (ev: PointerEvent) => {
        const rawDx = ((ev.clientX - startX) / rect.width) * 100;
        const rawDy = ((ev.clientY - startY) / rect.height) * 100;

        let dxPct = Math.max(minDx, Math.min(maxDx, rawDx));
        let dyPct = Math.max(minDy, Math.min(maxDy, rawDy));
        let snapXLine: number | null = null;
        let snapYLine: number | null = null;

        if (snapToGrid && !ev.altKey) {
          const candidateLeftMm = ((groupMinX + dxPct) / 100) * design.widthMm;
          const candidateTopMm = ((groupMinY + dyPct) / 100) * design.heightMm;

          const snapX = snapCoordinateMm(
            candidateLeftMm,
            groupWidthMm,
            design.widthMm,
            verticalGuidesMm,
            gridSpacingMm
          );
          const snapY = snapCoordinateMm(
            candidateTopMm,
            groupHeightMm,
            design.heightMm,
            horizontalGuidesMm,
            gridSpacingMm
          );

          dxPct = Math.max(
            minDx,
            Math.min(maxDx, (snapX.snappedMm / design.widthMm) * 100 - groupMinX)
          );
          dyPct = Math.max(
            minDy,
            Math.min(maxDy, (snapY.snappedMm / design.heightMm) * 100 - groupMinY)
          );
          snapXLine = snapX.snapLineMm;
          snapYLine = snapY.snapLineMm;
        } else {
          dxPct = Math.round(dxPct * 2) / 2;
          dyPct = Math.round(dyPct * 2) / 2;
        }

        setActiveSnapLines({ xMm: snapXLine, yMm: snapYLine });

        if (Math.abs(dxPct) > 0.01 || Math.abs(dyPct) > 0.01) {
          didChange = true;
        }

        const roundPct = (v: number) => Math.round(v * 100) / 100;

        if (onUpdateDesign) {
          onUpdateDesign(
            (prev) => ({
              ...prev,
              contentBlocks: prev.contentBlocks.map((b) => {
                const init = initialBlocks.get(b.id);
                if (!init) return b;
                return {
                  ...b,
                  xPct: roundPct(init.xPct + dxPct),
                  yPct: roundPct(init.yPct + dyPct),
                };
              }),
              assets: prev.assets.map((a) => {
                const init = initialAssets.get(a.id);
                if (!init) return a;
                return {
                  ...a,
                  xPct: roundPct(init.xPct + dxPct),
                  yPct: roundPct(init.yPct + dyPct),
                };
              }),
            }),
            { skipHistory: true }
          );
        } else if (type === 'content') {
          const init = initialBlocks.get(id);
          if (init) {
            onUpdateContentBlock?.(
              id,
              { xPct: roundPct(init.xPct + dxPct), yPct: roundPct(init.yPct + dyPct) },
              { skipHistory: true }
            );
          }
        } else {
          const init = initialAssets.get(id);
          if (init) {
            onUpdateAssetLayer?.(
              id,
              { xPct: roundPct(init.xPct + dxPct), yPct: roundPct(init.yPct + dyPct) },
              { skipHistory: true }
            );
          }
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setActiveSnapLines({ xMm: null, yMm: null });
        onEndDragTransaction?.(didChange);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Resize mode (single item)
    if (type === 'content') {
      const block = design.contentBlocks.find((b) => b.id === id);
      if (!block) {
        onEndDragTransaction?.(false);
        return;
      }
      const origX = block.xPct;
      const origW = block.widthPct;

      const onMove = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        let nextW = Math.max(10, Math.min(100 - origX, origW + dxPct));

        if (snapToGrid && !ev.altKey && gridSpacingMm > 0) {
          const rightEdgeMm = ((origX + nextW) / 100) * design.widthMm;
          const snapR = snapCoordinateMm(
            rightEdgeMm,
            0,
            design.widthMm,
            verticalGuidesMm,
            gridSpacingMm
          );
          setActiveSnapLines({ xMm: snapR.snapLineMm, yMm: null });
          const snappedW = (snapR.snappedMm / design.widthMm) * 100 - origX;
          nextW = Math.max(10, Math.min(100 - origX, Math.round(snappedW * 100) / 100));
        } else {
          setActiveSnapLines({ xMm: null, yMm: null });
          nextW = Math.round(nextW * 2) / 2;
        }

        if (Math.abs(nextW - origW) > 0.01) didChange = true;
        onUpdateContentBlock?.(id, { widthPct: nextW }, { skipHistory: true });
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setActiveSnapLines({ xMm: null, yMm: null });
        onEndDragTransaction?.(didChange);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    } else {
      const asset = design.assets.find((a) => a.id === id);
      if (!asset) {
        onEndDragTransaction?.(false);
        return;
      }
      const origX = asset.xPct;
      const origY = asset.yPct;
      const origW = asset.widthPct;
      const origH = asset.heightPct;

      const onMove = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startY) / rect.height) * 100;
        let nextW = Math.max(4, Math.min(100 - origX, origW + dxPct));
        let nextH = Math.max(4, Math.min(100 - origY, origH + dyPct));

        if (snapToGrid && !ev.altKey && gridSpacingMm > 0) {
          const rightEdgeMm = ((origX + nextW) / 100) * design.widthMm;
          const bottomEdgeMm = ((origY + nextH) / 100) * design.heightMm;
          const snapR = snapCoordinateMm(
            rightEdgeMm,
            0,
            design.widthMm,
            verticalGuidesMm,
            gridSpacingMm
          );
          const snapB = snapCoordinateMm(
            bottomEdgeMm,
            0,
            design.heightMm,
            horizontalGuidesMm,
            gridSpacingMm
          );
          setActiveSnapLines({ xMm: snapR.snapLineMm, yMm: snapB.snapLineMm });
          nextW = Math.max(
            4,
            Math.min(100 - origX, Math.round(((snapR.snappedMm / design.widthMm) * 100 - origX) * 100) / 100)
          );
          nextH = Math.max(
            4,
            Math.min(100 - origY, Math.round(((snapB.snappedMm / design.heightMm) * 100 - origY) * 100) / 100)
          );
        } else {
          setActiveSnapLines({ xMm: null, yMm: null });
          nextW = Math.round(nextW * 2) / 2;
          nextH = Math.round(nextH * 2) / 2;
        }

        if (Math.abs(nextW - origW) > 0.01 || Math.abs(nextH - origH) > 0.01) didChange = true;
        onUpdateAssetLayer?.(id, { widthPct: nextW, heightPct: nextH }, { skipHistory: true });
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setActiveSnapLines({ xMm: null, yMm: null });
        onEndDragTransaction?.(didChange);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }
  };

  const radiusPx = design.cornerRadiusMm * pxPerMm;
  const insetPx = design.borderInsetMm * pxPerMm;
  const strokePx = Math.max(1, design.borderWidthMm * pxPerMm);
  const doubleGapPx = Math.max(strokePx * 2.2, 1.1 * pxPerMm);
  const isSingleSelected = selectedLayers.length === 1;

  // Compute non-printing millimeter grid lines for SVG overlay
  const gridXLines: Array<{ px: number; major: boolean }> = [];
  const gridYLines: Array<{ px: number; major: boolean }> = [];
  if (interactive && showGrid && gridSpacingMm > 0) {
    let idx = 1;
    for (let x = gridSpacingMm; x < design.widthMm - 0.05; x += gridSpacingMm) {
      gridXLines.push({ px: x * pxPerMm, major: idx % 2 === 0 });
      idx++;
    }
    idx = 1;
    for (let y = gridSpacingMm; y < design.heightMm - 0.05; y += gridSpacingMm) {
      gridYLines.push({ px: y * pxPerMm, major: idx % 2 === 0 });
      idx++;
    }
  }

  return (
    <div
      ref={cardRef}
      onPointerDown={startMarqueeSelection}
      onClick={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        if (suppressNextCardClickRef.current) {
          suppressNextCardClickRef.current = false;
          return;
        }
        if (e.target === e.currentTarget && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          onSelectLayers?.([]);
        }
      }}
      style={{
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        backgroundColor: design.backgroundColor || '#FFFFFF',
        borderRadius: `${radiusPx}px`,
      }}
      className="relative overflow-hidden select-none shrink-0"
    >
      {/* Background Image */}
      {design.backgroundImage.enabled && design.backgroundImage.dataUrl && (
        <>
          <img
            src={design.backgroundImage.dataUrl}
            alt="Card background"
            draggable={false}
            referrerPolicy="no-referrer"
            style={{
              opacity: design.backgroundImage.opacity,
              objectFit:
                design.backgroundImage.fit === 'stretch'
                  ? 'fill'
                  : design.backgroundImage.fit,
            }}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
          {design.backgroundImage.overlayOpacity > 0 && (
            <div
              style={{
                backgroundColor: design.backgroundImage.overlayColor || '#FFFFFF',
                opacity: design.backgroundImage.overlayOpacity,
              }}
              className="absolute inset-0 pointer-events-none"
            />
          )}
        </>
      )}

      {/* Optional Reference Ghost Overlay (Editor only, never printed) */}
      {showReferenceGhost &&
        design.referenceImage.showGhostOverlay &&
        design.referenceImage.dataUrl && (
          <img
            src={design.referenceImage.dataUrl}
            alt="Reference overlay guide"
            draggable={false}
            referrerPolicy="no-referrer"
            style={{ opacity: design.referenceImage.ghostOpacity }}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-20"
          />
        )}

      {/* Card Border */}
      {design.borderStyle !== 'none' && design.borderWidthMm > 0 && (
        <>
          <div
            style={{
              top: `${insetPx}px`,
              right: `${insetPx}px`,
              bottom: `${insetPx}px`,
              left: `${insetPx}px`,
              borderColor: design.borderColor || '#18181B',
              borderWidth: `${strokePx}px`,
              borderStyle: design.borderStyle === 'dashed' ? 'dashed' : 'solid',
              borderRadius: `${Math.max(0, radiusPx - insetPx)}px`,
            }}
            className="absolute pointer-events-none"
          />
          {design.borderStyle === 'double' && (
            <div
              style={{
                top: `${insetPx + doubleGapPx}px`,
                right: `${insetPx + doubleGapPx}px`,
                bottom: `${insetPx + doubleGapPx}px`,
                left: `${insetPx + doubleGapPx}px`,
                borderColor: design.borderColor || '#18181B',
                borderWidth: `${Math.max(0.75, strokePx * 0.65)}px`,
                borderStyle: 'solid',
                borderRadius: `${Math.max(0, radiusPx - insetPx - doubleGapPx)}px`,
              }}
              className="absolute pointer-events-none"
            />
          )}
        </>
      )}

      {/* Optional Vertical Stub Divider */}
      {design.dividerEnabled && (
        <div
          style={{
            left: `${design.dividerPositionPct}%`,
            top: `${design.borderStyle !== 'none' ? insetPx : 0}px`,
            bottom: `${design.borderStyle !== 'none' ? insetPx : 0}px`,
            borderLeftWidth: `${Math.max(1, 0.3 * pxPerMm)}px`,
            borderLeftStyle: design.dividerStyle,
            borderLeftColor: design.dividerColor || '#A1A1AA',
          }}
          className="absolute pointer-events-none"
        />
      )}

      {/* Editor-Only Precision Grid Overlay */}
      {interactive && showGrid && (
        <svg
          width={widthPx}
          height={heightPx}
          className="absolute inset-0 pointer-events-none z-20"
        >
          {gridXLines.map((line, i) => (
            <line
              key={`gx-${i}`}
              x1={line.px}
              y1={0}
              x2={line.px}
              y2={heightPx}
              stroke={line.major ? 'rgba(37, 99, 235, 0.18)' : 'rgba(37, 99, 235, 0.09)'}
              strokeWidth="1"
            />
          ))}
          {gridYLines.map((line, i) => (
            <line
              key={`gy-${i}`}
              x1={0}
              y1={line.px}
              x2={widthPx}
              y2={line.px}
              stroke={line.major ? 'rgba(37, 99, 235, 0.18)' : 'rgba(37, 99, 235, 0.09)'}
              strokeWidth="1"
            />
          ))}
        </svg>
      )}

      {/* Uploaded Graphic Assets */}
      {design.assets.map((asset) => {
        const isSelected = interactive && isLayerSelected(selectedLayers, 'asset', asset.id);

        return (
          <div
            key={asset.id}
            data-layer-type="asset"
            data-layer-id={asset.id}
            onPointerDown={(e) => startElementDrag(e, 'asset', asset.id, 'move')}
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
            }}
            style={{
              left: `${asset.xPct}%`,
              top: `${asset.yPct}%`,
              width: `${asset.widthPct}%`,
              height: `${asset.heightPct}%`,
              borderRadius: `${asset.borderRadiusMm * pxPerMm}px`,
            }}
            className={`absolute ${
              interactive
                ? isSelected
                  ? 'ring-1 ring-[#2563EB] bg-[#2563EB]/[0.04] cursor-move z-30'
                  : 'hover:ring-1 hover:ring-[#2563EB]/45 cursor-move z-10'
                : 'pointer-events-none'
            }`}
          >
            <img
              src={asset.dataUrl}
              alt={asset.name}
              draggable={false}
              referrerPolicy="no-referrer"
              style={{
                opacity: asset.opacity,
                objectFit: asset.fit,
                borderRadius: `${asset.borderRadiusMm * pxPerMm}px`,
              }}
              className="w-full h-full pointer-events-none"
            />
            {isSelected && isSingleSelected && (
              <div
                onPointerDown={(e) => startElementDrag(e, 'asset', asset.id, 'resize')}
                title="Drag to resize"
                className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-[#2563EB] rounded-[2px] cursor-nwse-resize"
              />
            )}
          </div>
        );
      })}

      {/* Content Blocks */}
      {design.contentBlocks.map((block) => {
        const isSelected = interactive && isLayerSelected(selectedLayers, 'content', block.id);
        const resolvedText = resolveBlockText(block, entry, rowIndex);
        const fontSizePx = ptToPx(block.fontSizePt);
        const padPx = block.paddingMm * pxPerMm;

        return (
          <div
            key={block.id}
            data-layer-type="content"
            data-layer-id={block.id}
            onPointerDown={(e) => startElementDrag(e, 'content', block.id, 'move')}
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
            }}
            style={{
              left: `${block.xPct}%`,
              top: `${block.yPct}%`,
              width: `${block.widthPct}%`,
              fontFamily: `"${block.fontFamily}", sans-serif`,
              fontSize: `${fontSizePx}px`,
              fontWeight: block.fontWeight,
              lineHeight: 1.25,
              color: block.color || '#09090B',
              textAlign: block.align,
              letterSpacing: `${block.letterSpacingEm}em`,
              backgroundColor: block.backgroundColor || 'transparent',
              borderColor: block.borderColor || 'transparent',
              borderWidth: block.borderColor ? `${Math.max(0.75, 0.25 * pxPerMm)}px` : 0,
              borderStyle: block.borderColor ? 'solid' : 'none',
              borderRadius: block.backgroundColor || block.borderColor ? `${0.8 * pxPerMm}px` : 0,
              padding: `${padPx}px`,
            }}
            className={`absolute whitespace-pre-wrap break-words ${
              interactive
                ? isSelected
                  ? 'ring-1 ring-[#2563EB] bg-[#2563EB]/[0.04] cursor-move z-30'
                  : 'hover:ring-1 hover:ring-[#2563EB]/45 cursor-move z-10'
                : 'pointer-events-none'
            }`}
          >
            {resolvedText || (interactive ? <span className="opacity-35 italic">Empty</span> : '')}
            {isSelected && isSingleSelected && (
              <div
                onPointerDown={(e) => startElementDrag(e, 'content', block.id, 'resize')}
                title="Drag to resize width"
                className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-4 bg-white border-2 border-[#2563EB] rounded-[2px] cursor-ew-resize"
              />
            )}
          </div>
        );
      })}

      {/* Editor-Only Draggable Ruler Guides */}
      {interactive &&
        showGuides &&
        guides.map((guide) => {
          const isVertical = guide.axis === 'x';
          const posPx = guide.positionMm * pxPerMm;
          const isActive =
            draggingGuideId === guide.id ||
            (isVertical &&
              activeSnapLines.xMm !== null &&
              Math.abs(activeSnapLines.xMm - guide.positionMm) < 0.05) ||
            (!isVertical &&
              activeSnapLines.yMm !== null &&
              Math.abs(activeSnapLines.yMm - guide.positionMm) < 0.05);

          return (
            <div
              key={guide.id}
              onPointerDown={(e) => startGuideDrag(e, guide)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onRemoveGuide?.(guide.id);
              }}
              title={`Drag to move · Double-click to remove (${formatDimension(guide.positionMm, design.unit)})`}
              style={
                isVertical
                  ? { left: `${posPx - 3}px`, top: 0, bottom: 0, width: '7px' }
                  : { top: `${posPx - 3}px`, left: 0, right: 0, height: '7px' }
              }
              className={`absolute z-35 group ${
                isVertical ? 'cursor-ew-resize' : 'cursor-ns-resize'
              }`}
            >
              <div
                className={
                  isVertical
                    ? `mx-auto h-full w-px transition-colors ${
                        isActive ? 'bg-[#2563EB]' : 'bg-[#3B82F6]/70 group-hover:bg-[#2563EB]'
                      }`
                    : `my-auto w-full h-px transition-colors ${
                        isActive ? 'bg-[#2563EB]' : 'bg-[#3B82F6]/70 group-hover:bg-[#2563EB]'
                      }`
                }
              />
              {draggingGuideId === guide.id && (
                <span
                  style={isVertical ? { left: '8px', top: '6px' } : { left: '6px', top: '8px' }}
                  className="absolute px-1.5 py-0.5 text-[10px] font-mono-tabular bg-[#18181B] text-white rounded whitespace-nowrap pointer-events-none"
                >
                  {formatDimension(guide.positionMm, design.unit)}
                </span>
              )}
            </div>
          );
        })}

      {/* Dynamic Center / Guide Snap Feedback Lines */}
      {interactive && activeSnapLines.xMm !== null && (
        <div
          style={{ left: `${activeSnapLines.xMm * pxPerMm}px` }}
          className="absolute top-0 bottom-0 w-px bg-[#2563EB] pointer-events-none z-40"
        />
      )}
      {interactive && activeSnapLines.yMm !== null && (
        <div
          style={{ top: `${activeSnapLines.yMm * pxPerMm}px` }}
          className="absolute left-0 right-0 h-px bg-[#2563EB] pointer-events-none z-40"
        />
      )}

      {/* Marquee Selection Rectangle */}
      {marquee &&
        (Math.abs(marquee.currentX - marquee.startX) > 3 ||
          Math.abs(marquee.currentY - marquee.startY) > 3) && (
          <div
            style={{
              left: `${Math.min(marquee.startX, marquee.currentX)}px`,
              top: `${Math.min(marquee.startY, marquee.currentY)}px`,
              width: `${Math.abs(marquee.currentX - marquee.startX)}px`,
              height: `${Math.abs(marquee.currentY - marquee.startY)}px`,
            }}
            className="absolute z-40 pointer-events-none bg-[#2563EB]/10 border border-[#2563EB]"
          />
        )}
    </div>
  );
}
