import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bangUrl, buildResearchQueries, classifyExtractionFailure, classifySearchFailure, DDGS_LIMITS, DDGS_SCHEDULING, DDGS_TEXT_BACKEND, DDGS_NEWS_BACKEND, discoverResearch, EXTRACTION_STATUS, SEARCH_STATUS, normalizeDdgsQuery, searchWithBackendFallback, extractSource, shouldSearchNews } from './ddgsResearch.js';
import { normalizeEvidenceSource, validateSources } from './sourceValidation.js';

assert.equal(classifySearchFailure({ status: 500, body: 'No results found' }), SEARCH_STATUS.TRUE_EMPTY_RESULT);
assert.equal(classifySearchFailure({ status: 500, body: 'DDGSException: No results found' }), SEARCH_STATUS.TRUE_EMPTY_RESULT);
assert.equal(classifySearchFailure({ status: 503, body: 'upstream unavailable' }), SEARCH_STATUS.DDGS_UPSTREAM_ERROR);
assert.equal(classifySearchFailure({ status: 429, body: 'too many requests' }), SEARCH_STATUS.RATE_LIMITED);
assert.equal(classifySearchFailure({ error: Object.assign(new Error('socket timeout'), { name: 'AbortError' }) }), SEARCH_STATUS.TIMEOUT);
assert.equal(classifySearchFailure({ error: new Error('getaddrinfo ENOTFOUND') }), SEARCH_STATUS.CONNECTION_ERROR);
assert.equal(classifyExtractionFailure({ status: 401 }), EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(classifyExtractionFailure({ status: 403 }), EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(classifyExtractionFailure({ status: 404 }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED);
assert.equal(classifyExtractionFailure({ status: 429 }), EXTRACTION_STATUS.RATE_LIMITED);
assert.equal(classifyExtractionFailure({ status: 503 }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR);
assert.equal(classifyExtractionFailure({ error: Object.assign(new Error('timeout'), { name: 'AbortError' }) }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT);
assert.equal(classifyExtractionFailure({ error: new Error('TLS DNS failure') }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_NETWORK);

assert.equal(DDGS_TEXT_BACKEND, 'auto');
assert.equal(DDGS_NEWS_BACKEND, 'auto');
assert.deepEqual(DDGS_LIMITS, { preferredMin: 25, preferredMax: 50, softMax: 60, hardMax: 80 });
assert.equal(DDGS_SCHEDULING.searchConcurrency, 1);
assert.equal(DDGS_SCHEDULING.extractConcurrency, 1);
assert.equal(DDGS_SCHEDULING.searchDelay.textMinMs, 2200);
assert.equal(DDGS_SCHEDULING.searchDelay.newsMaxMs, 4500);
assert.equal(DDGS_SCHEDULING.maxExtractedSources, 25);
assert.equal(DDGS_SCHEDULING.queryMaxChars, 120);

assert.match(bangUrl('example.org', 'treaty compliance'), /duckduckgo\.com/);
const normalized = normalizeEvidenceSource({ sourceName: 'Example report', url: 'https://www.example.net/report', ddgsQuery: 'Example Agenda report', extractionStatus: EXTRACTION_STATUS.RETRIEVED });
assert.equal(normalized.url, 'https://www.example.net/report');
assert.match(normalized.bangUrl, /duckduckgo\.com/);
const [timedOutValidated] = await validateSources([normalizeEvidenceSource({ url: 'https://reports.example/slow', ddgsQuery: 'slow report', extractionStatus: EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT })]);
assert.equal(timedOutValidated.extractionStatus, EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT);

const form = {
  committee: 'Example Committee',
  agenda: 'Example Agenda Topic',
  portfolio: 'Example Portfolio',
  freezeDate: '2026-01-01',
  researchNotes: 'Focus on treaty compliance and implementation contradictions. Return STRICT JSON from Gemini validation batch.',
  backgroundGuideName: 'example-guide.pdf',
  backgroundGuideText: 'Relevant issues include treaty compliance, regional organizations, and implementation failures.',
  backgroundGuide: null,
  researchLinks: ['https://example.org/report']
};
const sliders = { aggression: 80, controversy: 70, diplomacy: 60, length: 50 };
const queryPlan = buildResearchQueries({ form, sliders, selectedTargets: [{ iso: 'AAA', name: 'Target Alpha' }, { iso: 'BBB', name: 'Target Beta' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP', 'AUTO'] });
assert(queryPlan.length > 10);
assert.equal(queryPlan.length, new Set(queryPlan.map((q) => q.toLowerCase())).size);
assert(queryPlan.some((q) => /Example Agenda Topic/.test(q)));
assert(queryPlan.some((q) => /Example Portfolio/.test(q)));
assert(queryPlan.some((q) => /treaty compliance/i.test(q)));
assert(queryPlan.some((q) => /implementation/i.test(q)));
assert(queryPlan.some((q) => /regional organizations/i.test(q)));
assert(queryPlan.some((q) => /site:example\.org/i.test(q)));
assert(!queryPlan.some((q) => /Focus on treaty compliance and implementation contradictions/i.test(q)), 'full research note is not repeated as a query');
assert(!queryPlan.some((q) => /Relevant issues include treaty compliance/i.test(q)), 'full guide text is not appended');
assert(!queryPlan.some((q) => /https:\/\/example\.org\/report/i.test(q)), 'raw research URL is not a query');
assert(!queryPlan.some((q) => /before 2026-01-01|before:2026-01-01/i.test(q)), 'freeze date is not converted into unsupported search syntax');
assert(!queryPlan.some((q) => /IMF|World Bank|Paris Club|G20 Common Framework|sovereign debt|Zambia|China debt/i.test(q)), 'unrelated hardcoded subjects are absent');
assert(!queryPlan.some((q) => /^countries$|\bcountries\b/i.test(q)), 'countries is not used as a fake target');
assert(queryPlan.every((q) => q && q.length <= DDGS_SCHEDULING.queryMaxChars));
assert(!queryPlan.some((q) => /RECOVERY LEVEL|Return STRICT JSON|PREVIOUS POI METADATA|Gemini|generate|schema|validation|batch|recovery/i.test(q)));
assert.equal(normalizeDdgsQuery('Example Agenda Topic RECOVERY LEVEL 3: generate new defensible POIs without reusing rejected angles. Previous Gemini batch under-produced. Return STRICT JSON'), 'Example Agenda Topic');

assert.equal(shouldSearchNews('Example Agenda Topic scandal', { form, sliders: { controversy: 30 } }), false);
assert.equal(shouldSearchNews('Example Agenda Topic policy', { form, sliders: { controversy: 70 } }), false);
assert.equal(shouldSearchNews('Example Agenda Topic investigation', { form, sliders: { controversy: 70 } }), true);
assert.equal(shouldSearchNews('Example Agenda Topic corruption', { form, sliders: { controversy: 90 } }), true);
assert.equal(shouldSearchNews('Example Agenda Topic vote statement sanctions', { form, sliders: { controversy: 90 } }), false);

const emptyCalls = [];
const emptyDelays = [];
global.fetch = async (_url, options) => { emptyCalls.push(JSON.parse(options.body)); return new Response('No results found', { status: 500 }); };
const empty = await searchWithBackendFallback('No result unique qxjv RECOVERY LEVEL 4 generate POIs', 5, { delayFn: (ms, meta) => emptyDelays.push({ ms, meta }), rng: () => 0 });
assert.equal(empty.status, SEARCH_STATUS.TRUE_EMPTY_RESULT);
assert.equal(emptyCalls.length, 1);
assert.equal(emptyDelays.filter((d) => d.meta.kind === 'backoff').length, 0);
assert(emptyCalls.every((c) => c.backend === 'auto'));

const newsCalls = [];
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  newsCalls.push({ url: String(url), body });
  assert(String(url).endsWith('/search/news'));
  assert.equal(body.backend, 'auto');
  return new Response('No results found', { status: 500 });
};
const newsEmpty = await searchWithBackendFallback('Example Agenda Topic investigation', 5, { endpoint: '/search/news', delayFn: () => {}, rng: () => 0 });
assert.equal(newsEmpty.status, SEARCH_STATUS.TRUE_EMPTY_RESULT);
assert.equal(newsEmpty.results.length, 0);
assert.equal(newsCalls.length, 1);

let extractCalls = 0;
global.fetch = async (_url, options) => { extractCalls += 1; assert.equal(options.headers['User-Agent'], DDGS_SCHEDULING.userAgent); return new Response('blocked', { status: 403 }); };
const blocked = await extractSource({ url: 'https://www.example.org/report', title: 'Example report', bangUrl: 'https://duckduckgo.com/?q=x', query: 'Example report', searchBackend: 'auto' });
assert.equal(blocked.extractionStatus, EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(blocked.extractedText, '');
assert.equal(extractCalls, 1);

function sourceResult(id, query, body = `unique official evidence token${id}`) { return { title: `Source token${id}`, href: `https://example.net/source-${id}?utm_source=x#section`, body: `${body} ${query}` }; }
const active = { search: 0, maxSearch: 0, extract: 0, maxExtract: 0 };
const order = [];
let sourceId = 0;
const scalingFetch = async (url, options) => {
  const path = new URL(String(url)).pathname;
  if (path === '/search/text' || path === '/search/news') {
    active.search += 1; active.maxSearch = Math.max(active.maxSearch, active.search); assert.equal(active.search, 1);
    order.push(path === '/search/text' ? 'text' : 'news');
    const body = JSON.parse(options.body); assert.equal(body.backend, 'auto'); assert(!/before 2026-01-01/i.test(body.query));
    await Promise.resolve();
    active.search -= 1;
    if (path === '/search/news' && /investigation/.test(body.query)) return new Response('No results found', { status: 500 });
    const count = path === '/search/news' ? 2 : 6;
    return Response.json({ results: Array.from({ length: count }, () => sourceResult(++sourceId, body.query)) });
  }
  if (path === '/extract') { active.extract += 1; active.maxExtract = Math.max(active.maxExtract, active.extract); assert.equal(active.extract, 1); await Promise.resolve(); active.extract -= 1; return Response.json({ content: 'extracted source content' }); }
  return Response.json({ ok: true });
};
const delays = [];
const scaled = await discoverResearch({ form, sliders, selectedTargets: [{ iso: 'AAA', name: 'Target Alpha' }, { iso: 'BBB', name: 'Target Beta' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP'], poiCount: 220, fetchImpl: scalingFetch, skipHealthCheck: true, delayFn: (ms, meta) => delays.push({ ms, meta }), rng: () => 0.5 });
assert.equal(scaled.stats.hardMax, 80);
assert.equal(scaled.stats.targetUrls, 80);
assert(scaled.sources.length <= 80);
assert(scaled.retrievedSources.length <= 25);
assert.equal(active.maxSearch, 1);
assert.equal(active.maxExtract, 1);
for (let i = 0; i < order.length - 1; i += 1) assert(!(order[i] === 'news' && order[i + 1] === 'news'));
assert(delays.some((d) => d.meta.kind === 'search-pace'));
assert(delays.some((d) => d.meta.kind === 'extract-pace'));
assert(scaled.sources.every((s) => s.backend === 'auto'));
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
    { title: 'Same Content', href: 'https://example.com/b', body: 'identical implementation report text' },
    { title: 'Same Content', href: 'https://example.com/c', body: 'identical implementation report text' },
    { title: 'Wikipedia', href: 'https://wikipedia.org/wiki/Example', body: 'exclude me' },
  ] });
  if (path === '/search/news') return Response.json({ results: [{ date: '2026-01-01T00:00:00+00:00', title: 'Example article', body: 'Example body', url: 'https://news.example/article', source: 'Example News' }, { date: '2026-01-02T00:00:00+00:00', title: 'Future article', body: 'Future body', url: 'https://news.example/future', source: 'Example News' }] });
  return Response.json({ results: [sourceResult(`dedupe-${dedupeId}`, body.query)] });
};
const deduped = await discoverResearch({ form: { ...form, freezeDate: '2026-01-01' }, sliders, selectedTargets: [], targetingMode: 'selected_global', poiTypes: [], poiCount: 10, fetchImpl: dedupeFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0 });
assert.equal(deduped.sources.filter((s) => s.domain === 'example.com' && /\/a$/.test(new URL(s.url).pathname)).length, 1);
assert.equal(deduped.sources.filter((s) => s.title === 'Same Content').length, 1);
assert.equal(deduped.sources.some((s) => /wikipedia\.org/.test(s.url)), false);
assert(deduped.sources.some((s) => s.sourceType === 'news' && s.publicationDate === '2026-01-01T00:00:00+00:00' && s.source === 'Example News'));
assert(!deduped.sources.some((s) => /future/.test(s.url)), 'post-freeze news is filtered');

const researchSource = fs.readFileSync(new URL('./ddgsResearch.js', import.meta.url), 'utf8');
assert(!/Promise\.all|Promise\.allSettled|worker pool|parallel batch/i.test(researchSource));
assert(!/G20 Common Framework|Paris Club|IMF debt|World Bank debt|Zambia|China debt|sovereign debt restructuring/.test(researchSource));
assert(!/relevanceScore|scoreResult|qualityScore|sourceScore|ranking\s*=|KeepBest/i.test(researchSource));

console.log('DDGS architecture dry-run passed');
