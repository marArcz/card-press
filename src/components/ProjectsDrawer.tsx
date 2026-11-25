import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FilePlus2,
  FolderOpen,
  Save,
  SaveAll,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  CardDesign,
  FolioPressProjectFile,
  PrintSheetConfig,
  SpreadsheetData,
} from '../types';
import {
  canUseNativeFileSystemPicker,
  estimateProjectSizeBytes,
  formatFileSize,
  LocalFileHandle,
  openProjectFromNativePicker,
  PROJECT_FILE_EXTENSION,
  readProjectFromFile,
  sanitizeProjectFileName,
} from '../utils/projectFile';

interface ProjectsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  onChangeProjectName: (name: string) => void;
  spreadsheet: SpreadsheetData;
  design: CardDesign;
  sheetConfig: PrintSheetConfig;
  hasUnsavedChanges: boolean;
  lastSavedAt: string | null;
  linkedFileName: string | null;
  autoSaveEnabled: boolean;
  lastAutoSavedAt: string | null;
  onToggleAutoSave: (enabled: boolean) => void;
  onClearAutoSaveDraft: () => void;
  onSaveProject: (overrideName?: string, forceSaveAs?: boolean) => Promise<boolean>;
  onApplyOpenedProject: (
    project: FolioPressProjectFile,
    handle: LocalFileHandle | null,
    fileName: string
  ) => void;
  onCreateNewProject: () => void;
}

