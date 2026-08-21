import assert from 'node:assert/strict';
import { recoverPoiShortfallLoop, chooseRecoveryBatchSize, compactResearchPacket, COMPACT_RESEARCH_MAX_CHARS, planGenerationBatches, mergeRecoveryCandidates, buildCompactRecoveryState } from './generation.js';
import { findDuplicatePoiIndexes } from './validation.js';

function poi(id, target = `Target ${id}`, issue = `issue ${id}`) { return { target, poi: `Why did ${target} do ${issue}?`, documentedIssue: issue, evidence: [{ url: `https://example.org/${id}`, claimSupported: issue }], tacticalImpact: `angle ${id}` }; }
async function scripted(count, batches, initial = 0) {
  const requested = [];
  let id = 0;
  const mission = { chits: Array.from({ length: initial }, () => poi(++id)), targets: [], metadata: {}, portfolioProfile: { summary: 'ok' } };
  const out = await recoverPoiShortfallLoop({ mission, poiCount: count, generateCandidates: async ({ recoveryRequestCount }) => { requested.push(recoveryRequestCount); const n = batches.shift(); if (n instanceof Error) throw n; return { candidates: Array.from({ length: Math.min(n, recoveryRequestCount) }, () => poi(++id)), diagnostics: { candidatesFound: n, normalizedPois: Math.min(n, recoveryRequestCount), parseSucceeded: true } }; } });
  return { out, requested };
}

assert.deepEqual(planGenerationBatches(50), [25, 25]);
assert.deepEqual(planGenerationBatches(100), [25, 25, 25, 25]);
assert.deepEqual(planGenerationBatches(200).length, 8);
assert.equal(chooseRecoveryBatchSize({ remainingPoiCount: 37, recoveryLog: [] }) <= 15, true);
assert.equal(chooseRecoveryBatchSize({ remainingPoiCount: 1, recoveryLog: [{ accepted: 14 }] }), 1);

let r = await scripted(25, [9, 3], 13);
assert.equal(r.out.chits.length, 25, '25-mode regression completes after 13 + 9 + 3');

r = await scripted(50, [1, 14, 10, 14, 11, 15, 15]);
assert.equal(r.out.chits.length, 50, '50 completes despite first 25-style underfill to one');
assert(r.requested.every((n) => n <= 15), '50 recovery never makes giant remaining request');

r = await scripted(50, [4, 8, 12, 10, 16, 15, 15]);
assert.equal(r.out.chits.length, 50);
r = await scripted(50, [3, 20, 27, 15, 15, 15]);
assert.equal(r.out.chits.length, 50);
r = await scripted(50, [1], 49);
assert.equal(r.out.chits.length, 50);
r = await scripted(50, [4, 0, 12, 12, 12, 10, 15, 15]);
assert.equal(r.out.chits.length, 50, 'zero progress does not terminate after a successful retry');
r = await scripted(50, [new Error('api down'), new Error('still down'), new Error('again'), new Error('again'), new Error('again'), new Error('again'), new Error('again'), new Error('again')], 21);
assert.equal(r.out.chits.length, 21, 'accepted POIs remain committed after later API failures');
assert.equal(r.out.metadata.partialResult, true);

const bigResearch = { stats: { retainedUrls: 500 }, sources: Array.from({ length: 200 }, (_, i) => ({ url: `https://d${i % 30}.example/report-${i}`, title: `title ${i}`, domain: `d${i % 30}.example`, date: '2025-01-01', snippet: 'snippet '.repeat(80), extractedText: `extracted evidence ${i} `.repeat(100), sourceType: i % 2 ? 'news' : 'text', query: `angle ${i}`, relevanceScore: 100 - i })) };
const compact = compactResearchPacket(bigResearch);
assert(JSON.stringify(compact).length < JSON.stringify(bigResearch).length / 4, 'large research packet is compacted for generation context');
assert(compact.sources[0].url && compact.sources[0].title && 'extractedEvidence' in compact.sources[0]);
assert(JSON.stringify(compact).length <= COMPACT_RESEARCH_MAX_CHARS, 'initial compact packet stays within configured limit');
const expandedCompact = compactResearchPacket({ ...bigResearch, sources: [...bigResearch.sources, ...Array.from({ length: 500 }, (_, i) => ({ url: `https://extra${i}.example/report`, title: `extra ${i}`, domain: `extra${i % 50}.example`, snippet: 'extra '.repeat(100), extractedText: 'more evidence '.repeat(100), relevanceScore: 200 - i }))] });
assert(JSON.stringify(expandedCompact).length <= COMPACT_RESEARCH_MAX_CHARS, 'post-recovery expanded packet remains compact before Gemini');
const recoveryState = buildCompactRecoveryState({ current: { chits: Array.from({ length: 80 }, (_, i) => poi(`state-${i}`)) }, requestedPoiCount: 100, remainingPoiCount: 20, recoveryRequestCount: 12, recoveryLog: [{ level: 1, accepted: 10, duplicateRejected: 5 }] });
assert(JSON.stringify(recoveryState).length <= 12000, 'recovery state block is bounded');


const duplicateIndexes = findDuplicatePoiIndexes([
  poi('vote', 'Same Target', 'voted against resolution A'),
  poi('finance', 'Same Target', 'missed climate finance pledge B'),
]);
assert.deepEqual(duplicateIndexes, [], 'same-target different pressure points survive duplicate detection');
const sameBatch = mergeRecoveryCandidates({ chits: [] }, [poi('A', 'T', 'same vote issue'), poi('A2', 'T', 'same vote issue'), poi('B', 'T', 'different treaty issue'), poi('B2', 'T', 'different treaty issue')], 10);
assert.equal(sameBatch.chits.length, 2, 'same-batch paraphrase duplicates are removed immediately');

console.log('recovery orchestration tests passed');
