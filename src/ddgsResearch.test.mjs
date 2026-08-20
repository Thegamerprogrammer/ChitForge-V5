import assert from 'node:assert/strict';
import { bangUrl, classifyExtractionFailure, classifySearchFailure, EXTRACTION_STATUS, SEARCH_STATUS, searchWithBackendFallback, extractSource } from './ddgsResearch.js';

assert.equal(classifySearchFailure({ status: 500, body: 'No results found' }), SEARCH_STATUS.NO_RESULTS_FOR_QUERY);
assert.equal(classifySearchFailure({ status: 500, body: 'rate limit exceeded' }), SEARCH_STATUS.RATE_LIMITED);
assert.equal(classifySearchFailure({ error: Object.assign(new Error('socket timeout'), { name: 'AbortError' }) }), SEARCH_STATUS.TIMEOUT);
assert.equal(classifySearchFailure({ error: new Error('getaddrinfo ENOTFOUND') }), SEARCH_STATUS.CONNECTION_ERROR);
assert.equal(classifySearchFailure({ status: 500, body: 'engine exploded' }), SEARCH_STATUS.DDGS_UPSTREAM_ERROR);
assert.equal(classifyExtractionFailure({ status: 403 }), EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(classifyExtractionFailure({ status: 404 }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED);
assert.equal(classifyExtractionFailure({ status: 429 }), EXTRACTION_STATUS.RATE_LIMITED);
assert.equal(classifyExtractionFailure({ status: 503 }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_UPSTREAM_ERROR);
assert.equal(classifyExtractionFailure({ error: Object.assign(new Error('timeout'), { name: 'AbortError' }) }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_TIMEOUT);
assert.equal(classifyExtractionFailure({ error: new Error('TLS DNS failure') }), EXTRACTION_STATUS.DISCOVERED_NOT_RETRIEVED_NETWORK);
assert.match(bangUrl('imf.org', 'debt restructuring'), /duckduckgo\.com/);

const calls = [];
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url, body });
  if (String(url).includes('/search/text') && body.backend === 'auto') return new Response('No results found', { status: 500 });
  if (String(url).includes('/search/text') && body.backend === 'bing') return Response.json({ results: [{ title: 'IMF report', href: 'https://www.imf.org/report', body: 'official debt report' }] });
  throw new Error('unexpected call');
};
const search = await searchWithBackendFallback('IMF debt report', 5, { backends: ['auto', 'bing'] });
assert.equal(search.backend, 'bing');
assert.equal(search.results.length, 1);
assert(calls.some((c) => c.body.backend === 'auto'));
assert(calls.some((c) => c.body.backend === 'bing'));

global.fetch = async () => new Response('blocked', { status: 403 });
const blocked = await extractSource({ url: 'https://www.imf.org/report', title: 'IMF report', bangUrl: 'https://duckduckgo.com/?q=x', query: 'IMF report', searchBackend: 'bing' });
assert.equal(blocked.extractionStatus, EXTRACTION_STATUS.DISCOVERED_DIRECT_EXTRACTION_BLOCKED);
assert.equal(blocked.url, 'https://www.imf.org/report');
console.log('DDGS failure classification dry-run passed');
