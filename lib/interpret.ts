import { cardsFor, kb, type Thresholds } from "@/lib/kb";
import { round1 } from "@/lib/parsers/common";
import { resolveInstrument } from "@/lib/parsers/detect";
import { normalizePeaks } from "@/lib/normalize";
import { FIT_NOTE, GENOTYPE_LIMIT, PATTERN_COPY, PATTERN_VARIANTS, type PatternId } from "@/lib/patterns";
import type {
  CanonicalPeak,
  Fit,
  InstrumentChoice,
  InstrumentId,
  PatternCall,
  QualityFlags,
  RawPeak,
  RuleResult,
} from "@/lib/types";

const EMPTY_QUALITY: QualityFlags = {
  cut_off: false,
  overloaded: false,
  baseline_drift: false,
  overlapping_peaks: false,
  poor_resolution: false,
  missing_scale: false,
};

export type CaseInput = {
  rawPeaks: RawPeak[];
  instrumentChoice: InstrumentChoice;
  instrumentGuess?: InstrumentId | null;
  notes?: string;
  readable?: boolean;
  quality?: Partial<QualityFlags>;
};

type Flags = {
  newborn: boolean;
  newbornNote: boolean;
  transfusion: boolean;
  iron: boolean;
  microcytosis: boolean;
  highF: boolean;
};

function fmt(value: number | null, locale: "zh" | "en"): string {
  if (value == null) return locale === "zh" ? "未見" : "not seen";
  return `${value.toFixed(1)}%`;
}

function total(peaks: CanonicalPeak[], pred: (peak: CanonicalPeak) => boolean): number | null {
  const matched = peaks.filter((peak) => peak.percent != null && pred(peak));
  if (!matched.length) return null;
  return round1(matched.reduce((sum, peak) => sum + (peak.percent as number), 0));
}

export function readContext(notes: string, fetal: number | null, thresholds: Thresholds): Flags {
  const newbornNote = /newborn|neonat|cord\s*blood|臍帶|新生/i.test(notes);
  const transfusion =
    /transfus|輸血/i.test(notes) &&
    !/no recent transfusion|without transfusion|無近期輸血|沒有輸血|未有輸血/i.test(notes);
  const iron =
    !/no iron deficiency|without iron deficiency|無缺鐵|沒有缺鐵|鐵質正常/i.test(notes) &&
    /iron\s*deficien|low ferritin|缺鐵|鐵蛋白\s*(?:低|低於|<)/i.test(notes);
  const mcv = notes.match(/MCV\s*[<＜]?\s*(\d{2,3}(?:\.\d+)?)/i);
  const microcytosis = mcv ? Number(mcv[1]) < 80 : /microcyt|小球/i.test(notes);
  const highF = fetal != null && fetal >= thresholds.f_newborn_min;
  return {
    newborn: newbornNote || highF,
    newbornNote,
    transfusion,
    iron,
    microcytosis,
    highF,
  };
}

function call(id: PatternId, fit: Fit, whyZh: string, whyEn: string): PatternCall {
  const title = PATTERN_COPY[id];
  return {
    id,
    title_zh: title.title_zh,
    title_en: title.title_en,
    fit,
    why_zh: whyZh,
    why_en: whyEn,
  };
}

type Bucket = {
  ranked: PatternCall[];
  add: (id: PatternId, fit: Fit, whyZh: string, whyEn: string) => void;
  has: (...ids: PatternId[]) => boolean;
};

function bucket(): Bucket {
  const ranked: PatternCall[] = [];
  return {
    ranked,
    add(id, fit, whyZh, whyEn) {
      if (ranked.some((item) => item.id === id)) return;
      ranked.push(call(id, fit, whyZh, whyEn));
    },
    has(...ids) {
      return ranked.some((item) => ids.includes(item.id as PatternId));
    },
  };
}

function insufficient(messageZh: string, messageEn: string, instrument: InstrumentId, flags: string[]): RuleResult {
  return {
    instrument_used: instrument,
    insufficient: true,
    insufficient_zh: messageZh,
    insufficient_en: messageEn,
    context_flags: flags,
    peaks: [],
    most_likely: null,
    differentials: [],
    pitfalls: [GENOTYPE_LIMIT],
    confirm: [
      {
        zh: "請貼上報表嘅峰名同百分比，或上傳一張睇得清數值嘅裁片。唔好靠估。",
        en: "Paste the peak names and percentages from the printout, or upload a crop where the numbers are legible. Do not guess.",
      },
    ],
    co_migrating: [],
    search_variant_ids: [],
    kb_version: kb.meta.version,
    fit_note_zh: FIT_NOTE.low.zh,
    fit_note_en: FIT_NOTE.low.en,
  };
}

