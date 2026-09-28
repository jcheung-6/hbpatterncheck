import type { Fit } from "@/lib/types";

export const GENOTYPE_LIMIT = {
  zh: "不能單憑一張層析圖或電泳圖確定基因型。",
  en: "A single chromatogram or electropherogram cannot establish a genotype.",
};

export const PATTERN_COPY = {
  newborn_barts: {
    title_zh: "新生兒 Hb Bart's 模式",
    title_en: "Newborn Hb Bart's pattern",
  },
  newborn_limited: {
    title_zh: "新生兒或極高 Hb F（成人 A2 切點不適用）",
    title_en: "Newborn or very high Hb F — adult A2 cut-offs do not apply",
  },
  transfusion_confounded: {
    title_zh: "輸血可能混淆呢張圖",
    title_en: "Transfusion may confound this trace",
  },
  hb_h_cs_like: {
    title_zh: "Hb H 加一個疑似 Constant Spring 嘅慢峰",
    title_en: "Hb H with a Constant Spring–like slow peak",
  },
  hb_h: {
    title_zh: "Hb H 病模式",
    title_en: "Hb H disease pattern",
  },
  hb_constant_spring: {
    title_zh: "疑似 Hb Constant Spring 細峰",
    title_en: "Possible Hb Constant Spring (small peak)",
  },
  hb_e_trait: {
    title_zh: "疑似 Hb E trait",
    title_en: "Suggestive of Hb E trait",
  },
  hb_ee: {
    title_zh: "疑似 Hb EE",
    title_en: "Suggestive of Hb EE",
  },
  hb_e_beta: {
    title_zh: "疑似 Hb E／β-地貧",
    title_en: "Suggestive of Hb E/β-thalassaemia",
  },
  hb_s_trait: {
    title_zh: "疑似 Hb S trait",
    title_en: "Suggestive of Hb S trait",
  },
  hb_s_disease: {
    title_zh: "鐮刀形血球疾病模式（SS 與 S/β0 等未能分開）",
    title_en: "Sickle-disease pattern (SS and S/β0 are not separated)",
  },
  hb_s_beta_plus: {
    title_zh: "疑似 S/β+",
    title_en: "Suggestive of S/β+",
  },
  hb_c_trait: {
    title_zh: "疑似 Hb C trait",
    title_en: "Suggestive of Hb C trait",
  },
  hb_c_disease: {
    title_zh: "疑似以 Hb C 為主嘅模式",
    title_en: "Pattern dominated by a C-window fraction",
  },
  c_window_variant: {
    title_zh: "C 窗未命名峰（Hb C 與 Hb O-Arab 等）",
    title_en: "Unnamed C-window peak (Hb C, Hb O-Arab, and others)",
  },
  hb_d_trait: {
    title_zh: "D 窗變異（Hb D-Punjab 等）",
    title_en: "D-window variant (Hb D-Punjab and others)",
  },
  s_window_unlabeled: {
    title_zh: "S 窗未命名峰（Hb S 與 Hb Q-Thailand 等）",
    title_en: "Unnamed S-window peak (Hb S, Hb Q-Thailand, and others)",
  },
  fast_variant: {
    title_zh: "快泳或早期窗嘅異常峰",
    title_en: "Fast or early-window abnormal peak",
  },
  beta_thal_trait: {
    title_zh: "疑似 β-地貧特質",
    title_en: "Suggestive of β-thalassaemia trait",
  },
  a2_borderline: {
    title_zh: "Hb A2 處於灰區",
    title_en: "Borderline Hb A2",
  },
  a2_window_indeterminate: {
    title_zh: "A2 窗百分比不典型",
    title_en: "Atypical A2-window percentage",
  },
  delta_beta_or_hpfh: {
    title_zh: "Hb F 升高而 A2 不高",
    title_en: "Raised Hb F with a normal or low A2",
  },
  normal_pattern: {
    title_zh: "未見明顯異常血紅蛋白分畫",
    title_en: "No clear abnormal haemoglobin fraction",
  },
  alpha_suggestive_only: {
    title_zh: "圖譜大致正常；小球症不能靠呢張圖解釋",
    title_en: "Near-normal trace; microcytosis is not explained by the chromatogram",
  },
  unidentified_variant: {
    title_zh: "有未能歸類嘅峰",
    title_en: "An unclassified peak is present",
  },
  q_thailand: {
    title_zh: "標示為 Hb Q-Thailand（或 Q）嘅峰",
    title_en: "Peak labelled Hb Q-Thailand (or Q)",
  },
  hb_lepore_labeled: {
    title_zh: "標示為 Hb Lepore 嘅峰",
    title_en: "Peak labelled Hb Lepore",
  },
  hb_o_arab_labeled: {
    title_zh: "標示為 Hb O-Arab 嘅峰",
    title_en: "Peak labelled Hb O-Arab",
  },
  complex_pattern: {
    title_zh: "多於一種主要異常分畫",
    title_en: "More than one major abnormal fraction",
  },
} as const;

