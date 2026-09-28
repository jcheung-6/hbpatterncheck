"use client";

import { useEffect, useMemo, useState } from "react";
import demos from "@/data/demos.json";
import { ResultView } from "@/components/ResultView";
import { kb } from "@/lib/kb";
import { DISCLAIMER_EN, DISCLAIMER_ZH, copy, limits } from "@/lib/i18n";
import { containsIdentifier } from "@/lib/redact";
import { parsePeakTable } from "@/lib/table";
import type { InstrumentChoice, InterpretOk, RuleResult, SearchHit } from "@/lib/types";

type Locale = "zh" | "en";
type LocalImage = { name: string; url: string; dataUrl: string };
type Turn =
  | { id: string; kind: "user"; text: string; images: { name: string; url: string }[] }
  | { id: string; kind: "result"; payload: InterpretOk; teaching?: { zh: string; en: string } }
  | { id: string; kind: "note"; zh: string; en: string; searches: SearchHit[]; source: "template" | "openrouter"; model: string | null }
  | { id: string; kind: "error"; zh: string; en: string };

const MAX_BYTES = 4 * 1024 * 1024;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function fileToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("blob");
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

export function BenchApp() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [instrument, setInstrument] = useState<InstrumentChoice>("auto");
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<LocalImage[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState("");
  const [llm, setLlm] = useState<{ llm: boolean; model: string; conflict: boolean; fallbacks: string[] } | null>(null);
  const t = copy[locale];

  useEffect(() => {
    const saved = window.localStorage.getItem("hbbench-locale");
    if (saved === "en" || saved === "zh") setLocale(saved);
  }, []);

  useEffect(() => {
    void fetch("/api/status")
      .then((response) => response.json())
      .then((body: { llm?: unknown; model?: unknown; key_conflict?: unknown; fallbacks?: unknown }) => {
        if (typeof body.llm === "boolean" && typeof body.model === "string") {
          setLlm({
            llm: body.llm,
            model: body.model,
            conflict: body.key_conflict === true,
            fallbacks: Array.isArray(body.fallbacks) ? body.fallbacks.filter((item): item is string => typeof item === "string") : [],
          });
        }
      })
      .catch(() => setLlm(null));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-HK" : "en";
    window.localStorage.setItem("hbbench-locale", locale);
  }, [locale]);

  const lastRule: RuleResult | null = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.kind === "result") return turn.payload.rule;
    }
    return null;
  }, [turns]);

  async function addFiles(list: File[]) {
    const next: LocalImage[] = [];
    for (const file of list) {
      if (images.length + next.length >= 3) {
        setBanner(t.tooMany);
        break;
      }
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        setBanner(t.pdf);
        continue;
      }
      if (!file.type.startsWith("image/")) continue;
      if (file.size > MAX_BYTES) {
        setBanner(t.tooBig);
        continue;
      }
      const dataUrl = await fileToJpeg(file);
      next.push({ name: file.name, url: URL.createObjectURL(file), dataUrl });
    }
    if (next.length) setImages((current) => [...current, ...next].slice(0, 3));
  }

  async function run(options?: { demoId?: string; notes?: string; instrument?: InstrumentChoice; files?: LocalImage[] }) {
    const text = options?.notes ?? notes;
    if (containsIdentifier(text)) {
      setTurns((current) => [...current, { id: uid(), kind: "error", zh: copy.zh.noPhi, en: copy.en.noPhi }]);
      return;
    }
    const files = options?.files ?? images;
    const demoId = options?.demoId;
    const chosen = options?.instrument ?? instrument;
    const pasted = parsePeakTable(text);
    const useInterpret = Boolean(demoId) || files.length > 0 || pasted.length >= 2 || (pasted.length >= 1 && !lastRule);
    setBusy(true);
    setBanner("");
    setTurns((current) => [
      ...current,
      { id: uid(), kind: "user", text, images: files.map((file) => ({ name: file.name, url: file.url })) },
    ]);
    try {
      if (useInterpret) {
        const response = await fetch("/api/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: text,
            instrument: chosen,
            demoId: demoId ?? null,
            images: files.map((file) => ({ mime: "image/jpeg", data_base64: file.dataUrl.split(",")[1] || "" })),
          }),
        });
        const body = (await response.json()) as InterpretOk | { ok: false; error: { zh: string; en: string } };
        if (!body.ok) {
          setTurns((current) => [...current, { id: uid(), kind: "error", zh: body.error.zh, en: body.error.en }]);
        } else {
          const demo = demos.cases.find((item) => item.id === demoId);
          setTurns((current) => [
            ...current,
            {
              id: uid(),
              kind: "result",
              payload: body,
              teaching: demo ? { zh: demo.teaching_zh, en: demo.teaching_en } : undefined,
            },
          ]);
        }
      } else {
        const history = turns
          .filter((turn) => turn.kind === "user" || turn.kind === "note")
          .slice(-6)
          .map((turn) =>
            turn.kind === "user"
              ? { role: "user" as const, content: turn.text }
              : { role: "assistant" as const, content: `${turn.zh}\n${turn.en}` },
          );
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text, history, rule: lastRule }),
        });
        const body = (await response.json()) as
          | { ok: true; zh: string; en: string; searches: SearchHit[]; source?: "template" | "openrouter"; model?: string | null }
          | { ok: false; error: { zh: string; en: string } };
        if (!body.ok) {
          setTurns((current) => [...current, { id: uid(), kind: "error", zh: body.error.zh, en: body.error.en }]);
        } else {
          setTurns((current) => [
            ...current,
            {
              id: uid(),
              kind: "note",
              zh: body.zh,
              en: body.en,
              searches: body.searches,
              source: body.source === "openrouter" ? "openrouter" : "template",
              model: typeof body.model === "string" ? body.model : null,
            },
          ]);
        }
      }
    } catch {
      setTurns((current) => [
        ...current,
        {
          id: uid(),
          kind: "error",
          zh: "網絡或伺服器錯誤。峰沒有被估造。",
          en: "Network or server error. Peaks were not invented.",
        },
      ]);
    } finally {
      setBusy(false);
      if (!options?.demoId) setNotes("");
    }
  }

  async function openDemo(id: string) {
    const demo = demos.cases.find((item) => item.id === id);
    if (!demo) return;
    try {
      const chosen: InstrumentChoice = demo.instrument === "sebia_ce" ? "sebia" : "variant_ii";
      setInstrument(chosen);
      const note = locale === "zh" ? demo.notes_zh : demo.notes_en;
      setNotes(note);
      const response = await fetch(demo.image);
      if (!response.ok) throw new Error("demo image");
      const blob = await response.blob();
      const file = new File([blob], demo.image.split("/").pop() || "demo.png", { type: blob.type || "image/png" });
      const dataUrl = await fileToJpeg(file);
      const local = { name: file.name, url: URL.createObjectURL(file), dataUrl };
      setImages([local]);
      await run({ demoId: id, notes: note, instrument: chosen, files: [local] });
    } catch {
      setBanner(locale === "zh" ? "示範圖像讀唔到。" : "The demo image could not be loaded.");
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 26 26">
              <path d="M3 18c3-1 4-8 6-8s2 10 4 10 2-14 4-14 2 6 6 5" fill="none" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </div>
          <div>
            <h1>{t.title}</h1>
            <p className="sub">
              {t.subtitle} · <a href="/similar">{locale === "zh" ? "相似圖譜" : "Similar traces"}</a>
            </p>
          </div>
        </div>
        <div className="lang" role="group" aria-label={t.language}>
          {llm ? (
            <span
              className={llm.llm ? "pill on" : "pill off"}
              title={llm.fallbacks.length ? `${llm.model}. ${t.llmFallback} ${llm.fallbacks.join(", ")}` : llm.model}
            >
              {llm.llm ? `${t.llmOn} · ${llm.model}` : t.llmOff}
            </span>
          ) : null}
          {llm?.conflict ? <span className="pill off">{t.llmConflict}</span> : null}
          <button type="button" aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}>
            繁中
          </button>
          <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
            EN
          </button>
        </div>
      </header>
      <div className="banner" role="note">
        <p>
          <strong>{DISCLAIMER_ZH}</strong>
          <span className="en">{DISCLAIMER_EN}</span>
        </p>
      </div>
      <div className="layout">
        <div>
          <div className="thread">
            {turns.length === 0 ? <div className="empty">{t.empty}</div> : null}
            {turns.map((turn) => {
              if (turn.kind === "user") {
                return (
                  <div className="bubble user" key={turn.id}>
                    <div className="prose">{turn.text}</div>
                    {turn.images.length ? (
                      <div className="thumbs">
                        {turn.images.map((image) => (
                          <img key={image.url} src={image.url} alt="" />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }
              if (turn.kind === "result") {
                return <ResultView key={turn.id} payload={turn.payload} locale={locale} teaching={turn.teaching} />;
              }
              if (turn.kind === "error") {
                return (
                  <div className="bubble err" key={turn.id}>
                    {locale === "zh" ? turn.zh : turn.en}
                    <span className="en">{locale === "zh" ? turn.en : turn.zh}</span>
                  </div>
                );
              }
              return (
                <div className="bubble" key={turn.id}>
                  <p className="meta">
                    {turn.source === "openrouter" ? `${t.replyModel}${turn.model ? ` · ${turn.model}` : ""}` : t.replyTemplate}
                  </p>
                  <p>{turn.zh}</p>
                  <p className="en">{turn.en}</p>
                  {turn.searches.length ? (
                    <ul className="clean">
                      {turn.searches.slice(0, 6).map((hit) => (
                        <li key={`${hit.source}-${hit.query}`}>
                          <a href={hit.href} target="_blank" rel="noreferrer">
                            {hit.source}
                          </a>{" "}
                          <span className="query">{hit.query}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && (notes.trim() || images.length)) void run();
            }}
          >
            <label htmlFor="notes">{lastRule ? t.follow : t.notes}</label>
            <textarea
              id="notes"
              value={notes}
              placeholder={lastRule ? t.followPlaceholder : t.placeholder}
              onChange={(event) => setNotes(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!busy && (notes.trim() || images.length)) void run();
                }
              }}
            />
            <div
              className="drop"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void addFiles([...event.dataTransfer.files]);
              }}
            >
              {t.drop}
              {images.length ? (
                <div className="thumbs">
                  {images.map((image) => (
                    <img key={image.url} src={image.url} alt={image.name} />
                  ))}
                </div>
              ) : null}
            </div>
            {banner ? <p className="err">{banner}</p> : null}
            <div className="row">
              <label className="btn">
                {t.upload}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={(event) => {
                    void addFiles([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
              </label>
              {images.length ? (
                <button type="button" className="btn" onClick={() => setImages([])}>
                  {t.clear}
                </button>
              ) : null}
              <button className="btn primary" type="submit" disabled={busy || (!notes.trim() && images.length === 0)}>
                {busy ? t.sending : t.send}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTurns([]);
                  setImages([]);
                  setNotes("");
                  setBanner("");
                }}
              >
                {t.newCase}
              </button>
            </div>
            <div className="chips">
              {(lastRule ? t.chips : t.starters).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => {
                    setNotes(chip);
                    void run({ notes: chip, files: [] });
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </form>
        </div>
        <aside className="side">
          <section className="panel">
            <h2>{t.instrument}</h2>
            <div className="seg" role="group" aria-label={t.instrument}>
              {(
                [
                  ["auto", t.auto],
                  ["variant_ii", t.variant],
                  ["sebia", t.sebia],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={instrument === id} onClick={() => setInstrument(id)}>
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>{t.demos}</h2>
            {demos.cases.map((demo) => (
              <button key={demo.id} type="button" className="demo" disabled={busy} onClick={() => void openDemo(demo.id)}>
                {locale === "zh" ? demo.title_zh : demo.title_en}
                <small>{demo.instrument === "sebia_ce" ? "Sebia CE · synthetic" : "VARIANT II · synthetic"}</small>
              </button>
            ))}
          </section>
          <section className="panel">
            <h2>{t.limits}</h2>
            <ul className="clean">
              {limits[locale].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>{t.sources}</h2>
            <ul className="clean">
              {kb.meta.sources.map((source) => (
                <li key={source.id}>{source.citation}</li>
              ))}
            </ul>
            <p className="sub">{kb.meta.rt_note}</p>
            <p className="sub">{kb.meta.zone_note}</p>
          </section>
        </aside>
      </div>
      <footer className="fine">Hb Pattern Bench Chat · decision support only · KB editable in data/variants.json</footer>
    </div>
  );
}
