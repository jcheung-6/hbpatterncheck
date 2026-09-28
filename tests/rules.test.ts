import assert from "node:assert/strict";
import { test } from "node:test";
import demos from "../data/demos.json";
import { kb } from "../lib/kb";
import { interpretCase } from "../lib/interpret";
import { renderNarrative } from "../lib/narrative";
import { followUpFromRules } from "../lib/followup";
import { classifyLabel } from "../lib/parsers/common";
import { windowForRetention } from "../lib/parsers/variantii";
import { PATTERN_COPY, PATTERN_VARIANTS } from "../lib/patterns";
import { containsIdentifier, redactIdentifiers } from "../lib/redact";
import { parsePeakTable } from "../lib/table";
import { DISCLAIMER_ZH } from "../lib/i18n";
import type { RawPeak } from "../lib/types";

function peak(label: string, percent: number, where: string, notes = ""): RawPeak {
  const zone = /^Z\d+/i.test(where);
  return {
    name_or_label: label,
    retention_or_migration: zone ? where : `${where} min`,
    percent,
    zone_or_window: zone ? where : where,
    notes,
  };
}

test("knowledge base ids are unique and pattern links resolve", () => {
  const ids = kb.variants.map((variant) => variant.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of Object.keys(PATTERN_COPY)) {
    assert.ok(id in PATTERN_VARIANTS, id);
    for (const variantId of PATTERN_VARIANTS[id as keyof typeof PATTERN_VARIANTS]) {
      assert.ok(ids.includes(variantId), `${id} → ${variantId}`);
    }
  }
});

test("retention windows use the editable table", () => {
  assert.equal(windowForRetention(3.67), "A2");
  assert.equal(windowForRetention(3.9), "D");
  assert.equal(windowForRetention(4.5), "S");
  assert.equal(windowForRetention(5.1), "C");
  assert.equal(windowForRetention(1.1), "F");
  assert.equal(windowForRetention(0.4), "VOID");
});

test("labels do not confuse A with A2", () => {
  assert.equal(classifyLabel("Hb A2"), "A2");
  assert.equal(classifyLabel("A0"), "A");
  assert.equal(classifyLabel("Ao"), "A");
  assert.equal(classifyLabel("Hb A"), "A");
  assert.equal(classifyLabel("P2"), "P2");
  assert.equal(classifyLabel("Hb H"), "H");
  assert.equal(classifyLabel("Hb Hope"), "HOPE");
  assert.equal(classifyLabel("Constant Spring"), "CS");
  assert.equal(classifyLabel("S-window"), "UNKNOWN");
});

test("demo cases match the teaching patterns", () => {
  for (const demo of demos.cases) {
    const result = interpretCase({
      rawPeaks: demo.peaks,
      instrumentChoice: demo.instrument === "sebia_ce" ? "sebia" : "variant_ii",
      notes: demo.notes_zh,
      readable: true,
    });
    assert.equal(result.most_likely?.id, demo.expected_top_pattern, demo.id);
    assert.equal(result.insufficient, false);
    const text = `${renderNarrative(result).zh} ${renderNarrative(result).en}`;
    assert.match(text, /不能單憑|cannot establish a genotype/);
    assert.doesNotMatch(text, /確診/);
    assert.equal(result.context_flags.includes("transfusion"), false);
  }
});

test("β-thal trait is not called when the A2 window is an E-sized fraction", () => {
  const demo = demos.cases.find((item) => item.id === "hb_e_trait");
  assert.ok(demo);
  const result = interpretCase({
    rawPeaks: demo.peaks,
    instrumentChoice: "variant_ii",
    notes: demo.notes_en,
    readable: true,
  });
  assert.equal(result.most_likely?.id, "hb_e_trait");
  assert.equal(result.differentials.some((item) => item.id === "beta_thal_trait"), false);
});

