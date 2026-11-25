import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import {
  CardDesign,
  CellSelectionConfig,
  DesignUpdateOptions,
  FolioPressProjectFile,
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
import {
  buildProjectFile,
  LocalFileHandle,
  saveProjectToDisk,
} from './utils/projectFile';
import {
  clearAutoSaveDraft,
  loadAutoSaveDraft,
  loadAutoSavePreference,
  saveAutoSaveDraft,
  saveAutoSavePreference,
} from './utils/autoSave';
import { TopBar } from './components/TopBar';
import { DataView } from './components/DataView';
import { DesignView } from './components/DesignView';
import { PrintSheetView } from './components/PrintSheetView';
import { ProjectsDrawer } from './components/ProjectsDrawer';

const DEFAULT_PROJECT_NAME = 'Annual Charity Raffle';
const MAX_HISTORY_STEPS = 60;
const COALESCE_WINDOW_MS = 500;

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
  const [projectName, setProjectName] = useState<string>(DEFAULT_PROJECT_NAME);
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetData>(() =>
    createInitialSpreadsheet()
  );
  const [design, setDesign] = useState<CardDesign>(() => createInitialCardDesign());
  const [sheetConfig, setSheetConfig] = useState<PrintSheetConfig>(() =>
    createInitialPrintSheetConfig()
  );
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);

  // Undo / Redo history stack for CardDesign
  const [history, setHistory] = useState<{ past: CardDesign[]; future: CardDesign[] }>({
    past: [],
    future: [],
  });
  const designRef = useRef<CardDesign>(design);
  designRef.current = design;
  const transactionBaseRef = useRef<CardDesign | null>(null);
  const lastCoalesceRef = useRef<{ key: string; at: number } | null>(null);

  const resetHistory = useCallback(() => {
    setHistory({ past: [], future: [] });
    transactionBaseRef.current = null;
    lastCoalesceRef.current = null;
  }, []);

  const updateDesignWithHistory = useCallback(
    (updater: (prev: CardDesign) => CardDesign, options?: DesignUpdateOptions) => {
      const prevDesign = designRef.current;
      const nextDesign = updater(prevDesign);
      if (nextDesign === prevDesign) return;

      if (!options?.skipHistory) {
        const now = Date.now();
        const key = options?.coalesceKey;
        const shouldCoalesce =
          Boolean(key) &&
          lastCoalesceRef.current !== null &&
          lastCoalesceRef.current.key === key &&
          now - lastCoalesceRef.current.at < COALESCE_WINDOW_MS;

        if (!shouldCoalesce) {
          setHistory((h) => ({
            past: [...h.past.slice(-(MAX_HISTORY_STEPS - 1)), prevDesign],
            future: [],
          }));
        } else {
          setHistory((h) => (h.future.length > 0 ? { ...h, future: [] } : h));
        }

        lastCoalesceRef.current = key ? { key, at: now } : null;
      }

      designRef.current = nextDesign;
      setDesign(nextDesign);
    },
    []
  );

  const handleBeginDesignTransaction = useCallback(() => {
    transactionBaseRef.current = designRef.current;
    lastCoalesceRef.current = null;
  }, []);

  const handleEndDesignTransaction = useCallback((didChange: boolean) => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (didChange && base && base !== designRef.current) {
      setHistory((h) => ({
        past: [...h.past.slice(-(MAX_HISTORY_STEPS - 1)), base],
        future: [],
      }));
    }
  }, []);

  const handleUndoDesign = useCallback(() => {
    lastCoalesceRef.current = null;
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      const current = designRef.current;
      designRef.current = previous;
      setDesign(previous);
      return {
        past: h.past.slice(0, -1),
        future: [current, ...h.future.slice(0, MAX_HISTORY_STEPS - 1)],
      };
    });
  }, []);

  const handleRedoDesign = useCallback(() => {
    lastCoalesceRef.current = null;
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      const current = designRef.current;
      designRef.current = next;
      setDesign(next);
      return {
        past: [...h.past.slice(-(MAX_HISTORY_STEPS - 1)), current],
        future: h.future.slice(1),
      };
    });
  }, []);

  // Local project file system & auto-save state
  const [isProjectsDrawerOpen, setIsProjectsDrawerOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [activeFileHandle, setActiveFileHandle] = useState<LocalFileHandle | null>(null);
  const [linkedFileName, setLinkedFileName] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() =>
    loadAutoSavePreference()
  );
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const hydratedRef = useRef(false);
  const suppressNextDirtyRef = useRef(false);
  const lastSavedAtRef = useRef<string | null>(null);
  lastSavedAtRef.current = lastSavedAt;

  // Hydrate working session draft from IndexedDB on initial mount
  useEffect(() => {
    let active = true;
    void loadAutoSaveDraft().then((draft) => {
      if (!active) return;
      if (draft && draft.spreadsheet && draft.design && draft.sheetConfig) {
        suppressNextDirtyRef.current = true;
        setProjectName(draft.projectName || DEFAULT_PROJECT_NAME);
        setSpreadsheet(draft.spreadsheet);
        designRef.current = draft.design;
        setDesign(draft.design);
        setSheetConfig(draft.sheetConfig);
        setHasUnsavedChanges(Boolean(draft.hasUnsavedChanges));
        setLastSavedAt(draft.lastExplicitSaveAt ?? null);
        setLastAutoSavedAt(draft.updatedAt ?? null);
        setActiveEntryIndex(0);
        resetHistory();
      } else {
        suppressNextDirtyRef.current = false;
      }
      hydratedRef.current = true;
    });
    return () => {
      active = false;
    };
  }, [resetHistory]);

  // Track edits and debounce auto-save to IndexedDB
  useEffect(() => {
    if (!hydratedRef.current) return;

    if (suppressNextDirtyRef.current) {
      suppressNextDirtyRef.current = false;
      return;
    }

    setHasUnsavedChanges(true);

    if (!autoSaveEnabled) return;

    const timer = window.setTimeout(() => {
      const updatedAt = new Date().toISOString();
      void saveAutoSaveDraft({
        projectName,
        updatedAt,
        lastExplicitSaveAt: lastSavedAtRef.current,
        hasUnsavedChanges: true,
        spreadsheet,
        design,
        sheetConfig,
      }).then(() => {
        setLastAutoSavedAt(updatedAt);
      });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [projectName, spreadsheet, design, sheetConfig, autoSaveEnabled]);

  // Warn before unloading tab only when auto-save is off and edits are unsaved
  useEffect(() => {
    if (!hasUnsavedChanges || autoSaveEnabled) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, autoSaveEnabled]);

  const handleSaveProject = useCallback(
    async (overrideName?: string, forceSaveAs = false): Promise<boolean> => {
      const targetName = (overrideName ?? projectName).trim() || 'Untitled Raffle Project';
      const projectFile = buildProjectFile(targetName, spreadsheet, design, sheetConfig);
      const result = await saveProjectToDisk(projectFile, activeFileHandle, forceSaveAs);

      if (result.cancelled) {
        return false;
      }

      const savedIso = projectFile.savedAt;
      suppressNextDirtyRef.current = true;
      setProjectName(targetName);
      setActiveFileHandle(result.handle);
      setLinkedFileName(result.fileName);
      setLastSavedAt(savedIso);
      setHasUnsavedChanges(false);

      if (autoSaveEnabled) {
        void saveAutoSaveDraft({
          projectName: targetName,
          updatedAt: savedIso,
          lastExplicitSaveAt: savedIso,
          hasUnsavedChanges: false,
          spreadsheet,
          design,
          sheetConfig,
        }).then(() => setLastAutoSavedAt(savedIso));
      }

      setNotice({
        type: 'success',
        message:
          result.method === 'handle'
            ? `Saved edits directly to ${result.fileName}.`
            : `Saved ${result.fileName} to your downloads folder.`,
      });
      return true;
    },
    [projectName, spreadsheet, design, sheetConfig, activeFileHandle, autoSaveEnabled]
  );

  // Global keyboard shortcuts: Ctrl/Cmd + S (Save) and Ctrl/Cmd + O (Open Projects Drawer)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void handleSaveProject(undefined, e.shiftKey);
      } else if (key === 'o') {
        e.preventDefault();
        setIsProjectsDrawerOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveProject]);

  const handleApplyOpenedProject = useCallback(
    (project: FolioPressProjectFile, handle: LocalFileHandle | null, fileName: string) => {
      suppressNextDirtyRef.current = true;
      setProjectName(project.projectName);
      setSpreadsheet(project.spreadsheet);
      designRef.current = project.design;
      setDesign(project.design);
      setSheetConfig(project.sheetConfig);
      setActiveEntryIndex(0);
      setActiveFileHandle(handle);
      setLinkedFileName(fileName);
      setLastSavedAt(project.savedAt);
      setHasUnsavedChanges(false);
      resetHistory();

      if (autoSaveEnabled) {
        const now = new Date().toISOString();
        void saveAutoSaveDraft({
          projectName: project.projectName,
          updatedAt: now,
          lastExplicitSaveAt: project.savedAt,
          hasUnsavedChanges: false,
          spreadsheet: project.spreadsheet,
          design: project.design,
          sheetConfig: project.sheetConfig,
        }).then(() => setLastAutoSavedAt(now));
      }

      setNotice({
        type: 'success',
        message: `Opened "${project.projectName}" (${project.spreadsheet.entries.length} cards).`,
      });
    },
    [autoSaveEnabled, resetHistory]
  );

  const handleCreateNewProject = useCallback(() => {
    const initialDesign = createInitialCardDesign();
    suppressNextDirtyRef.current = true;
    setProjectName(DEFAULT_PROJECT_NAME);
    setSpreadsheet(createInitialSpreadsheet());
    designRef.current = initialDesign;
    setDesign(initialDesign);
    setSheetConfig(createInitialPrintSheetConfig());
    setActiveEntryIndex(0);
    setActiveFileHandle(null);
    setLinkedFileName(null);
    setLastSavedAt(null);
    setHasUnsavedChanges(false);
    setLastAutoSavedAt(null);
    resetHistory();
    void clearAutoSaveDraft();
    setNotice({
      type: 'success',
      message: 'Started a fresh starter project.',
    });
  }, [resetHistory]);

  const handleToggleAutoSave = useCallback(
    (enabled: boolean) => {
      setAutoSaveEnabled(enabled);
      saveAutoSavePreference(enabled);
      if (enabled) {
        const now = new Date().toISOString();
        void saveAutoSaveDraft({
          projectName,
          updatedAt: now,
          lastExplicitSaveAt: lastSavedAt,
          hasUnsavedChanges,
          spreadsheet,
          design,
          sheetConfig,
        }).then(() => setLastAutoSavedAt(now));
      }
    },
    [projectName, lastSavedAt, hasUnsavedChanges, spreadsheet, design, sheetConfig]
  );

  const handleClearAutoSaveDraft = useCallback(() => {
    void clearAutoSaveDraft().then(() => {
      setLastAutoSavedAt(null);
      setNotice({
        type: 'success',
        message: 'Cleared browser recovery draft.',
      });
    });
  }, []);

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
        updateDesignWithHistory((d) => remapDesignToNewColumns(d, columns));
      }

      setActiveEntryIndex((idx) =>
        entries.length > 0 ? Math.min(idx, entries.length - 1) : 0
      );

      setSheetConfig((sc) => ({
        ...sc,
        rangeStart: Math.min(sc.rangeStart, Math.max(1, entries.length)),
        rangeEnd:
          sc.rangeMode === 'all'
            ? Math.max(1, entries.length)
            : Math.min(sc.rangeEnd, Math.max(1, entries.length)),
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
    [updateDesignWithHistory]
  );

  const handleImportSpreadsheet = useCallback(
    (nextData: SpreadsheetData) => {
      setSpreadsheet(nextData);
      setActiveEntryIndex(0);
      setSheetConfig((prev) => ({
        ...prev,
        rangeStart: 1,
        rangeEnd: Math.max(1, nextData.entries.length),
      }));
      updateDesignWithHistory((prev) => remapDesignToNewColumns(prev, nextData.columns));
      setNotice({
        type: 'success',
        message: `Imported ${nextData.entries.length} entries from ${nextData.fileName}. You can adjust the selected cells anytime in Data.`,
      });
    },
    [updateDesignWithHistory]
  );

  const handleSwitchSheet = useCallback(
    (sheetName: string) => {
      setSpreadsheet((prev) => {
        const sheet = prev.workbookSheets[sheetName];
        if (!sheet) return prev;
        updateDesignWithHistory((d) => remapDesignToNewColumns(d, sheet.columns));
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
    },
    [updateDesignWithHistory]
  );

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
        if (
          idx === 0 &&
          prev.rawRows.length > 0 &&
          /ticket|num|no|id/i.test(prev.rawRows[0][0] ?? '')
        ) {
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
    updateDesignWithHistory(() => createInitialCardDesign());
    setSheetConfig(createInitialPrintSheetConfig());
    setActiveEntryIndex(0);
  }, [updateDesignWithHistory]);

  const handleExportPdf = useCallback(async () => {
    setNotice(null);
    setIsExporting(true);
    setExportProgress({ completed: 0, total: spreadsheet.entries.length, stage: 'preparing' });

    try {
      await exportRaffleSheetsToPdf(
        design,
        spreadsheet.entries,
        sheetConfig,
        projectName || spreadsheet.fileName,
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
  }, [design, spreadsheet.entries, spreadsheet.fileName, projectName, sheetConfig]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#F8F9FA] text-[#09090B]">
      <TopBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setIsProjectsDrawerOpen(false);
          setActiveTab(tab);
        }}
        onOpenProjectsDrawer={() => setIsProjectsDrawerOpen(true)}
        isProjectsDrawerOpen={isProjectsDrawerOpen}
        hasUnsavedChanges={hasUnsavedChanges}
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
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={handleUndoDesign}
          onRedo={handleRedoDesign}
          onBeginDesignTransaction={handleBeginDesignTransaction}
          onEndDesignTransaction={handleEndDesignTransaction}
          onChangeActiveEntryIndex={setActiveEntryIndex}
          onUpdateDesign={updateDesignWithHistory}
          onResetDesign={() => updateDesignWithHistory(() => createInitialCardDesign())}
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

      <ProjectsDrawer
        isOpen={isProjectsDrawerOpen}
        onClose={() => setIsProjectsDrawerOpen(false)}
        projectName={projectName}
        onChangeProjectName={setProjectName}
        spreadsheet={spreadsheet}
        design={design}
        sheetConfig={sheetConfig}
        hasUnsavedChanges={hasUnsavedChanges}
        lastSavedAt={lastSavedAt}
        linkedFileName={linkedFileName}
        autoSaveEnabled={autoSaveEnabled}
        lastAutoSavedAt={lastAutoSavedAt}
        onToggleAutoSave={handleToggleAutoSave}
        onClearAutoSaveDraft={handleClearAutoSaveDraft}
        onSaveProject={handleSaveProject}
        onApplyOpenedProject={handleApplyOpenedProject}
        onCreateNewProject={handleCreateNewProject}
      />
    </div>
  );
}
