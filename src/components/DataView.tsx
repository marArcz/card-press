import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { CellSelectionConfig, CellSelectionMode, SpreadsheetData } from '../types';
import {
  colIndexToLetter,
  createDefaultSelection,
  downloadSampleExcel,
  formatRangeA1,
  getNormalizedBounds,
  parseRangeA1,
  parseSpreadsheetFile,
} from '../utils/excel';

interface DataViewProps {
  spreadsheet: SpreadsheetData;
  onImportSpreadsheet: (data: SpreadsheetData) => void;
  onSwitchSheet: (sheetName: string) => void;
  onUpdateSelection: (selection: CellSelectionConfig) => void;
  onUpdateRawCell: (rowIndex: number, colIndex: number, value: string) => void;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDeleteRow: (rowIndex: number) => void;
  onClearEntries: () => void;
  onRestoreSample: () => void;
  onProceedToDesign: () => void;
}

export function DataView({
  spreadsheet,
  onImportSpreadsheet,
  onSwitchSheet,
  onUpdateSelection,
  onUpdateRawCell,
  onAddRow,
  onAddColumn,
  onDeleteRow,
  onClearEntries,
  onRestoreSample,
  onProceedToDesign,
}: DataViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Interactive cell selection & editing state
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragAnchor, setDragAnchor] = useState<{ row: number; col: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [rangeInput, setRangeInput] = useState(() => formatRangeA1(spreadsheet.selection));

  const rowCount = spreadsheet.rawRows.length;
  const colCount = spreadsheet.rawRows[0]?.length ?? 0;

  const formattedRange = useMemo(
    () => (rowCount > 0 && colCount > 0 ? formatRangeA1(spreadsheet.selection) : '—'),
    [spreadsheet.selection, rowCount, colCount]
  );

  useEffect(() => {
    setRangeInput(formattedRange);
  }, [formattedRange]);

  useEffect(() => {
    if (!isDragSelecting) return;
    const handlePointerUp = () => {
      setIsDragSelecting(false);
    };
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, [isDragSelecting]);

  const bounds = useMemo(
    () => getNormalizedBounds(spreadsheet.selection),
    [spreadsheet.selection]
  );

  const excludedRowSet = useMemo(
    () => new Set(spreadsheet.selection.excludedRows),
    [spreadsheet.selection.excludedRows]
  );

  const excludedCellSet = useMemo(
    () => new Set(spreadsheet.selection.excludedCells),
    [spreadsheet.selection.excludedCells]
  );

  const isHeaderRow = (r: number) =>
    spreadsheet.selection.mode === 'rows' &&
    spreadsheet.selection.useFirstRowAsHeader &&
    bounds.maxRow > bounds.minRow &&
    r === bounds.minRow;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setErrorMessage(null);
    setIsParsing(true);
    try {
      const parsed = await parseSpreadsheetFile(file);
      onImportSpreadsheet(parsed);
      setSearchQuery('');
      setEditingCell(null);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not read that spreadsheet. Please upload a valid .xlsx, .xls, or .csv file.'
      );
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    void handleFile(file);
  };

  const commitRangeInput = () => {
    if (rowCount === 0 || colCount === 0) return;
    const parsed = parseRangeA1(rangeInput, rowCount, colCount);
    if (!parsed) {
      setRangeInput(formattedRange);
      return;
    }
    onUpdateSelection({
      ...spreadsheet.selection,
      ...parsed,
      excludedRows: [],
      excludedCells: [],
    });
  };

  const handleCellPointerDown = (e: React.PointerEvent, r: number, c: number) => {
    // Allow inline editor input to work normally
    if (editingCell && editingCell.row === r && editingCell.col === c) {
      return;
    }
    e.preventDefault();
    setEditingCell(null);

    const cellKey = `${r}:${c}`;
    const isInside =
      r >= bounds.minRow && r <= bounds.maxRow && c >= bounds.minCol && c <= bounds.maxCol;

    // Cmd/Ctrl+Click inside current range toggles that individual cell on/off
    if ((e.metaKey || e.ctrlKey) && isInside) {
      const nextExcluded = excludedCellSet.has(cellKey)
        ? spreadsheet.selection.excludedCells.filter((k) => k !== cellKey)
        : [...spreadsheet.selection.excludedCells, cellKey];
      onUpdateSelection({
        ...spreadsheet.selection,
        excludedCells: nextExcluded,
      });
      return;
    }

    // Shift+Click extends from existing anchor
    if (e.shiftKey) {
      onUpdateSelection({
        ...spreadsheet.selection,
        endRow: r,
        endCol: c,
      });
      return;
    }

    // Begin new drag selection
    setDragAnchor({ row: r, col: c });
    setIsDragSelecting(true);
    onUpdateSelection({
      ...spreadsheet.selection,
      startRow: r,
      startCol: c,
      endRow: r,
      endCol: c,
      excludedRows: [],
      excludedCells: [],
    });
  };

  const handleCellPointerEnter = (r: number, c: number) => {
    if (!isDragSelecting || !dragAnchor) return;
    if (spreadsheet.selection.endRow === r && spreadsheet.selection.endCol === c) return;
    onUpdateSelection({
      ...spreadsheet.selection,
      startRow: dragAnchor.row,
      startCol: dragAnchor.col,
      endRow: r,
      endCol: c,
    });
  };

  const handleColumnHeaderClick = (e: React.MouseEvent, c: number) => {
    if (rowCount === 0) return;
    setEditingCell(null);
    if (e.shiftKey) {
      onUpdateSelection({
        ...spreadsheet.selection,
        startRow: 0,
        endRow: rowCount - 1,
        endCol: c,
      });
    } else {
      onUpdateSelection({
        ...spreadsheet.selection,
        startRow: 0,
        endRow: rowCount - 1,
        startCol: c,
        endCol: c,
        excludedRows: [],
        excludedCells: [],
      });
    }
  };

  const handleRowNumberClick = (e: React.MouseEvent, r: number) => {
    if (colCount === 0) return;
    setEditingCell(null);
    if (e.shiftKey) {
      onUpdateSelection({
        ...spreadsheet.selection,
        startCol: 0,
        endCol: colCount - 1,
        endRow: r,
      });
    } else {
      onUpdateSelection({
        ...spreadsheet.selection,
        startRow: r,
        endRow: r,
        startCol: 0,
        endCol: colCount - 1,
        excludedRows: [],
        excludedCells: [],
      });
    }
  };

  const toggleRowIncluded = (r: number) => {
    const nextExcluded = excludedRowSet.has(r)
      ? spreadsheet.selection.excludedRows.filter((idx) => idx !== r)
      : [...spreadsheet.selection.excludedRows, r];
    onUpdateSelection({
      ...spreadsheet.selection,
      excludedRows: nextExcluded,
    });
  };

  const handleSelectAll = () => {
    if (rowCount === 0 || colCount === 0) return;
    const defaultSel = createDefaultSelection(spreadsheet.rawRows);
    onUpdateSelection({
      ...defaultSel,
      mode: spreadsheet.selection.mode,
      useFirstRowAsHeader: spreadsheet.selection.useFirstRowAsHeader,
    });
  };

  const handleModeChange = (mode: CellSelectionMode) => {
    onUpdateSelection({
      ...spreadsheet.selection,
      mode,
    });
  };

  const visibleRowIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const indices: number[] = [];
    for (let r = 0; r < rowCount; r++) {
      if (!q) {
        indices.push(r);
      } else {
        const matches = spreadsheet.rawRows[r].some((val) => val.toLowerCase().includes(q));
        if (matches || isHeaderRow(r)) {
          indices.push(r);
        }
      }
    }
    return indices;
  }, [spreadsheet.rawRows, rowCount, searchQuery, bounds.minRow, bounds.maxRow, spreadsheet.selection.mode, spreadsheet.selection.useFirstRowAsHeader]);

  const hasExclusions =
    spreadsheet.selection.excludedRows.length > 0 ||
    spreadsheet.selection.excludedCells.length > 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[#F8F9FA]">
      <div className="max-w-[1260px] mx-auto px-6 py-8 space-y-5">
        {/* Page Heading & Unboxed Metadata */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[#09090B]">
              Spreadsheet Data & Cell Selection
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#71717A] tabular-nums">
              <span>{spreadsheet.fileName}</span>
              <span aria-hidden="true">·</span>
              <span>Selected range {formattedRange}</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#09090B] font-medium">
                {spreadsheet.entries.length} cards ready
              </span>
              <span aria-hidden="true">·</span>
              <span>{spreadsheet.columns.length} fields</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={downloadSampleExcel}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E4E7] rounded-md hover:bg-[#F4F4F5] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#52525B]" />
              Sample Excel
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#18181B] rounded-md hover:bg-[#27272A] transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Excel / CSV
            </button>
            <button
              type="button"
              onClick={onProceedToDesign}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#2563EB] bg-white border border-[#BFDBFE] rounded-md hover:bg-[#EFF6FF] transition-colors whitespace-nowrap shrink-0"
            >
              Continue to Design
            </button>
          </div>
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className="hidden"
        />

        {/* Drag-and-Drop Import Surface */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`bg-white border border-dashed rounded-lg px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer transition-colors duration-150 ${
            isDraggingFile
              ? 'border-[#2563EB] bg-[#EFF6FF]/60'
              : 'border-[#D4D4D8] hover:border-[#71717A]'
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div className="w-9 h-9 rounded-md bg-[#F4F4F5] flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4 text-[#18181B]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#09090B]">
                {isParsing
                  ? 'Reading workbook...'
                  : 'Drop an Excel (.xlsx, .xls) or CSV file here, or click to browse'}
              </p>
              <p className="text-xs text-[#71717A] mt-0.5">
                Drag across cells below to select the exact range used for your raffle cards. Double-click any cell to edit.
              </p>
            </div>
          </div>
          <span className="text-xs text-[#71717A] whitespace-nowrap shrink-0">
            Processed locally in browser
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] px-4 py-3 rounded-md text-xs flex items-center justify-between gap-4"
          >
            <span>Error: {errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="font-medium underline whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Interactive Worksheet & Cell Selection Panel */}
        <div className="bg-white border border-[#E4E4E7] rounded-lg overflow-hidden">
          {/* Primary Selection Controls Row */}
          <div className="px-4 py-3 border-b border-[#E4E4E7] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Range A1 Input */}
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="cell-range-input"
                  className="text-[11px] font-medium text-[#52525B] whitespace-nowrap"
                >
                  Data Range
                </label>
                <input
                  id="cell-range-input"
                  type="text"
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  onBlur={commitRangeInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  disabled={rowCount === 0}
                  className="w-24 px-2 py-1 text-xs font-mono-tabular font-medium text-[#09090B] bg-[#FAFAFA] border border-[#E4E4E7] rounded focus:outline-none focus:border-[#2563EB] focus:bg-white uppercase"
                />
              </div>

              {/* Mode Toggle: Rows as Cards vs Each Cell as Card */}
              <div className="flex items-center gap-0.5 p-0.5 bg-[#F4F4F5] rounded-md">
                <button
                  type="button"
                  onClick={() => handleModeChange('rows')}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    spreadsheet.selection.mode === 'rows'
                      ? 'bg-white text-[#09090B] shadow-xs'
                      : 'text-[#52525B] hover:text-[#09090B]'
                  }`}
                >
                  Rows as Cards
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('cells')}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    spreadsheet.selection.mode === 'cells'
                      ? 'bg-white text-[#09090B] shadow-xs'
                      : 'text-[#52525B] hover:text-[#09090B]'
                  }`}
                >
                  Each Cell as Card
                </button>
              </div>

              {/* First Row Header Checkbox */}
              {spreadsheet.selection.mode === 'rows' && (
                <label className="inline-flex items-center gap-1.5 text-xs text-[#18181B] cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={spreadsheet.selection.useFirstRowAsHeader}
                    onChange={(e) =>
                      onUpdateSelection({
                        ...spreadsheet.selection,
                        useFirstRowAsHeader: e.target.checked,
                      })
                    }
                    className="accent-[#18181B]"
                  />
                  First selected row as headers
                </label>
              )}

              <button
                type="button"
                onClick={handleSelectAll}
                disabled={rowCount === 0}
                className="text-xs font-medium text-[#2563EB] hover:underline disabled:opacity-40 whitespace-nowrap"
              >
                Select All
              </button>

              {hasExclusions && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSelection({
                      ...spreadsheet.selection,
                      excludedRows: [],
                      excludedCells: [],
                    })
                  }
                  className="text-xs text-[#52525B] hover:text-[#09090B] underline whitespace-nowrap"
                >
                  Restore skipped
                </button>
              )}
            </div>

            {/* Right Controls: Search + Sheet Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Find in sheet..."
                  aria-label="Find in sheet"
                  className="pl-8 pr-2.5 py-1 w-44 text-xs bg-[#FAFAFA] border border-[#E4E4E7] rounded-md text-[#09090B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#2563EB] focus:bg-white"
                />
              </div>

              <button
                type="button"
                onClick={onAddRow}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded-md transition-colors whitespace-nowrap"
              >
                <Plus className="w-3 h-3" />
                Row
              </button>
              <button
                type="button"
                onClick={onAddColumn}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded-md transition-colors whitespace-nowrap"
              >
                <Plus className="w-3 h-3" />
                Column
              </button>
              {rowCount > 0 && (
                <button
                  type="button"
                  onClick={onClearEntries}
                  className="px-2 py-1 text-xs text-[#71717A] hover:text-[#DC2626] rounded-md transition-colors whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Multi-sheet Tabs (when Excel file has multiple worksheets) */}
          {spreadsheet.sheetNames.length > 1 && (
            <div className="px-4 py-2 bg-[#FAFAFA] border-b border-[#E4E4E7] flex items-center gap-2 overflow-x-auto">
              <span className="text-[11px] text-[#71717A] mr-1 shrink-0">Worksheet:</span>
              <div className="flex items-center gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
                {spreadsheet.sheetNames.map((sheetName) => (
                  <button
                    key={sheetName}
                    type="button"
                    onClick={() => {
                      setEditingCell(null);
                      onSwitchSheet(sheetName);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      spreadsheet.activeSheet === sheetName
                        ? 'bg-white text-[#09090B] shadow-xs'
                        : 'text-[#52525B] hover:text-[#09090B]'
                    }`}
                  >
                    {sheetName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Spreadsheet Grid or Empty State */}
          {rowCount === 0 ? (
            <div className="py-16 px-6 text-center">
              <p className="text-sm font-medium text-[#09090B]">No spreadsheet cells loaded</p>
              <p className="text-xs text-[#71717A] mt-1 max-w-sm mx-auto">
                Import an Excel spreadsheet or restore the sample roster, then drag-select the cells you want to turn into raffle cards.
              </p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#18181B] rounded-md hover:bg-[#27272A]"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Import Excel
                </button>
                <button
                  type="button"
                  onClick={onRestoreSample}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E4E7] rounded-md hover:bg-[#F4F4F5]"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Load Sample Data
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-auto max-h-[500px] select-none">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-20 bg-[#FAFAFA]">
                  <tr>
                    {/* Corner Select-All Cell */}
                    <th className="w-20 min-w-[80px] py-2 px-2 border-b border-r border-[#E4E4E7] text-center">
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        title="Select all cells"
                        className="text-[10px] font-mono-tabular text-[#71717A] hover:text-[#09090B]"
                      >
                        ALL
                      </button>
                    </th>
                    {Array.from({ length: colCount }).map((_, c) => {
                      const colSelected = c >= bounds.minCol && c <= bounds.maxCol;
                      return (
                        <th
                          key={c}
                          onClick={(e) => handleColumnHeaderClick(e, c)}
                          title={`Click to select Column ${colIndexToLetter(c)} (Shift+click to extend)`}
                          className={`py-2 px-3 border-b border-r border-[#E4E4E7] text-[11px] font-mono-tabular font-medium text-center cursor-pointer transition-colors min-w-[130px] ${
                            colSelected
                              ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                              : 'bg-[#FAFAFA] text-[#71717A] hover:bg-[#F4F4F5]'
                          }`}
                        >
                          {colIndexToLetter(c)}
                        </th>
                      );
                    })}
                    <th className="w-10 border-b border-[#E4E4E7] bg-[#FAFAFA]" />
                  </tr>
                </thead>

                <tbody>
                  {visibleRowIndices.length === 0 ? (
                    <tr>
                      <td
                        colSpan={colCount + 2}
                        className="py-10 text-center text-xs text-[#71717A]"
                      >
                        No cells match "{searchQuery}".
                      </td>
                    </tr>
                  ) : (
                    visibleRowIndices.map((r) => {
                      const rowInRange = r >= bounds.minRow && r <= bounds.maxRow;
                      const rowIsHeader = isHeaderRow(r);
                      const rowExcluded = excludedRowSet.has(r);

                      return (
                        <tr key={r} className="group">
                          {/* Row Number + Include/Skip Toggle */}
                          <td
                            className={`py-1.5 px-2 border-b border-r border-[#E4E4E7] text-[11px] font-mono-tabular whitespace-nowrap ${
                              rowInRange && !rowExcluded
                                ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                                : 'bg-[#FAFAFA] text-[#71717A]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              {rowInRange && !rowIsHeader ? (
                                <input
                                  type="checkbox"
                                  checked={!rowExcluded}
                                  onChange={() => toggleRowIncluded(r)}
                                  title={rowExcluded ? 'Include row in cards' : 'Skip row from cards'}
                                  aria-label={`Include row ${r + 1}`}
                                  className="accent-[#2563EB] cursor-pointer"
                                />
                              ) : (
                                <span className="w-3.5 inline-block text-center text-[9px] text-[#71717A]">
                                  {rowIsHeader ? 'H' : ''}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => handleRowNumberClick(e, r)}
                                title={`Click to select Row ${r + 1} (Shift+click to extend)`}
                                className="flex-1 text-right hover:underline"
                              >
                                {r + 1}
                              </button>
                            </div>
                          </td>

                          {/* Data Cells */}
                          {spreadsheet.rawRows[r].map((cellValue, c) => {
                            const inSelection =
                              r >= bounds.minRow &&
                              r <= bounds.maxRow &&
                              c >= bounds.minCol &&
                              c <= bounds.maxCol;

                            const cellKey = `${r}:${c}`;
                            const isSkipped = rowExcluded || excludedCellSet.has(cellKey);
                            const isEditing =
                              editingCell?.row === r && editingCell?.col === c;

                            // Crisp perimeter border for the active selection rectangle
                            const borderTop =
                              inSelection && r === bounds.minRow ? 'border-t-2 border-t-[#2563EB]' : '';
                            const borderBottom =
                              inSelection && r === bounds.maxRow
                                ? 'border-b-2 border-b-[#2563EB]'
                                : 'border-b border-b-[#F1F1F4]';
                            const borderLeft =
                              inSelection && c === bounds.minCol ? 'border-l-2 border-l-[#2563EB]' : '';
                            const borderRight =
                              inSelection && c === bounds.maxCol
                                ? 'border-r-2 border-r-[#2563EB]'
                                : 'border-r border-r-[#F1F1F4]';

                            let cellSurface = 'bg-[#FAFAFA]/60 text-[#A1A1AA]';
                            if (inSelection) {
                              if (isSkipped) {
                                cellSurface = 'bg-[#FAFAFA] text-[#A1A1AA] line-through';
                              } else if (rowIsHeader) {
                                cellSurface = 'bg-[#F4F4F5] text-[#09090B] font-semibold';
                              } else {
                                cellSurface = 'bg-[#EFF6FF]/60 text-[#09090B]';
                              }
                            }

                            return (
                              <td
                                key={c}
                                onPointerDown={(e) => handleCellPointerDown(e, r, c)}
                                onPointerEnter={() => handleCellPointerEnter(r, c)}
                                onDoubleClick={() => setEditingCell({ row: r, col: c })}
                                className={`px-3 py-1.5 text-xs cursor-cell transition-colors relative ${cellSurface} ${borderTop} ${borderBottom} ${borderLeft} ${borderRight}`}
                              >
                                {isEditing ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    value={cellValue}
                                    onChange={(e) => onUpdateRawCell(r, c, e.target.value)}
                                    onBlur={() => setEditingCell(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === 'Escape') {
                                        setEditingCell(null);
                                      }
                                    }}
                                    className="w-full px-1.5 py-0.5 text-xs text-[#09090B] bg-white border border-[#2563EB] rounded-xs focus:outline-none select-text"
                                  />
                                ) : (
                                  <div className="min-h-[18px] truncate max-w-[260px]">
                                    {cellValue || <span className="text-[#D4D4D8]">—</span>}
                                  </div>
                                )}
                              </td>
                            );
                          })}

                          {/* Delete Row */}
                          <td className="px-2 py-1 border-b border-[#F1F1F4] text-right bg-white">
                            <button
                              type="button"
                              onClick={() => onDeleteRow(r)}
                              title={`Delete row ${r + 1}`}
                              aria-label={`Delete row ${r + 1}`}
                              className="p-1 text-[#A1A1AA] hover:text-[#DC2626] opacity-40 group-hover:opacity-100 transition-opacity rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Selection Footer Summary */}
          {rowCount > 0 && (
            <div className="px-4 py-2.5 bg-[#FAFAFA] border-t border-[#E4E4E7] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#52525B]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#09090B]">Active Card Fields:</span>
                <span>
                  {spreadsheet.columns.length > 0
                    ? spreadsheet.columns.join(' · ')
                    : 'No fields selected'}
                </span>
              </div>
              <span className="text-[#71717A]">
                Drag to select range · Shift+click to extend · Ctrl/Cmd+click cell to exclude · Double-click to edit
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
