import { kb } from "@/lib/kb";

export function sebiaZones(): string[] {
  return kb.instruments.sebia_capillarys_hb.zones.map((zone) => zone.id);
}

export function isSebiaZone(value: string | null): value is string {
  return !!value && sebiaZones().includes(value);
}
