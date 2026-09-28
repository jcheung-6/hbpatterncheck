# 血紅蛋白圖譜台 · Hb Pattern Bench

Decision support for Hong Kong medical laboratory staff reading **Bio-Rad VARIANT II** HPLC chromatograms and **Sebia CAPILLARYS / CAPILLARYS 2 Flex Piercing** electropherograms.

It is **not a diagnostic device**. It does not assign a genotype, sign a report, or keep a patient archive. Images are processed for the current request only.

## What it does

1. Upload a chromatogram or electropherogram (PNG or JPEG, up to 4 MB), or paste the printed peak table.
2. A vision model on **OpenRouter** returns a strict JSON peak list. If the image is unclear, it asks for a clearer crop or the numbers. It does not invent peaks.
3. A local rule engine (`lib/interpret.ts`) plus `data/variants.json` ranks teaching patterns: β-thalassaemia trait, Hb E / EE / E/β, Hb H, Constant Spring–like peaks, Bart's, sickle and C/D/S windows, raised F, newborn and transfusion limits.
4. The reply is bilingual Traditional Chinese (Hong Kong) and English: closest pattern, differentials, pitfalls, suggested checks, and search links.
5. Follow-up questions stay in the browser session. Nothing is written to a database.

Without an API key, pasted numbers and the three demo cases still run on the rule engine. Demo images are **synthetic**. Until a key is set, opening a demo uses the built-in figures and says so. It does not pretend the picture was read.

## Run locally

```bash
npm install
npm run generate-demos   # already committed; rerun after editing data/demos.json
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

### OpenRouter key

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Put it in `.env.local` (server-side only — never `NEXT_PUBLIC_`):

```bash
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=google/gemini-2.5-flash
# optional, if you want a different model for images
OPENROUTER_VISION_MODEL=
```

3. Restart `npm run dev` from the `hbpatterncheck` folder. No quotes around the key, and no `Bearer` prefix.

The server reads `OPENROUTER_API_KEY` from `.env.local` when that line is set, even if the shell also exported a key. A header note appears when those two values differ. Hidden spaces and a trailing `Bearer` are stripped before the request. A Python check of `GET /api/v1/key` can still succeed when chat is blocked: HTTP 403 is not treated as a bad key unless OpenRouter says the key is invalid. The reply then includes OpenRouter’s own sentence.

All model calls go through `lib/openrouter.ts` to `https://openrouter.ai/api/v1/chat/completions`, with `Authorization`, `HTTP-Referer`, and `X-Title: Hb Pattern Bench Chat`. The browser never sees the key.

### Switch models

Change `OPENROUTER_MODEL` and restart. The vision step uses `OPENROUTER_VISION_MODEL` when that is set, otherwise the same model. The model must accept `image_url` parts (for example `google/gemini-2.5-flash` or `openai/gpt-4o`). If a model cannot read images, the page says so in Chinese and English.

The first call asks for JSON schema `hb_pattern_extraction`. If that model rejects `json_schema`, the server retries with JSON object mode and then checks the shape. Peaks that fail the check are dropped, not guessed.

Uploads are resized to a longest edge of 1280 px, re-encoded as JPEG, and stripped of EXIF before they leave the server. Files over 4 MB are rejected.

## Demo cases

| Case | Trace | Teaching point |
| --- | --- | --- |
| β-thalassaemia trait | Variant II, A2 5.5% | Raised A2 in the trait range. Not a genotype. Lepore shares the window. |
| Hb E trait | Variant II, A2 window 29.7% | Not “very high A2”. E co-elutes with A2 on this program. |
| Hb H with a slow peak | Capillarys, H in Z15 plus 1.3% in Z2 | Confirm Hb H/Constant Spring versus deletional Hb H. The small peak is not specific. |

Expected teaching notes are on each result, under **示範預期教學重點**.

## Add a variant to the knowledge base

Edit `data/variants.json`. Restart the dev server.

