import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CURVE_N, type TraceMethod, type TracePeak } from "@/lib/similarity";

export type ExtractedTrace = {
  method: TraceMethod;
  axisStart: number;
  axisEnd: number;
  peaks: TracePeak[];
  curve: number[] | null;
};

export type ExtractResult = { ok: true; traces: ExtractedTrace[]; warnings: string[] } | { ok: false; error: string };

const SCRIPT = path.join(process.cwd(), "scripts", "extract_trace.py");

export async function extractTraceFile(bytes: Buffer, extension: string): Promise<ExtractResult> {
  if (bytes.length > 12 * 1024 * 1024) return { ok: false, error: "File is over 12 MB." };
  const dir = await mkdtemp(path.join(tmpdir(), "hbtrace-"));
  const file = path.join(dir, `page${extension}`);
  try {
    await writeFile(file, bytes);
    const stdout = await runPython(file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: "The extractor returned an unreadable result." };
    }
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "The extractor returned an unreadable result." };
    const record = parsed as { ok?: boolean; error?: string; warnings?: string[]; traces?: unknown[] };
    if (!record.ok) return { ok: false, error: record.error || "No trace could be read." };
    const traces = (record.traces ?? []).map(normalise).filter((trace): trace is ExtractedTrace => trace != null);
    if (!traces.length) return { ok: false, error: "No Variant II or Sebia trace could be read." };
    return { ok: true, traces, warnings: Array.isArray(record.warnings) ? record.warnings.map(String).slice(0, 6) : [] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runPython(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [SCRIPT, file], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("extractor timed out"));
    }, 25000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!stdout.trim()) reject(new Error(stderr.slice(0, 300) || `extractor exited ${code}`));
      else resolve(stdout);
    });
  });
}

function normalise(value: unknown): ExtractedTrace | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const method = record.method === "sebia_ce" || record.method === "variant_ii" ? record.method : null;
  if (!method) return null;
  const peaks = Array.isArray(record.peaks) ? record.peaks.map(normalisePeak).filter((peak): peak is TracePeak => peak != null) : [];
  if (peaks.length < 1) return null;
  const axisStart = typeof record.axisStart === "number" ? record.axisStart : 0;
  const axisEnd = typeof record.axisEnd === "number" ? record.axisEnd : method === "sebia_ce" ? 300 : 6;
  return { method, axisStart, axisEnd, peaks, curve: normaliseCurve(record.curve) };
}

function normalisePeak(value: unknown): TracePeak | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.replace(/[^\w .+-]/g, "").slice(0, 24) : "";
  const position = typeof record.position === "number" ? record.position : Number.NaN;
  const percent = typeof record.percent === "number" ? record.percent : Number.NaN;
  if (!name || !Number.isFinite(position) || !Number.isFinite(percent)) return null;
  if (percent < 0 || percent > 100) return null;
  return { name, position, percent };
}

function normaliseCurve(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== CURVE_N) return null;
  const curve = value.map((item) => (typeof item === "number" && Number.isFinite(item) ? Math.min(1, Math.max(0, item)) : 0));
  return curve.some((item) => item > 0) ? curve : null;
}
