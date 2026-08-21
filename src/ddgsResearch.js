const DDGS_BASE_URL = 'http://127.0.0.1:4479';
const DDGS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DDGS_SEARCH_DELAY = { textMinMs: 4000, textMaxMs: 7000, newsMinMs: 5000, newsMaxMs: 8000, extractMinMs: 2000, extractMaxMs: 4000 };
const DDGS_RETRY_DELAYS = [8000, 16000, 32000, 64000];
const DDGS_BATCH_SIZES = [10, 10, 8, 8, 6, 6, 5, 5, 4, 4];

export const DDGS_LIMITS = { preferredMin: 25, preferredMax: 50, softMax: 60, hardMax: 750 };
export const DDGS_NEWS_BACKEND = 'auto';
export const DDGS_TEXT_BACKEND = 'auto';
export const DDGS_BACKENDS = [DDGS_TEXT_BACKEND];
export const DDGS_SCHEDULING = { searchDelay: DDGS_SEARCH_DELAY, retryDelays: DDGS_RETRY_DELAYS, maxSearchRetries: DDGS_RETRY_DELAYS.length, maxExtractedSources: 150, searchConcurrency: 1, extractConcurrency: 1, queryMaxChars: 120, userAgent: DDGS_USER_AGENT, sourceMultiplier: 3, queryMultiplier: 0.25, extractionRatio: 0.25, newsThrottleLimit: 3 };
export const SEARCH_STATUS = { SUCCESS: 'SUCCESS', TRUE_EMPTY_RESULT: 'TRUE_EMPTY_RESULT', NO_RESULTS_FOR_QUERY: 'TRUE_EMPTY_RESULT', RATE_LIMITED: 'RATE_LIMITED', TIMEOUT: 'TIMEOUT', CONNECTION_ERROR: 'CONNECTION_ERROR', DDGS_UPSTREAM_ERROR: 'DDGS_UPSTREAM_FAILURE', SEARCH_FAILED: 'SEARCH_FAILED' };
export const EXTRACTION_STATUS = { DISCOVERED: 'DISCOVERED_FROM_SEARCH', RETRIEVED: 'RETRIEVED', DISCOVERED_NOT_RETRIEVED: 'DISCOVERED_NOT_RETRIEVED', DISCOVERED_DIRECT_EXTRACTION_BLOCKED: 'DISCOVERED_DIRECT_EXTRACTION_BLOCKED', RATE_LIMITED: 'RATE_LIMITED', DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR: 'DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR', DISCOVERED_NOT_RETRIEVED_TIMEOUT: 'DISCOVERED_NOT_RETRIEVED_TIMEOUT', DISCOVERED_NOT_RETRIEVED_NETWORK: 'DISCOVERED_NOT_RETRIEVED_NETWORK' };

