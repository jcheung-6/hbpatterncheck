import demos from "@/data/demos.json";
import { kb } from "@/lib/kb";
import { errorBody } from "@/lib/errors";
import { ImagePrepError, normalizeImage } from "@/lib/image";
import { interpretCase } from "@/lib/interpret";
import { renderNarrative } from "@/lib/narrative";
import { OpenRouterError } from "@/lib/openrouter";
import { NARRATIVE_SYSTEM } from "@/lib/prompts";
import { redactIdentifiers, containsIdentifier } from "@/lib/redact";
import { buildSearchHits } from "@/lib/search";
import { parsePeakTable } from "@/lib/table";
import type { Extraction, InstrumentChoice, InstrumentId, InterpretResponse, RawPeak, RuleResult, SearchHit } from "@/lib/types";
import { followUpFromRules } from "@/lib/followup";
import { readImagesLocally } from "@/lib/localRead";

export type ImagePayload = { mime: string; data_base64: string };

export type RunInput = {
  notes?: string;
  instrument?: InstrumentChoice;
  demoId?: string | null;
  images?: ImagePayload[];
  locale?: "zh" | "en";
};

type VisionFn = (args: { dataUrl: string; instrumentHint: string; notes: string }) => Promise<{ extraction: Extraction; model: string }>;
type CompleteFn = (args: { system: string; user: string }) => Promise<{ zh: string; en: string; model: string } | null>;

const DEMO_IDS = new Set(demos.cases.map((item) => item.id));

function demoById(id: string | null | undefined) {
  return demos.cases.find((item) => item.id === id);
}

function fixtureExtraction(demoId: string): Extraction {
  const demo = demoById(demoId);
  if (!demo) {
    throw new Error("unknown demo");
  }
  const guess: InstrumentId = demo.instrument === "sebia_ce" ? "sebia_ce" : "variant_ii";
  return {
    instrument_guess: guess,
    instrument_confidence: "high",
    readable: true,
    unread_reason: "",
    peaks: demo.peaks as RawPeak[],
    quality_flags: {
      cut_off: false,
      overloaded: false,
      baseline_drift: false,
      overlapping_peaks: false,
      poor_resolution: false,
      missing_scale: false,
    },
    raw_ocr_text: "",
    patient_identifiers_seen: false,
  };
}

function blockedNarrative(text: string): boolean {
  return /確診為|可以確診|確診基因型|definitive genotype|confirmed genotype|diagnostic of/i.test(text);
}

