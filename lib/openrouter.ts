import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export class OpenRouterError extends Error {
  code: "missing_key" | "rate_limit" | "no_image_support" | "unauthorized" | "provider" | "bad_response";
  detail: string;

  constructor(code: OpenRouterError["code"], message: string, detail = "") {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export type ChatContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatContent;
};

export function normalizeOpenRouterKey(raw: string): string {
  let key = raw.replace(/^\uFEFF/, "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^Bearer\s+/i, "");
  key = key.replace(/\s+/g, "");
  return key;
}

export function keyFromEnvText(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/);
    if (!match) continue;
    const key = normalizeOpenRouterKey(match[1]);
    if (key) return key;
  }
  return "";
}

function keyFromEnvFiles(): string {
  for (const name of [".env.local", ".env"]) {
    try {
      const text = readFileSync(path.join(process.cwd(), name), "utf8");
      const key = keyFromEnvText(text);
      if (key) return key;
    } catch {
      /* file missing */
    }
  }
  return "";
}

export function openRouterKeyStatus(): { present: boolean; conflict: boolean } {
  const fromFile = keyFromEnvFiles();
  const fromProcess = normalizeOpenRouterKey(process.env.OPENROUTER_API_KEY ?? "");
  return {
    present: Boolean(fromFile || fromProcess),
    conflict: Boolean(fromFile && fromProcess && fromFile !== fromProcess),
  };
}

export function openRouterApiKey(): string {
  return keyFromEnvFiles() || normalizeOpenRouterKey(process.env.OPENROUTER_API_KEY ?? "");
}

export function hasOpenRouterKey(): boolean {
  return openRouterKeyStatus().present;
}

export function modelNames(): { text: string; vision: string } {
  const text = process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-flash";
  const vision = process.env.OPENROUTER_VISION_MODEL?.trim() || text;
  return { text, vision };
}

export function openRouterHeaders(): Record<string, string> {
  const title = process.env.OPENROUTER_APP_TITLE?.trim() || "Hb Pattern Bench Chat";
  return {
    Authorization: `Bearer ${openRouterApiKey()}`,
    "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER?.trim() || "http://localhost:3000",
    "X-Title": title,
    "X-OpenRouter-Title": title,
    "Content-Type": "application/json",
    "User-Agent": "HbPatternBench/0.1",
  };
}

export function providerMessage(body: string): string {
  const trimmed = body.trim();
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown } | string };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    if (typeof message === "string" && message.trim()) return sanitizeProviderText(message);
  } catch {
    /* HTML or plain text */
  }
  const text = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return sanitizeProviderText(text.slice(0, 180));
}

function sanitizeProviderText(text: string): string {
  return text
    .replace(/sk-or-[A-Za-z0-9_-]+/gi, "[key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function classifyOpenRouterFailure(status: number, body: string): {
  code: OpenRouterError["code"];
  message: string;
  detail: string;
  retryWithCurl: boolean;
} {
  const detail = providerMessage(body);
  const lower = `${detail} ${body}`.toLowerCase();
  const invalidKey = /invalid api key|user not found|key revoked|key disabled|invalid credentials/.test(lower);
  const blocked = /security policy|cloudflare|attention required|just a moment/.test(lower);
  if (status === 401 || invalidKey) {
    return { code: "unauthorized", message: "auth", detail: detail || "401", retryWithCurl: status === 401 && !invalidKey };
  }
  if (status === 402 || /insufficient credits|payment required/.test(lower)) {
    return { code: "provider", message: "credits", detail: detail || "402", retryWithCurl: false };
  }
  if (status === 403 && blocked) {
    return { code: "provider", message: "blocked", detail: detail || "403", retryWithCurl: true };
  }
  if (status === 403) {
    return { code: "provider", message: "forbidden", detail: detail || "403", retryWithCurl: !/request blocked|guardrail|moderation/.test(lower) };
  }
  if (status === 429) return { code: "rate_limit", message: "rate", detail: detail || "429", retryWithCurl: false };
  if (lower.includes("image") || lower.includes("vision") || lower.includes("multimodal") || lower.includes("image_url")) {
    return { code: "no_image_support", message: "vision", detail: detail || "vision", retryWithCurl: false };
  }
  return { code: "provider", message: `http ${status}`, detail, retryWithCurl: false };
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

  let status: number;
  let text: string;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify(body),
    });
    status = response.status;
    text = await response.text();
  } catch {
    throw new OpenRouterError("provider", "network");
  }

  if (!statusOk(status) && classifyOpenRouterFailure(status, text).retryWithCurl) {
    const retried = await curlChat(JSON.stringify(body));
    if (retried) {
      status = retried.status;
      text = retried.text;
    }
  }

  if (!statusOk(status)) {
    const failure = classifyOpenRouterFailure(status, text);
    throw new OpenRouterError(failure.code, failure.message, failure.detail);
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

function statusOk(status: number): boolean {
  return status >= 200 && status < 300;
}

async function curlChat(payload: string): Promise<{ status: number; text: string } | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "hb-or-"));
  const bodyPath = path.join(dir, "body.json");
  const cfgPath = path.join(dir, "curl.cfg");
  try {
    await writeFile(bodyPath, payload, { mode: 0o600 });
    const headers = Object.entries(openRouterHeaders())
      .map(([name, value]) => `header = "${name}: ${value.replace(/[\r\n"]/g, "")}"`)
      .join("\n");
    await writeFile(cfgPath, `${headers}\ndata-binary = "@${bodyPath}"\n`, { mode: 0o600 });
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "curl",
        ["--config", cfgPath, "--max-time", "90", "-sS", "-X", "POST", "-w", "\n%{http_code}", "https://openrouter.ai/api/v1/chat/completions"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => {
        out += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        err += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && !out) reject(new Error(err.slice(0, 200) || "curl"));
        else resolve(out);
      });
    });
    const trimmed = stdout.replace(/\s*$/, "");
    const breakAt = trimmed.lastIndexOf("\n");
    if (breakAt < 0) return null;
    const status = Number(trimmed.slice(breakAt + 1));
    if (!Number.isInteger(status)) return null;
    return { status, text: trimmed.slice(0, breakAt) };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
