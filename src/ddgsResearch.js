const DDGS_BASE_URL = 'http://127.0.0.1:4479';
const DDGS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DDGS_SEARCH_DELAY = { textMinMs: 2200, textMaxMs: 3800, newsMinMs: 2500, newsMaxMs: 4500, extractMinMs: 1500, extractMaxMs: 2500 };
const DDGS_RETRY_DELAYS = [8000, 16000, 32000, 64000];
const DDGS_BATCH_SIZES = [10, 10, 8, 8, 6, 6, 5, 5, 4, 4];

export const DDGS_LIMITS = { preferredMin: 60, preferredMax: 120, softMax: 140, hardMax: 160 };
export const DDGS_NEWS_BACKEND = 'duckduckgo';
export const DDGS_TEXT_BACKEND = 'duckduckgo';
export const DDGS_BACKENDS = [DDGS_TEXT_BACKEND];
export const DDGS_SCHEDULING = { searchDelay: DDGS_SEARCH_DELAY, retryDelays: DDGS_RETRY_DELAYS, maxSearchRetries: DDGS_RETRY_DELAYS.length, maxExtractedSources: 25, searchConcurrency: 1, extractConcurrency: 1, queryMaxChars: 180, userAgent: DDGS_USER_AGENT };
export const SEARCH_STATUS = { SUCCESS: 'SUCCESS', TRUE_EMPTY_RESULT: 'TRUE_EMPTY_RESULT', NO_RESULTS_FOR_QUERY: 'TRUE_EMPTY_RESULT', RATE_LIMITED: 'RATE_LIMITED', TIMEOUT: 'TIMEOUT', CONNECTION_ERROR: 'CONNECTION_ERROR', DDGS_UPSTREAM_ERROR: 'DDGS_UPSTREAM_FAILURE', SEARCH_FAILED: 'SEARCH_FAILED' };
export const EXTRACTION_STATUS = { DISCOVERED: 'DISCOVERED_FROM_SEARCH', RETRIEVED: 'RETRIEVED', DISCOVERED_NOT_RETRIEVED: 'DISCOVERED_NOT_RETRIEVED', DISCOVERED_DIRECT_EXTRACTION_BLOCKED: 'DISCOVERED_DIRECT_EXTRACTION_BLOCKED', RATE_LIMITED: 'RATE_LIMITED', DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR: 'DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR', DISCOVERED_NOT_RETRIEVED_TIMEOUT: 'DISCOVERED_NOT_RETRIEVED_TIMEOUT', DISCOVERED_NOT_RETRIEVED_NETWORK: 'DISCOVERED_NOT_RETRIEVED_NETWORK' };

