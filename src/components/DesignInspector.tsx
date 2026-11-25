import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Copy,
  ImagePlus,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  AssetLayer,
  CardDesign,
  CardFontFamily,
  ContentBlock,
  ContentMode,
  EntryRow,
  SelectedLayer,
} from '../types';
import { CARD_FONT_OPTIONS } from '../utils/sampleData';
import { formatDimension, resolveBlockText } from '../utils/cardRenderer';

interface DesignInspectorProps {
  design: CardDesign;
  columns: string[];
  activeEntry: EntryRow | undefined;
  activeEntryIndex: number;
  selectedLayer: SelectedLayer;
  onUpdateContentBlock: (id: string, patch: Partial<ContentBlock>) => void;
  onDuplicateContentBlock: (id: string) => void;
  onDeleteContentBlock: (id: string) => void;
  onUpdateAssetLayer: (id: string, patch: Partial<AssetLayer>) => void;
  onMoveAssetLayer: (id: string, direction: 'up' | 'down') => void;
  onDeleteAssetLayer: (id: string) => void;
  onAddContentBlock: (mode: ContentMode) => void;
  onOpenAssetsTab: () => void;
}

export function DesignInspector({
  design,
  columns,
  activeEntry,
  activeEntryIndex,
  selectedLayer,
  onUpdateContentBlock,
  onDuplicateContentBlock,
  onDeleteContentBlock,
  onUpdateAssetLayer,
  onMoveAssetLayer,
  onDeleteAssetLayer,
  onAddContentBlock,
  onOpenAssetsTab,
}: DesignInspectorProps) {
  const selectedBlock =
    selectedLayer?.type === 'content'
      ? design.contentBlocks.find((b) => b.id === selectedLayer.id) ?? null
      : null;

  const selectedAsset =
    selectedLayer?.type === 'asset'
      ? design.assets.find((a) => a.id === selectedLayer.id) ?? null
      : null;

  if (selectedBlock) {
    const insertToken = (col: string) => {
      const token = col === '__ROW_NUMBER__' ? '{{RowNumber}}' : `{{${col}}}`;
      const nextText = selectedBlock.text
        ? `${selectedBlock.text}${selectedBlock.text.endsWith(' ') ? '' : ' '}${token}`
        : token;
      onUpdateContentBlock(selectedBlock.id, { text: nextText });
    };

    return (
      <aside className="w-[300px] shrink-0 bg-white border-l border-[#E4E4E7] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E4E4E7] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-[#09090B] truncate">
              Content Block
            </h2>
            <p className="text-[11px] text-[#71717A] truncate">{selectedBlock.label}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onDuplicateContentBlock(selectedBlock.id)}
              title="Duplicate block"
              aria-label="Duplicate content block"
              className="p-1.5 text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] rounded"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteContentBlock(selectedBlock.id)}
              title="Delete block"
              aria-label="Delete content block"
              className="p-1.5 text-[#52525B] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Block Label */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[#52525B]">Field Name</label>
            <input
              type="text"
              value={selectedBlock.label}
              onChange={(e) => onUpdateContentBlock(selectedBlock.id, { label: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAFAFA] border border-[#E4E4E7] rounded-md text-[#09090B] focus:outline-none focus:border-[#2563EB] focus:bg-white"
            />
          </div>

          {/* Data Source Mode */}
          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-[#52525B]">Content Source</label>
            <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
              {(
                [
                  { id: 'column', label: 'Column' },
                  { id: 'static', label: 'Static' },
                  { id: 'template', label: 'Template' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    const patch: Partial<ContentBlock> = { mode: opt.id };
                    if (opt.id === 'column' && !selectedBlock.columnKey) {
                      patch.columnKey = columns[0] ?? '__ROW_NUMBER__';
                    }
                    if (opt.id === 'template' && !selectedBlock.text) {
                      patch.text = columns[0] ? `{{${columns[0]}}}` : '{{RowNumber}}';
                    }
                    onUpdateContentBlock(selectedBlock.id, patch);
                  }}
                  className={`py-1.5 text-[11px] font-medium rounded transition-colors ${
                    selectedBlock.mode === opt.id
                      ? 'bg-white text-[#09090B] shadow-xs'
                      : 'text-[#52525B] hover:text-[#09090B]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {selectedBlock.mode === 'column' && (
              <div className="space-y-2.5 pt-1">
                <div>
                  <label className="block text-[11px] text-[#71717A] mb-1">Excel Column</label>
                  <select
                    value={selectedBlock.columnKey}
                    onChange={(e) =>
                      onUpdateContentBlock(selectedBlock.id, { columnKey: e.target.value })
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E4E7] rounded-md text-[#09090B] focus:outline-none focus:border-[#2563EB]"
                  >
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                    <option value="__ROW_NUMBER__">Auto Row Number (0001...)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#71717A] mb-1">Prefix</label>
                    <input
                      type="text"
                      value={selectedBlock.prefix}
                      placeholder="e.g. No. "
                      onChange={(e) =>
                        onUpdateContentBlock(selectedBlock.id, { prefix: e.target.value })
                      }
                      className="w-full px-2 py-1.5 text-xs bg-[#FAFAFA] border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#71717A] mb-1">Suffix</label>
                    <input
                      type="text"
                      value={selectedBlock.suffix}
                      placeholder="optional"
                      onChange={(e) =>
                        onUpdateContentBlock(selectedBlock.id, { suffix: e.target.value })
                      }
                      className="w-full px-2 py-1.5 text-xs bg-[#FAFAFA] border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] focus:bg-white"
                    />
                  </div>
                </div>
              </div>
            )}

            {selectedBlock.mode === 'static' && (
              <div className="pt-1">
                <textarea
                  rows={2}
                  value={selectedBlock.text}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, { text: e.target.value })
                  }
                  placeholder="Enter static card copy..."
                  className="w-full px-2.5 py-1.5 text-xs bg-[#FAFAFA] border border-[#E4E4E7] rounded-md text-[#09090B] focus:outline-none focus:border-[#2563EB] focus:bg-white resize-y"
                />
              </div>
            )}

            {selectedBlock.mode === 'template' && (
              <div className="space-y-2 pt-1">
                <textarea
                  rows={2}
                  value={selectedBlock.text}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, { text: e.target.value })
                  }
                  placeholder="{{Full Name}} · {{Department}}"
                  className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md text-[#09090B] focus:outline-none focus:border-[#2563EB] focus:bg-white resize-y"
                />
                <div className="space-y-1">
                  <span className="block text-[11px] text-[#71717A]">Insert Excel column</span>
                  <div className="flex flex-wrap gap-1">
                    {columns.map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => insertToken(col)}
                        className="px-2 py-1 text-[11px] text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded transition-colors"
                      >
                        + {col}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => insertToken('__ROW_NUMBER__')}
                      className="px-2 py-1 text-[11px] text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded transition-colors"
                    >
                      + Row #
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <hr className="border-[#F4F4F5]" />

          {/* Typography */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold text-[#09090B]">Typography</h3>

            <div>
              <label className="block text-[11px] text-[#71717A] mb-1">Font Family</label>
              <select
                value={selectedBlock.fontFamily}
                onChange={(e) =>
                  onUpdateContentBlock(selectedBlock.id, {
                    fontFamily: e.target.value as CardFontFamily,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E4E7] rounded-md text-[#09090B] focus:outline-none focus:border-[#2563EB]"
              >
                {CARD_FONT_OPTIONS.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-[#71717A] mb-1">Size (pt)</label>
                <input
                  type="number"
                  min={5}
                  max={64}
                  step={0.5}
                  value={selectedBlock.fontSizePt}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, {
                      fontSizePt: Math.max(5, Math.min(64, Number(e.target.value) || 8)),
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#71717A] mb-1">Weight</label>
                <select
                  value={selectedBlock.fontWeight}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, {
                      fontWeight: Number(e.target.value) as ContentBlock['fontWeight'],
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB]"
                >
                  <option value={400}>Regular (400)</option>
                  <option value={500}>Medium (500)</option>
                  <option value={600}>SemiBold (600)</option>
                  <option value={700}>Bold (700)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 items-end">
              <div>
                <label className="block text-[11px] text-[#71717A] mb-1">Text Color</label>
                <div className="flex items-center gap-1.5 border border-[#E4E4E7] rounded-md px-2 py-1 bg-[#FAFAFA]">
                  <input
                    type="color"
                    value={selectedBlock.color || '#09090B'}
                    onChange={(e) =>
                      onUpdateContentBlock(selectedBlock.id, { color: e.target.value })
                    }
                    className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer shrink-0"
                  />
                  <input
                    type="text"
                    value={selectedBlock.color}
                    onChange={(e) =>
                      onUpdateContentBlock(selectedBlock.id, { color: e.target.value })
                    }
                    className="w-full text-[11px] font-mono-tabular bg-transparent focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[#71717A] mb-1">Alignment</label>
                <div className="grid grid-cols-3 gap-0.5 p-0.5 bg-[#F4F4F5] rounded-md">
                  {(
                    [
                      { id: 'left', Icon: AlignLeft },
                      { id: 'center', Icon: AlignCenter },
                      { id: 'right', Icon: AlignRight },
                    ] as const
                  ).map(({ id, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onUpdateContentBlock(selectedBlock.id, { align: id })}
                      aria-label={`Align ${id}`}
                      className={`py-1.5 flex items-center justify-center rounded transition-colors ${
                        selectedBlock.align === id
                          ? 'bg-white text-[#09090B] shadow-xs'
                          : 'text-[#52525B] hover:text-[#09090B]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 items-center">
              <div>
                <label className="block text-[11px] text-[#71717A] mb-1">
                  Tracking ({selectedBlock.letterSpacingEm.toFixed(2)}em)
                </label>
                <input
                  type="range"
                  min={-0.03}
                  max={0.22}
                  step={0.01}
                  value={selectedBlock.letterSpacingEm}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, {
                      letterSpacingEm: Number(e.target.value),
                    })
                  }
                  className="w-full accent-[#18181B]"
                />
              </div>

              <label className="flex items-center gap-2 pt-3 text-xs text-[#18181B] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selectedBlock.uppercase}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, { uppercase: e.target.checked })
                  }
                  className="rounded border-[#D4D4D8] accent-[#18181B]"
                />
                Uppercase
              </label>
            </div>
          </div>

          <hr className="border-[#F4F4F5]" />

          {/* Optional Box Fill & Border */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-semibold text-[#09090B]">Block Framing</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[#71717A]">Fill</span>
                  {selectedBlock.backgroundColor && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateContentBlock(selectedBlock.id, { backgroundColor: '' })
                      }
                      className="text-[10px] text-[#71717A] hover:text-[#09090B]"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 border border-[#E4E4E7] rounded-md px-2 py-1 bg-[#FAFAFA]">
                  <input
                    type="color"
                    value={selectedBlock.backgroundColor || '#F4F4F5'}
                    onChange={(e) =>
                      onUpdateContentBlock(selectedBlock.id, { backgroundColor: e.target.value })
                    }
                    className="w-4 h-4 bg-transparent cursor-pointer shrink-0"
                  />
                  <span className="text-[11px] font-mono-tabular text-[#52525B] truncate">
                    {selectedBlock.backgroundColor || 'None'}
                  </span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[#71717A]">Outline</span>
                  {selectedBlock.borderColor && (
                    <button
                      type="button"
                      onClick={() => onUpdateContentBlock(selectedBlock.id, { borderColor: '' })}
                      className="text-[10px] text-[#71717A] hover:text-[#09090B]"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 border border-[#E4E4E7] rounded-md px-2 py-1 bg-[#FAFAFA]">
                  <input
                    type="color"
                    value={selectedBlock.borderColor || '#D4D4D8'}
                    onChange={(e) =>
                      onUpdateContentBlock(selectedBlock.id, { borderColor: e.target.value })
                    }
                    className="w-4 h-4 bg-transparent cursor-pointer shrink-0"
                  />
                  <span className="text-[11px] font-mono-tabular text-[#52525B] truncate">
                    {selectedBlock.borderColor || 'None'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#71717A] mb-1">
                Inner Padding ({selectedBlock.paddingMm.toFixed(1)} mm)
              </label>
              <input
                type="range"
                min={0}
                max={4}
                step={0.5}
                value={selectedBlock.paddingMm}
                onChange={(e) =>
                  onUpdateContentBlock(selectedBlock.id, { paddingMm: Number(e.target.value) })
                }
                className="w-full accent-[#18181B]"
              />
            </div>
          </div>

          <hr className="border-[#F4F4F5]" />

          {/* Exact Position & Width */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold text-[#09090B]">Position & Width (%)</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-[#71717A] mb-1">X %</label>
                <input
                  type="number"
                  min={0}
                  max={95}
                  step={0.5}
                  value={selectedBlock.xPct}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, {
                      xPct: Math.max(0, Math.min(95, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#71717A] mb-1">Y %</label>
                <input
                  type="number"
                  min={0}
                  max={95}
                  step={0.5}
                  value={selectedBlock.yPct}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, {
                      yPct: Math.max(0, Math.min(95, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#71717A] mb-1">Width %</label>
                <input
                  type="number"
                  min={10}
                  max={100}
                  step={0.5}
                  value={selectedBlock.widthPct}
                  onChange={(e) =>
                    onUpdateContentBlock(selectedBlock.id, {
                      widthPct: Math.max(10, Math.min(100, Number(e.target.value) || 20)),
                    })
                  }
                  className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                />
              </div>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (selectedAsset) {
    return (
      <aside className="w-[300px] shrink-0 bg-white border-l border-[#E4E4E7] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E4E4E7] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-[#09090B] truncate">Uploaded Asset</h2>
            <p className="text-[11px] text-[#71717A] truncate">{selectedAsset.name}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onMoveAssetLayer(selectedAsset.id, 'up')}
              title="Bring forward"
              aria-label="Bring asset forward"
              className="p-1.5 text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] rounded"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onMoveAssetLayer(selectedAsset.id, 'down')}
              title="Send backward"
              aria-label="Send asset backward"
              className="p-1.5 text-[#52525B] hover:text-[#09090B] hover:bg-[#F4F4F5] rounded"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteAssetLayer(selectedAsset.id)}
              title="Delete asset"
              aria-label="Delete asset"
              className="p-1.5 text-[#52525B] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="w-full h-24 rounded-md bg-[#FAFAFA] border border-[#E4E4E7] flex items-center justify-center p-2 overflow-hidden">
            <img
              src={selectedAsset.dataUrl}
              alt={selectedAsset.name}
              referrerPolicy="no-referrer"
              className="max-w-full max-h-full object-contain"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[#52525B]">Asset Label</label>
            <input
              type="text"
              value={selectedAsset.name}
              onChange={(e) => onUpdateAssetLayer(selectedAsset.id, { name: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAFAFA] border border-[#E4E4E7] rounded-md focus:outline-none focus:border-[#2563EB] focus:bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[#52525B]">Image Fit</label>
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#F4F4F5] rounded-md">
              {(['contain', 'cover'] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  onClick={() => onUpdateAssetLayer(selectedAsset.id, { fit })}
                  className={`py-1.5 text-[11px] font-medium rounded capitalize transition-colors ${
                    selectedAsset.fit === fit
                      ? 'bg-white text-[#09090B] shadow-xs'
                      : 'text-[#52525B] hover:text-[#09090B]'
                  }`}
                >
                  {fit}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-[#71717A] mb-1">
              Opacity ({Math.round(selectedAsset.opacity * 100)}%)
            </label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={selectedAsset.opacity}
              onChange={(e) =>
                onUpdateAssetLayer(selectedAsset.id, { opacity: Number(e.target.value) })
              }
              className="w-full accent-[#18181B]"
            />
          </div>

          <div>
            <label className="block text-[11px] text-[#71717A] mb-1">
              Corner Radius ({selectedAsset.borderRadiusMm.toFixed(1)} mm)
            </label>
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={selectedAsset.borderRadiusMm}
              onChange={(e) =>
                onUpdateAssetLayer(selectedAsset.id, { borderRadiusMm: Number(e.target.value) })
              }
              className="w-full accent-[#18181B]"
            />
          </div>

          <hr className="border-[#F4F4F5]" />

          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold text-[#09090B]">Position & Size (%)</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-[#71717A] mb-1">X %</label>
                <input
                  type="number"
                  min={0}
                  max={96}
                  step={0.5}
                  value={selectedAsset.xPct}
                  onChange={(e) =>
                    onUpdateAssetLayer(selectedAsset.id, {
                      xPct: Math.max(0, Math.min(96, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#71717A] mb-1">Y %</label>
                <input
                  type="number"
                  min={0}
                  max={96}
                  step={0.5}
                  value={selectedAsset.yPct}
                  onChange={(e) =>
                    onUpdateAssetLayer(selectedAsset.id, {
                      yPct: Math.max(0, Math.min(96, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#71717A] mb-1">Width %</label>
                <input
                  type="number"
                  min={4}
                  max={100}
                  step={0.5}
                  value={selectedAsset.widthPct}
                  onChange={(e) =>
                    onUpdateAssetLayer(selectedAsset.id, {
                      widthPct: Math.max(4, Math.min(100, Number(e.target.value) || 12)),
                    })
                  }
                  className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#71717A] mb-1">Height %</label>
                <input
                  type="number"
                  min={4}
                  max={100}
                  step={0.5}
                  value={selectedAsset.heightPct}
                  onChange={(e) =>
                    onUpdateAssetLayer(selectedAsset.id, {
                      heightPct: Math.max(4, Math.min(100, Number(e.target.value) || 12)),
                    })
                  }
                  className="w-full px-2 py-1 text-xs font-mono-tabular bg-[#FAFAFA] border border-[#E4E4E7] rounded-md"
                />
              </div>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // Empty selection overview
  return (
    <aside className="w-[300px] shrink-0 bg-white border-l border-[#E4E4E7] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E4E4E7]">
        <h2 className="text-xs font-semibold text-[#09090B]">Inspector</h2>
        <p className="text-[11px] text-[#71717A]">Select an element on the card to edit</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-[#F4F4F5]">
            <span className="text-[#71717A]">Dimensions</span>
            <span className="font-mono-tabular text-[#09090B]">
              {formatDimension(design.widthMm, design.unit)} ×{' '}
              {formatDimension(design.heightMm, design.unit)}
            </span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-[#F4F4F5]">
            <span className="text-[#71717A]">Content Blocks</span>
            <span className="font-mono-tabular text-[#09090B]">{design.contentBlocks.length}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-[#F4F4F5]">
            <span className="text-[#71717A]">Uploaded Assets</span>
            <span className="font-mono-tabular text-[#09090B]">{design.assets.length}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-[#71717A]">Background Image</span>
            <span className="text-[#09090B]">
              {design.backgroundImage.enabled && design.backgroundImage.dataUrl ? 'Active' : 'Color only'}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold text-[#09090B]">Quick Actions</h3>
          <button
            type="button"
            onClick={() => onAddContentBlock('column')}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Excel Column Field
          </button>
          <button
            type="button"
            onClick={() => onAddContentBlock('static')}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E4E7] hover:bg-[#F4F4F5] rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Static Text Block
          </button>
          <button
            type="button"
            onClick={onOpenAssetsTab}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E4E7] hover:bg-[#F4F4F5] rounded-md transition-colors"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            Upload Logo or Graphic Asset
          </button>
        </div>

        {activeEntry && (
          <div className="space-y-2 pt-2 border-t border-[#F4F4F5]">
            <h3 className="text-[11px] font-semibold text-[#09090B]">
              Resolved Entry #{activeEntryIndex + 1}
            </h3>
            <div className="space-y-1.5">
              {design.contentBlocks.map((block) => (
                <div key={block.id} className="text-[11px] flex justify-between gap-2">
                  <span className="text-[#71717A] truncate">{block.label}</span>
                  <span className="text-[#09090B] font-medium truncate max-w-[155px]">
                    {resolveBlockText(block, activeEntry, activeEntryIndex) || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
