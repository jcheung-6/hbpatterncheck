import assert from "node:assert/strict";
import { test } from "node:test";
import { runFollowUp, runInterpretation } from "../lib/pipeline";
import { classifyOpenRouterFailure, keyFromEnvText, modelFallbackChain, normalizeOpenRouterKey, openRouterHeaders } from "../lib/openrouter";
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

test("follow-up without a key says the server did not load it", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await runFollowUp({ question: "Hb E 同 A2 點分？", rule: null });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source, "template");
    assert.match(result.zh, /未載入/);
    assert.match(result.zh, /一齊流出/);
    assert.match(result.en, /co-elut/i);
    assert.doesNotMatch(result.en, /Paste a peak table or upload an image/);
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("an injected follow-up completion is used instead of the offline note", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await runFollowUp(
      { question: "what is Hb E?", rule: null },
      {
        complete: async () => ({
          zh: "知識庫：E 同 A2 共流出。不能單憑一張圖確定基因型。",
          en: "Hb E co-elutes with A2. A single trace cannot establish a genotype.",
          model: "test/chat",
        }),
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source, "openrouter");
    assert.match(result.zh, /共流出/);
    assert.doesNotMatch(result.zh, /未載入/);
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("a failed JSON follow-up falls back to plain text, and a total failure is labeled", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const fallback = await runFollowUp(
      { question: "Hb E?", rule: null },
      {
        complete: async () => null,
        chat: async () => ({ content: "ZH: E 同 A2 共流出。\nEN: Hb E co-elutes in the A2 window.", model: "test" }),
      },
    );
    assert.equal(fallback.ok, true);
    if (!fallback.ok) return;
    assert.equal(fallback.source, "openrouter");
    assert.match(fallback.en, /A2 window/);

    const failed = await runFollowUp(
      { question: "Hb E?", rule: null },
      {
        complete: async () => {
          throw new Error("schema");
        },
        chat: async () => {
          throw new Error("down");
        },
      },
    );
    assert.equal(failed.ok, true);
    if (!failed.ok) return;
    assert.equal(failed.source, "template");
    assert.match(failed.zh, /模型呼叫失敗/);
    assert.match(failed.zh, /一齊流出/);
  } finally {
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("OpenRouter headers stay server-side and name the app", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = '  "Bearer test-key"\r\n';
  process.env.OPENROUTER_APP_TITLE = "Hb Pattern Bench Chat";
  const headers = openRouterHeaders();
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["X-Title"], "Hb Pattern Bench Chat");
  assert.equal(headers["X-OpenRouter-Title"], "Hb Pattern Bench Chat");
  assert.ok(headers["HTTP-Referer"]);
  assert.equal(normalizeOpenRouterKey(' "Bearer sk-or-v1-abc" \n'), "sk-or-v1-abc");
  assert.equal(keyFromEnvText("# comment\nexport OPENROUTER_API_KEY='sk-or-v1-file'\n"), "sk-or-v1-file");
  if (previous) process.env.OPENROUTER_API_KEY = previous;
  else delete process.env.OPENROUTER_API_KEY;
});

test("a guardrail 403 is not called a rejected key", () => {
  const guard = classifyOpenRouterFailure(
    403,
    JSON.stringify({ error: { message: "Request blocked: prompt injection patterns detected", code: 403 } }),
  );
  assert.notEqual(guard.code, "unauthorized");
  assert.match(guard.detail, /prompt injection/);
  assert.equal(guard.retryWithCurl, false);
  const auth = classifyOpenRouterFailure(401, JSON.stringify({ error: { message: "User not found", code: 401 } }));
  assert.equal(auth.code, "unauthorized");
  assert.equal(auth.retryWithCurl, false);
  const missing = classifyOpenRouterFailure(401, JSON.stringify({ error: { message: "No cookie auth credentials found", code: 401 } }));
  assert.equal(missing.retryWithCurl, true);
  const policy = classifyOpenRouterFailure(403, "<html>Access denied by security policy</html>");
  assert.equal(policy.code, "provider");
  assert.equal(policy.message, "blocked");
  assert.equal(policy.retryWithCurl, true);
  const region = classifyOpenRouterFailure(403, JSON.stringify({ error: { message: "This model is not available in your region.", code: 403 } }));
  assert.equal(region.message, "region");
  assert.equal(region.code, "provider");
  assert.equal(region.retryWithCurl, false);
  const previousFallbacks = process.env.OPENROUTER_FALLBACK_MODELS;
  delete process.env.OPENROUTER_FALLBACK_MODELS;
  assert.deepEqual(modelFallbackChain("google/gemini-2.5-flash"), [
    "google/gemini-2.5-flash",
    "qwen/qwen3.6-flash",
    "deepseek/deepseek-v4.1-flash",
  ]);
  if (previousFallbacks) process.env.OPENROUTER_FALLBACK_MODELS = previousFallbacks;
});
