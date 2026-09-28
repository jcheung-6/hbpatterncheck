"use client";

import { useState } from "react";
import { copy } from "@/lib/i18n";
import type { InterpretOk, SearchHit } from "@/lib/types";

export function ResultView({
  payload,
  locale,
  teaching,
}: {
  payload: InterpretOk;
  locale: "zh" | "en";
  teaching?: { zh: string; en: string };
}) {
  const t = copy[locale];
  const rule = payload.rule;
  const quality = payload.extraction?.quality_flags;
  const flags = quality
    ? Object.entries(quality)
        .filter(([, on]) => on)
        .map(([name]) => name)
    : [];

  return (
    <article className="card" aria-live="polite">
      <div className="kicker">
        <span className="pill">
          {t.source}: {payload.extraction_source === "local" ? (locale === "zh" ? "本機讀圖" : "local read") : payload.extraction_source}
        </span>
        <span className="pill">
          {t.kbVersion} {payload.kb_version}
        </span>
        {payload.vision_model ? <span className="pill">{payload.vision_model}</span> : null}
        {rule.most_likely ? (
          <span className={rule.most_likely.fit === "low" ? "pill warn" : "pill ok"}>
            {t.fit}: {rule.most_likely.fit === "low" ? t.low : t.moderate}
          </span>
        ) : (
          <span className="pill warn">insufficient</span>
        )}
      </div>
      {payload.warnings.map((warning) => (
        <p key={warning.en} className="err">
          {locale === "zh" ? warning.zh : warning.en}
          <span className="en">{locale === "zh" ? warning.en : warning.zh}</span>
        </p>
      ))}
      <p className="sub">{locale === "zh" ? rule.fit_note_zh : rule.fit_note_en}</p>

      {rule.insufficient ? (
        <p>
          {rule.insufficient_zh}
          <span className="en">{rule.insufficient_en}</span>
        </p>
      ) : null}

      {rule.most_likely ? (
        <div className="most">
          <h2>{t.most}</h2>
          <strong>{rule.most_likely.title_zh}</strong>
          <span className="en">{rule.most_likely.title_en}</span>
          <p>{rule.most_likely.why_zh}</p>
          <p className="en">{rule.most_likely.why_en}</p>
        </div>
      ) : null}

      {rule.differentials.length ? (
        <section>
          <h3>{t.diffs}</h3>
          {rule.differentials.map((item, index) => (
            <div className="diff" key={item.id}>
              <strong>
                {index + 1}. {item.title_zh}
              </strong>
              <span className="en">{item.title_en}</span>
              <div>{item.why_zh}</div>
              <span className="en">{item.why_en}</span>
            </div>
          ))}
        </section>
      ) : null}

      {rule.peaks.length ? (
        <section>
          <h3>{t.peaks}</h3>
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>%</th>
                <th>RT / zone</th>
                <th>Kind</th>
              </tr>
            </thead>
            <tbody>
              {rule.peaks.map((peak, index) => (
                <tr key={`${peak.label}-${index}`}>
                  <td>{peak.label}</td>
                  <td>{peak.percent == null ? "—" : peak.percent}</td>
                  <td>{peak.zone || (peak.rt_min != null ? `${peak.rt_min} min` : peak.window || "—")}</td>
                  <td>
                    {peak.kind}
                    {peak.inferred ? " · inferred" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section>
        <h3>{t.pitfalls}</h3>
        <ul className="clean">
          {rule.pitfalls.map((item) => (
            <li key={item.en}>
              {item.zh}
              <span className="en">{item.en}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>{t.confirm}</h3>
        <ul className="clean">
          {rule.confirm.map((item) => (
            <li key={item.en}>
              {item.zh}
              <span className="en">{item.en}</span>
            </li>
          ))}
        </ul>
      </section>

      <details>
        <summary>{t.narrative}</summary>
        <p>{payload.narrative_zh}</p>
        <p className="en">{payload.narrative_en}</p>
      </details>

      {rule.co_migrating.length ? (
        <details>
          <summary>{t.kb}</summary>
          {rule.co_migrating.map((card) => (
            <div key={card.id} className="diff">
              <strong>
                {card.name_zh} · {card.name_en}
              </strong>
              <div>
                {card.gene} · {card.hgvs}
              </div>
              <p>{card.hplc_zh}</p>
              <p className="en">{card.hplc_en}</p>
              <p>{card.ce_zh}</p>
              <p className="en">{card.ce_en}</p>
            </div>
          ))}
        </details>
      ) : null}

      {payload.searches.length ? (
        <section className="search-block">
          <h3>{t.search}</h3>
          <p className="sub">{t.searchHelp}</p>
          <SearchList hits={payload.searches} copyLabel={t.copy} copiedLabel={t.copied} />
        </section>
      ) : null}

      {teaching ? (
        <details>
          <summary>{t.teaching}</summary>
          <p>{teaching.zh}</p>
          <p className="en">{teaching.en}</p>
        </details>
      ) : null}

      {flags.length ? (
        <p>
          {t.quality}: {flags.join(", ")}
        </p>
      ) : null}

      {payload.extraction ? (
        <details>
          <summary>{t.audit}</summary>
          <pre className="prose">{JSON.stringify(payload.extraction, null, 2)}</pre>
        </details>
      ) : null}

      <details>
        <summary>{copy[locale].sources}</summary>
        <ul className="clean">
          {payload.sources.map((source) => (
            <li key={source.id}>{source.citation}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function SearchList({
  hits,
  copyLabel,
  copiedLabel,
}: {
  hits: SearchHit[];
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState("");
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const key = hit.variant_id;
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }
  return (
    <div>
      {[...groups.entries()].map(([id, group]) => (
        <div key={id} className="diff">
          <strong>
            {group[0].variant_name_zh} · {group[0].variant_name_en}
          </strong>
          <ul className="clean">
            {group.map((hit) => (
              <li key={`${hit.source}-${hit.href}-${hit.query}`}>
                <a href={hit.href} target="_blank" rel="noreferrer">
                  {hit.source}: {hit.title}
                </a>{" "}
                <span className="query">{hit.query}</span>{" "}
                <button
                  type="button"
                  className="chip"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(hit.query);
                      setCopied(hit.query);
                    } catch {
                      setCopied("");
                    }
                  }}
                >
                  {copied === hit.query ? copiedLabel : copyLabel}
                </button>
                {hit.offline ? null : <span className="pill ok">title</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