export function canonicalUrl(raw = '') { try { const url = new URL(raw); url.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) => url.searchParams.delete(key)); url.hostname = url.hostname.replace(/^www\./, '').toLowerCase(); url.pathname = url.pathname.replace(/\/$/, ''); return url.toString(); } catch { return ''; } }
export function domainFromResult(url = '') { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
export function bangUrl(domain, query) { return domain ? `https://duckduckgo.com/?q=${encodeURIComponent(`!site:${domain} ${query}`)}` : ''; }
export function randomDelay(minMs, maxMs, rng = Math.random) { return minMs + rng() * (maxMs - minMs); }

export function planResearchBudget({ poiCount = 20 } = {}) {
  const count = Math.max(1, Math.min(250, Number(poiCount) || 20));
  const targetUrls = count <= 50 ? 60 : count <= 100 ? 80 : count <= 150 ? 100 : count <= 200 ? 130 : 150;
  return { preferredMin: DDGS_LIMITS.preferredMin, preferredMax: DDGS_LIMITS.preferredMax, softMax: DDGS_LIMITS.softMax, hardMax: DDGS_LIMITS.hardMax, targetUrls: Math.min(DDGS_LIMITS.hardMax, targetUrls), extractMax: DDGS_SCHEDULING.maxExtractedSources, absoluteSafetyCeiling: DDGS_LIMITS.hardMax };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function browserHeaders(extra = {}) { return { 'User-Agent': DDGS_USER_AGENT, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://duckduckgo.com/', ...extra }; }
async function defaultDelay(ms) { await sleep(ms); }
async function fetchWithTimeout(url, options = {}, timeoutMs = 9000, fetchImpl = fetch) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); } }
function bodyText(value = '') { return String(value || '').toLowerCase(); }

export function classifySearchFailure({ status = 0, body = '', error } = {}) {
  const text = bodyText(`${body} ${error?.message || error || ''}`);
  if ([202, 403, 429].includes(status) || /rate.?limit|too many requests|ratelimit|anomaly|challenge/.test(text)) return SEARCH_STATUS.RATE_LIMITED;
  if ([500, 502, 503, 504].includes(status)) return SEARCH_STATUS.DDGS_UPSTREAM_ERROR;
  if (/no results found|no result|no_results/.test(text)) return SEARCH_STATUS.TRUE_EMPTY_RESULT;
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
  query = query.replace(/[{}[\]"`]|https?:\/\/\S+/g, ' ');
  query = query.replace(/[_:|>]+/g, ' ');
  query = query.replace(QUERY_DROP_WORDS, ' ');
  const words = query.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const deduped = [];
  const seen = new Set();
  for (const word of words) { const key = word.toLowerCase(); if (seen.has(key) && word.length > 3) continue; seen.add(key); deduped.push(word); }
  let clean = deduped.join(' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= DDGS_SCHEDULING.queryMaxChars) return clean;
  const priority = clean.split(' ').filter((word) => /[A-Z][a-z]|^[A-Z]{2,}$|\d{4}|debt|climate|finance|treaty|vote|resolution|policy|IMF|UN|World|Bank|Paris|Club|Common|Framework|sovereign|development/i.test(word));
  clean = (priority.length >= 4 ? priority : clean.split(' ')).join(' ');
  while (clean.length > DDGS_SCHEDULING.queryMaxChars && clean.includes(' ')) clean = clean.replace(/\s+\S+$/, '');
  return clean.trim();
}

function contentSignature(result = {}) { return `${result.title || ''} ${result.body || result.snippet || ''}`.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length > 4).slice(0, 18).join(' '); }
function cleanJoin(parts) { return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }
function targetNames(selectedTargets = []) { return selectedTargets.map((t) => t.name).filter(Boolean); }

export function buildResearchQueries({ form, sliders = {}, selectedTargets = [], targetingMode, poiTypes = [] }) {
  const base = cleanJoin([form.committee, form.agenda, form.portfolio, form.researchNotes]);
  const freeze = form.freezeDate ? `before ${form.freezeDate}` : '';
  const targets = targetNames(selectedTargets);
  const targetGroup = targets.length ? targets.join(' OR ') : 'countries';
  const queryParts = [
    [base, freeze, 'official foreign policy doctrine strategic priorities'],
    [base, freeze, 'UN resolution voting record'],
    [base, freeze, 'treaty commitments legal obligations'],
    [base, targetGroup, freeze, 'government statements policy contradiction'],
    [base, targetGroup, freeze, 'international organization report legal framework'],
    [base, targetGroup, freeze, 'implementation failure accountability'],
    [base, targetGroup, freeze, 'controversy contradiction investigation'],
    [base, targetGroup, freeze, 'financial pressure development finance'],
    [base, targetGroup, freeze, 'sovereign debt restructuring IMF World Bank'],
    [form.portfolio, 'foreign policy', form.agenda, freeze],
    [form.portfolio, 'central bank finance ministry', form.agenda, freeze],
    [targetGroup, 'foreign policy', form.agenda, freeze],
    [targetGroup, 'minister statement', form.agenda, freeze],
    [targetGroup, 'historical precedent legal obligation', form.agenda, freeze],
  ];
  if (sliders.controversy >= 70) queryParts.push([base, targetGroup, freeze, 'scandal investigation malpractice accountability'], [base, targetGroup, freeze, 'voting contradiction treaty commitment']);
  if (sliders.aggression >= 70) queryParts.push([base, targetGroup, freeze, 'legal pressure accountability evidence'], [base, targetGroup, freeze, 'contradiction failure direct question']);
  for (const type of (poiTypes || []).filter((t) => t && t !== 'AUTO').slice(0, 8)) queryParts.push([base, targetGroup, type, freeze]);
  for (const target of targets.slice(0, 30)) queryParts.push([form.committee, form.agenda, form.portfolio, target, freeze, 'official statement policy'], [form.agenda, target, freeze, 'UN vote treaty implementation controversy'], [form.portfolio, target, form.agenda, freeze, 'financial development diplomatic position']);
  if (form.backgroundGuideName) queryParts.push([base, form.backgroundGuideName, 'background guide', freeze]);
  if (targetingMode !== 'selected_only') queryParts.push([base, 'automatic target countries relevant controversy', freeze], [base, 'countries most affected policy dispute', freeze]);
  return [...new Set(queryParts.map((parts) => normalizeDdgsQuery(cleanJoin(parts))).filter(Boolean))];
}

function expandResearchQueries({ form, selectedTargets = [], targetingMode, poiTypes = [], round = 0 }) {
  const base = cleanJoin([form.committee, form.agenda, form.portfolio, form.researchNotes]);
  const freeze = form.freezeDate ? `before ${form.freezeDate}` : '';
  const targets = targetNames(selectedTargets);
  const selectedOrGlobal = targets.length ? targets : ['countries'];
  const institutions = ['UN resolution', 'voting record', 'treaty', 'government policy', 'foreign ministry statement', 'finance ministry', 'central bank', 'IMF report', 'World Bank report', 'OECD policy', 'development finance', 'sovereign debt restructuring', 'Paris Club', 'G20 Common Framework', 'legal obligation', 'implementation failure', 'accountability', 'controversy', 'contradiction', 'historical precedent'];
  const queries = [];
  const offset = round * 5;
  for (let i = 0; i < Math.min(10, institutions.length); i += 1) {
    const angle = institutions[(offset + i) % institutions.length];
    const target = selectedOrGlobal[(round + i) % selectedOrGlobal.length];
    queries.push(cleanJoin([base, target, angle, `research angle ${round + 1}`, freeze]));
  }
  for (const type of (poiTypes || []).filter((t) => t && t !== 'AUTO').slice(round, round + 3)) queries.push(cleanJoin([base, selectedOrGlobal[round % selectedOrGlobal.length], type, 'evidence', freeze]));
  if (targetingMode !== 'selected_only') queries.push(cleanJoin([form.agenda, form.portfolio, 'emerging current controversy target countries', `research angle ${round + 1}`, freeze]));
  return queries.map(normalizeDdgsQuery).filter(Boolean);
}

function shouldSearchNews(query, { form = {}, sliders = {} } = {}) {
  const hay = `${query} ${form.agenda || ''} ${form.researchNotes || ''}`.toLowerCase();
  return (sliders.controversy >= 70 && /scandal|investigation|controversy|accountability|failure|malpractice/.test(hay)) || /current|recent|latest|today|news|crisis|war|sanction|election|attack|conflict|ceasefire|vote|announcement|restructuring|statement|reporting/.test(hay);
}
function resultCountForQuery(query, sliders = {}, endpoint = '/search/text') {
  if (endpoint === '/search/news') return sliders.controversy >= 70 ? 8 : 6;
  return /official|UN|resolution|treaty|IMF|World Bank|sovereign|legal|report/i.test(query) ? 12 : 10;
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
  const backend = DDGS_TEXT_BACKEND;
  const normalized = normalizeDdgsQuery(query);
  let lastResult = null;
  for (let attempt = 0; attempt <= DDGS_RETRY_DELAYS.length; attempt += 1) {
    const result = endpoint === '/search/news' ? await searchNewsOnce(normalized, maxResults, backend, { fetchImpl, baseUrl }) : await searchTextOnce(normalized, maxResults, backend, { fetchImpl, baseUrl });
    lastResult = result;
    const attemptRecord = { query: normalized, backend, status: result.status, httpStatus: result.httpStatus, endpoint, attempt: attempt + 1 };
    attempts.push(attemptRecord); onAttempt?.(attemptRecord);
    if (result.results.length || !isTransientSearchStatus(result.status) || attempt === DDGS_RETRY_DELAYS.length) break;
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
  return { sourceId: `ddgs:${backend}:${url}`, url, canonicalUrl: url, title: result.title || 'Untitled source', snippet: result.body || result.snippet || '', publicationDate, domain, query, ddgsQuery: query, backend, searchBackend: backend, searchEndpoint: endpoint, date: endpoint === '/search/news' ? result.date || '' : publicationDate, source: endpoint === '/search/news' ? result.source || '' : undefined, image: endpoint === '/search/news' ? result.image || null : undefined, bangUrl: bangUrl(domain, query), discoveryStatus: EXTRACTION_STATUS.DISCOVERED, extractionStatus: EXTRACTION_STATUS.DISCOVERED, retrievalStatus: EXTRACTION_STATUS.DISCOVERED, retrievedAt: new Date().toISOString() };
}
function retainResults({ results, search, endpoint, byUrl, contentSignatures, stats }) {
  let added = 0;
  for (const result of results) {
    if (byUrl.size >= DDGS_LIMITS.hardMax) break;
    const source = sourceFromResult(result, search.query, search.backend, endpoint);
    const signature = contentSignature(result);
    if (!source.url || /wikipedia\.org/i.test(source.url)) { stats.filteredUrls += 1; continue; }
    if (byUrl.has(source.url) || (signature && contentSignatures.has(signature))) { stats.deduplicatedUrls += 1; continue; }
    if (signature) contentSignatures.add(signature);
    byUrl.set(source.url, source); added += 1; stats.uniqueUrlsDiscovered = byUrl.size;
  }
  return added;
}
function batchSizeForUrlCount(count) { if (count < 60) return 10; if (count < 100) return 8; if (count < 130) return 6; if (count < 160) return 4; return 0; }
function shouldStopAfterBatch({ retained, targetUrls, batchYield, staleBatches, queryPoolExhausted, throttleExhausted }) {
  if (retained >= DDGS_LIMITS.hardMax || throttleExhausted) return true;
  if (retained < Math.min(DDGS_LIMITS.preferredMin, targetUrls)) return queryPoolExhausted && staleBatches >= 4;
  if (retained >= targetUrls && staleBatches >= 2) return true;
  if (retained >= DDGS_LIMITS.preferredMax && batchYield <= 2) return true;
  if (retained >= DDGS_LIMITS.softMax && batchYield <= 4) return true;
  return queryPoolExhausted && staleBatches >= 5;
}

export async function discoverResearch({ form, sliders = {}, selectedTargets, targetingMode, poiTypes, poiCount = 20, recoveryFocus = '', onProgress, fetchImpl = fetch, baseUrl = DDGS_BASE_URL, delayFn = defaultDelay, rng = Math.random, skipHealthCheck = false } = {}) {
  const health = skipHealthCheck ? { ok: true, status: 200, detail: 'DDGS health check skipped by test harness.' } : await checkDdgsHealth({ fetchImpl, baseUrl });
  const budget = planResearchBudget({ poiCount });
  const initialQueries = buildResearchQueries({ form, sliders, selectedTargets, targetingMode, poiTypes });
  if (!health.ok) return { schema: 'DDGS API /search/text + /search/news + /extract (OpenAPI 3.1.0)', health, queries: initialQueries, sources: [], retrievedSources: [], bangUrls: [], automaticTargetCandidates: [], failures: [{ status: 'DDGS_API_UNAVAILABLE', detail: health.detail, category: 'ddgs-research-failure' }], stats: { searchedQueries: 0, successfulQueries: 0, failedQueries: 0, duplicateQueries: 0, uniqueUrlsDiscovered: 0, queryCount: initialQueries.length, discoveredUrls: 0, retainedUrls: 0, deduplicatedUrls: 0, textSearches: 0, newsSearches: 0, retrievedSources: 0, extractionFailed: 0, hardMax: budget.hardMax, softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, targetUrls: budget.targetUrls, degraded: true } };

  const byUrl = new Map(); const contentSignatures = new Set(); const failures = []; const searched = new Set(); const queryQueue = [...initialQueries];
  const stats = { searchedQueries: 0, successfulQueries: 0, failedQueries: 0, duplicateQueries: 0, uniqueUrlsDiscovered: 0, deduplicatedUrls: 0, filteredUrls: 0, textSearches: 0, newsSearches: 0, extractionCompleted: 0, extractionFailed: 0, retryBackoffs: 0, throttleBackoffs: 0 };
  let expansionRound = 0; let staleBatches = 0; let throttleFailures = 0; let throttleExhausted = false;

  while (byUrl.size < DDGS_LIMITS.hardMax) {
    const requestedBatchSize = batchSizeForUrlCount(byUrl.size) || DDGS_BATCH_SIZES[Math.min(expansionRound, DDGS_BATCH_SIZES.length - 1)] || 4;
    while (queryQueue.filter((q) => !searched.has(q)).length < requestedBatchSize && expansionRound < 40) {
      for (const q of expandResearchQueries({ form: { ...form, researchNotes: cleanJoin([form.researchNotes, recoveryFocus]) }, selectedTargets, targetingMode, poiTypes, round: expansionRound })) {
        if (!queryQueue.includes(q)) queryQueue.push(q); else stats.duplicateQueries += 1;
      }
      expansionRound += 1;
    }
    const batch = [];
    while (batch.length < requestedBatchSize && queryQueue.length) {
      const query = queryQueue.shift();
      if (!query || searched.has(query)) { stats.duplicateQueries += 1; continue; }
      searched.add(query); batch.push(query);
    }
    if (!batch.length) break;
    const beforeBatch = byUrl.size;
    for (const query of batch) {
      if (byUrl.size >= DDGS_LIMITS.hardMax || throttleExhausted) break;
      onProgress?.({ stage: 'RESEARCHING EVIDENCE', detail: `${byUrl.size}/${DDGS_LIMITS.hardMax} unique sources · ${stats.searchedQueries} queries · ${stats.successfulQueries} successful · ${stats.failedQueries} failed · Text ${stats.textSearches} · News ${stats.newsSearches} · Dedup ${stats.deduplicatedUrls}`, done: byUrl.size, total: DDGS_LIMITS.hardMax });
      const textSearch = await searchWithBackendFallback(query, resultCountForQuery(query, sliders, '/search/text'), { fetchImpl, baseUrl, delayFn, rng, endpoint: '/search/text', onAttempt: (attempt) => { if (attempt.attempt > 1) stats.retryBackoffs += 1; if (attempt.status !== SEARCH_STATUS.SUCCESS) failures.push({ ...attempt, recoverable: isTransientSearchStatus(attempt.status), category: 'ddgs-research-failure' }); } });
      stats.searchedQueries += 1; stats.textSearches += 1;
      if (textSearch.results.length) stats.successfulQueries += 1; else stats.failedQueries += 1;
      retainResults({ results: textSearch.results, search: textSearch, endpoint: '/search/text', byUrl, contentSignatures, stats });
      if (isThrottleStatus(textSearch.status)) { throttleFailures += 1; stats.throttleBackoffs += 1; } else if (textSearch.results.length) throttleFailures = 0;
      if (throttleFailures >= 3) { throttleExhausted = true; break; }
      if (byUrl.size >= DDGS_LIMITS.hardMax) break;
      if (shouldSearchNews(query, { form, sliders })) {
        const newsSearch = await searchWithBackendFallback(query, resultCountForQuery(query, sliders, '/search/news'), { fetchImpl, baseUrl, delayFn, rng, endpoint: '/search/news', onAttempt: (attempt) => { if (attempt.attempt > 1) stats.retryBackoffs += 1; if (attempt.status !== SEARCH_STATUS.SUCCESS) failures.push({ ...attempt, recoverable: isTransientSearchStatus(attempt.status), category: 'ddgs-research-failure' }); } });
        stats.searchedQueries += 1; stats.newsSearches += 1;
        if (newsSearch.results.length) stats.successfulQueries += 1; else stats.failedQueries += 1;
        retainResults({ results: newsSearch.results, search: newsSearch, endpoint: '/search/news', byUrl, contentSignatures, stats });
        if (isThrottleStatus(newsSearch.status)) { throttleFailures += 1; stats.throttleBackoffs += 1; } else if (newsSearch.results.length) throttleFailures = 0;
        if (throttleFailures >= 3) { throttleExhausted = true; break; }
      }
    }
    const batchYield = byUrl.size - beforeBatch;
    staleBatches = batchYield <= (byUrl.size < DDGS_LIMITS.preferredMin ? 2 : 4) ? staleBatches + 1 : 0;
    const queryPoolExhausted = !queryQueue.some((q) => !searched.has(q)) && expansionRound >= 40;
    if (shouldStopAfterBatch({ retained: byUrl.size, targetUrls: budget.targetUrls, batchYield, staleBatches, queryPoolExhausted, throttleExhausted })) break;
  }

  const sources = [...byUrl.values()].slice(0, DDGS_LIMITS.hardMax);
  const retrieved = [];
  for (const source of sources.slice(0, Math.min(budget.extractMax, sources.length))) {
    const extracted = await extractSource(source, { fetchImpl, baseUrl });
    retrieved.push(extracted);
    if (extracted.extractionStatus === EXTRACTION_STATUS.RETRIEVED) stats.extractionCompleted += 1; else stats.extractionFailed += 1;
    await delayFn(randomDelay(DDGS_SEARCH_DELAY.extractMinMs, DDGS_SEARCH_DELAY.extractMaxMs, rng), { kind: 'extract-pace', url: source.url });
  }
  const retrievedByUrl = new Map(retrieved.map((source) => [source.url, source]));
  const merged = sources.map((source) => retrievedByUrl.get(source.url) || source);
  const automaticTargetCandidates = deriveAutomaticTargetCandidates({ form, sources: merged, selectedTargets });
  const searchedQueries = [...searched];
  return { schema: 'DDGS API /search/text + /search/news + /extract (OpenAPI 3.1.0)', health, queries: searchedQueries, plannedQueries: [...new Set([...searchedQueries, ...queryQueue])], sources: merged, retrievedSources: retrieved, bangUrls: merged.map((s) => s.bangUrl).filter(Boolean), automaticTargetCandidates, failures, stats: { ...stats, queryCount: searchedQueries.length, discoveredUrls: byUrl.size, retainedUrls: merged.length, retrievedSources: retrieved.filter((s) => s.extractedText).length, bangUrls: merged.filter((s) => s.bangUrl).length, hardMax: budget.hardMax, softMax: budget.softMax, preferredRange: `${budget.preferredMin}-${budget.preferredMax}`, targetUrls: budget.targetUrls, degraded: throttleExhausted || merged.length < DDGS_LIMITS.preferredMin, throttleExhausted, uniqueUrlsDiscovered: byUrl.size } };
}
