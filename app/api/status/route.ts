import { hasOpenRouterKey, modelNames } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    llm: hasOpenRouterKey(),
    model: modelNames().text,
  });
}
