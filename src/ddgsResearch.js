const DDGS_BASE_URL = 'http://127.0.0.1:4479';
export const DDGS_LIMITS = { preferredMin: 25, preferredMax: 50, softMax: 60, hardMax: 80 };
const HIGH_VALUE = [/\.gov(\.|\/|$)/i, /\.int(\.|\/|$)/i, /un\.org$/i, /worldbank\.org$/i, /imf\.org$/i, /oecd\.org$/i, /wto\.org$/i, /icj-cij\.org$/i, /reuters\.com$/i, /apnews\.com$/i, /ft\.com$/i, /bbc\./i, /bloomberg\.com$/i];

export function canonicalUrl(raw = '') {
  try {
    const url = new URL(raw);
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) => url.searchParams.delete(key));
    url.hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
  } catch { return ''; }
}
export function domainFromResult(url = '') { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
export function bangUrl(domain, query) { return domain ? `https://duckduckgo.com/?q=${encodeURIComponent(`!site:${domain} ${query}`)}` : ''; }
function contentSignature(result = {}) { return `${result.title || ''} ${result.body || result.snippet || ''}`.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 4).slice(0, 18).join(' '); }
function scoreResult(result, missionText) {
  const hay = `${result.title || ''} ${result.body || ''} ${result.href || ''}`.toLowerCase();
  const terms = missionText.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
  const matches = new Set(terms.filter((term) => hay.includes(term))).size;
  const domain = domainFromResult(result.href);
  return matches + (HIGH_VALUE.some((rx) => rx.test(domain)) ? 8 : 0) + (/pdf|treaty|resolution|report|statement|vote|voting|policy|foreign/i.test(hay) ? 3 : 0);
}

