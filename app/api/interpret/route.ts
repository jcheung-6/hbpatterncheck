import { errorBody } from "@/lib/errors";
import { runInterpretation } from "@/lib/pipeline";
import { enrichPubmed } from "@/lib/search";
import type { InstrumentChoice } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    notes?: string;
    instrument?: InstrumentChoice;
    demoId?: string | null;
    images?: { mime?: string; data_base64?: string }[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(errorBody("bad_request"), { status: 400 });
  }
  const images = Array.isArray(body.images)
    ? body.images
        .filter((image) => typeof image?.data_base64 === "string" && image.data_base64.length > 0)
        .slice(0, 3)
        .map((image) => ({ mime: image.mime || "image/jpeg", data_base64: image.data_base64 as string }))
    : [];
  try {
    const result = await runInterpretation({
      notes: typeof body.notes === "string" ? body.notes : "",
      instrument: body.instrument,
      demoId: body.demoId,
      images,
    });
    if (!result.ok) {
      const status = result.error.code === "identifiers" || result.error.code === "bad_request" ? 400 : 502;
      if (result.error.code === "missing_key" || result.error.code === "file_too_large" || result.error.code === "bad_image") {
        return Response.json(result, { status: 400 });
      }
      return Response.json(result, { status });
    }
    const searches = await enrichPubmed(result.searches);
    return Response.json({ ...result, searches });
  } catch {
    return Response.json(errorBody("unreadable"), { status: 502 });
  }
}
