import { modelNames, openRouterKeyStatus } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const key = openRouterKeyStatus();
  return Response.json({
    llm: key.present,
    model: modelNames().text,
    key_conflict: key.conflict,
  });
}
