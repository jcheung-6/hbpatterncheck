import raw from "@/data/variants.json";
import type { KbCard } from "@/lib/types";

export type WindowDef = {
  id: string;
  rt_start: number;
  rt_end: number;
  examples_en: string[];
  examples_zh: string[];
};

export type ZoneDef = {
  id: string;
  examples_en: string[];
  examples_zh: string[];
};

export type VariantRecord = KbCard & {
  aliases: string[];
  pitfalls_en: string[];
  pitfalls_zh: string[];
  confirm_en: string[];
  confirm_zh: string[];
  search_pubmed: string[];
  search_hbvar: string;
  search_ithanet: string;
};

export type Thresholds = {
  a2_typical_low: number;
  a2_typical_high: number;
  a2_borderline_low: number;
  a2_borderline_high: number;
  a2_beta_min: number;
  a2_beta_typical_max: number;
  a2_indeterminate_max: number;
  e_trait_min: number;
  e_trait_max: number;
  e_overlap_min: number;
  e_beta_min: number;
  ee_min: number;
  f_newborn_min: number;
  f_raised_min: number;
  f_e_beta_min: number;
  s_trait_min: number;
  s_trait_max: number;
  s_disease_min: number;
  c_trait_min: number;
  c_trait_max: number;
  c_disease_min: number;
  d_trait_min: number;
  d_trait_max: number;
  small_slow_max: number;
  h_min: number;
  cs_min: number;
  cs_max: number;
  unknown_report_min: number;
  fast_window_min: number;
  percent_sum_low: number;
  percent_sum_high: number;
};

export type KnowledgeBase = {
  meta: {
    version: string;
    editable_note: string;
    thresholds_note: string;
    rt_note: string;
    zone_note: string;
    sources: { id: string; citation: string }[];
  };
  thresholds: Thresholds;
  instruments: {
    variant_ii_beta_short: {
      label_en: string;
      label_zh: string;
      windows: WindowDef[];
    };
    sebia_capillarys_hb: {
      label_en: string;
      label_zh: string;
      zones: ZoneDef[];
    };
  };
  variants: VariantRecord[];
};

function assertKb(data: KnowledgeBase): KnowledgeBase {
  if (!data.meta?.version) throw new Error("variants.json is missing meta.version");
  if (!data.thresholds) throw new Error("variants.json is missing thresholds");
  if (!data.variants?.length) throw new Error("variants.json has no variants");
  const ids = new Set<string>();
  for (const variant of data.variants) {
    if (!variant.id) throw new Error("variant is missing id");
    if (ids.has(variant.id)) throw new Error(`duplicate variant id ${variant.id}`);
    ids.add(variant.id);
  }
  const windows = data.instruments.variant_ii_beta_short.windows;
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    if (!(window.rt_start < window.rt_end)) {
      throw new Error(`window ${window.id} has an invalid retention range`);
    }
  }
  return data;
}

export const kb = assertKb(raw as KnowledgeBase);

export function variantById(id: string): VariantRecord | undefined {
  return kb.variants.find((variant) => variant.id === id);
}

export function cardsFor(ids: string[]): KbCard[] {
  const seen = new Set<string>();
  const cards: KbCard[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const variant = variantById(id);
    if (!variant) continue;
    seen.add(id);
    cards.push({
      id: variant.id,
      name_en: variant.name_en,
      name_zh: variant.name_zh,
      gene: variant.gene,
      hgvs: variant.hgvs,
      hplc_window: variant.hplc_window,
      hplc_rt: variant.hplc_rt,
      hplc_en: variant.hplc_en,
      hplc_zh: variant.hplc_zh,
      ce_zones: variant.ce_zones,
      ce_en: variant.ce_en,
      ce_zh: variant.ce_zh,
      hk_note_en: variant.hk_note_en,
      hk_note_zh: variant.hk_note_zh,
    });
  }
  return cards;
}

export function matchVariantsInText(text: string): VariantRecord[] {
  const hay = text.toLowerCase();
  return kb.variants.filter((variant) => {
    const names = [variant.name_en, variant.name_zh, variant.id.replaceAll("_", " "), ...variant.aliases];
    return names.some((name) => name.length >= 2 && hay.includes(name.toLowerCase()));
  });
}
