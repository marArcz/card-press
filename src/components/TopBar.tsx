import { Download, Loader2, Menu } from 'lucide-react';
import { WorkspaceTab } from '../types';
import { ExportProgress } from '../utils/pdfExport';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onOpenProjectsDrawer: () => void;
  isProjectsDrawerOpen: boolean;
  hasUnsavedChanges: boolean;
  onExportPdf: () => void;
  isExporting: boolean;
  exportProgress: ExportProgress | null;
  canExport: boolean;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'data', label: 'Data' },
  { id: 'design', label: 'Design' },
  { id: 'sheet', label: 'Print Sheet' },
];

export function TopBar({
  activeTab,
  onTabChange,
  onOpenProjectsDrawer,
  isProjectsDrawerOpen,
  hasUnsavedChanges,
  onExportPdf,
  isExporting,
  exportProgress,
  canExport,
}: TopBarProps) {
  const exportLabel = isExporting
    ? exportProgress && exportProgress.total > 0
      ? `Exporting ${exportProgress.completed}/${exportProgress.total}`
      : 'Exporting...'
    : 'Export PDF';

  return (
    <header className="h-14 shrink-0 bg-white border-b border-[#E4E4E7] px-6 flex items-center justify-between gap-8">
      {/* Zone 1: Single-element Brand Wordmark */}
      <button
        type="button"
        onClick={() => onTabChange('design')}
        className="font-display text-[17px] font-semibold tracking-tight text-[#09090B] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-sm"
      >
        FolioPress
      </button>

      {/* Zone 2: Clean single-line text navigation links */}
      <nav aria-label="Workspace views" className="flex items-center gap-7 h-full">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`relative h-full inline-flex items-center text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                isActive ? 'text-[#09090B]' : 'text-[#71717A] hover:text-[#09090B]'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#09090B]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Primary action & right-end Projects drawer menu button */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onExportPdf}
          disabled={!canExport || isExporting}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#18181B] rounded-md hover:bg-[#27272A] disabled:opacity-45 disabled:cursor-not-allowed transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
        >
          {isExporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          <span className="tabular-nums">{exportLabel}</span>
        </button>

        <button
          type="button"
          onClick={onOpenProjectsDrawer}
          aria-label={hasUnsavedChanges ? 'Open projects menu (unsaved edits)' : 'Open projects menu'}
          aria-expanded={isProjectsDrawerOpen}
          title={hasUnsavedChanges ? 'Projects (unsaved edits)' : 'Projects'}
          className={`p-2 rounded-md border transition-colors duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
            isProjectsDrawerOpen
              ? 'bg-[#F4F4F5] border-[#D4D4D8] text-[#09090B]'
              : 'bg-white border-[#E4E4E7] text-[#18181B] hover:bg-[#F4F4F5]'
          }`}
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
