import * as XLSX from 'xlsx';
import {
  CellSelectionConfig,
  EntryRow,
  ParsedSheet,
  SpreadsheetData,
} from '../types';
import { SAMPLE_COLUMNS, SAMPLE_ENTRIES } from './sampleData';

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

export function colIndexToLetter(index: number): string {
  let n = index;
  let result = '';
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result || 'A';
}

export function letterToColIndex(letters: string): number {
  const clean = letters.trim().toUpperCase();
  let col = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    col = col * 26 + (code - 64);
  }
  return col - 1;
}

export function formatCellRef(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`;
}

export function getNormalizedBounds(sel: CellSelectionConfig): {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
} {
  return {
    minRow: Math.min(sel.startRow, sel.endRow),
    maxRow: Math.max(sel.startRow, sel.endRow),
    minCol: Math.min(sel.startCol, sel.endCol),
    maxCol: Math.max(sel.startCol, sel.endCol),
  };
}

export function formatRangeA1(sel: CellSelectionConfig): string {
  const { minRow, maxRow, minCol, maxCol } = getNormalizedBounds(sel);
  const start = formatCellRef(minRow, minCol);
  const end = formatCellRef(maxRow, maxCol);
  return start === end ? start : `${start}:${end}`;
}

export function parseRangeA1(
  input: string,
  maxRows: number,
  maxCols: number
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  if (maxRows <= 0 || maxCols <= 0) return null;
  const trimmed = input.trim().toUpperCase();
  const match = trimmed.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!match) return null;

  const c1 = letterToColIndex(match[1]);
  const r1 = parseInt(match[2], 10) - 1;
  const c2 = match[3] ? letterToColIndex(match[3]) : c1;
  const r2 = match[4] ? parseInt(match[4], 10) - 1 : r1;

  if (c1 < 0 || r1 < 0 || c2 < 0 || r2 < 0) return null;

  return {
    startRow: Math.max(0, Math.min(maxRows - 1, r1)),
    startCol: Math.max(0, Math.min(maxCols - 1, c1)),
    endRow: Math.max(0, Math.min(maxRows - 1, r2)),
    endCol: Math.max(0, Math.min(maxCols - 1, c2)),
  };
}

export function createDefaultSelection(rawRows: string[][]): CellSelectionConfig {
  const rowCount = rawRows.length;
  const colCount = rawRows[0]?.length ?? 0;
  return {
    startRow: 0,
    startCol: 0,
    endRow: Math.max(0, rowCount - 1),
    endCol: Math.max(0, colCount - 1),
    useFirstRowAsHeader: rowCount > 1,
    mode: 'rows',
    excludedRows: [],
    excludedCells: [],
  };
}

export function deriveDataFromSelection(
  rawRows: string[][],
  selection: CellSelectionConfig
): { columns: string[]; entries: EntryRow[] } {
  if (rawRows.length === 0 || (rawRows[0]?.length ?? 0) === 0) {
    return { columns: [], entries: [] };
  }

  const maxAvailableRow = rawRows.length - 1;
  const maxAvailableCol = Math.max(0, (rawRows[0]?.length ?? 1) - 1);
  const bounds = getNormalizedBounds(selection);

  const minRow = Math.max(0, Math.min(maxAvailableRow, bounds.minRow));
  const maxRow = Math.max(0, Math.min(maxAvailableRow, bounds.maxRow));
  const minCol = Math.max(0, Math.min(maxAvailableCol, bounds.minCol));
  const maxCol = Math.max(0, Math.min(maxAvailableCol, bounds.maxCol));

  const excludedRowSet = new Set(selection.excludedRows);
  const excludedCellSet = new Set(selection.excludedCells);

  if (selection.mode === 'cells') {
    const columns = ['Cell Value', 'Cell Ref'];
    const entries: EntryRow[] = [];
    for (let r = minRow; r <= maxRow; r++) {
      if (excludedRowSet.has(r)) continue;
      for (let c = minCol; c <= maxCol; c++) {
        if (excludedCellSet.has(`${r}:${c}`)) continue;
        const val = normalizeCellValue(rawRows[r]?.[c]);
        if (val !== '') {
          entries.push({
            'Cell Value': val,
            'Cell Ref': formatCellRef(r, c),
          });
        }
      }
    }
    return { columns, entries };
  }

  // Rows mode: each selected row is one raffle card, selected columns are card fields
  const useHeader = selection.useFirstRowAsHeader && maxRow > minRow;
  const seenHeaders = new Map<string, number>();
  const columns: string[] = [];

  for (let c = minCol; c <= maxCol; c++) {
    const rawHeader = useHeader ? normalizeCellValue(rawRows[minRow]?.[c]) : '';
    const base = rawHeader || `Column ${colIndexToLetter(c)}`;
    const count = seenHeaders.get(base) ?? 0;
    seenHeaders.set(base, count + 1);
    columns.push(count === 0 ? base : `${base} (${count + 1})`);
  }

  const dataStartRow = useHeader ? minRow + 1 : minRow;
  const entries: EntryRow[] = [];

  for (let r = dataStartRow; r <= maxRow; r++) {
    if (excludedRowSet.has(r)) continue;
    const entry: EntryRow = {};
    let hasAnyValue = false;

    for (let c = minCol; c <= maxCol; c++) {
      const colName = columns[c - minCol];
      const isExcludedCell = excludedCellSet.has(`${r}:${c}`);
      const val = isExcludedCell ? '' : normalizeCellValue(rawRows[r]?.[c]);
      if (val !== '') hasAnyValue = true;
      entry[colName] = val;
    }

    if (hasAnyValue) {
      entries.push(entry);
    }
  }

  return { columns, entries };
}

function parseWorksheet(sheet: XLSX.WorkSheet): ParsedSheet {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
  });

  if (rows.length === 0) {
    const emptySelection = createDefaultSelection([]);
    return { rawRows: [], selection: emptySelection, columns: [], entries: [] };
  }

  // Trim completely empty trailing rows while preserving top/middle row indices cleanly
  let lastNonEmptyRow = -1;
  let maxCols = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (normalizeCellValue(row[c]) !== '') {
        lastNonEmptyRow = r;
        if (c + 1 > maxCols) maxCols = c + 1;
      }
    }
  }

  if (lastNonEmptyRow === -1 || maxCols === 0) {
    const emptySelection = createDefaultSelection([]);
    return { rawRows: [], selection: emptySelection, columns: [], entries: [] };
  }

  const rawRows: string[][] = [];
  for (let r = 0; r <= lastNonEmptyRow; r++) {
    const srcRow = rows[r] ?? [];
    const normalizedRow: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      normalizedRow.push(normalizeCellValue(srcRow[c]));
    }
    rawRows.push(normalizedRow);
  }

  // Detect first non-empty row/col for a smart initial selection
  let firstDataRow = 0;
  for (let r = 0; r < rawRows.length; r++) {
    if (rawRows[r].some((cell) => cell !== '')) {
      firstDataRow = r;
      break;
    }
  }

  const selection: CellSelectionConfig = {
    startRow: firstDataRow,
    startCol: 0,
    endRow: rawRows.length - 1,
    endCol: maxCols - 1,
    useFirstRowAsHeader: rawRows.length - firstDataRow > 1,
    mode: 'rows',
    excludedRows: [],
    excludedCells: [],
  };

  const { columns, entries } = deriveDataFromSelection(rawRows, selection);
  return { rawRows, selection, columns, entries };
}

export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  if (!workbook.SheetNames.length) {
    throw new Error('This file does not contain any readable worksheets.');
  }

  const workbookSheets: Record<string, ParsedSheet> = {};
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet) {
      workbookSheets[name] = parseWorksheet(sheet);
    }
  }

  const firstPopulatedSheet =
    workbook.SheetNames.find((name) => (workbookSheets[name]?.rawRows.length ?? 0) > 0) ??
    workbook.SheetNames[0];

  const activeData = workbookSheets[firstPopulatedSheet] ?? {
    rawRows: [],
    selection: createDefaultSelection([]),
    columns: [],
    entries: [],
  };

  if (activeData.rawRows.length === 0) {
    throw new Error('No readable cells were detected in this spreadsheet.');
  }

  return {
    fileName: file.name,
    sheetNames: workbook.SheetNames,
    activeSheet: firstPopulatedSheet,
    rawRows: activeData.rawRows,
    selection: activeData.selection,
    columns: activeData.columns,
    entries: activeData.entries,
    workbookSheets,
  };
}

export function downloadSampleExcel(): void {
  const worksheet = XLSX.utils.json_to_sheet(SAMPLE_ENTRIES, {
    header: SAMPLE_COLUMNS,
  });
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 20 },
    { wch: 16 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Participants');
  XLSX.writeFile(workbook, 'foliopress-raffle-sample.xlsx');
}