export function interpretCase(input: CaseInput): RuleResult {
  const notes = input.notes ?? "";
  const quality = { ...EMPTY_QUALITY, ...input.quality };
  const readable = input.readable !== false;
  const preliminary = normalizePeaks(input.rawPeaks, input.instrumentChoice === "sebia" ? "sebia_ce" : "variant_ii");
  const instrument = resolveInstrument(input.instrumentChoice, input.instrumentGuess ?? null, preliminary);
  const peaks = normalizePeaks(input.rawPeaks, instrument === "unknown" ? "variant_ii" : instrument);
  const thresholds = kb.thresholds;
  const fetalPreview = total(peaks, (peak) => peak.kind === "F");
  const flags = readContext(notes, fetalPreview, thresholds);
  const flagNames = (Object.entries(flags) as [string, boolean][])
    .filter(([, on]) => on)
    .map(([name]) => name);

  if (!readable) {
    return insufficient(
      "圖像未能可靠讀出峰。請俾一張更清楚嘅裁片，或者貼上列印報表嘅數值表。",
      "The image could not be read reliably. Send a clearer crop or paste the numeric table from the printout.",
      instrument,
      flagNames,
    );
  }
  if (!peaks.some((peak) => peak.percent != null)) {
    return insufficient(
      "冇見到任何百分比。請貼上峰表，系統不會估造峰。",
      "No percentages were found. Paste the peak table. Peaks are not invented.",
      instrument,
      flagNames,
    );
  }

  const A = total(peaks, (peak) => peak.kind === "A");
  const F = total(peaks, (peak) => peak.kind === "F");
  const H = total(peaks, (peak) => peak.kind === "H");
  const barts = total(peaks, (peak) => peak.kind === "BARTS");
  const ePct = total(peaks, (peak) => peak.kind === "E");
  const a2Separate = total(peaks, (peak) => peak.kind === "A2");
  const a2Window = total(peaks, (peak) => peak.window === "A2" && peak.kind !== "A");
  const a2 = instrument === "sebia_ce" ? a2Separate : (a2Window ?? a2Separate);
  const separateE = instrument === "sebia_ce" ? ePct : null;
  const sLabeled = peaks.some((peak) => peak.label_kind === "S");
  const sPct = total(
    peaks,
    (peak) => peak.label_kind === "S" || peak.kind === "S" || (peak.label_kind !== "Q" && (peak.window === "S" || peak.zone === "Z5")),
  );
  const qPct = total(peaks, (peak) => peak.kind === "Q");
  const cPct = total(
    peaks,
    (peak) =>
      peak.kind === "C" ||
      (peak.window === "C" && peak.kind !== "SLOW_MINOR" && peak.kind !== "CS" && (peak.percent ?? 0) > thresholds.small_slow_max),
  );
  const cLabeled = peaks.some((peak) => peak.label_kind === "C");
  const dPct = total(peaks, (peak) => peak.kind === "D" || (peak.kind === "UNKNOWN" && (peak.window === "D" || peak.zone === "Z6")));
  const csPct = total(peaks, (peak) => peak.kind === "CS" || peak.kind === "SLOW_MINOR");
  const csLabeled = peaks.some((peak) => peak.label_kind === "CS" || peak.kind === "CS");
  const p2 = total(peaks, (peak) => peak.kind === "P2");
  const p3 = total(peaks, (peak) => peak.kind === "P3");
  const hope = total(peaks, (peak) => peak.kind === "HOPE");
  const jay = total(peaks, (peak) => peak.kind === "J");
  const leporeLabeled = peaks.some((peak) => peak.label_kind === "LEPORE");
  const oArabLabeled = peaks.some((peak) => peak.label_kind === "O_ARAB");
  const earlyUnknown = total(peaks, (peak) => peak.window === "VOID" && peak.kind === "UNKNOWN");
  const percentSum = total(peaks, () => true);
  const hPresent = H != null && H >= thresholds.h_min;
  const eInferred = peaks.some((peak) => peak.kind === "E" && peak.inferred);
  const qualityBad =
    quality.cut_off ||
    quality.overloaded ||
    quality.baseline_drift ||
    quality.overlapping_peaks ||
    quality.poor_resolution ||
    quality.missing_scale ||
    (percentSum != null && (percentSum < thresholds.percent_sum_low || percentSum > thresholds.percent_sum_high));

  const bag = bucket();
  const fit = (preferred: Fit): Fit => (qualityBad ? "low" : preferred);

  if (flags.newborn) {
    if ((barts ?? 0) >= thresholds.h_min) {
      bag.add(
        "newborn_barts",
        fit("moderate"),
        `見到 Hb Bart's ${fmt(barts, "zh")}。新生兒或臍帶血先至用呢個模式；百分比同缺失咗幾多個 α 基因嘅關係視實驗室切點而定。`,
        `Hb Bart's is ${fmt(barts, "en")}. Use this pattern for a newborn or cord blood; how the percentage maps to deleted α genes depends on the local cut-off.`,
      );
    }
    bag.add(
      "newborn_limited",
      fit(flags.highF ? "moderate" : "low"),
      `Hb F ${fmt(F, "zh")}。${flags.newbornNote ? "備註話係新生兒或臍帶血。" : "F 比例已經高過成人範圍。"}成人 β-地貧嘅 A2 切點（大約 ${thresholds.a2_beta_min}%）不適用。而家嘅 A2 係 ${fmt(a2, "zh")}。`,
      `Hb F is ${fmt(F, "en")}. ${flags.newbornNote ? "The note says newborn or cord blood." : "The F fraction is already above the adult range."} The adult β-thalassaemia A2 cut-off (about ${thresholds.a2_beta_min}%) does not apply. A2 on this trace is ${fmt(a2, "en")}.`,
    );
    if (hPresent) {
      bag.add(
        "hb_h",
        "low",
        `同時見到 Hb H ${fmt(H, "zh")}。新生兒通常以 Bart's 為主，成人 Hb H 病嘅判讀要核對年齡。`,
        `Hb H is also ${fmt(H, "en")}. Newborns usually show Bart's; an adult Hb H pattern needs the age checked.`,
      );
    }
  } else {
    if (flags.transfusion) {
      bag.add(
        "transfusion_confounded",
        "low",
        "備註提到輸血。供血者嘅血紅蛋白會混入圖譜，所以下面嘅模式只描述呢張圖，不能推出病人基因型。",
        "The note mentions transfusion. Donor haemoglobin mixes into the trace, so any pattern below describes the picture only and cannot be turned into the patient's genotype.",
      );
    }

    const structuralBefore = () =>
      bag.has(
        "hb_h_cs_like",
        "hb_h",
        "hb_e_trait",
        "hb_ee",
        "hb_e_beta",
        "hb_s_trait",
        "hb_s_disease",
        "hb_s_beta_plus",
        "hb_c_trait",
        "hb_c_disease",
        "c_window_variant",
        "q_thailand",
        "complex_pattern",
      );

    if (hPresent && (ePct ?? 0) >= 10 && (sPct ?? 0) >= 10) {
      bag.add(
        "complex_pattern",
        "low",
        "同一張圖有多過一種主要異常分畫。複合型（例如 EA Bart's、S 複合雜合）不能靠規則排名命名。",
        "More than one major abnormal fraction is present. Compound patterns (for example EA Bart's or a compound sickle genotype) cannot be named by this ranking.",
      );
    }

    if (hPresent && csPct != null && csPct >= thresholds.cs_min && csPct <= thresholds.cs_max) {
      bag.add(
        "hb_h_cs_like",
        fit(csLabeled ? "moderate" : "low"),
        `Hb H ${fmt(H, "zh")}，A2 ${fmt(a2, "zh")}，另有慢區細峰 ${fmt(csPct, "zh")}${csLabeled ? "（報表有 CS 字樣）" : "（未標明係 Constant Spring）"}。東南亞成人呢個組合要優先確認 Hb H／Constant Spring，同時保留缺失型 Hb H 病加一條無特異性雜峰。細峰可以係降解血紅蛋白。`,
        `Hb H ${fmt(H, "en")}, A2 ${fmt(a2, "en")}, plus a slow minor peak ${fmt(csPct, "en")}${csLabeled ? " (the printout says CS)" : " (not labelled Constant Spring)"}. In a Southeast Asian adult this is the pattern that should trigger confirmation of Hb H/Constant Spring, while deletional Hb H disease plus a nonspecific peak stays on the list. The small peak can be degraded haemoglobin.`,
      );
    } else if (hPresent) {
      bag.add(
        "hb_h",
        fit(peaks.some((peak) => peak.label_kind === "H") ? "moderate" : "low"),
        `Hb H ${fmt(H, "zh")}，A2 ${fmt(a2, "zh")}。模式符合 Hb H 病，但 HPLC 往往低估 H，電泳 zone 亦視軟件而定。缺失型同非缺失型（包括 CS）在呢張圖分唔開，尤其係見唔到細峰。`,
        `Hb H ${fmt(H, "en")}, A2 ${fmt(a2, "en")}. The picture fits Hb H disease, but HPLC often underestimates H and the CE zone depends on the software. Deletional and non-deletional disease (including CS) are not separated here, especially if no minor peak is seen.`,
      );
    }

    if (leporeLabeled) {
      bag.add(
        "hb_lepore_labeled",
        fit("moderate"),
        "報表已經標示 Hb Lepore。百分比同真正 A2 在 HPLC 常常疊在一起，仍然要用第二種方法同分子結果核對。",
        "The printout already says Hb Lepore. On HPLC its percentage often shares the A2 window with true A2. A second method and a molecular result are still required.",
      );
    }
    if (oArabLabeled) {
      bag.add(
        "hb_o_arab_labeled",
        fit("moderate"),
        "報表標示 Hb O-Arab。佢同 Hb C 在好多 HPLC 程式共流出，請用電泳或 DNA 核對標籤。",
        "The printout says Hb O-Arab. It co-elutes with Hb C on many HPLC programs, so check the label with electrophoresis or DNA.",
      );
    }

    if (instrument === "sebia_ce" && separateE != null && separateE >= 10) {
      const eFit = fit(eInferred ? "low" : "moderate");
      if (separateE >= thresholds.ee_min && (A ?? 0) < 12 && (F ?? 0) < 10) {
        bag.add(
          "hb_ee",
          eFit,
          `毛細管電泳將 E 同 A2 分開：E ${fmt(separateE, "zh")}，A2 ${fmt(a2, "zh")}，A ${fmt(A, "zh")}，F ${fmt(F, "zh")}。高比例 E 而幾乎冇 A，似 Hb EE，但仍要同 E/β0 對照 CBC。`,
          `CE separates E from A2: E ${fmt(separateE, "en")}, A2 ${fmt(a2, "en")}, A ${fmt(A, "en")}, F ${fmt(F, "en")}. A dominant E fraction with almost no A fits Hb EE, but the CBC is still needed before anyone leans away from E/β0.`,
        );
      } else if (
        separateE >= thresholds.e_beta_min &&
        separateE < thresholds.ee_min &&
        ((F ?? 0) >= thresholds.f_e_beta_min || (A ?? 100) < 40)
      ) {
        bag.add(
          "hb_e_beta",
          eFit,
          `E ${fmt(separateE, "zh")}，F ${fmt(F, "zh")}，A ${fmt(A, "zh")}，A2 ${fmt(a2, "zh")}。E 同 A2 已分開。F 升高或 A 偏低時要將 Hb E／β-地貧放在 EE 前面，但百分比重疊。`,
          `E ${fmt(separateE, "en")}, F ${fmt(F, "en")}, A ${fmt(A, "en")}, A2 ${fmt(a2, "en")}. E is already separated from A2. Raised F or a low A puts Hb E/β-thalassaemia ahead of EE, but the percentages overlap.`,
        );
      } else if (separateE >= thresholds.e_trait_min && separateE <= thresholds.e_trait_max && (A ?? 0) >= 45) {
        bag.add(
          "hb_e_trait",
          (F ?? 0) >= thresholds.f_e_beta_min ? "low" : eFit,
          `E ${fmt(separateE, "zh")} 同 A2 ${fmt(a2, "zh")} 已分開，A ${fmt(A, "zh")} 仍係主峰。呢個係 Capillarys 上嘅 Hb E trait 教學模式，不是 A2 升高。`,
          `E ${fmt(separateE, "en")} is separated from A2 ${fmt(a2, "en")}, and A ${fmt(A, "en")} is still the main peak. This is the Capillarys teaching pattern of Hb E trait, not a raised A2.`,
        );
      }
    } else if (instrument !== "sebia_ce" && a2 != null && a2 >= thresholds.e_trait_min) {
      if (a2 >= thresholds.ee_min && (A ?? 0) < 12 && (F ?? 0) < 10) {
        bag.add(
          "hb_ee",
          fit("moderate"),
          `A2 窗 ${fmt(a2, "zh")}，A ${fmt(A, "zh")}，F ${fmt(F, "zh")}。在 Variant II，Hb E 同 A2 共流出。呢個比例似 Hb EE，鑑別係 F 不高嘅 E/β0。`,
          `A2 window ${fmt(a2, "en")}, A ${fmt(A, "en")}, F ${fmt(F, "en")}. On Variant II, Hb E co-elutes with A2. This proportion fits Hb EE, with E/β0 that does not raise F much as the differential.`,
        );
      } else if (a2 >= thresholds.ee_min && (F ?? 0) >= 10) {
        bag.add(
          "hb_e_beta",
          "low",
          `A2 窗 ${fmt(a2, "zh")} 同時 F ${fmt(F, "zh")}。高 E 加明顯 F 時，E/β-地貧同 EE 都會出現，呢張圖分唔開。`,
          `A2 window ${fmt(a2, "en")} with F ${fmt(F, "en")}. Dominant E plus a clearly raised F can be either E/β-thalassaemia or EE. This trace does not separate them.`,
        );
      } else if (
        a2 >= thresholds.e_beta_min &&
        a2 < thresholds.ee_min &&
        ((F ?? 0) >= thresholds.f_e_beta_min || (A ?? 0) < 40)
      ) {
        bag.add(
          "hb_e_beta",
          fit((F ?? 0) >= thresholds.f_e_beta_min ? "moderate" : "low"),
          `A2 窗 ${fmt(a2, "zh")}，F ${fmt(F, "zh")}，A ${fmt(A, "zh")}。E 同 A2 在 HPLC 分唔開。呢個範圍加高 F 或低 A，教學上優先考慮 Hb E／β-地貧，而不是單純 β-地貧特質。`,
          `A2 window ${fmt(a2, "en")}, F ${fmt(F, "en")}, A ${fmt(A, "en")}. HPLC does not separate E from A2. This range plus raised F or low A is the teaching pattern of Hb E/β-thalassaemia, not plain β-thalassaemia trait.`,
        );
      } else if (a2 >= thresholds.e_trait_min && a2 <= thresholds.e_trait_max) {
        bag.add(
          "hb_e_trait",
          fit((A ?? 0) >= 45 && (F ?? 0) < thresholds.f_e_beta_min ? "moderate" : "low"),
          `A2 窗 ${fmt(a2, "zh")}，A ${fmt(A, "zh")}，F ${fmt(F, "zh")}。這不是超高 A2 嘅 β-地貧。Variant II β-地貧短程式上 Hb E 同 A2 共流出；大約 ${thresholds.e_trait_min}–${thresholds.e_trait_max}% 而 A 仍係主峰，係 Hb E trait 嘅教學範圍。`,
          `A2 window ${fmt(a2, "en")}, A ${fmt(A, "en")}, F ${fmt(F, "en")}. This is not β-thalassaemia with a very high A2. On the Variant II β-thal short program Hb E co-elutes with A2; about ${thresholds.e_trait_min}–${thresholds.e_trait_max}% with A still dominant is the teaching range for Hb E trait.`,
        );
        bag.add(
          "hb_e_beta",
          "low",
          `F 只有 ${fmt(F, "zh")}，所以典型 E／β-地貧（通常 F 更高、Hb 更低）不是首選，但百分比同臨床有重疊，不能用呢張圖排除。`,
          `F is only ${fmt(F, "en")}, so typical E/β-thalassaemia (usually a higher F and a lower Hb) is not the first fit, but the ranges overlap and this trace cannot exclude it.`,
        );
      } else if (a2 > thresholds.a2_beta_typical_max && a2 < thresholds.e_trait_min) {
        bag.add(
          "a2_window_indeterminate",
          "low",
          `A2 窗 ${fmt(a2, "zh")}，高過 β-地貧特質常見上限（約 ${thresholds.a2_beta_typical_max}%），又未到 Hb E trait 常見範圍（約 ${thresholds.e_trait_min}% 起）。要考慮 Lepore、輸血後嘅 E、積分問題，或者其他 A2 窗變異。`,
          `A2 window ${fmt(a2, "en")} is above the usual β-trait ceiling (about ${thresholds.a2_beta_typical_max}%) and below the usual Hb E trait range (from about ${thresholds.e_trait_min}%). Consider Lepore, a transfused E pattern, an integration problem, or another A2-window variant.`,
        );
      }
    } else if (instrument === "sebia_ce" && a2 != null && a2 >= 10 && separateE == null) {
      bag.add(
        "a2_window_indeterminate",
        "low",
        `毛細管電泳上標成 A2 嘅峰有 ${fmt(a2, "zh")}，但冇獨立 E 峰。真正 A2 很少去到呢個水平，因為 E 通常會分到另一區。請核對 zone，唔好當佢係 β-地貧特質。`,
        `A peak labelled A2 on CE is ${fmt(a2, "en")} and there is no separate E peak. True A2 rarely reaches this level, because E usually moves to its own zone. Check the zone assignment. Do not call β-thalassaemia trait.`,
      );
    }

    if ((qPct ?? 0) >= 10) {
      bag.add(
        "q_thailand",
        fit("moderate"),
        `峰標成 Hb Q 或 Q-Thailand，約 ${fmt(qPct, "zh")}。佢常常企喺 S 窗，溶解度試驗係陰性。如果 CBC 似 Hb H 病，要一併考慮 Hb QH。`,
        `A peak is labelled Hb Q or Q-Thailand at about ${fmt(qPct, "en")}. It often sits in the S window and the solubility test is negative. If the CBC looks like Hb H disease, consider Hb QH as well.`,
      );
    } else if (sLabeled && sPct != null) {
      if ((A ?? 0) < 8 && sPct >= thresholds.s_disease_min) {
        bag.add(
          "hb_s_disease",
          fit("moderate"),
          `Hb S ${fmt(sPct, "zh")}，A ${fmt(A, "zh")}，F ${fmt(F, "zh")}，A2 ${fmt(a2, "zh")}。幾乎冇 A 嘅 S 主峰可以係 SS 或 S/β0，呢張圖分唔開。A2 輕微升高在呢個模式常見，不要另判一個單純 β-地貧特質。`,
          `Hb S ${fmt(sPct, "en")}, A ${fmt(A, "en")}, F ${fmt(F, "en")}, A2 ${fmt(a2, "en")}. An S-dominant trace with almost no A can be SS or S/β0; this picture does not separate them. A mildly raised A2 is common here and is not a separate simple β-thalassaemia trait call.`,
        );
      } else if ((A ?? 0) > 0 && sPct > (A ?? 0) && (a2 ?? 0) >= thresholds.a2_beta_min) {
        bag.add(
          "hb_s_beta_plus",
          fit("low"),
          `S ${fmt(sPct, "zh")} 多過 A ${fmt(A, "zh")}，A2 ${fmt(a2, "zh")}。呢個組合要考慮 S/β+，亦要排除輸血。`,
          `S ${fmt(sPct, "en")} is greater than A ${fmt(A, "en")}, with A2 ${fmt(a2, "en")}. That combination raises S/β+, and transfusion still has to be excluded.`,
        );
      } else if (sPct >= thresholds.s_trait_min && sPct <= thresholds.s_trait_max && (A == null || A > sPct)) {
        bag.add(
          "hb_s_trait",
          fit("moderate"),
          `Hb S ${fmt(sPct, "zh")}，A ${fmt(A, "zh")} 更多，A2 ${fmt(a2, "zh")}。百分比似 Hb S trait。S 窗亦可以係 Hb Q-Thailand，尤其係未做溶解度試驗。`,
          `Hb S ${fmt(sPct, "en")}, with more A ${fmt(A, "en")} and A2 ${fmt(a2, "en")}. The percentages fit Hb S trait. The S window can also be Hb Q-Thailand, particularly if a solubility test has not been done.`,
        );
        if ((a2 ?? 0) >= thresholds.a2_beta_min) {
          bag.add(
            "beta_thal_trait",
            "low",
            `A2 亦有 ${fmt(a2, "zh")}，高過一般 AS 常見範圍。可以係同時有 β-地貧，亦可以係積分問題，不要單獨當佢係普通 β-地貧特質報告。`,
            `A2 is also ${fmt(a2, "en")}, above the usual AS range. Co-inherited β-thalassaemia is possible, and so is an integration issue. Do not report this as ordinary β-thalassaemia trait on its own.`,
          );
        }
      }
    } else if ((sPct ?? 0) >= 10 && !sLabeled) {
      bag.add(
        "s_window_unlabeled",
        "low",
        `S 窗或相應 zone 有 ${fmt(sPct, "zh")}，但報表冇寫 Hb S。在東南亞要同時考慮 Hb S 同 Hb Q-Thailand。窗名不是診斷。`,
        `The S window or matching zone has ${fmt(sPct, "en")}, but the printout does not say Hb S. In Southeast Asia consider both Hb S and Hb Q-Thailand. The window name is not a diagnosis.`,
      );
    }

    if (cPct != null && cPct >= thresholds.c_disease_min) {
      bag.add(
        "hb_c_disease",
        fit(cLabeled ? "moderate" : "low"),
        `C 窗／慢區 ${fmt(cPct, "zh")} 係主峰。可以係 Hb CC 或其他 C 窗變異（包括 O-Arab）嘅純合或複合狀態。`,
        `The C window or slow zone is the main peak at ${fmt(cPct, "en")}. That can be Hb CC or another C-window variant (including O-Arab) in a homozygous or compound state.`,
      );
    } else if (cPct != null && cPct >= thresholds.c_trait_min && cPct <= thresholds.c_trait_max + 8) {
      if (cLabeled || (instrument === "sebia_ce" && peaks.some((peak) => peak.kind === "C"))) {
        bag.add(
          "hb_c_trait",
          fit(cLabeled && !peaks.some((peak) => peak.kind === "C" && peak.inferred) ? "moderate" : "low"),
          `慢區／C 峰 ${fmt(cPct, "zh")}，A ${fmt(A, "zh")}。百分比似 Hb C trait。如果只係 zone 推斷而報表冇寫 Hb C，請對照本地 zone 圖例同 Hb O-Arab。`,
          `Slow-zone or C peak ${fmt(cPct, "en")}, A ${fmt(A, "en")}. The percentage fits Hb C trait. If this was inferred from a zone and the printout does not say Hb C, check the local zone legend and Hb O-Arab.`,
        );
      } else {
        bag.add(
          "c_window_variant",
          "low",
          `C 窗有 ${fmt(cPct, "zh")} 但未命名。Hb C 同 Hb O-Arab 都要保留。低過 ${thresholds.small_slow_max}% 先至考慮 Constant Spring，呢個百分比不是細峰。`,
          `The C window has ${fmt(cPct, "en")} without a name. Keep both Hb C and Hb O-Arab. Constant Spring is the consideration below ${thresholds.small_slow_max}%, and this is not that small peak.`,
        );
      }
    }

    if (dPct != null && dPct >= thresholds.d_trait_min && dPct <= thresholds.d_trait_max + 10) {
      bag.add(
        "hb_d_trait",
        fit(peaks.some((peak) => peak.label_kind === "D") ? "moderate" : "low"),
        `D 窗或相應 zone ${fmt(dPct, "zh")}。Hb D-Punjab 係常見命名，但 G-Philadelphia、Lepore 等可以靠近。溶解度試驗陰性只表示佢不像 S。`,
        `D window or matching zone ${fmt(dPct, "en")}. Hb D-Punjab is the usual name, but G-Philadelphia, Lepore, and others can sit nearby. A negative solubility test only means it does not behave like S.`,
      );
    }

    if ((hope ?? 0) >= 10 || (jay ?? 0) >= 10 || (p2 ?? 0) >= thresholds.fast_window_min || (p3 ?? 0) >= thresholds.fast_window_min) {
      bag.add(
        "fast_variant",
        "low",
        `有一個偏大嘅早期或向陽極峰（P2 ${fmt(p2, "zh")}，P3 ${fmt(p3, "zh")}，Hope/J 標示 ${fmt(hope ?? jay, "zh")}）。幾個百分點嘅 P2 只係糖化；大幅 P2 先至考慮 Hb Hope 等。成人大幅快峰考慮 Hb J，不要叫成 Bart's。`,
        `There is a large early or anodic peak (P2 ${fmt(p2, "en")}, P3 ${fmt(p3, "en")}, Hope/J label ${fmt(hope ?? jay, "en")}). A P2 of a few percent is glycation; a large P2 is when Hb Hope and similar variants enter the list. A large fast peak in an adult suggests Hb J, not Bart's.`,
      );
    } else if ((earlyUnknown ?? 0) >= thresholds.h_min && !hPresent && (a2 == null || a2 < thresholds.a2_typical_low + 0.6)) {
      bag.add(
        "fast_variant",
        "low",
        `HPLC 很早位置有未命名峰 ${fmt(earlyUnknown, "zh")}，A2 ${fmt(a2, "zh")}。Hb H 同 Bart's 要列入鑑別，但未標名就不要報成 Hb H 病。Variant II 常常低估或唔積分 H。`,
        `An unnamed very early HPLC peak is ${fmt(earlyUnknown, "en")}, with A2 ${fmt(a2, "en")}. Keep Hb H and Bart's on the list, but do not report Hb H disease without a label. Variant II often underestimates or fails to integrate H.`,
      );
    }

    if (!hPresent && !structuralBefore() && !bag.has("a2_window_indeterminate", "hb_lepore_labeled")) {
      if (a2 != null && a2 >= thresholds.a2_beta_min && a2 <= thresholds.a2_beta_typical_max) {
        bag.add(
          "beta_thal_trait",
          fit((A ?? 0) >= 70 && (F ?? 0) < thresholds.f_raised_min ? "moderate" : "low"),
          `A2 ${fmt(a2, "zh")}，F ${fmt(F, "zh")}，A ${fmt(A, "zh")}。A2 高過常見成人上限而處於大約 ${thresholds.a2_beta_min}–${thresholds.a2_beta_typical_max}% 嘅 β-地貧特質教學範圍。在香港呢個模式最常見係 β-地貧特質，不是基因型。`,
          `A2 ${fmt(a2, "en")}, F ${fmt(F, "en")}, A ${fmt(A, "en")}. A2 is above the usual adult upper limit and inside the about ${thresholds.a2_beta_min}–${thresholds.a2_beta_typical_max}% teaching range for β-thalassaemia trait. In Hong Kong this pattern is most often β-thalassaemia trait. It is not a genotype.`,
        );
      } else if (a2 != null && a2 >= thresholds.a2_borderline_low && a2 <= thresholds.a2_borderline_high) {
        bag.add(
          "a2_borderline",
          "low",
          `A2 ${fmt(a2, "zh")} 處於大約 ${thresholds.a2_borderline_low}–${thresholds.a2_borderline_high}% 灰區。缺鐵可以將真正嘅 β-地貧特質拉低到呢度，所以而家不能叫特質，亦不能排除。`,
          `A2 ${fmt(a2, "en")} sits in the about ${thresholds.a2_borderline_low}–${thresholds.a2_borderline_high}% grey zone. Iron deficiency can pull a true β-thalassaemia trait down into this band, so trait should neither be called nor excluded now.`,
        );
      }
    }

    if (
      !flags.newborn &&
      (F ?? 0) >= thresholds.f_raised_min &&
      (F ?? 0) < thresholds.f_newborn_min &&
      (a2 == null || a2 <= thresholds.a2_typical_high) &&
      !structuralBefore() &&
      !bag.has("beta_thal_trait")
    ) {
      bag.add(
        "delta_beta_or_hpfh",
        "low",
        `F ${fmt(F, "zh")} 而 A2 ${fmt(a2, "zh")} 不高。δβ-地貧同 HPFH 都要放喺名單，懷孕、骨髓壓力、藥物亦會升高 F。HPLC 睇唔到 F 係全細胞定異細胞分佈。`,
        `F is ${fmt(F, "en")} and A2 ${fmt(a2, "en")} is not raised. Keep both δβ-thalassaemia and HPFH, plus pregnancy, marrow stress, and drugs that raise F. HPLC cannot show whether F is pancellular or heterocellular.`,
      );
    }

    if (!bag.has("hb_constant_spring", "hb_h_cs_like") && csPct != null && csPct >= thresholds.cs_min && csPct <= thresholds.cs_max && !hPresent) {
      const big = bag.has(
        "hb_e_trait",
        "hb_ee",
        "hb_e_beta",
        "hb_s_trait",
        "hb_c_trait",
        "beta_thal_trait",
      );
      if (!big || csLabeled) {
        bag.add(
          "hb_constant_spring",
          csLabeled ? fit("low") : "low",
          `慢區細峰 ${fmt(csPct, "zh")}。Constant Spring 可以係咁樣，而且百分比會低估；降解血紅蛋白同雜訊亦可以。沒有 Hb H 時不要升級做 Hb H／CS 病。`,
          `Slow minor peak ${fmt(csPct, "en")}. Constant Spring can look like this, and the percentage underestimates it; so can degraded haemoglobin and noise. Without Hb H, do not upgrade this to Hb H/CS disease.`,
        );
      }
    }

    const unexplained = peaks.filter((peak) => {
      if ((peak.percent ?? 0) < thresholds.unknown_report_min || peak.kind !== "UNKNOWN") return false;
      if (peak.window === "S" && bag.has("s_window_unlabeled", "hb_s_trait", "hb_s_disease")) return false;
      if (peak.window === "C" && bag.has("c_window_variant", "hb_c_trait", "hb_constant_spring")) return false;
      if (peak.window === "D" && bag.has("hb_d_trait")) return false;
      if (peak.window === "A2" && bag.has("beta_thal_trait", "hb_e_trait", "hb_ee", "hb_e_beta", "a2_window_indeterminate", "a2_borderline")) {
        return false;
      }
      return true;
    });
    if (unexplained.length && !structuralBefore()) {
      const described = unexplained
        .map((peak) => `${peak.label} ${fmt(peak.percent, "en")} ${peak.window ?? peak.zone ?? ""}`.trim())
        .join("; ");
      bag.add(
        "unidentified_variant",
        "low",
        `有未能歸入常見模式嘅峰：${described}。請用知識庫同一窗嘅變異做搜尋起點，不要直接命名。`,
        `Peaks that do not fit a common pattern: ${described}. Use same-window variants in the knowledge base as a search starting point, and do not name the peak outright.`,
      );
    }

    const explained = bag.ranked.some((item) => item.id !== "transfusion_confounded");
    if (!explained) {
      const a2Typical =
        a2 != null && a2 >= thresholds.a2_typical_low && a2 <= thresholds.a2_typical_high;
      if (A != null && A >= 80 && a2Typical && (F == null || F < thresholds.f_raised_min)) {
        if (flags.microcytosis) {
          bag.add(
            "alpha_suggestive_only",
            "low",
            `層析／電泳未見明顯異常分畫（A ${fmt(A, "zh")}，A2 ${fmt(a2, "zh")}，F ${fmt(F, "zh")}），但備註有小球症（MCV 或相關描述）。α-地貧特質通常正是一張正常圖，所以不能靠呢張圖證實，亦不能排除。β-地貧特質則不太似，因為 A2 未升高。`,
            `No clear abnormal fraction (A ${fmt(A, "en")}, A2 ${fmt(a2, "en")}, F ${fmt(F, "en")}), but the note describes microcytosis. α-thalassaemia trait usually is a normal trace, so this picture can neither prove it nor exclude it. β-thalassaemia trait is unlikely while A2 is not raised.`,
          );
        } else {
          bag.add(
            "normal_pattern",
            fit("moderate"),
            `A ${fmt(A, "zh")}，A2 ${fmt(a2, "zh")}，F ${fmt(F, "zh")}，未見需要點名嘅異常分畫。正常圖不能排除 α-地貧特質。`,
            `A ${fmt(A, "en")}, A2 ${fmt(a2, "en")}, F ${fmt(F, "en")}, with no abnormal fraction that needs a name. A normal trace does not exclude α-thalassaemia trait.`,
          );
        }
      }
    }
  }

  if (!bag.ranked.length) {
    return insufficient(
      "峰表未能對上一個穩定模式。請核對儀器同完整百分比，包括 A、A2 同 F。",
      "The peak table did not fit a stable pattern. Check the instrument and the full percentages, including A, A2, and F.",
      instrument,
      flagNames,
    );
  }

  if (qualityBad && bag.ranked[0]) {
    bag.ranked[0] = { ...bag.ranked[0], fit: "low" };
  }

  const most = bag.ranked[0];
  const differentials = bag.ranked.slice(1, 6);
  const searchIds = [...new Set(bag.ranked.flatMap((item) => PATTERN_VARIANTS[item.id as PatternId] ?? []))].slice(0, 4);

  return {
    instrument_used: instrument,
    insufficient: false,
    insufficient_zh: "",
    insufficient_en: "",
    context_flags: flagNames,
    peaks,
    most_likely: most,
    differentials,
    pitfalls: buildPitfalls({
      ids: bag.ranked.map((item) => item.id),
      flags,
      a2,
      F,
      instrument,
      quality,
      percentSum,
    }),
    confirm: buildConfirm(bag.ranked.map((item) => item.id), flags, instrument),
    co_migrating: cardsFor(searchIds),
    search_variant_ids: searchIds,
    kb_version: kb.meta.version,
    fit_note_zh: FIT_NOTE[most.fit].zh,
    fit_note_en: FIT_NOTE[most.fit].en,
  };
}

