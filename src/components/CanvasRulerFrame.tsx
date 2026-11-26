import React, { useMemo } from 'react';
import { MeasurementUnit, RulerGuide } from '../types';
import { inToMm, mmToIn } from '../utils/cardRenderer';

interface CanvasRulerFrameProps {
  widthMm: number;
  heightMm: number;
  widthPx: number;
  unit: MeasurementUnit;
  showRulers: boolean;
  guides: RulerGuide[];
  snapToGrid: boolean;
  gridSpacingMm: number;
  onAddGuide: (guide: RulerGuide) => void;
  onUpdateGuide: (id: string, positionMm: number) => void;
  onRemoveGuide: (id: string) => void;
  children: React.ReactNode;
}

const RULER_THICKNESS_PX = 22;

function buildTicks(lengthMm: number, pxPerMm: number, unit: MeasurementUnit) {
  const ticks: Array<{ posPx: number; major: boolean; mid: boolean; label?: string }> = [];

  if (unit === 'in') {
    const lengthIn = mmToIn(lengthMm);
    const stepIn = 0.1;
    const totalSteps = Math.floor(lengthIn / stepIn + 0.0001);
    for (let i = 0; i <= totalSteps; i++) {
      const valIn = Math.round(i * stepIn * 100) / 100;
      const posPx = inToMm(valIn) * pxPerMm;
      const major = i % 10 === 0;
      const mid = !major && i % 5 === 0;
      ticks.push({
        posPx,
        major,
        mid,
        label: major ? `${valIn}` : undefined,
      });
    }
    return ticks;
  }

  // Millimeters
  const stepMm = pxPerMm >= 3.2 ? 1 : pxPerMm >= 1.8 ? 2 : 5;
  const majorStepMm = pxPerMm >= 2.2 ? 10 : 20;
  const midStepMm = majorStepMm / 2;

  for (let mm = 0; mm <= lengthMm + 0.001; mm += stepMm) {
    const rounded = Math.round(mm * 10) / 10;
    const major = Math.abs(rounded % majorStepMm) < 0.01;
    const mid = !major && Math.abs(rounded % midStepMm) < 0.01;
    ticks.push({
      posPx: rounded * pxPerMm,
      major,
      mid,
      label: major ? `${Math.round(rounded)}` : undefined,
    });
  }
  return ticks;
}

