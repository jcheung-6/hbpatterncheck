import { windowForRetention } from "@/lib/parsers/variantii";

export const CURVE_N = 128;

export type TraceMethod = "variant_ii" | "sebia_ce";

export type TracePeak = {
  name: string;
  position: number;
  percent: number;
};

export type SimilarityTrace = {
  id: string;
  method: TraceMethod;
  peaks: TracePeak[];
  curve: number[] | null;
  axisStart: number;
  axisEnd: number;
  source: "seed" | "library" | "query";
};

export type RankedMatch = {
  id: string;
  method: TraceMethod;
  source: "seed" | "library";
  score: number;
  peakScore: number;
  curveScore: number;
  reasonZh: string;
  reasonEn: string;
  peaks: TracePeak[];
  alignedCurve: number[];
  summaryZh: string;
  summaryEn: string;
};

const HPLC_BINS = ["VOID", "F", "P2", "P3", "A0", "A2", "D", "S", "C"] as const;
const HPLC_WEIGHT: Record<(typeof HPLC_BINS)[number], number> = {
  VOID: 1.1,
  F: 1.25,
  P2: 1.15,
  P3: 1.55,
  A0: 0.22,
  A2: 1.9,
  D: 1.75,
  S: 1.75,
  C: 1.75,
};

const HPLC_ANCHOR = 48;
const SEBIA_ANCHOR = 60;

export function synthesizeCurve(trace: Pick<SimilarityTrace, "method" | "peaks" | "axisStart" | "axisEnd">): number[] {
  const start = trace.axisStart;
  const end = trace.axisEnd > start ? trace.axisEnd : trace.method === "sebia_ce" ? 300 : 6;
  const sigma = trace.method === "sebia_ce" ? 7.5 : 0.09;
  const curve = new Array<number>(CURVE_N).fill(0);
  for (let index = 0; index < CURVE_N; index += 1) {
    const x = start + ((index + 0.5) / CURVE_N) * (end - start);
    let y = 0;
    for (const peak of trace.peaks) {
      const distance = (x - peak.position) / sigma;
      y += Math.max(0, peak.percent) * Math.exp(-0.5 * distance * distance);
    }
    curve[index] = y;
  }
  return normalise(curve);
}

export function shapeSummary(trace: Pick<SimilarityTrace, "method" | "peaks">, locale: "zh" | "en"): string {
  const method = trace.method === "sebia_ce" ? "Sebia" : "Variant II";
  const ranked = [...trace.peaks].sort((a, b) => b.percent - a.percent).slice(0, 4);
  const parts = ranked.map((peak) => {
    const where = trace.method === "variant_ii" ? windowForRetention(peak.position) || peak.name : `${Math.round(peak.position)}`;
    return `${where} ${peak.percent.toFixed(1)}%`;
  });
  if (locale === "zh") return `${method} · ${parts.join(" · ") || "未有峰"}`;
  return `${method} · ${parts.join(" · ") || "no peaks"}`;
}

