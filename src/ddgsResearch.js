const DDGS_BASE_URL = 'http://127.0.0.1:4479';
const DDGS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DDGS_SEARCH_DELAY = { textMinMs: 2200, textMaxMs: 3800, newsMinMs: 2500, newsMaxMs: 4500, extractMinMs: 1500, extractMaxMs: 2500 };
const DDGS_RETRY_DELAYS = [8000, 16000, 32000, 64000];
const DDGS_BATCH_SIZES = [10, 10, 8, 8, 6, 6, 5, 5, 4, 4];

export const DDGS_LIMITS = { sourceMultiplier: 6, queryMultiplier: 1.4, extractionMultiplier: 2, primaryPasses: 2, absoluteSafetyCeiling: 5000 };
export const DDGS_NEWS_BACKEND = 'auto';
export const DDGS_TEXT_BACKEND = 'auto';
export const DDGS_BACKENDS = [DDGS_TEXT_BACKEND];
export const DDGS_SCHEDULING = { searchDelay: DDGS_SEARCH_DELAY, retryDelays: DDGS_RETRY_DELAYS, maxSearchRetries: DDGS_RETRY_DELAYS.length, searchConcurrency: 4, extractConcurrency: 4, queryMaxChars: 120, userAgent: DDGS_USER_AGENT };
export const SEARCH_STATUS = { SUCCESS: 'SUCCESS', TRUE_EMPTY_RESULT: 'TRUE_EMPTY_RESULT', NO_RESULTS_FOR_QUERY: 'TRUE_EMPTY_RESULT', RATE_LIMITED: 'RATE_LIMITED', TIMEOUT: 'TIMEOUT', CONNECTION_ERROR: 'CONNECTION_ERROR', DDGS_UPSTREAM_ERROR: 'DDGS_UPSTREAM_FAILURE', SEARCH_FAILED: 'SEARCH_FAILED' };
export const EXTRACTION_STATUS = { DISCOVERED: 'DISCOVERED_FROM_SEARCH', RETRIEVED: 'RETRIEVED', DISCOVERED_NOT_RETRIEVED: 'DISCOVERED_NOT_RETRIEVED', DISCOVERED_DIRECT_EXTRACTION_BLOCKED: 'DISCOVERED_DIRECT_EXTRACTION_BLOCKED', RATE_LIMITED: 'RATE_LIMITED', DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR: 'DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR', DISCOVERED_NOT_RETRIEVED_TIMEOUT: 'DISCOVERED_NOT_RETRIEVED_TIMEOUT', DISCOVERED_NOT_RETRIEVED_NETWORK: 'DISCOVERED_NOT_RETRIEVED_NETWORK' };

export function canonicalUrl(raw = '') { try { const url = new URL(raw); url.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) => url.searchParams.delete(key)); url.hostname = url.hostname.replace(/^www\./, '').toLowerCase(); url.pathname = url.pathname.replace(/\/$/, ''); return url.toString(); } catch { return ''; } }
export function domainFromResult(url = '') { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
export function bangUrl(domain, query) { return domain ? `https://duckduckgo.com/?q=${encodeURIComponent(`!site:${domain} ${query}`)}` : ''; }
export function randomDelay(minMs, maxMs, rng = Math.random) { return minMs + rng() * (maxMs - minMs); }

export function getResearchSourceBudget(poiCount = 20) { const count = Math.max(1, Math.min(250, Math.ceil(Number(poiCount) || 20))); return Math.ceil(count * DDGS_LIMITS.sourceMultiplier); }
export function getResearchQueryBudget(poiCount = 20) { const count = Math.max(1, Math.min(250, Math.ceil(Number(poiCount) || 20))); return Math.ceil(count * DDGS_LIMITS.queryMultiplier); }
export function getResearchExtractionBudget(poiCount = 20) { const count = Math.max(1, Math.min(250, Math.ceil(Number(poiCount) || 20))); return Math.ceil(count * DDGS_LIMITS.extractionMultiplier); }
export function planResearchBudget({ poiCount = 20 } = {}) {
  const count = Math.max(1, Math.min(250, Math.ceil(Number(poiCount) || 20)));
  const sourcesPerPass = getResearchSourceBudget(count);
  const queriesPerPass = getResearchQueryBudget(count);
  const extractionsPerPass = getResearchExtractionBudget(count);
  const sourceBudget = sourcesPerPass * DDGS_LIMITS.primaryPasses;
  const queryBudget = queriesPerPass * DDGS_LIMITS.primaryPasses;
  const extractionBudget = extractionsPerPass * DDGS_LIMITS.primaryPasses;
  return { poiCount: count, primaryPasses: DDGS_LIMITS.primaryPasses, sourcesPerPass, queriesPerPass, extractionsPerPass, sourceBudget, queryBudget, extractionBudget, targetUrls: sourceBudget, hardMax: sourceBudget, softMax: Math.ceil(sourceBudget * 0.8), preferredMin: Math.ceil(sourceBudget * 0.35), preferredMax: Math.ceil(sourceBudget * 0.65), absoluteSafetyCeiling: DDGS_LIMITS.absoluteSafetyCeiling };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function browserHeaders(extra = {}) { return { 'User-Agent': DDGS_USER_AGENT, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://duckduckgo.com/', ...extra }; }
async function defaultDelay(ms) { await sleep(ms); }
async function fetchWithTimeout(url, options = {}, timeoutMs = 9000, fetchImpl = fetch) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } }
async function mapPool(items, concurrency, worker) { const results = new Array(items.length); let next = 0; const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await worker(items[index], index); } }); await Promise.all(workers); return results; }
function bodyText(value = '') { return String(value || '').toLowerCase(); }

