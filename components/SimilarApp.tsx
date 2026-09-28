"use client";

import { useEffect, useRef, useState } from "react";
import { DISCLAIMER_EN, DISCLAIMER_ZH } from "@/lib/i18n";
import { clearPendingReport, isPdfFile, MAX_REPORT_BYTES, peekPendingReport } from "@/lib/pendingReport";

type Locale = "zh" | "en";
type Peak = { name: string; position: number; percent: number };
type Match = {
  id: string;
  method: "variant_ii" | "sebia_ce";
  source: "seed" | "library";
  score: number;
  peakScore: number;
  curveScore: number;
  reasonZh: string;
  reasonEn: string;
  peaks: Peak[];
  alignedCurve: number[];
  summaryZh: string;
  summaryEn: string;
};
type QueryView = {
  id: string;
  method: "variant_ii" | "sebia_ce";
  peaks: Peak[];
  axisStart: number;
  axisEnd: number;
  curve: number[];
  curveSource: "page" | "peaks" | "seed";
  alignedCurve: number[];
  summaryZh: string;
  summaryEn: string;
  matches: Match[];
};
type CatalogItem = { id: string; method: "variant_ii" | "sebia_ce"; source: "seed" | "library"; summaryZh: string; summaryEn: string };

function isReport(file: File): boolean {
  const name = file.name.toLowerCase();
  return isPdfFile(file) || file.type.startsWith("image/") || name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
}

const copy = {
  zh: {
    title: "相似圖譜",
    back: "返回判讀",
    lead: "同一種方法之內，用峰百分比同對齊主峰之後嘅曲線排名。檔名、姓名、編號都唔會保存，亦唔會當標籤。",
    drop: "撳呢度或拖入 Variant II／Sebia 報告（PDF、PNG、JPEG，12MB 以下）。揀完就開始搜。",
    search: "搵相似",
    working: "讀緊曲線…",
    save: "加入圖庫",
    saved: "已加入圖庫",
    clear: "清空我加入嘅線",
    seeds: "示範形狀",
    mine: "我加入嘅線",
    emptyLib: "未有加入嘅線。",
    peaks: "讀到嘅峰",
    matches: "最接近",
    none: "圖庫入面未有同一種方法嘅線。",
    score: "相似",
    peak: "百分比",
    curve: "線條",
    fromPeaks: "掃描未可靠跟到條線，以下曲線由峰表重畫，排名仍用百分比。",
    fromPage: "曲線由報告頁抽出。",
    seedNote: "示範形狀係合成線，用來試搜尋，不是病人檔。",
    try: "用呢條線搜",
  },
  en: {
    title: "Similar traces",
    back: "Back to interpret",
    lead: "Within one method, rank by peak percentages and by the curve after the main peak is aligned. Filenames, names, and identifiers are not stored and are not labels.",
    drop: "Click here or drop a Variant II / Sebia report (PDF, PNG, or JPEG, under 12 MB). Search starts as soon as you choose a file.",
    search: "Find similar",
    working: "Reading the trace…",
    save: "Add to library",
    saved: "Added to the library",
    clear: "Clear traces I added",
    seeds: "Demo shapes",
    mine: "Traces I added",
    emptyLib: "No added traces yet.",
    peaks: "Peaks read",
    matches: "Closest",
    none: "The library has no trace from the same method.",
    score: "Similar",
    peak: "Percents",
    curve: "Shape",
    fromPeaks: "The scan did not yield a reliable curve, so the line is rebuilt from the peak table. Ranking still uses the percentages.",
    fromPage: "The curve was taken from the page.",
    seedNote: "Demo shapes are synthetic traces for trying search. They are not patient files.",
    try: "Search with this trace",
  },
} as const;