type PendingAction =
  | {
      type: 'open';
      project: FolioPressProjectFile;
      handle: LocalFileHandle | null;
      fileName: string;
    }
  | { type: 'new' }
  | null;

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function ProjectsDrawer({
  isOpen,
  onClose,
  projectName,
  onChangeProjectName,
  spreadsheet,
  design,
  sheetConfig,
  hasUnsavedChanges,
  lastSavedAt,
  linkedFileName,
  autoSaveEnabled,
  lastAutoSavedAt,
  onToggleAutoSave,
  onClearAutoSaveDraft,
  onSaveProject,
  onApplyOpenedProject,
  onCreateNewProject,
}: ProjectsDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveAsInline, setShowSaveAsInline] = useState(false);
  const [saveAsName, setSaveAsName] = useState(projectName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  useEffect(() => {
    if (isOpen) {
      setSaveAsName(projectName);
      setErrorMessage(null);
    } else {
      setShowSaveAsInline(false);
      setPendingAction(null);
    }
  }, [isOpen, projectName]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const estimatedBytes = useMemo(() => {
    if (!isOpen) return 0;
    return estimateProjectSizeBytes(projectName, spreadsheet, design, sheetConfig);
  }, [isOpen, projectName, spreadsheet, design, sheetConfig]);

  if (!isOpen) return null;

  const handleSaveClick = async () => {
    setErrorMessage(null);
    setIsSaving(true);
    try {
      await onSaveProject(undefined, false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to save project file.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAsClick = async () => {
    setErrorMessage(null);
    if (canUseNativeFileSystemPicker()) {
      setIsSaving(true);
      try {
        await onSaveProject(projectName, true);
      } catch (err: unknown) {
        setErrorMessage(err instanceof Error ? err.message : 'Unable to save project file.');
      } finally {
        setIsSaving(false);
      }
    } else {
      setSaveAsName(projectName);
      setShowSaveAsInline(true);
    }
  };

  const handleConfirmInlineSaveAs = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = saveAsName.trim();
    if (!trimmed) return;
    setErrorMessage(null);
    setIsSaving(true);
    try {
      onChangeProjectName(trimmed);
      await onSaveProject(trimmed, true);
      setShowSaveAsInline(false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to save project file.');
    } finally {
      setIsSaving(false);
    }
  };

  const processLoadedProject = (
    project: FolioPressProjectFile,
    handle: LocalFileHandle | null,
    fileName: string
  ) => {
    if (hasUnsavedChanges) {
      setPendingAction({ type: 'open', project, handle, fileName });
    } else {
      onApplyOpenedProject(project, handle, fileName);
      onClose();
    }
  };

  const handleOpenClick = async () => {
    setErrorMessage(null);
    if (canUseNativeFileSystemPicker()) {
      try {
        const result = await openProjectFromNativePicker();
        if (result) {
          processLoadedProject(result.project, result.handle, result.fileName);
        }
        return;
      } catch (err: unknown) {
        if (err instanceof Error && !/security|frame|picker/i.test(err.message)) {
          setErrorMessage(err.message);
          return;
        }
        // Fallback to standard file input below
      }
    }
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setErrorMessage(null);
    try {
      const { project, fileName } = await readProjectFromFile(file);
      processLoadedProject(project, null, fileName);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not open that project file.'
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDropFile = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    void handleFileSelected(file);
  };

  const handleNewProjectClick = () => {
    setErrorMessage(null);
    if (hasUnsavedChanges) {
      setPendingAction({ type: 'new' });
    } else {
      onCreateNewProject();
      onClose();
    }
  };

  const executePendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.type === 'open') {
      onApplyOpenedProject(
        pendingAction.project,
        pendingAction.handle,
        pendingAction.fileName
      );
    } else {
      onCreateNewProject();
    }
    setPendingAction(null);
    onClose();
  };

  const handleSaveThenExecutePending = async () => {
    if (!pendingAction) return;
    setIsSaving(true);
    try {
      const saved = await onSaveProject(undefined, false);
      if (saved) {
        executePendingAction();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const statusText = hasUnsavedChanges
    ? 'Unsaved edits'
    : lastSavedAt
    ? `Saved · ${formatTime(lastSavedAt)}`
    : 'Not yet saved to file';

  const mediaCount =
    design.assets.length +
    (design.referenceImage.dataUrl ? 1 : 0) +
    (design.backgroundImage.dataUrl &&
    design.backgroundImage.dataUrl !== design.referenceImage.dataUrl
      ? 1
      : 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-black/20 transition-opacity duration-150"
      />

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={`${PROJECT_FILE_EXTENSION},.json`}
        onChange={(e) => void handleFileSelected(e.target.files?.[0])}
        className="hidden"
      />

      {/* Slide-Over Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Projects and file management"
        className="relative z-10 w-full max-w-[372px] h-full bg-white border-l border-[#E4E4E7] flex flex-col shadow-[0_20px_50px_-20px_rgba(9,9,11,0.22)]"
      >
        {/* Header */}
        <div className="h-14 shrink-0 px-5 border-b border-[#E4E4E7] flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-[#09090B]">Projects</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close projects drawer"
            className="p-1.5 text-[#71717A] hover:text-[#09090B] hover:bg-[#F4F4F5] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Active Project Identity & Plain Metadata */}
          <section className="space-y-2.5">
            <label
              htmlFor="project-name-input"
              className="block text-[11px] font-semibold text-[#09090B]"
            >
              Project Name
            </label>
            <input
              id="project-name-input"
              type="text"
              value={projectName}
              onChange={(e) => onChangeProjectName(e.target.value)}
              placeholder="Untitled Raffle Project"
              className="w-full px-3 py-2 text-sm font-medium text-[#09090B] bg-[#FAFAFA] border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] focus:bg-white transition-colors"
            />

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#71717A] tabular-nums">
              <span className={hasUnsavedChanges ? 'text-[#B45309] font-medium' : 'text-[#52525B]'}>
                {statusText}
              </span>
              <span aria-hidden="true">·</span>
              <span>{spreadsheet.entries.length} cards</span>
              <span aria-hidden="true">·</span>
              <span>{mediaCount} images</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{formatFileSize(estimatedBytes)}</span>
            </div>

            <p className="text-[11px] font-mono-tabular text-[#71717A] truncate">
              File: {linkedFileName ?? sanitizeProjectFileName(projectName)}
            </p>
          </section>

          <hr className="border-[#F4F4F5]" />

          {/* Unsaved Changes Confirmation Guard */}
          {pendingAction && (
            <section
              role="alertdialog"
              aria-label="Unsaved changes confirmation"
              className="p-3.5 rounded-md bg-[#FFFBEB] border border-[#FDE68A] space-y-3"
            >
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#92400E]">Unsaved edits in workspace</p>
                <p className="text-[11px] text-[#78350F] leading-relaxed">
                  {pendingAction.type === 'open'
                    ? `Save your current edits before opening "${pendingAction.fileName}"?`
                    : 'Save your current edits before starting a new project?'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveThenExecutePending()}
                  disabled={isSaving}
                  className="px-3 py-1.5 text-[11px] font-medium text-white bg-[#18181B] hover:bg-[#27272A] rounded-md transition-colors"
                >
                  Save & Continue
                </button>
                <button
                  type="button"
                  onClick={executePendingAction}
                  className="px-3 py-1.5 text-[11px] font-medium text-[#B91C1C] bg-white border border-[#FECACA] hover:bg-[#FEF2F2] rounded-md transition-colors"
                >
                  Discard Edits
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAction(null)}
                  className="px-2.5 py-1.5 text-[11px] text-[#52525B] hover:text-[#09090B]"
                >
                  Cancel
                </button>
              </div>
            </section>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="p-3 rounded-md bg-[#FEF2F2] border border-[#FECACA] text-[11px] text-[#B91C1C] flex items-start justify-between gap-2"
            >
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="underline font-medium shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Save & Open Local .foliopress Actions */}
          <section className="space-y-2.5">
            <h3 className="text-[11px] font-semibold text-[#09090B]">Local Project File</h3>

            <button
              type="button"
              onClick={() => void handleSaveClick()}
              disabled={isSaving}
              className="w-full px-3.5 py-2.5 text-xs font-medium text-white bg-[#18181B] hover:bg-[#27272A] disabled:opacity-50 rounded-md flex items-center justify-between transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving...' : 'Save .foliopress File'}
              </span>
              <span className="text-[10px] font-mono-tabular text-[#A1A1AA]">Ctrl+S</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void handleSaveAsClick()}
                disabled={isSaving}
                className="px-3 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E4E7] hover:bg-[#F4F4F5] rounded-md inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <SaveAll className="w-3.5 h-3.5 text-[#52525B]" />
                Save As...
              </button>
              <button
                type="button"
                onClick={() => void handleOpenClick()}
                className="px-3 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E4E7] hover:bg-[#F4F4F5] rounded-md inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#52525B]" />
                Open File
              </button>
            </div>

            {showSaveAsInline && (
              <form
                onSubmit={(e) => void handleConfirmInlineSaveAs(e)}
                className="p-3 rounded-md bg-[#FAFAFA] border border-[#E4E4E7] space-y-2.5"
              >
                <label className="block text-[11px] font-medium text-[#52525B]">
                  Save project copy as
                </label>
                <input
                  type="text"
                  autoFocus
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB]"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono-tabular text-[#71717A] truncate">
                    {sanitizeProjectFileName(saveAsName)}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowSaveAsInline(false)}
                      className="px-2 py-1 text-[11px] text-[#52525B] hover:text-[#09090B]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-2.5 py-1 text-[11px] font-medium text-white bg-[#18181B] hover:bg-[#27272A] rounded"
                    >
                      Download
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Drag & Drop .foliopress Open Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={handleDropFile}
              onClick={() => void handleOpenClick()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleOpenClick();
                }
              }}
              className={`mt-1 px-4 py-5 border border-dashed rounded-md text-center cursor-pointer transition-colors ${
                isDraggingFile
                  ? 'border-[#2563EB] bg-[#EFF6FF]/60'
                  : 'border-[#D4D4D8] bg-[#FAFAFA] hover:border-[#71717A]'
              }`}
            >
              <Upload className="w-4 h-4 text-[#52525B] mx-auto" />
              <p className="mt-1.5 text-xs font-medium text-[#09090B]">
                Drop a .foliopress file here to open
              </p>
              <p className="mt-0.5 text-[11px] text-[#71717A]">
                Restores spreadsheet, cell selection, images, and print layout
              </p>
            </div>
          </section>

          <hr className="border-[#F4F4F5]" />

          {/* Auto-Save Working Session */}
          <section className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[11px] font-semibold text-[#09090B]">
                  Auto-Save Current Edits
                </h3>
                <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">
                  Quietly keeps your active working session in this browser so reloads never lose progress.
                </p>
              </div>
              <input
                type="checkbox"
                aria-label="Enable auto-save for current edits"
                checked={autoSaveEnabled}
                onChange={(e) => onToggleAutoSave(e.target.checked)}
                className="mt-0.5 accent-[#18181B] cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#71717A]">
              <span className="font-mono-tabular">
                {autoSaveEnabled
                  ? lastAutoSavedAt
                    ? `Draft synced · ${formatTime(lastAutoSavedAt)}`
                    : 'Auto-save ready'
                  : 'Auto-save paused'}
              </span>
              {lastAutoSavedAt && (
                <button
                  type="button"
                  onClick={onClearAutoSaveDraft}
                  className="inline-flex items-center gap-1 text-[#71717A] hover:text-[#DC2626] transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear draft
                </button>
              )}
            </div>
          </section>

          <hr className="border-[#F4F4F5]" />

          {/* Workspace Reset / New Project */}
          <section className="space-y-2">
            <button
              type="button"
              onClick={handleNewProjectClick}
              className="w-full px-3 py-2 text-xs font-medium text-[#52525B] hover:text-[#09090B] bg-[#FAFAFA] hover:bg-[#F4F4F5] border border-[#E4E4E7] rounded-md inline-flex items-center justify-center gap-2 transition-colors"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              New Blank Starter Project
            </button>
          </section>
        </div>

        {/* Footer Info */}
        <div className="px-5 py-3 border-t border-[#E4E4E7] bg-[#FAFAFA] text-[11px] text-[#71717A] flex items-center justify-between">
          <span>Format v1 · Local files only</span>
          <span className="font-mono-tabular">Ctrl+O to open</span>
        </div>
      </aside>
    </div>
  );
}
