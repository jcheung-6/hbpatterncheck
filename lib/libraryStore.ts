import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CURVE_N, type SimilarityTrace, type TracePeak } from "@/lib/similarity";

const FILE = path.join(process.cwd(), "data", "user-library.json");
const MAX_TRACES = 200;

type Stored = { traces: SimilarityTrace[] };

export async function readUserLibrary(): Promise<SimilarityTrace[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Stored;
    if (!Array.isArray(parsed.traces)) return [];
    return parsed.traces.filter(isTrace).map((trace) => ({ ...trace, source: "library" as const }));
  } catch {
    return [];
  }
}

export async function addUserTraces(incoming: unknown[]): Promise<SimilarityTrace[]> {
  const current = await readUserLibrary();
  const accepted = incoming.map(normaliseIncoming).filter((trace): trace is SimilarityTrace => trace != null);
  const next = [...current, ...accepted].slice(-MAX_TRACES);
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ traces: next }), "utf8");
  return accepted;
}

export async function clearUserLibrary(): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ traces: [] }), "utf8");
}

function normaliseIncoming(value: unknown): SimilarityTrace | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const method = record.method === "sebia_ce" || record.method === "variant_ii" ? record.method : null;
  if (!method) return null;
  const peaks = Array.isArray(record.peaks) ? record.peaks.map(normalisePeak).filter((peak): peak is TracePeak => peak != null) : [];
  if (peaks.length < 1 || peaks.length > 24) return null;
  const axisStart = numberOr(record.axisStart, method === "sebia_ce" ? 0 : 0);
  const axisEnd = numberOr(record.axisEnd, method === "sebia_ce" ? 300 : 6);
  if (!(axisEnd > axisStart)) return null;
  const curve = normaliseCurve(record.curve);
  return {
    id: `u_${randomBytes(6).toString("hex")}`,
    method,
    peaks,
    curve,
    axisStart,
    axisEnd,
    source: "library",
  };
}

function normalisePeak(value: unknown): TracePeak | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.replace(/[^\w .+-]/g, "").slice(0, 24) : "";
  const position = typeof record.position === "number" ? record.position : Number.NaN;
  const percent = typeof record.percent === "number" ? record.percent : Number.NaN;
  if (!name || !Number.isFinite(position) || !Number.isFinite(percent)) return null;
  if (percent < 0 || percent > 100 || position < 0 || position > 400) return null;
  return { name, position, percent };
}

function normaliseCurve(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== CURVE_N) return null;
  const curve = value.map((item) => (typeof item === "number" && Number.isFinite(item) ? Math.min(1, Math.max(0, item)) : 0));
  if (curve.every((item) => item === 0)) return null;
  return curve;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isTrace(value: unknown): value is SimilarityTrace {
  if (!value || typeof value !== "object") return false;
  const record = value as SimilarityTrace;
  return (record.method === "variant_ii" || record.method === "sebia_ce") && Array.isArray(record.peaks) && typeof record.id === "string";
}
