import assert from "node:assert/strict";
import { test } from "node:test";
import { seedTraces } from "../lib/librarySeed";
import { rankTraces, type SimilarityTrace } from "../lib/similarity";

function queryFrom(partial: Omit<SimilarityTrace, "curve" | "source">): SimilarityTrace {
  return { ...partial, curve: null, source: "query" };
}

test("Variant II shoulder pattern ranks the P3 shoulder ahead of a raised A2", () => {
  const query = queryFrom({
    id: "q-shoulder",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "Unknown", position: 1.0, percent: 0.17 },
      { name: "F", position: 1.09, percent: 0.52 },
      { name: "Unknown", position: 1.21, percent: 1.67 },
      { name: "P2", position: 1.34, percent: 4.8 },
      { name: "Unknown", position: 1.46, percent: 1.75 },
      { name: "P3", position: 1.72, percent: 5.7 },
      { name: "A0", position: 2.4, percent: 82.74 },
      { name: "A2", position: 3.64, percent: 2.6 },
    ],
  });
  const matches = rankTraces(query, seedTraces(), 6).matches;
  assert.equal(matches[0]?.id, "seed-vii-p3-high");
  assert.ok(matches.every((match) => match.method === "variant_ii"));
  const beta = matches.findIndex((match) => match.id === "seed-vii-beta");
  const largeA2 = matches.findIndex((match) => match.id === "seed-vii-a2-large");
  assert.ok(beta > 0);
  assert.equal(largeA2, -1);
});

test("Sebia extra peak beside A2 ranks the split traces ahead of a normal A/A2", () => {
  const query = queryFrom({
    id: "q-split",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "A", position: 133.2, percent: 92.5 },
      { name: "peak", position: 201.6, percent: 2.4 },
      { name: "peak", position: 254.4, percent: 5.1 },
    ],
  });
  const matches = rankTraces(query, seedTraces(), 6).matches;
  assert.equal(matches[0]?.id, "seed-sebia-split-right");
  assert.equal(matches[1]?.id, "seed-sebia-split-right-2");
  assert.ok(matches.every((match) => match.method === "sebia_ce"));
  const normal = matches.find((match) => match.id === "seed-sebia-normal");
  assert.ok(normal);
  assert.ok(matches[0].score > normal.score);
});

test("a normal Sebia pair does not come back as the split pattern", () => {
  const query = queryFrom({
    id: "q-normal-sebia",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "A", position: 140, percent: 97.5 },
      { name: "A2", position: 250, percent: 2.5 },
    ],
  });
  const matches = rankTraces(query, seedTraces(), 4).matches;
  assert.equal(matches[0]?.id, "seed-sebia-normal");
  assert.notEqual(matches[0]?.id, "seed-sebia-split-right");
});

test("summaries describe windows and percentages, not a diagnosis name", () => {
  const top = rankTraces(
    queryFrom({
      id: "q",
      method: "variant_ii",
      axisStart: 0,
      axisEnd: 6,
      peaks: [
        { name: "A0", position: 2.45, percent: 86 },
        { name: "A2", position: 3.65, percent: 5.6 },
      ],
    }),
    seedTraces(),
    3,
  ).matches[0];
  assert.ok(top);
  assert.equal(/Hb |thal|NY|filename|shoulder base/i.test(top.summaryEn), false);
  assert.ok(top.summaryEn.includes("%"));
});
