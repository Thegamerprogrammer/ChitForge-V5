const DDGS_BASE_URL = 'http://127.0.0.1:4479';
export const DDGS_LIMITS = { minHardMax: 80, absoluteSafetyCeiling: 650, searchConcurrency: 1, extractConcurrency: 2, retries: 1, timeoutMs: 9000, searchPaceMs: 1000, extractPaceMs: 750, backoffBaseMs: 350, queryMaxChars: 180 };
export const DDGS_TEXT_BACKEND = 'duckduckgo';
export const DDGS_BACKENDS = [DDGS_TEXT_BACKEND];
export const SEARCH_STATUS = { SUCCESS: 'SUCCESS', NO_RESULTS_FOR_QUERY: 'NO_RESULTS_FOR_QUERY', RATE_LIMITED: 'RATE_LIMITED', TIMEOUT: 'TIMEOUT', CONNECTION_ERROR: 'CONNECTION_ERROR', DDGS_UPSTREAM_ERROR: 'DDGS_UPSTREAM_ERROR', SEARCH_FAILED: 'SEARCH_FAILED' };
export const EXTRACTION_STATUS = { DISCOVERED: 'DISCOVERED_FROM_SEARCH', RETRIEVED: 'RETRIEVED', DISCOVERED_NOT_RETRIEVED: 'DISCOVERED_NOT_RETRIEVED', DISCOVERED_DIRECT_EXTRACTION_BLOCKED: 'DISCOVERED_DIRECT_EXTRACTION_BLOCKED', RATE_LIMITED: 'RATE_LIMITED', DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR: 'DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR', DISCOVERED_NOT_RETRIEVED_TIMEOUT: 'DISCOVERED_NOT_RETRIEVED_TIMEOUT', DISCOVERED_NOT_RETRIEVED_NETWORK: 'DISCOVERED_NOT_RETRIEVED_NETWORK' };

export function canonicalUrl(raw = '') { try { const url = new URL(raw); url.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) => url.searchParams.delete(key)); url.hostname = url.hostname.replace(/^www\./, '').toLowerCase(); url.pathname = url.pathname.replace(/\/$/, ''); return url.toString(); } catch { return ''; } }
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
function jitter(ms) { return ms + Math.round(Math.random() * Math.max(40, ms * 0.35)); }
async function fetchWithTimeout(url, options = {}, timeoutMs = DDGS_LIMITS.timeoutMs, fetchImpl = fetch) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } }
function bodyText(value = '') { return String(value || '').toLowerCase(); }
export function classifySearchFailure({ status = 0, body = '', error } = {}) {
  const text = bodyText(`${body} ${error?.message || error || ''}`);
  if (/no results found|no result|no_results/.test(text)) return SEARCH_STATUS.NO_RESULTS_FOR_QUERY;
  if (status === 429 || /rate.?limit|too many requests|ratelimit/.test(text)) return SEARCH_STATUS.RATE_LIMITED;
  if (error?.name === 'AbortError' || /timeout|timed out|time out/.test(text)) return SEARCH_STATUS.TIMEOUT;
  if (/econn|connection|network|dns|enotfound|getaddrinfo|tls|ssl|certificate/.test(text)) return SEARCH_STATUS.CONNECTION_ERROR;
  if (status >= 500 || /upstream|engine|backend|provider/.test(text)) return SEARCH_STATUS.DDGS_UPSTREAM_ERROR;
  return SEARCH_STATUS.SEARCH_FAILED;
}
export function classifyExtractionFailure({ status = 0, body = '', error } = {}) {
  const text = bodyText(`${body} ${error?.message || error || ''}`);
  if (status === 403) return EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED;
  if (status === 404) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED;
  if (status === 429 || /rate.?limit|too many requests/.test(text)) return EXTRACTION_STATUS.RATE_LIMITED;
  if (error?.name === 'AbortError' || /timeout|timed out|time out/.test(text)) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT;
  if (/econn|connection|network|dns|enotfound|getaddrinfo|tls|ssl|certificate/.test(text)) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_NETWORK;
  if (status >= 500) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR;
  return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED;
}
function shouldRetrySearch(status) { return [SEARCH_STATUS.RATE_LIMITED, SEARCH_STATUS.TIMEOUT, SEARCH_STATUS.CONNECTION_ERROR, SEARCH_STATUS.DDGS_UPSTREAM_ERROR].includes(status); }
function shouldRetryExtract(status) { return [EXTRACTION_STATUS.RATE_LIMITED, EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT, EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_NETWORK, EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR].includes(status); }