export function CanvasRulerFrame({
  widthMm,
  heightMm,
  widthPx,
  unit,
  showRulers,
  guides,
  snapToGrid,
  gridSpacingMm,
  onAddGuide,
  onUpdateGuide,
  onRemoveGuide,
  children,
}: CanvasRulerFrameProps) {
  const pxPerMm = widthPx / Math.max(10, widthMm);
  const heightPx = heightMm * pxPerMm;

  const hTicks = useMemo(
    () => (showRulers ? buildTicks(widthMm, pxPerMm, unit) : []),
    [showRulers, widthMm, pxPerMm, unit]
  );
  const vTicks = useMemo(
    () => (showRulers ? buildTicks(heightMm, pxPerMm, unit) : []),
    [showRulers, heightMm, pxPerMm, unit]
  );

  const snapGuideValue = (rawMm: number, maxMm: number): number => {
    const clamped = Math.max(0, Math.min(maxMm, rawMm));
    if (snapToGrid && gridSpacingMm > 0) {
      const snapped = Math.round(clamped / gridSpacingMm) * gridSpacingMm;
      if (Math.abs(snapped - clamped) <= Math.min(2, gridSpacingMm * 0.35)) {
        return Math.round(snapped * 10) / 10;
      }
    }
    return Math.round(clamped * 2) / 2;
  };

  // Dragging from top ruler creates a horizontal ('y') guide; from left ruler creates a vertical ('x') guide
  const startCreateGuide = (e: React.PointerEvent, axis: 'x' | 'y') => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const rulerEl = e.currentTarget as HTMLElement;
    const rulerRect = rulerEl.getBoundingClientRect();
    const id = `guide-${Date.now()}`;
    const maxMm = axis === 'x' ? widthMm : heightMm;

    const computePosMm = (clientX: number, clientY: number) => {
      if (axis === 'y') {
        const offsetPx = clientY - rulerRect.bottom;
        return offsetPx / pxPerMm;
      }
      const offsetPx = clientX - rulerRect.right;
      return offsetPx / pxPerMm;
    };

    let created = false;

    const onMove = (ev: PointerEvent) => {
      const rawMm = computePosMm(ev.clientX, ev.clientY);
      if (rawMm >= 0 && rawMm <= maxMm) {
        const pos = snapGuideValue(rawMm, maxMm);
        if (!created) {
          created = true;
          onAddGuide({ id, axis, positionMm: pos });
        } else {
          onUpdateGuide(id, pos);
        }
      } else if (created && rawMm < -3) {
        onRemoveGuide(id);
        created = false;
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!showRulers) {
    return (
      <div className="shadow-[0_14px_40px_-14px_rgba(9,9,11,0.16)] ring-1 ring-black/6">
        {children}
      </div>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="inline-grid select-none"
      style={{
        gridTemplateColumns: `${RULER_THICKNESS_PX}px ${widthPx}px`,
        gridTemplateRows: `${RULER_THICKNESS_PX}px ${heightPx}px`,
      }}
    >
      {/* Corner Unit Marker */}
      <div className="bg-white border-t border-l border-r border-b border-[#E4E4E7] flex items-center justify-center text-[9px] font-mono-tabular text-[#71717A] uppercase">
        {unit}
      </div>

      {/* Horizontal Top Ruler (drag down to pull horizontal guide) */}
      <div
        onPointerDown={(e) => startCreateGuide(e, 'y')}
        title="Drag down to add a horizontal guide"
        className="relative bg-white border-t border-r border-b border-[#E4E4E7] overflow-hidden cursor-ns-resize"
      >
        <svg width={widthPx} height={RULER_THICKNESS_PX} className="block">
          {hTicks.map((t, idx) => (
            <g key={idx}>
              <line
                x1={t.posPx}
                y1={t.major ? 4 : t.mid ? 11 : 15}
                x2={t.posPx}
                y2={RULER_THICKNESS_PX}
                stroke={t.major ? '#71717A' : '#D4D4D8'}
                strokeWidth="1"
              />
              {t.label && t.posPx < widthPx - 14 && (
                <text
                  x={t.posPx + 3}
                  y={11}
                  fill="#71717A"
                  fontSize="8.5"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {t.label}
                </text>
              )}
            </g>
          ))}
          {/* Guide markers along top ruler */}
          {guides
            .filter((g) => g.axis === 'x')
            .map((g) => (
              <line
                key={g.id}
                x1={g.positionMm * pxPerMm}
                y1={0}
                x2={g.positionMm * pxPerMm}
                y2={RULER_THICKNESS_PX}
                stroke="#2563EB"
                strokeWidth="1.5"
              />
            ))}
        </svg>
      </div>

      {/* Vertical Left Ruler (drag right to pull vertical guide) */}
      <div
        onPointerDown={(e) => startCreateGuide(e, 'x')}
        title="Drag right to add a vertical guide"
        className="relative bg-white border-l border-r border-b border-[#E4E4E7] overflow-hidden cursor-ew-resize"
      >
        <svg width={RULER_THICKNESS_PX} height={heightPx} className="block">
          {vTicks.map((t, idx) => (
            <g key={idx}>
              <line
                x1={t.major ? 4 : t.mid ? 11 : 15}
                y1={t.posPx}
                x2={RULER_THICKNESS_PX}
                y2={t.posPx}
                stroke={t.major ? '#71717A' : '#D4D4D8'}
                strokeWidth="1"
              />
              {t.label && t.posPx < heightPx - 14 && (
                <text
                  x={10}
                  y={t.posPx + 3}
                  fill="#71717A"
                  fontSize="8.5"
                  fontFamily="IBM Plex Mono, monospace"
                  transform={`rotate(-90, 10, ${t.posPx + 3})`}
                  textAnchor="end"
                >
                  {t.label}
                </text>
              )}
            </g>
          ))}
          {/* Guide markers along left ruler */}
          {guides
            .filter((g) => g.axis === 'y')
            .map((g) => (
              <line
                key={g.id}
                x1={0}
                y1={g.positionMm * pxPerMm}
                x2={RULER_THICKNESS_PX}
                y2={g.positionMm * pxPerMm}
                stroke="#2563EB"
                strokeWidth="1.5"
              />
            ))}
        </svg>
      </div>

      {/* Card Canvas Slot */}
      <div className="shadow-[0_14px_40px_-14px_rgba(9,9,11,0.16)] ring-1 ring-black/6">
        {children}
      </div>
    </div>
  );
}