export function rankTraces(query: SimilarityTrace, corpus: SimilarityTrace[], limit = 6): { alignedQuery: number[]; matches: RankedMatch[] } {
  const prepared = prepare(query);
  const matches = corpus
    .filter((candidate) => candidate.method === query.method && candidate.id !== query.id)
    .map((candidate) => {
      const other = prepare(candidate);
      const peakScore = query.method === "sebia_ce" ? sebiaPeakScore(query, candidate) : hplcPeakScore(query, candidate);
      const curveScore = cosine(prepared.weighted, other.weighted);
      const peakWeight = query.peaks.length >= 2 ? 0.3 + 0.5 * prepared.separation : 0.25;
      const score = peakWeight * peakScore + (1 - peakWeight) * curveScore;
      const reason = explain(query, candidate, curveScore, peakScore, prepared.separation);
      return {
        id: candidate.id,
        method: candidate.method,
        source: candidate.source === "library" ? "library" as const : "seed" as const,
        score,
        peakScore,
        curveScore,
        reasonZh: reason.zh,
        reasonEn: reason.en,
        peaks: candidate.peaks,
        alignedCurve: other.aligned,
        summaryZh: shapeSummary(candidate, "zh"),
        summaryEn: shapeSummary(candidate, "en"),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { alignedQuery: prepared.aligned, matches };
}

function prepare(trace: SimilarityTrace): { aligned: number[]; weighted: number[]; separation: number } {
  const raw = trace.curve && trace.curve.length === CURVE_N ? normalise(trace.curve) : synthesizeCurve(trace);
  const anchor = anchorIndex(trace, raw);
  const target = trace.method === "sebia_ce" ? SEBIA_ANCHOR : HPLC_ANCHOR;
  const aligned = shiftCurve(raw, anchor, target);
  const weights = aligned.map((_, index) => 1 - 0.82 * Math.exp(-0.5 * ((index - target) / 10) ** 2));
  const weighted = aligned.map((value, index) => value * weights[index]);
  return { aligned, weighted, separation: separationAt(aligned, target) };
}

function anchorIndex(trace: SimilarityTrace, curve: number[]): number {
  const main = mainPeak(trace);
  const start = trace.axisStart;
  const end = trace.axisEnd > start ? trace.axisEnd : trace.method === "sebia_ce" ? 300 : 6;
  if (main) {
    const ratio = (main.position - start) / (end - start);
    return clamp(Math.round(ratio * (CURVE_N - 1)), 0, CURVE_N - 1);
  }
  return argmax(curve);
}

function mainPeak(trace: Pick<SimilarityTrace, "method" | "peaks">): TracePeak | null {
  const named = trace.peaks.filter((peak) => isMainA(peak, trace.method) && peak.percent >= 15);
  if (named.length) return named.reduce((best, peak) => (peak.percent > best.percent ? peak : best));
  const tallest = [...trace.peaks].sort((a, b) => b.percent - a.percent)[0];
  return tallest && tallest.percent >= 15 ? tallest : null;
}

function isMainA(peak: TracePeak, method: TraceMethod): boolean {
  const name = peak.name.replace(/\s+/g, "").toLowerCase();
  if (name.includes("a2")) return false;
  if (method === "variant_ii") return name === "a0" || name === "ao" || name === "a";
  return name === "a" || name === "hba";
}

function hplcBins(trace: SimilarityTrace): Record<(typeof HPLC_BINS)[number], number> {
  const bins = Object.fromEntries(HPLC_BINS.map((bin) => [bin, 0])) as Record<(typeof HPLC_BINS)[number], number>;
  for (const peak of trace.peaks) {
    const fromTime = windowForRetention(peak.position);
    const fromName = nameToWindow(peak.name);
    const bin = (fromTime || fromName) as (typeof HPLC_BINS)[number] | null;
    if (bin && bin in bins) bins[bin] += peak.percent;
  }
  return bins;
}

function nameToWindow(name: string): string | null {
  const token = name.replace(/\s+/g, "").toLowerCase();
  if (token === "a0" || token === "ao" || token === "a") return "A0";
  if (token === "a2" || token === "e") return "A2";
  if (token === "f") return "F";
  if (token === "p2") return "P2";
  if (token === "p3") return "P3";
  if (token === "s") return "S";
  if (token === "d") return "D";
  if (token === "c") return "C";
  return null;
}

function hplcPeakScore(query: SimilarityTrace, candidate: SimilarityTrace): number {
  const left = hplcBins(query);
  const right = hplcBins(candidate);
  let weighted = 0;
  let weight = 0;
  for (const bin of HPLC_BINS) {
    weighted += HPLC_WEIGHT[bin] * Math.abs(left[bin] - right[bin]);
    weight += HPLC_WEIGHT[bin];
  }
  return Math.exp(-(weighted / weight) / 5.2);
}

function sebiaPeakScore(query: SimilarityTrace, candidate: SimilarityTrace): number {
  const left = relativePeaks(query);
  const right = relativePeaks(candidate);
  const used = new Set<number>();
  let cost = 0;
  for (const peak of left) {
    let best = -1;
    let bestDistance = 22;
    right.forEach((other, index) => {
      if (used.has(index)) return;
      const distance = Math.abs(peak.position - other.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (best >= 0) {
      used.add(best);
      cost += Math.abs(peak.percent - right[best].percent);
    } else if (peak.percent >= 0.4) {
      cost += peak.percent * 0.9;
    }
  }
  right.forEach((peak, index) => {
    if (!used.has(index) && peak.percent >= 0.4) cost += peak.percent * 0.9;
  });
  return Math.exp(-cost / 6.5);
}

function relativePeaks(trace: SimilarityTrace): TracePeak[] {
  const main = mainPeak(trace);
  const origin = main?.position ?? 0;
  return trace.peaks.map((peak) => ({ ...peak, position: peak.position - origin }));
}

function explain(
  query: SimilarityTrace,
  candidate: SimilarityTrace,
  curveScore: number,
  peakScore: number,
  separation: number,
): { zh: string; en: string } {
  if (query.method === "variant_ii") {
    const left = hplcBins(query);
    const right = hplcBins(candidate);
    const notable = HPLC_BINS.filter((bin) => bin !== "A0" && Math.max(left[bin], right[bin]) >= 1.2)
      .map((bin) => ({ bin, diff: Math.abs(left[bin] - right[bin]), left: left[bin], right: right[bin] }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 2);
    const bitsZh = notable.map((item) => `${item.bin} 窗 ${item.left.toFixed(1)}% 對 ${item.right.toFixed(1)}%`);
    const bitsEn = notable.map((item) => `${item.bin} window ${item.left.toFixed(1)}% vs ${item.right.toFixed(1)}%`);
    const shapeZh = separation < 0.45 ? "主峰旁嘅線條權重較高。" : "分開嘅峰以百分比為主。";
    const shapeEn = separation < 0.45 ? "The shape beside the main peak carries more of the score." : "Separated peaks are scored mostly by percentage.";
    const curveZh = curveScore >= peakScore ? "對齊主峰之後，主峰以外嘅線條接近。" : "";
    const curveEn = curveScore >= peakScore ? "After aligning the main peak, the trace away from it is close." : "";
    return {
      zh: [bitsZh.join("。"), curveZh, shapeZh].filter(Boolean).join(""),
      en: [bitsEn.join(". "), curveEn, shapeEn].filter(Boolean).join(" "),
    };
  }
  const left = relativePeaks(query).filter((peak) => peak.percent >= 1).sort((a, b) => b.percent - a.percent);
  const right = relativePeaks(candidate);
  const bits = left.slice(0, 3).map((peak) => {
    const match = right.reduce<{ peak: TracePeak; distance: number } | null>((best, other) => {
      const distance = Math.abs(other.position - peak.position);
      if (distance > 22) return best;
      if (!best || distance < best.distance) return { peak: other, distance };
      return best;
    }, null);
    const at = Math.round((mainPeak(query)?.position ?? 0) + peak.position);
    if (!match) {
      return {
        zh: `遷移約 ${at} 有 ${peak.percent.toFixed(1)}%，對方冇對應峰`,
        en: `${peak.percent.toFixed(1)}% near migration ${at} has no counterpart`,
      };
    }
    return {
      zh: `遷移約 ${at}：${peak.percent.toFixed(1)}% 對 ${match.peak.percent.toFixed(1)}%`,
      en: `near migration ${at}: ${peak.percent.toFixed(1)}% vs ${match.peak.percent.toFixed(1)}%`,
    };
  });
  return {
    zh: bits.map((item) => item.zh).join("。"),
    en: bits.map((item) => item.en).join(". "),
  };
}

function separationAt(curve: number[], anchor: number): number {
  const maxima: { index: number; height: number }[] = [];
  for (let index = 2; index < curve.length - 2; index += 1) {
    if (curve[index] < 0.08) continue;
    if (curve[index] < curve[index - 1] || curve[index] < curve[index + 1]) continue;
    const previous = maxima[maxima.length - 1];
    if (previous && index - previous.index < 5) {
      if (curve[index] > previous.height) maxima[maxima.length - 1] = { index, height: curve[index] };
    } else {
      maxima.push({ index, height: curve[index] });
    }
  }
  const side = maxima.filter((peak) => Math.abs(peak.index - anchor) >= 6).sort((a, b) => b.height - a.height)[0];
  if (!side) return 0.25;
  const lo = Math.min(anchor, side.index);
  const hi = Math.max(anchor, side.index);
  let valley = curve[lo];
  for (let index = lo; index <= hi; index += 1) valley = Math.min(valley, curve[index]);
  return clamp(1 - valley / Math.max(side.height, 0.001), 0, 1);
}

function shiftCurve(curve: number[], from: number, to: number): number[] {
  const shift = to - from;
  const out = new Array<number>(curve.length).fill(0);
  for (let index = 0; index < curve.length; index += 1) {
    const target = index + shift;
    if (target >= 0 && target < out.length) out[target] = curve[index];
  }
  return out;
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function normalise(curve: number[]): number[] {
  const peak = curve.reduce((max, value) => Math.max(max, value), 0) || 1;
  return curve.map((value) => Math.max(0, value) / peak);
}

function argmax(curve: number[]): number {
  let best = 0;
  for (let index = 1; index < curve.length; index += 1) if (curve[index] > curve[best]) best = index;
  return best;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
