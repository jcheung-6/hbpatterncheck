export type InstrumentChoice = "auto" | "variant_ii" | "sebia";
export type InstrumentId = "variant_ii" | "sebia_ce" | "unknown";
export type Fit = "moderate" | "low";
export type Locale = "zh" | "en";

export type PeakKind =
  | "A"
  | "A2"
  | "F"
  | "S"
  | "C"
  | "D"
  | "E"
  | "H"
  | "BARTS"
  | "CS"
  | "P2"
  | "P3"
  | "LEPORE"
  | "HOPE"
  | "J"
  | "Q"
  | "O_ARAB"
  | "SLOW_MINOR"
  | "UNKNOWN";

export type RawPeak = {
  name_or_label: string;
  retention_or_migration: string;
  percent: number | null;
  zone_or_window: string;
  notes: string;
};

export type QualityFlags = {
  cut_off: boolean;
  overloaded: boolean;
  baseline_drift: boolean;
  overlapping_peaks: boolean;
  poor_resolution: boolean;
  missing_scale: boolean;
};

export type Extraction = {
  instrument_guess: InstrumentId;
  instrument_confidence: "high" | "medium" | "low";
  readable: boolean;
  unread_reason: string;
  peaks: RawPeak[];
  quality_flags: QualityFlags;
  raw_ocr_text: string;
  patient_identifiers_seen: boolean;
};

export type CanonicalPeak = {
  label: string;
  label_kind: PeakKind;
  kind: PeakKind;
  inferred: boolean;
  percent: number | null;
  rt_min: number | null;
  zone: string | null;
  window: string | null;
  notes: string;
};

export type PatternCall = {
  id: string;
  title_zh: string;
  title_en: string;
  fit: Fit;
  why_zh: string;
  why_en: string;
};

export type Bilingual = { zh: string; en: string };

export type KbCard = {
  id: string;
  name_en: string;
  name_zh: string;
  gene: string;
  hgvs: string;
  hplc_window: string;
  hplc_rt: string;
  hplc_en: string;
  hplc_zh: string;
  ce_zones: string;
  ce_en: string;
  ce_zh: string;
  hk_note_en: string;
  hk_note_zh: string;
};

export type RuleResult = {
  instrument_used: InstrumentId;
  insufficient: boolean;
  insufficient_zh: string;
  insufficient_en: string;
  context_flags: string[];
  peaks: CanonicalPeak[];
  most_likely: PatternCall | null;
  differentials: PatternCall[];
  pitfalls: Bilingual[];
  confirm: Bilingual[];
  co_migrating: KbCard[];
  search_variant_ids: string[];
  kb_version: string;
  fit_note_zh: string;
  fit_note_en: string;
};

export type SearchHit = {
  variant_id: string;
  variant_name_en: string;
  variant_name_zh: string;
  source: "PubMed" | "HbVar" | "ITHANET";
  title: string;
  href: string;
  query: string;
  offline: boolean;
};

export type Warning = { zh: string; en: string };

export type InterpretOk = {
  ok: true;
  extraction_source: "openrouter" | "pasted_table" | "demo_fixture";
  vision_attempted: boolean;
  vision_model: string | null;
  narrative_source: "template" | "openrouter";
  text_model: string | null;
  extraction: Extraction | null;
  rule: RuleResult;
  narrative_zh: string;
  narrative_en: string;
  searches: SearchHit[];
  warnings: Warning[];
  kb_version: string;
  sources: { id: string; citation: string }[];
};

export type InterpretErr = {
  ok: false;
  error: { code: string; zh: string; en: string };
};

export type InterpretResponse = InterpretOk | InterpretErr;