export async function runInterpretation(
  input: RunInput,
  deps?: {
    vision?: VisionFn;
    complete?: CompleteFn;
    prepare?: (buffer: Buffer) => Promise<{ dataUrl: string }>;
    readLocal?: (images: ImagePayload[]) => Promise<Extraction | null>;
  },
): Promise<InterpretResponse> {
  const notes = (input.notes ?? "").slice(0, 2000);
  if (containsIdentifier(notes)) return errorBody("identifiers");
  const instrument = input.instrument ?? "auto";
  const images = (input.images ?? []).slice(0, 3);
  const table = parsePeakTable(notes);
  const demo = demoById(input.demoId);
  const warningList: { zh: string; en: string }[] = [];
  let extraction: Extraction | null = null;
  let source: "local" | "openrouter" | "pasted_table" | "demo_fixture" = "pasted_table";
  let visionAttempted = false;
  let visionModel: string | null = null;
  let peaks: RawPeak[] = [];
  let readable = true;

  const shouldReadLocal = images.length > 0 && table.length < 2 && (Boolean(deps?.readLocal) || !demo);
  const localRead = shouldReadLocal ? await (deps?.readLocal ?? readImagesLocally)(images) : null;
  if (localRead && localRead.peaks.some((peak) => peak.percent != null)) {
    extraction = localRead;
    peaks = localRead.peaks;
    source = "local";
    readable = localRead.readable;
    warningList.push({
      zh: "峰係喺本機從報告讀出，圖像冇送到 OpenRouter。",
      en: "Peaks were read on this machine. The image was not sent to OpenRouter.",
    });
  } else if (images.length && !deps?.vision) {
    if (table.length >= 2) {
      peaks = table;
      source = "pasted_table";
      warningList.push({
        zh: "本機讀唔到圖，判讀用緊你貼上嘅峰表。",
        en: "The image could not be read locally. The interpretation uses the pasted peak table.",
      });
    } else if (demo && DEMO_IDS.has(demo.id)) {
      extraction = fixtureExtraction(demo.id);
      peaks = extraction.peaks;
      source = "demo_fixture";
      warningList.push({
        zh: "本機讀唔到圖，亦冇呼叫雲端模型。以下用示範個案內置數值教學，不是讀圖結果。",
        en: "The image could not be read locally, and no cloud model was called. These are the built-in demo figures for teaching, not a reading of the image.",
      });
    } else {
      return errorBody("unreadable");
    }
  } else if (images.length && deps?.vision) {
    visionAttempted = true;
    const prepared: string[] = [];
    for (const image of images) {
      const buffer = Buffer.from(image.data_base64, "base64");
      try {
        const normalized = deps?.prepare ? await deps.prepare(buffer) : await normalizeImage(buffer);
        prepared.push(normalized.dataUrl);
      } catch (error) {
        if (error instanceof ImagePrepError) return errorBody(error.code);
        return errorBody("bad_image");
      }
    }
    try {
      const vision = deps.vision;
      const reads: Extraction[] = [];
      for (const dataUrl of prepared) {
        const read = await vision({
          dataUrl,
          instrumentHint: instrument,
          notes: notes.slice(0, 500),
        });
        visionModel = read.model;
        reads.push(read.extraction);
      }
      extraction = mergeExtractions(reads);
      if (extraction.patient_identifiers_seen || containsIdentifier(extraction.raw_ocr_text)) {
        extraction = { ...extraction, raw_ocr_text: "", patient_identifiers_seen: true };
        warningList.push({
          zh: "圖像入面可能有病人身份。已唔再將 OCR 文字傳去下一個模型。請裁走姓名、身份證號、住院號。今次圖像只用於呢個請求，沒有存檔，但已經傳送過 OpenRouter。",
          en: "The image may contain a patient identifier. OCR text was not sent to the next model. Crop names, identity numbers, and hospital numbers. The image was used for this request only and was not archived, but it was sent to OpenRouter.",
        });
      }
      if (!extraction.readable) {
        readable = false;
        warningList.push({
          zh: extraction.unread_reason || "圖像不清楚，沒有估造峰。",
          en: extraction.unread_reason || "The image was unclear. No peaks were invented.",
        });
      }
      if (table.length >= 2) {
        peaks = table;
        source = "pasted_table";
        readable = true;
        warningList.push({
          zh: "判讀採用貼上嘅數值表。圖像讀數只供對照，沒有覆蓋你輸入嘅百分比。",
          en: "The pasted numeric table is used for the interpretation. The image reading is kept for audit and does not replace your percentages.",
        });
      } else {
        peaks = extraction.peaks;
        source = "openrouter";
      }
    } catch (error) {
      if (error instanceof OpenRouterError) return errorBody(error.code === "bad_response" ? "provider" : error.code);
      return errorBody("provider");
    }
  } else if (table.length >= 1) {
    peaks = table;
    source = "pasted_table";
  } else if (demo) {
    extraction = fixtureExtraction(demo.id);
    peaks = extraction.peaks;
    source = "demo_fixture";
    warningList.push({
      zh: "用緊示範個案內置數值。未有圖像讀數。",
      en: "Using the built-in demo figures. No image was read.",
    });
  } else {
    return errorBody("bad_request");
  }

  const rule = interpretCase({
    rawPeaks: peaks,
    instrumentChoice: instrument === "auto" && demo ? (demo.instrument === "sebia_ce" ? "sebia" : "variant_ii") : instrument,
    instrumentGuess: extraction?.instrument_guess ?? (demo ? (demo.instrument === "sebia_ce" ? "sebia_ce" : "variant_ii") : null),
    notes,
    readable,
    quality: extraction?.quality_flags,
  });

  const template = renderNarrative(rule);
  let narrative = template;
  let narrativeSource: "template" | "openrouter" = "template";
  let textModel: string | null = null;
  if (deps?.complete && source !== "local") {
    try {
      const complete = deps.complete;
      const written = await complete({
        system: NARRATIVE_SYSTEM,
        user: JSON.stringify({
          rule: {
            most_likely: rule.most_likely,
            differentials: rule.differentials,
            pitfalls: rule.pitfalls.slice(0, 4),
            confirm: rule.confirm.slice(0, 4),
            instrument_used: rule.instrument_used,
            insufficient: rule.insufficient,
          },
          template,
        }),
      });
      if (written && !blockedNarrative(written.zh) && !blockedNarrative(written.en)) {
        narrative = { zh: written.zh, en: written.en };
        narrativeSource = "openrouter";
        textModel = written.model;
      } else if (written) {
        warningList.push({
          zh: "模型草稿用咗診斷式用語，已改回規則引擎嘅說明。",
          en: "A model draft used diagnostic wording and was replaced by the rule-engine note.",
        });
      }
    } catch {
      warningList.push({
        zh: "文字模型暫時用唔到，以下係規則引擎說明。",
        en: "The text model was unavailable. The note below is from the rule engine.",
      });
    }
  }

  return {
    ok: true,
    extraction_source: source,
    vision_attempted: visionAttempted,
    vision_model: visionModel,
    narrative_source: narrativeSource,
    text_model: textModel,
    extraction: extraction
      ? { ...extraction, raw_ocr_text: redactIdentifiers(extraction.raw_ocr_text).text }
      : null,
    rule,
    narrative_zh: narrative.zh,
    narrative_en: narrative.en,
    searches: buildSearchHits(rule.search_variant_ids),
    warnings: warningList,
    kb_version: kb.meta.version,
    sources: kb.meta.sources,
  };
}