export function SimilarApp() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queries, setQueries] = useState<QueryView[]>([]);
  const [seeds, setSeeds] = useState<CatalogItem[]>([]);
  const [library, setLibrary] = useState<CatalogItem[]>([]);
  const t = copy[locale];
  const runSearchRef = useRef<(target: File) => Promise<void>>(async () => {});

  useEffect(() => {
    const saved = window.localStorage.getItem("hbbench-locale");
    if (saved === "en" || saved === "zh") setLocale(saved);
    void refreshCatalog();
    const queued = peekPendingReport();
    if (!queued) return;
    let live = true;
    void runSearchRef.current(queued).finally(() => {
      if (live) clearPendingReport();
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-HK" : "en";
    window.localStorage.setItem("hbbench-locale", locale);
  }, [locale]);

  async function refreshCatalog() {
    const response = await fetch("/api/library");
    const body = (await response.json()) as { seeds: CatalogItem[]; library: CatalogItem[] };
    setSeeds(body.seeds ?? []);
    setLibrary(body.library ?? []);
  }

  async function runSearch(target: File) {
    if (!isReport(target)) {
      setError(locale === "zh" ? "只接受 PDF、PNG 或 JPEG。" : "Only PDF, PNG, or JPEG is accepted.");
      return;
    }
    if (target.size > MAX_REPORT_BYTES) {
      setError(locale === "zh" ? "檔案超過 12MB。" : "That file is over 12 MB.");
      return;
    }
    setFile(target);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", target);
      const response = await fetch("/api/similar", { method: "POST", body: form });
      const body = (await response.json()) as { ok: boolean; queries?: QueryView[]; errorZh?: string; errorEn?: string; detail?: string };
      if (!body.ok || !body.queries) {
        setQueries([]);
        const message = locale === "zh" ? body.errorZh || "讀唔到。" : body.errorEn || "Could not read the file.";
        setError(body.detail ? `${message} ${body.detail}` : message);
        return;
      }
      setQueries(body.queries);
    } catch {
      setError(locale === "zh" ? "網絡或伺服器錯誤。" : "Network or server error.");
    } finally {
      setBusy(false);
    }
  }

  runSearchRef.current = runSearch;

  function pickReport(next: File | null | undefined) {
    if (next) void runSearch(next);
  }

  async function searchStored(item: CatalogItem) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.source === "library" ? { libraryId: item.id } : { seedId: item.id }),
      });
      const body = (await response.json()) as { ok: boolean; queries?: QueryView[]; errorZh?: string; errorEn?: string };
      if (!body.ok || !body.queries) {
        setError(locale === "zh" ? body.errorZh || "搵唔到。" : body.errorEn || "Trace not found.");
        return;
      }
      setQueries(body.queries);
    } catch {
      setError(locale === "zh" ? "網絡或伺服器錯誤。" : "Network or server error.");
    } finally {
      setBusy(false);
    }
  }

  async function saveQueries() {
    const traces = queries
      .filter((query) => query.id.startsWith("q_"))
      .map((query) => ({
        method: query.method,
        peaks: query.peaks,
        curve: query.curve,
        axisStart: query.axisStart,
        axisEnd: query.axisEnd,
      }));
    if (!traces.length) return;
    setBusy(true);
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traces }),
      });
      const body = (await response.json()) as { ok: boolean };
      if (body.ok) {
        setNotice(t.saved);
        await refreshCatalog();
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearLibrary() {
    setBusy(true);
    try {
      await fetch("/api/library", { method: "DELETE" });
      await refreshCatalog();
    } finally {
      setBusy(false);
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
              <a href="/">{t.back}</a>
            </p>
          </div>
        </div>
        <div className="lang" role="group" aria-label="language">
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
        <p>{t.lead}</p>
      </div>
      <div className="layout">
        <div>
          <div className="composer">
            <div
              className="drop"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                pickReport(event.dataTransfer.files?.[0]);
              }}
            >
              <label className="drop-label">
                {busy ? t.working : t.drop}
                <input
                  className="file-input"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                  onChange={(event) => {
                    pickReport(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="row">
              <button className="btn primary" type="button" disabled={busy || !file} onClick={() => file && void runSearch(file)}>
                {busy ? t.working : t.search}
              </button>
              {queries.some((query) => query.id.startsWith("q_")) ? (
                <button className="btn" type="button" disabled={busy} onClick={() => void saveQueries()}>
                  {t.save}
                </button>
              ) : null}
            </div>
            {file ? <p className="sub">{locale === "zh" ? "已選擇一份報告，檔名不會被保存。" : "A report is selected. Its filename is not stored."}</p> : null}
            {error ? <p className="err">{error}</p> : null}
            {notice ? <p className="sub">{notice}</p> : null}
          </div>
          {queries.map((query) => (
            <article className="card" key={query.id} style={{ marginTop: 12 }}>
              <div className="kicker">
                <span className="pill">{query.method === "sebia_ce" ? "Sebia" : "Variant II"}</span>
                <span className="pill">{query.curveSource === "peaks" ? (locale === "zh" ? "由峰表重畫" : "rebuilt from peaks") : locale === "zh" ? "曲線" : "curve"}</span>
              </div>
              <h2>{locale === "zh" ? query.summaryZh : query.summaryEn}</h2>
              <p className="sub">
                {query.id.startsWith("q_")
                  ? query.curveSource === "peaks"
                    ? t.fromPeaks
                    : t.fromPage
                  : query.id.startsWith("seed-")
                    ? t.seedNote
                    : locale === "zh"
                      ? "用圖庫入面已經保存嘅曲線再搜。"
                      : "Searching again with a curve already in the library."}
              </p>
              <Spark curve={query.alignedCurve} />
              <h3>{t.peaks}</h3>
              <PeakTable peaks={query.peaks} method={query.method} />
              <h3>{t.matches}</h3>
              {query.matches.length === 0 ? <p>{t.none}</p> : null}
              {query.matches.map((match) => (
                <div className="match" key={match.id}>
                  <div className="match-head">
                    <strong>
                      {t.score} {match.score}
                    </strong>
                    <span className="sub">
                      {t.peak} {match.peakScore} · {t.curve} {match.curveScore} · {match.source === "library" ? (locale === "zh" ? "我加入" : "added") : locale === "zh" ? "示範" : "demo"}
                    </span>
                  </div>
                  <p>{locale === "zh" ? match.summaryZh : match.summaryEn}</p>
                  <Overlay query={query.alignedCurve} match={match.alignedCurve} />
                  <p>{locale === "zh" ? match.reasonZh : match.reasonEn}</p>
                  <p className="en">{locale === "zh" ? match.reasonEn : match.reasonZh}</p>
                </div>
              ))}
            </article>
          ))}
        </div>
        <aside className="side">
          <section className="panel">
            <h2>{t.seeds}</h2>
            <p className="sub">{t.seedNote}</p>
            {seeds.map((item) => (
              <button key={item.id} type="button" className="demo" disabled={busy} onClick={() => void searchStored(item)}>
                {locale === "zh" ? item.summaryZh : item.summaryEn}
                <small>{t.try}</small>
              </button>
            ))}
          </section>
          <section className="panel">
            <h2>{t.mine}</h2>
            {library.length === 0 ? <p className="sub">{t.emptyLib}</p> : null}
            {library.map((item) => (
              <button key={item.id} type="button" className="demo" disabled={busy} onClick={() => void searchStored(item)}>
                {locale === "zh" ? item.summaryZh : item.summaryEn}
                <small>{t.try}</small>
              </button>
            ))}
            {library.length ? (
              <button className="btn" type="button" disabled={busy} onClick={() => void clearLibrary()} style={{ marginTop: 8 }}>
                {t.clear}
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function PeakTable({ peaks, method }: { peaks: Peak[]; method: "variant_ii" | "sebia_ce" }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Peak</th>
          <th>{method === "sebia_ce" ? "Migration" : "min"}</th>
          <th>%</th>
        </tr>
      </thead>
      <tbody>
        {peaks.map((peak) => (
          <tr key={`${peak.name}-${peak.position}-${peak.percent}`}>
            <td>{peak.name}</td>
            <td>{peak.position.toFixed(method === "sebia_ce" ? 0 : 2)}</td>
            <td>{peak.percent.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Spark({ curve }: { curve: number[] }) {
  return (
    <svg className="spark" viewBox="0 0 320 72" role="img">
      <path d={linePath(curve, 320, 72)} />
    </svg>
  );
}

function Overlay({ query, match }: { query: number[]; match: number[] }) {
  return (
    <svg className="spark overlay" viewBox="0 0 320 72" role="img">
      <path className="query-line" d={linePath(query, 320, 72)} />
      <path className="match-line" d={linePath(match, 320, 72)} />
    </svg>
  );
}

function linePath(curve: number[], width: number, height: number): string {
  if (!curve.length) return "";
  const max = Math.max(...curve, 0.001);
  return curve
    .map((value, index) => {
      const x = (index / Math.max(1, curve.length - 1)) * width;
      const y = height - 6 - (value / max) * (height - 12);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
