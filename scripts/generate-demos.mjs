import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const demos = JSON.parse(readFileSync(join(root, "data/demos.json"), "utf8"));
const outDir = join(root, "public/demos");
mkdirSync(outDir, { recursive: true });

const HPLC_BANDS = [
  ["VOID", 0.05, 0.98, "#ece7df"],
  ["F", 0.98, 1.22, "#d7ebe3"],
  ["P2", 1.22, 1.5, "#e4dff2"],
  ["P3", 1.5, 1.95, "#f3e4d2"],
  ["A0", 1.95, 3.2, "#d5e4f0"],
  ["A2", 3.2, 3.9, "#f6d5cf"],
  ["D", 3.9, 4.3, "#e4efd4"],
  ["S", 4.3, 4.7, "#f7e6c2"],
  ["C", 4.9, 5.5, "#e5ddef"],
];

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function retention(peak) {
  const match = String(peak.retention_or_migration).match(/(\d+(?:\.\d+)?)\s*min/i);
  return match ? Number(match[1]) : null;
}

function zoneNumber(peak) {
  const match = `${peak.zone_or_window} ${peak.retention_or_migration}`.match(/Z\s*(\d{1,2})/i);
  return match ? Number(match[1]) : null;
}

function gaussianPath(samples, xOf, yBase, yOf) {
  let d = `M ${xOf(samples[0][0]).toFixed(1)} ${yBase}`;
  for (const [x, y] of samples) d += ` L ${xOf(x).toFixed(1)} ${yOf(y).toFixed(1)}`;
  d += ` L ${xOf(samples[samples.length - 1][0]).toFixed(1)} ${yBase} Z`;
  return d;
}

function draw(demo) {
  const hplc = demo.instrument !== "sebia_ce";
  const width = 1400;
  const height = 900;
  const plot = { x: 70, y: 120, w: 860, h: 520 };
  const yBase = plot.y + plot.h - 36;
  const title = hplc
    ? "Bio-Rad VARIANT II  ·  β-Thalassemia Short Program (simulated)"
    : "Sebia CAPILLARYS 2 Flex Piercing  ·  HEMOGLOBIN(E) (simulated)";
  const peaks = demo.peaks.map((peak) => {
    const position = hplc ? retention(peak) : zoneNumber(peak);
    return { ...peak, position: position ?? 0 };
  });
  const maxAmp = Math.max(...peaks.map((peak) => Math.pow(peak.percent, 0.55)));
  const xOf = (value) => {
    if (hplc) return plot.x + ((value - 0) / 6) * (plot.w - 20);
    return plot.x + ((value - 0.5) / 15) * (plot.w - 20);
  };
  const yOf = (amp) => yBase - (amp / maxAmp) * (plot.h - 90);

  const bands = hplc
    ? HPLC_BANDS.map(([id, start, end, fill]) => {
        const x1 = xOf(start);
        const x2 = xOf(end);
        return `<rect x="${x1}" y="${plot.y}" width="${x2 - x1}" height="${plot.h - 36}" fill="${fill}" />
          <text x="${(x1 + x2) / 2}" y="${plot.y + 22}" text-anchor="middle" font-size="14" fill="#3d4a55">${id}</text>`;
      }).join("")
    : Array.from({ length: 15 }, (_, index) => {
        const zone = index + 1;
        const x1 = xOf(zone - 0.5);
        const x2 = xOf(zone + 0.5);
        const fill = zone % 2 ? "#f7f4ee" : "#ece6da";
        return `<rect x="${x1}" y="${plot.y}" width="${x2 - x1}" height="${plot.h - 36}" fill="${fill}" />
          <text x="${(x1 + x2) / 2}" y="${plot.y + 22}" text-anchor="middle" font-size="13" fill="#3d4a55">Z${zone}</text>`;
      }).join("");

  const curves = peaks
    .map((peak, index) => {
      const sigma = hplc ? (peak.percent > 40 ? 0.09 : 0.045) : peak.percent > 40 ? 0.42 : 0.28;
      const amp = Math.pow(peak.percent, 0.55);
      const samples = [];
      const span = hplc ? 0.7 : 2.2;
      for (let i = 0; i <= 80; i += 1) {
        const x = peak.position - span + (2 * span * i) / 80;
        const y = amp * Math.exp(-0.5 * ((x - peak.position) / sigma) ** 2);
        samples.push([x, y]);
      }
      const color = ["#0e4f5c", "#8c3f2a", "#1d5c40", "#3d4d88", "#8a5a12"][index % 5];
      return `<path d="${gaussianPath(samples, xOf, yBase, yOf)}" fill="${color}" fill-opacity="0.78" stroke="${color}" />
        <text x="${xOf(peak.position)}" y="${yOf(amp) - 8}" text-anchor="middle" font-size="15" fill="#1c2430">${escapeXml(peak.name_or_label)} ${peak.percent}%</text>`;
    })
    .join("");

  const rows = peaks
    .map((peak, index) => {
      const y = 210 + index * 54;
      const where = hplc ? `${retention(peak)?.toFixed(2)} min` : peak.zone_or_window;
      return `<text x="980" y="${y}" font-size="22" fill="#1c2430">${escapeXml(peak.name_or_label)}</text>
        <text x="1120" y="${y}" font-size="22" fill="#1c2430">${escapeXml(where)}</text>
        <text x="1280" y="${y}" font-size="26" font-weight="700" fill="#0e4f5c">${peak.percent.toFixed(1)}%</text>`;
    })
    .join("");

  const axis = hplc
    ? [0, 1, 2, 3, 4, 5, 6]
        .map(
          (minute) =>
            `<text x="${xOf(minute)}" y="${yBase + 28}" text-anchor="middle" font-size="14" fill="#3d4a55">${minute}</text>`,
        )
        .join("") + `<text x="${plot.x + plot.w / 2}" y="${height - 36}" text-anchor="middle" font-size="16" fill="#3d4a55">Retention time (min), synthetic</text>`
    : `<text x="${plot.x + plot.w / 2}" y="${height - 36}" text-anchor="middle" font-size="16" fill="#3d4a55">Zone Z1 (slow) to Z15 (fast), synthetic</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#fffdf8"/>
  <text x="70" y="48" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="28" font-weight="700" fill="#8c3f2a">SYNTHETIC TEACHING TRACE — NOT A PATIENT</text>
  <text x="70" y="82" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="20" fill="#1c2430">${escapeXml(title)}</text>
  <g font-family="DejaVu Sans, Liberation Sans, sans-serif">
    ${bands}
    <line x1="${plot.x}" y1="${yBase}" x2="${plot.x + plot.w - 20}" y2="${yBase}" stroke="#1c2430" stroke-width="1.4"/>
    ${curves}
    ${axis}
    <text x="980" y="160" font-size="18" fill="#5e6874">PEAK TABLE (use these numbers)</text>
    ${rows}
  </g>
  <text x="70" y="${height - 18}" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="15" fill="#5e6874">No name, identity number, or hospital number. Invented percentages for software demonstration only.</text>
</svg>`;
}

for (const demo of demos.cases) {
  const svg = draw(demo);
  const file = join(outDir, demo.image.split("/").pop());
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log(file);
}
