import React, { useRef } from 'react';
import { AssetLayer, CardDesign, ContentBlock, EntryRow, SelectedLayer } from '../types';
import { resolveBlockText } from '../utils/cardRenderer';

interface CardPreviewProps {
  design: CardDesign;
  entry: EntryRow | undefined;
  rowIndex: number;
  widthPx: number;
  interactive?: boolean;
  selectedLayer?: SelectedLayer;
  onSelectLayer?: (layer: SelectedLayer) => void;
  onUpdateContentBlock?: (id: string, patch: Partial<ContentBlock>) => void;
  onUpdateAssetLayer?: (id: string, patch: Partial<AssetLayer>) => void;
  showReferenceGhost?: boolean;
}

export function CardPreview({
  design,
  entry,
  rowIndex,
  widthPx,
  interactive = false,
  selectedLayer = null,
  onSelectLayer,
  onUpdateContentBlock,
  onUpdateAssetLayer,
  showReferenceGhost = false,
}: CardPreviewProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const pxPerMm = widthPx / Math.max(10, design.widthMm);
  const heightPx = design.heightMm * pxPerMm;
  const ptToPx = (pt: number) => (pt * pxPerMm * 25.4) / 72;

  const startDrag = (
    e: React.PointerEvent,
    type: 'content' | 'asset',
    id: string,
    mode: 'move' | 'resize'
  ) => {
    if (!interactive || !cardRef.current) return;
    e.stopPropagation();
    e.preventDefault();

    onSelectLayer?.({ type, id });

    const rect = cardRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    if (type === 'content') {
      const block = design.contentBlocks.find((b) => b.id === id);
      if (!block) return;
      const origX = block.xPct;
      const origY = block.yPct;
      const origW = block.widthPct;

      const onMove = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startY) / rect.height) * 100;

        if (mode === 'move') {
          const nextX = Math.max(0, Math.min(100 - origW, Math.round((origX + dxPct) * 2) / 2));
          const nextY = Math.max(0, Math.min(94, Math.round((origY + dyPct) * 2) / 2));
          onUpdateContentBlock?.(id, { xPct: nextX, yPct: nextY });
        } else {
          const nextW = Math.max(10, Math.min(100 - origX, Math.round((origW + dxPct) * 2) / 2));
          onUpdateContentBlock?.(id, { widthPct: nextW });
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    } else {
      const asset = design.assets.find((a) => a.id === id);
      if (!asset) return;
      const origX = asset.xPct;
      const origY = asset.yPct;
      const origW = asset.widthPct;
      const origH = asset.heightPct;

      const onMove = (ev: PointerEvent) => {
        const dxPct = ((ev.clientX - startX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startY) / rect.height) * 100;

        if (mode === 'move') {
          const nextX = Math.max(0, Math.min(100 - origW, Math.round((origX + dxPct) * 2) / 2));
          const nextY = Math.max(0, Math.min(100 - origH, Math.round((origY + dyPct) * 2) / 2));
          onUpdateAssetLayer?.(id, { xPct: nextX, yPct: nextY });
        } else {
          const nextW = Math.max(4, Math.min(100 - origX, Math.round((origW + dxPct) * 2) / 2));
          const nextH = Math.max(4, Math.min(100 - origY, Math.round((origH + dyPct) * 2) / 2));
          onUpdateAssetLayer?.(id, { widthPct: nextW, heightPct: nextH });
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }
  };

  const radiusPx = design.cornerRadiusMm * pxPerMm;
  const insetPx = design.borderInsetMm * pxPerMm;
  const strokePx = Math.max(1, design.borderWidthMm * pxPerMm);
  const doubleGapPx = Math.max(strokePx * 2.2, 1.1 * pxPerMm);

  return (
    <div
      ref={cardRef}
      onClick={() => {
        if (interactive) onSelectLayer?.(null);
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
        const isSelected =
          interactive && selectedLayer?.type === 'asset' && selectedLayer.id === asset.id;

        return (
          <div
            key={asset.id}
            onPointerDown={(e) => startDrag(e, 'asset', asset.id, 'move')}
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              onSelectLayer?.({ type: 'asset', id: asset.id });
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
                  ? 'ring-1 ring-[#2563EB] cursor-move z-30'
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
            {isSelected && (
              <div
                onPointerDown={(e) => startDrag(e, 'asset', asset.id, 'resize')}
                title="Drag to resize"
                className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-[#2563EB] rounded-[2px] cursor-nwse-resize"
              />
            )}
          </div>
        );
      })}

      {/* Content Blocks */}
      {design.contentBlocks.map((block) => {
        const isSelected =
          interactive && selectedLayer?.type === 'content' && selectedLayer.id === block.id;
        const resolvedText = resolveBlockText(block, entry, rowIndex);
        const fontSizePx = ptToPx(block.fontSizePt);
        const padPx = block.paddingMm * pxPerMm;

        return (
          <div
            key={block.id}
            onPointerDown={(e) => startDrag(e, 'content', block.id, 'move')}
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              onSelectLayer?.({ type: 'content', id: block.id });
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
                  ? 'ring-1 ring-[#2563EB] cursor-move z-30'
                  : 'hover:ring-1 hover:ring-[#2563EB]/45 cursor-move z-10'
                : 'pointer-events-none'
            }`}
          >
            {resolvedText || (interactive ? <span className="opacity-35 italic">Empty</span> : '')}
            {isSelected && (
              <div
                onPointerDown={(e) => startDrag(e, 'content', block.id, 'resize')}
                title="Drag to resize width"
                className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-4 bg-white border-2 border-[#2563EB] rounded-[2px] cursor-ew-resize"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
