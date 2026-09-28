import demos from "@/data/demos.json";
import { kb } from "@/lib/kb";
import { errorBody } from "@/lib/errors";
import { coerceExtraction } from "@/lib/extraction";
import { ImagePrepError, normalizeImage } from "@/lib/image";
import { interpretCase } from "@/lib/interpret";
import { renderNarrative } from "@/lib/narrative";
import { OpenRouterError, hasOpenRouterKey, modelNames, openrouterChat, openrouterJson, parseModelJson } from "@/lib/openrouter";
import { CHAT_SYSTEM, NARRATIVE_SYSTEM, VISION_SYSTEM, visionUserText } from "@/lib/prompts";
import { redactIdentifiers, containsIdentifier } from "@/lib/redact";
import { EXTRACTION_SCHEMA, NARRATIVE_SCHEMA } from "@/lib/schema";
import { buildSearchHits } from "@/lib/search";
import { parsePeakTable } from "@/lib/table";
import type { Extraction, InstrumentChoice, InstrumentId, InterpretResponse, RawPeak, RuleResult, SearchHit } from "@/lib/types";
import { followUpFromRules, kbCardsForQuestion } from "@/lib/followup";

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
  deps?: { vision?: VisionFn; complete?: CompleteFn; prepare?: (buffer: Buffer) => Promise<{ dataUrl: string }> },
): Promise<InterpretResponse> {
  const notes = (input.notes ?? "").slice(0, 2000);
  if (containsIdentifier(notes)) return errorBody("identifiers");
  const instrument = input.instrument ?? "auto";
  const images = (input.images ?? []).slice(0, 3);
  const table = parsePeakTable(notes);
  const demo = demoById(input.demoId);
  const warningList: { zh: string; en: string }[] = [];
  let extraction: Extraction | null = null;
  let source: "openrouter" | "pasted_table" | "demo_fixture" = "pasted_table";
  let visionAttempted = false;
  let visionModel: string | null = null;
  let peaks: RawPeak[] = [];
  let readable = true;

  if (images.length && !hasOpenRouterKey() && !deps?.vision) {
    if (table.length >= 2) {
      peaks = table;
      source = "pasted_table";
      warningList.push({
        zh: "未設定 API 金鑰，圖像已略過。判讀用緊你貼上嘅峰表。",
        en: "No API key is set, so the image was skipped. The interpretation uses the pasted peak table.",
      });
    } else if (demo && DEMO_IDS.has(demo.id)) {
      extraction = fixtureExtraction(demo.id);
      peaks = extraction.peaks;
      source = "demo_fixture";
      warningList.push({
        zh: "未呼叫視覺模型（冇 API key）。以下用示範個案內置數值教學，不是讀圖結果。",
        en: "The vision model was not called (no API key). These are the built-in demo figures for teaching, not a reading of the image.",
      });
    } else {
      return errorBody("missing_key");
    }
  } else if (images.length) {
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
      const vision = deps?.vision ?? defaultVision;
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
  if (hasOpenRouterKey() || deps?.complete) {
    try {
      const complete = deps?.complete ?? defaultComplete;
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

async function defaultVision(args: { dataUrl: string; instrumentHint: string; notes: string }) {
  const { vision } = modelNames();
  const result = await openrouterJson({
    model: vision,
    temperature: 0,
    maxTokens: 1800,
    schema: EXTRACTION_SCHEMA,
    messages: [
      { role: "system", content: VISION_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: visionUserText(args.instrumentHint, args.notes) },
          { type: "image_url", image_url: { url: args.dataUrl } },
        ],
      },
    ],
  });
  const extraction = coerceExtraction(result.data);
  if (!extraction) throw new OpenRouterError("bad_response", "schema");
  return { extraction, model: result.model };
}

async function defaultComplete(args: { system: string; user: string }) {
  const { text } = modelNames();
  const result = await openrouterJson({
    model: text,
    temperature: 0.2,
    maxTokens: 1400,
    schema: NARRATIVE_SCHEMA,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });
  const data = result.data as { zh?: unknown; en?: unknown };
  if (typeof data.zh !== "string" || typeof data.en !== "string") return null;
  return { zh: data.zh, en: data.en, model: result.model };
}

const OFFLINE_ZH =
  "伺服器未載入 OPENROUTER_API_KEY。檔案入面有匙都唔算，要喺 hbpatterncheck 重新執行 npm run dev。以下不是模型回覆。";
const OFFLINE_EN =
  "This server did not load OPENROUTER_API_KEY. A key in the file does not count until you restart npm run dev inside hbpatterncheck. This is not a model reply.";

type FollowChat = (args: { system: string; user: string }) => Promise<{ content: string; model: string }>;

function usableReply(zh: string, en: string): boolean {
  return Boolean(zh.trim() && en.trim()) && !blockedNarrative(zh) && !blockedNarrative(en);
}

function splitBilingualReply(content: string): { zh: string; en: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const data = parseModelJson(trimmed) as { zh?: unknown; en?: unknown };
    if (typeof data.zh === "string" && typeof data.en === "string") {
      return { zh: data.zh.trim(), en: data.en.trim() };
    }
  } catch {
    /* plain text */
  }
  const labeled = trimmed.match(/^ZH\s*[:：]\s*([\s\S]*?)\n\s*EN\s*[:：]\s*([\s\S]*)$/i);
  if (labeled) return { zh: labeled[1].trim(), en: labeled[2].trim() };
  const clipped = trimmed.slice(0, 2000);
  return { zh: clipped, en: clipped };
}

function failureNote(error: unknown): { zh: string; en: string } {
  const code = error instanceof OpenRouterError ? error.code : "";
  if (code === "unauthorized") {
    return {
      zh: "模型呼叫失敗（金鑰被拒絕）。以下係離線知識庫。",
      en: "The model call failed (the key was rejected). Offline knowledge-base notes follow.",
    };
  }
  if (code === "rate_limit") {
    return {
      zh: "模型呼叫失敗（速率限制）。以下係離線知識庫。",
      en: "The model call failed (rate limit). Offline knowledge-base notes follow.",
    };
  }
  return {
    zh: "模型呼叫失敗。以下係離線知識庫，不是模型回覆。",
    en: "The model call failed. The notes below are the offline knowledge base, not a model reply.",
  };
}

export async function runFollowUp(
  input: {
    question: string;
    history?: { role: "user" | "assistant"; content: string }[];
    rule: RuleResult | null;
  },
  deps?: { complete?: CompleteFn; chat?: FollowChat },
): Promise<
  | { ok: true; zh: string; en: string; searches: SearchHit[]; source: "template" | "openrouter" }
  | ReturnType<typeof errorBody>
> {
  const question = input.question.slice(0, 2000);
  if (containsIdentifier(question)) return errorBody("identifiers");
  const grounded = followUpFromRules(question, input.rule);
  const offline = { ok: true as const, zh: `${OFFLINE_ZH}${grounded.zh}`, en: `${OFFLINE_EN} ${grounded.en}`, searches: grounded.searches, source: "template" as const };
  const canCall = hasOpenRouterKey() || Boolean(deps?.complete) || Boolean(deps?.chat);
  if (!canCall) return offline;

  const cards = kbCardsForQuestion(question, input.rule).slice(0, 3).map((card) => ({
    name_zh: card.name_zh,
    name_en: card.name_en,
    hplc_zh: card.hplc_zh,
    hplc_en: card.hplc_en,
    ce_zh: card.ce_zh,
    ce_en: card.ce_en,
  }));
  const userPayload = JSON.stringify({
    question,
    has_trace: Boolean(input.rule?.most_likely),
    grounding_zh: grounded.zh,
    grounding_en: grounded.en,
    knowledge_base: cards,
  });
  const history = (input.history ?? []).slice(-6).map((item) => ({
    role: item.role,
    content: item.content.slice(0, 1500),
  }));
  let lastError: unknown;

  const accept = (zh: string, en: string) =>
    usableReply(zh, en)
      ? { ok: true as const, zh, en, searches: grounded.searches, source: "openrouter" as const }
      : null;

  if (deps?.complete) {
    try {
      const written = await deps.complete({ system: CHAT_SYSTEM, user: userPayload });
      if (written) {
        const accepted = accept(written.zh, written.en);
        if (accepted) return accepted;
      }
    } catch (error) {
      lastError = error;
    }
  } else if (hasOpenRouterKey()) {
    try {
      const { text } = modelNames();
      const result = await openrouterJson({
        model: text,
        temperature: 0.2,
        maxTokens: 1200,
        schema: NARRATIVE_SCHEMA,
        messages: [
          { role: "system", content: CHAT_SYSTEM },
          ...history,
          { role: "user", content: userPayload },
        ],
      });
      const data = result.data as { zh?: unknown; en?: unknown };
      if (typeof data.zh === "string" && typeof data.en === "string") {
        const accepted = accept(data.zh, data.en);
        if (accepted) return accepted;
      }
    } catch (error) {
      lastError = error;
      if (error instanceof OpenRouterError && (error.code === "unauthorized" || error.code === "rate_limit" || error.code === "missing_key")) {
        const note = failureNote(error);
        return { ok: true, zh: `${note.zh}${grounded.zh}`, en: `${note.en} ${grounded.en}`, searches: grounded.searches, source: "template" };
      }
    }
  }

  if (deps?.chat || hasOpenRouterKey()) {
    try {
      const plainSystem = `${CHAT_SYSTEM}\nIf you cannot return JSON, reply exactly in this shape:\nZH: <Traditional Chinese>\nEN: <English>`;
      const plain = deps?.chat
        ? await deps.chat({ system: plainSystem, user: userPayload })
        : await openrouterChat({
            model: modelNames().text,
            temperature: 0.2,
            maxTokens: 1200,
            messages: [
              { role: "system", content: plainSystem },
              ...history,
              { role: "user", content: userPayload },
            ],
          });
      const parsed = splitBilingualReply(plain.content);
      if (parsed) {
        const accepted = accept(parsed.zh, parsed.en);
        if (accepted) return accepted;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const note = failureNote(lastError);
  return { ok: true, zh: `${note.zh}${grounded.zh}`, en: `${note.en} ${grounded.en}`, searches: grounded.searches, source: "template" };
}
