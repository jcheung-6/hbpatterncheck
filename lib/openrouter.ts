export class OpenRouterError extends Error {
  code: "missing_key" | "rate_limit" | "no_image_support" | "unauthorized" | "provider" | "bad_response";

  constructor(code: OpenRouterError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export type ChatContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatContent;
};

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function modelNames(): { text: string; vision: string } {
  const text = process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-flash";
  const vision = process.env.OPENROUTER_VISION_MODEL?.trim() || text;
  return { text, vision };
}

export function openRouterHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
    "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER?.trim() || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_TITLE?.trim() || "Hb Pattern Bench Chat",
    "Content-Type": "application/json",
  };
}

export async function openrouterChat(options: {
  messages: ChatMessage[];
  model?: string;
  responseFormat?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ content: string; model: string }> {
  if (!hasOpenRouterKey()) {
    throw new OpenRouterError("missing_key", "missing key");
  }
  const body: Record<string, unknown> = {
    model: options.model || modelNames().text,
    messages: options.messages,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 1800,
  };
  if (options.responseFormat) body.response_format = options.responseFormat;

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    throw new OpenRouterError("provider", "network");
  }

  const text = await response.text();
  if (!response.ok) {
    throw mapHttpError(response.status, text);
  }

  let parsed: { choices?: { message?: { content?: unknown } }[]; model?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new OpenRouterError("bad_response", "not json");
  }
  const content = messageText(parsed.choices?.[0]?.message?.content);
  if (!content.trim()) throw new OpenRouterError("bad_response", "empty");
  return { content, model: parsed.model || String(body.model) };
}

export async function openrouterJson(options: {
  messages: ChatMessage[];
  model?: string;
  schema: { name: string; strict: boolean; schema: object };
  temperature?: number;
  maxTokens?: number;
}): Promise<{ data: unknown; model: string }> {
  const attempts: Record<string, unknown>[] = [
    { type: "json_schema", json_schema: options.schema },
    { type: "json_object" },
  ];
  let last: unknown;
  for (const responseFormat of attempts) {
    try {
      const result = await openrouterChat({ ...options, responseFormat });
      return { data: parseModelJson(result.content), model: result.model };
    } catch (error) {
      last = error;
      if (error instanceof OpenRouterError && error.code !== "bad_response" && error.code !== "provider") {
        throw error;
      }
    }
  }
  try {
    const result = await openrouterChat(options);
    return { data: parseModelJson(result.content), model: result.model };
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    throw last instanceof OpenRouterError ? last : new OpenRouterError("provider", "json failed");
  }
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : trimmed;
  return JSON.parse(raw);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text ?? "") : ""))
      .join("\n");
  }
  return "";
}

function mapHttpError(status: number, body: string): OpenRouterError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new OpenRouterError("unauthorized", "auth");
  if (status === 429) return new OpenRouterError("rate_limit", "rate");
  if (
    lower.includes("image") ||
    lower.includes("vision") ||
    lower.includes("multimodal") ||
    lower.includes("image_url")
  ) {
    return new OpenRouterError("no_image_support", "vision");
  }
  return new OpenRouterError("provider", `http ${status}`);
}
