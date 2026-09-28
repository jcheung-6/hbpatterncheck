import { modelFallbackChain, modelNames, openRouterKeyStatus } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const key = openRouterKeyStatus();
  const model = modelNames().text;
  return Response.json({
    llm: key.present,
    model,
    key_conflict: key.conflict,
    fallbacks: modelFallbackChain(model).slice(1),
  });
}