const QUERY_STOP_PHRASES = [/RECOVERY LEVEL\s+\d+:[\s\S]*/gi, /Return STRICT JSON[\s\S]*/gi, /Required JSON shape:[\s\S]*/gi, /PREVIOUS POI METADATA[\s\S]*/gi, /VALIDATION(?: PROBLEMS?| OUTPUT)?:[\s\S]*/gi, /GENERATION BATCH:[\s\S]*/gi];
const QUERY_DROP_WORDS = /\b(generate|regenerate|defensible|pois?|candidates?|oversample|batch|schema|json|gemini|chitforge|instructions?|validation|rejected|missing|duplicate|duplicates|previous|pipeline|progress|recovering|recovery)\b/gi;
export function normalizeDdgsQuery(raw = '') {
  let query = String(raw || '');
  QUERY_STOP_PHRASES.forEach((rx) => { query = query.replace(rx, ' '); });
  query = query.replace(/[{}[\]"`]|https?:\/\/\S+/g, ' ');
  query = query.replace(/[_:|>]+/g, ' ');
  query = query.replace(QUERY_DROP_WORDS, ' ');
  const words = query.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const deduped = [];
  const seen = new Set();
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key) && word.length > 3) continue;
    seen.add(key); deduped.push(word);
  }
  let clean = deduped.join(' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= DDGS_LIMITS.queryMaxChars) return clean;
  const priority = clean.split(' ').filter((word) => /[A-Z][a-z]|^[A-Z]{2,}$|\d{4}|debt|climate|finance|treaty|vote|resolution|policy|IMF|UN|World|Bank|Paris|Club|Common|Framework|sovereign|development/i.test(word));
  clean = (priority.length >= 4 ? priority : clean.split(' ')).join(' ');
  while (clean.length > DDGS_LIMITS.queryMaxChars && clean.includes(' ')) clean = clean.replace(/\s+\S+$/, '');
  return clean.trim();
}
export function alternateQueryForNoResults(query) {
  const clean = normalizeDdgsQuery(query).replace(/\bbefore\s+\d{4}-\d{2}-\d{2}\b/i, '').replace(/\b(scandal|malpractice|controversy)\b/gi, '').replace(/\s+/g, ' ').trim();
  return normalizeDdgsQuery(`${clean} official report policy source`);
}

function contentSignature(result = {}) { return `${result.title || ''} ${result.body || result.snippet || ''}`.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 4).slice(0, 18).join(' '); }

export function buildResearchQueries({ form, sliders, selectedTargets = [], targetingMode, poiTypes = [] }) {
  const base = [form.committee, form.agenda, form.portfolio, form.researchNotes].filter(Boolean).join(' ');
  const freeze = form.freezeDate ? `before ${form.freezeDate}` : '';
  const targets = selectedTargets.length ? selectedTargets.map((t) => t.name).join(' OR ') : 'countries';
  const controversy = sliders.controversy >= 70 ? ['scandal investigation controversy contradiction', 'implementation failure malpractice accountability', 'voting contradiction treaty commitment'] : ['policy position official statement', 'UN vote treaty commitment'];
  const aggression = sliders.aggression >= 70 ? ['legal pressure accountability evidence', 'contradiction failure direct question'] : ['policy difference diplomatic position'];
  const queries = [`${base} ${freeze} official foreign policy doctrine strategic priorities`, `${base} ${freeze} UN resolution voting record treaty commitments`, `${base} ${targets} ${freeze} government statements policy contradiction`, `${base} ${targets} ${freeze} international organization report legal framework`, ...controversy.map((x) => `${base} ${targets} ${freeze} ${x}`), ...aggression.map((x) => `${base} ${targets} ${freeze} ${x}`), `${form.portfolio} foreign policy ${form.agenda} ${freeze}`, `${targets} foreign policy ${form.agenda} ${freeze}`, ...(poiTypes || []).filter((t) => t !== 'AUTO').slice(0, 4).map((type) => `${base} ${targets} ${type} ${freeze}`)];
  if (form.backgroundGuideName) queries.push(`${base} ${form.backgroundGuideName} background guide ${freeze}`);
  if (targetingMode !== 'selected_only') queries.push(`${base} automatic target countries relevant controversy ${freeze}`);
  return [...new Set(queries.map(normalizeDdgsQuery).filter(Boolean))].slice(0, 14);
}

