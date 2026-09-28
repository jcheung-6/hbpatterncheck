import { NextResponse } from "next/server";
import { extractTraceFile } from "@/lib/extractTrace";
import { seedById, seedTraces } from "@/lib/librarySeed";
import { readUserLibrary } from "@/lib/libraryStore";
import { rankTraces, shapeSummary, synthesizeCurve, type SimilarityTrace } from "@/lib/similarity";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { seedId?: string; libraryId?: string };
      const corpus = await corpusOf();
      const chosen = body.seedId
        ? seedById(body.seedId)
        : corpus.find((trace) => trace.id === body.libraryId && trace.source === "library") ?? null;
      if (!chosen) return NextResponse.json({ ok: false, errorZh: "搵唔到呢條線。", errorEn: "That trace was not found." }, { status: 400 });
      return NextResponse.json({
        ok: true,
        queries: [present(chosen, corpus, chosen.source === "library" ? "page" : "seed")],
      });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, errorZh: "請上載 PDF、PNG 或 JPEG。", errorEn: "Upload a PDF, PNG, or JPEG." }, { status: 400 });
    }
    const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
    const mime = typeof file.type === "string" ? file.type.toLowerCase() : "";
    const extension =
      name.endsWith(".pdf") || mime === "application/pdf" || mime === "application/x-pdf"
        ? ".pdf"
        : name.endsWith(".png") || mime === "image/png"
          ? ".png"
          : name.endsWith(".jpg") || name.endsWith(".jpeg") || mime === "image/jpeg"
            ? ".jpg"
            : "";
    if (!extension) {
      return NextResponse.json({ ok: false, errorZh: "只接受 PDF、PNG 或 JPEG。", errorEn: "Only PDF, PNG, or JPEG is accepted." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const extracted = await extractTraceFile(bytes, extension);
    if (!extracted.ok) {
      return NextResponse.json(
        {
          ok: false,
          errorZh: "讀唔到曲線或峰表。掃描要有 tesseract；數碼 PDF 要有 pymupdf。",
          errorEn: "The curve or peak table could not be read. Scans need tesseract; digital PDFs need pymupdf.",
          detail: extracted.error,
        },
        { status: 422 },
      );
    }
    const corpus = await corpusOf();
    const queries = extracted.traces.map((trace, index) =>
      present(
        {
          id: `q_${index}`,
          method: trace.method,
          peaks: trace.peaks,
          curve: trace.curve,
          axisStart: trace.axisStart,
          axisEnd: trace.axisEnd,
          source: "query",
        },
        corpus,
        trace.curve ? "page" : "peaks",
      ),
    );
    return NextResponse.json({ ok: true, warnings: extracted.warnings, queries });
  } catch {
    return NextResponse.json(
      { ok: false, errorZh: "搜尋失敗，峰冇被估造。", errorEn: "Search failed. Peaks were not invented." },
      { status: 500 },
    );
  }
}

async function corpusOf(): Promise<SimilarityTrace[]> {
  const user = await readUserLibrary();
  return [...seedTraces(), ...user];
}

function present(trace: SimilarityTrace, corpus: SimilarityTrace[], curveSource: "page" | "peaks" | "seed" = "seed") {
  const ranked = rankTraces(trace, corpus, 6);
  return {
    id: trace.id,
    method: trace.method,
    peaks: trace.peaks,
    axisStart: trace.axisStart,
    axisEnd: trace.axisEnd,
    curveSource,
    curve: trace.curve ?? synthesizeCurve(trace),
    alignedCurve: ranked.alignedQuery,
    summaryZh: shapeSummary(trace, "zh"),
    summaryEn: shapeSummary(trace, "en"),
    matches: ranked.matches.map((match) => ({
      ...match,
      score: Math.round(match.score * 100),
      peakScore: Math.round(match.peakScore * 100),
      curveScore: Math.round(match.curveScore * 100),
    })),
  };
}
