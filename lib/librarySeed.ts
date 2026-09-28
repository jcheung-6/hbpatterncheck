import { synthesizeCurve, type SimilarityTrace, type TracePeak } from "@/lib/similarity";

type SeedInput = {
  id: string;
  method: SimilarityTrace["method"];
  axisStart: number;
  axisEnd: number;
  peaks: TracePeak[];
};

const SEEDS: SeedInput[] = [
  {
    id: "seed-vii-normal",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.12, percent: 0.5 },
      { name: "P2", position: 1.34, percent: 3.4 },
      { name: "P3", position: 1.7, percent: 3.7 },
      { name: "A0", position: 2.46, percent: 89.6 },
      { name: "A2", position: 3.6, percent: 2.8 },
    ],
  },
  {
    id: "seed-vii-normal-2",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.15, percent: 0.4 },
      { name: "P2", position: 1.36, percent: 4.1 },
      { name: "P3", position: 1.68, percent: 4.0 },
      { name: "A0", position: 2.51, percent: 88.4 },
      { name: "A2", position: 3.63, percent: 3.1 },
    ],
  },
  {
    id: "seed-vii-beta",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.1, percent: 0.8 },
      { name: "P2", position: 1.33, percent: 3.4 },
      { name: "P3", position: 1.7, percent: 3.9 },
      { name: "A0", position: 2.47, percent: 86.4 },
      { name: "A2", position: 3.65, percent: 5.5 },
    ],
  },
  {
    id: "seed-vii-beta-2",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.11, percent: 1.2 },
      { name: "P2", position: 1.32, percent: 3.1 },
      { name: "P3", position: 1.69, percent: 3.6 },
      { name: "A0", position: 2.44, percent: 85.2 },
      { name: "A2", position: 3.66, percent: 6.9 },
    ],
  },
  {
    id: "seed-vii-a2-large",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.11, percent: 0.6 },
      { name: "P2", position: 1.32, percent: 3.1 },
      { name: "P3", position: 1.69, percent: 3.8 },
      { name: "A0", position: 2.48, percent: 62.8 },
      { name: "A2", position: 3.67, percent: 29.7 },
    ],
  },
  {
    id: "seed-vii-s-window",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.1, percent: 0.9 },
      { name: "P2", position: 1.33, percent: 2.4 },
      { name: "P3", position: 1.7, percent: 2.8 },
      { name: "A0", position: 2.45, percent: 55.4 },
      { name: "A2", position: 3.62, percent: 3.4 },
      { name: "S", position: 4.5, percent: 35.1 },
    ],
  },
  {
    id: "seed-vii-p3-shoulder",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.08, percent: 0.4 },
      { name: "Unknown", position: 1.22, percent: 1.9 },
      { name: "P2", position: 1.32, percent: 4.4 },
      { name: "Unknown", position: 1.48, percent: 1.6 },
      { name: "P3", position: 1.75, percent: 6.1 },
      { name: "A0", position: 2.43, percent: 83.1 },
      { name: "A2", position: 3.61, percent: 2.5 },
    ],
  },
  {
    id: "seed-vii-a0-left-base",
    method: "variant_ii",
    axisStart: 0,
    axisEnd: 6,
    peaks: [
      { name: "F", position: 1.12, percent: 0.5 },
      { name: "P2", position: 1.35, percent: 3.5 },
      { name: "P3", position: 1.72, percent: 3.4 },
      { name: "Unknown", position: 2.12, percent: 7.2 },
      { name: "A0", position: 2.4, percent: 82.6 },
      { name: "A2", position: 3.58, percent: 2.8 },
    ],
  },
  {
    id: "seed-sebia-normal",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "A", position: 140, percent: 97.4 },
      { name: "A2", position: 248, percent: 2.6 },
    ],
  },
  {
    id: "seed-sebia-normal-2",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "A", position: 136, percent: 97.0 },
      { name: "A2", position: 252, percent: 3.0 },
    ],
  },
  {
    id: "seed-sebia-split-right",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "A", position: 134, percent: 92.0 },
      { name: "peak", position: 202, percent: 2.6 },
      { name: "peak", position: 255, percent: 5.4 },
    ],
  },
  {
    id: "seed-sebia-split-right-2",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "A", position: 138, percent: 90.5 },
      { name: "peak", position: 198, percent: 3.1 },
      { name: "peak", position: 250, percent: 6.4 },
    ],
  },
  {
    id: "seed-sebia-a2-raised",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "A", position: 140, percent: 94.2 },
      { name: "A2", position: 250, percent: 5.8 },
    ],
  },
  {
    id: "seed-sebia-fast",
    method: "sebia_ce",
    axisStart: 0,
    axisEnd: 300,
    peaks: [
      { name: "H", position: 32, percent: 10.2 },
      { name: "A", position: 140, percent: 86.4 },
      { name: "A2", position: 248, percent: 1.4 },
      { name: "peak", position: 278, percent: 2.0 },
    ],
  },
];

export function seedTraces(): SimilarityTrace[] {
  return SEEDS.map((seed) => ({
    id: seed.id,
    method: seed.method,
    peaks: seed.peaks,
    axisStart: seed.axisStart,
    axisEnd: seed.axisEnd,
    source: "seed" as const,
    curve: synthesizeCurve(seed),
  }));
}

export function seedById(id: string): SimilarityTrace | null {
  return seedTraces().find((trace) => trace.id === id) ?? null;
}
