import type { PeakKind } from "@/lib/types";

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function parseZone(text: string): string | null {
  const match = text.match(/\bZ\s*(\d{1,2})\b/i) || text.match(/\bzone\s*(\d{1,2})\b/i);
  if (!match) return null;
  const zone = Number(match[1]);
  if (zone >= 1 && zone <= 15) return `Z${zone}`;
  return null;
}

export function parseWindowToken(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  if (/\bvoid\b|pre-?\s*f|before\s*f/.test(value)) return "VOID";
  if (/\bp\s*2\b|\bp2\b/.test(value)) return "P2";
  if (/\bp\s*3\b|\bp3\b/.test(value)) return "P3";
  if (/\ba\s*0\b|\ba0\b|\bao\b/.test(value)) return "A0";
  if (/\ba\s*2\b|\ba2\b/.test(value)) return "A2";
  if (/\bd\s*[- ]?window\b|\bwindow\s*d\b|^d$/.test(value)) return "D";
  if (/\bs\s*[- ]?window\b|\bwindow\s*s\b|^s$/.test(value)) return "S";
  if (/\bc\s*[- ]?window\b|\bwindow\s*c\b|^c$/.test(value)) return "C";
  if (/\bf\s*[- ]?window\b|\bwindow\s*f\b|^f$/.test(value)) return "F";
  return null;
}

export function parseRetentionMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || /^z\s*\d+/i.test(trimmed) || /\bzone\b/i.test(trimmed)) return null;
  const match = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (value > 0 && value < 20) return value;
  return null;
}

export function classifyLabel(label: string): PeakKind {
  const value = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return "UNKNOWN";
  if (/window/.test(value) && !/\bhb\b/.test(value)) return "UNKNOWN";
  if (/constant\s*spring|(^|\s)cs$|(^|\s)cs\b|cs-like|常量泉/.test(value)) return "CS";
  if (/bart/.test(value)) return "BARTS";
  if (/o-?\s*arab/.test(value)) return "O_ARAB";
  if (/lepore/.test(value)) return "LEPORE";
  if (/hope/.test(value)) return "HOPE";
  if (/j-bangkok|(^|\s)j$|\bhbj\b|\bhb j\b/.test(value)) return "J";
  if (/q-thailand|(^|\s)q$|\bhb q\b/.test(value)) return "Q";
  if (/^p\s*2$|\bp2\b|a1c|glycated/.test(value)) return "P2";
  if (/^p\s*3$|\bp3\b/.test(value)) return "P3";
  if (/^f$|\bhb f\b|\bhbf\b|fetal/.test(value)) return "F";
  if (/a\s*2|a₂|\bhba2\b/.test(value)) return "A2";
  if (/^e$|\bhb e\b/.test(value)) return "E";
  if (/^s$|\bhb s\b|sickle/.test(value)) return "S";
  if (/^c$|\bhb c\b/.test(value)) return "C";
  if (/^d$|\bhb d\b|d-punjab|d-los/.test(value)) return "D";
  if (/^h$|\bhb h\b/.test(value)) return "H";
  if (/^a0$|^ao$|\ba0\b|\bao\b|\bhba0\b/.test(value)) return "A";
  if (/^a$|\bhb a\b/.test(value)) return "A";
  return "UNKNOWN";
}
