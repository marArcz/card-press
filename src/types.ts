export type WorkspaceTab = 'data' | 'design' | 'sheet';

export type MeasurementUnit = 'mm' | 'in';

export type BorderStyle = 'none' | 'solid' | 'double' | 'dashed';

export type ImageFit = 'cover' | 'contain' | 'stretch';

export type CardFontFamily =
  | 'Plus Jakarta Sans'
  | 'DM Sans'
  | 'Playfair Display'
  | 'Oswald'
  | 'IBM Plex Mono';

export type TextAlign = 'left' | 'center' | 'right';

export type ContentMode = 'static' | 'column' | 'template';

export type EntryRow = Record<string, string>;

export type CellSelectionMode = 'rows' | 'cells';

export interface CellSelectionConfig {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  useFirstRowAsHeader: boolean;
  mode: CellSelectionMode;
  excludedRows: number[];
  excludedCells: string[];
}

export interface ParsedSheet {
  rawRows: string[][];
  selection: CellSelectionConfig;
  columns: string[];
  entries: EntryRow[];
}

export interface SpreadsheetData {
  fileName: string;
  sheetNames: string[];
  activeSheet: string;
  rawRows: string[][];
  selection: CellSelectionConfig;
  columns: string[];
  entries: EntryRow[];
  workbookSheets: Record<string, ParsedSheet>;
}

export interface ContentBlock {
  id: string;
  label: string;
  mode: ContentMode;
  text: string;
  columnKey: string;
  prefix: string;
  suffix: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  fontFamily: CardFontFamily;
  fontSizePt: number;
  fontWeight: 400 | 500 | 600 | 700;
  color: string;
  align: TextAlign;
  letterSpacingEm: number;
  uppercase: boolean;
  backgroundColor: string;
  borderColor: string;
  paddingMm: number;
}

export interface AssetLayer {
  id: string;
  name: string;
  dataUrl: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  opacity: number;
  fit: 'contain' | 'cover';
  borderRadiusMm: number;
}

export interface BackgroundImageConfig {
  dataUrl: string | null;
  fileName: string;
  enabled: boolean;
  fit: ImageFit;
  opacity: number;
  overlayColor: string;
  overlayOpacity: number;
}

export interface ReferenceImageConfig {
  dataUrl: string | null;
  fileName: string;
  showGhostOverlay: boolean;
  ghostOpacity: number;
}

export interface CardDesign {
  widthMm: number;
  heightMm: number;
  unit: MeasurementUnit;
  backgroundColor: string;
  accentColor: string;
  borderStyle: BorderStyle;
  borderColor: string;
  borderWidthMm: number;
  borderInsetMm: number;
  cornerRadiusMm: number;
  dividerEnabled: boolean;
  dividerPositionPct: number;
  dividerStyle: 'dashed' | 'solid';
  dividerColor: string;
  backgroundImage: BackgroundImageConfig;
  referenceImage: ReferenceImageConfig;
  contentBlocks: ContentBlock[];
  assets: AssetLayer[];
}

export interface PrintSheetConfig {
  paperSize: 'a4' | 'letter';
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  gapMm: number;
  showCropMarks: boolean;
  showCutGuides: boolean;
  cropMarkLengthMm: number;
  cropMarkOffsetMm: number;
  rangeMode: 'all' | 'custom';
  rangeStart: number;
  rangeEnd: number;
}

export interface SheetLayoutMetrics {
  pageWidthMm: number;
  pageHeightMm: number;
  cols: number;
  rows: number;
  cardsPerPage: number;
  totalCards: number;
  totalPages: number;
  offsetXMm: number;
  offsetYMm: number;
  fitsOnPage: boolean;
}

export type SelectedLayer =
  | { type: 'content'; id: string }
  | { type: 'asset'; id: string }
  | null;

export interface CardSizePreset {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  note: string;
}
