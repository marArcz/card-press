import {
  CardDesign,
  ContentBlock,
  EntryRow,
  PrintSheetConfig,
  SheetLayoutMetrics,
} from '../types';

export const PAPER_DIMENSIONS_MM: Record<'a4' | 'letter', { width: number; height: number; label: string }> = {
  a4: { width: 210, height: 297, label: 'A4 (210 × 297 mm)' },
  letter: { width: 215.9, height: 279.4, label: 'US Letter (8.5 × 11 in)' },
};

export function mmToIn(mm: number): number {
  return mm / 25.4;
}

export function inToMm(inches: number): number {
  return inches * 25.4;
}

export function formatDimension(mm: number, unit: 'mm' | 'in'): string {
  if (unit === 'in') {
    return `${mmToIn(mm).toFixed(2)} in`;
  }
  return `${Math.round(mm * 10) / 10} mm`;
}

export function resolveBlockText(
  block: ContentBlock,
  entry: EntryRow | undefined,
  rowIndex: number
): string {
  const paddedRow = String(rowIndex + 1).padStart(4, '0');
  let raw = '';

  if (block.mode === 'static') {
    raw = block.text;
  } else if (block.mode === 'column') {
    let colValue = '';
    if (block.columnKey === '__ROW_NUMBER__') {
      colValue = paddedRow;
    } else if (entry && block.columnKey) {
      colValue = entry[block.columnKey] ?? '';
    }
    raw = `${block.prefix}${colValue}${block.suffix}`;
  } else {
    raw = block.text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
      if (key === 'RowNumber' || key === '#') return paddedRow;
      if (!entry) return '';
      if (key in entry) return entry[key] ?? '';
      const matched = Object.keys(entry).find((k) => k.toLowerCase() === key.toLowerCase());
      return matched ? entry[matched] ?? '' : '';
    });
  }

  return block.uppercase ? raw.toUpperCase() : raw;
}

export function getSelectedEntriesSlice(
  entries: EntryRow[],
  sheetConfig: PrintSheetConfig
): Array<{ entry: EntryRow; originalIndex: number }> {
  if (entries.length === 0) return [];
  if (sheetConfig.rangeMode === 'all') {
    return entries.map((entry, originalIndex) => ({ entry, originalIndex }));
  }

  const start = Math.max(1, Math.min(sheetConfig.rangeStart, entries.length));
  const end = Math.max(start, Math.min(sheetConfig.rangeEnd, entries.length));
  const sliced: Array<{ entry: EntryRow; originalIndex: number }> = [];
  for (let i = start - 1; i < end; i++) {
    sliced.push({ entry: entries[i], originalIndex: i });
  }
  return sliced;
}

export function computeSheetMetrics(
  design: CardDesign,
  sheetConfig: PrintSheetConfig,
  totalSelectedEntries: number
): SheetLayoutMetrics {
  const base = PAPER_DIMENSIONS_MM[sheetConfig.paperSize];
  const pageWidthMm = sheetConfig.orientation === 'portrait' ? base.width : base.height;
  const pageHeightMm = sheetConfig.orientation === 'portrait' ? base.height : base.width;

  const usableW = Math.max(0, pageWidthMm - sheetConfig.marginMm * 2);
  const usableH = Math.max(0, pageHeightMm - sheetConfig.marginMm * 2);

  const cardW = Math.max(10, design.widthMm);
  const cardH = Math.max(10, design.heightMm);
  const gap = Math.max(0, sheetConfig.gapMm);

  const cols = cardW <= usableW ? Math.floor((usableW + gap) / (cardW + gap)) : 0;
  const rows = cardH <= usableH ? Math.floor((usableH + gap) / (cardH + gap)) : 0;
  const fitsOnPage = cols >= 1 && rows >= 1;
  const cardsPerPage = fitsOnPage ? cols * rows : 0;
  const totalPages = cardsPerPage > 0 ? Math.max(1, Math.ceil(totalSelectedEntries / cardsPerPage)) : 0;

  const gridW = cols > 0 ? cols * cardW + (cols - 1) * gap : 0;
  const gridH = rows > 0 ? rows * cardH + (rows - 1) * gap : 0;

  const offsetXMm = fitsOnPage ? (pageWidthMm - gridW) / 2 : sheetConfig.marginMm;
  const offsetYMm = fitsOnPage ? (pageHeightMm - gridH) / 2 : sheetConfig.marginMm;

  return {
    pageWidthMm,
    pageHeightMm,
    cols,
    rows,
    cardsPerPage,
    totalCards: totalSelectedEntries,
    totalPages,
    offsetXMm,
    offsetYMm,
    fitsOnPage,
  };
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image resource.'));
    img.src = src;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawImageFitted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: 'cover' | 'contain' | 'stretch'
): void {
  if (fit === 'stretch') {
    ctx.drawImage(img, x, y, w, h);
    return;
  }

  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = w / Math.max(1, h);

  let drawW = w;
  let drawH = h;
  let drawX = x;
  let drawY = y;

  if (fit === 'cover') {
    if (imgRatio > boxRatio) {
      drawH = h;
      drawW = h * imgRatio;
      drawX = x - (drawW - w) / 2;
    } else {
      drawW = w;
      drawH = w / imgRatio;
      drawY = y - (drawH - h) / 2;
    }
  } else {
    if (imgRatio > boxRatio) {
      drawW = w;
      drawH = w / imgRatio;
      drawY = y + (h - drawH) / 2;
    } else {
      drawH = h;
      drawW = h * imgRatio;
      drawX = x + (w - drawW) / 2;
    }
  }

  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

function measureTrackedText(ctx: CanvasRenderingContext2D, text: string, trackingPx: number): number {
  if (!text) return 0;
  if (Math.abs(trackingPx) < 0.01) {
    return ctx.measureText(text).width;
  }
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += ctx.measureText(text[i]).width;
    if (i < text.length - 1) width += trackingPx;
  }
  return width;
}

function drawTrackedLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  boxWidth: number,
  align: 'left' | 'center' | 'right',
  trackingPx: number
): void {
  const lineWidth = measureTrackedText(ctx, text, trackingPx);
  let cursorX = x;
  if (align === 'center') {
    cursorX = x + (boxWidth - lineWidth) / 2;
  } else if (align === 'right') {
    cursorX = x + boxWidth - lineWidth;
  }

  if (Math.abs(trackingPx) < 0.01) {
    ctx.textAlign = 'left';
    ctx.fillText(text, cursorX, y);
    return;
  }

  ctx.textAlign = 'left';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursorX, y);
    cursorX += ctx.measureText(ch).width + trackingPx;
  }
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  trackingPx: number
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (para.trim() === '') {
      lines.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureTrackedText(ctx, candidate, trackingPx) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

export function renderCardToCanvas(
  canvas: HTMLCanvasElement,
  design: CardDesign,
  entry: EntryRow | undefined,
  rowIndex: number,
  dpi: number,
  imageCache: Map<string, HTMLImageElement>
): void {
  const pxPerMm = dpi / 25.4;
  const widthPx = Math.max(1, Math.round(design.widthMm * pxPerMm));
  const heightPx = Math.max(1, Math.round(design.heightMm * pxPerMm));

  canvas.width = widthPx;
  canvas.height = heightPx;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.save();

  const radiusPx = design.cornerRadiusMm * pxPerMm;
  drawRoundedRectPath(ctx, 0, 0, widthPx, heightPx, radiusPx);
  ctx.clip();

  // 1. Base background fill
  ctx.fillStyle = design.backgroundColor || '#FFFFFF';
  ctx.fillRect(0, 0, widthPx, heightPx);

  // 2. Optional background image
  if (design.backgroundImage.enabled && design.backgroundImage.dataUrl) {
    const bgImg = imageCache.get(design.backgroundImage.dataUrl);
    if (bgImg) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, design.backgroundImage.opacity));
      drawImageFitted(ctx, bgImg, 0, 0, widthPx, heightPx, design.backgroundImage.fit);
      ctx.restore();
    }

    if (design.backgroundImage.overlayOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, design.backgroundImage.overlayOpacity));
      ctx.fillStyle = design.backgroundImage.overlayColor || '#FFFFFF';
      ctx.fillRect(0, 0, widthPx, heightPx);
      ctx.restore();
    }
  }

  // 3. Card border
  if (design.borderStyle !== 'none' && design.borderWidthMm > 0) {
    const insetPx = design.borderInsetMm * pxPerMm;
    const strokePx = Math.max(1, design.borderWidthMm * pxPerMm);
    const bx = insetPx;
    const by = insetPx;
    const bw = Math.max(0, widthPx - insetPx * 2);
    const bh = Math.max(0, heightPx - insetPx * 2);
    const innerRadius = Math.max(0, radiusPx - insetPx);

    ctx.save();
    ctx.strokeStyle = design.borderColor || '#18181B';
    ctx.lineWidth = strokePx;

    if (design.borderStyle === 'dashed') {
      ctx.setLineDash([strokePx * 4, strokePx * 3]);
      drawRoundedRectPath(ctx, bx, by, bw, bh, innerRadius);
      ctx.stroke();
    } else if (design.borderStyle === 'double') {
      drawRoundedRectPath(ctx, bx, by, bw, bh, innerRadius);
      ctx.stroke();
      const gap = Math.max(strokePx * 2.2, 1.1 * pxPerMm);
      if (bw > gap * 2 && bh > gap * 2) {
        ctx.lineWidth = Math.max(0.75, strokePx * 0.65);
        drawRoundedRectPath(
          ctx,
          bx + gap,
          by + gap,
          bw - gap * 2,
          bh - gap * 2,
          Math.max(0, innerRadius - gap)
        );
        ctx.stroke();
      }
    } else {
      drawRoundedRectPath(ctx, bx, by, bw, bh, innerRadius);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4. Optional vertical stub divider
  if (design.dividerEnabled) {
    const divX = (design.dividerPositionPct / 100) * widthPx;
    const padY = design.borderStyle !== 'none' ? design.borderInsetMm * pxPerMm : 0;
    ctx.save();
    ctx.strokeStyle = design.dividerColor || '#A1A1AA';
    ctx.lineWidth = Math.max(1, 0.3 * pxPerMm);
    if (design.dividerStyle === 'dashed') {
      ctx.setLineDash([1.6 * pxPerMm, 1.4 * pxPerMm]);
    }
    ctx.beginPath();
    ctx.moveTo(divX, padY);
    ctx.lineTo(divX, heightPx - padY);
    ctx.stroke();
    ctx.restore();
  }

  // 5. Uploaded asset layers
  for (const asset of design.assets) {
    const img = imageCache.get(asset.dataUrl);
    if (!img) continue;

    const ax = (asset.xPct / 100) * widthPx;
    const ay = (asset.yPct / 100) * heightPx;
    const aw = (asset.widthPct / 100) * widthPx;
    const ah = (asset.heightPct / 100) * heightPx;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, asset.opacity));
    drawRoundedRectPath(ctx, ax, ay, aw, ah, asset.borderRadiusMm * pxPerMm);
    ctx.clip();
    drawImageFitted(ctx, img, ax, ay, aw, ah, asset.fit);
    ctx.restore();
  }

  // 6. Content blocks
  for (const block of design.contentBlocks) {
    const resolved = resolveBlockText(block, entry, rowIndex);
    const bx = (block.xPct / 100) * widthPx;
    const by = (block.yPct / 100) * heightPx;
    const bw = Math.max(10, (block.widthPct / 100) * widthPx);
    const fontSizePx = (block.fontSizePt * dpi) / 72;
    const lineHeightPx = fontSizePx * 1.25;
    const padPx = block.paddingMm * pxPerMm;
    const trackingPx = block.letterSpacingEm * fontSizePx;

    ctx.save();
    ctx.font = `${block.fontWeight} ${fontSizePx}px "${block.fontFamily}", sans-serif`;
    ctx.textBaseline = 'top';

    const innerW = Math.max(8, bw - padPx * 2);
    const lines = wrapTextLines(ctx, resolved, innerW, trackingPx);
    const blockH = Math.max(lineHeightPx, lines.length * lineHeightPx) + padPx * 2;

    if (block.backgroundColor) {
      ctx.fillStyle = block.backgroundColor;
      drawRoundedRectPath(ctx, bx, by, bw, blockH, 0.8 * pxPerMm);
      ctx.fill();
    }

    if (block.borderColor) {
      ctx.strokeStyle = block.borderColor;
      ctx.lineWidth = Math.max(0.75, 0.25 * pxPerMm);
      drawRoundedRectPath(ctx, bx, by, bw, blockH, 0.8 * pxPerMm);
      ctx.stroke();
    }

    ctx.fillStyle = block.color || '#09090B';
    lines.forEach((line, idx) => {
      const ly = by + padPx + idx * lineHeightPx + (lineHeightPx - fontSizePx) * 0.2;
      drawTrackedLine(ctx, line, bx + padPx, ly, innerW, block.align, trackingPx);
    });

    ctx.restore();
  }

  ctx.restore();
}
