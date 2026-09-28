/** Holds one report across the client navigation from the interpret page to similar search. */

let pending: File | null = null;

export function setPendingReport(file: File): void {
  pending = file;
}

export function peekPendingReport(): File | null {
  return pending;
}

export function clearPendingReport(): void {
  pending = null;
}

export function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === "application/pdf" || file.type === "application/x-pdf" || name.endsWith(".pdf");
}

export const MAX_REPORT_BYTES = 12 * 1024 * 1024;