function mergeExtractions(reads: Extraction[]): Extraction {
  if (reads.length === 1) return reads[0];
  const readable = reads.some((item) => item.readable);
  return {
    instrument_guess: reads.find((item) => item.instrument_guess !== "unknown")?.instrument_guess ?? "unknown",
    instrument_confidence: "low",
    readable,
    unread_reason: reads.map((item) => item.unread_reason).filter(Boolean).join(" "),
    peaks: reads.flatMap((item) => item.peaks),
    quality_flags: {
      cut_off: reads.some((item) => item.quality_flags.cut_off),
      overloaded: reads.some((item) => item.quality_flags.overloaded),
      baseline_drift: reads.some((item) => item.quality_flags.baseline_drift),
      overlapping_peaks: reads.some((item) => item.quality_flags.overlapping_peaks),
      poor_resolution: reads.some((item) => item.quality_flags.poor_resolution),
      missing_scale: reads.some((item) => item.quality_flags.missing_scale),
    },
    raw_ocr_text: reads.map((item) => item.raw_ocr_text).filter(Boolean).join("\n").slice(0, 4000),
    patient_identifiers_seen: reads.some((item) => item.patient_identifiers_seen),
  };
}

export async function runFollowUp(input: {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  rule: RuleResult | null;
}): Promise<
  | { ok: true; zh: string; en: string; searches: SearchHit[]; source: "template" | "openrouter" }
  | ReturnType<typeof errorBody>
> {
  const question = input.question.slice(0, 2000);
  if (containsIdentifier(question)) return errorBody("identifiers");
  const grounded = followUpFromRules(question, input.rule);
  return { ok: true, zh: grounded.zh, en: grounded.en, searches: grounded.searches, source: "template" };
}
