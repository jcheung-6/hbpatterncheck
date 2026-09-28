import type { RawPeak } from "@/lib/types";

const START =
  /^\s*(?:(?:zone\s*)?Z\s*\d{1,2}\b|(?:Hb\s*)?(?:F|A2|A0|Ao|A|P2|P3|S|C|D|H|E|Bart'?s?|CS|Constant\s*Spring|Lepore|Hope|J(?:-Bangkok)?|Q(?:-Thailand)?|O-?Arab))\b/i;

function percentFrom(line: string): number | null {
  const marked = line.match(/(\d+(?:\.\d+)?)\s*%/);
  if (marked) return Number(marked[1]);
  const minutes = line.match(/(\d+(?:\.\d+)?)\s*min/i);
  const numbers = [...line.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const rest = numbers.filter((value) => !minutes || value !== Number(minutes[1]));
  if (rest.length === 1 && rest[0] <= 100) return rest[0];
  if (!minutes && numbers.length === 1 && numbers[0] <= 100) return numbers[0];
  return null;
}

/**
 * Lines that start with a haemoglobin label or a Capillarys zone.
 * Prose such as "MCV 66 fL" or "無近期輸血" is ignored.
 */
export function parsePeakTable(text: string): RawPeak[] {
  const peaks: RawPeak[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !START.test(trimmed)) continue;
    const zoneMatch = trimmed.match(/\bZ\s*(\d{1,2})\b/i) || trimmed.match(/\bzone\s*(\d{1,2})\b/i);
    const zone = zoneMatch ? `Z${Number(zoneMatch[1])}` : "";
    const rt = trimmed.match(/(\d+(?:\.\d+)?)\s*min/i);
    const percent = percentFrom(trimmed);
    let label = trimmed
      .replace(/\bzone\s*\d{1,2}\b/i, " ")
      .replace(/\bZ\s*\d{1,2}\b/i, " ")
      .replace(/(\d+(?:\.\d+)?)\s*%/g, " ")
      .replace(/(\d+(?:\.\d+)?)\s*min(?:ute)?s?/gi, " ")
      .replace(/[%|,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!label && zone) label = zone;
    if (/^(mcv|hb|hgb|wbc|plt|age)$/i.test(label)) continue;
    peaks.push({
      name_or_label: label || "Unknown",
      retention_or_migration: rt ? `${rt[1]} min` : zone,
      percent,
      zone_or_window: zone,
      notes: "",
    });
  }
  return peaks.filter((peak) => peak.percent != null);
}
