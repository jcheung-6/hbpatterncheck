const HKID = /\b[A-Z]{1,2}\d{6}\([0-9A]\)/i;
const LABELED_ID =
  /(?:姓名|病人姓名|patient\s*name|mrn|hospital\s*(?:no|number)|住院號|病歷號|hkid|身份證(?:號碼)?|id\s*(?:no\.?|number))\s*[:：]/i;
const STRUCTURED_NUMBER = /\b(?:HN|MRN|PID)\s*[:#]?\s*\d{5,}\b/i;

export function containsIdentifier(text: string): boolean {
  return HKID.test(text) || LABELED_ID.test(text) || STRUCTURED_NUMBER.test(text);
}

export function redactIdentifiers(text: string): { text: string; redacted: boolean } {
  if (!text) return { text: "", redacted: false };
  let next = text;
  let redacted = false;
  if (HKID.test(next) || LABELED_ID.test(next) || STRUCTURED_NUMBER.test(next)) {
    redacted = true;
  }
  next = next.replace(HKID, "[removed]");
  next = next.replace(STRUCTURED_NUMBER, "[removed]");
  next = next
    .split("\n")
    .map((line) => (LABELED_ID.test(line) ? "[removed]" : line))
    .join("\n");
  return { text: next, redacted };
}
