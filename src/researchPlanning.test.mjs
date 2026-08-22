import assert from 'node:assert/strict';
import { allocateActorQueries, canonicalUrl, clusterIncidents, deduplicateSources, freezeValidation, newsShare, queryBudget, targetValue } from './ddgsResearch.js';
import { resolveCountry, searchCountries } from './countrySearch.js';

for (const count of [1, 10, 20, 50, 100]) { const budget = queryBudget(count); assert.equal(budget.stage1, Math.round(count * 7.5)); assert.equal(budget.stage2, count * 10); }
assert.deepEqual(queryBudget(20), { stage1: 150, stage2: 200 });
assert.deepEqual(queryBudget(100), { stage1: 750, stage2: 1000 });
assert.equal(newsShare(0), .2); assert.equal(newsShare(45), .5); assert.equal(newsShare(70), .7); assert.equal(newsShare(100), .85);
assert.equal(canonicalUrl('https://www.un.org/a/?utm_source=x#part'), 'https://un.org/a');
assert.equal(deduplicateSources([{ canonicalUrl:'https://x.test' }, { canonicalUrl:'https://x.test' }]).length, 1);
assert.deepEqual(freezeValidation({ publicationDate:'2026-02-01', freezeDate:'2026-03-01' }), { freezeStatus:'PRE_FREEZE', usable:true });
assert.deepEqual(freezeValidation({ publicationDate:'2026-04-01', eventDate:'2026-02-01', informationAvailabilityDate:'2026-02-15', freezeDate:'2026-03-01' }), { freezeStatus:'POST_FREEZE_PRE_FREEZE_EVENT', usable:true });
assert.deepEqual(freezeValidation({ publicationDate:'2026-04-01', eventDate:'2026-04-01', informationAvailabilityDate:'2026-04-01', freezeDate:'2026-03-01' }), { freezeStatus:'POST_FREEZE_NEW_EVENT', usable:false });
const clusters = clusterIncidents([{ country:'A', claim:'Court found the same implementation failure', sourceIds:['research_1'] }, { country:'A', claim:'Implementation failure found by court same', sourceIds:['research_2'] }]);
assert.equal(clusters.length, 1, 'incident clustering combines corroboration');
const allocated = allocateActorQueries([{ relevance:90 }, { relevance:10 }, { relevance:1 }], 100);
assert.equal(allocated[0].queryAllocation > 50, true);
assert.equal(allocated.reduce((sum, actor) => sum + actor.queryAllocation, 0), 100, 'actor allocation remains the total stage budget');
assert.deepEqual(allocateActorQueries([], 100), []);
assert.equal(targetValue({ agendaRelevance:100, evidenceStrength:100, legalAccountability:100, controversyFit:100, recency:100, sourceQuality:100, corroboration:100 }), 100);
assert.equal(resolveCountry(' People\'s Republic of China ').iso, 'CHN');
assert.equal(resolveCountry('USA').name, 'United States');
assert(searchCountries('united stat').some((country) => country.iso === 'USA'), 'partial country search returns an autocomplete match');
console.log('four-stage research planning tests passed');