export function classifySearchFailure({ status = 0, body = '', error } = {}) {
  const text = bodyText(`${body} ${error?.message || error || ''}`);
  if (/no results found|no result|no_results/.test(text)) return SEARCH_STATUS.TRUE_EMPTY_RESULT;
  if ([202, 403, 429].includes(status) || /rate.?limit|too many requests|ratelimit|anomaly|challenge/.test(text)) return SEARCH_STATUS.RATE_LIMITED;
  if ([500, 502, 503, 504].includes(status)) return SEARCH_STATUS.DDGS_UPSTREAM_ERROR;
  if (error?.name === 'AbortError' || /timeout|timed out|time out/.test(text)) return SEARCH_STATUS.TIMEOUT;
  if (/econn|connection|network|dns|enotfound|getaddrinfo|tls|ssl|certificate|protocol|reset/.test(text)) return SEARCH_STATUS.CONNECTION_ERROR;
  if (status >= 500 || /upstream|engine|backend|provider/.test(text)) return SEARCH_STATUS.DDGS_UPSTREAM_ERROR;
  return SEARCH_STATUS.SEARCH_FAILED;
}
export function classifyExtractionFailure({ status = 0, body = '', error } = {}) {
  const text = bodyText(`${body} ${error?.message || error || ''}`);
  if ([202, 401, 403].includes(status) || /robots|challenge/.test(text)) return EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED;
  if (status === 404) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED;
  if (status === 429 || /rate.?limit|too many requests/.test(text)) return EXTRACTION_STATUS.RATE_LIMITED;
  if (error?.name === 'AbortError' || /timeout|timed out|time out/.test(text)) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT;
  if (/econn|connection|network|dns|enotfound|getaddrinfo|tls|ssl|certificate|protocol|reset/.test(text)) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_NETWORK;
  if (status >= 500) return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR;
  return EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED;
}
function isTransientSearchStatus(status) { return [SEARCH_STATUS.RATE_LIMITED, SEARCH_STATUS.TIMEOUT, SEARCH_STATUS.CONNECTION_ERROR, SEARCH_STATUS.DDGS_UPSTREAM_ERROR].includes(status); }
function isThrottleStatus(status) { return [SEARCH_STATUS.RATE_LIMITED, SEARCH_STATUS.DDGS_UPSTREAM_ERROR].includes(status); }