export function deriveAutomaticTargetCandidates({ form, sources = [], selectedTargets = [] }) {
  const portfolio = String(form.portfolio || '').toLowerCase(); const manual = new Set((selectedTargets || []).map((t) => t.iso || t.name)); const mentions = new Map();
  const countryHints = [['RUS', 'Russia'], ['CHN', 'China'], ['USA', 'United States'], ['ISR', 'Israel'], ['IRN', 'Iran'], ['SAU', 'Saudi Arabia'], ['TUR', 'Türkiye'], ['IND', 'India'], ['PAK', 'Pakistan'], ['FRA', 'France'], ['GBR', 'United Kingdom'], ['DEU', 'Germany'], ['JPN', 'Japan'], ['BRA', 'Brazil'], ['ZAF', 'South Africa'], ['EGY', 'Egypt'], ['ETH', 'Ethiopia'], ['IDN', 'Indonesia'], ['UKR', 'Ukraine'], ['MEX', 'Mexico'], ['ARE', 'United Arab Emirates'], ['QAT', 'Qatar'], ['KWT', 'Kuwait'], ['BHR', 'Bahrain'], ['SGP', 'Singapore']];
  const context = [form.committee, form.agenda, form.researchNotes, form.backgroundGuideName, form.backgroundGuide?.text || form.backgroundGuideText, ...sources.map((s) => `${s.title} ${s.snippet} ${s.domain}`)].join(' ').toLowerCase();
  for (const [iso, name] of countryHints) { const key = name.toLowerCase(); if (manual.has(iso) || key === portfolio || iso.toLowerCase() === portfolio) continue; const count = (context.match(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length; if (count) mentions.set(iso, { iso, name, score: count, reason: `Mentioned in agenda/background/research context ${count} time(s) and not the portfolio country.` }); }
  return [...mentions.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

export async function checkDdgsHealth({ fetchImpl = fetch, baseUrl = DDGS_BASE_URL } = {}) {
  try { const res = await fetchWithTimeout(`${baseUrl}/health`, { method: 'GET' }, 2500, fetchImpl); return { ok: res.ok, status: res.status, detail: res.ok ? 'DDGS API healthy.' : await res.text().catch(() => '') }; }
  catch (error) { return { ok: false, status: 0, detail: error?.name === 'AbortError' ? 'DDGS health check timed out.' : `DDGS API unavailable: ${error?.message || error}` }; }
}
async function searchEndpointOnce(endpoint, query, maxResults, backend, { fetchImpl = fetch, baseUrl = DDGS_BASE_URL } = {}) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, region: 'us-en', safesearch: 'moderate', max_results: maxResults, backend }) }, DDGS_LIMITS.timeoutMs, fetchImpl);
    if (!res.ok) { const body = await res.text().catch(() => ''); const status = classifySearchFailure({ status: res.status, body }); return { ok: false, status, httpStatus: res.status, body, backend, query, results: [] }; }
    const payload = await res.json(); const results = Array.isArray(payload.results) ? payload.results : Array.isArray(payload) ? payload : [];
    return { ok: true, status: results.length ? SEARCH_STATUS.SUCCESS : SEARCH_STATUS.NO_RESULTS_FOR_QUERY, httpStatus: 200, backend, query, results };
  } catch (error) { return { ok: false, status: classifySearchFailure({ error }), httpStatus: 0, backend, query, error, results: [] }; }
}
async function searchTextOnce(query, maxResults, backend, options = {}) { return searchEndpointOnce('/search/text', query, maxResults, backend, options); }
async function searchNewsOnce(query, maxResults, backend, options = {}) { return searchEndpointOnce('/search/news', query, maxResults, backend, options); }
export function alternateQueries(query) {
  const alternate = alternateQueryForNoResults(query);
  const normalized = normalizeDdgsQuery(query);
  return alternate && alternate !== normalized ? [alternate] : [];
}
export async function searchWithBackendFallback(query, maxResults = 10, { fetchImpl = fetch, baseUrl = DDGS_BASE_URL, onAttempt, endpoint = '/search/text' } = {}) {
  const attempts = [];
  const backend = DDGS_TEXT_BACKEND;
  const normalized = normalizeDdgsQuery(query);
  const intentQueries = [...new Set([normalized, ...alternateQueries(normalized)].filter(Boolean))].slice(0, 2);
  for (let queryIndex = 0; queryIndex < intentQueries.length; queryIndex += 1) {
    const intentQuery = intentQueries[queryIndex];
    const maxAttempts = queryIndex === 0 ? DDGS_LIMITS.retries : 0;
    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      if (attempt) await sleep(jitter(DDGS_LIMITS.backoffBaseMs * (2 ** (attempt - 1))));
      const result = endpoint === '/search/news' ? await searchNewsOnce(intentQuery, maxResults, backend, { fetchImpl, baseUrl }) : await searchTextOnce(intentQuery, maxResults, backend, { fetchImpl, baseUrl });
      attempts.push({ query: intentQuery, backend, status: result.status, httpStatus: result.httpStatus }); onAttempt?.(attempts.at(-1));
      if (result.results.length) return { ...result, attempts };
      if (result.status === SEARCH_STATUS.NO_RESULTS_FOR_QUERY) break;
      if (!shouldRetrySearch(result.status)) break;
    }
  }
  return { ok: false, status: attempts.at(-1)?.status || SEARCH_STATUS.SEARCH_FAILED, query: normalized, backend, results: [], attempts };
}
async function extractOnce(source, { fetchImpl = fetch, baseUrl = DDGS_BASE_URL } = {}) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: source.url, fmt: 'text_plain' }) }, DDGS_LIMITS.timeoutMs, fetchImpl);
    if (!res.ok) { const body = await res.text().catch(() => ''); return { ...source, extractedText: '', extractionStatus: classifyExtractionFailure({ status: res.status, body }), extractionHttpStatus: res.status, retrievedAt: new Date().toISOString() }; }
    const payload = await res.json(); const extractedText = String(payload.content || '').slice(0, 2200);
    return { ...source, extractedText, extractionStatus: extractedText ? EXTRACTION_STATUS.RETRIEVED : EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED, extractionHttpStatus: 200, retrievedAt: new Date().toISOString() };
  } catch (error) { return { ...source, extractedText: '', extractionStatus: classifyExtractionFailure({ error }), extractionHttpStatus: 0, retrievedAt: new Date().toISOString() }; }
}
export async function extractSource(source, options = {}) {
  const first = await extractOnce(source, options);
  if (!shouldRetryExtract(first.extractionStatus) || first.extractionStatus === EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED) return first;
  await sleep(jitter(DDGS_LIMITS.backoffBaseMs));
  return extractOnce(source, options);
}
async function mapLimit(items, limit, fn) { const out = new Array(items.length); let next = 0; const workers = Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const index = next; next += 1; out[index] = await fn(items[index], index); } }); await Promise.all(workers); return out; }
function sourceFromResult(result, query, backend) { const url = canonicalUrl(result.href || result.url || result.link); const domain = domainFromResult(url); return { sourceId: `ddgs:${backend}:${url}`, url, canonicalUrl: url, title: result.title || 'Untitled source', snippet: result.body || result.snippet || '', publicationDate: result.date || result.published || '', domain, query, ddgsQuery: query, searchBackend: backend, bangUrl: bangUrl(domain, query), discoveryStatus: EXTRACTION_STATUS.DISCOVERED, extractionStatus: EXTRACTION_STATUS.DISCOVERED, retrievalStatus: EXTRACTION_STATUS.DISCOVERED, retrievedAt: new Date().toISOString() }; }

