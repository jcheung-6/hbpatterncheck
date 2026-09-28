import { errorBody } from "@/lib/errors";
import { runFollowUp } from "@/lib/pipeline";
import { enrichPubmed } from "@/lib/search";
import type { RuleResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    question?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    rule?: RuleResult | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(errorBody("bad_request"), { status: 400 });
  }
  if (!body.question?.trim()) return Response.json(errorBody("bad_request"), { status: 400 });
  try {
    const result = await runFollowUp({
      question: body.question,
      history: Array.isArray(body.history) ? body.history : [],
      rule: body.rule ?? null,
    });
    if (!result.ok) return Response.json(result, { status: 400 });
    const searches = await enrichPubmed(result.searches);
    return Response.json({ ...result, searches });
  } catch {
    return Response.json(errorBody("provider"), { status: 502 });
  }
}
