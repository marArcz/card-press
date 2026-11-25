import {
  CardDesign,
  FolioPressProjectFile,
  PrintSheetConfig,
  SpreadsheetData,
} from '../types';
import { createDefaultSelection, deriveDataFromSelection } from './excel';
import {
  createInitialCardDesign,
  createInitialPrintSheetConfig,
  createInitialSpreadsheet,
} from './sampleData';

export const PROJECT_FILE_EXTENSION = '.foliopress';

export interface FileSystemWritable {
  write: (data: Blob | string) => Promise<void>;
  close: () => Promise<void>;
}

export interface LocalFileHandle {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritable>;
}

interface PickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<LocalFileHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<LocalFileHandle[]>;
}

export function sanitizeProjectFileName(projectName: string): string {
  const cleaned = projectName
    .trim()
    .replace(/\.foliopress$/i, '')
    .replace(/[^a-zA-Z0-9-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${cleaned || 'raffle-project'}${PROJECT_FILE_EXTENSION}`;
}

export function buildProjectFile(
  projectName: string,
  spreadsheet: SpreadsheetData,
  design: CardDesign,
  sheetConfig: PrintSheetConfig
): FolioPressProjectFile {
  return {
    format: 'foliopress-project',
    version: 1,
    projectName: projectName.trim() || 'Untitled Raffle Project',
    savedAt: new Date().toISOString(),
    spreadsheet,
    design,
    sheetConfig,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function estimateProjectSizeBytes(
  projectName: string,
  spreadsheet: SpreadsheetData,
  design: CardDesign,
  sheetConfig: PrintSheetConfig
): number {
  try {
    const json = JSON.stringify(buildProjectFile(projectName, spreadsheet, design, sheetConfig));
    return new Blob([json]).size;
  } catch {
    return 0;
  }
}

export function canUseNativeFileSystemPicker(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.self !== window.top) return false;
    const w = window as PickerWindow;
    return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';
  } catch {
    return false;
  }
}

function normalizeSpreadsheet(raw: unknown): SpreadsheetData {
  const fallback = createInitialSpreadsheet();
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Partial<SpreadsheetData>;

  const rawRows: string[][] = Array.isArray(obj.rawRows)
    ? obj.rawRows.map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []
      )
    : [];

  const selection =
    obj.selection && typeof obj.selection === 'object'
      ? {
          ...createDefaultSelection(rawRows),
          ...obj.selection,
          excludedRows: Array.isArray(obj.selection.excludedRows)
            ? obj.selection.excludedRows.filter((n): n is number => typeof n === 'number')
            : [],
          excludedCells: Array.isArray(obj.selection.excludedCells)
            ? obj.selection.excludedCells.filter((s): s is string => typeof s === 'string')
            : [],
        }
      : createDefaultSelection(rawRows);

  const derived = deriveDataFromSelection(rawRows, selection);
  const activeSheet =
    typeof obj.activeSheet === 'string' && obj.activeSheet.trim()
      ? obj.activeSheet
      : 'Sheet1';
  const sheetNames =
    Array.isArray(obj.sheetNames) && obj.sheetNames.length > 0
      ? obj.sheetNames.map(String)
      : [activeSheet];

  const workbookSheets: SpreadsheetData['workbookSheets'] = {};
  if (obj.workbookSheets && typeof obj.workbookSheets === 'object') {
    for (const [name, sheet] of Object.entries(obj.workbookSheets)) {
      if (!sheet || typeof sheet !== 'object') continue;
      const sRows = Array.isArray(sheet.rawRows)
        ? sheet.rawRows.map((row) =>
            Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []
          )
        : [];
      const sSel =
        sheet.selection && typeof sheet.selection === 'object'
          ? {
              ...createDefaultSelection(sRows),
              ...sheet.selection,
              excludedRows: Array.isArray(sheet.selection.excludedRows)
                ? sheet.selection.excludedRows
                : [],
              excludedCells: Array.isArray(sheet.selection.excludedCells)
                ? sheet.selection.excludedCells
                : [],
            }
          : createDefaultSelection(sRows);
      const sDerived = deriveDataFromSelection(sRows, sSel);
      workbookSheets[name] = {
        rawRows: sRows,
        selection: sSel,
        columns: sDerived.columns,
        entries: sDerived.entries,
      };
    }
  }

  workbookSheets[activeSheet] = {
    rawRows,
    selection,
    columns: derived.columns,
    entries: derived.entries,
  };

  return {
    fileName:
      typeof obj.fileName === 'string' && obj.fileName.trim()
        ? obj.fileName
        : 'imported-roster.xlsx',
    sheetNames,
    activeSheet,
    rawRows,
    selection,
    columns: derived.columns,
    entries: derived.entries,
    workbookSheets,
  };
}

function normalizeDesign(raw: unknown): CardDesign {
  const defaults = createInitialCardDesign();
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Partial<CardDesign>;

  return {
    ...defaults,
    ...obj,
    backgroundImage: {
      ...defaults.backgroundImage,
      ...(obj.backgroundImage ?? {}),
    },
    referenceImage: {
      ...defaults.referenceImage,
      ...(obj.referenceImage ?? {}),
    },
    contentBlocks: Array.isArray(obj.contentBlocks) ? obj.contentBlocks : defaults.contentBlocks,
    assets: Array.isArray(obj.assets) ? obj.assets : [],
  };
}

function normalizeSheetConfig(raw: unknown): PrintSheetConfig {
  const defaults = createInitialPrintSheetConfig();
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    ...defaults,
    ...(raw as Partial<PrintSheetConfig>),
  };
}

export function parseAndValidateProjectJson(
  rawText: string,
  fallbackName?: string
): FolioPressProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('This file is not valid JSON. Please choose a .foliopress project file.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid project file structure.');
  }

  const record = parsed as Record<string, unknown>;
  if (record.format !== 'foliopress-project') {
    throw new Error(
      'Unrecognized file format. Please select a project saved from FolioPress (.foliopress).'
    );
  }

  if (typeof record.version !== 'number' || record.version > 1) {
    throw new Error('This project file version is not supported.');
  }

  const derivedFallbackName = fallbackName
    ? fallbackName.replace(/\.foliopress$/i, '').replace(/\.json$/i, '')
    : 'Imported Project';

  const projectName =
    typeof record.projectName === 'string' && record.projectName.trim()
      ? record.projectName.trim()
      : derivedFallbackName;

  return {
    format: 'foliopress-project',
    version: 1,
    projectName,
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : new Date().toISOString(),
    spreadsheet: normalizeSpreadsheet(record.spreadsheet),
    design: normalizeDesign(record.design),
    sheetConfig: normalizeSheetConfig(record.sheetConfig),
  };
}

function triggerBlobDownload(jsonContent: string, fileName: string): void {
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SaveProjectResult {
  cancelled: boolean;
  handle: LocalFileHandle | null;
  fileName: string;
  method: 'handle' | 'download';
}

export async function saveProjectToDisk(
  projectFile: FolioPressProjectFile,
  existingHandle: LocalFileHandle | null,
  forceSaveAs = false
): Promise<SaveProjectResult> {
  const jsonContent = JSON.stringify(projectFile, null, 2);
  const suggestedName = sanitizeProjectFileName(projectFile.projectName);

  // 1. Direct overwrite if we already have an active native file handle and not Save As
  if (existingHandle && !forceSaveAs) {
    try {
      const writable = await existingHandle.createWritable();
      await writable.write(jsonContent);
      await writable.close();
      return {
        cancelled: false,
        handle: existingHandle,
        fileName: existingHandle.name,
        method: 'handle',
      };
    } catch {
      // Fall through to picker or blob download if permission revoked
    }
  }

  // 2. Native File System Save Picker when top-level & supported
  if (canUseNativeFileSystemPicker()) {
    const w = window as PickerWindow;
    try {
      const handle = await w.showSaveFilePicker!({
        suggestedName,
        types: [
          {
            description: 'FolioPress Project File',
            accept: { 'application/json': [PROJECT_FILE_EXTENSION] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonContent);
      await writable.close();
      return {
        cancelled: false,
        handle,
        fileName: handle.name,
        method: 'handle',
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          cancelled: true,
          handle: existingHandle,
          fileName: suggestedName,
          method: 'handle',
        };
      }
      // Fall through gracefully to download on SecurityError or unsupported context
    }
  }

  // 3. Universal browser download fallback (always works in iframes & all browsers)
  triggerBlobDownload(jsonContent, suggestedName);
  return {
    cancelled: false,
    handle: null,
    fileName: suggestedName,
    method: 'download',
  };
}

export async function openProjectFromNativePicker(): Promise<{
  project: FolioPressProjectFile;
  handle: LocalFileHandle;
  fileName: string;
} | null> {
  if (!canUseNativeFileSystemPicker()) return null;
  const w = window as PickerWindow;
  try {
    const [handle] = await w.showOpenFilePicker!({
      multiple: false,
      types: [
        {
          description: 'FolioPress Project File',
          accept: { 'application/json': [PROJECT_FILE_EXTENSION, '.json'] },
        },
      ],
    });
    if (!handle) return null;
    const file = await handle.getFile();
    const text = await file.text();
    const project = parseAndValidateProjectJson(text, file.name);
    return { project, handle, fileName: file.name };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return null;
    }
    throw err;
  }
}

export async function readProjectFromFile(file: File): Promise<{
  project: FolioPressProjectFile;
  fileName: string;
}> {
  const text = await file.text();
  const project = parseAndValidateProjectJson(text, file.name);
  return { project, fileName: file.name };
}
