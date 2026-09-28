import { variantById } from "@/lib/kb";
import type { SearchHit } from "@/lib/types";

export function buildSearchHits(variantIds: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const id of variantIds) {
    const variant = variantById(id);
    if (!variant) continue;
    const pubmedQuery = variant.search_pubmed[0] || variant.name_en;
    hits.push({
      variant_id: variant.id,
      variant_name_en: variant.name_en,
      variant_name_zh: variant.name_zh,
      source: "PubMed",
      title: pubmedQuery,
      href: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(pubmedQuery)}`,
      query: pubmedQuery,
      offline: true,
    });
    if (variant.search_pubmed[1]) {
      hits.push({
        variant_id: variant.id,
        variant_name_en: variant.name_en,
        variant_name_zh: variant.name_zh,
        source: "PubMed",
        title: variant.search_pubmed[1],
        href: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(variant.search_pubmed[1])}`,
        query: variant.search_pubmed[1],
        offline: true,
      });
    }
    hits.push({
      variant_id: variant.id,
      variant_name_en: variant.name_en,
      variant_name_zh: variant.name_zh,
      source: "HbVar",
      title: `HbVar: ${variant.search_hbvar}`,
      href: "https://globin.bx.psu.edu/hbvar/menu.html",
      query: variant.search_hbvar,
      offline: true,
    });
    hits.push({
      variant_id: variant.id,
      variant_name_en: variant.name_en,
      variant_name_zh: variant.name_zh,
      source: "ITHANET",
      title: `IthaGenes: ${variant.search_ithanet}`,
      href: `https://www.ithanet.eu/db/ithagenes?query=${encodeURIComponent(variant.search_ithanet)}`,
      query: variant.search_ithanet,
      offline: true,
    });
  }
  return hits;
}

type ESearch = { esearchresult?: { idlist?: string[] } };
type ESummary = { result?: Record<string, { title?: string; pubdate?: string; uid?: string }> };

export async function enrichPubmed(hits: SearchHit[], fetchImpl: typeof fetch = fetch): Promise<SearchHit[]> {
  const pubmed = hits.filter((hit) => hit.source === "PubMed").slice(0, 2);
  const extras: SearchHit[] = [];
  for (const hit of pubmed) {
    try {
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&sort=relevance&tool=hbpatterncheck&term=${encodeURIComponent(hit.query)}`;
      const searched = await fetchJson<ESearch>(searchUrl, fetchImpl);
      const ids = searched.esearchresult?.idlist ?? [];
      if (!ids.length) continue;
      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&tool=hbpatterncheck&id=${ids.join(",")}`;
      const summary = await fetchJson<ESummary>(summaryUrl, fetchImpl);
      for (const id of ids) {
        const article = summary.result?.[id];
        if (!article?.title) continue;
        extras.push({
          ...hit,
          title: article.pubdate ? `${article.title} (${article.pubdate})` : article.title,
          href: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          offline: false,
        });
      }
    } catch {
      // Titles are optional. The query string and search URL remain.
    }
  }
  if (!extras.length) return hits;
  const rest = hits.filter((hit) => !(hit.source === "PubMed" && pubmed.includes(hit)));
  return [...extras, ...hits.filter((hit) => hit.source === "PubMed"), ...rest.filter((hit) => hit.source !== "PubMed")];
}

async function fetchJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
