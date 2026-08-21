import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bangUrl, buildResearchQueries, classifyExtractionFailure, classifySearchFailure, DDGS_LIMITS, DDGS_SCHEDULING, DDGS_TEXT_BACKEND, DDGS_NEWS_BACKEND, discoverResearch, EXTRACTION_STATUS, SEARCH_STATUS, normalizeDdgsQuery, searchWithBackendFallback, extractSource, shouldSearchNews, planResearchBudget, getResearchSourceBudget, getResearchQueryBudget, getResearchExtractionBudget, scoreResult } from './ddgsResearch.js';
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
assert.deepEqual(DDGS_LIMITS, { sourceMultiplier: 6, queryMultiplier: 1.4, extractionMultiplier: 2, primaryPasses: 2, absoluteSafetyCeiling: 5000 });
assert.equal(DDGS_SCHEDULING.searchConcurrency, 4);
assert.equal(DDGS_SCHEDULING.extractConcurrency, 4);
assert.equal(DDGS_SCHEDULING.searchDelay.textMinMs, 2200);
assert.equal(DDGS_SCHEDULING.searchDelay.newsMaxMs, 4500);
assert.equal(DDGS_SCHEDULING.queryMaxChars, 120);

const budgetCounts = [10, 25, 50, 100, 200];
const budgets = budgetCounts.map((poiCount) => planResearchBudget({ poiCount }));
for (const budget of budgets) {
  assert.equal(budget.sourcesPerPass, budget.poiCount * 6);
  assert.equal(budget.extractionsPerPass, budget.poiCount * 2);
  assert.equal(budget.sourceBudget, budget.poiCount * 12);
  assert.equal(budget.extractionBudget, budget.poiCount * 4);
}
for (let i = 1; i < budgets.length; i += 1) {
  assert(budgets[i].sourceBudget > budgets[i - 1].sourceBudget);
  assert(budgets[i].queryBudget > budgets[i - 1].queryBudget);
  assert(budgets[i].extractionBudget > budgets[i - 1].extractionBudget);
}
assert.equal(getResearchSourceBudget(50), 300);
assert.equal(getResearchExtractionBudget(50), 100);
assert.equal(planResearchBudget({ poiCount: 50 }).sourceBudget, 600);
assert.equal(planResearchBudget({ poiCount: 50 }).extractionBudget, 200);
assert.equal(planResearchBudget({ poiCount: 100 }).sourcesPerPass, 600);
assert.equal(planResearchBudget({ poiCount: 100 }).extractionsPerPass, 200);
assert.equal(budgets.at(-1).sourceBudget, 2400);

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
const queryPlan = buildResearchQueries({ form, sliders, selectedTargets: [{ iso: 'AAA', name: 'Target Alpha' }, { iso: 'BBB', name: 'Target Beta' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP', 'AUTO'], queryBudget: getResearchQueryBudget(100) });
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
assert(!queryPlan.some((q) => /Example Unrelated Fixed Topic/i.test(q)), 'unrelated hardcoded subjects are absent');
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
assert(scoreResult({ title: 'Official implementation report', url: 'https://agency.gov/report', body: 'Example Agenda Topic policy implementation' }, { form, query: 'Example Agenda Topic implementation' }) > scoreResult({ title: 'Random note', url: 'https://blogspot.example/x', body: 'unrelated' }, { form, query: 'Example Agenda Topic' }), 'source scoring ranks mission-relevant official evidence higher');
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
    active.search += 1; active.maxSearch = Math.max(active.maxSearch, active.search); assert(active.search <= DDGS_SCHEDULING.searchConcurrency);
    order.push(path === '/search/text' ? 'text' : 'news');
    const body = JSON.parse(options.body); assert.equal(body.backend, 'auto'); assert(!/before 2026-01-01/i.test(body.query));
    await Promise.resolve();
    active.search -= 1;
    if (path === '/search/news' && /investigation/.test(body.query)) return new Response('No results found', { status: 500 });
    const count = path === '/search/news' ? 2 : 6;
    return Response.json({ results: Array.from({ length: count }, () => sourceResult(++sourceId, body.query)) });
  }
  if (path === '/extract') { active.extract += 1; active.maxExtract = Math.max(active.maxExtract, active.extract); assert(active.extract <= DDGS_SCHEDULING.extractConcurrency); await Promise.resolve(); active.extract -= 1; return Response.json({ content: 'extracted source content' }); }
  return Response.json({ ok: true });
};
const delays = [];
const scaled = await discoverResearch({ form, sliders, selectedTargets: [{ iso: 'AAA', name: 'Target Alpha' }, { iso: 'BBB', name: 'Target Beta' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP'], poiCount: 220, fetchImpl: scalingFetch, skipHealthCheck: true, delayFn: (ms, meta) => delays.push({ ms, meta }), rng: () => 0.5 });
assert.equal(scaled.stats.primaryPasses, 2);
assert.equal(scaled.stats.passSummaries.length, 2);
assert.equal(scaled.stats.sourceBudget, 2640);
assert.equal(scaled.stats.targetUrls, 2640);
assert(scaled.sources.length > 80);
assert(scaled.sources.length <= scaled.stats.sourceBudget);
assert(scaled.retrievedSources.length <= scaled.stats.extractionBudget);
assert(active.maxSearch > 1 && active.maxSearch <= DDGS_SCHEDULING.searchConcurrency);
assert(active.maxExtract > 1 && active.maxExtract <= DDGS_SCHEDULING.extractConcurrency);
assert(order.includes('text'), 'text searches ran');
assert(delays.some((d) => d.meta.kind === 'search-pace'));
assert(delays.some((d) => d.meta.kind === 'extract-pace'));
assert(scaled.sources.every((s) => s.backend === 'auto'));
assert(scaled.sources.some((s) => Number.isFinite(s.relevanceScore)), 'sources carry relevance scores for extraction ranking');

const fiftyBudget = planResearchBudget({ poiCount: 50 });
assert.equal(fiftyBudget.sourcesPerPass, 300);
assert.equal(fiftyBudget.extractionsPerPass, 100);
assert.equal(fiftyBudget.primaryPasses, 2);
assert.equal(planResearchBudget({ poiCount: 10 }).sourcesPerPass, 60);
assert.equal(planResearchBudget({ poiCount: 10 }).extractionsPerPass, 20);
assert.equal(planResearchBudget({ poiCount: 25 }).sourcesPerPass, 150);
assert.equal(planResearchBudget({ poiCount: 25 }).extractionsPerPass, 50);
assert.equal(planResearchBudget({ poiCount: 200 }).sourcesPerPass, 1200);
assert.equal(planResearchBudget({ poiCount: 200 }).extractionsPerPass, 400);

let duplicateSearches = 0;
const duplicateFetch = async (url, options) => {
  const path = new URL(String(url)).pathname;
  if (path === '/extract') return Response.json({ content: 'duplicate-heavy extracted content' });
  const body = JSON.parse(options.body);
  duplicateSearches += 1;
  return Response.json({ results: [
    { title: `Dup ${duplicateSearches}`, href: 'https://dup.example/same', body: `same result ${body.query}` },
    { title: `Dup again ${duplicateSearches}`, href: 'https://dup.example/same?utm_source=x#frag', body: `same result again ${body.query}` },
  ] });
};
const duplicateHeavy = await discoverResearch({ form, sliders: { ...sliders, controversy: 30 }, selectedTargets: [], targetingMode: 'selected_global', poiTypes: [], poiCount: 10, fetchImpl: duplicateFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0 });
assert(duplicateHeavy.stats.rawResults > duplicateHeavy.sources.length, 'raw duplicate results do not falsely satisfy useful source targets');
assert(duplicateHeavy.stats.duplicateHeavyExpansions > 0, 'duplicate-heavy results trigger deeper query expansion');
assert(duplicateHeavy.stats.duplicateUrls > 0, 'duplicate URLs are tracked separately from useful sources');
assert.equal(typeof duplicateHeavy.stats.contentDuplicates, 'number', 'content duplicates are tracked separately');
assert(duplicateHeavy.stats.retainedUrls < duplicateHeavy.stats.rawResults, 'duplicate URLs do not count as useful source progress');

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
const deduped = await discoverResearch({ form: { ...form, freezeDate: '2026-01-01' }, sliders, selectedTargets: [], targetingMode: 'selected_global', poiTypes: [], poiCount: 50, fetchImpl: dedupeFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0 });
assert.equal(deduped.sources.filter((s) => s.domain === 'example.com' && /\/a$/.test(new URL(s.url).pathname)).length, 1);
assert.equal(deduped.sources.filter((s) => s.title === 'Same Content').length, 1);
assert.equal(deduped.sources.some((s) => /wikipedia\.org/.test(s.url)), false);
assert(deduped.sources.some((s) => s.sourceType === 'news' && s.publicationDate === '2026-01-01T00:00:00+00:00' && s.source === 'Example News'));
assert(!deduped.sources.some((s) => /future/.test(s.url)), 'post-freeze news is filtered');


let firstRecoveryId = 5000;
const firstRecoveryFetch = async (url, options) => {
  const path = new URL(String(url)).pathname;
  if (path === '/extract') return Response.json({ content: 'first recovery extracted source content' });
  const body = JSON.parse(options.body);
  return Response.json({ results: [sourceResult(`first-recovery-${++firstRecoveryId}`, body.query)] });
};
const firstRecovery = await discoverResearch({ form, sliders: { ...sliders, controversy: 30 }, selectedTargets: [{ iso: 'AAA', name: 'Target Alpha' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP'], poiCount: 100, fetchImpl: firstRecoveryFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0.5 });
const partialResearchState = { ...firstRecovery.researchState, searchedQueryKeys: firstRecovery.researchState.searchedQueryKeys.slice(0, 20), exhaustedQueryKeys: firstRecovery.researchState.exhaustedQueryKeys.slice(0, 20), sources: firstRecovery.sources.slice(0, 80) };
const previousQueryKeys = new Set(partialResearchState.searchedQueryKeys);
const previousSourceCount = partialResearchState.sources.length;
const recoveryCalls = [];
let recoveryId = 10000;
const recoveryFetch = async (url, options) => {
  const path = new URL(String(url)).pathname;
  if (path === '/extract') return Response.json({ content: 'recovery extracted source content' });
  const body = JSON.parse(options.body);
  recoveryCalls.push(body.query.toLowerCase());
  assert(!previousQueryKeys.has(body.query.toLowerCase()), `repeated recovery query ${body.query}`);
  return Response.json({ results: Array.from({ length: 3 }, () => sourceResult(`recovery-${++recoveryId}`, body.query)) });
};
const recovered = await discoverResearch({ form, sliders: { ...sliders, controversy: 30 }, selectedTargets: [{ iso: 'AAA', name: 'Target Alpha' }], targetingMode: 'selected_global', poiTypes: ['LEGAL TRAP'], poiCount: 100, researchState: partialResearchState, fetchImpl: recoveryFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0.5 });
assert(recoveryCalls.length > 0);
assert(recovered.sources.length > previousSourceCount);
assert.equal(recovered.stats.primaryPasses, 2);
assert.equal(recovered.stats.passSummaries.length, 2);
assert(recovered.stats.passSummaries[1].queryKeys.every((key) => !new Set(recovered.stats.passSummaries[0].queryKeys).has(key)), 'pass 2 does not repeat pass 1 query keys');
assert(recovered.researchState.sources.length >= previousSourceCount, 'pass 2 inherits pass 1 source state');
assert.equal(recovered.researchState.searchedQueryKeys.length, previousQueryKeys.size + recoveryCalls.length);
assert.equal(recovered.stats.sourceBudget, firstRecovery.stats.sourceBudget);


const cachedSuccess = { url: 'https://cache.example/success?utm_source=x', canonicalUrl: 'https://cache.example/success', title: 'Cached success', extractedText: 'already extracted', extractionStatus: EXTRACTION_STATUS.RETRIEVED, retrievalStatus: EXTRACTION_STATUS.RETRIEVED };
const cachedFailure = { url: 'https://cache.example/failure#frag', canonicalUrl: 'https://cache.example/failure', title: 'Cached failure', extractedText: '', extractionStatus: EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT, retrievalStatus: EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT };
const newUnprocessed = { url: 'https://cache.example/new?utm_campaign=x', canonicalUrl: 'https://cache.example/new', title: 'New source', extractionStatus: EXTRACTION_STATUS.DISCOVERED, retrievalStatus: EXTRACTION_STATUS.DISCOVERED, query: 'Example Agenda Topic policy', ddgsQuery: 'Example Agenda Topic policy', backend: 'auto', searchBackend: 'auto', bangUrl: bangUrl('cache.example', 'Example Agenda Topic policy') };
let cacheExtractCalls = 0;
const cacheFetch = async (url) => {
  const path = new URL(String(url)).pathname;
  if (path === '/extract') { cacheExtractCalls += 1; return Response.json({ content: 'newly extracted content' }); }
  return Response.json({ results: [] });
};
const cacheState = { searchedQueryKeys: Array.from({ length: getResearchQueryBudget(10) }, (_, i) => `already searched ${i}`), exhaustedQueryKeys: [], newsQueryKeys: [], sources: [cachedSuccess, cachedFailure, newUnprocessed], extractionCache: [{ canonicalUrl: cachedSuccess.canonicalUrl, source: cachedSuccess }, { canonicalUrl: cachedFailure.canonicalUrl, source: cachedFailure }], researchBudgetConsumed: { extractionCalls: 2 } };
const cacheRound = await discoverResearch({ form, sliders: { ...sliders, controversy: 30 }, selectedTargets: [], targetingMode: 'selected_global', poiTypes: [], poiCount: 10, researchState: cacheState, fetchImpl: cacheFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0 });
assert.equal(cacheExtractCalls, 1, 'only the genuinely new canonical URL is extracted');
assert.equal(cacheRound.stats.extractionReused, 2, 'successful and failed terminal extraction results are reused');
assert(cacheRound.researchState.extractionCache.length >= 3, 'new extraction result is cached');
cacheExtractCalls = 0;
const cacheRecovery = await discoverResearch({ form, sliders: { ...sliders, controversy: 30 }, selectedTargets: [], targetingMode: 'selected_global', poiTypes: [], poiCount: 10, researchState: cacheRound.researchState, fetchImpl: cacheFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0 });
assert.equal(cacheExtractCalls, 0, 'recovery does not re-extract successful or terminal failed URLs');
assert(cacheRecovery.retrievedSources.some((source) => source.extractedText === 'newly extracted content'));

let budgetExtractCalls = 0;
const budgetSources = Array.from({ length: 10 }, (_, i) => ({ url: `https://budget.example/source-${i}`, canonicalUrl: `https://budget.example/source-${i}`, title: `Budget ${i}`, extractionStatus: EXTRACTION_STATUS.DISCOVERED, retrievalStatus: EXTRACTION_STATUS.DISCOVERED }));
const budgetFetch = async (url) => { if (new URL(String(url)).pathname === '/extract') { budgetExtractCalls += 1; return Response.json({ content: `budget extracted ${budgetExtractCalls}` }); } return Response.json({ results: [] }); };
const budgetRound = await discoverResearch({ form, sliders: { ...sliders, controversy: 30 }, selectedTargets: [], targetingMode: 'selected_global', poiTypes: [], poiCount: 2, researchState: { searchedQueryKeys: Array.from({ length: getResearchQueryBudget(2) }, (_, i) => `budget searched ${i}`), sources: budgetSources, researchBudgetConsumed: { extractionCalls: 0 } }, fetchImpl: budgetFetch, skipHealthCheck: true, delayFn: () => {}, rng: () => 0 });
assert.equal(budgetExtractCalls, planResearchBudget({ poiCount: 2 }).extractionBudget, 'extraction budget is enforced as a run ceiling');
assert(budgetRound.stats.extractionSkippedBudget > 0);

const researchSource = fs.readFileSync(new URL('./ddgsResearch.js', import.meta.url), 'utf8');
assert(/mapPool/.test(researchSource), 'bounded concurrency helper is present');
assert(!/Example Unrelated Fixed Topic/.test(researchSource));
assert(/scoreResult/.test(researchSource), 'old-V5 style relevance scoring is present');

console.log('DDGS architecture dry-run passed');