function buildPitfalls(args: {
  ids: string[];
  flags: Flags;
  a2: number | null;
  F: number | null;
  instrument: InstrumentId;
  quality: QualityFlags;
  percentSum: number | null;
}): RuleResult["pitfalls"] {
  const items: RuleResult["pitfalls"] = [
    GENOTYPE_LIMIT,
    {
      zh: "A2 參考區間、保留時間同 Capillarys zone 隨方法、試劑同軟件改變。用實驗室驗證過嘅範圍，不要用呢份教學切點出正式報告。",
      en: "A2 reference intervals, retention times, and Capillarys zones change with method, reagents, and software. Use the laboratory's verified ranges, not these teaching cut-offs, on a formal report.",
    },
  ];
  if (args.instrument === "unknown") {
    items.push({
      zh: "未能確定係 Variant II 定 Sebia。E 同 A2 在 HPLC 共流出、在 Capillarys 通常分開，儀器錯咗會錯判。",
      en: "Variant II versus Sebia is not established. E co-elutes with A2 on HPLC and usually separates on Capillarys, so the wrong instrument assumption misleads the pattern.",
    });
  }
  if (args.ids.includes("beta_thal_trait")) {
    items.push({
      zh: "同一個 A2 窗可以有 Hb Lepore，偶爾亦有其他變異。4–8% 在香港遠比 Lepore 常見，但第二種方法先至分得開。α-地貧共存會改變 MCV 同 A2。",
      en: "Hb Lepore, and occasionally other variants, share the A2 window. Four to eight percent is far more often β-thalassaemia trait than Lepore in Hong Kong, but only a second method separates them. Co-inherited α-thalassaemia changes the MCV and the A2.",
    });
    if ((args.F ?? 0) >= kb.thresholds.f_raised_min) {
      items.push({
        zh: "F 同時升高。部分 β 等位基因會這樣；δβ 或 HPFH 通常 A2 不高。",
        en: "F is raised as well. Some β alleles do this; δβ-thalassaemia or HPFH usually does not raise A2.",
      });
    }
  }
  if (args.ids.includes("hb_e_trait") || args.ids.includes("hb_ee") || args.ids.includes("hb_e_beta")) {
    items.push({
      zh: "HPLC 不能把 A2 窗拆成「幾多 E、幾多 A2」。Hb D-Iran 等少見變異可以模仿 E。EE 同 E/β0 不能單靠百分比分開。",
      en: "HPLC cannot split an A2-window percentage into 'how much is E and how much is A2'. Rarer variants such as Hb D-Iran can mimic E. EE and E/β0 cannot be separated on percentages alone.",
    });
  }
  if (args.ids.includes("hb_h") || args.ids.includes("hb_h_cs_like") || args.ids.includes("hb_constant_spring")) {
    items.push({
      zh: "Hb H 同 Constant Spring 都不穩定，HPLC 同電泳都會低估。只做 --SEA／-α gap-PCR 會漏 CS。",
      en: "Hb H and Constant Spring are unstable, so both HPLC and CE underestimate them. Gap-PCR for --SEA and -α deletions misses CS.",
    });
  }
  if (args.flags.iron && (args.ids.includes("beta_thal_trait") || (args.a2 ?? 0) >= kb.thresholds.a2_beta_min)) {
    items.push({
      zh: "已知缺鐵通常壓低 A2。A2 已經喺特質範圍時，缺鐵不能解釋成「所以不是 β-地貧」；兩者可以並存。",
      en: "Known iron deficiency usually lowers A2. Once A2 is already in the trait range, iron deficiency is not a reason to say it is not β-thalassaemia; both can be present.",
    });
  } else if (args.flags.iron || args.ids.includes("a2_borderline") || args.ids.includes("alpha_suggestive_only")) {
    items.push({
      zh: "缺鐵未糾正之前，正常或灰區 A2 不能排除 β-地貧特質。建議鐵質補充後覆檢 A2。",
      en: "Until iron deficiency is corrected, a normal or borderline A2 cannot exclude β-thalassaemia trait. Recheck A2 after iron repletion.",
    });
  }
  if (args.flags.microcytosis && args.ids.includes("normal_pattern")) {
    items.push({
      zh: "小球症加一張正常圖，α-地貧特質係臨床鑑別，但圖譜本身沒有證明佢。",
      en: "Microcytosis with a normal trace puts α-thalassaemia trait on the clinical list, but the trace itself does not prove it.",
    });
  }
  if ((args.a2 ?? 99) < kb.thresholds.a2_typical_low && !args.flags.newborn && !args.ids.includes("hb_h") && !args.ids.includes("hb_h_cs_like")) {
    items.push({
      zh: "A2 偏低。可以係 α-地貧、δ 變異、缺鐵或技術問題，單靠一個低 A2 不能命名。",
      en: "A2 is low. α-thalassaemia, a δ variant, iron deficiency, or a technical issue can do that. One low A2 is not a name.",
    });
  }
  const qualityOn = Object.entries(args.quality).filter(([, on]) => on).map(([name]) => name);
  if (qualityOn.length) {
    items.push({
      zh: `圖像質素有問題（${qualityOn.join("、")}），百分比可能不可靠。`,
      en: `Image quality is flagged (${qualityOn.join(", ")}), so the percentages may be unreliable.`,
    });
  }
  if (args.percentSum != null && (args.percentSum < kb.thresholds.percent_sum_low || args.percentSum > kb.thresholds.percent_sum_high)) {
    items.push({
      zh: `列出嘅百分比加起來大約 ${args.percentSum.toFixed(1)}%，不像一張完整峰表。可能裁漏、雙重計算，或主峰被切頂。`,
      en: `The listed percentages add up to about ${args.percentSum.toFixed(1)}%, which does not look like a complete table. Peaks may be cropped, double-counted, or cut off.`,
    });
  }
  return items;
}

