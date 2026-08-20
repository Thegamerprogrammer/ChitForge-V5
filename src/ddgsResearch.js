const DDGS_BASE_URL = 'http://127.0.0.1:4479';
export const DDGS_LIMITS = { minHardMax: 80, absoluteSafetyCeiling: 650, concurrency: 3, retries: 2, timeoutMs: 9000, paceMs: 175 };
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

export function planResearchBudget({ poiCount = 20, selectedTargets = [], automaticTargetCount = 0, sliders = {}, form = {}, coverageGaps = 0 } = {}) {
  const count = Math.max(1, Math.min(250, Number(poiCount) || 20));
  const baseMin = Math.round(Math.max(25, count * (0.85 + 0.25 * Math.sqrt(count / 20))));
  const baseMax = Math.round(Math.max(baseMin + 15, count * (2.15 - 0.15 * Math.sqrt(20 / count))));
  const targetFactor = Math.min(90, ((selectedTargets?.length || 0) * 6) + (automaticTargetCount * 5));
  const complexity = Math.min(80, (String(form.agenda || '').length / 45) + (form.backgroundGuide ? 28 : 0) + (String(form.researchNotes || '').length / 60) + ((sliders.controversy || 0) / 2.5) + (coverageGaps * 12));
  const preferredMin = Math.min(500, Math.round(baseMin + targetFactor * 0.45 + complexity * 0.35));
  const preferredMax = Math.min(500, Math.round(baseMax + targetFactor + complexity));
  const softMax = Math.min(550, Math.max(preferredMax, Math.round(preferredMax * 1.12)));
  const hardMax = Math.min(DDGS_LIMITS.absoluteSafetyCeiling, Math.max(DDGS_LIMITS.minHardMax, Math.round(softMax * 1.18)));
  const extractMax = Math.min(180, Math.max(25, Math.round(preferredMin * 0.45)));
  return { preferredMin, preferredMax, softMax, hardMax, extractMax, absoluteSafetyCeiling: DDGS_LIMITS.absoluteSafetyCeiling };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchWithTimeout(url, options = {}, timeoutMs = DDGS_LIMITS.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function isNoResultsError(err) { return /no results found/i.test(String(err?.message || err)); }
async function withRetries(fn, { retries = DDGS_LIMITS.retries, paceMs = DDGS_LIMITS.paceMs } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { if (attempt) await sleep(paceMs * (2 ** attempt) + Math.round(Math.random() * 120)); return await fn(attempt); }
    catch (err) { last = err; if (isNoResultsError(err)) break; }
  }
  throw last;
}
function alternateQueries(query) {
  return [...new Set([query.replace(/\bbefore\s+\d{4}-\d{2}-\d{2}/i, '').trim(), `${query} official report`, `${query} Reuters OR UN`].map((q) => q.replace(/\s+/g, ' ').trim()).filter(Boolean).filter((q) => q !== query))].slice(0, 2);
}

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
  const res = await fetchWithTimeout(`${DDGS_BASE_URL}/search/text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, region: 'us-en', safesearch: 'moderate', max_results, backend: 'auto' }) });
  if (!res.ok) { const body = await res.text().catch(() => ''); const err = new Error(/No results found/i.test(body) ? 'NO_RESULTS_FOR_QUERY' : `DDGS search failed: HTTP ${res.status}`); err.status = res.status; throw err; }
  const payload = await res.json();
  return Array.isArray(payload.results) ? payload.results : Array.isArray(payload) ? payload : [];
}
async function extract(url) {
  try {
    const res = await fetchWithTimeout(`${DDGS_BASE_URL}/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, fmt: 'text_plain' }) });
    if (!res.ok) return { extractedText: '', extractionStatus: res.status === 403 ? 'DISCOVERED_DIRECT_EXTRACTION_BLOCKED' : `DISCOVERED_NOT_RETRIEVED_HTTP_${res.status}` };
    const payload = await res.json();
    const extractedText = String(payload.content || '').slice(0, 2200);
    return { extractedText, extractionStatus: extractedText ? 'RETRIEVED' : 'DISCOVERED_NOT_RETRIEVED' };
  } catch (err) { return { extractedText: '', extractionStatus: err?.name === 'AbortError' ? 'DISCOVERED_NOT_RETRIEVED_TIMEOUT' : 'DISCOVERED_NOT_RETRIEVED' }; }
}

