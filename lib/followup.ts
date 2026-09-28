import { cardsFor, matchVariantsInText } from "@/lib/kb";
import { GENOTYPE_LIMIT, PATTERN_VARIANTS, isPatternId } from "@/lib/patterns";
import type { RuleResult, SearchHit } from "@/lib/types";
import { buildSearchHits } from "@/lib/search";

export function followUpFromRules(question: string, rule: RuleResult | null): {
  zh: string;
  en: string;
  searches: SearchHit[];
} {
  const matched = matchVariantsInText(question);
  const asksNext = /next|confirm|覆核|確認|下一步|點做|怎樣做/i.test(question);
  const asksCompare = /compare|previous|上一|比較|分別/i.test(question);
  const partsZh: string[] = [GENOTYPE_LIMIT.zh];
  const partsEn: string[] = [GENOTYPE_LIMIT.en];

  if (rule?.most_likely) {
    partsZh.push(`今次規則引擎排第一嘅模式係「${rule.most_likely.title_zh}」。${rule.most_likely.why_zh}`);
    partsEn.push(`The rule engine’s first pattern on this case is “${rule.most_likely.title_en}”. ${rule.most_likely.why_en}`);
  } else if (rule?.insufficient) {
    partsZh.push(rule.insufficient_zh);
    partsEn.push(rule.insufficient_en);
  } else {
    partsZh.push("未有上一張圖嘅結構化結果。可以貼峰表或上傳圖像。");
    partsEn.push("There is no structured result from a previous trace yet. Paste a peak table or upload an image.");
  }

  if (asksCompare) {
    partsZh.push("比較兩次運行只可以根據對話入面已經列出嘅百分比。請把上一張嘅峰表貼出嚟；呢度不會假設未提供嘅數值。");
    partsEn.push("A comparison uses only percentages already in the conversation. Paste the earlier peak table; missing numbers are not assumed.");
    if (rule?.peaks.length) {
      const line = rule.peaks
        .filter((peak) => peak.percent != null)
        .map((peak) => `${peak.label} ${peak.percent}%`)
        .join(", ");
      partsZh.push(`今次用緊嘅峰：${line}。`);
      partsEn.push(`Peaks in the current result: ${line}.`);
    }
  }

  if (asksNext && rule) {
    partsZh.push(`建議覆核：${rule.confirm.map((item) => item.zh).join("")}`);
    partsEn.push(`Suggested checks: ${rule.confirm.map((item) => item.en).join(" ")}`);
  }

  for (const variant of matched.slice(0, 2)) {
    const leading = rule ? patternMentions(rule, variant.id) : false;
    partsZh.push(
      leading
        ? `知識庫有「${variant.name_zh}」，而且今次排名有將佢列入考慮。這仍然不是證明。`
        : `你問到「${variant.name_zh}」。今次第一位模式不是以佢做主題；下面只係知識庫對照。`,
    );
    partsEn.push(
      leading
        ? `The knowledge base includes “${variant.name_en}”, and this ranking does consider it. That is still not proof.`
        : `You asked about “${variant.name_en}”. It is not the leading pattern of this ranking; the notes below are knowledge-base context only.`,
    );
    partsZh.push(`HPLC：${variant.hplc_zh} 毛細管電泳：${variant.ce_zh}`);
    partsEn.push(`HPLC: ${variant.hplc_en} Capillary electrophoresis: ${variant.ce_en}`);
  }

  if (!matched.length && !asksNext && !asksCompare && rule?.pitfalls.length) {
    partsZh.push(`同今次最相關嘅限制：${rule.pitfalls[0].zh}${rule.pitfalls[1]?.zh ?? ""}`);
    partsEn.push(`Limits that apply here: ${rule.pitfalls[0].en} ${rule.pitfalls[1]?.en ?? ""}`);
  }

  const ids = [
    ...matched.map((variant) => variant.id),
    ...(rule?.search_variant_ids ?? []),
  ].slice(0, 4);

  return {
    zh: partsZh.join(""),
    en: partsEn.join(" "),
    searches: buildSearchHits(ids),
  };
}

function patternMentions(rule: RuleResult, variantId: string): boolean {
  const patterns = [rule.most_likely, ...rule.differentials].filter((item) => item != null);
  return patterns.some((pattern) => {
    if (!isPatternId(pattern.id)) return false;
    return PATTERN_VARIANTS[pattern.id].includes(variantId);
  });
}

export function kbCardsForQuestion(question: string, rule: RuleResult | null) {
  const ids = matchVariantsInText(question).map((variant) => variant.id);
  const extra = rule?.search_variant_ids ?? [];
  return cardsFor([...ids, ...extra].slice(0, 4));
}