const QUERY_STOP_PHRASES = [/RECOVERY LEVEL\s+\d+:[\s\S]*/gi, /Return STRICT JSON[\s\S]*/gi, /Required JSON shape:[\s\S]*/gi, /PREVIOUS POI METADATA[\s\S]*/gi, /VALIDATION(?: PROBLEMS?| OUTPUT)?:[\s\S]*/gi, /GENERATION BATCH:[\s\S]*/gi];
const QUERY_DROP_WORDS = /\b(generate|regenerate|defensible|pois?|candidates?|oversample|batch|schema|json|gemini|chitforge|instructions?|validation|rejected|missing|duplicate|duplicates|previous|pipeline|progress|recovering|recovery)\b/gi;
export function normalizeDdgsQuery(raw = '') {
  let query = String(raw || '');
  QUERY_STOP_PHRASES.forEach((rx) => { query = query.replace(rx, ' '); });
  query = query.replace(/https?:\/\/\S+/g, ' ');
  query = query.replace(/[{}[\]"`]/g, ' ');
  query = query.replace(/[_|>]+/g, ' ');
  query = query.replace(QUERY_DROP_WORDS, ' ');
  const words = query.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const deduped = [];
  const seen = new Set();
  for (const word of words) { const key = word.toLowerCase(); if (seen.has(key) && word.length > 3) continue; seen.add(key); deduped.push(word); }
  let clean = deduped.join(' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= DDGS_SCHEDULING.queryMaxChars) return clean;
  const tokens = clean.split(' ');
  const priority = tokens.filter((word) => /^[A-Z][\p{L}.'-]+/u.test(word) || /^[A-Z]{2,}$/.test(word) || /\d{4}/.test(word) || word.length > 8);
  clean = (priority.length >= 3 ? priority : tokens).join(' ');
  while (clean.length > DDGS_SCHEDULING.queryMaxChars && clean.includes(' ')) clean = clean.replace(/\s+\S+$/, '');
  return clean.trim();
}

function contentSignature(result = {}) { return `${result.title || ''} ${result.body || result.snippet || ''}`.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 4).slice(0, 18).join(' '); }
function cleanJoin(parts) { return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
function targetNames(selectedTargets = []) { return selectedTargets.map((t) => t.name).filter(Boolean); }

const CONTROVERSY_TERMS = ['scandal', 'investigation', 'allegation', 'probe', 'inquiry', 'misconduct', 'corruption', 'accountability', 'wrongdoing', 'cover-up', 'implementation failure', 'major controversy', 'fraud', 'abuse'];
const BOILERPLATE_WORDS = /\b(the|and|that|this|with|from|into|about|should|would|could|please|include|including|relevant|issues|agenda|concerns|focus|generate|json|gemini|validation|recovery|batch|schema|poi|strict|previous|pipeline|instructions?)\b/i;

function extractCompactTerms(text = '', limit = 5) {
  const clean = String(text || '').replace(QUERY_STOP_PHRASES[0], ' ').replace(/https?:\/\/\S+/g, ' ').replace(QUERY_DROP_WORDS, ' ').replace(/[(){}[\]"`]/g, ' ');
  const chunks = clean.split(/[.;,\n]|\band\b|\bor\b/i).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const terms = [];
  for (const chunk of chunks) {
    const words = chunk.split(' ').filter((word) => word && !BOILERPLATE_WORDS.test(word));
    for (let size = Math.min(3, words.length); size >= 2; size -= 1) {
      for (let i = 0; i <= words.length - size; i += 1) {
        const phrase = words.slice(i, i + size).join(' ').replace(/[^\p{L}\p{N}\s'/-]/gu, '').trim();
        if (phrase.length >= 8 && phrase.length <= 48 && !BOILERPLATE_WORDS.test(phrase)) terms.push(phrase);
      }
    }
    if (terms.length >= limit * 2) break;
  }
  return [...new Map(terms.map((term) => [term.toLowerCase(), term])).values()].slice(0, limit);
}

function researchLinksFromForm(form = {}) {
  const raw = form.researchLinks || form.sourceLinks || form.evidenceLinks || form.sources || [];
  return Array.isArray(raw) ? raw : [];
}
function linkDomains(links = []) {
  return links.map((link) => typeof link === 'string' ? link : (link.url || link.href || link.link || '')).map((url) => domainFromResult(url) || domainFromResult(`https://${String(url).replace(/^https?:\/\//, '').split('/')[0]}`)).filter(Boolean).slice(0, 3);
}
function buildResearchContext({ form = {}, sliders = {}, selectedTargets = [], targetingMode, poiTypes = [] } = {}) {
  const backgroundGuideText = form.backgroundGuideText || form.backgroundGuide?.text || '';
  const noteTerms = extractCompactTerms(form.researchNotes, 5);
  const guideTerms = extractCompactTerms(backgroundGuideText, 5);
  const linkContext = linkDomains(researchLinksFromForm(form));
  return { committee: form.committee || '', agenda: form.agenda || '', portfolio: form.portfolio || '', selectedTargets, targetingMode, controversy: Number(sliders.controversy || 0), aggression: Number(sliders.aggression || 0), diplomacy: Number(sliders.diplomacy || 0), freezeDate: form.freezeDate || '', researchNotes: form.researchNotes || '', backgroundGuideName: form.backgroundGuideName || '', backgroundGuideText, noteTerms, guideTerms, researchLinks: researchLinksFromForm(form), linkContext, poiTypes };
}
function addQuery(queries, parts) { const q = normalizeDdgsQuery(cleanJoin(parts)); if (q) queries.push(q); }

export function buildResearchQueries({ form = {}, sliders = {}, selectedTargets = [], targetingMode, poiTypes = [], queryBudget = getResearchQueryBudget(20) }) {
  const ctx = buildResearchContext({ form, sliders, selectedTargets, targetingMode, poiTypes });
  const queries = [];
  const agenda = ctx.agenda;
  if (!agenda) return [];
  const fundamental = ['policy', 'official position', 'implementation', 'agreement', 'resolution'];
  for (const angle of fundamental) addQuery(queries, [agenda, angle]);
  if (ctx.portfolio) ['official position', 'policy', 'commitment'].forEach((angle) => addQuery(queries, [ctx.portfolio, agenda, angle]));
  if (ctx.committee) ['resolution', 'statement'].forEach((angle) => addQuery(queries, [ctx.committee, agenda, angle]));
  [...ctx.noteTerms, ...ctx.guideTerms].slice(0, 6).forEach((term) => addQuery(queries, [agenda, term]));
  if (ctx.diplomacy >= 55) ['negotiation', 'coalition', 'diplomatic position'].forEach((angle) => addQuery(queries, [agenda, angle]));
  if (ctx.aggression >= 45 || ctx.diplomacy < 35) ['contradiction', 'implementation failure', 'accountability'].forEach((angle) => addQuery(queries, [agenda, angle]));
  if (ctx.aggression >= 70) ['legal obligation', 'treaty compliance', 'inconsistency'].forEach((angle) => addQuery(queries, [agenda, angle]));
  const targets = targetNames(selectedTargets).slice(0, 4);
  for (const target of targets) {
    ['policy', 'official position'].forEach((angle) => addQuery(queries, [target, agenda, angle]));
    if (ctx.aggression >= 45) ['contradiction', 'implementation failure'].forEach((angle) => addQuery(queries, [target, agenda, angle]));
    if (ctx.controversy >= 65) ['investigation', 'allegation', 'misconduct'].forEach((angle) => addQuery(queries, [target, agenda, angle]));
  }
  if (targetingMode !== 'selected_only') ['major actors', 'affected states', 'international actors'].forEach((angle) => addQuery(queries, [agenda, angle]));
  if (ctx.controversy >= 65) {
    ['scandal', 'investigation', 'allegation', 'accountability', 'controversy'].forEach((angle) => addQuery(queries, [agenda, angle]));
    const contextText = `${ctx.researchNotes} ${ctx.backgroundGuideText}`.toLowerCase();
    if (/corrupt|fraud|misconduct|abuse|brib|wrongdoing/.test(contextText)) addQuery(queries, [agenda, 'corruption']);
  }
  for (const type of (poiTypes || []).filter((t) => t && t !== 'AUTO').slice(0, 3)) addQuery(queries, [agenda, type.toLowerCase()]);
  for (const domain of ctx.linkContext) addQuery(queries, [agenda, `site:${domain}`]);
  return limitQueries(queries, queryBudget);
}

function queryKey(query = '') { return normalizeDdgsQuery(query).toLowerCase(); }
function limitQueries(queries, budget) { return [...new Map(queries.map((q) => [queryKey(q), q])).values()].filter((q) => q && q.length <= DDGS_SCHEDULING.queryMaxChars).slice(0, Math.max(1, budget)); }

function discoveryTermsFromSources(sources = [], limit = 10) {
  return extractCompactTerms(sources.map((s) => `${s.title || ''}. ${s.snippet || ''}. ${s.domain || ''}`).join('\n'), limit);
}

function expandResearchQueries({ form, selectedTargets = [], targetingMode, poiTypes = [], round = 0 }) {
  const sliders = { aggression: round >= 2 ? 65 : 35, controversy: round >= 4 ? 65 : 0, diplomacy: round % 2 ? 70 : 30 };
  const base = buildResearchQueries({ form, sliders, selectedTargets, targetingMode, poiTypes, queryBudget: getResearchQueryBudget(250) });
  const extraAngles = ['evidence', 'historical context', 'commitment', 'statement', 'legal framework', 'implementation report'];
  const queries = [...base];
  for (let i = 0; i < extraAngles.length; i += 1) addQuery(queries, [form.agenda, form.portfolio, extraAngles[(round + i) % extraAngles.length]]);
  return [...new Map(queries.map((q) => [q.toLowerCase(), q])).values()].filter(Boolean);
}

export function shouldSearchNews(query, { sliders = {}, researchContext } = {}) {
  const controversy = Number(sliders.controversy || researchContext?.controversy || 0);
  if (controversy < 65) return false;
  const hay = String(query || '').toLowerCase();
  return CONTROVERSY_TERMS.some((term) => hay.includes(term));
}
function resultCountForQuery(query, sliders = {}, endpoint = '/search/text') {
  if (endpoint === '/search/news') return sliders.controversy >= 70 ? 8 : 6;
  return /official|resolution|treaty|legal|report|implementation|agreement/i.test(query) ? 8 : 6;
}

export function deriveAutomaticTargetCandidates({ form, sources = [], selectedTargets = [] }) {
  const portfolio = String(form.portfolio || '').toLowerCase();
  const manual = new Set((selectedTargets || []).flatMap((t) => [String(t.iso || '').toLowerCase(), String(t.name || '').toLowerCase()]).filter(Boolean));
  const text = [form.committee, form.agenda, form.researchNotes, form.backgroundGuideName, form.backgroundGuide?.text || form.backgroundGuideText, ...sources.map((source) => `${source.title || ''} ${source.snippet || ''} ${source.domain || ''}`)].join('\n');
  const ignored = /^(The|And|For|With|From|This|That|These|Those|Committee|Agenda|Background|Guide|Official|Policy|Report|Statement|Implementation|International|United Nations|Security Council)$/;
  const mentions = new Map();
  const rx = /\b([A-Z][\p{L}.'-]+(?:\s+(?:of|and|the|[A-Z][\p{L}.'-]+)){0,4})\b/gu;
  for (const match of text.matchAll(rx)) {
    const name = match[1].replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (name.length < 4 || ignored.test(name) || key === portfolio || manual.has(key) || /^(un|usa|uk|eu)$/i.test(name)) continue;
    const current = mentions.get(key) || { iso: `AUTO-${mentions.size + 1}`, name, score: 0, reason: 'Mentioned in agenda/background/research context and not the portfolio.' };
    current.score += 1;
    current.reason = `Mentioned in agenda/background/research context ${current.score} time(s) and not the portfolio.`;
    mentions.set(key, current);
  }
  return [...mentions.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 8);
}


export async function checkDdgsHealth({ fetchImpl = fetch, baseUrl = DDGS_BASE_URL } = {}) {
  try { const res = await fetchWithTimeout(`${baseUrl}/health`, { method: 'GET', headers: browserHeaders({ Accept: 'application/json, text/plain, */*' }) }, 2500, fetchImpl); return { ok: res.ok, status: res.status, detail: res.ok ? 'DDGS API healthy.' : await res.text().catch(() => '') }; }
  catch (error) { return { ok: false, status: 0, detail: error?.name === 'AbortError' ? 'DDGS health check timed out.' : `DDGS API unavailable: ${error?.message || error}` }; }
}
async function searchEndpointOnce(endpoint, query, maxResults, backend, { fetchImpl = fetch, baseUrl = DDGS_BASE_URL } = {}) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}${endpoint}`, { method: 'POST', headers: browserHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ query, region: 'us-en', safesearch: 'moderate', max_results: maxResults, backend }) }, 9000, fetchImpl);
    if (!res.ok) { const body = await res.text().catch(() => ''); return { ok: false, status: classifySearchFailure({ status: res.status, body }), httpStatus: res.status, body, backend, query, endpoint, results: [] }; }
    const payload = await res.json(); const results = Array.isArray(payload.results) ? payload.results : Array.isArray(payload) ? payload : [];
    return { ok: true, status: results.length ? SEARCH_STATUS.SUCCESS : SEARCH_STATUS.TRUE_EMPTY_RESULT, httpStatus: 200, backend, query, endpoint, results };
  } catch (error) { return { ok: false, status: classifySearchFailure({ error }), httpStatus: 0, backend, query, endpoint, error, results: [] }; }
}
async function searchTextOnce(query, maxResults, backend, options = {}) { return searchEndpointOnce('/search/text', query, maxResults, backend, options); }
async function searchNewsOnce(query, maxResults, backend, options = {}) { return searchEndpointOnce('/search/news', query, maxResults, backend, options); }
function normalDelayForEndpoint(endpoint, rng) { return endpoint === '/search/news' ? randomDelay(DDGS_SEARCH_DELAY.newsMinMs, DDGS_SEARCH_DELAY.newsMaxMs, rng) : randomDelay(DDGS_SEARCH_DELAY.textMinMs, DDGS_SEARCH_DELAY.textMaxMs, rng); }
function retryDelayForAttempt(attemptIndex, rng) { const base = DDGS_RETRY_DELAYS[Math.min(attemptIndex, DDGS_RETRY_DELAYS.length - 1)]; return base + randomDelay(0, Math.min(base, 8000), rng); }

export async function searchWithBackendFallback(query, maxResults = 10, { fetchImpl = fetch, baseUrl = DDGS_BASE_URL, onAttempt, endpoint = '/search/text', delayFn = defaultDelay, rng = Math.random, pace = true } = {}) {
  const attempts = [];
  const backend = endpoint === '/search/news' ? DDGS_NEWS_BACKEND : DDGS_TEXT_BACKEND;
  const normalized = normalizeDdgsQuery(query);
  let lastResult = null;
  for (let attempt = 0; attempt <= DDGS_RETRY_DELAYS.length; attempt += 1) {
    const result = endpoint === '/search/news' ? await searchNewsOnce(normalized, maxResults, backend, { fetchImpl, baseUrl }) : await searchTextOnce(normalized, maxResults, backend, { fetchImpl, baseUrl });
    lastResult = result;
    const attemptRecord = { query: normalized, backend, status: result.status, httpStatus: result.httpStatus, endpoint, attempt: attempt + 1 };
    attempts.push(attemptRecord); onAttempt?.(attemptRecord);
    if (result.status === SEARCH_STATUS.TRUE_EMPTY_RESULT || result.results.length || !isTransientSearchStatus(result.status) || attempt === DDGS_RETRY_DELAYS.length || endpoint === '/search/news') break;
    if (pace) await delayFn(retryDelayForAttempt(attempt, rng), { kind: 'backoff', endpoint, query: normalized, attempt: attempt + 1, status: result.status });
  }
  if (pace) await delayFn(normalDelayForEndpoint(endpoint, rng), { kind: 'search-pace', endpoint, query: normalized, status: lastResult?.status });
  return { ok: Boolean(lastResult?.results?.length), status: lastResult?.status || SEARCH_STATUS.SEARCH_FAILED, query: normalized, backend, endpoint, results: lastResult?.results || [], attempts };
}

async function extractOnce(source, { fetchImpl = fetch, baseUrl = DDGS_BASE_URL } = {}) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/extract`, { method: 'POST', headers: browserHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ url: source.url, fmt: 'text_plain' }) }, 9000, fetchImpl);
    if (!res.ok) { const body = await res.text().catch(() => ''); return { ...source, extractedText: '', extractionStatus: classifyExtractionFailure({ status: res.status, body }), extractionHttpStatus: res.status, retrievalStatus: EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED, retrievedAt: new Date().toISOString() }; }
    const payload = await res.json(); const extractedText = String(payload.content || '').slice(0, 2200);
    const status = extractedText ? EXTRACTION_STATUS.RETRIEVED : EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED;
    return { ...source, extractedText, extractionStatus: status, extractionHttpStatus: 200, retrievalStatus: status, retrievedAt: new Date().toISOString() };
  } catch (error) { const status = classifyExtractionFailure({ error }); return { ...source, extractedText: '', extractionStatus: status, extractionHttpStatus: 0, retrievalStatus: status, retrievedAt: new Date().toISOString() }; }
}
export async function extractSource(source, options = {}) { return extractOnce(source, options); }

function extractionCacheEntries(cache) {
  if (!cache) return [];
  if (Array.isArray(cache)) return cache;
  if (cache instanceof Map) return [...cache.entries()].map(([canonicalUrlValue, source]) => ({ canonicalUrl: canonicalUrlValue, source }));
  return Object.entries(cache).map(([canonicalUrlValue, source]) => ({ canonicalUrl: canonicalUrlValue, source }));
}
function sourceHasCompletedExtraction(source = {}) {
  const status = source.extractionStatus || source.retrievalStatus || '';
  return Boolean(source.extractedText) || (status && status !== EXTRACTION_STATUS.DISCOVERED);
}
function buildExtractionCache(researchState = {}) {
  const cache = new Map();
  for (const entry of extractionCacheEntries(researchState.extractionCache)) {
    const source = entry?.source || entry?.value || entry;
    const key = canonicalUrl(entry?.canonicalUrl || source?.canonicalUrl || source?.url || '');
    if (key && sourceHasCompletedExtraction(source)) cache.set(key, { ...source, canonicalUrl: key, url: source.url || key });
  }
  for (const source of researchState.sources || []) {
    const key = canonicalUrl(source.canonicalUrl || source.url || '');
    if (key && sourceHasCompletedExtraction(source) && !cache.has(key)) cache.set(key, { ...source, canonicalUrl: key, url: source.url || key });
  }
  return cache;
}
function serializeExtractionCache(cache) { return [...cache.entries()].map(([canonicalUrlValue, source]) => ({ canonicalUrl: canonicalUrlValue, source })); }

function sourceFromResult(result, query, backend, endpoint = '/search/text') {
  const url = canonicalUrl(result.href || result.url || result.link);
  const domain = domainFromResult(url);
  const publicationDate = result.date || result.published || '';
  return { sourceId: `ddgs:${backend}:${url}`, url, canonicalUrl: url, title: result.title || 'Untitled source', snippet: result.body || result.snippet || '', publicationDate, domain, query, ddgsQuery: query, backend, searchBackend: backend, searchEndpoint: endpoint, date: endpoint === '/search/news' ? result.date || '' : publicationDate, sourceType: endpoint === '/search/news' ? 'news' : 'text', source: endpoint === '/search/news' ? result.source || '' : undefined, image: endpoint === '/search/news' ? result.image || null : undefined, bangUrl: bangUrl(domain, query), discoveryStatus: EXTRACTION_STATUS.DISCOVERED, extractionStatus: EXTRACTION_STATUS.DISCOVERED, retrievalStatus: EXTRACTION_STATUS.DISCOVERED, retrievedAt: new Date().toISOString() };
}

function missionTerms({ form = {}, selectedTargets = [], poiTypes = [] } = {}) {
  return [form.committee, form.agenda, form.portfolio, form.researchNotes, form.backgroundGuideName, form.backgroundGuideText || form.backgroundGuide?.text, ...(selectedTargets || []).map((t) => t.name), ...(poiTypes || [])]
    .flatMap((value) => extractCompactTerms(value, 8))
    .map((term) => term.toLowerCase());
}

export function scoreResult(result = {}, { form = {}, selectedTargets = [], poiTypes = [], query = '', endpoint = '/search/text' } = {}) {
  const hay = `${result.title || ''} ${result.snippet || result.body || ''} ${result.domain || domainFromResult(result.url || result.href || '')} ${query}`.toLowerCase();
  let score = 0;
  for (const term of missionTerms({ form, selectedTargets, poiTypes })) if (term && hay.includes(term)) score += 3;
  const domain = domainFromResult(result.url || result.href || result.link || '') || String(result.domain || '').toLowerCase();
  if (/\.(gov|int|edu)(?:\.|$)|(^|\.)un\.org$|(^|\.)worldbank\.org$|(^|\.)imf\.org$|(^|\.)oecd\.org$|(^|\.)wto\.org$|(^|\.)icc-cpi\.int$|(^|\.)icj-cij\.org$/i.test(domain)) score += 8;
  if (/official|government|ministry|parliament|court|tribunal|commission|agency|secretariat|treaty|resolution|report|statement|vote|voting|policy|implementation|compliance|agreement|findings|audit|inquiry|investigation/i.test(hay)) score += 4;
  if (endpoint === '/search/news' && /investigation|controversy|allegation|misconduct|failure|dispute|findings|probe|inquiry|accountability|announced|reported/i.test(hay)) score += 3;
  if (/wikipedia\.org|blogspot|medium\.com/i.test(domain)) score -= 6;
  return score;
}
function isAfterFreezeDate(dateValue, freezeDate) {
  if (!dateValue || !freezeDate) return false;
  const date = new Date(dateValue);
  const freeze = new Date(`${freezeDate}T23:59:59Z`);
  return Number.isFinite(date.getTime()) && Number.isFinite(freeze.getTime()) && date > freeze;
}
function retainResults({ results, search, endpoint, byUrl, contentSignatures, stats, freezeDate = '', sourceBudget = DDGS_LIMITS.absoluteSafetyCeiling, form = {}, selectedTargets = [], poiTypes = [] }) {
  let added = 0;
  for (const result of results) {
    if (byUrl.size >= sourceBudget) break;
    const source = sourceFromResult(result, search.query, search.backend, endpoint);
    source.relevanceScore = scoreResult({ ...result, url: source.url, domain: source.domain }, { form, selectedTargets, poiTypes, query: search.query, endpoint });
    const signature = contentSignature(result);
    if (!source.url || /wikipedia\.org/i.test(source.url) || isAfterFreezeDate(source.publicationDate || source.date, freezeDate)) { stats.filteredUrls += 1; stats.rejectedSources = (stats.rejectedSources || 0) + 1; continue; }
    if (byUrl.has(source.url)) { stats.deduplicatedUrls += 1; stats.duplicateUrls = (stats.duplicateUrls || 0) + 1; continue; }
    if (signature && contentSignatures.has(signature)) { stats.deduplicatedUrls += 1; stats.contentDuplicates = (stats.contentDuplicates || 0) + 1; continue; }
    if (signature) contentSignatures.add(signature);
    byUrl.set(source.url, source); added += 1; stats.uniqueUrlsDiscovered = byUrl.size;
  }
  return added;
}
function batchSizeForUrlCount(count) { if (count < 25) return 8; if (count < 50) return 6; return 4; }
function shouldStopAfterBatch({ retained, budget, batchYield, staleBatches, queryPoolExhausted, throttleExhausted }) {
  if (retained >= budget.sourceBudget) return true;
  if (throttleExhausted && staleBatches >= 6) return true;
  if (retained < Math.min(budget.preferredMin, budget.targetUrls)) return queryPoolExhausted && staleBatches >= 4;
  if (retained >= budget.targetUrls && staleBatches >= 2) return true;
  if (retained >= budget.preferredMax && batchYield <= 2) return true;
  if (retained >= budget.softMax && batchYield <= 4) return true;
  return queryPoolExhausted && staleBatches >= 5;
}

export async function discoverResearch({ form, sliders = {}, selectedTargets, targetingMode, poiTypes, poiCount = 20, researchState = null, onProgress, fetchImpl = fetch, baseUrl = DDGS_BASE_URL, delayFn = defaultDelay, rng = Math.random, skipHealthCheck = false } = {}) {
  const health = skipHealthCheck ? { ok: true, status: 200, detail: 'DDGS health check skipped by test harness.' } : await checkDdgsHealth({ fetchImpl, baseUrl });
  const budget = planResearchBudget({ poiCount });
  const initialQueries = buildResearchQueries({ form, sliders, selectedTargets, targetingMode, poiTypes, queryBudget: budget.queryBudget });
  if (!health.ok) return { schema: 'DDGS API /search/text + /search/news + /extract (OpenAPI 3.1.0)', health, queries: initialQueries, sources: [], retrievedSources: [], bangUrls: [], automaticTargetCandidates: [], failures: [{ status: 'DDGS_API_UNAVAILABLE', detail: health.detail, category: 'ddgs-research-failure' }], stats: { searchedQueries: 0, successfulQueries: 0, failedQueries: 0, duplicateQueries: 0, uniqueUrlsDiscovered: 0, queryCount: initialQueries.length, discoveredUrls: 0, retainedUrls: 0, deduplicatedUrls: 0, textSearches: 0, newsSearches: 0, retrievedSources: 0, extractionFailed: 0, hardMax: budget.hardMax, sourceBudget: budget.sourceBudget, queryBudget: budget.queryBudget, extractionBudget: budget.extractionBudget, extractionCallsRemaining: budget.extractionBudget, softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, targetUrls: budget.targetUrls, degraded: true } };

  const byUrl = new Map((researchState?.sources || []).map((source) => [canonicalUrl(source.canonicalUrl || source.url), source]).filter(([url]) => url)); const contentSignatures = new Set(researchState?.contentSignatures || []); for (const source of byUrl.values()) { const sig = contentSignature(source); if (sig) contentSignatures.add(sig); } const failures = [...(researchState?.failedQueries || [])]; const searched = new Set([...(researchState?.searchedQueryKeys || []), ...(researchState?.exhaustedQueryKeys || [])]); const newsSearched = new Set(researchState?.newsQueryKeys || []); const queryQueue = [...initialQueries]; const extractionCache = buildExtractionCache(researchState || {}); const priorExtractionCalls = Number(researchState?.researchBudgetConsumed?.extractionCalls || researchState?.researchBudgetConsumed?.extractions || 0); let extractionCalls = priorExtractionCalls;
  const stats = { searchedQueries: 0, successfulQueries: 0, failedQueries: 0, duplicateQueries: 0, uniqueUrlsDiscovered: 0, deduplicatedUrls: 0, duplicateUrls: 0, contentDuplicates: 0, filteredUrls: 0, rejectedSources: 0, cachedSources: 0, textSearches: 0, newsSearches: 0, extractionCompleted: 0, extractionFailed: 0, retryBackoffs: 0, throttleBackoffs: 0, extractionReused: 0, extractionSkippedBudget: 0, rawResults: 0, rejectedUrls: 0, duplicateHeavyExpansions: 0 };
  let expansionRound = 0; let staleBatches = 0; let throttleFailures = 0; let throttleExhausted = false; let adaptiveSearchConcurrency = DDGS_SCHEDULING.searchConcurrency;

  const passSummaries = [];
  for (let pass = 1; pass <= budget.primaryPasses; pass += 1) {
    const passStartSources = byUrl.size;
    const passStartQueries = searched.size;
    const passSourceGoal = Math.min(budget.sourceBudget, pass * budget.sourcesPerPass);
    const passQueryGoal = Math.min(budget.queryBudget, pass * budget.queriesPerPass);
    if (pass === 2) {
      const discoveredTerms = discoveryTermsFromSources([...byUrl.values()], Math.min(12, budget.queriesPerPass));
      for (const term of discoveredTerms) addQuery(queryQueue, [form.agenda, form.portfolio, term]);
    }
    onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `Research pass ${pass}/${budget.primaryPasses}: ${byUrl.size}/${passSourceGoal} unique sources · ${searched.size}/${passQueryGoal} queries.`, done: byUrl.size - passStartSources, total: Math.max(1, passSourceGoal - passStartSources) });
    const safetyQueryCeiling = Math.min(budget.absoluteSafetyCeiling, Math.max(passQueryGoal, passSourceGoal * 4));
    while (byUrl.size < passSourceGoal && searched.size < safetyQueryCeiling) {
      const requestedBatchSize = batchSizeForUrlCount(byUrl.size) || DDGS_BATCH_SIZES[Math.min(expansionRound, DDGS_BATCH_SIZES.length - 1)] || 4;
      const expansionSafetyCeiling = Math.max(80, budget.queriesPerPass * budget.primaryPasses * 4);
      while (queryQueue.filter((q) => !searched.has(queryKey(q))).length < requestedBatchSize && expansionRound < expansionSafetyCeiling) {
        for (const q of expandResearchQueries({ form, selectedTargets, targetingMode, poiTypes, round: expansionRound + (pass === 2 ? 20 : 0) })) {
          if (!queryQueue.some((existing) => queryKey(existing) === queryKey(q)) && !searched.has(queryKey(q))) queryQueue.push(q); else stats.duplicateQueries += 1;
        }
        expansionRound += 1;
      }
      const batch = [];
      while (batch.length < requestedBatchSize && queryQueue.length && searched.size < safetyQueryCeiling) {
        const query = queryQueue.shift();
        const key = queryKey(query);
        if (!query || searched.has(key)) { stats.duplicateQueries += 1; continue; }
        searched.add(key); batch.push(query);
      }
      if (!batch.length) break;
      const beforeBatch = byUrl.size;
      const beforeRaw = stats.rawResults;
      const searchOutputs = await mapPool(batch, adaptiveSearchConcurrency, async (query) => {
        onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `Research pass ${pass}/${budget.primaryPasses}: ${byUrl.size}/${passSourceGoal} useful unique sources · ${stats.searchedQueries} queries · duplicates ${stats.deduplicatedUrls}`, done: byUrl.size - passStartSources, total: Math.max(1, passSourceGoal - passStartSources) });
        const textSearch = await searchWithBackendFallback(query, resultCountForQuery(query, sliders, '/search/text'), { fetchImpl, baseUrl, delayFn, rng, endpoint: '/search/text', onAttempt: (attempt) => { if (attempt.attempt > 1) stats.retryBackoffs += 1; if (attempt.status !== SEARCH_STATUS.SUCCESS) failures.push({ ...attempt, recoverable: isTransientSearchStatus(attempt.status), category: 'ddgs-research-failure' }); } });
        let newsSearch = null;
        if (shouldSearchNews(query, { form, sliders }) && !newsSearched.has(queryKey(query)) && !(researchState?.newsDisabled)) {
          newsSearched.add(queryKey(query));
          newsSearch = await searchWithBackendFallback(query, resultCountForQuery(query, sliders, '/search/news'), { fetchImpl, baseUrl, delayFn, rng, endpoint: '/search/news', onAttempt: (attempt) => { if (attempt.attempt > 1) stats.retryBackoffs += 1; if (attempt.status !== SEARCH_STATUS.SUCCESS) failures.push({ ...attempt, recoverable: isTransientSearchStatus(attempt.status), category: 'ddgs-research-failure' }); } });
        }
        return { query, textSearch, newsSearch };
      });
      for (const { textSearch, newsSearch } of searchOutputs) {
        stats.searchedQueries += 1; stats.textSearches += 1; stats.rawResults += textSearch.results.length;
        if (textSearch.results.length) stats.successfulQueries += 1; else stats.failedQueries += 1;
        retainResults({ results: textSearch.results, search: textSearch, endpoint: '/search/text', byUrl, contentSignatures, stats, freezeDate: form.freezeDate, sourceBudget: budget.sourceBudget, form, selectedTargets, poiTypes });
        if (isThrottleStatus(textSearch.status)) { throttleFailures += 1; stats.throttleBackoffs += 1; } else if (textSearch.results.length) throttleFailures = 0;
        if (newsSearch) { stats.searchedQueries += 1; stats.newsSearches += 1; stats.rawResults += newsSearch.results.length; if (newsSearch.results.length) stats.successfulQueries += 1; else stats.failedQueries += 1; retainResults({ results: newsSearch.results, search: newsSearch, endpoint: '/search/news', byUrl, contentSignatures, stats, freezeDate: form.freezeDate, sourceBudget: budget.sourceBudget, form, selectedTargets, poiTypes }); if (isThrottleStatus(newsSearch.status)) { throttleFailures += 1; stats.throttleBackoffs += 1; } else if (newsSearch.results.length) throttleFailures = 0; }
        if (throttleFailures >= 3) { throttleExhausted = true; adaptiveSearchConcurrency = Math.max(1, Math.floor(adaptiveSearchConcurrency / 2)); stats.adaptiveThrottleReductions = (stats.adaptiveThrottleReductions || 0) + 1; await delayFn(DDGS_RETRY_DELAYS[Math.min(stats.adaptiveThrottleReductions - 1, DDGS_RETRY_DELAYS.length - 1)], { kind: 'adaptive-throttle-backoff' }); throttleFailures = 0; } else if (textSearch.results.length || newsSearch?.results?.length) { adaptiveSearchConcurrency = Math.min(DDGS_SCHEDULING.searchConcurrency, adaptiveSearchConcurrency + 1); }
      }
      const batchYield = byUrl.size - beforeBatch;
      const duplicateHeavy = stats.rawResults > beforeRaw && batchYield / Math.max(1, stats.rawResults - beforeRaw) < 0.35;
      if (duplicateHeavy) stats.duplicateHeavyExpansions += 1;
      staleBatches = batchYield <= (byUrl.size < budget.preferredMin ? 2 : 4) ? staleBatches + 1 : 0;
      const queryPoolExhausted = !queryQueue.some((q) => !searched.has(queryKey(q))) && expansionRound >= expansionSafetyCeiling;
      if (shouldStopAfterBatch({ retained: byUrl.size, budget: { ...budget, sourceBudget: passSourceGoal, targetUrls: passSourceGoal }, batchYield, staleBatches, queryPoolExhausted, throttleExhausted })) break;
    }
    passSummaries.push({ pass, sourceTarget: budget.sourcesPerPass, extractionTarget: budget.extractionsPerPass, startSources: passStartSources, endSources: byUrl.size, newSources: byUrl.size - passStartSources, startQueries: passStartQueries, endQueries: searched.size, newQueries: searched.size - passStartQueries, queryKeys: [...searched].slice(passStartQueries), gaps: pass === 1 ? ['pass-2-fill-underrepresented-targets', 'pass-2-expand-source-evidence'] : [] });
  }

  const sources = [...byUrl.values()].slice(0, budget.sourceBudget);
  const retrieved = [];
  const extractionCeiling = budget.extractionBudget;
  const remainingExtractionCalls = Math.max(0, extractionCeiling - extractionCalls);
  const extractionCandidates = [];
  for (const source of sources) {
    const key = canonicalUrl(source.canonicalUrl || source.url);
    const cached = extractionCache.get(key);
    if (cached) { stats.extractionReused += 1; stats.cachedSources += 1; continue; }
    if (sourceHasCompletedExtraction(source)) { extractionCache.set(key, { ...source, canonicalUrl: key }); stats.extractionReused += 1; stats.cachedSources += 1; continue; }
    extractionCandidates.push({ ...source, canonicalUrl: key });
  }
  const selectedForExtraction = extractionCandidates.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)).slice(0, remainingExtractionCalls);
  stats.extractionSkippedBudget = Math.max(0, extractionCandidates.length - selectedForExtraction.length);
  if (selectedForExtraction.length) onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `Extracting ${selectedForExtraction.length} new source(s); reusing ${stats.extractionReused} cached extraction result(s).`, done: 0, total: extractionCeiling });
  else if (stats.extractionReused) onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `No new extraction required; reusing ${stats.extractionReused} previously processed source(s).`, done: stats.extractionReused, total: extractionCeiling });
  const extractedBatch = await mapPool(selectedForExtraction, DDGS_SCHEDULING.extractConcurrency, async (source, i) => {
    onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `Extracting ${i + 1}/${selectedForExtraction.length} selected source(s).`, done: i + 1, total: selectedForExtraction.length });
    const extracted = await extractSource(source, { fetchImpl, baseUrl });
    await delayFn(randomDelay(DDGS_SEARCH_DELAY.extractMinMs, DDGS_SEARCH_DELAY.extractMaxMs, rng), { kind: 'extract-pace', url: source.url });
    return { source, extracted };
  });
  for (const { source, extracted } of extractedBatch) {
    const key = canonicalUrl(extracted.canonicalUrl || extracted.url || source.url);
    const cached = { ...extracted, canonicalUrl: key || extracted.canonicalUrl || source.canonicalUrl };
    if (key) extractionCache.set(key, cached);
    retrieved.push(cached); extractionCalls += 1;
    if (cached.extractionStatus === EXTRACTION_STATUS.RETRIEVED) stats.extractionCompleted += 1; else stats.extractionFailed += 1;
  }
  const retrievedByUrl = new Map([...extractionCache.entries()].map(([url, source]) => [url, source]));
  const merged = sources.map((source) => retrievedByUrl.get(canonicalUrl(source.canonicalUrl || source.url)) || source);
  const retrievedCorpus = merged.filter((source) => sourceHasCompletedExtraction(source));
  const automaticTargetCandidates = deriveAutomaticTargetCandidates({ form, sources: merged, selectedTargets });
  const searchedQueries = [...searched];
  return { schema: 'DDGS API /search/text + /search/news + /extract (OpenAPI 3.1.0)', health, queries: searchedQueries, plannedQueries: [...new Set([...searchedQueries, ...queryQueue])], sources: merged, retrievedSources: retrievedCorpus, bangUrls: merged.map((s) => s.bangUrl).filter(Boolean), automaticTargetCandidates, failures, stats: { ...stats, primaryPasses: budget.primaryPasses, passSummaries, sourcesPerPass: budget.sourcesPerPass, extractionsPerPass: budget.extractionsPerPass, queriesPerPass: budget.queriesPerPass, queryCount: searchedQueries.length, discoveredUrls: byUrl.size, retainedUrls: merged.length, retrievedSources: retrievedCorpus.filter((s) => s.extractedText).length, bangUrls: merged.filter((s) => s.bangUrl).length, hardMax: budget.hardMax, sourceBudget: budget.sourceBudget, queryBudget: budget.queryBudget, extractionBudget: budget.extractionBudget, extractionCallsRemaining: Math.max(0, budget.extractionBudget - extractionCalls), softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, targetUrls: budget.targetUrls, degraded: throttleExhausted || merged.length < budget.preferredMin, throttleExhausted, uniqueUrlsDiscovered: byUrl.size, researchBudgetConsumed: { queries: searched.size, sources: byUrl.size, extractions: extractionCalls, extractionCalls } }, researchState: { searchedQueryKeys: [...searched], exhaustedQueryKeys: [...searched], newsQueryKeys: [...newsSearched], canonicalSourceUrls: [...byUrl.keys()], contentSignatures: [...contentSignatures], extractionCache: serializeExtractionCache(extractionCache), failedQueries: failures, throttledNewsState: { disabled: throttleExhausted }, recoveryRound: Number(researchState?.recoveryRound || 0) + (researchState ? 1 : 0), researchBudgetConsumed: { queries: searched.size, sources: byUrl.size, extractions: extractionCalls, extractionCalls }, sources: merged } }; 
}
