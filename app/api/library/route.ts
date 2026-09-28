import { NextResponse } from "next/server";
import { seedTraces } from "@/lib/librarySeed";
import { addUserTraces, clearUserLibrary, readUserLibrary } from "@/lib/libraryStore";
import { shapeSummary } from "@/lib/similarity";

export const runtime = "nodejs";

export async function GET() {
  const user = await readUserLibrary();
  return NextResponse.json({
    ok: true,
    seeds: seedTraces().map(summarise),
    library: user.map(summarise),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { traces?: unknown[] };
  if (!Array.isArray(body.traces) || body.traces.length === 0 || body.traces.length > 4) {
    return NextResponse.json({ ok: false, errorZh: "沒有可加入嘅曲線。", errorEn: "There is no curve to add." }, { status: 400 });
  }
  const added = await addUserTraces(body.traces);
  if (!added.length) {
    return NextResponse.json({ ok: false, errorZh: "曲線格式不完整，沒有加入。", errorEn: "The curve was incomplete and was not added." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, added: added.map(summarise) });
}

export async function DELETE() {
  await clearUserLibrary();
  return NextResponse.json({ ok: true });
}

function summarise(trace: { id: string; method: "variant_ii" | "sebia_ce"; peaks: { name: string; position: number; percent: number }[]; source: "seed" | "library" | "query" }) {
  return {
    id: trace.id,
    method: trace.method,
    source: trace.source,
    summaryZh: shapeSummary(trace, "zh"),
    summaryEn: shapeSummary(trace, "en"),
    peaks: trace.peaks,
  };
}