test("borderline A2 with iron deficiency is not called trait", () => {
  const result = interpretCase({
    rawPeaks: [peak("F", 0.5, "1.10"), peak("A0", 92, "2.45"), peak("A2", 3.6, "3.64")],
    instrumentChoice: "variant_ii",
    notes: "Adult. MCV 72 fL. Iron deficiency, low ferritin. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "a2_borderline");
  assert.match(result.pitfalls.map((item) => item.en).join(" "), /iron/i);
});

test("transfusion outranks a thalassaemia-trait pattern", () => {
  const result = interpretCase({
    rawPeaks: [peak("F", 0.8, "1.10"), peak("A0", 86.4, "2.47"), peak("A2", 5.5, "3.65")],
    instrumentChoice: "variant_ii",
    notes: "Recent transfusion yesterday.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "transfusion_confounded");
  assert.equal(result.context_flags.includes("transfusion"), true);
});

test("a no-transfusion phrase does not set the transfusion flag", () => {
  const result = interpretCase({
    rawPeaks: [peak("A0", 90, "2.5"), peak("A2", 2.8, "3.6"), peak("F", 0.5, "1.1")],
    instrumentChoice: "variant_ii",
    notes: "成人。無近期輸血。無缺鐵紀錄。MCV 88 fL.",
    readable: true,
  });
  assert.equal(result.context_flags.includes("transfusion"), false);
  assert.equal(result.context_flags.includes("iron"), false);
  assert.equal(result.most_likely?.id, "normal_pattern");
});

test("adult A2 cut-offs are not used on a newborn fraction", () => {
  const result = interpretCase({
    rawPeaks: [peak("F", 82, "1.10"), peak("A0", 10, "2.4"), peak("A2", 8, "3.6")],
    instrumentChoice: "variant_ii",
    notes: "cord blood",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "newborn_limited");
  assert.notEqual(result.differentials[0]?.id, "beta_thal_trait");
});

test("sickle disease is not reported as simple beta trait", () => {
  const result = interpretCase({
    rawPeaks: [peak("S", 78, "4.42"), peak("A0", 0, "2.4"), peak("F", 8, "1.1"), peak("A2", 4.2, "3.66")],
    instrumentChoice: "variant_ii",
    notes: "Adult. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "hb_s_disease");
});

test("labelled S with A greater than S fits trait", () => {
  const result = interpretCase({
    rawPeaks: [peak("Hb S", 38, "4.4"), peak("A0", 54, "2.45"), peak("A2", 3.0, "3.63"), peak("F", 1, "1.1")],
    instrumentChoice: "variant_ii",
    notes: "Adult. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "hb_s_trait");
});

test("an unnamed S-window peak is not called Hb S", () => {
  const result = interpretCase({
    rawPeaks: [peak("Unknown", 36, "4.50"), peak("A0", 55, "2.48"), peak("A2", 3.0, "3.62"), peak("F", 1, "1.11")],
    instrumentChoice: "variant_ii",
    notes: "Adult. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "s_window_unlabeled");
});

test("a small C-window peak is not Hb C", () => {
  const result = interpretCase({
    rawPeaks: [peak("Unknown", 1.1, "5.05"), peak("A0", 95, "2.5"), peak("A2", 2.5, "3.66")],
    instrumentChoice: "variant_ii",
    notes: "Adult. MCV 88. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "hb_constant_spring");
  assert.notEqual(result.most_likely?.id, "hb_c_trait");
});

test("Sebia separates Hb E from A2", () => {
  const result = interpretCase({
    rawPeaks: [peak("Hb E", 30, "Z4"), peak("Hb A2", 2.8, "Z3"), peak("Hb A", 65, "Z9"), peak("F", 0.6, "Z8")],
    instrumentChoice: "sebia",
    notes: "Adult. MCV 72. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "hb_e_trait");
  assert.match(result.most_likely?.why_en ?? "", /separated/i);
});

test("a substantial Z2 peak is treated as Hb C, not Constant Spring", () => {
  const result = interpretCase({
    rawPeaks: [peak("Unknown", 41, "Z2"), peak("Hb A", 54, "Z9"), peak("Hb A2", 3.1, "Z3")],
    instrumentChoice: "sebia",
    notes: "Adult. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "hb_c_trait");
});

test("EE and E/β patterns", () => {
  const ee = interpretCase({
    rawPeaks: [peak("A2", 92, "3.68"), peak("F", 4, "1.1"), peak("A0", 2, "2.4")],
    instrumentChoice: "variant_ii",
    notes: "Adult. No recent transfusion.",
    readable: true,
  });
  assert.equal(ee.most_likely?.id, "hb_ee");
  const eb = interpretCase({
    rawPeaks: [peak("A2", 60, "3.68"), peak("F", 32, "1.12"), peak("A0", 5, "2.4")],
    instrumentChoice: "variant_ii",
    notes: "Adult. Hb 7.2 g/dL. No recent transfusion.",
    readable: true,
  });
  assert.equal(eb.most_likely?.id, "hb_e_beta");
});

test("raised F with a normal A2 stays in the δβ / HPFH list", () => {
  const result = interpretCase({
    rawPeaks: [peak("F", 18, "1.12"), peak("A2", 2.4, "3.6"), peak("A0", 78, "2.45")],
    instrumentChoice: "variant_ii",
    notes: "Adult. No recent transfusion.",
    readable: true,
  });
  assert.equal(result.most_likely?.id, "delta_beta_or_hpfh");
});

test("a normal trace plus microcytosis does not prove alpha thalassaemia", () => {
  const peaks = [peak("A0", 96, "2.48"), peak("A2", 2.6, "3.62"), peak("F", 0.4, "1.1")];
  const normal = interpretCase({
    rawPeaks: peaks,
    instrumentChoice: "variant_ii",
    notes: "Adult. MCV 90. No recent transfusion.",
    readable: true,
  });
  assert.equal(normal.most_likely?.id, "normal_pattern");
  const micro = interpretCase({
    rawPeaks: peaks,
    instrumentChoice: "variant_ii",
    notes: "Adult. MCV 68 fL. No recent transfusion.",
    readable: true,
  });
  assert.equal(micro.most_likely?.id, "alpha_suggestive_only");
  assert.match(micro.most_likely?.why_en ?? "", /neither prove/i);
});

test("unreadable images do not invent a pattern", () => {
  const result = interpretCase({
    rawPeaks: [],
    instrumentChoice: "auto",
    readable: false,
    notes: "",
  });
  assert.equal(result.insufficient, true);
  assert.equal(result.most_likely, null);
});

test("pasted prose does not become peaks, and a peak table does", () => {
  assert.equal(parsePeakTable("成人。MCV 66 fL。Hb 11.8 g/dL。無近期輸血。").length, 0);
  const peaks = parsePeakTable("F 1.10 min 0.8%\nA0 2.47 min 86.4%\nA2 3.65 min 5.5%");
  assert.equal(peaks.length, 3);
  assert.equal(peaks.find((item) => item.name_or_label.startsWith("A2"))?.percent, 5.5);
});

test("identifiers are detected and a follow-up does not promote Constant Spring on a beta-trait case", () => {
  assert.equal(containsIdentifier("A123456(7)"), true);
  assert.equal(redactIdentifiers("see A123456(7) today").text.includes("A123456"), false);
  assert.equal(containsIdentifier("HPLC A2 5.5%"), false);
  const demo = demos.cases[0];
  const rule = interpretCase({
    rawPeaks: demo.peaks,
    instrumentChoice: "variant_ii",
    notes: demo.notes_en,
    readable: true,
  });
  const answer = followUpFromRules("is this Hb Constant Spring?", rule);
  assert.match(answer.en, /not the leading pattern/i);
  assert.match(answer.zh, /不能單憑/);
  assert.doesNotMatch(`${answer.zh} ${answer.en}`, /確診為|confirmed genotype/);
});

test("disclaimer text is the bench wording", () => {
  assert.equal(DISCLAIMER_ZH.includes("僅供專業人員參考，非診斷器材"), true);
  assert.equal(DISCLAIMER_ZH.includes("唔存病人姓名"), true);
});