export type PatternId = keyof typeof PATTERN_COPY;

export const PATTERN_VARIANTS: Record<PatternId, string[]> = {
  newborn_barts: ["hb_barts", "alpha_thal"],
  newborn_limited: ["hb_barts", "hpfh"],
  transfusion_confounded: [],
  hb_h_cs_like: ["hb_h", "hb_cs", "alpha_thal"],
  hb_h: ["hb_h", "alpha_thal", "hb_cs"],
  hb_constant_spring: ["hb_cs", "alpha_thal"],
  hb_e_trait: ["hb_e", "hb_d_iran", "hb_lepore"],
  hb_ee: ["hb_e"],
  hb_e_beta: ["hb_e", "beta_thal_trait"],
  hb_s_trait: ["hb_s", "hb_q_thailand"],
  hb_s_disease: ["hb_s", "beta_thal_trait"],
  hb_s_beta_plus: ["hb_s", "beta_thal_trait"],
  hb_c_trait: ["hb_c", "hb_o_arab"],
  hb_c_disease: ["hb_c", "hb_o_arab"],
  c_window_variant: ["hb_c", "hb_o_arab", "hb_cs"],
  hb_d_trait: ["hb_d_punjab", "hb_lepore"],
  s_window_unlabeled: ["hb_s", "hb_q_thailand"],
  fast_variant: ["hb_hope", "hb_j_bangkok", "hb_barts", "hb_h"],
  beta_thal_trait: ["beta_thal_trait", "hb_lepore", "hb_e"],
  a2_borderline: ["beta_thal_trait", "alpha_thal"],
  a2_window_indeterminate: ["hb_lepore", "hb_e", "hb_d_iran", "beta_thal_trait"],
  delta_beta_or_hpfh: ["deltabeta", "hpfh"],
  normal_pattern: ["alpha_thal"],
  alpha_suggestive_only: ["alpha_thal", "beta_thal_trait"],
  unidentified_variant: [],
  q_thailand: ["hb_q_thailand", "hb_s"],
  hb_lepore_labeled: ["hb_lepore", "beta_thal_trait"],
  hb_o_arab_labeled: ["hb_o_arab", "hb_c"],
  complex_pattern: ["hb_e", "hb_h", "hb_s"],
};

export function titleOf(id: PatternId): { title_zh: string; title_en: string } {
  return PATTERN_COPY[id];
}

export function isPatternId(id: string): id is PatternId {
  return id in PATTERN_COPY;
}

export const FIT_NOTE = {
  moderate: {
    zh: "參考強度：中。意思係百分比大致符合常見教學模式，不是診斷信心，亦不是基因型。",
    en: "Pattern fit: moderate. The percentages roughly match a common teaching pattern. This is not diagnostic confidence and not a genotype.",
  },
  low: {
    zh: "參考強度：低。圖像質素、灰區、輸血、新生兒，或窗內有多過一種血紅蛋白。不要將呢個排名當成診斷。",
    en: "Pattern fit: low. Image quality, a grey zone, transfusion, a newborn sample, or more than one haemoglobin in the window. Do not treat this ranking as a diagnosis.",
  },
} as const satisfies Record<Fit, { zh: string; en: string }>;
