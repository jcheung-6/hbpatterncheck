import { GENOTYPE_LIMIT } from "@/lib/patterns";
import type { RuleResult } from "@/lib/types";

export function renderNarrative(rule: RuleResult): { zh: string; en: string } {
  if (rule.insufficient || !rule.most_likely) {
    return {
      zh: `${rule.insufficient_zh} ${GENOTYPE_LIMIT.zh}`,
      en: `${rule.insufficient_en} ${GENOTYPE_LIMIT.en}`,
    };
  }
  const top = rule.most_likely;
  const diffsZh = rule.differentials.map((item, index) => `${index + 1}. ${item.title_zh}：${item.why_zh}`).join(" ");
  const diffsEn = rule.differentials.map((item, index) => `${index + 1}. ${item.title_en}: ${item.why_en}`).join(" ");
  const pitZh = rule.pitfalls.slice(0, 3).map((item) => item.zh).join("");
  const pitEn = rule.pitfalls.slice(0, 3).map((item) => item.en).join(" ");
  const nextZh = rule.confirm.slice(0, 3).map((item) => item.zh).join("");
  const nextEn = rule.confirm.slice(0, 3).map((item) => item.en).join(" ");
  return {
    zh: `最接近嘅模式係「${top.title_zh}」。${top.why_zh}${rule.fit_note_zh} ${diffsZh ? `其他要一併考慮：${diffsZh}` : ""} ${pitZh} 建議下一步（只供參考，不是醫囑）：${nextZh}`,
    en: `The closest pattern is “${top.title_en}”. ${top.why_en} ${rule.fit_note_en} ${diffsEn ? `Also keep in view: ${diffsEn}` : ""} ${pitEn} Suggested next checks (not an order): ${nextEn}`,
  };
}