function buildConfirm(ids: string[], flags: Flags, instrument: InstrumentId): RuleResult["confirm"] {
  const items: RuleResult["confirm"] = [
    {
      zh: "用另一種方法對照（HPLC 同毛細管電泳互換）。如果實驗室仍用酸／鹼電泳，可以作第二種方法，但不要靠一種方法命名。",
      en: "Cross-check with the other method (HPLC against capillary electrophoresis). Acid/alkaline electrophoresis is a valid second method where the lab still uses it. Do not name a variant from one method.",
    },
    {
      zh: "對照 CBC（Hb、RBC、MCV、MCH）同血片。",
      en: "Match the trace to the CBC (Hb, RBC, MCV, MCH) and the film.",
    },
  ];
  if (instrument !== "sebia_ce" && ids.some((id) => id.startsWith("hb_e") || id === "a2_window_indeterminate" || id === "beta_thal_trait")) {
    items.push({
      zh: "如果而家只有 HPLC，而 A2 窗高過大約 10%，優先用 Capillarys 睇 E 有冇同 A2 分開。",
      en: "If this is HPLC only and the A2 window is above about 10%, Capillarys is the useful next look, to see whether E separates from A2.",
    });
  }
  if (ids.some((id) => id.includes("hb_s") || id === "s_window_unlabeled")) {
    items.push({
      zh: "鐮刀溶解度試驗只可輔助，不能區分 trait 同 disease，亦不能代替第二種方法。",
      en: "A sickle solubility test is only an adjunct. It does not separate trait from disease and does not replace a second method.",
    });
  }
  if (ids.some((id) => ["hb_h", "hb_h_cs_like", "hb_constant_spring"].includes(id))) {
    items.push({
      zh: "超活體染色（brilliant cresyl blue 或 new methylene blue）搵 Hb H inclusion。基因要包括 --SEA、-α3.7、-α4.2 同 Constant Spring；只做 gap-PCR 會漏 CS。",
      en: "Supravital stain (brilliant cresyl blue or new methylene blue) for Hb H inclusions. Genotyping should include --SEA, -α3.7, -α4.2, and Constant Spring; gap-PCR alone misses CS.",
    });
  }
  if (flags.iron || ids.includes("a2_borderline") || ids.includes("beta_thal_trait")) {
    items.push({
      zh: "查鐵蛋白或鐵質。A2 在灰區時，於缺鐵糾正後覆檢。",
      en: "Check ferritin or iron studies. If A2 is borderline, repeat it after iron repletion.",
    });
  }
  if (flags.newborn || ids.includes("newborn_limited") || ids.includes("newborn_barts")) {
    items.push({
      zh: "核對年齡同樣本（靜脈定臍帶）。6–12 個月之後先用成人 A2 切點。",
      en: "Check age and sample type (venous versus cord). Apply adult A2 cut-offs only after 6–12 months.",
    });
  }
  if (flags.transfusion || ids.includes("transfusion_confounded")) {
    items.push({
      zh: "問上次輸血日期同成分。需要時等供血者紅血球消退後重做。",
      en: "Ask the date and the component of the last transfusion. Repeat after donor red cells have cleared if the genotype matters.",
    });
  }
  if (ids.includes("delta_beta_or_hpfh")) {
    items.push({
      zh: "Kleihauer 或 flow 睇 F 分佈，再決定 δβ 同 HPFH 係咪需要分子分辨。",
      en: "Kleihauer or flow cytometry for the F distribution, then decide whether δβ versus HPFH needs a molecular distinction.",
    });
  }
  if (ids.some((id) => ["beta_thal_trait", "hb_e_trait", "hb_e_beta", "hb_ee", "alpha_suggestive_only", "hb_h", "hb_h_cs_like", "hb_constant_spring"].includes(id))) {
    items.push({
      zh: "如果結果會用於產前或家族諮詢，先轉介分子確認同配偶篩查。呢個係建議，不是由呢張圖發出嘅醫囑。",
      en: "If the result will be used for antenatal or family counselling, molecular confirmation and partner testing come first. That is a suggestion, not an order issued by this trace.",
    });
  }
  items.push({
    zh: "只有臨床問題真係需要基因型時，先做 DNA 同家族研究。",
    en: "Add DNA and a family study only when the clinical question actually needs a genotype.",
  });
  return items;
}