export function canonicalUrl(raw = '') { try { const url = new URL(raw); url.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) => url.searchParams.delete(key)); url.hostname = url.hostname.replace(/^www\./, '').toLowerCase(); url.pathname = url.pathname.replace(/\/$/, ''); return url.toString(); } catch { return ''; } }
export function domainFromResult(url = '') { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
export function bangUrl(domain, query) { return domain ? `https://duckduckgo.com/?q=${encodeURIComponent(`!site:${domain} ${query}`)}` : ''; }
export function randomDelay(minMs, maxMs, rng = Math.random) { return minMs + rng() * (maxMs - minMs); }

export function getResearchSourceBudget(poiCount = 20) {
  const count = Math.max(1, Math.min(250, Number(poiCount) || 20));
  return Math.min(DDGS_LIMITS.hardMax, Math.max(DDGS_LIMITS.preferredMin, Math.ceil(count * DDGS_SCHEDULING.sourceMultiplier)));
}
export function getResearchQueryBudget(poiCount = 20) {
  const count = Math.max(1, Math.min(250, Number(poiCount) || 20));
  return Math.min(90, Math.max(12, Math.ceil(count * DDGS_SCHEDULING.queryMultiplier)));
}
export function getResearchExtractionBudget(poiCount = 20, sourceBudget = getResearchSourceBudget(poiCount)) {
  return Math.min(DDGS_SCHEDULING.maxExtractedSources, Math.max(15, Math.ceil(sourceBudget * DDGS_SCHEDULING.extractionRatio)));
}

export function planResearchBudget({ poiCount = 20 } = {}) {
  // Research volume scales linearly with requested POIs, while request rate remains fixed by the serial scheduler.
  const targetUrls = getResearchSourceBudget(poiCount);
  const queryBudget = getResearchQueryBudget(poiCount);
  const extractMax = getResearchExtractionBudget(poiCount, targetUrls);
  return { preferredMin: Math.min(DDGS_LIMITS.preferredMin, targetUrls), preferredMax: Math.min(DDGS_LIMITS.preferredMax, targetUrls), softMax: Math.min(Math.max(targetUrls, DDGS_LIMITS.softMax), DDGS_LIMITS.hardMax), hardMax: targetUrls, targetUrls, queryBudget, extractMax, absoluteSafetyCeiling: DDGS_LIMITS.hardMax };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function browserHeaders(extra = {}) { return { 'User-Agent': DDGS_USER_AGENT, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://duckduckgo.com/', ...extra }; }
async function defaultDelay(ms) { await sleep(ms); }
async function fetchWithTimeout(url, options = {}, timeoutMs = 9000, fetchImpl = fetch) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } }
function bodyText(value = '') { return String(value || '').toLowerCase(); }

export function classifySearchFailure({ status = 0, body = '', error } = {}) {
  const text = bodyText(`${body} ${error?.message || error || ''}`);
  if ([202, 403, 429].includes(status) || /rate[ _-]?limit|too many requests|ratelimit|anomaly|challenge|blocked/.test(text)) return SEARCH_STATUS.RATE_LIMITED;
  if (/no results found|no result|no_results/.test(text)) return SEARCH_STATUS.TRUE_EMPTY_RESULT;
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
export function normalizeResearchQueryKey(query = '') { return normalizeDdgsQuery(query).toLowerCase().replace(/[^a-z0-9:]+/g, ' ').replace(/\s+/g, ' ').trim(); }
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

export function buildResearchQueries({ form = {}, sliders = {}, selectedTargets = [], targetingMode, poiTypes = [], poiCount = 20, queryBudget } = {}) {
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
  const limit = queryBudget || getResearchQueryBudget(poiCount);
  return [...new Map(queries.map((q) => [normalizeResearchQueryKey(q), q])).values()].filter((q) => q && q.length <= DDGS_SCHEDULING.queryMaxChars).slice(0, limit);
}

function expandResearchQueries({ form, selectedTargets = [], targetingMode, poiTypes = [], round = 0, poiCount = 20, queryBudget } = {}) {
  const sliders = { aggression: round >= 2 ? 65 : 35, controversy: round >= 4 ? 65 : 0, diplomacy: round % 2 ? 70 : 30 };
  const base = buildResearchQueries({ form, sliders, selectedTargets, targetingMode, poiTypes, poiCount, queryBudget });
  const extraAngles = ['evidence', 'historical context', 'commitment', 'statement', 'legal framework', 'implementation report'];
  const queries = [...base];
  for (const angle of extraAngles.slice(round % extraAngles.length, (round % extraAngles.length) + 3)) addQuery(queries, [form.agenda, form.portfolio, angle, `round ${round + 1}`]);
  return [...new Map(queries.map((q) => [normalizeResearchQueryKey(q), q])).values()].filter(Boolean).slice(0, queryBudget || getResearchQueryBudget(poiCount));
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
  const portfolio = String(form.portfolio || '').toLowerCase(); const manual = new Set((selectedTargets || []).map((t) => t.iso || t.name)); const mentions = new Map();
  const countryHints = [['RUS', 'Russia'], ['CHN', 'China'], ['USA', 'United States'], ['ISR', 'Israel'], ['IRN', 'Iran'], ['SAU', 'Saudi Arabia'], ['TUR', 'Türkiye'], ['IND', 'India'], ['PAK', 'Pakistan'], ['FRA', 'France'], ['GBR', 'United Kingdom'], ['DEU', 'Germany'], ['JPN', 'Japan'], ['BRA', 'Brazil'], ['ZAF', 'South Africa'], ['EGY', 'Egypt'], ['ETH', 'Ethiopia'], ['IDN', 'Indonesia'], ['UKR', 'Ukraine'], ['MEX', 'Mexico'], ['ARE', 'United Arab Emirates'], ['QAT', 'Qatar'], ['KWT', 'Kuwait'], ['BHR', 'Bahrain'], ['SGP', 'Singapore']];
  const context = [form.committee, form.agenda, form.researchNotes, form.backgroundGuideName, form.backgroundGuide?.text || form.backgroundGuideText, ...sources.map((s) => `${s.title} ${s.snippet} ${s.domain}`)].join(' ').toLowerCase();
  for (const [iso, name] of countryHints) { const key = name.toLowerCase(); if (manual.has(iso) || key === portfolio || iso.toLowerCase() === portfolio) continue; const count = (context.match(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length; if (count) mentions.set(iso, { iso, name, score: count, reason: `Mentioned in agenda/background/research context ${count} time(s) and not the portfolio country.` }); }
  return [...mentions.values()].sort((a, b) => b.score - a.score).slice(0, 8);
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
    if (result.status === SEARCH_STATUS.TRUE_EMPTY_RESULT || result.results.length || !isTransientSearchStatus(result.status) || attempt === DDGS_RETRY_DELAYS.length) break;
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

function sourceFromResult(result, query, backend, endpoint = '/search/text') {
  const url = canonicalUrl(result.href || result.url || result.link);
  const domain = domainFromResult(url);
  const publicationDate = result.date || result.published || '';
  return { sourceId: `ddgs:${backend}:${url}`, url, canonicalUrl: url, title: result.title || 'Untitled source', snippet: result.body || result.snippet || '', publicationDate, domain, query, ddgsQuery: query, backend, searchBackend: backend, searchEndpoint: endpoint, date: endpoint === '/search/news' ? result.date || '' : publicationDate, sourceType: endpoint === '/search/news' ? 'news' : 'text', source: endpoint === '/search/news' ? result.source || '' : undefined, image: endpoint === '/search/news' ? result.image || null : undefined, bangUrl: bangUrl(domain, query), discoveryStatus: EXTRACTION_STATUS.DISCOVERED, extractionStatus: EXTRACTION_STATUS.DISCOVERED, retrievalStatus: EXTRACTION_STATUS.DISCOVERED, retrievedAt: new Date().toISOString() };
}
function isAfterFreezeDate(dateValue, freezeDate) {
  if (!dateValue || !freezeDate) return false;
  const date = new Date(dateValue);
  const freeze = new Date(`${freezeDate}T23:59:59Z`);
  return Number.isFinite(date.getTime()) && Number.isFinite(freeze.getTime()) && date > freeze;
}
function retainResults({ results, search, endpoint, byUrl, contentSignatures, stats, freezeDate = '', sourceBudget = DDGS_LIMITS.hardMax }) {
  let added = 0;
  for (const result of results) {
    if (byUrl.size >= sourceBudget) break;
    const source = sourceFromResult(result, search.query, search.backend, endpoint);
    const signature = contentSignature(result);
    if (!source.url || /wikipedia\.org/i.test(source.url) || isAfterFreezeDate(source.publicationDate || source.date, freezeDate)) { stats.filteredUrls += 1; continue; }
    if (byUrl.has(source.url) || (signature && contentSignatures.has(signature))) { stats.deduplicatedUrls += 1; continue; }
    if (signature) contentSignatures.add(signature);
    byUrl.set(source.url, source); added += 1; stats.uniqueUrlsDiscovered = byUrl.size;
  }
  return added;
}
function batchSizeForUrlCount(count, targetUrls = DDGS_LIMITS.hardMax) { if (count >= targetUrls) return 0; if (count < 50) return 8; if (count < 150) return 6; if (count < 400) return 5; return 4; }
function shouldStopAfterBatch({ retained, targetUrls, batchYield, staleBatches, queryPoolExhausted, throttleExhausted }) {
  if (retained >= targetUrls || throttleExhausted) return true;
  if (retained < Math.min(DDGS_LIMITS.preferredMin, targetUrls)) return queryPoolExhausted && staleBatches >= 4;
  if (retained >= targetUrls && staleBatches >= 2) return true;
  if (retained >= Math.min(targetUrls, DDGS_LIMITS.preferredMax) && batchYield <= 1 && queryPoolExhausted) return true;
  if (retained >= Math.min(targetUrls, DDGS_LIMITS.softMax) && batchYield <= 2 && queryPoolExhausted) return true;
  return queryPoolExhausted && staleBatches >= 5;
}

function createResearchState(seed = {}) {
  const sources = Array.isArray(seed.sources) ? seed.sources : [];
  const state = {
    searchedQueries: new Set(seed.searchedQueries || []),
    searchedQueryKeys: new Set(seed.searchedQueryKeys || []),
    exhaustedQueries: new Set(seed.exhaustedQueries || []),
    newsQueryKeys: new Set(seed.newsQueryKeys || []),
    canonicalUrls: new Set(seed.canonicalUrls || sources.map((source) => source.url || source.canonicalUrl).filter(Boolean)),
    contentSignatures: new Set(seed.contentSignatures || []),
    sourcePool: new Map(),
    failedQueries: Array.isArray(seed.failedQueries) ? [...seed.failedQueries] : [],
    researchRounds: Number(seed.researchRounds || 0),
    newsDisabled: Boolean(seed.newsDisabled),
    newsDisableReason: seed.newsDisableReason || '',
    newsThrottleCount: Number(seed.newsThrottleCount || 0),
  };
  for (const source of sources) {
    const url = source.url || source.canonicalUrl;
    if (url) state.sourcePool.set(url, source);
    const signature = contentSignature({ title: source.title || source.sourceName, body: source.snippet || source.claimSupported || source.extractedText });
    if (signature) state.contentSignatures.add(signature);
  }
  return state;
}
function serializeResearchState(state) {
  return {
    searchedQueries: [...state.searchedQueries], searchedQueryKeys: [...state.searchedQueryKeys], exhaustedQueries: [...state.exhaustedQueries], newsQueryKeys: [...state.newsQueryKeys], canonicalUrls: [...state.canonicalUrls], contentSignatures: [...state.contentSignatures], failedQueries: state.failedQueries, researchRounds: state.researchRounds, sources: [...state.sourcePool.values()], newsDisabled: state.newsDisabled, newsDisableReason: state.newsDisableReason, newsThrottleCount: state.newsThrottleCount,
  };
}
function enqueueUnique(queryQueue, query, state, stats) {
  const normalized = normalizeDdgsQuery(query);
  const key = normalizeResearchQueryKey(normalized);
  if (!normalized || !key) return;
  if (state.searchedQueryKeys.has(key) || state.exhaustedQueries.has(key) || queryQueue.some((queued) => normalizeResearchQueryKey(queued) === key)) { stats.duplicateQueries += 1; return; }
  queryQueue.push(normalized);
}

export async function discoverResearch({ form, sliders = {}, selectedTargets, targetingMode, poiTypes, poiCount = 20, recoveryFocus = '', researchState, onProgress, fetchImpl = fetch, baseUrl = DDGS_BASE_URL, delayFn = defaultDelay, rng = Math.random, skipHealthCheck = false } = {}) {
  const health = skipHealthCheck ? { ok: true, status: 200, detail: 'DDGS health check skipped by test harness.' } : await checkDdgsHealth({ fetchImpl, baseUrl });
  const budget = planResearchBudget({ poiCount });
  const state = createResearchState(researchState);
  const initialQueries = buildResearchQueries({ form: { ...form, researchNotes: cleanJoin([form?.researchNotes, recoveryFocus]) }, sliders, selectedTargets, targetingMode, poiTypes, poiCount, queryBudget: budget.queryBudget });
  const queryQueue = [];
  const stats = { searchedQueries: 0, successfulQueries: 0, failedQueries: 0, emptyQueries: 0, throttledQueries: 0, duplicateQueries: 0, uniqueUrlsDiscovered: state.sourcePool.size, deduplicatedUrls: 0, filteredUrls: 0, textSearches: 0, newsSearches: 0, newsFailures: 0, extractionCompleted: 0, extractionFailed: 0, retryBackoffs: 0, throttleBackoffs: 0, newsDisabled: state.newsDisabled };
  for (const query of initialQueries) enqueueUnique(queryQueue, query, state, stats);
  if (!health.ok) return { schema: 'DDGS API /search/text + /search/news + /extract (OpenAPI 3.1.0)', health, queries: [...state.searchedQueries], plannedQueries: queryQueue, sources: [...state.sourcePool.values()], retrievedSources: [], bangUrls: [], automaticTargetCandidates: [], failures: [{ status: 'DDGS_API_UNAVAILABLE', detail: health.detail, category: 'ddgs-research-failure' }], researchState: serializeResearchState(state), stats: { ...stats, queryCount: state.searchedQueries.size, discoveredUrls: state.sourcePool.size, retainedUrls: state.sourcePool.size, retrievedSources: 0, hardMax: budget.hardMax, softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, targetUrls: budget.targetUrls, queryBudget: budget.queryBudget, extractMax: budget.extractMax, degraded: true } };

  const byUrl = state.sourcePool; const contentSignatures = state.contentSignatures; const failures = []; let expansionRound = state.researchRounds; let staleBatches = 0; let throttleFailures = 0; let throttleExhausted = false;

  while (byUrl.size < budget.targetUrls && state.searchedQueryKeys.size < budget.queryBudget) {
    const requestedBatchSize = Math.min(batchSizeForUrlCount(byUrl.size, budget.targetUrls) || 4, Math.max(1, budget.queryBudget - state.searchedQueryKeys.size));
    while (queryQueue.length < requestedBatchSize && expansionRound < 80 && state.searchedQueryKeys.size + queryQueue.length < budget.queryBudget) {
      for (const q of expandResearchQueries({ form: { ...form, researchNotes: cleanJoin([form?.researchNotes, recoveryFocus]) }, selectedTargets, targetingMode, poiTypes, round: expansionRound, poiCount, queryBudget: budget.queryBudget })) enqueueUnique(queryQueue, q, state, stats);
      expansionRound += 1; state.researchRounds = expansionRound;
    }
    const batch = [];
    while (batch.length < requestedBatchSize && queryQueue.length && state.searchedQueryKeys.size + batch.length < budget.queryBudget) {
      const query = queryQueue.shift();
      const key = normalizeResearchQueryKey(query);
      if (!query || state.searchedQueryKeys.has(key) || state.exhaustedQueries.has(key)) { stats.duplicateQueries += 1; continue; }
      batch.push({ query, key });
    }
    if (!batch.length) break;
    const beforeBatch = byUrl.size;
    for (const { query, key } of batch) {
      if (byUrl.size >= budget.targetUrls || throttleExhausted || state.searchedQueryKeys.size >= budget.queryBudget) break;
      state.searchedQueryKeys.add(key); state.searchedQueries.add(query);
      onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `${byUrl.size}/${budget.targetUrls} unique sources · ${state.searchedQueryKeys.size}/${budget.queryBudget} queries · ${stats.successfulQueries} successful · ${stats.emptyQueries} empty · ${stats.throttledQueries} throttled · Text ${stats.textSearches} · News ${stats.newsSearches} · Dedup ${stats.deduplicatedUrls}`, done: byUrl.size, total: budget.targetUrls });
      const textSearch = await searchWithBackendFallback(query, resultCountForQuery(query, sliders, '/search/text'), { fetchImpl, baseUrl, delayFn, rng, endpoint: '/search/text', onAttempt: (attempt) => { if (attempt.attempt > 1) stats.retryBackoffs += 1; if (attempt.status !== SEARCH_STATUS.SUCCESS) { const failure = { ...attempt, queryKey: key, recoverable: isTransientSearchStatus(attempt.status), retry: isTransientSearchStatus(attempt.status) && attempt.status !== SEARCH_STATUS.TRUE_EMPTY_RESULT, category: 'ddgs-research-failure' }; failures.push(failure); state.failedQueries.push(failure); } } });
      stats.searchedQueries += 1; stats.textSearches += 1;
      if (textSearch.results.length) stats.successfulQueries += 1; else { stats.failedQueries += 1; if (textSearch.status === SEARCH_STATUS.TRUE_EMPTY_RESULT) { stats.emptyQueries += 1; state.exhaustedQueries.add(key); } }
      retainResults({ results: textSearch.results, search: textSearch, endpoint: '/search/text', byUrl, contentSignatures, stats, freezeDate: form?.freezeDate, sourceBudget: budget.targetUrls });
      if (isThrottleStatus(textSearch.status)) { throttleFailures += 1; stats.throttleBackoffs += 1; stats.throttledQueries += 1; } else if (textSearch.results.length) throttleFailures = 0;
      if (throttleFailures >= 3) { throttleExhausted = true; break; }
      if (byUrl.size >= budget.targetUrls) break;
      if (!state.newsDisabled && shouldSearchNews(query, { sliders })) {
        const newsKey = `news:${key}`;
        if (!state.newsQueryKeys.has(newsKey)) {
          state.newsQueryKeys.add(newsKey);
          const newsSearch = await searchWithBackendFallback(query, resultCountForQuery(query, sliders, '/search/news'), { fetchImpl, baseUrl, delayFn, rng, endpoint: '/search/news', onAttempt: (attempt) => { if (attempt.attempt > 1) stats.retryBackoffs += 1; if (attempt.status !== SEARCH_STATUS.SUCCESS) { const failure = { ...attempt, queryKey: newsKey, recoverable: isTransientSearchStatus(attempt.status), retry: isTransientSearchStatus(attempt.status) && attempt.status !== SEARCH_STATUS.TRUE_EMPTY_RESULT, category: 'ddgs-news-failure' }; failures.push(failure); state.failedQueries.push(failure); } } });
          stats.searchedQueries += 1; stats.newsSearches += 1;
          if (newsSearch.results.length) { stats.successfulQueries += 1; state.newsThrottleCount = 0; } else { stats.failedQueries += 1; stats.newsFailures += 1; if (newsSearch.status === SEARCH_STATUS.TRUE_EMPTY_RESULT) stats.emptyQueries += 1; }
          retainResults({ results: newsSearch.results, search: newsSearch, endpoint: '/search/news', byUrl, contentSignatures, stats, freezeDate: form?.freezeDate, sourceBudget: budget.targetUrls });
          if (isThrottleStatus(newsSearch.status)) { const throttledAttempts = Math.max(1, newsSearch.attempts.filter((attempt) => isThrottleStatus(attempt.status)).length); state.newsThrottleCount += throttledAttempts; stats.throttledQueries += 1; stats.throttleBackoffs += 1; }
          if (state.newsThrottleCount >= DDGS_SCHEDULING.newsThrottleLimit) { state.newsDisabled = true; state.newsDisableReason = `News disabled after ${state.newsThrottleCount} throttled responses.`; stats.newsDisabled = true; failures.push({ endpoint: '/search/news', status: SEARCH_STATUS.RATE_LIMITED, category: 'ddgs-news-circuit-breaker', detail: state.newsDisableReason }); }
        }
      }
    }
    const batchYield = byUrl.size - beforeBatch;
    staleBatches = batchYield <= (byUrl.size < budget.preferredMin ? 2 : 4) ? staleBatches + 1 : 0;
    const queryPoolExhausted = !queryQueue.length && (expansionRound >= 80 || state.searchedQueryKeys.size >= budget.queryBudget);
    if (shouldStopAfterBatch({ retained: byUrl.size, targetUrls: budget.targetUrls, batchYield, staleBatches, queryPoolExhausted, throttleExhausted })) break;
  }

  const sources = [...byUrl.values()].slice(0, budget.targetUrls);
  const retrieved = [];
  const alreadyRetrieved = new Set((researchState?.retrievedSources || []).map((source) => source.url).filter(Boolean));
  for (const source of sources.filter((source) => !alreadyRetrieved.has(source.url)).slice(0, Math.min(budget.extractMax, sources.length))) {
    const extracted = await extractSource(source, { fetchImpl, baseUrl });
    retrieved.push(extracted);
    if (extracted.extractionStatus === EXTRACTION_STATUS.RETRIEVED) stats.extractionCompleted += 1; else stats.extractionFailed += 1;
    await delayFn(randomDelay(DDGS_SEARCH_DELAY.extractMinMs, DDGS_SEARCH_DELAY.extractMaxMs, rng), { kind: 'extract-pace', url: source.url });
  }
  const priorRetrieved = Array.isArray(researchState?.retrievedSources) ? researchState.retrievedSources : [];
  const retrievedByUrl = new Map([...priorRetrieved, ...retrieved].map((source) => [source.url, source]));
  const merged = sources.map((source) => retrievedByUrl.get(source.url) || source);
  const automaticTargetCandidates = deriveAutomaticTargetCandidates({ form, sources: merged, selectedTargets });
  const searchedQueries = [...state.searchedQueries];
  const serializedState = serializeResearchState({ ...state, sourcePool: new Map(merged.map((source) => [source.url, source])) });
  return { schema: 'DDGS API /search/text + /search/news + /extract (OpenAPI 3.1.0)', health, queries: searchedQueries, plannedQueries: [...new Set([...searchedQueries, ...queryQueue])], sources: merged, retrievedSources: [...priorRetrieved, ...retrieved].slice(0, budget.extractMax), bangUrls: merged.map((source) => source.bangUrl).filter(Boolean), automaticTargetCandidates, failures, researchState: { ...serializedState, retrievedSources: [...priorRetrieved, ...retrieved].slice(0, budget.extractMax) }, stats: { ...stats, queryCount: searchedQueries.length, usedQueryBudget: state.searchedQueryKeys.size, queryBudget: budget.queryBudget, discoveredUrls: byUrl.size, retainedUrls: merged.length, retrievedSources: [...priorRetrieved, ...retrieved].filter((source) => source.extractedText).length, bangUrls: merged.filter((source) => source.bangUrl).length, hardMax: budget.hardMax, softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, targetUrls: budget.targetUrls, extractMax: budget.extractMax, degraded: throttleExhausted || merged.length < budget.preferredMin, throttleExhausted, newsDisabled: state.newsDisabled, newsDisableReason: state.newsDisableReason, uniqueUrlsDiscovered: byUrl.size } };
}
