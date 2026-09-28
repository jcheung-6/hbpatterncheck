export const EXTRACTION_SCHEMA = {
  name: "hb_pattern_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "instrument_guess",
      "instrument_confidence",
      "readable",
      "unread_reason",
      "peaks",
      "quality_flags",
      "raw_ocr_text",
      "patient_identifiers_seen",
    ],
    properties: {
      instrument_guess: { type: "string", enum: ["variant_ii", "sebia_ce", "unknown"] },
      instrument_confidence: { type: "string", enum: ["high", "medium", "low"] },
      readable: { type: "boolean" },
      unread_reason: { type: "string" },
      peaks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name_or_label", "retention_or_migration", "percent", "zone_or_window", "notes"],
          properties: {
            name_or_label: { type: "string" },
            retention_or_migration: { type: "string" },
            percent: { type: "number" },
            zone_or_window: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
      quality_flags: {
        type: "object",
        additionalProperties: false,
        required: ["cut_off", "overloaded", "baseline_drift", "overlapping_peaks", "poor_resolution", "missing_scale"],
        properties: {
          cut_off: { type: "boolean" },
          overloaded: { type: "boolean" },
          baseline_drift: { type: "boolean" },
          overlapping_peaks: { type: "boolean" },
          poor_resolution: { type: "boolean" },
          missing_scale: { type: "boolean" },
        },
      },
      raw_ocr_text: { type: "string" },
      patient_identifiers_seen: { type: "boolean" },
    },
  },
} as const;

export const NARRATIVE_SCHEMA = {
  name: "hb_narrative",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["zh", "en", "extra_search_queries"],
    properties: {
      zh: { type: "string" },
      en: { type: "string" },
      extra_search_queries: { type: "array", items: { type: "string" } },
    },
  },
} as const;
