import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, Type } from '@google/genai';

const ALLOWED_FONTS = new Set([
  'Plus Jakarta Sans',
  'DM Sans',
  'Playfair Display',
  'Oswald',
  'IBM Plex Mono',
]);

const ALLOWED_BORDERS = new Set(['none', 'solid', 'double', 'dashed']);

function clamp(val: number, min: number, max: number): number {
  if (Number.isNaN(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY to your environment variables / Secrets panel to enable reference layout extraction.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface AnalyzeReferenceInput {
  imageBase64?: string;
  mimeType?: string;
  columns?: string[];
}

export interface AnalyzeReferenceResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleAnalyzeReference(
  input: AnalyzeReferenceInput
): Promise<AnalyzeReferenceResult> {
  try {
    const { imageBase64, mimeType, columns } = input ?? {};

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return { status: 400, body: { error: 'Missing reference image data.' } };
    }

    const safeMime =
      typeof mimeType === 'string' && /^image\/(png|jpeg|jpg|webp)$/i.test(mimeType)
        ? mimeType
        : 'image/png';

    const availableColumns = Array.isArray(columns)
      ? columns
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .slice(0, 20)
      : [];

    const ai = getGeminiClient();

    const promptText = [
      'Analyze this raffle ticket / event card reference image and reconstruct it as an editable print card layout specification.',
      'Carefully observe the aspect ratio, background color, border treatment, whether there is a vertical tear-off stub divider (set dividerEnabled=false if there is none), color palette, typography hierarchy, and exact relative positioning of every text element including small corner labels and values.',
      availableColumns.length > 0
        ? `The user's Excel spreadsheet has these columns: ${availableColumns
            .map((c) => `"${c}"`)
            .join(', ')}. Map participant/ticket/dynamic slots in the reference image to the most appropriate spreadsheet column using mode "column" (with columnKey matching the exact column name) or mode "template" (using {{ColumnName}}). Keep static captions, field titles, headings, dates, and instructions as mode "static" matching the reference image.`
        : 'Use mode "static" for event titles/labels and mode "column" with columnKey "__ROW_NUMBER__" for the ticket number.',
      'Ensure all content blocks fit cleanly inside the card bounds (xPct between 4 and 86, yPct between 5 and 88, widthPct between 14 and 92) with zero overlapping text.',
      'Pick fontFamily strictly from: "Plus Jakarta Sans", "DM Sans", "Playfair Display", "Oswald", or "IBM Plex Mono".',
      'Pick borderStyle strictly from: "none", "solid", "double", or "dashed".',
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: safeMime,
              data: imageBase64,
            },
          },
          { text: promptText },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description:
                'One concise plain-language sentence summarizing the extracted card layout and palette.',
            },
            widthMm: {
              type: Type.NUMBER,
              description: 'Card width in millimeters (between 60 and 190).',
            },
            heightMm: {
              type: Type.NUMBER,
              description: 'Card height in millimeters (between 40 and 140).',
            },
            backgroundColor: {
              type: Type.STRING,
              description: 'Hex color for card background, e.g. #FFFFFF or #F7F4EC.',
            },
            accentColor: {
              type: Type.STRING,
              description: 'Primary accent hex color observed in the card.',
            },
            borderStyle: {
              type: Type.STRING,
              description: 'One of: none, solid, double, dashed.',
            },
            borderColor: {
              type: Type.STRING,
              description: 'Hex color for card border.',
            },
            borderWidthMm: {
              type: Type.NUMBER,
              description: 'Border thickness in mm (0.2 to 2.0).',
            },
            borderInsetMm: {
              type: Type.NUMBER,
              description: 'Border inset margin from card edge in mm (0 to 8).',
            },
            cornerRadiusMm: {
              type: Type.NUMBER,
              description: 'Card corner radius in mm (0 to 8).',
            },
            dividerEnabled: {
              type: Type.BOOLEAN,
              description: 'Whether the reference card includes a vertical tear-off stub divider.',
            },
            dividerPositionPct: {
              type: Type.NUMBER,
              description: 'Horizontal percentage position of vertical stub divider (60 to 82).',
            },
            dividerStyle: {
              type: Type.STRING,
              description: 'Either dashed or solid.',
            },
            dividerColor: {
              type: Type.STRING,
              description: 'Hex color for the divider line.',
            },
            contentBlocks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  mode: { type: Type.STRING, description: 'static, column, or template' },
                  text: { type: Type.STRING },
                  columnKey: { type: Type.STRING },
                  prefix: { type: Type.STRING },
                  suffix: { type: Type.STRING },
                  xPct: { type: Type.NUMBER },
                  yPct: { type: Type.NUMBER },
                  widthPct: { type: Type.NUMBER },
                  fontFamily: { type: Type.STRING },
                  fontSizePt: { type: Type.NUMBER },
                  fontWeight: { type: Type.INTEGER },
                  color: { type: Type.STRING },
                  align: { type: Type.STRING, description: 'left, center, or right' },
                  letterSpacingEm: { type: Type.NUMBER },
                  uppercase: { type: Type.BOOLEAN },
                  backgroundColor: { type: Type.STRING },
                  borderColor: { type: Type.STRING },
                  paddingMm: { type: Type.NUMBER },
                },
                required: [
                  'label',
                  'mode',
                  'text',
                  'xPct',
                  'yPct',
                  'widthPct',
                  'fontFamily',
                  'fontSizePt',
                  'fontWeight',
                  'color',
                  'align',
                ],
              },
            },
          },
          required: [
            'summary',
            'widthMm',
            'heightMm',
            'backgroundColor',
            'accentColor',
            'borderStyle',
            'borderColor',
            'dividerEnabled',
            'contentBlocks',
          ],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return {
        status: 502,
        body: { error: 'The vision model returned an empty layout response.' },
      };
    }

    const parsed = JSON.parse(rawText);

    const sanitizedBlocks = Array.isArray(parsed.contentBlocks)
      ? parsed.contentBlocks.slice(0, 12).map((b: Record<string, unknown>, idx: number) => {
          const modeRaw = String(b.mode ?? 'static');
          const mode =
            modeRaw === 'column' || modeRaw === 'template' || modeRaw === 'static'
              ? modeRaw
              : 'static';
          const fontRaw = String(b.fontFamily ?? 'Plus Jakarta Sans');
          const fontFamily = ALLOWED_FONTS.has(fontRaw) ? fontRaw : 'Plus Jakarta Sans';
          const alignRaw = String(b.align ?? 'left');
          const align =
            alignRaw === 'center' || alignRaw === 'right' || alignRaw === 'left'
              ? alignRaw
              : 'left';
          const rawWeight = Number(b.fontWeight ?? 500);
          const fontWeight =
            rawWeight >= 650 ? 700 : rawWeight >= 550 ? 600 : rawWeight >= 450 ? 500 : 400;

          let columnKey = String(b.columnKey ?? '');
          if (
            mode === 'column' &&
            columnKey !== '__ROW_NUMBER__' &&
            !availableColumns.includes(columnKey)
          ) {
            columnKey = availableColumns[0] ?? '__ROW_NUMBER__';
          }

          return {
            id: `ai-blk-${Date.now()}-${idx}`,
            label: String(b.label ?? `Field ${idx + 1}`).slice(0, 40),
            mode,
            text: String(b.text ?? ''),
            columnKey,
            prefix: String(b.prefix ?? ''),
            suffix: String(b.suffix ?? ''),
            xPct: clamp(Number(b.xPct ?? 8), 2, 86),
            yPct: clamp(Number(b.yPct ?? 12 + idx * 14), 4, 88),
            widthPct: clamp(Number(b.widthPct ?? 50), 12, 94),
            fontFamily,
            fontSizePt: clamp(Number(b.fontSizePt ?? 11), 6, 36),
            fontWeight,
            color: typeof b.color === 'string' && b.color.startsWith('#') ? b.color : '#09090B',
            align,
            letterSpacingEm: clamp(Number(b.letterSpacingEm ?? 0), -0.04, 0.25),
            uppercase: Boolean(b.uppercase),
            backgroundColor:
              typeof b.backgroundColor === 'string' && b.backgroundColor.startsWith('#')
                ? b.backgroundColor
                : '',
            borderColor:
              typeof b.borderColor === 'string' && b.borderColor.startsWith('#')
                ? b.borderColor
                : '',
            paddingMm: clamp(Number(b.paddingMm ?? 0), 0, 5),
          };
        })
      : [];

    const borderStyleRaw = String(parsed.borderStyle ?? 'solid');
    const borderStyle = ALLOWED_BORDERS.has(borderStyleRaw) ? borderStyleRaw : 'solid';

    return {
      status: 200,
      body: {
        summary: String(
          parsed.summary ?? 'Extracted card layout and typography from reference image.'
        ),
        design: {
          widthMm: Math.round(clamp(Number(parsed.widthMm ?? 140), 55, 190)),
          heightMm: Math.round(clamp(Number(parsed.heightMm ?? 65), 38, 140)),
          backgroundColor:
            typeof parsed.backgroundColor === 'string' && parsed.backgroundColor.startsWith('#')
              ? parsed.backgroundColor
              : '#FFFFFF',
          accentColor:
            typeof parsed.accentColor === 'string' && parsed.accentColor.startsWith('#')
              ? parsed.accentColor
              : '#18181B',
          borderStyle,
          borderColor:
            typeof parsed.borderColor === 'string' && parsed.borderColor.startsWith('#')
              ? parsed.borderColor
              : '#18181B',
          borderWidthMm: clamp(Number(parsed.borderWidthMm ?? 0.5), 0.2, 2.5),
          borderInsetMm: clamp(Number(parsed.borderInsetMm ?? 3), 0, 10),
          cornerRadiusMm: clamp(Number(parsed.cornerRadiusMm ?? 0), 0, 8),
          dividerEnabled: Boolean(parsed.dividerEnabled),
          dividerPositionPct: clamp(Number(parsed.dividerPositionPct ?? 72), 55, 85),
          dividerStyle: parsed.dividerStyle === 'solid' ? 'solid' : 'dashed',
          dividerColor:
            typeof parsed.dividerColor === 'string' && parsed.dividerColor.startsWith('#')
              ? parsed.dividerColor
              : '#A1A1AA',
          contentBlocks: sanitizedBlocks,
        },
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unable to analyze reference image.';
    console.error('[analyze-reference] Error:', err);
    return { status: 500, body: { error: message } };
  }
}

interface ServerlessRequest extends IncomingMessage {
  body?: unknown;
}

interface ServerlessResponse extends ServerResponse {
  status?: (code: number) => ServerlessResponse;
  json?: (data: unknown) => void;
}

async function readJsonBody(req: ServerlessRequest): Promise<AnalyzeReferenceInput> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body) as AnalyzeReferenceInput;
    }
    if (typeof req.body === 'object') {
      return req.body as AnalyzeReferenceInput;
    }
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  return raw ? (JSON.parse(raw) as AnalyzeReferenceInput) : {};
}

function sendJson(res: ServerlessResponse, status: number, payload: Record<string, unknown>): void {
  if (typeof res.status === 'function') {
    const next = res.status(status);
    if (typeof next.json === 'function') {
      next.json(payload);
      return;
    }
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await handleAnalyzeReference(body);
    sendJson(res, result.status, result.body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid request payload.';
    sendJson(res, 400, { error: message });
  }
}
