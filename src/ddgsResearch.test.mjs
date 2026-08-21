import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bangUrl, buildResearchQueries, classifyExtractionFailure, classifySearchFailure, DDGS_LIMITS, DDGS_SCHEDULING, DDGS_TEXT_BACKEND, discoverResearch, EXTRACTION_STATUS, SEARCH_STATUS, normalizeDdgsQuery, searchWithBackendFallback, extractSource } from './ddgsResearch.js';
import { normalizeEvidenceSource, validateSources } from './sourceValidation.js';

assert.equal(classifySearchFailure({ status: 500, body: 'No results found' }), SEARCH_STATUS.DDGS_UPSTREAM_ERROR);
assert.equal(classifySearchFailure({ status: 503, body: 'upstream unavailable' }), SEARCH_STATUS.DDGS_UPSTREAM_ERROR);
assert.equal(classifySearchFailure({ status: 202, body: 'challenge' }), SEARCH_STATUS.RATE_LIMITED);
assert.equal(classifySearchFailure({ status: 500, body: 'rate limit exceeded' }), SEARCH_STATUS.RATE_LIMITED);
assert.equal(classifySearchFailure({ error: Object.assign(new Error('socket timeout'), { name: 'AbortError' }) }), SEARCH_STATUS.TIMEOUT);
assert.equal(classifySearchFailure({ error: new Error('getaddrinfo ENOTFOUND') }), SEARCH_STATUS.CONNECTION_ERROR);
assert.equal(classifyExtractionFailure({ status: 401 }), EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(classifyExtractionFailure({ status: 403 }), EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(classifyExtractionFailure({ status: 404 }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED);
assert.equal(classifyExtractionFailure({ status: 429 }), EXTRACTION_STATUS.RATE_LIMITED);
assert.equal(classifyExtractionFailure({ status: 503 }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR);
assert.equal(classifyExtractionFailure({ error: Object.assign(new Error('timeout'), { name: 'AbortError' }) }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT);
assert.equal(classifyExtractionFailure({ error: new Error('TLS DNS failure') }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_NETWORK);
assert.match(bangUrl('imf.org', 'debt restructuring'), /duckduckgo\.com/);

const normalized = normalizeEvidenceSource({ sourceName: 'IMF report', url: 'https://www.imf.org/report', ddgsQuery: 'IMF debt report', extractionStatus: EXTRACTION_STATUS.RETRIEVED });
assert.equal(normalized.url, 'https://www.imf.org/report');
assert.match(normalized.bangUrl, /duckduckgo\.com/);
assert.match(normalized.bangUrl, /IMF%20debt%20report/);
assert.notEqual(normalized.url, normalized.bangUrl);

const failedWithBang = normalizeEvidenceSource({ url: 'https://example.invalid/article', ddgsQuery: 'blocked report', extractionStatus: EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED });
assert.equal(failedWithBang.extractionStatus, EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED);
assert.match(failedWithBang.bangUrl, /duckduckgo\.com/);

const timedOut = normalizeEvidenceSource({ url: 'https://reports.example/slow', ddgsQuery: 'slow report', extractionStatus: EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT });
const [timedOutValidated] = await validateSources([timedOut]);
assert.equal(timedOutValidated.extractionStatus, EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT);
assert.match(timedOutValidated.bangUrl, /duckduckgo\.com/);

const mainSource = fs.readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
assert(mainSource.includes('ACTUAL SOURCE URL'), 'GUI labels the primary URL');
assert(mainSource.includes('SECONDARY/FALLBACK SEARCH'), 'GUI labels the Bang fallback URL');
assert(!mainSource.includes('Manual Verification'), 'GUI does not show Manual Verification as a titled label');
const exportSource = fs.readFileSync(new URL('./export.js', import.meta.url), 'utf8');
assert(exportSource.includes('Actual Source URL'), 'DOCX includes primary URL label');
assert(exportSource.includes('Secondary/Fallback Search URL'), 'DOCX includes fallback URL label');
assert(exportSource.includes('DDGS Query'), 'DOCX includes DDGS query');
assert(exportSource.includes('Retrieval Status'), 'DOCX includes retrieval status');
assert(!exportSource.includes('Manual Verification'), 'DOCX does not show Manual Verification as a titled label');

assert.equal(DDGS_TEXT_BACKEND, 'duckduckgo');
assert.deepEqual(DDGS_LIMITS, { preferredMin: 60, preferredMax: 120, softMax: 140, hardMax: 160 });
assert.equal(DDGS_SCHEDULING.searchConcurrency, 1);
assert.equal(DDGS_SCHEDULING.extractConcurrency, 1);
assert.equal(DDGS_SCHEDULING.searchDelay.textMinMs, 2200);
assert.equal(DDGS_SCHEDULING.searchDelay.newsMaxMs, 4500);
assert.equal(DDGS_SCHEDULING.retryDelays.length, 4);
assert.equal(DDGS_SCHEDULING.userAgent.includes('Chrome/140.0.0.0'), true);
assert.equal(normalizeDdgsQuery('ECOFIN Sovereign debt restructuring India RECOVERY LEVEL 3: generate new defensible POIs without reusing rejected angles. Previous Gemini batch under-produced. Return STRICT JSON'), 'ECOFIN Sovereign debt restructuring India');
assert.equal(normalizeDdgsQuery('India India sovereign debt debt G20 Common Framework'), 'India sovereign debt G20 Common Framework');

const form = { committee: 'ECOFIN', agenda: 'Sovereign debt restructuring and development finance', portfolio: 'Indonesia', researchNotes: 'Focus on voting contradictions and treaty obligations.', freezeDate: '2026-01-01', backgroundGuideName: 'bg-debt.pdf' };
const sliders = { aggression: 80, controversy: 85, diplomacy: 50, length: 50 };
const queryPlan = buildResearchQueries({ form, sliders, selectedTargets: [{ iso: 'IND', name: 'India' }, { iso: 'CHN', name: 'China' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP', 'VOTING CONTRADICTION'] });
assert(queryPlan.length > 14, 'query planning is no longer capped at 14');
assert.equal(queryPlan.length, new Set(queryPlan).size, 'normalized queries are deduplicated');
assert(queryPlan.some((q) => /UN resolution/i.test(q)), 'UN resolution query family exists');
assert(queryPlan.some((q) => /treaty/i.test(q)), 'treaty query family exists');
assert(queryPlan.some((q) => /development finance/i.test(q)), 'development finance query family exists');
assert(!queryPlan.some((q) => /Return STRICT JSON|Gemini|schema|generate new defensible/i.test(q)), 'Gemini/recovery prompt text is sanitized from queries');

const calls = [];
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url, body, headers: options.headers });
  assert.equal(body.backend, 'duckduckgo');
  assert.notEqual(body.backend, 'auto');
  assert.equal(options.headers['User-Agent'], DDGS_SCHEDULING.userAgent);
  assert(!/RECOVERY LEVEL|generate new defensible|Return STRICT JSON|Previous Gemini/i.test(body.query));
  if (calls.length === 1) return new Response('No results found', { status: 500 });
  return Response.json({ results: [{ title: 'IMF report', href: 'https://www.imf.org/report', body: 'official debt report' }] });
};
const searchDelays = [];
const search = await searchWithBackendFallback('IMF debt report RECOVERY LEVEL 3: generate new defensible POIs', 5, { delayFn: (ms, meta) => { searchDelays.push({ ms, meta }); }, rng: () => 0 });
assert.equal(search.backend, 'duckduckgo');
assert.equal(search.results.length, 1);
assert.equal(calls.length, 2);
assert.equal(calls[0].body.query, calls[1].body.query);
assert(searchDelays.some((d) => d.meta.kind === 'backoff' && d.ms === 8000), 'first retry uses 8s backoff with deterministic jitter');
assert(searchDelays.some((d) => d.meta.kind === 'search-pace' && d.ms === 2200), 'search scheduler waits randomized normal delay');

const emptyCalls = [];
const emptyDelays = [];
global.fetch = async (url, options) => { emptyCalls.push(JSON.parse(options.body)); return new Response('No results found', { status: 500 }); };
const empty = await searchWithBackendFallback('No result unique qxjv RECOVERY LEVEL 4 generate POIs', 5, { delayFn: (ms, meta) => emptyDelays.push({ ms, meta }), rng: () => 0 });
assert.equal(empty.status, SEARCH_STATUS.DDGS_UPSTREAM_ERROR);
assert.equal(emptyCalls.length, 5);
assert.deepEqual(emptyDelays.filter((d) => d.meta.kind === 'backoff').map((d) => d.ms), [8000, 16000, 32000, 64000]);
assert.equal(new Set(emptyCalls.map((c) => c.query)).size, 1);
assert(emptyCalls.every((c) => c.backend === 'duckduckgo'));

const newsCalls = [];
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  newsCalls.push({ url: String(url), body, headers: options.headers });
  assert(String(url).endsWith('/search/news'));
  assert.equal(body.backend, 'duckduckgo');
  assert.equal(options.headers['User-Agent'], DDGS_SCHEDULING.userAgent);
  return Response.json({ results: [{ date: '2026-01-01T00:00:00+00:00', title: 'Debt news', body: 'News body', url: 'https://news.example/article', image: 'https://news.example/img.jpg', source: 'Example News' }] });
};
const newsSearch = await searchWithBackendFallback('Indonesia sovereign debt recent announcement', 5, { endpoint: '/search/news', delayFn: () => {}, rng: () => 0 });
assert.equal(newsSearch.results.length, 1);
assert.equal(newsSearch.results[0].url, 'https://news.example/article');
assert.equal(newsSearch.results[0].source, 'Example News');
assert.equal(newsCalls.length, 1);

let extractCalls = 0;
global.fetch = async (_url, options) => { extractCalls += 1; assert.equal(options.headers['User-Agent'], DDGS_SCHEDULING.userAgent); return new Response('blocked', { status: 403 }); };
const blocked = await extractSource({ url: 'https://www.imf.org/report', title: 'IMF report', bangUrl: 'https://duckduckgo.com/?q=x', query: 'IMF report', searchBackend: 'duckduckgo' });
assert.equal(blocked.extractionStatus, EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(blocked.extractedText, '');
assert.equal(blocked.url, 'https://www.imf.org/report');
assert.match(blocked.bangUrl, /duckduckgo\.com/);
assert.equal(extractCalls, 1);

function sourceResult(id, query, body = `unique official evidence token${id}`) { return { title: `Source token${id}`, href: `https://example.org/source-${id}?utm_source=x#section`, body: `${body} ${query}` }; }
const architectureDelays = [];
const active = { search: 0, maxSearch: 0, extract: 0, maxExtract: 0 };
let sourceId = 0;
const scalingFetch = async (url, options) => {
  const path = new URL(String(url)).pathname;
  if (path === '/search/text' || path === '/search/news') {
    active.search += 1; active.maxSearch = Math.max(active.maxSearch, active.search);
    assert.equal(active.search, 1, 'only one DDGS search request is active');
    const body = JSON.parse(options.body);
    assert.equal(body.backend, 'duckduckgo');
    assert.equal(options.headers['User-Agent'], DDGS_SCHEDULING.userAgent);
    await Promise.resolve();
    const count = path === '/search/news' ? 2 : 10;
    const results = Array.from({ length: count }, () => sourceResult(++sourceId, body.query));
    active.search -= 1;
    return Response.json({ results });
  }
  if (path === '/extract') {
    active.extract += 1; active.maxExtract = Math.max(active.maxExtract, active.extract);
    assert.equal(active.extract, 1, 'only one extraction request is active');
    await Promise.resolve();
    active.extract -= 1;
    return Response.json({ content: 'extracted source content' });
  }
  return Response.json({ ok: true });
};
const scaled = await discoverResearch({ form, sliders, selectedTargets: [{ iso: 'IND', name: 'India' }, { iso: 'CHN', name: 'China' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP'], poiCount: 220, fetchImpl: scalingFetch, skipHealthCheck: true, delayFn: (ms, meta) => architectureDelays.push({ ms, meta }), rng: () => 0.5 });
assert.equal(scaled.stats.hardMax, 160);
assert.equal(scaled.stats.targetUrls, 150);
assert.equal(scaled.sources.length, 160, '161+ discovered unique URLs are capped at 160 retained');
assert(scaled.stats.queryCount > 14, '200+ POI research can scale beyond 14 queries');
assert.equal(active.maxSearch, 1);
assert.equal(active.maxExtract, 1);
assert(architectureDelays.some((d) => d.meta.kind === 'search-pace'), 'scheduler records search pacing delays');
assert(architectureDelays.some((d) => d.meta.kind === 'extract-pace'), 'scheduler records extraction pacing delays');
assert(scaled.sources.every((s) => s.url !== s.bangUrl && s.canonicalUrl === s.url && s.backend === 'duckduckgo'));
assert(scaled.sources.every((s) => !('relevanceScore' in s) && !('score' in s) && !('ranking' in s)));

let dedupeId = 0;
const dedupeFetch = async (url, options) => {
  const path = new URL(String(url)).pathname;
  if (path === '/extract') return new Response('blocked', { status: 403 });
  const body = JSON.parse(options.body);
  dedupeId += 1;
  if (dedupeId === 1) return Response.json({ results: [
    { title: 'Same URL', href: 'https://www.example.com/a/?utm_campaign=x#frag', body: 'first unique body' },
    { title: 'Same URL', href: 'https://example.com/a/', body: 'second unique body' },
    { title: 'Same Content', href: 'https://example.com/b', body: 'identical development finance report text' },
    { title: 'Same Content', href: 'https://example.com/c', body: 'identical development finance report text' },
    { title: 'Wikipedia', href: 'https://wikipedia.org/wiki/Debt', body: 'exclude me' },
  ] });
  return Response.json({ results: [sourceResult(`dedupe-${dedupeId}`, body.query)] });
};
const deduped = await discoverResearch({ form: { ...form, researchNotes: 'current controversy' }, sliders, selectedTargets: [], targetingMode: 'selected_global', poiTypes: [], poiCount: 10, fetchImpl: dedupeFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0 });
assert.equal(deduped.sources.filter((s) => s.domain === 'example.com' && /\/a$/.test(new URL(s.url).pathname)).length, 1, 'same canonical URL retained once');
assert.equal(deduped.sources.filter((s) => s.title === 'Same Content').length, 1, 'same content signature retained once');
assert.equal(deduped.sources.some((s) => /wikipedia\.org/.test(s.url)), false, 'Wikipedia excluded');
assert(deduped.stats.deduplicatedUrls >= 2);

const researchSource = fs.readFileSync(new URL('./ddgsResearch.js', import.meta.url), 'utf8');
assert(!/relevanceScore|scoreResult|qualityScore|sourceScore|ranking\s*=|KeepBest/i.test(researchSource), 'research does not introduce source scoring');
assert(!/Promise\.all/.test(researchSource), 'DDGS discovery/extraction does not use Promise.all concurrency');

console.log('DDGS architecture dry-run passed');
