import assert from "node:assert/strict";
import { test } from "node:test";
import { extractionFromTraces } from "../lib/localRead";
import { runInterpretation } from "../lib/pipeline";
import { openRouterHeaders } from "../lib/openrouter";
import type { Extraction } from "../lib/types";

const flags = {
  cut_off: false,
  overloaded: false,
  baseline_drift: false,
  overlapping_peaks: false,
  poor_resolution: false,
  missing_scale: false,
};

function normalExtraction(): Extraction {
  return {
    instrument_guess: "variant_ii",
    instrument_confidence: "high",
    readable: true,
    unread_reason: "",
    peaks: [
      { name_or_label: "A0", retention_or_migration: "2.50 min", percent: 96, zone_or_window: "A0", notes: "" },
      { name_or_label: "A2", retention_or_migration: "3.62 min", percent: 2.6, zone_or_window: "A2", notes: "" },
      { name_or_label: "F", retention_or_migration: "1.10 min", percent: 0.4, zone_or_window: "F", notes: "" },
    ],
    quality_flags: flags,
    raw_ocr_text: "A 96 A2 2.6 F 0.4",
    patient_identifiers_seen: false,
  };
}

test("demo fixture is used only when vision is not called", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await runInterpretation({
      demoId: "beta_thal_trait",
      instrument: "auto",
      notes: "成人。MCV 66 fL。無近期輸血。",
      images: [{ mime: "image/png", data_base64: Buffer.from("not-a-real-image").toString("base64") }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.extraction_source, "demo_fixture");
    assert.equal(result.vision_attempted, false);
    assert.equal(result.rule.most_likely?.id, "beta_thal_trait");
    assert.equal(result.narrative_source, "template");
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
  }
});

test("a live vision result is not replaced by the demo answer key", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await runInterpretation(
      {
        demoId: "beta_thal_trait",
        instrument: "variant_ii",
        notes: "Adult. MCV 90 fL. No recent transfusion.",
        images: [{ mime: "image/png", data_base64: Buffer.from("placeholder").toString("base64") }],
      },
      {
        prepare: async () => ({ dataUrl: "data:image/jpeg;base64,AA" }),
        vision: async () => ({ extraction: normalExtraction(), model: "test/vision" }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.extraction_source, "openrouter");
    assert.equal(result.vision_model, "test/vision");
    assert.equal(result.rule.most_likely?.id, "normal_pattern");
    assert.notEqual(result.rule.most_likely?.id, "beta_thal_trait");
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
  }
});

test("a real report is read locally and does not call OpenRouter", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  let visionCalled = false;
  let completeCalled = false;
  try {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = await runInterpretation(
      {
        instrument: "variant_ii",
        notes: "成人。無近期輸血。",
        images: [{ mime: "image/jpeg", data_base64: jpeg.toString("base64") }],
      },
      {
        readLocal: async () => normalExtraction(),
        vision: async () => {
          visionCalled = true;
          return { extraction: normalExtraction(), model: "should-not-run" };
        },
        complete: async () => {
          completeCalled = true;
          return { zh: "雲端", en: "cloud", model: "should-not-run" };
        },
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(visionCalled, false);
    assert.equal(completeCalled, false);
    assert.equal(result.extraction_source, "local");
    assert.equal(result.vision_attempted, false);
    assert.equal(result.narrative_source, "template");
    assert.equal(result.rule.most_likely?.id, "normal_pattern");
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("an unreadable image is not sent to OpenRouter even when a key is set", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("network");
  }) as typeof fetch;
  try {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = await runInterpretation(
      {
        instrument: "variant_ii",
        images: [{ mime: "image/jpeg", data_base64: jpeg.toString("base64") }],
      },
      { readLocal: async () => null },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "unreadable");
    assert.equal(called, false);
    assert.match(result.error.zh, /本機/);
    assert.doesNotMatch(result.error.en, /OpenRouter call failed/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("a file with both methods keeps only the first method's peaks", () => {
  const extraction = extractionFromTraces([
    {
      method: "variant_ii",
      axisStart: 0,
      axisEnd: 6,
      curve: null,
      peaks: [
        { name: "A0", position: 2.4, percent: 82.74 },
        { name: "A2", position: 3.64, percent: 2.6 },
        { name: "P3", position: 1.72, percent: 5.7 },
      ],
    },
    {
      method: "sebia_ce",
      axisStart: 0,
      axisEnd: 300,
      curve: null,
      peaks: [
        { name: "A", position: 140, percent: 97.5 },
        { name: "A2", position: 250, percent: 2.5 },
      ],
    },
  ]);
  assert.ok(extraction);
  assert.equal(extraction?.instrument_guess, "variant_ii");
  assert.equal(extraction?.peaks.length, 3);
  assert.ok(extraction?.peaks.every((peak) => peak.retention_or_migration.endsWith("min")));
});

test("pasted percentages work without an API key", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await runInterpretation({
      notes: "F 0.8%\nP2 3.4%\nP3 3.9%\nA0 86.4%\nA2 5.5%",
      instrument: "variant_ii",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.extraction_source, "pasted_table");
    assert.equal(result.rule.most_likely?.id, "beta_thal_trait");
    assert.ok(result.searches.some((hit) => hit.source === "PubMed" && hit.href.includes("pubmed.ncbi.nlm.nih.gov")));
    assert.ok(result.searches.some((hit) => hit.source === "HbVar"));
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
  }
});

test("identifiers in the note are refused before any model call", async () => {
  const result = await runInterpretation({
    notes: "Name: someone A123456(3)",
    instrument: "auto",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "identifiers");
});

test("OpenRouter headers stay server-side and name the app", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_APP_TITLE = "Hb Pattern Bench Chat";
  const headers = openRouterHeaders();
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["X-Title"], "Hb Pattern Bench Chat");
  assert.ok(headers["HTTP-Referer"]);
  if (previous) process.env.OPENROUTER_API_KEY = previous;
  else delete process.env.OPENROUTER_API_KEY;
});