Thresholds (`thresholds`) and Variant II windows (`instruments.variant_ii_beta_short.windows`) are what the rule engine reads. Half-open ranges: a time of `3.90` min is the D window, not A2. Capillarys zones are documented on `instruments.sebia_capillarys_hb.zones`. Percent rules (what counts as trait versus EE, what a 1% Z2 peak means) live in `lib/interpret.ts` so a JSON edit cannot silently delete the “not a genotype” behaviour.

To surface a new variant in search and in the knowledge-base panel, add an object to `variants`:

```json
{
  "id": "hb_example",
  "name_en": "Hb Example",
  "name_zh": "血紅蛋白 Example",
  "gene": "HBB",
  "hgvs": "confirm on HbVar before quoting",
  "aliases": ["Hb Example", "Example"],
  "hk_note_en": "Where it is seen locally.",
  "hk_note_zh": "本地見到嘅情況。",
  "hplc_window": "S",
  "hplc_rt": "Often the S window; confirm on the local library.",
  "hplc_en": "What the Variant II β-thal short program usually does.",
  "hplc_zh": "Variant II β-地貧短程式通常點。",
  "ce_zones": "Confirm against the Sebia zone chart on the analyser.",
  "ce_en": "Capillarys behaviour.",
  "ce_zh": "毛細管電泳行為。",
  "pitfalls_en": ["Do not name it from one chromatogram."],
  "pitfalls_zh": ["不能單憑一張圖命名。"],
  "confirm_en": ["Second method", "DNA if the name is required"],
  "confirm_zh": ["第二種方法", "需要名稱先做 DNA"],
  "search_pubmed": ["Hb Example HPLC", "Hb Example Capillarys"],
  "search_hbvar": "Hb Example",
  "search_ithanet": "Hb Example"
}
```

Then add that `id` to `PATTERN_VARIANTS` in `lib/patterns.ts` for the pattern that should offer it. Aliases are used when someone asks “is this Hb Example?” in follow-up.

Window times and zone numbers in the starter file are a **teaching composite**, cited in the file and in the UI. They are not a substitute for the laboratory’s validated library or reference intervals. Joutovsky 2004 describes the earlier Bio-Rad VARIANT program, not a Variant II validation.

## Search links

For each candidate the app builds:

- PubMed: `https://pubmed.ncbi.nlm.nih.gov/?term=...`
- HbVar: [globin.bx.psu.edu/hbvar/menu.html](https://globin.bx.psu.edu/hbvar/menu.html) plus the query to type there
- IthaGenes: `https://www.ithanet.eu/db/ithagenes?query=...`

If NCBI is reachable, up to two PubMed queries are enriched with article titles. If it is not, the query string and the search URL are still shown. Copy buttons sit next to the queries.

## Tests

```bash
npm test
npm run build
```

## Limits

- No LIS, no stored cases, no login, no custom CNN.
- PDF pages are not rasterised. Export a PNG or JPEG.
- One method, one sample, cannot separate EE from E/β0, SS from S/β0, or prove α-thalassaemia trait.
- Iron deficiency, newborns, and transfusion are called out because they change A2 and the fractions.
- Do not upload names, HKID, or hospital numbers. The server refuses notes that look like identifiers and does not log image bytes. With a key, the image is still sent to OpenRouter for that request.

## Layout

- `app/api/interpret` — image or peak table → rules → optional bilingual note
- `app/api/chat` — questions with or without a trace. The model is asked to answer from the knowledge base; if that call fails, the reply says so and still includes the offline notes. It does not stop at “paste a peak table”.
- `app/api/status` — `{ llm, model }` for the header pill. It reports whether this server process loaded `OPENROUTER_API_KEY`. It never returns the key.
- `lib/openrouter.ts` — the only model client
- `lib/parsers/` — Variant II retention windows and Sebia zones
- `lib/interpret.ts` — pattern fit
- `data/variants.json` — editable windows, zones, and variant cards
- `public/demos/` — synthetic traces from `scripts/generate-demos.mjs`
