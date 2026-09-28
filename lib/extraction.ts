import type { Extraction, InstrumentId, QualityFlags, RawPeak } from "@/lib/types";

const EMPTY_FLAGS: QualityFlags = {
  cut_off: false,
  overloaded: false,
  baseline_drift: false,
  overlapping_peaks: false,
  poor_resolution: false,
  missing_scale: false,
};

function asBool(value: unknown): boolean {
  return value === true;
}

function asPercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0 || value > 100.5) return null;
    return value;
  }
  if (typeof value === "string") {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    return asPercent(Number(match[1]));
  }
  return null;
}

function asInstrument(value: unknown): InstrumentId {
  if (value === "variant_ii" || value === "sebia_ce" || value === "unknown") return value;
  return "unknown";
}

export function coerceExtraction(value: unknown): Extraction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.peaks)) return null;
  const flags = (record.quality_flags ?? {}) as Record<string, unknown>;
  const peaks: RawPeak[] = [];
  for (const item of record.peaks) {
    if (!item || typeof item !== "object") continue;
    const peak = item as Record<string, unknown>;
    peaks.push({
      name_or_label: String(peak.name_or_label ?? "").slice(0, 80),
      retention_or_migration: String(peak.retention_or_migration ?? "").slice(0, 40),
      percent: asPercent(peak.percent),
      zone_or_window: String(peak.zone_or_window ?? "").slice(0, 40),
      notes: String(peak.notes ?? "").slice(0, 160),
    });
  }
  const confidence = record.instrument_confidence;
  return {
    instrument_guess: asInstrument(record.instrument_guess),
    instrument_confidence: confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "low",
    readable: record.readable !== false,
    unread_reason: String(record.unread_reason ?? "").slice(0, 400),
    peaks,
    quality_flags: {
      cut_off: asBool(flags.cut_off),
      overloaded: asBool(flags.overloaded),
      baseline_drift: asBool(flags.baseline_drift),
      overlapping_peaks: asBool(flags.overlapping_peaks),
      poor_resolution: asBool(flags.poor_resolution),
      missing_scale: asBool(flags.missing_scale),
    },
    raw_ocr_text: String(record.raw_ocr_text ?? "").slice(0, 4000),
    patient_identifiers_seen: asBool(record.patient_identifiers_seen),
  };
}

export function blankFlags(): QualityFlags {
  return { ...EMPTY_FLAGS };
}
