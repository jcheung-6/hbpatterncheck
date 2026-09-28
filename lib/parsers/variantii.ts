import { kb, type WindowDef } from "@/lib/kb";

export function variantWindows(): WindowDef[] {
  return kb.instruments.variant_ii_beta_short.windows;
}

/** Half-open ranges [start, end). A retention on a boundary belongs to the later window. */
export function windowForRetention(rt: number, windows: WindowDef[] = variantWindows()): string | null {
  const hit = windows.find((window) => rt >= window.rt_start && rt < window.rt_end);
  return hit?.id ?? null;
}