export async function discoverResearch({ form, sliders, selectedTargets, targetingMode, poiTypes, poiCount = 20, onProgress }) {
  const budget = planResearchBudget({ poiCount, selectedTargets, sliders, form });
  const queries = buildResearchQueries({ form, sliders, selectedTargets, targetingMode, poiTypes });
  const byUrl = new Map(); const contentSignatures = new Set(); let staleRounds = 0;
  const missionText = [form.committee, form.agenda, form.portfolio, form.researchNotes].join(' ');
  for (const query of queries) {
    if (byUrl.size >= budget.softMax && staleRounds >= 2) break;
    onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `DDGS URL discovery: ${byUrl.size}/${budget.softMax} retained.`, done: byUrl.size, total: budget.softMax });
    const before = byUrl.size;
    let results = [];
    try { results = await withRetries(() => searchText(query, sliders.controversy >= 70 ? 12 : 8)); }
    catch (err) {
      const status = isNoResultsError(err) ? 'NO_RESULTS_FOR_QUERY' : `RECOVERABLE_SEARCH_FAILURE: ${err?.message || err}`;
      for (const alt of isNoResultsError(err) ? alternateQueries(query) : []) {
        try { results = await withRetries(() => searchText(alt, 6), { retries: 1 }); if (results.length) break; } catch { /* recoverable alternate failure */ }
      }
      if (!results.length) onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `${status}; continuing mission.`, done: byUrl.size, total: budget.softMax });
    }
    await sleep(DDGS_LIMITS.paceMs);
    results.forEach((result) => {
      if (byUrl.size >= budget.hardMax) return;
      const url = canonicalUrl(result.href || result.url || result.link);
      const signature = contentSignature(result);
      if (!url || byUrl.has(url) || (signature && contentSignatures.has(signature)) || /wikipedia\.org/i.test(url)) return;
      if (signature) contentSignatures.add(signature);
      const domain = domainFromResult(url);
      byUrl.set(url, { url, canonicalUrl: url, title: result.title || 'Untitled source', snippet: result.body || result.snippet || '', publicationDate: result.date || result.published || '', domain, query, bangUrl: bangUrl(domain, query), relevanceScore: scoreResult({ ...result, href: url }, missionText) });
    });
    staleRounds = byUrl.size - before < 3 ? staleRounds + 1 : 0;
    if (byUrl.size >= budget.preferredMin && staleRounds >= 2) break;
  }
  const sources = [...byUrl.values()].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, budget.hardMax);
  const retrieved = [];
  for (const source of sources.slice(0, Math.min(budget.extractMax, sources.length))) { const extracted = await extract(source.url); retrieved.push({ ...source, ...extracted }); await sleep(DDGS_LIMITS.paceMs); }
  const automaticTargetCandidates = deriveAutomaticTargetCandidates({ form, sources, selectedTargets });
  return { schema: 'DDGS API /search/text + /extract (OpenAPI 3.1.0)', queries, sources, retrievedSources: retrieved, bangUrls: sources.map((s) => s.bangUrl).filter(Boolean), automaticTargetCandidates, stats: { queryCount: queries.length, discoveredUrls: byUrl.size, retainedUrls: sources.length, retrievedSources: retrieved.filter((s) => s.extractedText).length, bangUrls: sources.filter((s) => s.bangUrl).length, hardMax: budget.hardMax, softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, adaptiveCeiling: budget.hardMax, absoluteSafetyCeiling: budget.absoluteSafetyCeiling } };
}