export async function discoverResearch({ form, sliders, selectedTargets, targetingMode, poiTypes, poiCount = 20, recoveryFocus = '', onProgress }) {
  const health = await checkDdgsHealth();
  const queries = buildResearchQueries({ form, sliders, selectedTargets, targetingMode, poiTypes });
  if (!health.ok) return { schema: 'DDGS API /search/text + /extract (OpenAPI 3.1.0)', health, queries, sources: [], retrievedSources: [], bangUrls: [], automaticTargetCandidates: [], failures: [{ status: 'DDGS_API_UNAVAILABLE', detail: health.detail }], stats: { queryCount: queries.length, discoveredUrls: 0, retainedUrls: 0, retrievedSources: 0, bangUrls: 0, hardMax: 0, softMax: 0, preferredRange: '0-0', adaptiveCeiling: 0, absoluteSafetyCeiling: DDGS_LIMITS.absoluteSafetyCeiling } };
  const budget = planResearchBudget({ poiCount, selectedTargets, sliders, form, coverageGaps: recoveryFocus ? 2 : 0 });
  const byUrl = new Map(); const contentSignatures = new Set(); const failures = []; let staleRounds = 0;
  for (const query of queries) {
    if (byUrl.size >= budget.softMax && staleRounds >= 2) break;
    onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `DDGS URL discovery: ${byUrl.size}/${budget.softMax} retained.`, done: byUrl.size, total: budget.softMax });
    const before = byUrl.size;
    const searches = [
      await searchWithBackendFallback(query, sliders.controversy >= 70 ? 12 : 8, { onAttempt: (attempt) => { if (attempt.status !== SEARCH_STATUS.SUCCESS) failures.push({ ...attempt, endpoint: '/search/text', recoverable: true }); } }),
      await searchWithBackendFallback(query, 4, { endpoint: '/search/news', onAttempt: (attempt) => { if (attempt.status !== SEARCH_STATUS.SUCCESS) failures.push({ ...attempt, endpoint: '/search/news', recoverable: true }); } }),
    ];
    searches.flatMap((search) => search.results.map((result) => ({ result, search }))).forEach(({ result, search }) => { if (byUrl.size >= budget.hardMax) return; const source = sourceFromResult(result, search.query, search.backend); const signature = contentSignature(result); if (!source.url || byUrl.has(source.url) || (signature && contentSignatures.has(signature)) || /wikipedia\.org/i.test(source.url)) return; if (signature) contentSignatures.add(signature); byUrl.set(source.url, source); });
    staleRounds = byUrl.size - before < 3 ? staleRounds + 1 : 0; await sleep(DDGS_LIMITS.searchPaceMs);
    if (byUrl.size >= budget.preferredMin && staleRounds >= 2) break;
  }
  const sources = [...byUrl.values()].slice(0, budget.hardMax);
  const extractionCandidates = sources.slice(0, Math.min(budget.extractMax, sources.length));
  const retrieved = await mapLimit(extractionCandidates, DDGS_LIMITS.extractConcurrency, async (source) => { const extracted = await extractSource(source); await sleep(DDGS_LIMITS.extractPaceMs); return extracted; });
  const merged = sources.map((source) => retrieved.find((r) => r.url === source.url) || source);
  const automaticTargetCandidates = deriveAutomaticTargetCandidates({ form, sources: merged, selectedTargets });
  return { schema: 'DDGS API /search/text + /extract (OpenAPI 3.1.0)', health, queries, sources: merged, retrievedSources: retrieved, bangUrls: merged.map((s) => s.bangUrl).filter(Boolean), automaticTargetCandidates, failures, stats: { queryCount: queries.length, discoveredUrls: byUrl.size, retainedUrls: merged.length, retrievedSources: retrieved.filter((s) => s.extractedText).length, extractionBlocked: retrieved.filter((s) => s.extractionStatus === EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED).length, bangUrls: merged.filter((s) => s.bangUrl).length, hardMax: budget.hardMax, softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, adaptiveCeiling: budget.hardMax, absoluteSafetyCeiling: budget.absoluteSafetyCeiling } };
}