export function buildResearchQueries({ form, sliders, selectedTargets = [], targetingMode, poiTypes = [] }) {
  const base = [form.committee, form.agenda, form.portfolio, form.researchNotes].filter(Boolean).join(' ');
  const freeze = form.freezeDate ? `before ${form.freezeDate}` : '';
  const targets = selectedTargets.length ? selectedTargets.map((t) => t.name).join(' OR ') : 'countries';
  const controversy = sliders.controversy >= 70 ? ['scandal investigation controversy contradiction', 'implementation failure malpractice accountability', 'voting contradiction treaty commitment'] : ['policy position official statement', 'UN vote treaty commitment'];
  const aggression = sliders.aggression >= 70 ? ['legal pressure accountability evidence', 'contradiction failure direct question'] : ['policy difference diplomatic position'];
  const queries = [
    `${base} ${freeze} official foreign policy doctrine strategic priorities`,
    `${base} ${freeze} UN resolution voting record treaty commitments`,
    `${base} ${targets} ${freeze} government statements policy contradiction`,
    `${base} ${targets} ${freeze} international organization report legal framework`,
    ...controversy.map((x) => `${base} ${targets} ${freeze} ${x}`),
    ...aggression.map((x) => `${base} ${targets} ${freeze} ${x}`),
    `${form.portfolio} foreign policy ${form.agenda} ${freeze}`,
    `${targets} foreign policy ${form.agenda} ${freeze}`,
    ...(poiTypes || []).filter((t) => t !== 'AUTO').slice(0, 4).map((type) => `${base} ${targets} ${type} ${freeze}`),
  ];
  if (form.backgroundGuideName) queries.push(`${base} ${form.backgroundGuideName} background guide ${freeze}`);
  if (targetingMode !== 'selected_only') queries.push(`${base} automatic target countries relevant controversy ${freeze}`);
  return [...new Set(queries.map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 14);
}


export function deriveAutomaticTargetCandidates({ form, sources = [], selectedTargets = [] }) {
  const portfolio = String(form.portfolio || '').toLowerCase();
  const manual = new Set((selectedTargets || []).map((t) => t.iso || t.name));
  const mentions = new Map();
  const countryHints = [
    ['RUS', 'Russia'], ['CHN', 'China'], ['USA', 'United States'], ['ISR', 'Israel'], ['IRN', 'Iran'], ['SAU', 'Saudi Arabia'], ['TUR', 'Türkiye'], ['IND', 'India'], ['PAK', 'Pakistan'], ['FRA', 'France'], ['GBR', 'United Kingdom'], ['DEU', 'Germany'], ['JPN', 'Japan'], ['BRA', 'Brazil'], ['ZAF', 'South Africa'], ['EGY', 'Egypt'], ['ETH', 'Ethiopia'], ['IDN', 'Indonesia'], ['UKR', 'Ukraine'], ['MEX', 'Mexico'], ['ARE', 'United Arab Emirates'], ['QAT', 'Qatar'], ['KWT', 'Kuwait'], ['BHR', 'Bahrain'], ['SGP', 'Singapore'],
  ];
  const context = [form.committee, form.agenda, form.researchNotes, form.backgroundGuideName, form.backgroundGuide?.text || form.backgroundGuideText, ...sources.map((s) => `${s.title} ${s.snippet} ${s.domain}`)].join(' ').toLowerCase();
  for (const [iso, name] of countryHints) {
    const key = name.toLowerCase();
    if (manual.has(iso) || key === portfolio || iso.toLowerCase() === portfolio) continue;
    const count = (context.match(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length;
    if (count) mentions.set(iso, { iso, name, score: count, reason: `Mentioned in agenda/background/research context ${count} time(s) and not the portfolio country.` });
  }
  return [...mentions.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

async function searchText(query, max_results = 10) {
  const res = await fetch(`${DDGS_BASE_URL}/search/text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, region: 'us-en', safesearch: 'moderate', max_results, backend: 'auto' }) });
  if (!res.ok) throw new Error(`DDGS search failed: HTTP ${res.status}`);
  const payload = await res.json();
  return Array.isArray(payload.results) ? payload.results : Array.isArray(payload) ? payload : [];
}
async function extract(url) {
  try {
    const res = await fetch(`${DDGS_BASE_URL}/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, fmt: 'text_plain' }) });
    if (!res.ok) return '';
    const payload = await res.json();
    return String(payload.content || '').slice(0, 2200);
  } catch { return ''; }
}

export async function discoverResearch({ form, sliders, selectedTargets, targetingMode, poiTypes, onProgress }) {
  const queries = buildResearchQueries({ form, sliders, selectedTargets, targetingMode, poiTypes });
  const byUrl = new Map(); const contentSignatures = new Set(); let staleRounds = 0;
  const missionText = [form.committee, form.agenda, form.portfolio, form.researchNotes].join(' ');
  for (const query of queries) {
    if (byUrl.size >= DDGS_LIMITS.softMax && staleRounds >= 2) break;
    onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `DDGS URL discovery: ${byUrl.size}/${DDGS_LIMITS.softMax} retained.`, done: byUrl.size, total: DDGS_LIMITS.softMax });
    const before = byUrl.size;
    const results = await searchText(query, sliders.controversy >= 70 ? 12 : 8).catch(() => []);
    results.forEach((result) => {
      if (byUrl.size >= DDGS_LIMITS.hardMax) return;
      const url = canonicalUrl(result.href || result.url || result.link);
      const signature = contentSignature(result);
      if (!url || byUrl.has(url) || (signature && contentSignatures.has(signature)) || /wikipedia\.org/i.test(url)) return;
      if (signature) contentSignatures.add(signature);
      const domain = domainFromResult(url);
      byUrl.set(url, { url, canonicalUrl: url, title: result.title || 'Untitled source', snippet: result.body || result.snippet || '', publicationDate: result.date || result.published || '', domain, query, bangUrl: bangUrl(domain, query), relevanceScore: scoreResult({ ...result, href: url }, missionText) });
    });
    staleRounds = byUrl.size - before < 3 ? staleRounds + 1 : 0;
    if (byUrl.size >= DDGS_LIMITS.preferredMin && staleRounds >= 2) break;
  }
  const sources = [...byUrl.values()].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, DDGS_LIMITS.hardMax);
  const retrieved = [];
  for (const source of sources.slice(0, Math.min(25, sources.length))) retrieved.push({ ...source, extractedText: await extract(source.url) });
  const automaticTargetCandidates = deriveAutomaticTargetCandidates({ form, sources, selectedTargets });
  return { schema: 'DDGS API /search/text + /extract (OpenAPI 3.1.0)', queries, sources, retrievedSources: retrieved, bangUrls: sources.map((s) => s.bangUrl).filter(Boolean), automaticTargetCandidates, stats: { queryCount: queries.length, discoveredUrls: byUrl.size, retainedUrls: sources.length, retrievedSources: retrieved.filter((s) => s.extractedText).length, bangUrls: sources.filter((s) => s.bangUrl).length, hardMax: DDGS_LIMITS.hardMax, softMax: DDGS_LIMITS.softMax, preferredRange: '25-50' } };
}
