import { MAX_CHUNK_BYTES } from "@/lib/sync/messages";
import { LIMITS, type Language } from "@/lib/viz/engines";
import type { Trace } from "@/lib/viz/trace";

export const VIZ_EVENTS = { code: "viz-code", trace: "viz-trace", step: "viz-step", syncRequest: "viz-sync-request" } as const;
export const vizTopic = (roomId: string) => `room:${roomId}:viz`;

// JSON escaping inside the broadcast can at most double a piece; 1,000 bytes cover the envelope.
export const TRACE_PIECE_BYTES = Math.floor((MAX_CHUNK_BYTES - 1000) / 2);
const MAX_PIECES = Math.ceil(LIMITS.maxTraceBytes / TRACE_PIECE_BYTES) + 1;

export type CodePayload = { from: string; language: Language; code: string; stdin: string; cursorLine: number; rev: number };
export type TraceChunk = { from: string; runId: string; index: number; total: number; data: string };
export type StepPayload = { from: string; runId: string; step: number; playing: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseCode(p: unknown): CodePayload | null {
  if (!isRecord(p)) return null;
  const { from, language, code, stdin, cursorLine, rev } = p;
  if (typeof from !== "string" || (language !== "python" && language !== "cpp")) return null;
  if (typeof code !== "string" || code.length > LIMITS.maxCodeChars || typeof stdin !== "string" || stdin.length > LIMITS.maxStdinChars) return null;
  if (!isCount(cursorLine) || !isCount(rev)) return null;
  return { from, language, code, stdin, cursorLine, rev };
}

export function parseChunk(p: unknown): TraceChunk | null {
  if (!isRecord(p)) return null;
  const { from, runId, index, total, data } = p;
  if (typeof from !== "string" || typeof runId !== "string" || typeof data !== "string") return null;
  if (!isCount(index) || !isCount(total) || total < 1 || total > MAX_PIECES || index >= total) return null;
  return { from, runId, index, total, data };
}

export function parseStep(p: unknown): StepPayload | null {
  if (!isRecord(p)) return null;
  const { from, runId, step, playing } = p;
  if (typeof from !== "string" || typeof runId !== "string" || !isCount(step) || typeof playing !== "boolean") return null;
  return { from, runId, step, playing };
}

const isFrame = (f: unknown) => isRecord(f) && typeof f.fn === "string" && Number.isInteger(f.line) && isRecord(f.locals);

export function parseTrace(text: string): Trace | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!isRecord(value) || (value.language !== "python" && value.language !== "cpp") || typeof value.stdout !== "string" || !Array.isArray(value.steps)) return null;
  if (value.steps.length > LIMITS.maxSteps) return null;
  for (const step of value.steps) {
    if (!isRecord(step) || !Number.isInteger(step.line) || typeof step.out !== "number" || !Array.isArray(step.stack) || !step.stack.every(isFrame)) return null;
  }
  return value as Trace;
}

/** Splits text into pieces of at most maxBytes UTF-8 bytes, never inside a character. */
export function splitByBytes(text: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  let size = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const charBytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size + charBytes > maxBytes && piece) {
      pieces.push(piece);
      piece = "";
      size = 0;
    }
    piece += char;
    size += charBytes;
  }
  pieces.push(piece);
  return pieces;
}

export function createTraceAssembler() {
  let runId: string | null = null;
  let parts: (string | undefined)[] = [];
  let received = 0;
  return {
    add(chunk: TraceChunk): { runId: string; trace: Trace } | null {
      if (chunk.runId !== runId) {
        runId = chunk.runId;
        parts = new Array(chunk.total);
        received = 0;
      }
      if (chunk.total !== parts.length || parts[chunk.index] !== undefined) return null;
      parts[chunk.index] = chunk.data;
      received += 1;
      if (received < parts.length) return null;
      const trace = parseTrace(parts.join(""));
      return trace ? { runId: chunk.runId, trace } : null;
    },
  };
}
