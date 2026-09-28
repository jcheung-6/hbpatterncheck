import type { CanonicalPeak, InstrumentChoice, InstrumentId } from "@/lib/types";

export function inferInstrument(peaks: CanonicalPeak[]): InstrumentId {
  if (peaks.some((peak) => peak.zone)) return "sebia_ce";
  if (peaks.some((peak) => peak.window || peak.rt_min != null)) return "variant_ii";
  return "unknown";
}

export function resolveInstrument(
  choice: InstrumentChoice,
  guess: InstrumentId | null,
  peaks: CanonicalPeak[],
): InstrumentId {
  if (choice === "variant_ii") return "variant_ii";
  if (choice === "sebia") return "sebia_ce";
  if (guess && guess !== "unknown") return guess;
  return inferInstrument(peaks);
}
