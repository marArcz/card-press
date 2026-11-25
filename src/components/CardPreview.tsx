import React, { useRef, useState } from 'react';
import {
  AssetLayer,
  CardDesign,
  ContentBlock,
  DesignUpdateOptions,
  EntryRow,
  SelectedLayerItem,
} from '../types';
import { resolveBlockText } from '../utils/cardRenderer';

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
}

interface MarqueeBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function isLayerSelected(
  layers: SelectedLayerItem[],
  type: 'content' | 'asset',
  id: string
): boolean {
  return layers.some((l) => l.type === type && l.id === id);
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
}: CardPreviewProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const suppressNextCardClickRef = useRef(false);

  const pxPerMm = widthPx / Math.max(10, design.widthMm);
  const heightPx = design.heightMm * pxPerMm;
  const ptToPx = (pt: number) => (pt * pxPerMm * 25.4) / 72;

  const startMarqueeSelection = (e: React.PointerEvent) => {
    if (!interactive || !cardRef.current || e.button !== 0) return;
    // Only start marquee when clicking directly on card background
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
      const nodes = cardRef.current?.querySelectorAll<HTMLElement>('[data-layer-type][data-layer-id]');
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

      // Compute shared group clamp bounds so moving a group preserves relative offsets cleanly
      let minDx = -Infinity;
      let maxDx = Infinity;
      let minDy = -Infinity;
      let maxDy = Infinity;

      initialBlocks.forEach((b) => {
        minDx = Math.max(minDx, -b.xPct);
        maxDx = Math.min(maxDx, 100 - b.widthPct - b.xPct);
        minDy = Math.max(minDy, -b.yPct);
        maxDy = Math.min(maxDy, 94 - b.yPct);
      });
      initialAssets.forEach((a) => {
        minDx = Math.max(minDx, -a.xPct);
        maxDx = Math.min(maxDx, 100 - a.widthPct - a.xPct);
        minDy = Math.max(minDy, -a.yPct);
        maxDy = Math.min(maxDy, 100 - a.heightPct - a.yPct);
      });

      const onMove = (ev: PointerEvent) => {
        const rawDx = ((ev.clientX - startX) / rect.width) * 100;
        const rawDy = ((ev.clientY - startY) / rect.height) * 100;

        const dxPct = Math.round(Math.max(minDx, Math.min(maxDx, rawDx)) * 2) / 2;
        const dyPct = Math.round(Math.max(minDy, Math.min(maxDy, rawDy)) * 2) / 2;

        if (Math.abs(dxPct) > 0 || Math.abs(dyPct) > 0) {
          didChange = true;
        }

        if (onUpdateDesign) {
          onUpdateDesign(
            (prev) => ({
              ...prev,
              contentBlocks: prev.contentBlocks.map((b) => {
                const init = initialBlocks.get(b.id);
                if (!init) return b;
                return {
                  ...b,
                  xPct: Math.round((init.xPct + dxPct) * 2) / 2,
                  yPct: Math.round((init.yPct + dyPct) * 2) / 2,
                };
              }),
              assets: prev.assets.map((a) => {
                const init = initialAssets.get(a.id);
                if (!init) return a;
                return {
                  ...a,
                  xPct: Math.round((init.xPct + dxPct) * 2) / 2,
                  yPct: Math.round((init.yPct + dyPct) * 2) / 2,
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
              { xPct: init.xPct + dxPct, yPct: init.yPct + dyPct },
              { skipHistory: true }
            );
          }
        } else {
          const init = initialAssets.get(id);
          if (init) {
            onUpdateAssetLayer?.(
              id,
              { xPct: init.xPct + dxPct, yPct: init.yPct + dyPct },
              { skipHistory: true }
            );
          }
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
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
        const nextW = Math.max(10, Math.min(100 - origX, Math.round((origW + dxPct) * 2) / 2));
        if (nextW !== origW) didChange = true;
        onUpdateContentBlock?.(id, { widthPct: nextW }, { skipHistory: true });
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
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
        const nextW = Math.max(4, Math.min(100 - origX, Math.round((origW + dxPct) * 2) / 2));
        const nextH = Math.max(4, Math.min(100 - origY, Math.round((origH + dyPct) * 2) / 2));
        if (nextW !== origW || nextH !== origH) didChange = true;
        onUpdateAssetLayer?.(id, { widthPct: nextW, heightPct: nextH }, { skipHistory: true });
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
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
