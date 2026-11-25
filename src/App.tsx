import { useCallback, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import {
  CardDesign,
  CellSelectionConfig,
  PrintSheetConfig,
  SpreadsheetData,
  WorkspaceTab,
} from './types';
import {
  createInitialCardDesign,
  createInitialPrintSheetConfig,
  createInitialSpreadsheet,
} from './utils/sampleData';
import { createDefaultSelection, deriveDataFromSelection } from './utils/excel';
import { ExportProgress, exportRaffleSheetsToPdf } from './utils/pdfExport';
import { TopBar } from './components/TopBar';
import { DataView } from './components/DataView';
import { DesignView } from './components/DesignView';
import { PrintSheetView } from './components/PrintSheetView';

function remapDesignToNewColumns(prev: CardDesign, newColumns: string[]): CardDesign {
  if (newColumns.length === 0) return prev;

  const pickBestColumn = (hint: string, fallbackIndex: number): string => {
    const lowerHint = hint.toLowerCase();
    const exact = newColumns.find((c) => c.toLowerCase() === lowerHint);
    if (exact) return exact;

    if (
      lowerHint.includes('ticket') ||
      lowerHint.includes('number') ||
      lowerHint.includes('no') ||
      lowerHint.includes('id') ||
      lowerHint.includes('ref')
    ) {
      const numCol = newColumns.find((c) => /ticket|num|no\b|code|id|ref/i.test(c));
      if (numCol) return numCol;
    }
    if (
      lowerHint.includes('name') ||
      lowerHint.includes('participant') ||
      lowerHint.includes('guest') ||
      lowerHint.includes('value')
    ) {
      const nameCol = newColumns.find((c) =>
        /name|participant|member|guest|entrant|person|value/i.test(c)
      );
      if (nameCol) return nameCol;
    }

    return newColumns[fallbackIndex % newColumns.length] ?? newColumns[0];
  };

  let fallbackCursor = 0;
  const remappedBlocks = prev.contentBlocks.map((block) => {
    if (block.mode === 'column') {
      if (block.columnKey === '__ROW_NUMBER__' || newColumns.includes(block.columnKey)) {
        return block;
      }
      const nextCol = pickBestColumn(`${block.label} ${block.columnKey}`, fallbackCursor++);
      return { ...block, columnKey: nextCol };
    }

    if (block.mode === 'template') {
      const matches = Array.from(block.text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g));
      const referencesValid =
        matches.length === 0 ||
        matches.some((m) => m[1] === 'RowNumber' || newColumns.includes(m[1]));
      if (referencesValid) return block;

      const secondaryCols = newColumns.length > 1 ? newColumns.slice(1, 3) : newColumns.slice(0, 1);
      const nextText = secondaryCols.map((c) => `{{${c}}}`).join(' · ');
      return { ...block, text: nextText };
    }

    return block;
  });

  return {
    ...prev,
    contentBlocks: remappedBlocks,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('design');
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetData>(() =>
    createInitialSpreadsheet()
  );
  const [design, setDesign] = useState<CardDesign>(() => createInitialCardDesign());
  const [sheetConfig, setSheetConfig] = useState<PrintSheetConfig>(() =>
    createInitialPrintSheetConfig()
  );
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const applyDerivedUpdate = useCallback(
    (
      prev: SpreadsheetData,
      nextRawRows: string[][],
      nextSelection: CellSelectionConfig
    ): SpreadsheetData => {
      const { columns, entries } = deriveDataFromSelection(nextRawRows, nextSelection);
      const columnsChanged =
        columns.length !== prev.columns.length ||
        columns.some((col, idx) => col !== prev.columns[idx]);

      if (columnsChanged && columns.length > 0) {
        setDesign((d) => remapDesignToNewColumns(d, columns));
      }

      setActiveEntryIndex((idx) =>
        entries.length > 0 ? Math.min(idx, entries.length - 1) : 0
      );

      setSheetConfig((sc) => ({
        ...sc,
        rangeStart: Math.min(sc.rangeStart, Math.max(1, entries.length)),
        rangeEnd: sc.rangeMode === 'all' ? Math.max(1, entries.length) : Math.min(sc.rangeEnd, Math.max(1, entries.length)),
      }));

      return {
        ...prev,
        rawRows: nextRawRows,
        selection: nextSelection,
        columns,
        entries,
        workbookSheets: {
          ...prev.workbookSheets,
          [prev.activeSheet]: {
            rawRows: nextRawRows,
            selection: nextSelection,
            columns,
            entries,
          },
        },
      };
    },
    []
  );

  const handleImportSpreadsheet = useCallback((nextData: SpreadsheetData) => {
    setSpreadsheet(nextData);
    setActiveEntryIndex(0);
    setSheetConfig((prev) => ({
      ...prev,
      rangeStart: 1,
      rangeEnd: Math.max(1, nextData.entries.length),
    }));
    setDesign((prev) => remapDesignToNewColumns(prev, nextData.columns));
    setNotice({
      type: 'success',
      message: `Imported ${nextData.entries.length} entries from ${nextData.fileName}. You can adjust the selected cells anytime in Data.`,
    });
  }, []);

  const handleSwitchSheet = useCallback((sheetName: string) => {
    setSpreadsheet((prev) => {
      const sheet = prev.workbookSheets[sheetName];
      if (!sheet) return prev;
      setDesign((d) => remapDesignToNewColumns(d, sheet.columns));
      setSheetConfig((sc) => ({
        ...sc,
        rangeStart: 1,
        rangeEnd: Math.max(1, sheet.entries.length),
      }));
      setActiveEntryIndex(0);
      return {
        ...prev,
        activeSheet: sheetName,
        rawRows: sheet.rawRows,
        selection: sheet.selection,
        columns: sheet.columns,
        entries: sheet.entries,
      };
    });
  }, []);

  const handleUpdateSelection = useCallback(
    (nextSelection: CellSelectionConfig) => {
      setSpreadsheet((prev) => applyDerivedUpdate(prev, prev.rawRows, nextSelection));
    },
    [applyDerivedUpdate]
  );

  const handleUpdateRawCell = useCallback(
    (rowIndex: number, colIndex: number, value: string) => {
      setSpreadsheet((prev) => {
        const nextRawRows = prev.rawRows.map((row, r) =>
          r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row
        );
        return applyDerivedUpdate(prev, nextRawRows, prev.selection);
      });
    },
    [applyDerivedUpdate]
  );

  const handleAddRow = useCallback(() => {
    setSpreadsheet((prev) => {
      const colCount = Math.max(1, prev.rawRows[0]?.length ?? prev.columns.length ?? 4);
      const newRow = Array.from({ length: colCount }, (_, idx) => {
        if (idx === 0 && prev.rawRows.length > 0 && /ticket|num|no|id/i.test(prev.rawRows[0][0] ?? '')) {
          return `RF-${String(prev.rawRows.length).padStart(4, '0')}`;
        }
        return '';
      });
      const nextRawRows = [...prev.rawRows, newRow];
      const nextSelection: CellSelectionConfig =
        prev.rawRows.length === 0
          ? createDefaultSelection(nextRawRows)
          : {
              ...prev.selection,
              endRow:
                Math.max(prev.selection.startRow, prev.selection.endRow) === prev.rawRows.length - 1
                  ? nextRawRows.length - 1
                  : prev.selection.endRow,
            };
      return applyDerivedUpdate(prev, nextRawRows, nextSelection);
    });
  }, [applyDerivedUpdate]);

  const handleAddColumn = useCallback(() => {
    setSpreadsheet((prev) => {
      if (prev.rawRows.length === 0) {
        const nextRawRows = [['Column A'], ['']];
        return applyDerivedUpdate(prev, nextRawRows, createDefaultSelection(nextRawRows));
      }
      const nextColIdx = prev.rawRows[0].length;
      const nextRawRows = prev.rawRows.map((row, r) => [
        ...row,
        r === 0 ? `Field ${nextColIdx + 1}` : '',
      ]);
      const nextSelection: CellSelectionConfig = {
        ...prev.selection,
        endCol:
          Math.max(prev.selection.startCol, prev.selection.endCol) === nextColIdx - 1
            ? nextColIdx
            : prev.selection.endCol,
      };
      return applyDerivedUpdate(prev, nextRawRows, nextSelection);
    });
  }, [applyDerivedUpdate]);

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      setSpreadsheet((prev) => {
        const nextRawRows = prev.rawRows.filter((_, r) => r !== rowIndex);
        if (nextRawRows.length === 0) {
          return applyDerivedUpdate(prev, [], createDefaultSelection([]));
        }
        const maxRow = nextRawRows.length - 1;
        const nextSelection: CellSelectionConfig = {
          ...prev.selection,
          startRow: Math.min(prev.selection.startRow, maxRow),
          endRow: Math.min(prev.selection.endRow, maxRow),
          excludedRows: prev.selection.excludedRows
            .filter((r) => r !== rowIndex)
            .map((r) => (r > rowIndex ? r - 1 : r)),
          excludedCells: [],
        };
        return applyDerivedUpdate(prev, nextRawRows, nextSelection);
      });
    },
    [applyDerivedUpdate]
  );

  const handleClearEntries = useCallback(() => {
    setSpreadsheet((prev) => applyDerivedUpdate(prev, [], createDefaultSelection([])));
  }, [applyDerivedUpdate]);

  const handleRestoreSample = useCallback(() => {
    const sample = createInitialSpreadsheet();
    setSpreadsheet(sample);
    setDesign(createInitialCardDesign());
    setSheetConfig(createInitialPrintSheetConfig());
    setActiveEntryIndex(0);
  }, []);

  const handleExportPdf = useCallback(async () => {
    setNotice(null);
    setIsExporting(true);
    setExportProgress({ completed: 0, total: spreadsheet.entries.length, stage: 'preparing' });

    try {
      await exportRaffleSheetsToPdf(
        design,
        spreadsheet.entries,
        sheetConfig,
        spreadsheet.fileName,
        (progress) => setExportProgress(progress)
      );
      setNotice({
        type: 'success',
        message: 'Print-ready PDF exported with multi-card sheets and crop marks.',
      });
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'PDF export failed.',
      });
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }, [design, spreadsheet.entries, spreadsheet.fileName, sheetConfig]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#F8F9FA] text-[#09090B]">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onExportPdf={() => void handleExportPdf()}
        isExporting={isExporting}
        exportProgress={exportProgress}
        canExport={spreadsheet.entries.length > 0}
      />

      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={`shrink-0 px-6 py-2 text-xs border-b flex items-center justify-between gap-4 ${
            notice.type === 'error'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
              : 'bg-white border-[#E4E4E7] text-[#09090B]'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' && (
              <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="p-0.5 text-[#71717A] hover:text-[#09090B]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {activeTab === 'data' && (
        <DataView
          spreadsheet={spreadsheet}
          onImportSpreadsheet={handleImportSpreadsheet}
          onSwitchSheet={handleSwitchSheet}
          onUpdateSelection={handleUpdateSelection}
          onUpdateRawCell={handleUpdateRawCell}
          onAddRow={handleAddRow}
          onAddColumn={handleAddColumn}
          onDeleteRow={handleDeleteRow}
          onClearEntries={handleClearEntries}
          onRestoreSample={handleRestoreSample}
          onProceedToDesign={() => setActiveTab('design')}
        />
      )}

      {activeTab === 'design' && (
        <DesignView
          design={design}
          entries={spreadsheet.entries}
          columns={spreadsheet.columns}
          sheetConfig={sheetConfig}
          activeEntryIndex={activeEntryIndex}
          onChangeActiveEntryIndex={setActiveEntryIndex}
          onUpdateDesign={setDesign}
          onResetDesign={() => setDesign(createInitialCardDesign())}
        />
      )}

      {activeTab === 'sheet' && (
        <PrintSheetView
          design={design}
          entries={spreadsheet.entries}
          sheetConfig={sheetConfig}
          onUpdateSheetConfig={(patch) =>
            setSheetConfig((prev) => ({ ...prev, ...patch }))
          }
          onExportPdf={() => void handleExportPdf()}
          isExporting={isExporting}
          exportProgress={exportProgress}
        />
      )}
    </div>
  );
}
