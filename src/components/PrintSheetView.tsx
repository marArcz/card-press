import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { CardDesign, EntryRow, PrintSheetConfig } from '../types';
import {
  computeSheetMetrics,
  getSelectedEntriesSlice,
  PAPER_DIMENSIONS_MM,
} from '../utils/cardRenderer';
import { ExportProgress } from '../utils/pdfExport';
import { CardPreview } from './CardPreview';

interface PrintSheetViewProps {
  design: CardDesign;
  entries: EntryRow[];
  sheetConfig: PrintSheetConfig;
  onUpdateSheetConfig: (patch: Partial<PrintSheetConfig>) => void;
  onExportPdf: () => void;
  isExporting: boolean;
  exportProgress: ExportProgress | null;
}

export function PrintSheetView({
  design,
  entries,
  sheetConfig,
  onUpdateSheetConfig,
  onExportPdf,
  isExporting,
  exportProgress,
}: PrintSheetViewProps) {
  const [pageIndex, setPageIndex] = useState(0);

  const selectedEntries = useMemo(
    () => getSelectedEntriesSlice(entries, sheetConfig),
    [entries, sheetConfig]
  );

  const metrics = useMemo(
    () => computeSheetMetrics(design, sheetConfig, selectedEntries.length),
    [design, sheetConfig, selectedEntries.length]
  );

  const safePageIndex =
    metrics.totalPages > 0 ? Math.min(pageIndex, metrics.totalPages - 1) : 0;

  const pageEntries = useMemo(() => {
    if (!metrics.fitsOnPage || metrics.cardsPerPage === 0) return [];
    const start = safePageIndex * metrics.cardsPerPage;
    return selectedEntries.slice(start, start + metrics.cardsPerPage);
  }, [metrics.fitsOnPage, metrics.cardsPerPage, safePageIndex, selectedEntries]);

  // Scale sheet preview cleanly inside the desktop viewport
  const maxPreviewWidth = sheetConfig.orientation === 'landscape' ? 760 : 540;
  const maxPreviewHeight = 680;
  const scale = Math.min(
    maxPreviewWidth / metrics.pageWidthMm,
    maxPreviewHeight / metrics.pageHeightMm
  );
  const sheetWidthPx = Math.round(metrics.pageWidthMm * scale);
  const sheetHeightPx = Math.round(metrics.pageHeightMm * scale);

  const cropLenPx = sheetConfig.cropMarkLengthMm * scale;
  const cropOffsetPx = sheetConfig.cropMarkOffsetMm * scale;

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#F8F9FA]">
      {/* Left Print Sheet Configurator */}
      <aside className="w-[310px] shrink-0 bg-white border-r border-[#E4E4E7] flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 border-b border-[#E4E4E7]">
          <h2 className="text-xs font-semibold text-[#09090B]">Print Sheet Setup</h2>
          <p className="text-[11px] text-[#71717A] mt-0.5">
            Multi-card imposition with vector crop marks
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Paper Size */}
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-[#09090B]">Paper Size</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['a4', 'letter'] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => onUpdateSheetConfig({ paperSize: size })}
                  className={`px-3 py-2 text-left rounded-md border transition-colors ${
                    sheetConfig.paperSize === size
                      ? 'border-[#18181B] bg-[#FAFAFA]'
                      : 'border-[#E4E4E7] hover:border-[#A1A1AA]'
                  }`}
                >
                  <div className="text-xs font-medium text-[#09090B]">
                    {size === 'a4' ? 'A4' : 'US Letter'}
                  </div>
                  <div className="text-[10px] font-mono-tabular text-[#71717A] mt-0.5">
                    {size === 'a4' ? '210 × 297 mm' : '215.9 × 279.4 mm'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-[#09090B]">Orientation</label>
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
              {(['portrait', 'landscape'] as const).map((orientation) => (
                <button
                  key={orientation}
                  type="button"
                  onClick={() => onUpdateSheetConfig({ orientation })}
                  className={`py-1.5 text-xs font-medium capitalize rounded transition-colors ${
                    sheetConfig.orientation === orientation
                      ? 'bg-white text-[#09090B] shadow-xs'
                      : 'text-[#52525B] hover:text-[#09090B]'
                  }`}
                >
                  {orientation}
                </button>
              ))}
            </div>
          </div>

          {/* Margins & Gutter */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#71717A] mb-1">
                Page Margin ({sheetConfig.marginMm} mm)
              </label>
              <input
                type="number"
                min={4}
                max={35}
                step={1}
                value={sheetConfig.marginMm}
                onChange={(e) =>
                  onUpdateSheetConfig({
                    marginMm: Math.max(4, Math.min(35, Number(e.target.value) || 4)),
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#71717A] mb-1">
                Card Gap ({sheetConfig.gapMm} mm)
              </label>
              <input
                type="number"
                min={0}
                max={20}
                step={0.5}
                value={sheetConfig.gapMm}
                onChange={(e) =>
                  onUpdateSheetConfig({
                    gapMm: Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
              />
            </div>
          </div>

          <hr className="border-[#F4F4F5]" />

          {/* Crop Marks & Cut Guides */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold text-[#09090B]">Trim & Cutting Marks</h3>

            <label className="flex items-center justify-between text-xs text-[#09090B] cursor-pointer">
              <span>Vector corner crop marks</span>
              <input
                type="checkbox"
                checked={sheetConfig.showCropMarks}
                onChange={(e) => onUpdateSheetConfig({ showCropMarks: e.target.checked })}
                className="accent-[#18181B]"
              />
            </label>

            {sheetConfig.showCropMarks && (
              <div className="grid grid-cols-2 gap-2.5 pl-1">
                <div>
                  <label className="block text-[10px] text-[#71717A] mb-1">
                    Mark Length ({sheetConfig.cropMarkLengthMm} mm)
                  </label>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={0.5}
                    value={sheetConfig.cropMarkLengthMm}
                    onChange={(e) =>
                      onUpdateSheetConfig({ cropMarkLengthMm: Number(e.target.value) })
                    }
                    className="w-full accent-[#18181B]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#71717A] mb-1">
                    Offset ({sheetConfig.cropMarkOffsetMm} mm)
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.5}
                    value={sheetConfig.cropMarkOffsetMm}
                    onChange={(e) =>
                      onUpdateSheetConfig({ cropMarkOffsetMm: Number(e.target.value) })
                    }
                    className="w-full accent-[#18181B]"
                  />
                </div>
              </div>
            )}

            <label className="flex items-center justify-between text-xs text-[#09090B] cursor-pointer">
              <span>Light dashed cut outline</span>
              <input
                type="checkbox"
                checked={sheetConfig.showCutGuides}
                onChange={(e) => onUpdateSheetConfig({ showCutGuides: e.target.checked })}
                className="accent-[#18181B]"
              />
            </label>
          </div>

          <hr className="border-[#F4F4F5]" />

          {/* Entry Range */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-semibold text-[#09090B]">Entries to Print</h3>
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
              <button
                type="button"
                onClick={() => onUpdateSheetConfig({ rangeMode: 'all' })}
                className={`py-1.5 text-[11px] font-medium rounded transition-colors ${
                  sheetConfig.rangeMode === 'all'
                    ? 'bg-white text-[#09090B] shadow-xs'
                    : 'text-[#52525B] hover:text-[#09090B]'
                }`}
              >
                All ({entries.length})
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSheetConfig({
                    rangeMode: 'custom',
                    rangeStart: 1,
                    rangeEnd: Math.max(1, entries.length),
                  })
                }
                className={`py-1.5 text-[11px] font-medium rounded transition-colors ${
                  sheetConfig.rangeMode === 'custom'
                    ? 'bg-white text-[#09090B] shadow-xs'
                    : 'text-[#52525B] hover:text-[#09090B]'
                }`}
              >
                Custom Range
              </button>
            </div>

            {sheetConfig.rangeMode === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#71717A] mb-1">From Entry #</label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, entries.length)}
                    value={sheetConfig.rangeStart}
                    onChange={(e) =>
                      onUpdateSheetConfig({
                        rangeStart: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#71717A] mb-1">To Entry #</label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, entries.length)}
                    value={sheetConfig.rangeEnd}
                    onChange={(e) =>
                      onUpdateSheetConfig({
                        rangeEnd: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                  />
                </div>
              </div>
            )}
          </div>

          <hr className="border-[#F4F4F5]" />

          {/* Imposition Summary Table */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-[#F4F4F5]">
              <span className="text-[#71717A]">Sheet Grid</span>
              <span className="font-mono-tabular text-[#09090B]">
                {metrics.fitsOnPage ? `${metrics.cols} cols × ${metrics.rows} rows` : 'Does not fit'}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-[#F4F4F5]">
              <span className="text-[#71717A]">Cards per Sheet</span>
              <span className="font-mono-tabular text-[#09090B]">{metrics.cardsPerPage}</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-[#F4F4F5]">
              <span className="text-[#71717A]">Total Cards</span>
              <span className="font-mono-tabular text-[#09090B]">{metrics.totalCards}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#71717A]">PDF Pages</span>
              <span className="font-mono-tabular font-semibold text-[#09090B]">
                {metrics.totalPages}
              </span>
            </div>
          </div>

          {!metrics.fitsOnPage && (
            <div
              role="alert"
              className="p-3 rounded-md bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-[11px] flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Card size ({design.widthMm} × {design.heightMm} mm) exceeds printable sheet area. Reduce card size, lower margins, or switch orientation.
              </span>
            </div>
          )}
        </div>

        {/* Sticky Export Footer */}
        <div className="p-4 border-t border-[#E4E4E7] bg-white space-y-2">
          {isExporting && exportProgress && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[#52525B] font-mono-tabular">
                <span>
                  {exportProgress.stage === 'saving'
                    ? 'Saving PDF...'
                    : `Rendering card ${exportProgress.completed} of ${exportProgress.total}`}
                </span>
                <span>
                  {exportProgress.total > 0
                    ? `${Math.round((exportProgress.completed / exportProgress.total) * 100)}%`
                    : '0%'}
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#F4F4F5] rounded-full overflow-hidden">
                <div
                  style={{
                    width: `${
                      exportProgress.total > 0
                        ? (exportProgress.completed / exportProgress.total) * 100
                        : 0
                    }%`,
                  }}
                  className="h-full bg-[#18181B] transition-all duration-150"
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onExportPdf}
            disabled={!metrics.fitsOnPage || selectedEntries.length === 0 || isExporting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#18181B] hover:bg-[#27272A] disabled:opacity-45 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {isExporting ? 'Compiling Print PDF...' : 'Export Print-Ready PDF'}
          </button>
        </div>
      </aside>

      {/* Sheet Preview Canvas */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="h-11 shrink-0 px-5 bg-white/80 backdrop-blur-xs border-b border-[#E4E4E7] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-[#52525B] font-mono-tabular">
            <span>{PAPER_DIMENSIONS_MM[sheetConfig.paperSize].label}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{sheetConfig.orientation}</span>
            <span aria-hidden="true">·</span>
            <span>300 DPI Print Output</span>
          </div>

          <div className="inline-flex items-center border border-[#E4E4E7] rounded-md bg-white">
            <button
              type="button"
              onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
              disabled={safePageIndex <= 0}
              aria-label="Previous sheet"
              className="p-1 text-[#52525B] hover:text-[#09090B] disabled:opacity-35"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2.5 text-[11px] font-mono-tabular text-[#09090B] whitespace-nowrap">
              {metrics.totalPages > 0
                ? `Sheet ${safePageIndex + 1} / ${metrics.totalPages}`
                : 'Sheet 0 / 0'}
            </span>
            <button
              type="button"
              onClick={() => setPageIndex(Math.min(metrics.totalPages - 1, safePageIndex + 1))}
              disabled={safePageIndex >= metrics.totalPages - 1}
              aria-label="Next sheet"
              className="p-1 text-[#52525B] hover:text-[#09090B] disabled:opacity-35"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto flex items-center justify-center p-8">
          {!metrics.fitsOnPage ? (
            <div className="max-w-sm text-center p-6 bg-white border border-[#E4E4E7] rounded-lg">
              <p className="text-sm font-medium text-[#09090B]">Card exceeds printable paper area</p>
              <p className="text-xs text-[#71717A] mt-1">
                Try switching the sheet to Landscape orientation or lowering page margins in the left panel.
              </p>
            </div>
          ) : selectedEntries.length === 0 ? (
            <div className="max-w-sm text-center p-6 bg-white border border-[#E4E4E7] rounded-lg">
              <p className="text-sm font-medium text-[#09090B]">No entries selected for print</p>
              <p className="text-xs text-[#71717A] mt-1">
                Import an Excel spreadsheet or add entries in the Data tab to preview print sheets.
              </p>
            </div>
          ) : (
            <div
              style={{
                width: `${sheetWidthPx}px`,
                height: `${sheetHeightPx}px`,
              }}
              className="relative bg-white shadow-[0_14px_40px_-14px_rgba(9,9,11,0.16)] ring-1 ring-black/8 shrink-0"
            >
              {/* Subtle Margin Guide */}
              <div
                style={{
                  top: `${sheetConfig.marginMm * scale}px`,
                  right: `${sheetConfig.marginMm * scale}px`,
                  bottom: `${sheetConfig.marginMm * scale}px`,
                  left: `${sheetConfig.marginMm * scale}px`,
                }}
                className="absolute border border-dashed border-[#E4E4E7] pointer-events-none"
              />

              {/* Rendered Cards for Current Sheet */}
              {pageEntries.map(({ entry, originalIndex }, slotIdx) => {
                const col = slotIdx % metrics.cols;
                const row = Math.floor(slotIdx / metrics.cols);
                const xMm = metrics.offsetXMm + col * (design.widthMm + sheetConfig.gapMm);
                const yMm = metrics.offsetYMm + row * (design.heightMm + sheetConfig.gapMm);

                const xPx = xMm * scale;
                const yPx = yMm * scale;
                const wPx = design.widthMm * scale;
                const hPx = design.heightMm * scale;

                return (
                  <div
                    key={originalIndex}
                    style={{
                      left: `${xPx}px`,
                      top: `${yPx}px`,
                      width: `${wPx}px`,
                      height: `${hPx}px`,
                    }}
                    className="absolute"
                  >
                    <CardPreview
                      design={design}
                      entry={entry}
                      rowIndex={originalIndex}
                      widthPx={wPx}
                      interactive={false}
                    />

                    {/* Optional Light Cut Outline */}
                    {sheetConfig.showCutGuides && (
                      <div className="absolute inset-0 border border-dashed border-[#A1A1AA] pointer-events-none" />
                    )}
                  </div>
                );
              })}

              {/* Crisp Vector SVG Crop Marks */}
              {sheetConfig.showCropMarks && (
                <svg
                  width={sheetWidthPx}
                  height={sheetHeightPx}
                  viewBox={`0 0 ${sheetWidthPx} ${sheetHeightPx}`}
                  className="absolute inset-0 pointer-events-none"
                >
                  {pageEntries.map(({ originalIndex }, slotIdx) => {
                    const col = slotIdx % metrics.cols;
                    const row = Math.floor(slotIdx / metrics.cols);
                    const x =
                      (metrics.offsetXMm + col * (design.widthMm + sheetConfig.gapMm)) * scale;
                    const y =
                      (metrics.offsetYMm + row * (design.heightMm + sheetConfig.gapMm)) * scale;
                    const w = design.widthMm * scale;
                    const h = design.heightMm * scale;

                    return (
                      <g key={originalIndex} stroke="#27272A" strokeWidth="0.75">
                        {/* Top-left */}
                        <line x1={x - cropOffsetPx - cropLenPx} y1={y} x2={x - cropOffsetPx} y2={y} />
                        <line x1={x} y1={y - cropOffsetPx - cropLenPx} x2={x} y2={y - cropOffsetPx} />
                        {/* Top-right */}
                        <line
                          x1={x + w + cropOffsetPx}
                          y1={y}
                          x2={x + w + cropOffsetPx + cropLenPx}
                          y2={y}
                        />
                        <line
                          x1={x + w}
                          y1={y - cropOffsetPx - cropLenPx}
                          x2={x + w}
                          y2={y - cropOffsetPx}
                        />
                        {/* Bottom-left */}
                        <line
                          x1={x - cropOffsetPx - cropLenPx}
                          y1={y + h}
                          x2={x - cropOffsetPx}
                          y2={y + h}
                        />
                        <line
                          x1={x}
                          y1={y + h + cropOffsetPx}
                          x2={x}
                          y2={y + h + cropOffsetPx + cropLenPx}
                        />
                        {/* Bottom-right */}
                        <line
                          x1={x + w + cropOffsetPx}
                          y1={y + h}
                          x2={x + w + cropOffsetPx + cropLenPx}
                          y2={y + h}
                        />
                        <line
                          x1={x + w}
                          y1={y + h + cropOffsetPx}
                          x2={x + w}
                          y2={y + h + cropOffsetPx + cropLenPx}
                        />
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
