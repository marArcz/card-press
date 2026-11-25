import { jsPDF } from 'jspdf';
import { CardDesign, EntryRow, PrintSheetConfig } from '../types';
import {
  computeSheetMetrics,
  getSelectedEntriesSlice,
  loadImageElement,
  renderCardToCanvas,
} from './cardRenderer';

export interface ExportProgress {
  completed: number;
  total: number;
  stage: 'preparing' | 'rendering' | 'saving';
}

function drawCropMarks(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  lengthMm: number,
  offsetMm: number
): void {
  doc.setDrawColor(45, 45, 50);
  doc.setLineWidth(0.18);

  // Top-left
  doc.line(x - offsetMm - lengthMm, y, x - offsetMm, y);
  doc.line(x, y - offsetMm - lengthMm, x, y - offsetMm);

  // Top-right
  doc.line(x + w + offsetMm, y, x + w + offsetMm + lengthMm, y);
  doc.line(x + w, y - offsetMm - lengthMm, x + w, y - offsetMm);

  // Bottom-left
  doc.line(x - offsetMm - lengthMm, y + h, x - offsetMm, y + h);
  doc.line(x, y + h + offsetMm, x, y + h + offsetMm + lengthMm);

  // Bottom-right
  doc.line(x + w + offsetMm, y + h, x + w + offsetMm + lengthMm, y + h);
  doc.line(x + w, y + h + offsetMm, x + w, y + h + offsetMm + lengthMm);
}

function drawCutGuideBox(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  doc.setDrawColor(190, 190, 198);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([1.2, 1.2], 0);
  doc.rect(x, y, w, h, 'S');
  doc.setLineDashPattern([], 0);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function exportRaffleSheetsToPdf(
  design: CardDesign,
  entries: EntryRow[],
  sheetConfig: PrintSheetConfig,
  sourceFileName: string,
  onProgress?: (progress: ExportProgress) => void
): Promise<void> {
  const selected = getSelectedEntriesSlice(entries, sheetConfig);
  if (selected.length === 0) {
    throw new Error('There are no raffle entries to export. Import a spreadsheet or add an entry first.');
  }

  const metrics = computeSheetMetrics(design, sheetConfig, selected.length);
  if (!metrics.fitsOnPage) {
    throw new Error(
      'The configured card dimensions exceed the printable page area. Reduce card size, lower page margins, or switch sheet orientation.'
    );
  }

  onProgress?.({ completed: 0, total: selected.length, stage: 'preparing' });

  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const imageCache = new Map<string, HTMLImageElement>();
  const urlsToLoad = new Set<string>();
  if (design.backgroundImage.enabled && design.backgroundImage.dataUrl) {
    urlsToLoad.add(design.backgroundImage.dataUrl);
  }
  for (const asset of design.assets) {
    if (asset.dataUrl) urlsToLoad.add(asset.dataUrl);
  }

  await Promise.all(
    Array.from(urlsToLoad).map(async (url) => {
      try {
        const img = await loadImageElement(url);
        imageCache.set(url, img);
      } catch {
        // Ignore broken individual asset so PDF still completes cleanly
      }
    })
  );

  const doc = new jsPDF({
    orientation: sheetConfig.orientation,
    unit: 'mm',
    format: sheetConfig.paperSize,
    compress: true,
  });

  // 300 DPI print quality; cap max canvas dimension gently for huge cards
  const maxDimensionMm = Math.max(design.widthMm, design.heightMm);
  const effectiveDpi = maxDimensionMm > 200 ? 220 : 300;
  const offscreen = document.createElement('canvas');

  for (let i = 0; i < selected.length; i++) {
    const pageIdx = Math.floor(i / metrics.cardsPerPage);
    const slotIdx = i % metrics.cardsPerPage;

    if (pageIdx > 0 && slotIdx === 0) {
      doc.addPage(sheetConfig.paperSize, sheetConfig.orientation);
    }

    const col = slotIdx % metrics.cols;
    const row = Math.floor(slotIdx / metrics.cols);

    const cardX = metrics.offsetXMm + col * (design.widthMm + sheetConfig.gapMm);
    const cardY = metrics.offsetYMm + row * (design.heightMm + sheetConfig.gapMm);

    const { entry, originalIndex } = selected[i];
    renderCardToCanvas(offscreen, design, entry, originalIndex, effectiveDpi, imageCache);
    const imgData = offscreen.toDataURL('image/png');

    doc.addImage(imgData, 'PNG', cardX, cardY, design.widthMm, design.heightMm, undefined, 'FAST');

    if (sheetConfig.showCutGuides) {
      drawCutGuideBox(doc, cardX, cardY, design.widthMm, design.heightMm);
    }

    if (sheetConfig.showCropMarks) {
      drawCropMarks(
        doc,
        cardX,
        cardY,
        design.widthMm,
        design.heightMm,
        sheetConfig.cropMarkLengthMm,
        sheetConfig.cropMarkOffsetMm
      );
    }

    onProgress?.({ completed: i + 1, total: selected.length, stage: 'rendering' });

    if (i % 4 === 3) {
      await nextFrame();
    }
  }

  onProgress?.({ completed: selected.length, total: selected.length, stage: 'saving' });

  const cleanBase = sourceFileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'raffle-cards';

  doc.save(`${cleanBase}-print-sheets.pdf`);
}
