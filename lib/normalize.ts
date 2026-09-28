import { kb } from "@/lib/kb";
import type { CanonicalPeak, InstrumentId, PeakKind, RawPeak } from "@/lib/types";
import { classifyLabel, parseRetentionMinutes, parseWindowToken, parseZone } from "@/lib/parsers/common";
import { windowForRetention } from "@/lib/parsers/variantii";

function asSlowMinor(kind: PeakKind, percent: number | null): PeakKind {
  if (percent == null) return kind;
  if (percent >= kb.thresholds.cs_min && percent <= kb.thresholds.small_slow_max) return "SLOW_MINOR";
  return kind;
}

export function normalizePeaks(rawPeaks: RawPeak[], instrument: InstrumentId): CanonicalPeak[] {
  return rawPeaks.map((raw) => {
    const label = (raw.name_or_label || "").trim() || "Unknown";
    const blob = `${label} ${raw.zone_or_window || ""} ${raw.retention_or_migration || ""} ${raw.notes || ""}`;
    const labelKind = classifyLabel(label);
    const zone = parseZone(blob) || parseZone(raw.zone_or_window || "") || parseZone(raw.retention_or_migration || "");
    const rt =
      parseRetentionMinutes(raw.retention_or_migration || "") ??
      parseRetentionMinutes(raw.zone_or_window || "");
    let window = parseWindowToken(raw.zone_or_window || "") || parseWindowToken(label);
    if (!window && instrument !== "sebia_ce" && rt != null) {
      window = windowForRetention(rt);
    }
    if (!window && instrument !== "sebia_ce") {
      if (labelKind === "A") window = "A0";
      else if (labelKind === "A2" || labelKind === "E" || labelKind === "LEPORE") window = "A2";
      else if (labelKind === "F") window = "F";
      else if (labelKind === "P2" || labelKind === "HOPE") window = "P2";
      else if (labelKind === "P3" || labelKind === "J") window = "P3";
      else if (labelKind === "S" || labelKind === "Q") window = "S";
      else if (labelKind === "C" || labelKind === "O_ARAB" || labelKind === "CS") window = "C";
      else if (labelKind === "D") window = "D";
      else if (labelKind === "H" || labelKind === "BARTS") window = "VOID";
    }

    let kind: PeakKind = labelKind;
    let inferred = false;
    const percent = raw.percent;

    if (instrument !== "variant_ii" && zone) {
      if (kind === "UNKNOWN" && zone === "Z15") {
        kind = "H";
        inferred = true;
      } else if (kind === "UNKNOWN" && zone === "Z14") {
        kind = "BARTS";
        inferred = true;
      } else if (kind === "UNKNOWN" && zone === "Z4") {
        kind = "E";
        inferred = true;
      } else if (kind === "UNKNOWN" && zone === "Z3") {
        kind = "A2";
        inferred = true;
      } else if (kind === "UNKNOWN" && zone === "Z9") {
        kind = "A";
        inferred = true;
      } else if (kind === "UNKNOWN" && zone === "Z8") {
        kind = "F";
        inferred = true;
      } else if (kind === "UNKNOWN" && zone === "Z10" && (percent ?? 0) >= 10) {
        kind = "HOPE";
        inferred = true;
      } else if (kind === "UNKNOWN" && zone === "Z12" && (percent ?? 0) >= kb.thresholds.fast_window_min) {
        kind = "J";
        inferred = true;
      } else if ((kind === "UNKNOWN" || kind === "C") && (zone === "Z1" || zone === "Z2")) {
        if ((percent ?? 100) <= kb.thresholds.small_slow_max) {
          kind = labelKind === "CS" ? "CS" : "SLOW_MINOR";
          inferred = labelKind !== "CS";
        } else if (zone === "Z2" && (percent ?? 0) >= kb.thresholds.c_trait_min) {
          kind = "C";
          inferred = labelKind !== "C";
        }
      }
    }

    if (instrument !== "sebia_ce" && window === "C" && (kind === "UNKNOWN" || kind === "C" || kind === "CS")) {
      if ((percent ?? 100) <= kb.thresholds.small_slow_max) {
        kind = labelKind === "CS" ? "CS" : asSlowMinor(kind === "CS" ? "CS" : "UNKNOWN", percent);
        inferred = labelKind !== "CS";
      }
    }

    if (kind === "CS") inferred = false;

    return {
      label,
      label_kind: labelKind,
      kind,
      inferred,
      percent,
      rt_min: rt,
      zone: instrument === "variant_ii" ? zone : zone,
      window: instrument === "sebia_ce" && zone && labelKind === "UNKNOWN" && !parseWindowToken(raw.zone_or_window || "") ? null : window,
      notes: raw.notes || "",
    };
  });
}
