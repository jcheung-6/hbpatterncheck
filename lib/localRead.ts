import { extractTraceFile, type ExtractedTrace } from "@/lib/extractTrace";
import { blankFlags } from "@/lib/extraction";
import { windowForRetention } from "@/lib/parsers/variantii";
import type { Extraction, RawPeak } from "@/lib/types";

export type LocalImage = { mime: string; data_base64: string };

export async function readImagesLocally(images: LocalImage[]): Promise<Extraction | null> {
  const reads: Extraction[] = [];
  for (const image of images.slice(0, 3)) {
    try {
      const buffer = Buffer.from(image.data_base64, "base64");
      const extension = reportExtension(buffer, image.mime);
      if (!extension) continue;
      const extracted = await extractTraceFile(buffer, extension);
      if (!extracted.ok) continue;
      const extraction = extractionFromTraces(extracted.traces);
      if (extraction) reads.push(extraction);
    } catch {
      continue;
    }
  }
  if (!reads.length) return null;
  if (reads.length === 1) return reads[0];
  return {
    ...reads[0],
    peaks: reads.flatMap((item) => item.peaks),
    instrument_confidence: "low",
  };
}

export function reportExtension(buffer: Buffer, mime: string): ".pdf" | ".png" | ".jpg" | null {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return ".pdf";
  if (buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return ".png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (mime.toLowerCase().includes("pdf") && buffer.subarray(0, 4).toString("latin1") === "%PDF") return ".pdf";
  return null;
}

export function extractionFromTraces(traces: ExtractedTrace[]): Extraction | null {
  const method = traces.find((trace) => trace.peaks.some((peak) => peak.percent != null && !Number.isNaN(peak.percent)))?.method;
  if (!method) return null;
  const peaks: RawPeak[] = [];
  const instrument: Extraction["instrument_guess"] = method === "sebia_ce" ? "sebia_ce" : "variant_ii";
  for (const trace of traces) {
    if (trace.method !== method) continue;
    for (const peak of trace.peaks) {
      if (peak.percent == null || Number.isNaN(peak.percent)) continue;
      const window = trace.method === "variant_ii" ? windowForRetention(peak.position) : null;
      peaks.push({
        name_or_label: peak.name,
        retention_or_migration: trace.method === "sebia_ce" ? `${Math.round(peak.position)}` : `${peak.position} min`,
        percent: peak.percent,
        zone_or_window: window || "",
        notes: "",
      });
    }
  }
  if (!peaks.length) return null;
  return {
    instrument_guess: instrument,
    instrument_confidence: "medium",
    readable: true,
    unread_reason: "",
    peaks,
    quality_flags: blankFlags(),
    raw_ocr_text: "",
    patient_identifiers_seen: false,
  };
}
